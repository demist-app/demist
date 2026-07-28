// desktop/native/whisper.js: FULL REPLACEMENT
// On-device transcription, now session-based on raw PCM instead of per-blob.
//
// What changed and why:
// - The renderer now streams raw 16kHz Float32 PCM (captured by an
//   AudioWorklet) instead of 5-second WebM blobs. That removes ffmpeg, the
//   temp files, the decode step, and every container/boundary problem in one
//   move: there is nothing to decode.
// - A PcmSegmenter cuts the stream at natural pauses, so Whisper only ever
//   transcribes complete utterances with real context. This is the actual fix
//   for word-slicing at chunk boundaries and silence hallucinations.
// - Segments are transcribed strictly in order through a single promise
//   queue, so text can never arrive out of order.
// - Default tier is now 'accurate' (whisper-small.en). The old 'fast' default
//   (base.en) "noticeably under-transcribes real lecture speech" per the
//   previous version's own comment; utterance-based processing only
//   transcribes actual speech (no more padding 5s of audio to 30s per call),
//   which pays for the bigger model. 'fast' remains available via the
//   existing tier setter for weak machines.

const { pipeline, env } = require('@huggingface/transformers')
const fsSync = require('fs')
const os = require('os')
const path = require('path')
const { makeProgressLogger } = require('./progressLog')
const { PcmSegmenter, SAMPLE_RATE } = require('./pcm-segmenter')

// Default cache dir is inside node_modules/@huggingface/transformers/.cache
// (confirmed by inspecting env.cacheDir directly), wiped by any future
// `npm install`, and the likely reason models were re-downloading on every
// session. Same home-directory convention native/llm.js already uses.
env.cacheDir = path.join(os.homedir(), '.demist', 'model-cache')

const MODEL_BY_TIER = {
  fast: 'Xenova/whisper-base.en',
  accurate: 'Xenova/whisper-small.en',
}
const TIER_FILE = path.join(os.homedir(), '.demist', 'whisper-tier.json')

// 8-bit weights. Measured on the same speech, same segment length:
//   fp32  3018MB resident, 2073ms per 6s segment, 10.1% WER
//   q8    2332MB resident, 2205ms per 6s segment,  8.7% WER
// 686MB less memory for no accuracy cost (the small WER difference is noise
// on a single sample, but it is certainly not worse) and a negligible speed
// difference. It also downloads less. Memory is the binding constraint on
// student laptops, so this is close to a free win - see the totalmem note
// below for why that matters so much.
const DTYPE = 'q8'

const TOTAL_RAM_GB = os.totalmem() / (1024 ** 3)

// Which model a machine gets by default, on the machine's own terms. The
// models are big enough that this cannot be one-size-fits-all: with the
// accurate tier, Whisper + the term-detection LLM + translation come to
// roughly 5.8GB resident. On a 16GB machine that already forced the OS to
// page models out, which is what made starting a session take 50-70s. On an
// 8GB laptop it would be unusable.
//
// The fast tier (whisper-base.en q8) is 1027MB instead of 2332MB and runs
// twice as fast, but measured 26.1% WER against 8.7% - materially worse for
// lecture vocabulary, so it is a fallback for machines that cannot afford
// the accurate one, never the default for machines that can. An explicit
// user choice in Settings still overrides this either way.
function defaultTier() {
  return TOTAL_RAM_GB < 10 ? 'fast' : 'accurate'
}

function getTier() {
  try {
    const tier = JSON.parse(fsSync.readFileSync(TIER_FILE, 'utf8')).tier
    return MODEL_BY_TIER[tier] ? tier : defaultTier()
  } catch {
    return defaultTier()
  }
}

function setTier(tier) {
  if (!MODEL_BY_TIER[tier]) throw new Error(`Unknown transcription tier "${tier}"`)
  fsSync.mkdirSync(path.dirname(TIER_FILE), { recursive: true })
  fsSync.writeFileSync(TIER_FILE, JSON.stringify({ tier }))
  return tier
}

const transcribersByTier = new Map()
function getTranscriber(emitProgress) {
  const tier = getTier()
  if (!transcribersByTier.has(tier)) {
    // Kept: one line per app launch, and it records which model a machine
    // actually chose, which is the first thing to check on any quality report.
    console.log(`[demist] loading transcription model: tier=${tier} dtype=${DTYPE} (machine has ${TOTAL_RAM_GB.toFixed(1)}GB RAM)`)
    const loadPromise = pipeline('automatic-speech-recognition', MODEL_BY_TIER[tier], {
      dtype: DTYPE,
      progress_callback: makeProgressLogger(`transcription model (${tier})`, emitProgress),
    }).then(async (transcriber) => {
      // The resolved pipeline has weights loaded but onnxruntime-node hasn't
      // built its inference session yet: that first build (buffer
      // allocation, graph optimization) happens lazily on the first real
      // call. Confirmed to add several seconds on top of the segmenter's own
      // buffering delay, together accounting for the ~20s reported before any
      // transcript text appeared. Running one throwaway inference here, while
      // preload() is warming things up at app start rather than mid-lecture,
      // pays that cost before the user ever starts a session.
      try { await transcriber(new Float32Array(SAMPLE_RATE)) } catch { /* warm-up only, ignore */ }
      return transcriber
    })
    // Same fix as native/translate.js's getTranslator: don't let a failed
    // load (e.g. a truncated download) stay cached as a permanently
    // rejected promise, or every future call replays that same failure
    // instead of retrying.
    loadPromise.catch(() => { if (transcribersByTier.get(tier) === loadPromise) transcribersByTier.delete(tier) })
    transcribersByTier.set(tier, loadPromise)
  }
  return transcribersByTier.get(tier)
}

// Known Whisper silence hallucinations. Only applied when the segment's
// audio energy says there was barely anything to transcribe; a lecturer
// genuinely saying "thank you" mid-lecture has normal energy and passes.
const HALLUCINATION_BLOCKLIST = new Set([
  'thank you.', 'thank you', 'thanks for watching.', 'thanks for watching',
  'you', 'you.', 'bye.', 'bye', '.', 'the',
])
const LOW_ENERGY_RMS = 0.004

// ── Session ────────────────────────────────────────────────────────────────
// One live session at a time (one microphone). startSession wires a
// segmenter whose segments run through a serial transcription queue; each
// result is pushed via onTranscript with a monotonically increasing seq.
// onInterim (optional) additionally gets a best-effort preview of whatever's
// still accumulating, transcribed as it comes in rather than waiting for the
// segment to actually close (see pcm-segmenter.js's INTERIM_INTERVAL_MS
// comment for why this exists and its real accuracy caveats).

let activeSession = null

async function startSession(onTranscript, emitProgress, onInterim, emitDiag) {
  const t0 = Date.now()
  // Forwarded to the renderer's console, where it is gated behind the
  // renderer's own debug flag; only mirrored to stdout when DEMIST_DEBUG=1.
  const diag = (m) => { if (process.env.DEMIST_DEBUG === '1') console.log(`[demist] ${m}`); emitDiag?.(m) }
  diag(`startSession: entered (worker has transcriber cached: ${transcribersByTier.has(getTier())})`)
  stopSession() // safety: a crashed renderer can leave one dangling
  diag(`startSession: previous session cleared after ${Date.now() - t0} ms`)
  // Load the model HERE, before reporting the session as started, rather than
  // lazily on the first segment. Previously startSession only wired up a
  // segmenter, so it resolved instantly against a worker with no model loaded
  // -  which happens whenever this worker respawned after a crash or timeout,
  // since the preload that warmed it ran in the dead thread's module state.
  // The renderer then showed a running recording while the first segment
  // silently triggered a multi-hundred-MB load, and nothing appeared for a
  // minute or more. Awaiting it here means "session started" genuinely means
  // "ready to transcribe", progress events reach the UI while it happens, and
  // a failure surfaces as a failed start instead of a dead recording.
  const tModel = Date.now()
  await getTranscriber(emitProgress)
  diag(`startSession: transcriber ready after ${Date.now() - tModel} ms (total ${Date.now() - t0} ms)`)
  let seq = 0
  let queue = Promise.resolve()
  let lastText = ''
  let queueBusy = false
  let interimBusy = false
  let skippedInterims = 0
  // Resolves when any in-flight preview finishes. A final segment must wait
  // on this: previews and finals share ONE transformers.js pipeline, and the
  // interim path guards itself against the queue (queueBusy) while the queue
  // never guarded itself against a running preview. So a segment closing
  // mid-preview started a second concurrent inference on the same ONNX
  // session, which is not safe to call re-entrantly and serialises badly
  // inside the runtime rather than actually overlapping.
  let interimPromise = Promise.resolve()
  let samplesFed = 0
  let lastFeedLog = Date.now()

  const segmenter = new PcmSegmenter(
    (segment, meanRms) => {
      const mySeq = ++seq
      const secs = (segment.length / SAMPLE_RATE).toFixed(1)
      diag(`segment ${mySeq} closed after ${secs}s of speech (meanRms ${meanRms.toFixed(4)}), queued`)
      queueBusy = true
      const tQueued = Date.now()
      queue = queue.then(async () => {
        try {
          await interimPromise.catch(() => {})
          const tStart = Date.now()
          const transcriber = await getTranscriber(emitProgress)
          const result = await transcriber(segment)
          diag(`segment ${mySeq} transcribed in ${Date.now() - tStart} ms (waited ${tStart - tQueued} ms)`)
          let text = (result?.text ?? '').trim()
          const normalized = text.toLowerCase()
          if (meanRms < LOW_ENERGY_RMS && HALLUCINATION_BLOCKLIST.has(normalized)) text = ''
          if (text && normalized === lastText.toLowerCase()) text = '' // collapse repeats
          if (text) {
            lastText = text
            onTranscript({ seq: mySeq, text })
          }
        } catch (err) {
          console.error('[demist] transcription segment failed:', err?.message ?? err)
        } finally {
          queueBusy = false
        }
      })
    },
    onInterim && ((segment) => {
      // Best-effort only, never queued: this shares the same underlying
      // model/session as final-segment transcription above, so it must
      // never run concurrently with it (queueBusy) or with a previous,
      // still-running interim tick (interimBusy). Skipping a tick is
      // harmless - the next one (or the real final segment) follows shortly
      // regardless - whereas queuing interim calls behind finals would
      // delay the finals for a feature that only exists to feel faster.
      if (queueBusy || interimBusy) {
        skippedInterims++
        return
      }
      interimBusy = true
      const tInterim = Date.now()
      interimPromise = getTranscriber(emitProgress)
        .then(transcriber => transcriber(segment))
        .then(result => {
          const text = (result?.text ?? '').trim()
          diag(`preview of ${(segment.length / SAMPLE_RATE).toFixed(1)}s in ${Date.now() - tInterim} ms${skippedInterims ? ` (${skippedInterims} skipped while busy)` : ''}`)
          skippedInterims = 0
          if (text) onInterim({ seq: seq + 1, text })
        })
        .catch(err => console.error('[demist] interim transcription failed:', err?.message ?? err))
        .finally(() => { interimBusy = false })
    }),
  )

  const session = {
    // Audio actually reaching the segmenter, so "no transcript" can be told
    // apart from "no audio". Once every 10s, so it stays cheap.
    feed: (pcm) => {
      samplesFed += pcm.length
      const now = Date.now()
      if (now - lastFeedLog >= 10000) {
        diag(`audio in: ${(samplesFed / SAMPLE_RATE).toFixed(1)}s fed over ${((now - t0) / 1000).toFixed(1)}s wall clock`)
        lastFeedLog = now
      }
      segmenter.feed(pcm)
    },
    stop: async () => {
      segmenter.flush()
      await queue // let in-flight segments finish so final words aren't lost
      // Only clear if this is still the live session. stopSession() is async
      // and startSession() above calls it WITHOUT awaiting, so a new session
      // starting while the previous one is still draining its queue used to
      // be wiped out by that older stop() resolving afterwards: activeSession
      // went null under a session that had just started, and every feedPcm
      // call from then on was silently discarded. Starting a second recording
      // shortly after ending the first is the normal way to hit this.
      if (activeSession === session) activeSession = null
    },
  }
  activeSession = session
  return true
}

function feedPcm(pcmFloat32) {
  if (activeSession) activeSession.feed(pcmFloat32)
}

async function stopSession() {
  if (activeSession) await activeSession.stop()
}

// Warm the model outside a session (used by the settings screen so the
// download happens there, with visible progress, not mid-lecture).
async function preload(emitProgress) {
  await getTranscriber(emitProgress)
  return getTier()
}

module.exports = { startSession, feedPcm, stopSession, preload, getTier, setTier }

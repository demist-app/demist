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
const { PcmSegmenter } = require('./pcm-segmenter')

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

function getTier() {
  try {
    const tier = JSON.parse(fsSync.readFileSync(TIER_FILE, 'utf8')).tier
    return MODEL_BY_TIER[tier] ? tier : 'accurate'
  } catch {
    return 'accurate'
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
    const loadPromise = pipeline('automatic-speech-recognition', MODEL_BY_TIER[tier], {
      progress_callback: makeProgressLogger(`transcription model (${tier})`, emitProgress),
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

let activeSession = null

function startSession(onTranscript, emitProgress) {
  stopSession() // safety: a crashed renderer can leave one dangling
  let seq = 0
  let queue = Promise.resolve()
  let lastText = ''

  const segmenter = new PcmSegmenter((segment, meanRms) => {
    const mySeq = ++seq
    queue = queue.then(async () => {
      try {
        const transcriber = await getTranscriber(emitProgress)
        const result = await transcriber(segment)
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
      }
    })
  })

  activeSession = {
    feed: (pcm) => segmenter.feed(pcm),
    stop: async () => {
      segmenter.flush()
      await queue // let in-flight segments finish so final words aren't lost
      activeSession = null
    },
  }
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

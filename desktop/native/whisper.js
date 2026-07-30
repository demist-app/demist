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

// Transcription models ship INSIDE the app, and are loaded from here before
// anything reaches the network.
//
// Store certification failed 10.1.2.10 - "Product fails to load on-device
// model showing error message 'Couldn't load the transcription model'" - on a
// machine that had a working internet connection. Transcription is the primary
// functionality and it could not start at all without first pulling several
// hundred megabytes from Hugging Face. On a restricted, throttled or simply
// unlucky network that fails, and the app is not degraded, it is useless.
//
// Both tiers are bundled by scripts/fetch-models.mjs (315MB for the pair; the
// 2332MB/1027MB figures below are resident memory, not file size).
//
// __dirname is app.asar.unpacked/native in a packaged build - models/ is in
// asarUnpack for the same reason the native modules are, since onnxruntime
// reads these off the filesystem. In development the same relative path lands
// on desktop/models, so both cases take the identical code path.
env.allowLocalModels = true
env.localModelPath = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '..', 'models')
// Remote stays ENABLED as a fallback. If a bundled file is ever missing, or a
// future tier is added without being bundled, the app should degrade to
// downloading rather than refusing to transcribe.
env.allowRemoteModels = true

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

// When an inference last actually touched the model weights, from anywhere:
// the load-time warm-up, the idle keep-warm timer, a preview, or a real
// segment. Windows only trims pages that have gone untouched, so this is the
// thing the keep-warm timer in main.js is really managing, and how stale it
// is at startSession is the difference between a 2s warm-up and an 11s one.
//
// Deliberately NOT used to skip the warm-up. That was tried and measured: a
// session that skipped it because the weights looked warm pushed the same
// cost onto the first real segment, which then took 22.9-24.5s across three
// consecutive runs against 2.0s with the warm-up in place.
let lastInferenceAt = 0
const msSinceLastInference = () => Date.now() - lastInferenceAt
// Every call to the pipeline goes through here so nothing can forget to
// record it.
async function runInference(transcriber, audio, opts) {
  try {
    return await transcriber(audio, opts)
  } finally {
    lastInferenceAt = Date.now()
  }
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
      // It runs while the record button is still locked waiting on it.
      //
      // NOT on digital silence, which is what this used to do. Whisper stops
      // as soon as it predicts end-of-text, and on silence that is almost
      // immediately - so the decoder ran for ~zero steps and the
      // decoder-with-past graph, the one every real utterance spends all its
      // time in, was never built. The cost simply moved to the first real
      // segment of the first recording: measured at 6954 ms against 1742-2222
      // ms for every segment after it, landing precisely on the words a user
      // is waiting to see appear.
      //
      // min_new_tokens forces the decode loop to actually run, so the warm-up
      // pays for the graph build instead. The input is a cheap synthetic
      // formant-ish buzz rather than silence: what it transcribes to is
      // irrelevant and thrown away, it only has to be something the model
      // does not immediately give up on.
      try {
        const probe = new Float32Array(SAMPLE_RATE)
        for (let i = 0; i < probe.length; i++) {
          const t = i / SAMPLE_RATE
          probe[i] = 0.1 * (Math.sin(2 * Math.PI * 130 * t) + 0.5 * Math.sin(2 * Math.PI * 700 * t))
        }
        await runInference(transcriber, probe, { ...generationOpts(SAMPLE_RATE), min_new_tokens: 12 })
      } catch { /* warm-up only, ignore */ }
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

// Below this mean energy a closed segment is room tone, not speech, and is
// dropped WITHOUT being transcribed at all.
//
// The segmenter's own VAD requires a frame to exceed max(noiseFloor*3, 0.006)
// before it will open a segment, but a single spike - a key press, a breath, a
// chair - is enough to do that, and the segment then fills with the pre-roll,
// the hangover and whatever silence sat between. Its MEAN lands far below the
// threshold any individual frame had to clear. Measured over one real session:
// genuine speech segments came in at 0.0237-0.0424, while thirteen of
// twenty-five segments measured 0.0026-0.0050 - room tone, cleanly separated
// by roughly 5x from anything the user actually said.
//
// Transcribing those was doing active harm in three ways at once. Whisper
// hallucinates confidently on silence, so they produced the "Oh", "Oh no...",
// "five" fragments that appeared in the transcript as real lines. They cost
// 2-4 seconds of inference EACH, so over half the queue was garbage - which
// is what built the backlog that put transcription 50+ seconds behind. And
// because a preview is a guess at the segment still accumulating while a
// FINAL that arrives during a backlog belongs to a much older one, the
// preview row was replaced by unrelated older text and its own content
// resurfaced later, which is the line duplication that was reported.
//
// Set to the same 0.006 the VAD demands of a single frame: if a whole
// segment's average energy does not reach the bar one frame had to clear to
// open it, it was not speech. The existing HALLUCINATION_BLOCKLIST still
// handles the quieter-but-real case just above this line.
const SILENT_SEGMENT_RMS = 0.006

// Bounds on a single decode. Left unset, transformers.js uses the model's own
// generation_config.json, which for whisper-small.en is max_length: 448 with
// NO repetition guards at all (confirmed by reading the cached config). 448
// tokens is sized for Whisper's native 30-second window; this app never
// transcribes more than MAX_SEGMENT_MS (6s) plus pre-roll, so the default
// allows a decode roughly 4x longer than any legitimate segment could need.
//
// That ceiling is not theoretical. A real session logged
// "segment 2 transcribed in 103199 ms" for 2.7s of normal-level speech
// (meanRms 0.0432), against 3997ms/1970ms/3210ms for its neighbours - and
// because an inference blocks this worker's whole event loop, everything
// else posted to it waits that long too. That is measured: a control message
// sent mid-inference takes ~1100ms to be answered versus 0ms when idle, so a
// 103s inference is a 103s startSession, which is exactly what the renderer
// reported ("on-device session took 72826 ms to start") while the worker's
// own timing insisted the session started in 0ms.
//
// 15 tokens/second is generous for speech (fast English is ~4 words/sec at
// ~1.5 tokens/word, so ~6), and the +16 covers Whisper's forced prefix tokens
// and short segments. no_repeat_ngram_size blocks a decoder that has fallen
// into a loop from emitting the same 6-token phrase twice; 6 is long enough
// that ordinary repeated technical vocabulary passes untouched. Measured
// against seven inputs including pure silence, DC offset, white noise at two
// levels, mains hum and a clipping square wave: identical text, identical
// timing (within noise) on every one, so this costs nothing on the inputs it
// is not there for.
function generationOpts(sampleCount) {
  return {
    max_new_tokens: Math.min(448, Math.ceil((sampleCount / SAMPLE_RATE) * 15) + 16),
    no_repeat_ngram_size: 6,
  }
}

// An inference this much slower than real time is pathological, not merely a
// slow machine: healthy segments measure 2-4s for 2-6s of audio. Always
// printed, and with the text, because the text is what identifies a runaway
// decode on sight (a repetition loop is unmistakable) and the previous
// occurrence left nothing behind to diagnose from.
const SLOW_INFERENCE_RATIO = 8

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
  // Per-segment trace. One line every few seconds for the length of a lecture,
  // so it is hidden unless localStorage demist_debug is set; the lag warning
  // below is what a shipping build says when this actually matters.
  const vdiag = (m) => { if (process.env.DEMIST_DEBUG === '1') console.log(`[demist] ${m}`); emitDiag?.(m, true) }
  discardEmitter = (m) => emitDiag?.(m)
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
  const warmTranscriber = await getTranscriber(emitProgress)
  diag(`startSession: transcriber ready after ${Date.now() - tModel} ms (total ${Date.now() - t0} ms)`)

  // Pay the first-inference cost HERE, before reporting the session started.
  //
  // The first inference of a recording costs several times what every later
  // one does, even when the model has been resident for minutes: measured in
  // the child-process host, 6989 ms and 10317 ms for a 3.0s segment against
  // 1.7-2.2s for its neighbours in the same session. The weights are only
  // touched during inference, so Windows trims them out from under an idle
  // app and the next inference faults them back off disk - and left alone,
  // the inference that pays for that is the user's first sentence.
  //
  // Waiting a further 15s before starting the session did NOT avoid it (the
  // trimming has already happened by then), so there is nowhere to move this
  // cost except in front of the session. That is safe and nearly free in UX
  // terms: the renderer buffers PCM while startSession is outstanding and
  // flushes it the moment this resolves (see lib/nativeSession.ts), so
  // nothing said during it is lost - whereas the same seconds spent AFTER the
  // session is live are seconds of a lecture arriving late.
  //
  // ...but ONLY when the weights might actually be cold. Warming
  // unconditionally was measured at 11358 ms on a real machine, which is a
  // 14-second startSession and a renderer watchdog firing at 10s - it turned
  // the first-segment penalty into a startup penalty of the same size, for a
  // model that in the common case (the keep-warm timer has been running the
  // whole time the app sat idle) was already hot and needed nothing. The
  // pipeline is only warmed here if nothing has touched the weights recently.
  // This runs UNCONDITIONALLY, and an attempt to skip it when the weights
  // looked warm was measured and reverted. Skipping does not remove the
  // one-off cost, it relocates it onto the user's first spoken sentence, and
  // that is strictly worse - the same 3s segment measured 2052 ms with this
  // warm-up in front of it and 22917/23163/24508 ms across three consecutive
  // runs without it. Warming twice at app launch instead did not pay it down
  // either, so whatever it is, it is not satisfied by an earlier inference in
  // the same process; only an inference close in front of the session works.
  //
  // Cost here is genuinely free in UX terms - the renderer buffers PCM while
  // startSession is outstanding and flushes it the moment this resolves (see
  // lib/nativeSession.ts), so nothing said during it is lost, whereas the
  // same seconds spent after the session is live are a lecture arriving late.
  // What makes it CHEAP is main.js's keep-warm timer: warm, this measures
  // ~2s; on weights Windows has already trimmed it measured 11358 ms on a
  // real machine, which is what the 30s keep-warm interval exists to prevent.
  const tWarm = Date.now()
  try {
    // One second. Sizing this to match the first real segment (3s, so a
    // 61-token decode budget rather than 31) was tried on the theory that the
    // decode path was what stayed cold, and measured no different at all:
    // 25008 ms vs 24867 ms on the first segment. Left at 1s, which is cheaper.
    const n = SAMPLE_RATE
    const probe = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / SAMPLE_RATE
      probe[i] = 0.1 * (Math.sin(2 * Math.PI * 130 * t) + 0.5 * Math.sin(2 * Math.PI * 700 * t))
    }
    await runInference(warmTranscriber, probe, { ...generationOpts(n), min_new_tokens: 12 })
  } catch { /* warm-up only: a failure here must not stop a recording */ }
  const warmMs = Date.now() - tWarm
  diag(`startSession: weights warmed in ${warmMs} ms (total ${Date.now() - t0} ms)`
    + `${warmMs > 5000 ? ' <- COLD: the keep-warm timer is not keeping ahead of the OS trimming this model' : ''}`)
  let seq = 0
  let lastText = ''
  // How many segments are queued or in flight. This replaces a `queueBusy`
  // boolean that did not survive a backlog: it was set true where a segment
  // was ENQUEUED and set false in each queue item's finally, so as soon as
  // more than one segment was waiting, item 1 finishing cleared it and items
  // 2..N ran with it reading false. The preview guard below is the only thing
  // keeping previews off the shared ONNX session, so from the second queued
  // segment onwards it stopped guarding anything at all - previews then ran
  // concurrently with final transcription, which is exactly the re-entrancy
  // the guard exists to prevent. Seen in a real session: a 1.8s preview took
  // 22943 ms while 14 segments sat queued behind it, and because an inference
  // blocks this worker's event loop, incoming PCM stopped being read for the
  // duration (0.4s of audio accepted across 25s of wall clock, then a 49s
  // burst once it drained). A counter cannot go stale the way the flag did.
  let queueDepth = 0
  let interimBusy = false
  let skippedInterims = 0
  // Median-ish estimate of what ONE inference costs on this machine, used to
  // tune the forced cut and to decide whether previews are affordable. Seeded
  // pessimistically so nothing expensive is attempted before there is a
  // measurement: the first real final replaces it.
  const inferenceMs = []
  const typicalInferenceMs = () => {
    if (!inferenceMs.length) return null
    const sorted = [...inferenceMs].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  // Previews are a nice-to-have that costs a FULL inference, on the same
  // worker and the same ONNX session that real transcription needs. They are
  // only worth running while this machine is comfortably faster than real
  // time. Measured in a shipped session: "preview of 1.8s in 26154 ms" and
  // "preview of 1.5s in 13289 ms" - each one blocking the worker for that
  // whole time, so no PCM was read, no segment could close, and the recording
  // fell tens of seconds behind. The feature exists to make text appear
  // SOONER and was doing the exact opposite.
  //
  // So: measure, and switch them off for the rest of the session the moment
  // this machine proves it cannot afford them. Turned off permanently rather
  // than per-call because a machine that was slow once is slow, and flapping
  // would just re-block the worker every few seconds.
  // Previews now start OFF and have to be EARNED. This is the single change
  // that fixes the reported "transcription appears after 45-50 seconds", and
  // the old default of `true` is precisely what caused it.
  //
  // Measured on the shipping topology (test/realtime-in-electron.js, real
  // speech at real time through a real Electron main process):
  //
  //   the FIRST preview of a session took 11322 ms
  //   and blocked this worker's event loop for 10652 ms of that
  //
  // Nothing else can run on this thread while that happens, so no PCM is read
  // for ten seconds. By the time it finished, two whole segments' worth of
  // audio had piled up unread, and the recording started ten seconds in debt
  // before it had transcribed a single word. The session never catches that
  // up, because previews keep firing whenever the queue happens to be empty.
  // The renderer log in the bug report shows exactly this signature:
  // "audio in: 2.8s fed over 14.2s wall clock".
  //
  // The old code did have a budget check - but it only ran AFTER a preview
  // completed, so the machine was judged by the very inference that had
  // already done the damage. A guard that can only fire once the harm is done
  // is not a guard. Now the machine has to prove it is comfortably faster than
  // real time on REAL segments first, and previews are still abandoned
  // permanently the moment it stops being true.
  //
  // The bar is deliberately high. One inference costs the same whatever length
  // of audio it is given (Whisper pads to 30s), so a preview is not a cheap
  // extra - it is a whole second transcription. Measured under Electron:
  // whisper-small.en q8 takes ~2.5s for a 6s segment (42% duty) but ~2.8s for
  // a 1.7s preview, so turning previews on roughly DOUBLES the load for text
  // that is about to be overwritten and is often wrong anyway (see
  // pcm-segmenter.js's INTERIM_FIRST_MS note).
  let previewsEnabled = false
  let previewsBanned = false
  let fastFinals = 0
  const disablePreviews = (why) => {
    previewsBanned = true
    if (!previewsEnabled) return
    previewsEnabled = false
    console.warn(`[demist] live preview disabled for this recording: ${why}. Final transcription is unaffected and will now get the whole machine.`)
    diag(`previews disabled: ${why}`)
  }
  // An inference slower than this multiple of the audio it covers means the
  // machine cannot keep up with previews on top of real work. 1.5x leaves
  // room for an ordinary slow segment without tripping.
  // Overridable so the behaviour can be tested on a machine that is fast
  // enough never to trip it naturally - which is most development machines,
  // and is why a test written without this hook passed vacuously.
  const PREVIEW_BUDGET_RATIO = Number(process.env.DEMIST_PREVIEW_BUDGET_RATIO) || 1.5
  // To EARN previews a machine must transcribe finals in under this fraction
  // of the audio they cover, this many times in a row. 0.5 means "at least 2x
  // faster than real time", which is the headroom needed to absorb a second
  // full inference per segment without falling behind. This machine measures
  // 0.42 under Electron with a following wind and 0.6-1.0 when anything else
  // is running, so it correctly earns previews only when genuinely idle.
  const PREVIEW_EARN_RATIO = Number(process.env.DEMIST_PREVIEW_EARN_RATIO) || 0.5
  const PREVIEW_EARN_STREAK = 2
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
  // Rate-limits the lag warning below: once every 30s is enough to tell the
  // story without becoming the flood it replaced.
  let lastLagWarnAt = 0

  // Segments waiting to be transcribed, and the drain loop that transcribes
  // them - coalescing whatever has piled up into ONE inference.
  //
  // This exists because Whisper's cost does not scale with how much audio you
  // hand it. It pads every input to its 30-second window, so the encoder does
  // the same work either way. Measured on this exact model and dtype, best of
  // three runs each:
  //
  //     1.2s of audio -> 1600 ms    (1333 ms per second of audio)
  //       6s of audio -> 1531 ms     (255 ms per second of audio)
  //      25s of audio -> 1579 ms      (63 ms per second of audio)
  //
  // Flat. So transcribing seven short segments separately costs seven full
  // inferences, while the same audio in one call costs one. A real session
  // did exactly that: seven segments totalling 19.5s of speech, ~3.4s of
  // inference each, ~24s of work for 19.5s of audio - permanently slower than
  // real time, so the backlog could only grow, and it reached 45 seconds. The
  // same audio coalesced is a single ~1.6s inference.
  //
  // Latency is not traded away for this. When nothing is waiting - the normal
  // live case - a segment is transcribed alone the instant it closes, exactly
  // as before. Coalescing only engages once there IS a backlog, which is
  // precisely when throughput matters more than the granularity of one row.
  const backlog = []
  let draining = false
  let drainPromise = Promise.resolve()
  // Whisper's window is 30s. Cap the merged audio below that with room for
  // the joining gaps, so a batch can never be silently truncated.
  const COALESCE_MAX_SAMPLES = SAMPLE_RATE * 25
  // A short silence between merged segments. They were cut at natural pauses,
  // so butting them together would run the last word of one into the first of
  // the next; this restores a pause Whisper can hear.
  const JOIN_GAP_SAMPLES = Math.round(SAMPLE_RATE * 0.25)

  // A segment that the segmenter marked `contiguous` begins at the exact
  // sample the previous one ended on: the forced cut landed mid-sentence and
  // speech simply carried on. Re-joining those two with a gap would insert a
  // pause into the middle of a word, which is worse than the boundary the cut
  // created in the first place. Only a genuine pause between segments gets the
  // JOIN_GAP. This matters far more now that the forced cut is tuned down
  // towards 2.5-4s, because mid-sentence cuts became the common case.
  const gapBefore = (item) => (item.contiguous ? 0 : JOIN_GAP_SAMPLES)

  function takeBatch() {
    const batch = [backlog.shift()]
    let total = batch[0].segment.length
    while (backlog.length && total + gapBefore(backlog[0]) + backlog[0].segment.length <= COALESCE_MAX_SAMPLES) {
      total += gapBefore(backlog[0]) + backlog[0].segment.length
      batch.push(backlog.shift())
    }
    if (batch.length === 1) return { batch, audio: batch[0].segment }
    const audio = new Float32Array(total)
    let off = 0
    for (let i = 0; i < batch.length; i++) {
      if (i > 0) off += gapBefore(batch[i]) // leave zeros: that IS the gap
      audio.set(batch[i].segment, off)
      off += batch[i].segment.length
    }
    return { batch, audio }
  }

  // Point the forced cut at what this machine actually measures.
  //
  // The cut length sets the floor on latency all by itself: a word spoken one
  // second into a 6s segment cannot even begin transcribing for another five.
  // But cutting faster than the machine can transcribe just builds a backlog,
  // so the right cut is about one inference long - short enough to be
  // responsive, long enough that at zero backlog each segment still gets its
  // own call. 1.6x leaves ~37% headroom for a slow one.
  //
  // Measured under Electron: whisper-small.en q8 takes ~2.5s per call, so this
  // settles at ~4s instead of 6s and takes worst-case lag from ~8.5s to ~6.5s.
  // On a machine that manages 1.5s per call it settles at the 2.5s floor.
  const SEGMENT_PER_INFERENCE = 1.6
  let tunedMs = null
  function tuneSegmentLength(took) {
    inferenceMs.push(took)
    if (inferenceMs.length > 9) inferenceMs.shift()
    if (inferenceMs.length < 2) return
    const target = Math.round(typicalInferenceMs() * SEGMENT_PER_INFERENCE)
    const applied = segmenter.setMaxSegmentMs(target)
    if (applied !== tunedMs) {
      tunedMs = applied
      diag(`forced cut retuned to ${applied} ms (typical inference ${typicalInferenceMs()} ms)`)
    }
  }

  // drain() must be awaitable by stop() even when a drain is ALREADY running,
  // so it hands back the in-flight run rather than returning immediately -
  // otherwise stopping mid-batch would resolve straight away and the last
  // words of a recording would be lost.
  function drain() {
    if (!draining) drainPromise = runDrain()
    return drainPromise
  }

  async function runDrain() {
    draining = true
    try {
      while (backlog.length) {
        // A preview shares this one ONNX session and must never overlap.
        await interimPromise.catch(() => {})
        // Hand the event loop back before starting the next inference.
        // Awaiting a promise only drains MICROtasks; an incoming
        // startSession/stopSession arrives as a worker 'message', which is a
        // macrotask, so a run of segments would otherwise transcribe back to
        // back without ever letting one through. setImmediate is a macrotask,
        // so a control message sitting in the queue is delivered here, between
        // batches, instead of after all of them.
        await new Promise((resolve) => setImmediate(resolve))
        const { batch, audio } = takeBatch()
        const label = batch.length === 1
          ? `segment ${batch[0].seq}`
          : `segments ${batch[0].seq}-${batch[batch.length - 1].seq} coalesced`
        const tStart = Date.now()
        try {
          const transcriber = await getTranscriber(emitProgress)
          const result = await runInference(transcriber, audio, generationOpts(audio.length))
          const took = Date.now() - tStart
          const audioSecs = audio.length / SAMPLE_RATE
          // How far behind the speaker this text is landing, end to end: from
          // the moment the last segment in this batch closed to the moment its
          // words are ready. THIS is the number the bug report is about, and
          // nothing in the pipeline was measuring it - every existing counter
          // measured throughput, which stayed healthy while latency did not.
          const lagMs = Date.now() - batch[batch.length - 1].tQueued
          vdiag(
            `${label} (${audioSecs.toFixed(1)}s) transcribed in ${took} ms `
            + `(waited ${tStart - batch[0].tQueued} ms, ${backlog.length} still queued) `
            + `| transcript is ${(lagMs / 1000).toFixed(1)}s behind the speaker`,
          )
          // Quiet when healthy, loud when not. The per-segment line above is a
          // trace and is hidden in a shipping build, so this is what a normal
          // user's console says when the thing this whole investigation was
          // about - the transcript drifting behind the speaker - is happening
          // to them. Healthy measures 1.6-2.5s; 8s means a real backlog, not a
          // slow segment.
          if (lagMs > 8000 && Date.now() - lastLagWarnAt > 30_000) {
            lastLagWarnAt = Date.now()
            console.warn(
              `[demist] transcription is ${(lagMs / 1000).toFixed(1)}s behind the speaker `
              + `(${backlog.length} segments queued, last inference ${took} ms for ${audioSecs.toFixed(1)}s of audio). `
              + `Set localStorage demist_debug = '1' for the full per-segment trace.`,
            )
          }
          tuneSegmentLength(took)
          // The honest measure of whether this machine can afford previews.
          if (took > audioSecs * 1000 * PREVIEW_BUDGET_RATIO) {
            disablePreviews(`transcribing ${audioSecs.toFixed(1)}s took ${took} ms, slower than real time`)
          } else if (!previewsBanned && batch.length === 1 && took <= audioSecs * 1000 * PREVIEW_EARN_RATIO) {
            // Only a single-segment batch counts towards earning previews: a
            // coalesced batch is cheap per second of audio by construction
            // (Whisper's cost is flat in length), so judging the machine on one
            // would let a struggling laptop earn previews out of its own
            // backlog - the exact moment it can least afford them.
            if (++fastFinals >= PREVIEW_EARN_STREAK && !previewsEnabled) {
              previewsEnabled = true
              diag(`previews enabled: ${fastFinals} finals in a row under ${PREVIEW_EARN_RATIO}x real time`)
            }
          } else {
            fastFinals = 0
          }
          if (took > audioSecs * 1000 * SLOW_INFERENCE_RATIO) {
            console.warn(
              `[demist] SLOW transcription: ${label} was ${audioSecs.toFixed(1)}s of audio but took ${took} ms. ` +
              `Everything else queued for this worker (including starting or stopping a session) waited on it. ` +
              `Text: ${JSON.stringify((result?.text ?? '').slice(0, 300))}`,
            )
          }
          let text = (result?.text ?? '').trim()
          const normalized = text.toLowerCase()
          // The blocklist is an energy judgement about ONE utterance, so it
          // only applies when the batch is one segment; a merged batch is
          // loud by construction (every member cleared SILENT_SEGMENT_RMS).
          if (batch.length === 1 && batch[0].meanRms < LOW_ENERGY_RMS && HALLUCINATION_BLOCKLIST.has(normalized)) text = ''
          if (text && normalized === lastText.toLowerCase()) text = '' // collapse repeats
          if (text) {
            lastText = text
            onTranscript({ seq: batch[batch.length - 1].seq, text })
          }
        } catch (err) {
          console.error('[demist] transcription segment failed:', err?.message ?? err)
        } finally {
          queueDepth -= batch.length
        }
      }
    } finally {
      draining = false
    }
  }

  const segmenter = new PcmSegmenter(
    (segment, meanRms, contiguous) => {
      const secs = (segment.length / SAMPLE_RATE).toFixed(1)
      // Checked BEFORE the sequence number is taken, so a dropped segment
      // never occupies an ordering slot the renderer is waiting on.
      if (meanRms < SILENT_SEGMENT_RMS) {
        vdiag(`segment dropped: ${secs}s at meanRms ${meanRms.toFixed(4)} is room tone, not speech (below ${SILENT_SEGMENT_RMS})`)
        return
      }
      const mySeq = ++seq
      vdiag(`segment ${mySeq} closed after ${secs}s of speech (meanRms ${meanRms.toFixed(4)}), queued`)
      backlog.push({ seq: mySeq, segment, meanRms, secs, contiguous, tQueued: Date.now() })
      queueDepth++
      drain()
    },
    onInterim && ((segment) => {
      // Best-effort only, never queued: this shares the same underlying
      // model/session as final-segment transcription above, so it must never
      // run concurrently with it (queueDepth) or with a previous,
      // still-running interim tick (interimBusy). Skipping a tick is
      // harmless - the next one (or the real final segment) follows shortly
      // regardless - whereas queuing interim calls behind finals would
      // delay the finals for a feature that only exists to feel faster.
      //
      // queueDepth, not "is one running": ANY outstanding segment means real
      // transcript text is already waiting on this pipeline, and a preview
      // that delays it is strictly harmful. When transcription is running
      // slower than real time the backlog only grows, so this is exactly when
      // previews must get out of the way - a real session had 17 segments
      // queued while previews were still being issued.
      if (!previewsEnabled) return
      if (queueDepth > 0 || interimBusy) {
        skippedInterims++
        return
      }
      interimBusy = true
      const tInterim = Date.now()
      interimPromise = getTranscriber(emitProgress)
        .then(transcriber => runInference(transcriber, segment, generationOpts(segment.length)))
        .then(result => {
          const text = (result?.text ?? '').trim()
          const previewMs = Date.now() - tInterim
          diag(`preview of ${(segment.length / SAMPLE_RATE).toFixed(1)}s in ${previewMs} ms${skippedInterims ? ` (${skippedInterims} skipped while busy)` : ''}`)
          skippedInterims = 0
          // A preview that took longer than the audio it covers has already
          // cost more than it is worth, and it blocked the worker for that
          // whole time. One is enough to know.
          const previewSecs = segment.length / SAMPLE_RATE
          if (previewMs > previewSecs * 1000 * PREVIEW_BUDGET_RATIO) {
            disablePreviews(`a ${previewSecs.toFixed(1)}s preview took ${previewMs} ms`)
          }
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
        vdiag(`audio in: ${(samplesFed / SAMPLE_RATE).toFixed(1)}s fed over ${((now - t0) / 1000).toFixed(1)}s wall clock`)
        lastFeedLog = now
      }
      segmenter.feed(pcm)
    },
    stop: async () => {
      segmenter.flush()
      // Let everything still queued finish so final words aren't lost. flush()
      // above can itself close one last segment, which drain() picks up, so
      // this waits for the loop to actually run dry rather than for a single
      // promise captured at one instant.
      await drain()
      await interimPromise.catch(() => {})
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

// Frames arriving with no live session are DISCARDED, and used to be
// discarded in complete silence - indistinguishable downstream from audio
// that was never captured. That silence is worth a counter: it is exactly
// what a replacement worker (after a crash) or a stale session looks like.
let discardedFrames = 0
let lastDiscardLog = 0
// Set by startSession so the discard warning can reach the renderer console.
// It was console.warn only, i.e. main-process stdout, which is invisible
// without a terminal - the clearest possible explanation for "audio arrives
// and then vanishes" was being written somewhere nobody was looking.
let discardEmitter = null
function feedPcm(pcmFloat32) {
  if (activeSession) { activeSession.feed(pcmFloat32); return }
  discardedFrames++
  const now = Date.now()
  if (now - lastDiscardLog >= 5000) {
    lastDiscardLog = now
    const msg = `${discardedFrames} PCM frames discarded: audio is arriving at this worker but NO SESSION is active on it`
    console.warn(`[demist] ${msg}`)
    discardEmitter?.(msg)
    discardedFrames = 0
  }
}

async function stopSession() {
  if (activeSession) await activeSession.stop()
}

// One inference over a block of audio that is ALREADY complete, for importing
// a recorded file rather than following a live microphone.
//
// Deliberately not routed through startSession/feedPcm/the segmenter. All of
// that machinery exists to solve a problem a file does not have: it cuts at
// natural pauses because it cannot see the future, it paces itself against the
// clock because audio is still being spoken, and main.js's PCM bridge bounds
// its queue at ~20 seconds because a live recording that falls behind must drop
// something. Push a 50-minute file through that and it takes 50 minutes and
// silently drops most of it once the queue bound is hit.
//
// A file can instead be transcribed as fast as the machine manages, because
// Whisper's cost is FLAT in the length of audio it is handed (measured in this
// same file: 1.2s of audio -> 1600ms, 25s of audio -> 1579ms; it pads
// everything to its 30-second window either way). So the whole file goes
// through in one inference per window: a 50-minute lecture is ~120 windows at
// ~1.6s each, about three minutes, instead of fifty.
//
// The caller does the windowing (see web/lib/nativeImport.ts) so it can report
// progress and keep only one window's PCM in flight at a time.
async function transcribeBuffer(pcmFloat32, emitProgress) {
  if (!pcmFloat32?.length) return ''
  const transcriber = await getTranscriber(emitProgress)
  const result = await runInference(transcriber, pcmFloat32, generationOpts(pcmFloat32.length))
  const text = (result?.text ?? '').trim()
  // The same energy judgement the live path makes, for the same reason:
  // Whisper hallucinates confidently on silence, and an imported file has
  // plenty of it (a gap between slides, a room before the lecturer starts).
  let sum = 0
  for (let i = 0; i < pcmFloat32.length; i++) sum += pcmFloat32[i] * pcmFloat32[i]
  const rms = Math.sqrt(sum / pcmFloat32.length)
  if (rms < SILENT_SEGMENT_RMS) return ''
  if (rms < LOW_ENERGY_RMS && HALLUCINATION_BLOCKLIST.has(text.toLowerCase())) return ''
  return text
}

// Warm the model outside a session (used by the settings screen so the
// download happens there, with visible progress, not mid-lecture).
async function preload(emitProgress) {
  await getTranscriber(emitProgress)
  return getTier()
}

// Touch the model's WEIGHTS while idle, so the first inference of a session is
// not the one that pays to fault them back off disk.
//
// The keep-warm ping in main.js keeps this thread's own stack and heap in the
// working set, but the weights are only touched during inference, so they get
// trimmed independently. The signature is unmistakable in a real session: the
// FIRST preview took 17191 ms while every later one took 2787 and 3150 ms,
// same model, same audio length, minutes apart. That first-inference penalty
// lands exactly when a user is waiting to see their first words appear.
//
// Refuses to run during a session (an inference here would block the worker
// while real audio is arriving) and never loads anything - if no transcriber
// has been built yet there is nothing to keep warm, and building one here
// would be a surprise multi-hundred-MB load nobody asked for.
async function keepWarm() {
  if (activeSession) return false
  const tier = getTier()
  if (!transcribersByTier.has(tier)) return false
  const transcriber = await transcribersByTier.get(tier)
  if (activeSession) return false // a session may have started while we waited
  // Half a second. Whisper pads every input to its 30s window, so a shorter
  // clip costs essentially the same as a longer one - the point is to touch
  // the weights, not to transcribe anything. min_new_tokens for the same
  // reason as the warm-up above: on silence the decoder returns immediately
  // and the decoder-with-past weights, which are most of them, stay cold.
  const n = SAMPLE_RATE / 2
  const probe = new Float32Array(n)
  for (let i = 0; i < n; i++) probe[i] = 0.1 * Math.sin(2 * Math.PI * 130 * (i / SAMPLE_RATE))
  const t = Date.now()
  const idleFor = msSinceLastInference()
  await runInference(transcriber, probe, { ...generationOpts(n), min_new_tokens: 12 })
  // Reported because it is the only window onto whether the keep-warm cadence
  // is actually keeping up with the OS. This inference is identical every
  // time, so it should measure the same every time; one that suddenly takes
  // many seconds means the weights had ALREADY been trimmed and the interval
  // in main.js is too slow for this machine.
  const took = Date.now() - t
  if (took > 4000) {
    console.warn(
      `[demist] keep-warm inference took ${took} ms after ${idleFor} ms idle - the weights had already been trimmed, `
      + `so the keep-warm interval in main.js is too slow for this machine and the next recording will start slowly`,
    )
  }
  return took
}

module.exports = { startSession, feedPcm, stopSession, transcribeBuffer, preload, keepWarm, getTier, setTier }

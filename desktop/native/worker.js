// desktop/native/worker.js: FULL REPLACEMENT
// Same role as before (heavy native work off Electron's main thread), with
// two additions: an event channel for push-style messages (live transcript
// segments, model download progress) alongside the existing request/response
// calls, and zero-copy PCM feeding via transferList.

const { parentPort, threadId } = require('worker_threads')

function emitEvent(event, payload) {
  parentPort.postMessage({ event, payload })
}
const emitProgress = (label, pct, file) => emitEvent('modelProgress', { label, pct, file })

let whisper, translate, llm
const handlers = {
  // Keep-alive (see the keepWorkersWarm comment in main.js). Deliberately
  // does nothing at all: touching this thread's stack and heap on a timer is
  // the entire point, so it must not read a file, allocate, or run inference.
  ping: () => true,

  // Live transcription session (new)
  startSession: () => (whisper ??= require('./whisper')).startSession(
    (t) => emitEvent('transcript', t),
    emitProgress,
    (t) => emitEvent('interimTranscript', t),
    // Native-side timing, forwarded to the renderer's console. Everything
    // this file logs normally goes to the main process's stdout, invisible
    // unless the app was launched from a terminal, which is why the cause of
    // a slow startSession has been so hard to pin down from a screenshot.
    (message) => emitEvent('diag', { message }),
  ),
  stopSession: () => (whisper ??= require('./whisper')).stopSession(),
  // Deliberately does NOT require('./whisper'): if this worker has never
  // loaded the transcriber there is nothing to keep warm, and loading one
  // from a background timer would be a surprise multi-hundred-MB load.
  keepWhisperWarm: () => whisper ? whisper.keepWarm() : false,
  preloadWhisper: () => (whisper ??= require('./whisper')).preload(emitProgress),
  preloadTermDetection: () => (llm ??= require('./llm')).preload(emitProgress),
  preloadTranslation: (lang) => (translate ??= require('./translate')).preload(lang, emitProgress),

  // Existing request/response surface
  translate: (text, targetLang) => (translate ??= require('./translate')).translate(text, targetLang, emitProgress),
  detectTerms: (transcript, context, subject, year) =>
    (llm ??= require('./llm')).detectTerms(transcript, context, subject, year, emitProgress),
  summarize: (termRows, subject) => (llm ??= require('./llm')).summarize(termRows, subject),
  getModelTier: () => (llm ??= require('./llm')).getTier(),
  setModelTier: (tier) => (llm ??= require('./llm')).setTier(tier),
  getTranscribeTier: () => (whisper ??= require('./whisper')).getTier(),
  setTranscribeTier: (tier) => (whisper ??= require('./whisper')).setTier(tier),
}

// Counted at the very edge of the worker, before anything can discard them.
// Every other counter in the chain sits further in, so a message that reached
// this thread and was then dropped looked identical to one that never arrived.
// Event-loop lag for THIS thread. "the worker is too busy to drain its queue"
// has been the working hypothesis for several rounds and has never once been
// measured in the real app - only inferred from a low receive rate, which is
// also what a hop that never delivered would look like. A 100ms timer that
// fires 20 seconds late says outright that this thread was blocked for 20
// seconds, and by how much, with no inference required.
let loopWorst = 0
let loopLast = Date.now()
setInterval(() => {
  const now = Date.now()
  const late = now - loopLast - 100
  if (late > loopWorst) loopWorst = late
  loopLast = now
}, 100).unref?.()

// Announce this thread the moment it exists. If PCM is going to one worker
// while a session lives on another, the give-away is a second "started" line
// appearing mid-recording.
emitEvent('diag', { message: `worker[${threadId}] started` })

let pcmMessages = 0
let pcmSamples = 0
let lastPcmLog = Date.now()
// Which of main's messages this thread actually saw. main stamps a monotonic
// mseq on every PCM message it posts, so the SHAPE of the loss is visible:
// contiguous numbers with a gap at the end means the receiver changed, every
// Nth number means something is throttling, and a full run means no loss.
let firstMseq = null
let lastMseq = null

// Every message arriving at this thread, counted BEFORE any branch or any
// parsing. The previous counter sat inside `if (msg.type === 'pcm')` and after
// `new Float32Array(msg.buffer)`, which meant two failure modes were counted
// as "never arrived", and both are silent:
//
//   1. msg.type is not 'pcm' -> falls to the handler branch, handlers[undefined]
//      throws, and the reply carries id undefined, which main's
//      pending.get(undefined) discards without a word.
//   2. new Float32Array(msg.buffer) throws (e.g. a byteLength that is not a
//      multiple of 4) -> this handler is async, so it becomes an unhandled
//      rejection and the counter below is never reached.
//
// main reports posting 9.8/sec to this exact threadId with nothing thrown and
// this thread reports 0.6/sec while idle. Those cannot both be true of the
// same messages, so the count has to happen before anything can swallow one.
let rawMessages = 0
let pcmTyped = 0
let badFrames = 0
let lastBadReason = ''
const typeTally = new Map()

parentPort.on('message', async (msg) => {
  rawMessages++
  const t = msg && typeof msg === 'object' ? String(msg.type) : `NOT-AN-OBJECT(${typeof msg})`
  typeTally.set(t, (typeTally.get(t) || 0) + 1)
  // PCM frames are fire-and-forget and high-frequency: no id, no reply.
  if (msg.type === 'pcm') {
    pcmTyped++
    let frame
    try {
      frame = new Float32Array(msg.buffer)
    } catch (err) {
      // Silent until now: an async handler that throws here produces an
      // unhandled rejection and the frame simply vanishes.
      badFrames++
      lastBadReason = `${err?.message ?? err} (byteLength ${msg.buffer && msg.buffer.byteLength})`
      return
    }
    // Start the window at the FIRST frame, not at module load. Initialising it
    // at load meant the first report divided by however long the app had been
    // idle - the same mistake main.js's bridge counter made, where it reported
    // 0.1/sec for a hop genuinely carrying 10/sec and sent the investigation
    // after the wrong component entirely.
    if (pcmMessages === 0) { lastPcmLog = Date.now(); firstMseq = msg.mseq ?? null }
    lastMseq = msg.mseq ?? null
    pcmMessages++
    pcmSamples += frame.length
    const now = Date.now()
    if (now - lastPcmLog >= 5000) {
      const secs = (now - lastPcmLog) / 1000
      emitEvent('diag', {
        message: `worker[${threadId}] received ${(pcmMessages / secs).toFixed(1)} pcm msgs/sec `
          + `(${(pcmSamples / 16000).toFixed(1)}s of audio) over the last ${secs.toFixed(0)}s`
          + ` | saw main's mseq ${firstMseq}..${lastMseq}`
          + `${firstMseq != null && lastMseq != null
              ? ` = ${pcmMessages} of the ${lastMseq - firstMseq + 1} main posted in that range`
                + (lastMseq - firstMseq + 1 > pcmMessages + 2 ? ' <- GAPS: main posted more than this thread received' : ' <- no gaps: this thread got everything main sent it')
              : ''}`
          + ` | this thread saw ${rawMessages} messages of ALL types in that window `
          + `(${[...typeTally].map(([k, v]) => `${k}:${v}`).join(', ')})`
          + `${badFrames ? ` | ${badFrames} PCM frames FAILED to parse [${lastBadReason}]` : ''}`
          + ` | worker event-loop worst stall ${loopWorst}ms`
          + `${loopWorst > 1000 ? ' <- THIS THREAD WAS BLOCKED, which is why it did not drain its queue' : ''}`,
      })
      pcmMessages = 0; pcmSamples = 0; lastPcmLog = now; loopWorst = 0; firstMseq = null; lastMseq = null
      rawMessages = 0; pcmTyped = 0; badFrames = 0; typeTally.clear()
    }
    ;(whisper ??= require('./whisper')).feedPcm(frame)
    return
  }
  const { id, type, args } = msg
  if (typeof handlers[type] !== 'function') {
    // Previously this called handlers[undefined](), threw, and replied with an
    // id of undefined - which main's pending map drops on the floor. A message
    // that arrived and was thrown away looked exactly like one that was never
    // sent, which is the ambiguity this whole investigation kept running into.
    emitEvent('diag', {
      message: `worker[${threadId}] got an UNROUTABLE message: type=${JSON.stringify(type)} `
        + `keys=${JSON.stringify(Object.keys(msg))} - it has been discarded`,
    })
    return
  }
  try {
    const result = await handlers[type](...(args ?? []))
    parentPort.postMessage({ id, result })
  } catch (err) {
    parentPort.postMessage({ id, error: err?.message ?? String(err) })
  }
})

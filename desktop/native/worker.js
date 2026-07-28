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

let pcmMessages = 0
let pcmSamples = 0
let lastPcmLog = Date.now()

parentPort.on('message', async (msg) => {
  // PCM frames are fire-and-forget and high-frequency: no id, no reply.
  if (msg.type === 'pcm') {
    const frame = new Float32Array(msg.buffer)
    // Start the window at the FIRST frame, not at module load. Initialising it
    // at load meant the first report divided by however long the app had been
    // idle - the same mistake main.js's bridge counter made, where it reported
    // 0.1/sec for a hop genuinely carrying 10/sec and sent the investigation
    // after the wrong component entirely.
    if (pcmMessages === 0) lastPcmLog = Date.now()
    pcmMessages++
    pcmSamples += frame.length
    const now = Date.now()
    if (now - lastPcmLog >= 5000) {
      const secs = (now - lastPcmLog) / 1000
      emitEvent('diag', {
        message: `worker[${threadId}] received ${(pcmMessages / secs).toFixed(1)} pcm msgs/sec `
          + `(${(pcmSamples / 16000).toFixed(1)}s of audio) over the last ${secs.toFixed(0)}s`
          + ` | worker event-loop worst stall ${loopWorst}ms`
          + `${loopWorst > 1000 ? ' <- THIS THREAD WAS BLOCKED, which is why it did not drain its queue' : ''}`,
      })
      pcmMessages = 0; pcmSamples = 0; lastPcmLog = now; loopWorst = 0
    }
    ;(whisper ??= require('./whisper')).feedPcm(frame)
    return
  }
  const { id, type, args } = msg
  try {
    const result = await handlers[type](...(args ?? []))
    parentPort.postMessage({ id, result })
  } catch (err) {
    parentPort.postMessage({ id, error: err?.message ?? String(err) })
  }
})

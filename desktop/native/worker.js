// desktop/native/worker.js: FULL REPLACEMENT
// Same role as before (heavy native work off Electron's main thread), with
// two additions: an event channel for push-style messages (live transcript
// segments, model download progress) alongside the existing request/response
// calls, and zero-copy PCM feeding via transferList.

const { parentPort } = require('worker_threads')

function emitEvent(event, payload) {
  parentPort.postMessage({ event, payload })
}
const emitProgress = (label, pct, file) => emitEvent('modelProgress', { label, pct, file })

let whisper, translate, llm
const handlers = {
  // Live transcription session (new)
  startSession: () => (whisper ??= require('./whisper')).startSession(
    (t) => emitEvent('transcript', t),
    emitProgress,
  ),
  stopSession: () => (whisper ??= require('./whisper')).stopSession(),
  preloadWhisper: () => (whisper ??= require('./whisper')).preload(emitProgress),
  preloadTermDetection: () => (llm ??= require('./llm')).preload(emitProgress),
  preloadTranslation: (lang) => (translate ??= require('./translate')).preload(lang, emitProgress),

  // Existing request/response surface
  translate: (text, targetLang) => (translate ??= require('./translate')).translate(text, targetLang, emitProgress),
  detectTerms: (transcript, context, subject, year) =>
    (llm ??= require('./llm')).detectTerms(transcript, context, subject, year, emitProgress),
  getModelTier: () => (llm ??= require('./llm')).getTier(),
  setModelTier: (tier) => (llm ??= require('./llm')).setTier(tier),
  getTranscribeTier: () => (whisper ??= require('./whisper')).getTier(),
  setTranscribeTier: (tier) => (whisper ??= require('./whisper')).setTier(tier),
}

parentPort.on('message', async (msg) => {
  // PCM frames are fire-and-forget and high-frequency: no id, no reply.
  if (msg.type === 'pcm') {
    ;(whisper ??= require('./whisper')).feedPcm(new Float32Array(msg.buffer))
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

// Runs whisper/translate/llm on a separate thread from Electron's main
// process. Those modules do CPU-bound native work (llama.cpp model load and
// inference in particular) that blocks whichever JS thread calls them; the
// main process is also the thread that pumps the BrowserWindow's message
// loop, so running them there directly froze the entire window ("Not
// Responding") and stalled every other IPC call queued behind it, including
// transcription that had already been working. A worker thread has its own
// event loop, so that blocking work no longer touches the UI thread.
const { parentPort } = require('worker_threads')

let whisper, translate, llm
const handlers = {
  transcribe: (audioBuffer, mimeType) => (whisper ??= require('./whisper')).transcribe(audioBuffer, mimeType),
  translate: (text, targetLang) => (translate ??= require('./translate')).translate(text, targetLang),
  detectTerms: (transcript, context) => (llm ??= require('./llm')).detectTerms(transcript, context),
  getModelTier: () => (llm ??= require('./llm')).getTier(),
  setModelTier: (tier) => (llm ??= require('./llm')).setTier(tier),
  getTranscribeTier: () => (whisper ??= require('./whisper')).getTier(),
  setTranscribeTier: (tier) => (whisper ??= require('./whisper')).setTier(tier),
}

parentPort.on('message', async ({ id, type, args }) => {
  try {
    const result = await handlers[type](...args)
    parentPort.postMessage({ id, result })
  } catch (err) {
    parentPort.postMessage({ id, error: err?.message ?? String(err) })
  }
})

// On-device translation via @huggingface/transformers running in Node.
//
// This is the same OPUS-MT model family and the same underlying library
// (transformers.js) the web app's earlier browser-based attempt used and
// removed: but here it runs in a real Node process (Electron's main
// process), not a sandboxed browser tab. That's what actually matters: the
// CSP allowlisting fight, the SharedArrayBuffer/COOP-COEP requirement for
// threaded WASM, and the cross-browser quantization crashes were all
// consequences of running inference *inside a browser's security sandbox*.
// None of that sandbox exists here, so none of those failure modes apply.

// @huggingface/transformers is ESM-only; this file stays CommonJS (simpler
// and more reliable in Electron's main process) and loads it dynamically.
const path = require('path')
const os = require('os')
const { makeProgressLogger } = require('./progressLog')

let cacheDirSet = false
async function importTransformers() {
  const mod = await import('@huggingface/transformers')
  if (!cacheDirSet) {
    // Same fix as native/whisper.js: default cache dir is inside
    // node_modules/@huggingface/transformers/.cache, wiped by any future
    // `npm install` and the likely reason models were re-downloading on
    // every session. env is a shared singleton within this process, so
    // whichever of whisper.js/translate.js runs first sets it for both,
    // this still sets it explicitly rather than relying on that ordering.
    mod.env.cacheDir = path.join(os.homedir(), '.demist', 'model-cache')
    cacheDirSet = true
  }
  return mod
}

// Demist's profile language codes -> Xenova's ONNX-exported OPUS-MT repos.
// Verify each of these repos actually exists on Hugging Face before
// shipping: opus-mt-en-es is confirmed; the others follow the same Xenova
// naming convention but should be individually checked.
const MODEL_BY_LANG = {
  zh: 'Xenova/opus-mt-en-zh',
  ar: 'Xenova/opus-mt-en-ar',
  hi: 'Xenova/opus-mt-en-hi',
  es: 'Xenova/opus-mt-en-es',
  fr: 'Xenova/opus-mt-en-fr',
}

const translators = new Map() // lang -> loaded pipeline, cached across calls

async function getTranslator(lang) {
  const modelId = MODEL_BY_LANG[lang]
  if (!modelId) throw new Error(`No on-device translation model configured for "${lang}"`)
  if (!translators.has(lang)) {
    // Store the in-flight promise itself, synchronously, before awaiting
    // anything: otherwise two overlapping calls for the same language (e.g.
    // two live-transcript sentences translated back to back, same failure
    // mode confirmed for real in native/llm.js's model loading) would both
    // see nothing cached yet and each load their own duplicate pipeline.
    translators.set(lang, importTransformers().then(({ pipeline }) => pipeline('translation', modelId, {
      progress_callback: makeProgressLogger(`translation model (${lang})`),
    })))
  }
  return translators.get(lang)
}

async function translate(text, targetLang) {
  if (!text?.trim()) return ''
  const translator = await getTranslator(targetLang)
  const [result] = await translator(text)
  return result?.translation_text ?? ''
}

module.exports = { translate }

// On-device translation. Runs in a module Worker. Nothing here touches the
// network after the one-time model download (cached by the browser after
// first load). One small OPUS-MT model per target language (~170MB total per
// language: encoder + decoder) instead of a single multilingual model — NLLB-200
// covered all languages in one ~1.3GB download, but its 256k-token shared
// embedding is exported with a 4-bit block-quantization op that has unresolved
// bugs in onnxruntime-web's wasm backend ("Can't create a session... Missing
// required scale"). OPUS-MT's per-pair vocab is small enough that its quantized
// export is a plain, uniform 8-bit scheme — no exotic op, no bug — at roughly
// 1/12th the download size. The trade-off: switching target language now means
// a new (small) download instead of being instant.
//
// Jobs that arrive before the model finishes loading are queued and drained on
// ready instead of rejected — otherwise anything spoken during the download
// died silently.
//
// Even at this much smaller size, OPUS-MT (Marian architecture) still hits the
// same MatMulNBits/DequantizeLinear session-creation bug NLLB did — it also
// ties its embedding weights, and Optimum's "quantized" export runs that
// specific tied embedding through the buggy 4-bit block-quantization op
// regardless of overall model size. Same fix: split dtype so the decoder uses
// fp16 instead of q8, which doesn't touch that op at all.

import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false

const MODELS: Record<string, string> = {
  zh: 'Xenova/opus-mt-en-zh',
  ar: 'Xenova/opus-mt-en-ar',
  hi: 'Xenova/opus-mt-en-hi',
  es: 'Xenova/opus-mt-en-es',
  fr: 'Xenova/opus-mt-en-fr',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Translator = any
let translator: Translator | null = null
let loading = false
let loadFailed = false

const queue: { id: number; text: string }[] = []
let draining = false

async function load(tgtLang: string, tryWebGPU: boolean) {
  if (translator || loading) return
  loading = true
  loadFailed = false
  const modelId = MODELS[tgtLang]
  if (!modelId) {
    loadFailed = true
    self.postMessage({ type: 'error', message: `unsupported_language:${tgtLang}` })
    loading = false
    return
  }
  const hasWebGPU = tryWebGPU && typeof navigator !== 'undefined' && 'gpu' in navigator
  const fileProgress = new Map<string, { loaded: number; total: number }>()
  try {
    translator = await pipeline('translation', modelId, {
      device: hasWebGPU ? 'webgpu' : 'wasm',
      // Session keys, not filename prefixes: the encoder is keyed "model"
      // internally, decoder is "decoder_model_merged".
      dtype: hasWebGPU ? 'fp16' : { model: 'q8', decoder_model_merged: 'fp16' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: (p: any) => {
        if (p.status === 'progress' && p.total) {
          fileProgress.set(p.file, { loaded: p.loaded, total: p.total })
          let loaded = 0, total = 0
          for (const f of fileProgress.values()) { loaded += f.loaded; total += f.total }
          self.postMessage({ type: 'progress', pct: Math.round((loaded / total) * 100) })
        }
      },
    })
    self.postMessage({ type: 'ready', backend: hasWebGPU ? 'webgpu' : 'wasm' })
    void drain()
  } catch (e) {
    loadFailed = true
    while (queue.length) {
      const job = queue.shift()!
      self.postMessage({ type: 'result', id: job.id, text: '' })
    }
    self.postMessage({ type: 'error', message: String((e as Error)?.message ?? e) })
  } finally {
    loading = false
  }
}

async function drain() {
  if (draining || !translator) return
  draining = true
  while (queue.length) {
    const job = queue.shift()!
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: any = await translator(job.text)
      const text = Array.isArray(out) ? out[0]?.translation_text : out?.translation_text
      self.postMessage({ type: 'result', id: job.id, text: String(text ?? '').trim() })
    } catch (err) {
      self.postMessage({ type: 'result', id: job.id, text: '' })
      self.postMessage({ type: 'generate_error', message: String((err as Error)?.message ?? err) })
    }
  }
  draining = false
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'load') { void load(msg.tgtLang, !!msg.tryWebGPU); return }
  if (msg.type === 'translate') {
    if (loadFailed) { self.postMessage({ type: 'result', id: msg.id, text: '' }); return }
    queue.push({ id: msg.id, text: String(msg.text ?? '') })
    void drain()
  }
}

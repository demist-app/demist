// On-device translation. Runs in a module Worker. Nothing here touches the
// network after the one-time model download (cached by the browser after first load).
// NLLB-200 covers all supported target languages in a single model, so switching
// languages never re-downloads.
//
// Jobs that arrive before the model finishes loading are queued and drained on
// ready instead of rejected — otherwise anything spoken during the ~600MB first
// download died silently. Defaults to wasm+int8: webgpu+fp16 can pass the
// download then fail at load or first generate for seq2seq models like NLLB,
// which looks identical to "downloads fine, never translates". q8 (the
// "_quantized" export) hits a distinct failure — onnxruntime-web's wasm backend
// can fail to build a session for it ("Can't create a session... Missing
// required scale") because NLLB's 256k-token shared embedding is exported with
// the 4-bit MatMulNBits op, which has had unresolved bugs across recent
// onnxruntime-web releases. int8 uses plain per-tensor quantization for that
// embedding instead, avoiding the op entirely. Pass tryWebGPU: true in the load
// message to experiment with webgpu on capable machines.

import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Translator = any
let translator: Translator | null = null
let loading = false
let loadFailed = false

const queue: { id: number; text: string; tgtLang: string }[] = []
let draining = false

async function load(tryWebGPU: boolean) {
  if (translator || loading) return
  loading = true
  loadFailed = false
  const hasWebGPU = tryWebGPU && typeof navigator !== 'undefined' && 'gpu' in navigator
  const fileProgress = new Map<string, { loaded: number; total: number }>()
  try {
    translator = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
      device: hasWebGPU ? 'webgpu' : 'wasm',
      // Encoder's quantized (q8) export is fine. Only the decoder's quantized
      // export hits the MatMulNBits bug (its huge shared embedding is exported
      // as 4-bit blocks); fp16 sidesteps it at a smaller size cost than any
      // other non-block-quantized decoder variant. Session keys, not filename
      // prefixes: the encoder is keyed "model" internally.
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
    // Flush anything queued so no caller hangs on a promise.
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
      const out: any = await translator(job.text, { src_lang: 'eng_Latn', tgt_lang: job.tgtLang })
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
  if (msg.type === 'load') { void load(!!msg.tryWebGPU); return }
  if (msg.type === 'translate') {
    if (loadFailed) { self.postMessage({ type: 'result', id: msg.id, text: '' }); return }
    queue.push({ id: msg.id, text: String(msg.text ?? ''), tgtLang: String(msg.tgtLang ?? '') })
    void drain()
  }
}

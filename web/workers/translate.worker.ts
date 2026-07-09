// On-device translation. Runs in a module Worker. Nothing here touches the
// network after the one-time model download (cached by the browser after first load).
// NLLB-200 covers all supported target languages in a single model, so switching
// languages never re-downloads.

import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Translator = any
let translator: Translator | null = null
let loading = false

async function load() {
  if (translator || loading) return
  loading = true
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
  // Multiple files (weights, tokenizer, config) download concurrently; track bytes
  // per file and report the combined ratio so the percentage doesn't jump around
  // as individual files report their own progress out of sync with each other.
  const fileProgress = new Map<string, { loaded: number; total: number }>()
  try {
    translator = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
      device: hasWebGPU ? 'webgpu' : 'wasm',
      dtype: hasWebGPU ? 'fp16' : 'q8',
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
  } catch (e) {
    self.postMessage({ type: 'error', message: String((e as Error)?.message ?? e) })
  } finally {
    loading = false
  }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'load') { await load(); return }
  if (msg.type === 'translate') {
    if (!translator) { self.postMessage({ type: 'error', id: msg.id, message: 'model_not_loaded' }); return }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: any = await translator(msg.text, { src_lang: 'eng_Latn', tgt_lang: msg.tgtLang })
      const text = Array.isArray(out) ? out[0]?.translation_text : out?.translation_text
      self.postMessage({ type: 'result', id: msg.id, text: (text ?? '').trim() })
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: String((err as Error)?.message ?? err) })
    }
  }
}

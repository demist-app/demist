// On-device Whisper. Runs in a module Worker. Nothing here touches the network
// after the one-time model download (cached by the browser after first load).

import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false

type Asr = Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>>
let asr: Asr | null = null
let loading = false

const MODELS: Record<string, string> = {
  base: 'onnx-community/whisper-base.en',   // ~74MB, default
  small: 'onnx-community/whisper-small.en', // ~244MB, accuracy toggle
}

async function load(model: string) {
  if (asr || loading) return
  loading = true
  const hasWebGPU = typeof navigator !== 'undefined' && 'gpu' in navigator
  try {
    asr = await pipeline('automatic-speech-recognition', MODELS[model] ?? MODELS.base, {
      device: hasWebGPU ? 'webgpu' : 'wasm',
      dtype: hasWebGPU ? 'fp16' : 'q8',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      progress_callback: (p: any) => {
        if (p.status === 'progress' && p.total) {
          self.postMessage({ type: 'progress', pct: Math.round((p.loaded / p.total) * 100), file: p.file })
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
  if (msg.type === 'load') { await load(msg.model ?? 'base'); return }
  if (msg.type === 'transcribe') {
    if (!asr) { self.postMessage({ type: 'error', message: 'model_not_loaded' }); return }
    try {
      // msg.audio is Float32Array, mono, 16kHz (resampled on the main thread)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const out: any = await asr(msg.audio, { language: 'english', task: 'transcribe' })
      self.postMessage({ type: 'result', id: msg.id, text: (out?.text ?? '').trim() })
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: String((err as Error)?.message ?? err) })
    }
  }
}

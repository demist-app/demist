'use client'

// Owns the worker, exposes readiness + a transcribe(blob) that resolves to text.
// Enablement: user toggle in localStorage + desktop + (WebGPU or explicit wasm opt-in).

import { useEffect, useRef, useState, useCallback } from 'react'

const TOGGLE_KEY = 'demist_local_asr'          // '1' = on
const MODEL_KEY = 'demist_local_asr_model'     // 'base' | 'small'

export function localAsrPreferred(): boolean {
  if (typeof window === 'undefined') return false
  if (localStorage.getItem(TOGGLE_KEY) !== '1') return false
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  return !mobile
}

export function setLocalAsrPreferred(on: boolean) {
  localStorage.setItem(TOGGLE_KEY, on ? '1' : '0')
}

async function blobToFloat32Mono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer()
  const decodeCtx = new AudioContext()
  const decoded = await decodeCtx.decodeAudioData(arrayBuf)
  await decodeCtx.close()
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0).slice()
}

type Status = 'off' | 'downloading' | 'ready' | 'error'

export function useLocalAsr() {
  const workerRef = useRef<Worker | null>(null)
  const pendingRef = useRef<Map<number, (t: string) => void>>(new Map())
  const idRef = useRef(0)
  const [status, setStatus] = useState<Status>('off')
  const [progress, setProgress] = useState(0)
  const [backend, setBackend] = useState<'webgpu' | 'wasm' | null>(null)

  const start = useCallback(() => {
    if (workerRef.current) return
    setStatus('downloading')
    const w = new Worker(new URL('../workers/asr.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') setProgress(m.pct)
      else if (m.type === 'ready') { setStatus('ready'); setBackend(m.backend) }
      else if (m.type === 'result') { pendingRef.current.get(m.id)?.(m.text); pendingRef.current.delete(m.id) }
      else if (m.type === 'error') {
        if (m.id != null) {
          console.error('[asr.worker] transcribe failed:', m.message)
          pendingRef.current.get(m.id)?.('')
          pendingRef.current.delete(m.id)
        } else {
          console.error('[asr.worker] load failed:', m.message)
          setStatus('error')
        }
      }
    }
    w.postMessage({ type: 'load', model: localStorage.getItem(MODEL_KEY) ?? 'base' })
    workerRef.current = w
  }, [])

  const stop = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
    setStatus('off'); setProgress(0); setBackend(null)
    pendingRef.current.clear()
  }, [])

  const transcribe = useCallback(async (blob: Blob): Promise<string> => {
    if (!workerRef.current || status !== 'ready') return ''
    const audio = await blobToFloat32Mono16k(blob)
    if (audio.length < 1600) return ''   // <0.1s, skip
    return new Promise<string>((resolve) => {
      const id = ++idRef.current
      pendingRef.current.set(id, resolve)
      workerRef.current!.postMessage({ type: 'transcribe', id, audio }, [audio.buffer])
    })
  }, [status])

  useEffect(() => () => { workerRef.current?.terminate() }, [])

  return { status, progress, backend, start, stop, transcribe }
}

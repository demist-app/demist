'use client'

// Owns the on-device translation worker (NLLB-200). Fully local: once the model
// is downloaded and cached, no text ever leaves the device to be translated.
//
// translate() is stable (no state deps) and reads refs instead of closing over
// `status` — recorder callbacks captured at recording start used to hold a
// version of translate() frozen at whatever status was true that instant, which
// silently returned '' forever if the model wasn't ready yet at that exact
// moment. The worker now queues jobs until ready, so calling before 'ready' is
// fine; a per-job timeout keeps a pending pair from waiting forever if the
// worker never responds.

import { useEffect, useRef, useState, useCallback } from 'react'

// Our short profile codes -> NLLB-200 (FLORES-200) language codes.
const FLORES_CODES: Record<string, string> = {
  zh: 'zho_Hans',
  ar: 'arb_Arab',
  hi: 'hin_Deva',
  es: 'spa_Latn',
  fr: 'fra_Latn',
}

export function floresCode(lang: string): string | null {
  return FLORES_CODES[lang] ?? null
}

// The model is a one-time ~1.3GB download (cached by the browser after that),
// large enough that it shouldn't start without the user explicitly agreeing to
// it on this device — a saved translate_to preference from another device
// isn't consent to pull that much data on this one.
const CONSENT_KEY = 'demist_translate_dl_ok'

export function translateDownloadConsent(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(CONSENT_KEY) === '1'
}

export function setTranslateDownloadConsent() {
  localStorage.setItem(CONSENT_KEY, '1')
}

type Status = 'off' | 'downloading' | 'ready' | 'error'

const JOB_TIMEOUT_MS = 90_000  // NLLB-600M on wasm can take seconds per sentence; generous but finite

export function useLocalTranslate() {
  const workerRef = useRef<Worker | null>(null)
  const statusRef = useRef<Status>('off')
  const pendingRef = useRef<Map<number, { resolve: (t: string) => void; timer: ReturnType<typeof setTimeout> }>>(new Map())
  const idRef = useRef(0)
  const [status, setStatus] = useState<Status>('off')
  const [progress, setProgress] = useState(0)
  const [backend, setBackend] = useState<'webgpu' | 'wasm' | null>(null)

  const setStatusBoth = (s: Status) => { statusRef.current = s; setStatus(s) }

  // Gated on consent here, not just at call sites, so any future caller is
  // safe by construction — the only way this ever pulls ~1.3GB is if the user
  // already agreed to it on this device.
  const start = useCallback(() => {
    if (workerRef.current || !translateDownloadConsent()) return
    setStatusBoth('downloading')
    const w = new Worker(new URL('../workers/translate.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') setProgress(m.pct)
      else if (m.type === 'ready') { setStatusBoth('ready'); setBackend(m.backend) }
      else if (m.type === 'result') {
        const job = pendingRef.current.get(m.id)
        if (job) { clearTimeout(job.timer); job.resolve(m.text); pendingRef.current.delete(m.id) }
      }
      else if (m.type === 'generate_error') {
        console.error('[translate.worker] generate failed:', m.message)
      }
      else if (m.type === 'error') {
        console.error('[translate.worker] load failed:', m.message)
        setStatusBoth('error')
      }
    }
    // tryWebGPU stays false by default: the wasm+q8 path is the reliable one for
    // seq2seq. Flip to true here to experiment with webgpu on capable machines.
    w.postMessage({ type: 'load', tryWebGPU: false })
    workerRef.current = w
  }, [])

  // Stable: no state deps. Safe to call from closures captured at any time.
  // The worker queues jobs until the model is ready, so calling while
  // downloading is fine; the promise resolves when the model catches up.
  const translate = useCallback((text: string, tgtLang: string): Promise<string> => {
    if (!workerRef.current || statusRef.current === 'error' || !text.trim() || !tgtLang) {
      return Promise.resolve('')
    }
    return new Promise<string>((resolve) => {
      const id = ++idRef.current
      const timer = setTimeout(() => {
        pendingRef.current.delete(id)
        resolve('')
      }, JOB_TIMEOUT_MS)
      pendingRef.current.set(id, { resolve, timer })
      workerRef.current!.postMessage({ type: 'translate', id, text, tgtLang })
    })
  }, [])

  useEffect(() => () => {
    workerRef.current?.terminate()
    for (const job of pendingRef.current.values()) { clearTimeout(job.timer); job.resolve('') }
    pendingRef.current.clear()
  }, [])

  return { status, progress, backend, start, translate }
}

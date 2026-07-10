'use client'

// Owns the on-device translation worker. Fully local: once a language's model
// is downloaded and cached, no text ever leaves the device to be translated.
// One small OPUS-MT model per target language (~170MB) rather than a single
// multilingual model — see workers/translate.worker.ts for why.
//
// translate() is stable (no state deps) and reads refs instead of closing over
// `status` — recorder callbacks captured at recording start used to hold a
// version of translate() frozen at whatever status was true that instant, which
// silently returned '' forever if the model wasn't ready yet at that exact
// moment. The worker now queues jobs until ready, so calling before 'ready' is
// fine; a per-job timeout keeps a pending pair from waiting forever if the
// worker never responds.

import { useEffect, useRef, useState, useCallback } from 'react'

// The model is a one-time ~170MB-per-language download (cached by the browser
// after that), large enough that it shouldn't start without the user
// explicitly agreeing to it on this device — a saved translate_to preference
// from another device isn't consent to pull that much data on this one.
const CONSENT_KEY = 'demist_translate_dl_ok'

export function translateDownloadConsent(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(CONSENT_KEY) === '1'
}

export function setTranslateDownloadConsent() {
  localStorage.setItem(CONSENT_KEY, '1')
}

type Status = 'off' | 'downloading' | 'ready' | 'error'

const JOB_TIMEOUT_MS = 30_000  // OPUS-MT on wasm is quick; still finite in case the worker never responds

export function useLocalTranslate() {
  const workerRef = useRef<Worker | null>(null)
  const loadedLangRef = useRef<string | null>(null)
  const statusRef = useRef<Status>('off')
  const pendingRef = useRef<Map<number, { resolve: (t: string) => void; timer: ReturnType<typeof setTimeout> }>>(new Map())
  const idRef = useRef(0)
  const [status, setStatus] = useState<Status>('off')
  const [progress, setProgress] = useState(0)
  const [backend, setBackend] = useState<'webgpu' | 'wasm' | null>(null)

  const setStatusBoth = (s: Status) => { statusRef.current = s; setStatus(s) }

  const teardown = () => {
    workerRef.current?.terminate()
    workerRef.current = null
    loadedLangRef.current = null
    for (const job of pendingRef.current.values()) { clearTimeout(job.timer); job.resolve('') }
    pendingRef.current.clear()
  }

  // Gated on consent here, not just at call sites, so any future caller is
  // safe by construction — the only way this ever pulls ~170MB is if the user
  // already agreed to it on this device. Switching target language tears down
  // the old worker (a different language is a different model) and starts a
  // fresh download for the new one.
  const start = useCallback((tgtLang: string) => {
    if (!tgtLang || !translateDownloadConsent()) return
    if (workerRef.current && loadedLangRef.current === tgtLang) return
    if (workerRef.current) teardown()

    setStatusBoth('downloading')
    setProgress(0)
    loadedLangRef.current = tgtLang
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
    // tryWebGPU stays false by default: wasm+q8 is the reliable path.
    w.postMessage({ type: 'load', tgtLang, tryWebGPU: false })
    workerRef.current = w
  }, [])

  // Stable: no state deps. Safe to call from closures captured at any time.
  // The worker queues jobs until the model is ready, so calling while
  // downloading is fine; the promise resolves when the model catches up.
  const translate = useCallback((text: string): Promise<string> => {
    if (!workerRef.current || statusRef.current === 'error' || !text.trim()) {
      return Promise.resolve('')
    }
    return new Promise<string>((resolve) => {
      const id = ++idRef.current
      const timer = setTimeout(() => {
        pendingRef.current.delete(id)
        resolve('')
      }, JOB_TIMEOUT_MS)
      pendingRef.current.set(id, { resolve, timer })
      workerRef.current!.postMessage({ type: 'translate', id, text })
    })
  }, [])

  useEffect(() => () => teardown(), [])

  return { status, progress, backend, start, translate }
}

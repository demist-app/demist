'use client'

// Owns the on-device translation worker (NLLB-200). Fully local: once the model
// is downloaded and cached, no text ever leaves the device to be translated.

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

type Status = 'off' | 'downloading' | 'ready' | 'error'

export function useLocalTranslate() {
  const workerRef = useRef<Worker | null>(null)
  const pendingRef = useRef<Map<number, (t: string) => void>>(new Map())
  const idRef = useRef(0)
  const [status, setStatus] = useState<Status>('off')
  const [progress, setProgress] = useState(0)
  const [backend, setBackend] = useState<'webgpu' | 'wasm' | null>(null)

  const start = useCallback(() => {
    if (workerRef.current) return
    setStatus('downloading')
    const w = new Worker(new URL('../workers/translate.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e) => {
      const m = e.data
      if (m.type === 'progress') setProgress(m.pct)
      else if (m.type === 'ready') { setStatus('ready'); setBackend(m.backend) }
      else if (m.type === 'result') { pendingRef.current.get(m.id)?.(m.text); pendingRef.current.delete(m.id) }
      else if (m.type === 'error') {
        if (m.id != null) { pendingRef.current.get(m.id)?.(''); pendingRef.current.delete(m.id) }
        else setStatus('error')
      }
    }
    w.postMessage({ type: 'load' })
    workerRef.current = w
  }, [])

  const translate = useCallback(async (text: string, tgtLang: string): Promise<string> => {
    if (!workerRef.current || status !== 'ready' || !text.trim()) return ''
    return new Promise<string>((resolve) => {
      const id = ++idRef.current
      pendingRef.current.set(id, resolve)
      workerRef.current!.postMessage({ type: 'translate', id, text, tgtLang })
    })
  }, [status])

  useEffect(() => () => { workerRef.current?.terminate() }, [])

  return { status, progress, backend, start, translate }
}

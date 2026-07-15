'use client'

// Chrome's built-in Translator API (stable since Chrome 131): the model is
// downloaded and run entirely by Chrome itself, shared across every site that
// uses it: nothing for this app to bundle, manage, or debug. Feature-detected
// and unavailable everywhere else (Firefox, Safari, Edge, Opera GX), where the
// caller should fall back to the cloud translation path instead.
//
// Our profile language codes (zh/ar/hi/es/fr) are already valid BCP-47 short
// codes, which is what this API expects: no mapping table needed, unlike the
// FLORES-200 codes NLLB required.
//
// A single instance is shared app-wide via context (mounted once in the (app)
// layout) rather than one per page. Profile and Dashboard used to each create
// their own independent Translator session: navigating between them lost all
// download progress and re-triggered session creation from scratch. Sharing
// one instance means the earliest possible page load starts the (one-time)
// download, and every page after that sees the same status/progress.

import { createContext, useContext, useRef, useState, useCallback, ReactNode } from 'react'

export function nativeTranslateSupported(): boolean {
  return typeof window !== 'undefined' && 'Translator' in window
}

type Status = 'off' | 'downloading' | 'ready' | 'error'

type TranslatorInstance = { translate(text: string): Promise<string> }

interface NativeTranslateValue {
  status: Status
  progress: number
  start: (tgtLang: string) => Promise<void>
  translate: (text: string) => Promise<string>
  supported: boolean
}

const NativeTranslateContext = createContext<NativeTranslateValue | null>(null)

export function NativeTranslateProvider({ children }: { children: ReactNode }) {
  const translatorRef = useRef<TranslatorInstance | null>(null)
  const loadedLangRef = useRef<string | null>(null)
  const [status, setStatus] = useState<Status>('off')
  const [progress, setProgress] = useState(0)

  const start = useCallback(async (tgtLang: string) => {
    if (!nativeTranslateSupported() || !tgtLang) return
    if (translatorRef.current && loadedLangRef.current === tgtLang) return
    setStatus('downloading')
    setProgress(0)
    loadedLangRef.current = tgtLang
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const TranslatorApi = (window as any).Translator
      const translator = await TranslatorApi.create({
        sourceLanguage: 'en',
        targetLanguage: tgtLang,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        monitor(m: any) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          m.addEventListener('downloadprogress', (e: any) => {
            setProgress(Math.round((e.loaded ?? 0) * 100))
          })
        },
      })
      if (loadedLangRef.current !== tgtLang) return  // superseded by a later call
      translatorRef.current = translator
      setStatus('ready')
    } catch (e) {
      console.error('[native translate] create failed:', e)
      setStatus('error')
    }
  }, [])

  // Stable: safe to call from closures captured at any time. Chrome's own
  // translate() call is local and near-instant once ready, so unlike the old
  // WASM worker there's no queueing needed: just skip if not ready yet.
  const translate = useCallback(async (text: string): Promise<string> => {
    if (!translatorRef.current || !text.trim()) return ''
    try {
      return await translatorRef.current.translate(text)
    } catch (e) {
      console.error('[native translate] translate failed:', e)
      return ''
    }
  }, [])

  const value: NativeTranslateValue = { status, progress, start, translate, supported: nativeTranslateSupported() }
  return <NativeTranslateContext.Provider value={value}>{children}</NativeTranslateContext.Provider>
}

export function useNativeTranslate(): NativeTranslateValue {
  const ctx = useContext(NativeTranslateContext)
  if (!ctx) throw new Error('useNativeTranslate must be used within NativeTranslateProvider')
  return ctx
}

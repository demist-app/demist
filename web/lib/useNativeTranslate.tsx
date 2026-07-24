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
import { isElectronNative } from './electronNative'

export function nativeTranslateSupported(): boolean {
  // Excludes Electron even when window.Translator exists there: this API's
  // actual model download is served through Chrome's own component-update
  // infrastructure, tied to a real Chrome browser installation, which an
  // Electron app has no access to. Confirmed by testing: in the desktop app
  // this reported 'downloading' and sat at 0% forever, since there's nothing
  // on the other end to ever deliver the component. The desktop app already
  // has its own bundled on-device translation model (see electronNative.ts);
  // it should never even attempt this path.
  return typeof window !== 'undefined' && 'Translator' in window && !isElectronNative()
}

type Status = 'off' | 'downloading' | 'ready' | 'error'

type TranslatorInstance = { translate(text: string): Promise<string> }

interface NativeTranslateValue {
  status: Status
  progress: number
  start: (tgtLang: string, opts?: { onlyIfReady?: boolean }) => Promise<void>
  translate: (text: string) => Promise<string>
  supported: boolean
}

const NativeTranslateContext = createContext<NativeTranslateValue | null>(null)

export function NativeTranslateProvider({ children }: { children: ReactNode }) {
  const translatorRef = useRef<TranslatorInstance | null>(null)
  const loadedLangRef = useRef<string | null>(null)
  // Tracks the one in-flight create() call, if any. Several independent call
  // sites share this one instance (TranslateWarmup on layout mount, the
  // profile-load effect and startRecording in recordingSession.tsx, the
  // Profile language picker): without this, a call arriving while a download
  // was already in flight for the same language would skip the "already
  // ready" guard below (translatorRef.current is still null mid-download)
  // and fire a second, parallel create(). Each call's own monitor writes to
  // the same shared status/progress state, so whichever call's events fired
  // last "won", including a no-gesture call that Chrome rejects with
  // NotAllowedError after the real one had already started making progress,
  // clobbering status back to 'error', or just leaving progress reset to 0%
  // and never updated again once its own (superseded) promise settled.
  const inflightRef = useRef<{ lang: string; promise: Promise<void> } | null>(null)
  const [status, setStatus] = useState<Status>('off')
  const [progress, setProgress] = useState(0)

  // opts.onlyIfReady: for passive, no-gesture callers (page-load warmup).
  // Chrome throws NotAllowedError if create() is called without a real user
  // gesture while the model still needs downloading ('downloadable' or
  // 'downloading'). Checking availability first costs nothing and lets a
  // passive warmup silently no-op instead of erroring, while a genuine
  // gesture-backed call (the record button, the Profile language picker)
  // still proceeds normally and can trigger that download.
  const start = useCallback(async (tgtLang: string, opts?: { onlyIfReady?: boolean }) => {
    if (!nativeTranslateSupported() || !tgtLang) return
    if (translatorRef.current && loadedLangRef.current === tgtLang) return
    if (inflightRef.current?.lang === tgtLang) return inflightRef.current.promise
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const TranslatorApi = (window as any).Translator
    if (opts?.onlyIfReady) {
      try {
        const availability = await TranslatorApi.availability({ sourceLanguage: 'en', targetLanguage: tgtLang })
        if (availability !== 'available') return
      } catch {
        return
      }
    }
    setStatus('downloading')
    setProgress(0)
    loadedLangRef.current = tgtLang
    const promise = (async () => {
      try {
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
        if (loadedLangRef.current === tgtLang) setStatus('error')
      } finally {
        if (inflightRef.current?.lang === tgtLang) inflightRef.current = null
      }
    })()
    inflightRef.current = { lang: tgtLang, promise }
    return promise
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

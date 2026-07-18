'use client'

// web/lib/electronNative.ts: FULL REPLACEMENT
// Bridge types for the desktop app's native on-device processing (see
// /desktop). window.demistNative only exists inside the Electron shell;
// everywhere else callers fall back to the cloud edge functions.

export interface NativeEvent {
  event: 'transcript' | 'modelProgress'
  payload: { seq?: number; text?: string; label?: string; pct?: number; file?: string | null }
}

export interface DemistNative {
  startSession: () => Promise<boolean>
  stopSession: () => Promise<void>
  preloadWhisper: () => Promise<'fast' | 'accurate'>
  preloadTermDetection: () => Promise<'small' | 'large'>
  preloadTranslation: (lang: string) => Promise<string>
  sendPcm: (arrayBuffer: ArrayBuffer) => void
  onEvent: (callback: (msg: NativeEvent) => void) => () => void
  translate: (text: string, targetLang: string) => Promise<string>
  detectTerms: (
    transcript: string,
    context: string,
    subject?: string | null,
    year?: number | null,
  ) => Promise<{ term: string; definition: string; context?: string }[]>
  getModelTier: () => Promise<'small' | 'large'>
  setModelTier: (tier: 'small' | 'large') => Promise<'small' | 'large'>
  getTranscribeTier: () => Promise<'fast' | 'accurate'>
  setTranscribeTier: (tier: 'fast' | 'accurate') => Promise<'fast' | 'accurate'>
  startWakeLock: () => Promise<void>
  stopWakeLock: () => Promise<void>
}

declare global {
  interface Window {
    demistNative?: DemistNative
  }
}

export function isElectronNative(): boolean {
  return typeof window !== 'undefined' && !!window.demistNative
}

export function getDemistNative(): DemistNative | null {
  return isElectronNative() ? window.demistNative! : null
}

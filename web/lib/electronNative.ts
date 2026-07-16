'use client'

// Bridge to the desktop app's native on-device processing (see /desktop).
// window.demistNative only exists when this page is loaded inside the
// Electron shell (exposed by desktop/preload.js) — everywhere else
// (regular browser, installed PWA) this is undefined and callers should
// fall back to the existing cloud edge functions.

export interface DemistNative {
  transcribe: (audioBuffer: ArrayBuffer, mimeType: string) => Promise<string>
  translate: (text: string, targetLang: string) => Promise<string>
  detectTerms: (transcript: string, context: string) => Promise<{ term: string; definition: string; context?: string }[]>
  getModelTier: () => Promise<'small' | 'large'>
  setModelTier: (tier: 'small' | 'large') => Promise<'small' | 'large'>
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

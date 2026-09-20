'use client'

// web/lib/electronNative.ts: FULL REPLACEMENT
// Bridge types for the desktop app's native on-device processing (see
// /desktop). window.demistNative only exists inside the Electron shell;
// everywhere else callers fall back to the cloud edge functions.

export interface NativeEvent {
  // 'sessionLost': the native transcription worker died mid-recording and was
  // replaced by one with no session, so nothing further would be transcribed
  // (see the 'exit' handler in desktop/main.js). Reported so the UI can say so
  // rather than keep showing a recording that silently captures nothing.
  // 'modelsUnloaded': a native worker exited, so whatever models it had
  // loaded are gone. Sent whether or not a session was running, because the
  // damaging case is an IDLE death: the preload has already resolved, so the
  // UI still claims everything is ready while the replacement worker has
  // nothing loaded.
  // 'sessionNotice': something the user needs to read about the live session,
  // as opposed to a diagnostic. Currently only "your microphone is too quiet to
  // transcribe", raised by the transcribe worker when it is discarding every
  // segment as room tone. An empty message retracts a notice already showing.
  event: 'transcript' | 'interimTranscript' | 'modelProgress' | 'sessionLost' | 'modelsUnloaded' | 'sessionNotice' | 'diag'
  payload: {
    seq?: number
    text?: string
    label?: string
    pct?: number
    file?: string | null
    message?: string
    // 'diag' only: a high-frequency trace line (per-5-second counters,
    // per-segment timings) rather than a session-lifecycle one. Logged only
    // when localStorage demist_debug is set - see nativeSession.ts.
    verbose?: boolean
    role?: string
  }
}

export interface DemistNative {
  platform: string
  startSession: () => Promise<boolean>
  stopSession: () => Promise<void>
  preloadWhisper: () => Promise<'fast' | 'accurate'>
  preloadTermDetection: () => Promise<'tiny' | 'small' | 'large'>
  preloadTranslation: (lang: string) => Promise<string>
  sendPcm: (arrayBuffer: ArrayBuffer, seq?: number) => void
  // One window of an imported audio file, transcribed as fast as the machine
  // manages rather than at the speed the audio was originally spoken.
  transcribeBuffer: (arrayBuffer: ArrayBuffer) => Promise<string>
  onEvent: (callback: (msg: NativeEvent) => void) => () => void
  translate: (text: string, targetLang: string) => Promise<string>
  detectTerms: (
    transcript: string,
    context: string,
    subject?: string | null,
    year?: number | null,
    // Terms already carded this session. An older desktop shell ignores the
    // extra argument rather than failing on it, so the site can send it before
    // every installed build understands it.
    knownTerms?: string[],
  ) => Promise<{ term: string; definition: string; context?: string }[]>
  explain: (
    text: string,
    subject?: string | null,
    year?: number | null,
  ) => Promise<string | null>
  summarize: (
    terms: { term: string; definition: string }[],
    subject?: string | null,
  ) => Promise<string | null>
  getModelTier: () => Promise<'tiny' | 'small' | 'large'>
  setModelTier: (tier: 'tiny' | 'small' | 'large') => Promise<'tiny' | 'small' | 'large'>
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

// Verbose capture-pipeline tracing, off unless explicitly switched on with
// localStorage.setItem('demist_debug', '1'). These logs fire per PCM batch and
// per transcript event, which is several lines a second per capture graph:
// invaluable while diagnosing a dead pipeline, unusable as a default (it
// floods DevTools so badly that real errors scroll away). Errors and warnings
// are NOT routed through this and always print.
let debugEnabled: boolean | null = null
export function demistDebugEnabled(): boolean {
  if (debugEnabled === null) {
    try {
      debugEnabled = typeof window !== 'undefined' && window.localStorage?.getItem('demist_debug') === '1'
    } catch { debugEnabled = false }
  }
  return debugEnabled
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dlog(...args: any[]): void {
  if (demistDebugEnabled()) console.log(...args)
}

export function isElectronNative(): boolean {
  return typeof window !== 'undefined' && !!window.demistNative
}

export function getDemistNative(): DemistNative | null {
  return isElectronNative() ? window.demistNative! : null
}

// Every on-device path in the app is chosen by FEATURE detection, not platform
// detection - nativeImportSupported() checks for transcribeBuffer,
// nativeExplain() checks for explain, and so on. That is correct: the desktop
// shell loads whatever is deployed at demist.app, so the site is always newer
// than the installed build and must not call a method that isn't there.
//
// The side effect is that a stale shell silently falls back to the CLOUD for
// whatever it lacks, while the app still tells the user their lectures never
// leave their computer. That is the one fallback that must not be quiet,
// because it is the difference between the privacy claim being true and being
// true except on your build. This names what's missing so the app can say so
// and point at an update.
const ON_DEVICE_CAPABILITIES: { key: keyof DemistNative; label: string }[] = [
  { key: 'transcribeBuffer', label: 'importing audio' },
  { key: 'detectTerms', label: 'detecting terms' },
  { key: 'explain', label: 'explaining a highlighted word' },
  { key: 'summarize', label: 'summarising a lecture' },
]

export function missingOnDeviceCapabilities(): string[] {
  const native = getDemistNative()
  if (!native) return []
  return ON_DEVICE_CAPABILITIES
    .filter(({ key }) => typeof (native as unknown as Record<string, unknown>)[key] !== 'function')
    .map(({ label }) => label)
}

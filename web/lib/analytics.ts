type Props = Record<string, unknown>

let _ph: typeof import('posthog-js').default | null = null

async function get() {
  if (_ph) return _ph
  const { default: ph } = await import('posthog-js')
  _ph = ph
  return ph
}

export function capture(event: string, props?: Props): void {
  if (typeof window === 'undefined') return
  get().then(ph => ph.capture(event, props))
}

export function identify(userId: string): void {
  if (typeof window === 'undefined') return
  get().then(ph => ph.identify(userId))
}

export function reset(): void {
  if (typeof window === 'undefined') return
  get().then(ph => ph.reset())
}

// Session recording is opted OUT by default in instrumentation-client.ts
// (disable_session_recording: true) and turned on only for the exact public
// pages listed in SessionReplayGate (app/providers.tsx) - never inside (app)/,
// which renders real lecture transcripts and term definitions as DOM text.
export function startSessionRecording(): void {
  if (typeof window === 'undefined') return
  get().then(ph => ph.startSessionRecording())
}

export function stopSessionRecording(): void {
  if (typeof window === 'undefined') return
  get().then(ph => ph.stopSessionRecording())
}

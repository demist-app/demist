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

// Supabase mutations RESOLVE with an { error } object rather than throwing, so
// `await supabase.from(x).insert(y)` inside a try/catch looks handled and is
// not: the catch never runs and the next line reports success. An audit on
// 2026-09-19 found 20 writes in this shape. Two were measurable in production:
// 29 of 61 sessions had no transcript, and 12 had no ended_at.
//
// Returns true when there WAS an error, so a call site reads:
//   const { error } = await sb.from('sessions').update(...)
//   if (reportWriteFailure('session.transcript', error)) setWarning(...)
//
// Everything lands on one `write_failed` event keyed by `op`, so a new class of
// failure shows up in one PostHog breakdown instead of needing its own event.
export function reportWriteFailure(
  op: string,
  error: { code?: string | null; message?: string | null } | null | undefined,
  extra?: Props,
): boolean {
  if (!error) return false
  // Always logged locally in full - the console is on the user's own machine.
  console.error(`[demist] write failed (${op}):`, error.message)
  // A Postgres error message routinely embeds the offending value, e.g.
  // 'duplicate key value violates unique constraint ... Key (term)=(chemiosmosis)
  // already exists'. That is lecture content, and the desktop app promises it
  // never leaves the machine, so the message is sent only from the browser -
  // where the same data already round-trips to Supabase anyway. `code` is a
  // fixed SQLSTATE and carries nothing of the user's, so it always goes and
  // is enough to classify a failure.
  const native = typeof window !== 'undefined' && !!(window as { demistNative?: unknown }).demistNative
  capture('write_failed', {
    op,
    code: error.code ?? null,
    native,
    ...(native ? {} : { message: error.message?.slice(0, 200) ?? null }),
    ...extra,
  })
  return true
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
// (disable_session_recording: true) and turned on only for the exact paths
// allowlisted in SessionReplayGate (app/providers.tsx), and never at all in
// the desktop app. In-app routes are recordable only because every text node
// is masked at the recorder (session_recording.maskTextSelector: '*'), so a
// replay carries interactions, not lecture content.
export function startSessionRecording(): void {
  if (typeof window === 'undefined') return
  get().then(ph => ph.startSessionRecording())
}

export function stopSessionRecording(): void {
  if (typeof window === 'undefined') return
  get().then(ph => ph.stopSessionRecording())
}

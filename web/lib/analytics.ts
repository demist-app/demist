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

// For failures that return successfully: nothing throws, so autocapture never
// sees them, and they only exist if something reports them. Sent as a PostHog
// exception so it appears in error tracking alongside real crashes. The name
// must be a fixed string and props must be counts or enums, never content:
// this runs in the desktop app too.
export function reportError(name: string, props?: Props): void {
  if (typeof window === 'undefined') return
  console.error(`[demist] ${name}`, props ?? '')
  get().then(ph => ph.captureException(new Error(name), props))
}

// Identifies with the Supabase auth user id (the same id on web, desktop and
// Mac, so PostHog persons join to Supabase rows by id) and marks internal
// accounts with PostHog's own $internal_or_test_user property, so the
// project's test-account filter catches new internal accounts automatically
// instead of through a hand-maintained static cohort.
//
// Deliberately NOT the email. It was sent once and removed (see login/page.tsx):
// the privacy policy says analytics carry no email, a user id is already the
// join key, and several users are minors. Internal filtering was the only
// reason to want it, and this flag does that job without it.
//
// profiles.is_internal is read here rather than passed in, so every call site
// gets it. If the read fails the flag is simply not set: an unidentified
// internal account is a smaller cost than a sign-in that breaks.
export function identify(userId: string): void {
  if (typeof window === 'undefined') return
  void (async () => {
    let internal: boolean | undefined
    try {
      const { createClient } = await import('@/lib/supabase')
      const { data, error } = await createClient().from('profiles').select('is_internal').eq('id', userId).maybeSingle()
      if (error) console.warn('[demist] could not read is_internal for analytics:', error.code)
      else internal = data?.is_internal === true
    } catch { /* leave unset */ }
    const ph = await get()
    ph.identify(userId, internal === undefined ? undefined : { $internal_or_test_user: internal })
  })()
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

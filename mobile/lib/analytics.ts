// PostHog, mirroring web/lib/analytics.ts so iOS events land in the same
// project and the same health queries cover them. Every event carries
// app: 'ios' (a registered super property), so phone sessions can be told
// apart from web and desktop without guessing from $os.
//
// Nothing here may carry transcript text, term text or an email address.
import PostHog from 'posthog-react-native'
import { supabase } from './supabase'

type Props = Record<string, string | number | boolean | null | undefined>

const key = process.env.EXPO_PUBLIC_POSTHOG_KEY
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST

export const posthog: PostHog | null = key
  ? new PostHog(key, { host, captureAppLifecycleEvents: true })
  : null

posthog?.register({ app: 'ios' })

const clean = (p?: Props) => p && Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Record<string, string | number | boolean | null>

export function capture(event: string, props?: Props): void {
  try { posthog?.capture(event, clean(props)) } catch { /* analytics must never break the app */ }
}

/** Supabase writes resolve with { error } instead of throwing, so a
 *  try/catch around them catches nothing. Call this with the error. */
export function reportWriteFailure(op: string, error: { code?: string | null; message?: string | null } | null | undefined, extra?: Props): boolean {
  if (!error) return false
  console.error(`[demist] write failed (${op}):`, error.message)
  capture('write_failed', { op, code: error.code ?? null, message: error.message?.slice(0, 200) ?? null, ...extra })
  return true
}

export function reportError(name: string, props?: Props): void {
  console.error(`[demist] ${name}`, props ?? '')
  try { posthog?.captureException(new Error(name), clean(props)) } catch { /* ignore */ }
}

export async function identify(userId: string): Promise<void> {
  let internal: boolean | undefined
  try {
    const { data, error } = await supabase.from('profiles').select('is_internal').eq('id', userId).maybeSingle()
    if (!error) internal = data?.is_internal === true
  } catch { /* leave unset */ }
  try {
    posthog?.identify(userId, internal === undefined ? undefined : { $internal_or_test_user: internal })
  } catch { /* ignore */ }
}

export function resetAnalytics(): void {
  try { posthog?.reset(); posthog?.register({ app: 'ios' }) } catch { /* ignore */ }
}

import type { SupabaseClient } from '@supabase/supabase-js'
import { isElectronNative } from '@/lib/electronNative'
import { detectDesktopPlatform, isMobileUA, type DesktopPlatform } from '@/lib/platform'

// Gates recording on PLATFORM, not payment - deliberately separate from
// subscription.ts, which already has a similarly-shaped (currently disabled)
// recordings_per_month gate for the Pro paywall. Conflating the two would
// mean "give web a trial cap" and "gate a feature behind payment" fight over
// one flag and one number, when they're different questions: this one is
// about where recording HAPPENS (browser, paying real per-use OpenAI/Groq
// cost - see detect-terms/transcribe edge functions - vs the desktop app,
// on-device and free), not what plan the user is on.
export const WEB_TRIAL_ENABLED = true

// Lifetime, not monthly: the point is "try it, then install the real app",
// not "come back next month for more". Lives in code, not the database, so
// tuning this is a deploy, same reasoning as subscription.ts's LIMITS.
//
// Lowered from 5 to 3 (2026-09-17) to push desktop conversion sooner. Not
// lower than 3, deliberately: unlike the history limit, this one blocks
// recording outright, and only 16 of 44 users who record ever produce a
// single term. Cutting to 1-2 would wall people off before the product has
// demonstrably worked for them, which loses the marginal user rather than
// converting them.
export const WEB_TRIAL_RECORDING_LIMIT = 3

// 'mobile' is not a DesktopPlatform (there is no phone build to send anyone
// to) but it IS a distinct wall: the CTA has to say "on your laptop" rather
// than offering a download the device cannot run.
export type TrialPlatform = DesktopPlatform | 'mobile'

/**
 * How many free browser recordings are left, or null when this visitor has no
 * cap at all.
 *
 * Exported and used by BOTH the gate below and the dashboard's counter,
 * because they drifted three separate ways while they were two copies of the
 * same rule: the counter was computed once on mount and never again (so it
 * still said "3 left" after a recording), it did not know about
 * web_trial_exempt (migration 036, so exempt testers watched a countdown that
 * meant nothing), and it hid itself on mobile, which is capped. One function,
 * no round trips, nothing to keep in sync.
 *
 * null means "no cap": the desktop app, Linux, an unknown platform, or an
 * exempt account. The UI uses that to tell "unlimited here" apart from "none
 * left", which 0 would not distinguish.
 */
export function trialRemaining(sessionCount: number, exempt: boolean): number | null {
  if (!WEB_TRIAL_ENABLED) return null
  if (isElectronNative()) return null
  if (exempt) return null
  const platform: TrialPlatform | null = isMobileUA() ? 'mobile' : detectDesktopPlatform()
  if (!platform) return null
  return Math.max(0, WEB_TRIAL_RECORDING_LIMIT - sessionCount)
}

export interface TrialGateResult {
  allowed: boolean
  reason?: string
  remaining?: number
  platform?: TrialPlatform
}

// Counts existing `sessions` rows directly - no schema change needed. Counts
// every session regardless of capture_mode or how it was created: a user who
// already has desktop recordings isn't relying on the web trial to begin
// with, so the extra precision of a platform column isn't worth a migration
// for this.
export async function checkWebTrialLimit(supabase: SupabaseClient, userId: string): Promise<TrialGateResult> {
  if (!WEB_TRIAL_ENABLED) return { allowed: true }
  // The desktop app itself: never limited, regardless of plan.
  if (isElectronNative()) return { allowed: true }
  // Mobile is capped (2026-09-20). It was previously exempt on the grounds
  // that there is nowhere to send a phone user, which is true but was the
  // wrong conclusion: it made phones the LEAST restricted surface on the one
  // path that bills per use, for a platform that is explicitly not a target.
  // A phone user still has a laptop, so the download pitch survives; it just
  // has to be phrased for a different device.
  //
  // Linux and unknown stay exempt. Same "nowhere to send them" reasoning, but
  // unlike mobile they are not a declined target, just an unserved one.
  const platform: TrialPlatform | null = isMobileUA() ? 'mobile' : detectDesktopPlatform()
  if (!platform) return { allowed: true }

  // Both in parallel: the exemption is rare, so making every normal user wait
  // on a second round trip to discover they are not exempt would be the wrong
  // trade.
  const [{ count }, { data: profile }] = await Promise.all([
    supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('profiles').select('web_trial_exempt').eq('id', userId).maybeSingle(),
  ])

  // Internal testing only (migration 036). Every internal account is over the
  // cap, including the ones on Pro, which meant the web recording path could
  // not be smoke-tested at all. Deliberately NOT tied to the Pro plan: Pro
  // does not unlock web recording, and this must not become the thing that
  // quietly does.
  const used = count ?? 0
  const remaining = trialRemaining(used, !!profile?.web_trial_exempt)
  // null means no cap applies to this visitor at all.
  if (remaining === null) return { allowed: true }

  if (remaining <= 0) {
    return {
      allowed: false,
      platform,
      remaining: 0,
      reason: platform === 'mobile'
        ? `You've used all ${WEB_TRIAL_RECORDING_LIMIT} free recordings in your phone's browser.`
        : `You've used all ${WEB_TRIAL_RECORDING_LIMIT} free recordings in the browser.`,
    }
  }
  return { allowed: true, platform, remaining }
}

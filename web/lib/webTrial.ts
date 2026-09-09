import type { SupabaseClient } from '@supabase/supabase-js'
import { isElectronNative } from '@/lib/electronNative'
import { detectDesktopPlatform, type DesktopPlatform } from '@/lib/platform'

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
// not "come back next month for five more". Real usage data (2026-09) shows
// ~4 sessions/user lifetime average already, so 5 is generous enough to
// reach the glossary/flashcard payoff (which needs more than one session)
// before the wall appears. Lives in code, not the database, so tuning this
// is a deploy, same reasoning as subscription.ts's LIMITS.
export const WEB_TRIAL_RECORDING_LIMIT = 5

export interface TrialGateResult {
  allowed: boolean
  reason?: string
  remaining?: number
  platform?: DesktopPlatform
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
  const platform = detectDesktopPlatform()
  // Linux, mobile, or unknown: no desktop app exists to send them to, so
  // walling them off here would just lose them for nothing.
  if (!platform) return { allowed: true }

  const { count } = await supabase
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  const used = count ?? 0

  if (used >= WEB_TRIAL_RECORDING_LIMIT) {
    return {
      allowed: false,
      platform,
      remaining: 0,
      reason: `You've used all ${WEB_TRIAL_RECORDING_LIMIT} free recordings in the browser.`,
    }
  }
  return { allowed: true, platform, remaining: WEB_TRIAL_RECORDING_LIMIT - used }
}

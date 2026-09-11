import type { SupabaseClient } from '@supabase/supabase-js'

// Flip this to activate the paywall. Until then every check returns allowed.
export const PAYWALL_ENABLED = false

// Separate from PAYWALL_ENABLED above, which gates the free-tier recording/
// terms LIMITS (a different, still-unused lever - see PLANS below). This one
// controls whether PaywallModal shows real Stripe checkout buttons or the
// pre-launch "join the waitlist" copy. Flip to true only once
// STRIPE_SECRET_KEY, STRIPE_PRICE_ID_MONTHLY, STRIPE_PRICE_ID_ANNUAL, and
// STRIPE_WEBHOOK_SECRET are actually set as Supabase Edge Function secrets
// and the stripe-checkout/stripe-webhook/stripe-portal functions are
// deployed (migration 030 has the DB side) - flipping it before that makes
// every "Upgrade" button fail with a real, confusing error instead of
// nothing happening.
export const PRO_LIVE = false

export const PLANS = {
  free: {
    recordings_per_month: 10,
    terms_total: 200,
  },
  pro: {
    recordings_per_month: Infinity,
    terms_total: Infinity,
  },
} as const

type PlanName = keyof typeof PLANS

interface LimitResult {
  allowed: boolean
  reason?: string
}

async function getPlan(supabase: SupabaseClient, userId: string): Promise<PlanName> {
  const { data } = await supabase
    .from('subscriptions')
    .select('plan')
    .eq('user_id', userId)
    .maybeSingle()
  return (data?.plan === 'pro' ? 'pro' : 'free')
}

export async function checkRecordingLimit(supabase: SupabaseClient, userId: string): Promise<LimitResult> {
  if (!PAYWALL_ENABLED) return { allowed: true }
  try {
    const plan = await getPlan(supabase, userId)
    const limit = PLANS[plan].recordings_per_month
    if (limit === Infinity) return { allowed: true }

    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const { count } = await supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('started_at', monthStart.toISOString())

    if ((count ?? 0) >= limit) {
      return {
        allowed: false,
        reason: `You have used all ${limit} free recordings this month. Upgrade to Pro for unlimited recordings.`,
      }
    }
    return { allowed: true }
  } catch {
    // Never block a user on a gate error
    return { allowed: true }
  }
}

export async function checkTermsLimit(supabase: SupabaseClient, userId: string): Promise<LimitResult> {
  if (!PAYWALL_ENABLED) return { allowed: true }
  try {
    const plan = await getPlan(supabase, userId)
    const limit = PLANS[plan].terms_total
    if (limit === Infinity) return { allowed: true }

    const { count } = await supabase
      .from('terms')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    if ((count ?? 0) >= limit) {
      return {
        allowed: false,
        reason: `You have reached the ${limit}-term limit on the free plan. Upgrade to Pro for an unlimited glossary.`,
      }
    }
    return { allowed: true }
  } catch {
    return { allowed: true }
  }
}

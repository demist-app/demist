'use client'

// Plan limits live in code, not the database, so changing a cap is a deploy
// rather than a migration. subscriptions.plan ('free' | 'pro', migration 004)
// is the single source of truth for which column applies.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

export type Plan = 'free' | 'pro'

export const LIMITS: Record<Plan, {
  historyDays: number | null      // null = unlimited
  summariesPerWeek: number | null
  ankiExport: boolean
}> = {
  // 7 days, not 30. Measured against real usage: at 30 days only 9 of 55
  // active users had anything locked behind Pro, and the median account is
  // 11 days old, so almost nobody ever reached the wall. At 7 it reaches 36
  // of 55. History is also the only lever that works on this user base -
  // every volume-based cap (recordings per month, summaries per week) keys
  // on usage nobody has yet: a 10/month recording cap would currently affect
  // two accounts, both internal.
  //
  // It is the safe lever to be aggressive with, too: shortening history
  // blocks nobody from recording, so activation is untouched. Only looking
  // backwards costs money, which is exactly the "keep your whole semester"
  // pitch landing at the moment a student wants last week's lecture back.
  free: { historyDays: 7, summariesPerWeek: 10, ankiExport: false },
  pro:  { historyDays: null, summariesPerWeek: null, ankiExport: true },
}

// Everything not listed above is free for everyone, permanently:
// live definitions, glossary, flashcards, every capture mode, consent features.

export function useEntitlements() {
  const [plan, setPlan] = useState<Plan>('free')
  const [periodEnd, setPeriodEnd] = useState<string | null>(null)
  const [hasStripeCustomer, setHasStripeCustomer] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    createClient()
      .from('subscriptions')
      .select('plan, current_period_end, stripe_customer_id')
      .maybeSingle()
      .then(({ data }: { data: { plan: string; current_period_end: string | null; stripe_customer_id: string | null } | null }) => {
        // current_period_end is the actual source of truth (migration 030),
        // not the plan column alone: a row can say plan='pro' while its
        // period has already lapsed (a cancelled subscription Stripe hasn't
        // gotten around to flipping back to 'free' yet, or the tail end of
        // a waitlist-granted free month) - checking the date here means
        // every caller gets the right answer immediately, with no cron job
        // required to "expire" anyone and nothing that can silently fail to
        // run.
        const stillCurrent = !data?.current_period_end || new Date(data.current_period_end) > new Date()
        setPlan(data?.plan === 'pro' && stillCurrent ? 'pro' : 'free')
        setPeriodEnd(data?.current_period_end ?? null)
        // A waitlist-granted free month (migration 030) has no Stripe object
        // behind it at all, so there's nothing to manage or auto-renew -
        // callers use this to distinguish that case from a real subscription.
        setHasStripeCustomer(!!data?.stripe_customer_id)
        setLoaded(true)
      })
  }, [])

  return { plan, limits: LIMITS[plan], loaded, isPro: plan === 'pro', periodEnd, hasStripeCustomer }
}

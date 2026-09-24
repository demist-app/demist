'use client'

// Client-side access to the entitlement rule in entitlementRules.ts: the
// fetcher for non-React callers and the hook. The rule itself lives there so
// server code can share it.

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase'
import { resolveEntitlement, LIMITS, type Entitlement, type SubscriptionRow } from '@/lib/entitlementRules'

export * from '@/lib/entitlementRules'

const SUB_COLUMNS = 'plan, current_period_end, stripe_customer_id, stripe_subscription_id'

/** For non-React callers (the web trial gate). One parallel round trip. */
export async function fetchEntitlement(supabase: SupabaseClient, userId: string): Promise<Entitlement> {
  const [{ data: sub }, { data: { session } }] = await Promise.all([
    supabase.from('subscriptions').select(SUB_COLUMNS).eq('user_id', userId).maybeSingle(),
    // getSession, not getUser: created_at is on the locally cached user, so
    // this costs no extra network call.
    supabase.auth.getSession(),
  ])
  return resolveEntitlement(sub as SubscriptionRow | null, session?.user?.created_at ?? null)
}

export function useEntitlements() {
  const [ent, setEnt] = useState<Entitlement>({ plan: 'free', source: 'free', periodEnd: null, daysLeft: null, lapsedAt: null })
  const [hasStripeCustomer, setHasStripeCustomer] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const sb = createClient()
    Promise.all([
      sb.from('subscriptions').select(SUB_COLUMNS).maybeSingle(),
      sb.auth.getSession(),
    ]).then(([{ data }, { data: { session } }]) => {
      const sub = data as SubscriptionRow | null
      setEnt(resolveEntitlement(sub, session?.user?.created_at ?? null))
      // The manage-subscription button needs a Stripe customer to open the
      // portal against; comped months and trials have none.
      setHasStripeCustomer(!!sub?.stripe_customer_id)
      setLoaded(true)
    })
  }, [])

  return {
    plan: ent.plan,
    source: ent.source,
    limits: LIMITS[ent.plan],
    loaded,
    isPro: ent.plan === 'pro',
    isTrial: ent.source === 'trial',
    periodEnd: ent.periodEnd,
    daysLeft: ent.daysLeft,
    lapsedAt: ent.lapsedAt,
    hasStripeCustomer,
  }
}

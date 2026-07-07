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
  packsOwned: number | null
  ankiExport: boolean
}> = {
  free: { historyDays: 30, summariesPerWeek: 10, packsOwned: 1, ankiExport: false },
  pro:  { historyDays: null, summariesPerWeek: null, packsOwned: null, ankiExport: true },
}

// Everything not listed above is free for everyone, permanently:
// live definitions, glossary, flashcards, every capture mode, consent features.

export function useEntitlements() {
  const [plan, setPlan] = useState<Plan>('free')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    createClient()
      .from('subscriptions')
      .select('plan')
      .maybeSingle()
      .then(({ data }: { data: { plan: string } | null }) => {
        setPlan(data?.plan === 'pro' ? 'pro' : 'free')
        setLoaded(true)
      })
  }, [])

  return { plan, limits: LIMITS[plan], loaded, isPro: plan === 'pro' }
}

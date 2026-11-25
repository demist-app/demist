'use client'

// The first-week offer on the dashboard (lib/firstWeek.ts). Only while the
// account is under a week old, only when a coupon is set in Stripe, and gone
// for good once dismissed. Opens the Pro screen, which shows the same deal.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'
import { useEntitlements } from '@/lib/entitlements'
import { firstWeekEndsAt, offerAmount, endsText, type FirstWeekCoupon } from '@/lib/firstWeek'

const DISMISSED = 'demist_first_week_offer_dismissed'

export function FirstWeekOffer({ onOpen }: { onOpen: () => void }) {
  const { source, loaded } = useEntitlements()
  const [text, setText] = useState<{ offer: string; full: string; ends: string } | null>(null)

  useEffect(() => {
    if (!loaded || source === 'paid') return
    try { if (localStorage.getItem(DISMISSED)) return } catch { /* show it */ }
    let cancelled = false
    const sb = createClient()
    Promise.all([sb.auth.getUser(), sb.functions.invoke('stripe-prices')]).then(([{ data: u }, { data: p }]) => {
      const end = firstWeekEndsAt(u.user?.created_at)
      const year = p?.year as { unitAmount: number; currency: string } | null
      const coupon = (p?.firstWeek ?? null) as FirstWeekCoupon
      if (cancelled || !end || !year?.unitAmount || !coupon || u.user?.is_anonymous) return
      const amount = offerAmount(year.unitAmount, coupon)
      if (amount === null) return
      const fmt = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: year.currency }).format(n / 100)
      setText({ offer: fmt(amount), full: fmt(year.unitAmount), ends: endsText(end) })
      capture('first_week_offer_shown', {})
    }).catch(() => {})
    return () => { cancelled = true }
  }, [loaded, source])

  if (!text) return null
  return (
    <div className="w-full max-w-md mx-auto mt-6 rounded-2xl border dark:border-brand-500/25 border-brand-200 dark:bg-brand-500/[0.06] bg-brand-50/70 px-4 py-3 flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold dark:text-white/90 text-gray-900">Your first-week offer: Pro for {text.offer} a year</p>
        <p className="text-[12px] dark:text-white/60 text-gray-600 mt-0.5">Full notes from every lecture. {text.full} a year after the first year. The offer {text.ends}.</p>
      </div>
      <button onClick={() => { capture('first_week_offer_clicked', {}); onOpen() }} className="shrink-0 px-3 py-2 rounded-xl bg-brand-600 hover:brightness-110 text-white text-[12px] font-semibold transition-[filter]">
        See Pro
      </button>
      <button
        onClick={() => { try { localStorage.setItem(DISMISSED, '1') } catch { /* fine */ } capture('first_week_offer_dismissed', {}); setText(null) }}
        aria-label="Dismiss offer"
        className="shrink-0 text-gray-500 hover:dark:text-white/70 hover:text-gray-800 text-[18px] leading-none px-1"
      >
        ×
      </button>
    </div>
  )
}

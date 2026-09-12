'use client'

// Two different jobs depending on PRO_LIVE (subscription.ts): pre-launch,
// this is a waitlist. Once Pro actually has real Stripe checkout wired up
// and PRO_LIVE flips true, it's a real upgrade prompt - kept in one
// component because every existing call site (Anki export, history cap,
// packs cap, the post-session nudge) just wants "show the Pro pitch here"
// and shouldn't need to know or care which era it's showing.

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { loadStripe } from '@stripe/stripe-js'
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from '@stripe/react-stripe-js'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'
import { PRO_LIVE } from '@/lib/subscription'

const PRO_POINTS = [
  'Unlimited session history',
  'Unlimited AI summaries',
  'Export flashcards to Anki',
  'Unlimited course packs',
]

// Loaded once at module scope, same pattern Stripe's own docs use - calling
// loadStripe() again on every render/reopen would inject a second copy of
// Stripe.js.
const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY)
  : null

type PriceInfo = { unitAmount: number; currency: string } | null
type Prices = { month: PriceInfo; year: PriceInfo }

function formatPrice(p: PriceInfo): string | null {
  if (!p?.unitAmount) return null
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: p.currency, minimumFractionDigits: 2 })
      .format(p.unitAmount / 100)
  } catch {
    return `$${(p.unitAmount / 100).toFixed(2)}`
  }
}

export function PaywallModal({
  source,
  onClose,
}: {
  source: string          // which gate triggered this, e.g. 'anki_export'
  onClose: () => void
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'already'>('idle')
  const [checkoutInterval, setCheckoutInterval] = useState<'month' | 'year'>('year')
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [checkoutError, setCheckoutError] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [prices, setPrices] = useState<Prices | null>(null)

  useEffect(() => {
    // Distinct event name once this is a real purchase opportunity, per the
    // P2 brief's own instrumentation ask - paywall_shown (pre-launch) keeps
    // its existing history rather than being silently renamed out from
    // under it.
    capture(PRO_LIVE ? 'paywall_viewed' : 'paywall_shown', { source })
    if (!PRO_LIVE) {
      const sb = createClient()
      Promise.all([
        sb.auth.getSession(),
        sb.from('pro_waitlist').select('id').maybeSingle(),
      ]).then(([{ data: { session } }, { data: row }]) => {
        if (session?.user?.email) setEmail(session.user.email)
        if (row) setState('already')
      })
      return
    }
    // No auth required by the function itself (see its own comment on why),
    // but every call site of this modal lives behind the (app) layout's
    // session gate anyway, so invoke() always has a JWT to attach.
    createClient().functions.invoke('stripe-prices').then(({ data }) => {
      if (data) setPrices(data)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  const savingsPct = useMemo(() => {
    if (!prices?.month?.unitAmount || !prices?.year?.unitAmount) return null
    const pct = 100 - (prices.year.unitAmount / (prices.month.unitAmount * 12)) * 100
    return pct > 1 ? Math.round(pct) : null
  }, [prices])

  const startCheckout = async () => {
    if (checkoutLoading) return
    setCheckoutLoading(true)
    setCheckoutError(false)
    try {
      const sb = createClient()
      const { data, error } = await sb.functions.invoke('stripe-checkout', { body: { interval: checkoutInterval } })
      if (error || !data?.clientSecret) { setCheckoutError(true); setCheckoutLoading(false); return }
      capture('paywall_checkout_started', { source, interval: checkoutInterval })
      setClientSecret(data.clientSecret)
    } catch {
      setCheckoutError(true)
      setCheckoutLoading(false)
    }
  }

  const handleComplete = () => {
    capture('paywall_converted', { source, interval: checkoutInterval })
    onClose()
    router.push('/profile?checkout=success')
  }

  // Same endpoint as the landing page, so a join from here is confirmed the
  // same way. It used to upsert directly with the anon key; that grant is gone
  // (migration 026) and a row written from a browser could never be verified
  // anyway - there is no token and no email behind it.
  const join = async () => {
    if (!email.trim()) return
    setState('saving')
    try {
      const res = await fetch('/api/waitlist/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setState('idle'); return }
      capture('paywall_waitlist_requested', { source, outcome: data?.status ?? 'sent' })
      setState(data?.status === 'already_verified' ? 'already' : 'done')
    } catch {
      setState('idle')
    }
  }

  const monthText = formatPrice(prices?.month ?? null)
  const yearText = formatPrice(prices?.year ?? null)
  const selectedPriceText = checkoutInterval === 'year' ? yearText : monthText

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 dark:bg-black/60 bg-black/30"
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md dark:bg-[#0d0d1c] bg-[#FDFCF9] border dark:border-white/[0.08] border-black/[0.12] rounded-[28px] shadow-2xl overflow-hidden">
        <div className="p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 dark:bg-amber-500/[0.12] bg-amber-500/[0.14] border dark:border-amber-500/25 border-amber-600/25"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-amber-600 dark:text-amber-400">
                  <path fill="currentColor" d="M12 1.5l2.6 6.6 7.1.5-5.5 4.5 1.9 6.9L12 15.9l-6.1 4.1 1.9-6.9-5.5-4.5 7.1-.5z" />
                </svg>
              </div>
              <div>
                <p className="text-[17px] font-bold dark:text-white text-gray-900 leading-tight">
                  {PRO_LIVE ? 'Demist Pro' : "This one's part of Pro"}
                </p>
                {PRO_LIVE && (
                  <p className="text-[12px] dark:text-white/40 text-gray-500 mt-0.5">Everything, unlimited</p>
                )}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:dark:text-white/60 hover:text-gray-700 text-[20px] leading-none shrink-0 p-1 -m-1 transition-colors">×</button>
          </div>

          {!PRO_LIVE && (
            <p className="text-[13px] dark:text-white/60 text-gray-600 leading-relaxed">
              Pro isn&apos;t live yet. Everything you already use stays free. Join the list and you&apos;ll get Pro free for a month when it launches.
            </p>
          )}

          <ul className="space-y-2">
            {PRO_POINTS.map(p => (
              <li key={p} className="text-[13px] dark:text-white/70 text-gray-700 flex items-center gap-2.5">
                <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0 dark:bg-amber-500/20 bg-amber-500/20 text-amber-600 dark:text-amber-400">
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                </span>
                {p}
              </li>
            ))}
          </ul>

          {PRO_LIVE && !clientSecret && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {(['year', 'month'] as const).map(i => {
                  const active = checkoutInterval === i
                  const price = i === 'year' ? yearText : monthText
                  return (
                    <button
                      key={i}
                      onClick={() => setCheckoutInterval(i)}
                      className={`relative rounded-2xl p-3 text-left border transition-colors ${
                        active
                          ? 'bg-amber-600/[0.1] border-amber-600/40'
                          : 'dark:bg-white/[0.03] bg-black/[0.02] dark:border-white/[0.08] border-black/[0.08] hover:dark:bg-white/[0.05] hover:bg-black/[0.04]'
                      }`}
                    >
                      {i === 'year' && savingsPct && (
                        <span className="absolute -top-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-600 text-white">
                          Save {savingsPct}%
                        </span>
                      )}
                      <p className={`text-[12px] font-medium ${active ? 'text-amber-700 dark:text-amber-400' : 'dark:text-white/60 text-gray-600'}`}>
                        {i === 'year' ? 'Annual' : 'Monthly'}
                      </p>
                      <p className="text-[17px] font-bold dark:text-white text-gray-900 mt-0.5 tabular-nums">
                        {price ?? '···'}<span className="text-[12px] font-medium dark:text-white/40 text-gray-500">/{i === 'year' ? 'yr' : 'mo'}</span>
                      </p>
                    </button>
                  )
                })}
              </div>
              <button
                onClick={startCheckout}
                disabled={checkoutLoading}
                className="w-full py-3.5 rounded-2xl bg-amber-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150 disabled:opacity-50"
              >
                {checkoutLoading ? 'Loading checkout…' : `Continue${selectedPriceText ? ` — ${selectedPriceText}/${checkoutInterval === 'year' ? 'year' : 'month'}` : ''}`}
              </button>
              {checkoutError && (
                <p className="text-[12px] text-red-400 text-center">Couldn&apos;t start checkout. Try again in a moment.</p>
              )}
              <p className="text-[11px] dark:text-white/30 text-gray-400 text-center">Cancel anytime. Payments handled securely by Stripe.</p>
            </div>
          )}

          {!PRO_LIVE && (
            state === 'done' || state === 'already' ? (
              <p className="text-[13px] dark:text-white/70 text-gray-700 py-2">
                {state === 'done'
                  ? 'Check your inbox and confirm your email to save your place.'
                  : 'You’re already on the list ✓'}
              </p>
            ) : (
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@university.ac.uk"
                  className="flex-1 rounded-xl px-3 py-2.5 text-[13px] bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] outline-none dark:text-white text-gray-900 placeholder:text-gray-400 placeholder:dark:text-white/30"
                />
                <button
                  onClick={join}
                  disabled={state === 'saving' || !email.trim()}
                  className="shrink-0 px-4 py-2.5 rounded-xl bg-amber-600 text-white text-[13px] font-semibold active:scale-[0.97] transition-transform disabled:opacity-40"
                >
                  {state === 'saving' ? '…' : 'Join waitlist'}
                </button>
              </div>
            )
          )}
        </div>

        {/* Embedded Checkout: an iframe on THIS page, not a redirect to
            checkout.stripe.com. Matters most in the desktop app, where any
            top-level navigation off-origin gets kicked out to the OS
            browser (main.js's will-navigate handler) - a redirect there
            looked like checkout abandoning the app entirely. */}
        {PRO_LIVE && clientSecret && stripePromise && (
          <div className="dark:bg-white bg-white" style={{ minHeight: 420 }}>
            <EmbeddedCheckoutProvider
              stripe={stripePromise}
              options={{ clientSecret, onComplete: handleComplete }}
            >
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          </div>
        )}
      </div>
    </div>
  )
}

'use client'

// The decision moment for anyone whose Pro is a trial or a comped month.
//
// WHY. As of 2026-09-23 no stranger has ever paid, and nobody had ever been
// put in front of the question: the paywall appeared when someone happened to
// press Upgrade, never because something they owned was about to change. The
// reverse trial (entitlements.ts) and the comped October months both end on a
// known date, and that ending is the one moment every subscription product
// that gets paid engineers on purpose. This makes it visible instead of
// letting Pro silently lapse and lectures silently lock.
//
// Two states, both concrete rather than promotional:
//
//   ending  - the final 7 days of a trial or comped month. Names what they
//             have built and exactly what changes, then offers to keep it.
//   ended   - within 14 days of it ending, and only when something is actually
//             locked. "12 lectures are now locked" is a fact on their screen,
//             not a pitch.
//
// Never shown to paid users (nothing is ending), to free users who never had
// Pro (nothing to lose), to anyone with no lectures (the loss is empty and the
// message would ring hollow), or during a recording.
//
// Dismissal lasts until the next day, not forever. In the final week a daily
// reminder is honest, because the date really is getting closer; a permanent
// dismissal on day 7 would hide the one fact that matters on day 1.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'
import { useEntitlements, LIMITS } from '@/lib/entitlements'
import { isElectronNative } from '@/lib/electronNative'

const DISMISS_KEY = 'demist_pro_expiry_dismissed'
const WARN_DAYS = 7
const AFTER_DAYS = 14
const DAY_MS = 86_400_000
const FREE_HISTORY_DAYS = LIMITS.free.historyDays ?? 7

type NoticeState = 'ending' | 'ended'

export function ProExpiryNotice({ onUpgrade }: { onUpgrade: () => void }) {
  const { loaded, source, daysLeft, lapsedAt, periodEnd } = useEntitlements()
  const [counts, setCounts] = useState<{ sessions: number; terms: number; locked: number } | null>(null)
  const [dismissed, setDismissed] = useState(true)

  const state: NoticeState | null =
    (source === 'trial' || source === 'comped') && daysLeft !== null && daysLeft <= WARN_DAYS
      ? 'ending'
      : source === 'free' && lapsedAt && Date.now() - new Date(lapsedAt).getTime() < AFTER_DAYS * DAY_MS
        ? 'ended'
        : null

  useEffect(() => {
    if (!loaded || !state) return
    let cancelled = false
    try {
      const raw = localStorage.getItem(DISMISS_KEY)
      // Dismissed today, for this state, stays dismissed until tomorrow.
      setDismissed(raw === `${state}:${new Date().toDateString()}`)
    } catch {
      setDismissed(false)
    }
    ;(async () => {
      const sb = createClient()
      const { data: { session } } = await sb.auth.getSession()
      const uid = session?.user?.id
      if (!uid) return
      const lockBefore = new Date(Date.now() - FREE_HISTORY_DAYS * DAY_MS).toISOString()
      const [{ count: s }, { count: t }, { count: l }] = await Promise.all([
        sb.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        sb.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', uid),
        sb.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', uid).lt('started_at', lockBefore),
      ])
      if (!cancelled) setCounts({ sessions: s ?? 0, terms: t ?? 0, locked: l ?? 0 })
    })()
    return () => { cancelled = true }
  }, [loaded, state])

  const visible = !!state && !!counts && !dismissed && counts.sessions > 0 && (state === 'ending' || counts.locked > 0)

  useEffect(() => {
    if (!visible || !counts) return
    capture('pro_expiry_banner_shown', { state, source, days_left: daysLeft, sessions: counts.sessions, locked: counts.locked })
    // Once per mount is enough; the counts do not change while it is on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  if (!visible || !counts || !state) return null

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, `${state}:${new Date().toDateString()}`) } catch { /* nothing to do */ }
    capture('pro_expiry_banner_dismissed', { state, days_left: daysLeft })
    setDismissed(true)
  }

  const upgrade = () => {
    capture('pro_expiry_cta_clicked', { via: 'banner', state, source, days_left: daysLeft, sessions: counts.sessions, locked: counts.locked })
    onUpgrade()
  }

  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  const inBrowser = !isElectronNative()
  const kind = source === 'trial' ? 'Pro trial' : 'free month of Pro'

  let heading: string
  let body: string
  let cta: string
  if (state === 'ending') {
    const when = periodEnd
      ? new Date(periodEnd).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      : null
    heading = when
      ? `Your ${kind} ends on ${when}`
      : `Your ${kind} ends in ${n(daysLeft ?? 0, 'day', 'days')}`
    body = `You have ${n(counts.sessions, 'lecture', 'lectures')} and ${n(counts.terms, 'term', 'terms')} in Demist. `
      + (counts.locked > 0
        ? `${counts.locked === counts.sessions ? 'All of them are' : `${counts.locked} of those lectures are`} older than ${FREE_HISTORY_DAYS} days and will lock when it ends`
        : `After it ends, lectures older than ${FREE_HISTORY_DAYS} days lock`)
      + (inBrowser ? ' and recording in the browser goes back to its free limit' : '')
      + '. Live definitions, your glossary and flashcards stay free either way.'
    cta = 'Keep Pro'
  } else {
    heading = `${n(counts.locked, 'lecture is', 'lectures are')} now locked`
    body = `Your ${kind} has ended, so anything older than ${FREE_HISTORY_DAYS} days is hidden from your history. `
      + 'Nothing has been deleted: Pro unlocks all of it again straight away.'
    cta = 'Unlock them'
  }

  return (
    <div className="mx-auto w-full max-w-[680px] px-6 pt-4">
      <div className="rounded-2xl px-4 py-3.5 dark:bg-amber-500/[0.07] bg-amber-50 border dark:border-amber-500/20 border-amber-300/70">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold mb-1">{heading}</p>
            <p className="text-[13px] dark:text-white/60 text-gray-700 leading-relaxed">{body}</p>
          </div>
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="shrink-0 text-[18px] leading-none -mt-0.5 dark:text-white/30 text-gray-400 dark:hover:text-white/60 hover:text-gray-700 transition-colors"
          >
            ×
          </button>
        </div>
        <button
          onClick={upgrade}
          className="mt-3 px-4 py-2 rounded-xl bg-amber-600 hover:brightness-[1.1] text-white text-[13px] font-semibold transition-all active:scale-[0.97]"
        >
          {cta}
        </button>
      </div>
    </div>
  )
}

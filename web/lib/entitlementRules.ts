// The entitlement RULE, with no React and no 'use client', so server code
// (the Pro expiry email cron) applies exactly the rule the app does.
// entitlements.ts re-exports all of it; import from there in client code.
//
// Plan limits live in code, not the database, so changing a cap is a deploy
// rather than a migration. subscriptions.plan ('free' | 'pro', migration 004)
// records paid and comped Pro; the reverse trial below is derived from the
// account's creation date and needs no row at all.

export type Plan = 'free' | 'pro'
// Where a user's Pro comes from. Matters for everything around the decision
// moment: only 'comped' and 'trial' ever expire into free, and only 'paid' has
// a Stripe subscription behind it to manage.
export type PlanSource = 'paid' | 'comped' | 'trial' | 'free'

export const LIMITS: Record<Plan, {
  historyDays: number | null      // null = unlimited
  summariesPerWeek: number | null
  ankiExport: boolean
  // Unlimited recording in the browser. The web trial (webTrial.ts) caps free
  // browser recording at 3 lifetime sessions because it bills per use; Pro
  // lifts that. Measured cost is about $0.023 per lecture-hour, so even heavy
  // use is pennies against £4.99. Added 2026-09-23 because the trial wall was
  // the clearest purchase intent in the product (someone who wants to keep
  // recording right now) and it could only send them to a free download:
  // Pro did not actually solve their problem, so it could not be offered.
  webRecordingUnlimited: boolean
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
  // backwards costs money, which is exactly the "keep your whole term" pitch
  // landing at the moment a student wants last week's lecture back.
  free: { historyDays: 7, summariesPerWeek: 10, ankiExport: false, webRecordingUnlimited: false },
  pro:  { historyDays: null, summariesPerWeek: null, ankiExport: true, webRecordingUnlimited: true },
}

// Everything not listed above is free for everyone, permanently:
// live definitions, glossary, flashcards, every capture mode, consent features.

// ── Reverse trial ───────────────────────────────────────────────────────────
//
// Every account created from REVERSE_TRIAL_START gets full Pro for its first
// REVERSE_TRIAL_DAYS, then drops to free.
//
// Why 30 and not the 7 that was proposed: free already keeps 7 days of
// history, so 7 days of Pro from signup is indistinguishable from 7 days of
// free. Nothing is old enough to lock yet, the trial would end, and the user
// would notice no change at all. The decision moment only exists once their
// first lectures are older than a week; at 30 days the ending locks roughly
// three weeks of their own lectures, which is the thing Pro actually sells.
//
// Why not backdated to everyone: a clean cohort. Accounts from before this
// date never saw a trial, so they stay a comparison group rather than
// suddenly acquiring Pro they did not sign up with.
//
// Derived from auth.users.created_at rather than stored, so it needs no
// migration, cannot fall out of sync with a cron job, and ends on its own.
export const REVERSE_TRIAL_DAYS = 30
export const REVERSE_TRIAL_START = '2026-09-23T00:00:00Z'

const DAY_MS = 86_400_000

export interface SubscriptionRow {
  plan: string
  current_period_end: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

export interface Entitlement {
  plan: Plan
  source: PlanSource
  // When the current Pro ends (trial/comped) or renews (paid). null for free.
  periodEnd: string | null
  daysLeft: number | null
  // When Pro most recently ENDED for someone now on free: the expiry of a
  // comped month or of the reverse trial. Drives the "your Pro just ended"
  // notice, which is the moment someone first sees their lectures lock.
  lapsedAt: string | null
}

function daysUntil(iso: string, now: Date): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / DAY_MS))
}

/**
 * The single rule for what a user is entitled to. Used by the hook below AND
 * by webTrial.ts's gate, so the UI and the gate cannot disagree about whether
 * someone has Pro - two copies of a rule in this codebase have drifted apart
 * twice already (the web trial counter, and isEligibleForSummary).
 */
export function resolveEntitlement(
  sub: SubscriptionRow | null,
  userCreatedAt: string | null,
  now: Date = new Date(),
): Entitlement {
  // current_period_end is the source of truth (migration 030), not the plan
  // column alone: a row can say 'pro' after its period has lapsed, and
  // checking the date means nothing needs a cron job to expire anyone.
  const subIsPro = sub?.plan === 'pro'
  const subCurrent = subIsPro && (!sub?.current_period_end || new Date(sub.current_period_end) > now)
  if (subCurrent) {
    return {
      plan: 'pro',
      // A Stripe subscription id means someone paid. stripe_customer_id alone
      // does not: stripe-checkout writes it the moment checkout OPENS.
      source: sub?.stripe_subscription_id ? 'paid' : 'comped',
      periodEnd: sub?.current_period_end ?? null,
      daysLeft: sub?.current_period_end ? daysUntil(sub.current_period_end, now) : null,
      lapsedAt: null,
    }
  }

  let trialEnd: Date | null = null
  if (userCreatedAt && new Date(userCreatedAt) >= new Date(REVERSE_TRIAL_START)) {
    trialEnd = new Date(new Date(userCreatedAt).getTime() + REVERSE_TRIAL_DAYS * DAY_MS)
    if (trialEnd > now) {
      return {
        plan: 'pro',
        source: 'trial',
        periodEnd: trialEnd.toISOString(),
        daysLeft: daysUntil(trialEnd.toISOString(), now),
        lapsedAt: null,
      }
    }
  }

  // Free. Record when Pro last ended, if it ever did, whichever is later.
  const endings = [
    subIsPro && sub?.current_period_end && !sub.stripe_subscription_id ? new Date(sub.current_period_end) : null,
    trialEnd,
  ].filter((d): d is Date => d !== null && d <= now)
  const lapsed = endings.length ? new Date(Math.max(...endings.map(d => d.getTime()))) : null
  return { plan: 'free', source: 'free', periodEnd: null, daysLeft: null, lapsedAt: lapsed?.toISOString() ?? null }
}


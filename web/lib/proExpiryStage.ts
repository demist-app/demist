// Which Pro expiry email, if any, a user is due today. Pure, so it can be
// tested with node directly; the cron route (app/api/cron/pro-expiry) owns
// everything with side effects.

import { resolveEntitlement, type SubscriptionRow } from './entitlementRules'

export type ExpiryStage = 'minus7' | 'minus1' | 'day0'

const DAY_MS = 86_400_000
// How long after an ending the day-0 email may still go out. Two days, so one
// missed cron run does not lose it, but not so long that it arrives stale.
const DAY0_GRACE_MS = 2 * DAY_MS

export function stageFor(sub: SubscriptionRow | null, createdAt: string, now: Date): { stage: ExpiryStage; source: 'comped' | 'trial'; periodEnd: string } | null {
  const ent = resolveEntitlement(sub, createdAt, now)
  if (ent.source === 'paid') return null
  if ((ent.source === 'comped' || ent.source === 'trial') && ent.periodEnd) {
    const msLeft = new Date(ent.periodEnd).getTime() - now.getTime()
    // minus1 wins over minus7 inside the last day, so the two never land on
    // the same run for someone whose end date is already close.
    if (msLeft <= DAY_MS) return { stage: 'minus1', source: ent.source, periodEnd: ent.periodEnd }
    if (msLeft <= 7 * DAY_MS) return { stage: 'minus7', source: ent.source, periodEnd: ent.periodEnd }
    return null
  }
  if (ent.source === 'free' && ent.lapsedAt && now.getTime() - new Date(ent.lapsedAt).getTime() <= DAY0_GRACE_MS) {
    // Which kind of Pro just ended: the comped row's end, or the trial's.
    const compedEnd = sub?.plan === 'pro' && sub.current_period_end && !sub.stripe_subscription_id ? sub.current_period_end : null
    const source = compedEnd && new Date(compedEnd).getTime() === new Date(ent.lapsedAt).getTime() ? 'comped' : 'trial'
    return { stage: 'day0', source, periodEnd: ent.lapsedAt }
  }
  return null
}


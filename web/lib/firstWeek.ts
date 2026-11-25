// The first-week offer, as the page shows it. Who actually gets it is decided
// at checkout from the account's creation date (stripe-checkout), so this only
// has to be honest about the deadline. FIRST_WEEK_DAYS must match there.

export const FIRST_WEEK_DAYS = 7

export type FirstWeekCoupon = { amountOff: number | null; percentOff: number | null; currency: string | null; duration: string } | null

/** When this account's first week ends, or null once it has. */
export function firstWeekEndsAt(createdAt: string | null | undefined, now = Date.now()): Date | null {
  if (!createdAt) return null
  const end = Date.parse(createdAt) + FIRST_WEEK_DAYS * 86_400_000
  return end > now ? new Date(end) : null
}

/** The yearly price after the offer, in the price's smallest unit. */
export function offerAmount(yearUnitAmount: number, coupon: FirstWeekCoupon): number | null {
  if (!coupon) return null
  if (coupon.amountOff) return Math.max(0, yearUnitAmount - coupon.amountOff)
  if (coupon.percentOff) return Math.round(yearUnitAmount * (1 - coupon.percentOff / 100))
  return null
}

export function endsText(end: Date): string {
  const days = Math.ceil((end.getTime() - Date.now()) / 86_400_000)
  if (days <= 1) return 'ends today'
  // With the date: a week from a Wednesday is a Wednesday, and "ends
  // Wednesday" read as today.
  return `ends ${end.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '')}`
}

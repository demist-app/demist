// Which of Stripe's currencies to show a price in. Stripe Checkout charges in
// the buyer's local currency when the price has one (by where they are), so
// the Pro screen guesses the same way from the device's time zone and locale.
// Until 2026-11-25 it showed the US-dollar base to everyone, while UK students
// were charged in pounds.

export type LivePrice = { unitAmount: number; currency: string; options?: Record<string, number>; student?: boolean } | null

const EURO_ZONES = /^Europe\/(Paris|Berlin|Madrid|Rome|Athens|Amsterdam|Brussels|Vienna|Lisbon|Dublin|Helsinki|Luxembourg|Bratislava|Ljubljana|Tallinn|Riga|Vilnius|Valletta|Nicosia|Zagreb|Monaco|Andorra|San_Marino|Vatican|Podgorica)$/

export function localCurrency(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
    if (tz === 'Europe/London' || tz === 'Europe/Belfast' || tz === 'Europe/Guernsey' || tz === 'Europe/Jersey' || tz === 'Europe/Isle_of_Man') return 'gbp'
    if (EURO_ZONES.test(tz)) return 'eur'
    if (tz.startsWith('Australia/')) return 'aud'
    if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return 'inr'
    if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal)/.test(tz)) return 'cad'
  } catch { /* fall through */ }
  return 'usd'
}

/** The price in the buyer's currency when Stripe has one, else its base. */
export function localPrice(p: LivePrice): { unitAmount: number; currency: string } | null {
  if (!p?.unitAmount) return null
  const cur = localCurrency()
  const amount = p.options?.[cur]
  return amount != null ? { unitAmount: amount, currency: cur } : { unitAmount: p.unitAmount, currency: p.currency }
}

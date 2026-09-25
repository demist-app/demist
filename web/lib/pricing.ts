// Demist Pro's list prices, for STATIC copy: the FAQ, the home page's
// structured data, subject pages and emails. The paywall itself reads live
// prices from Stripe (stripe-prices edge function), which is the source of
// truth at checkout.
//
// If the Stripe prices change, change these in the same commit. They were
// hand-typed in five places before this existed, and structured data that
// disagrees with the checkout is exactly what an AI assistant will quote.
export const PRO_PRICE_GBP = { monthly: 4.99, yearly: 29.99 } as const

export const PRO_PRICE_TEXT = {
  monthly: `£${PRO_PRICE_GBP.monthly.toFixed(2)}`,
  yearly: `£${PRO_PRICE_GBP.yearly.toFixed(2)}`,
} as const

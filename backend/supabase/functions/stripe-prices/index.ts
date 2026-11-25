// Returns the actual monthly/annual amounts so the frontend can show a real
// price instead of nothing. No auth required - prices aren't secret, they're
// shown to signed-out visitors on the landing page's pricing section too.
// Never hardcodes an amount here either, same reasoning as stripe-checkout:
// changing a price in the Stripe Dashboard should not require a redeploy.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const ALLOWED_ORIGINS = ['https://demist.app', 'https://www.demist.app', 'http://localhost:3000', 'http://localhost:3001']

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  }
}

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

// The first-week offer's coupon (see stripe-checkout), described so the page
// can show it. Not who qualifies: that is decided at checkout.
const FIRST_WEEK_COUPON = Deno.env.get('STRIPE_FIRST_WEEK_COUPON')

const PRICE_BY_INTERVAL: Record<string, string | undefined> = {
  month: Deno.env.get('STRIPE_PRICE_ID_MONTHLY'),
  year: Deno.env.get('STRIPE_PRICE_ID_ANNUAL'),
}

serve(async (req) => {
  const origin = req.headers.get('origin')
  const CORS = corsHeaders(origin)
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const entries = await Promise.all(
      Object.entries(PRICE_BY_INTERVAL).map(async ([interval, id]) => {
        if (!id) return [interval, null] as const
        const price = await stripe.prices.retrieve(id)
        return [interval, { unitAmount: price.unit_amount, currency: price.currency }] as const
      }),
    )
    let firstWeek = null
    if (FIRST_WEEK_COUPON) {
      try {
        const c = await stripe.coupons.retrieve(FIRST_WEEK_COUPON)
        if (c.valid) firstWeek = { amountOff: c.amount_off, percentOff: c.percent_off, currency: c.currency, duration: c.duration }
      } catch (e) {
        // A coupon that is missing or mistyped means no offer, not no prices.
        console.error('stripe-prices: first-week coupon', (e as Error).message)
      }
    }
    return new Response(JSON.stringify({ ...Object.fromEntries(entries), firstWeek }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('stripe-prices error:', e)
    return new Response(JSON.stringify({ error: 'prices_failed' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})

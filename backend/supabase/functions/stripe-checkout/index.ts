// Creates a Stripe Checkout Session for the authenticated user and returns
// its URL. The frontend never talks to Stripe directly and never sees a
// secret key - it POSTs { interval: 'month' | 'year' }, gets a URL back, and
// redirects to it. Actual pricing lives entirely in Stripe (the Price
// objects behind STRIPE_PRICE_ID_MONTHLY/STRIPE_PRICE_ID_ANNUAL): this
// function never hardcodes an amount, so changing the price is a Stripe
// Dashboard edit, not a redeploy.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
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

const PRICE_BY_INTERVAL: Record<string, string | undefined> = {
  month: Deno.env.get('STRIPE_PRICE_ID_MONTHLY'),
  year: Deno.env.get('STRIPE_PRICE_ID_ANNUAL'),
}

// Same origin used across every platform this app runs in - the desktop app
// (Windows Store, Mac beta) loads this exact deployed site inside Electron
// per its own architecture, so a checkout started there returns to the same
// URL and picks the session back up there too. No separate desktop path
// needed.
const APP_ORIGIN = 'https://www.demist.app'

serve(async (req) => {
  const origin = req.headers.get('origin')
  const CORS = corsHeaders(origin)

  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
  const token = authHeader.slice(7)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }

  try {
    const { interval } = await req.json()
    const priceId = PRICE_BY_INTERVAL[interval]
    if (!priceId) {
      return new Response(JSON.stringify({ error: 'invalid_interval' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' },
      })
    }

    // Reuse the existing Stripe customer if this user has one (from a
    // previous checkout, even one that was abandoned) rather than minting a
    // new one every time - keeps Stripe's own customer list from
    // accumulating duplicates for the same real person.
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle()

    let customerId = sub?.stripe_customer_id ?? undefined
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id
      // service_role, not the user's own JWT: this table's UPDATE grant for
      // `authenticated` was deliberately never given (migration 004/024 only
      // ever granted SELECT to that role) - a user rewriting their own
      // stripe_customer_id from the browser would be a real problem, so this
      // write goes through the admin client instead, same pattern as
      // stripe-webhook.
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
      await admin.from('subscriptions').update({ stripe_customer_id: customerId }).eq('user_id', user.id)
    }

    // Embedded, not hosted: the frontend renders this session's client_secret
    // inline via @stripe/react-stripe-js instead of redirecting the page to
    // checkout.stripe.com. Matters most in the desktop app, whose window
    // treats any top-level navigation off its own origin as "leaving the
    // app" (main.js's will-navigate handler hands it to the OS browser
    // instead) - a full-page redirect there looked like checkout dumping the
    // user out to a different website entirely. Embedded Checkout's iframe
    // is same-page content, not a navigation, so none of that ever fires.
    // redirect_on_completion defaults to 'if_required': a normal card
    // payment completes via the onComplete callback with no redirect at
    // all; return_url only gets used for the rare payment method that
    // inherently requires one (some bank redirects).
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      ui_mode: 'embedded',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      return_url: `${APP_ORIGIN}/profile?checkout=success`,
      client_reference_id: user.id,
      subscription_data: { metadata: { supabase_user_id: user.id } },
    })

    return new Response(JSON.stringify({ clientSecret: session.client_secret }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    console.error('stripe-checkout error:', e)
    return new Response(JSON.stringify({ error: 'checkout_failed' }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})

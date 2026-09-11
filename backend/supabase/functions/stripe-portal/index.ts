// Returns a Stripe Billing Portal URL for the authenticated user - lets them
// see invoices, update their card, or cancel, without building any of that
// UI here. A subscription with no way to cancel isn't a real subscription.
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
const APP_ORIGIN = 'https://www.demist.app'

serve(async (req) => {
  const origin = req.headers.get('origin')
  const CORS = corsHeaders(origin)
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const { data: sub } = await supabase.from('subscriptions').select('stripe_customer_id').eq('user_id', user.id).maybeSingle()
  // No Stripe customer yet: either still on the free plan, or on the
  // waitlist-granted free month (which deliberately has no Stripe object
  // behind it at all - see migration 030). Nothing to manage in Stripe for
  // either case.
  if (!sub?.stripe_customer_id) {
    return new Response(JSON.stringify({ error: 'no_stripe_customer' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${APP_ORIGIN}/profile`,
    })
    return new Response(JSON.stringify({ url: portalSession.url }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error('stripe-portal error:', e)
    return new Response(JSON.stringify({ error: 'portal_failed' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }
})

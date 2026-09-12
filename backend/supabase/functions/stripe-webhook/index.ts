// Stripe calls this directly - no Supabase user JWT, no CORS (server to
// server), authenticity comes entirely from the signature on the raw body.
// Runs as service_role because of that: there is no user session to act as,
// and `authenticated` was never granted UPDATE on subscriptions anyway (see
// migration 030's comment - a user rewriting their own plan from the browser
// would be a real problem).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })
const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// Pro while Stripe considers the subscription genuinely current. `trialing`
// is included for completeness even though nothing in this product's own
// checkout sets up a Stripe-side trial today (the waitlist's free month is
// granted directly in the database instead - see migration 030 - precisely
// so it needs no Stripe subscription object at all).
const ACTIVE_STATUSES = new Set(['active', 'trialing'])

async function syncFromSubscription(sub: Stripe.Subscription) {
  const status = sub.status
  const plan = ACTIVE_STATUSES.has(status) ? 'pro' : 'free'
  const periodEnd = new Date(sub.current_period_end * 1000).toISOString()
  const interval = sub.items.data[0]?.price?.recurring?.interval ?? null
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id

  const update = { plan, stripe_subscription_id: sub.id, current_period_end: periodEnd, price_interval: interval }
  const { data, error } = await admin
    .from('subscriptions')
    .update(update)
    .eq('stripe_customer_id', customerId)
    .select('user_id')

  if (error) {
    console.error('subscriptions update failed:', error.message, 'for customer', customerId)
    return
  }

  // Matched zero rows without erroring is the dangerous case, not the loud
  // one: a paying customer whose plan silently never flips to 'pro', with
  // nothing here to explain why. Falls back to the supabase_user_id that
  // stripe-checkout always stamps into subscription_data.metadata - if the
  // row's stripe_customer_id ever drifts from what this event carries (a
  // customer created but never persisted, a customer merged/replaced in
  // Stripe), this still finds the right user instead of losing the sync.
  if (data.length === 0) {
    const userId = sub.metadata?.supabase_user_id
    console.error(
      `subscriptions update matched 0 rows for customer ${customerId} (event for sub ${sub.id}) - `
      + `falling back to metadata.supabase_user_id=${userId ?? 'MISSING'}`,
    )
    if (!userId) return
    const { error: fallbackError, data: fallbackData } = await admin
      .from('subscriptions')
      .update({ ...update, stripe_customer_id: customerId })
      .eq('user_id', userId)
      .select('user_id')
    if (fallbackError) console.error('fallback update failed:', fallbackError.message, 'for user', userId)
    else if (fallbackData.length === 0) console.error('fallback update ALSO matched 0 rows for user', userId, '- no subscriptions row exists for them at all')
  }
}

serve(async (req) => {
  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('missing signature', { status: 400 })

  // MUST be the raw, unparsed body - Stripe signs the exact bytes it sent,
  // and even reformatting whitespace after JSON.parse would break
  // verification. constructEventAsync (not the sync constructEvent) because
  // Deno's SubtleCrypto is async-only; the sync version throws here.
  const rawBody = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, WEBHOOK_SECRET)
  } catch (e) {
    console.error('signature verification failed:', e)
    return new Response('invalid signature', { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode !== 'subscription' || !session.subscription) break
        const sub = await stripe.subscriptions.retrieve(
          typeof session.subscription === 'string' ? session.subscription : session.subscription.id,
        )
        await syncFromSubscription(sub)
        break
      }
      // Covers renewals, plan/interval switches, and Stripe's own dunning
      // (past_due, unpaid) - one handler for all of it, since all of them
      // just mean "re-read the subscription's current truth".
      case 'customer.subscription.updated':
      case 'customer.subscription.created': {
        await syncFromSubscription(event.data.object as Stripe.Subscription)
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const { error } = await admin
          .from('subscriptions')
          .update({ plan: 'free' })
          .eq('stripe_customer_id', typeof sub.customer === 'string' ? sub.customer : sub.customer.id)
        if (error) console.error('subscriptions downgrade failed:', error.message)
        break
      }
      default:
        // Deliberately silent for anything else Stripe sends (e.g.
        // invoice.* events) - not every event type needs a reaction, and an
        // unhandled-event log line for routine webhook traffic is just noise.
        break
    }
  } catch (e) {
    console.error('stripe-webhook handler error:', e, 'for event', event.type)
    // Still 200: a 4xx/5xx here makes Stripe retry the same event on a
    // backoff schedule, which is right for a transient failure but would
    // otherwise hide a permanent one (a bug in this handler) behind endless
    // identical retries instead of surfacing in these logs once.
  }

  return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })
})

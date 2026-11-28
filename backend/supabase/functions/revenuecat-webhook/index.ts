// RevenueCat calls this when someone buys, renews or is refunded Pro in the
// iPhone app (mobile/lib/purchases.ts). Server to server: no user JWT, so it is
// authenticated by the Authorization header configured in RevenueCat, which
// must equal the REVENUECAT_WEBHOOK_AUTH secret. Runs as service_role.
//
// Writes the user's subscriptions row (migration 046). current_period_end only
// ever moves LATER, except on a refund, so an App Store purchase never shortens
// Pro the student already had from a university offer, a referral or Stripe.
// Sandbox purchases (TestFlight, App Review) only count for internal accounts.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const AUTH = Deno.env.get('REVENUECAT_WEBHOOK_AUTH') ?? ''
// Optional: PostHog's public project key, to count purchases next to app events.
const POSTHOG_KEY = Deno.env.get('POSTHOG_KEY') ?? ''
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GRANTS = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'PRODUCT_CHANGE', 'UNCANCELLATION', 'SUBSCRIPTION_EXTENDED', 'NON_RENEWING_PURCHASE'])

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || !a.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

const ok = (body: Record<string, unknown> = { ok: true }) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  const header = req.headers.get('Authorization') ?? ''
  if (!AUTH || !(timingSafeEqual(header, AUTH) || timingSafeEqual(header, `Bearer ${AUTH}`))) {
    return new Response('unauthorized', { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const ev = body?.event
  if (!ev?.type) return new Response('bad request', { status: 400 })
  if (ev.type === 'TEST') return ok({ ok: true, test: true })
  if (ev.store && ev.store !== 'APP_STORE') return ok({ ignored: 'store' })

  // The Demist account: the app logs RevenueCat in with the Supabase user id.
  const ids = [ev.app_user_id, ev.original_app_user_id, ...(ev.aliases ?? [])].filter((x: unknown) => typeof x === 'string')
  const userId = ids.find((x: string) => UUID.test(x))
  if (!userId) return ok({ ignored: 'no_demist_user' })

  if (ev.environment === 'SANDBOX') {
    const { data: prof } = await admin.from('profiles').select('is_internal').eq('id', userId).maybeSingle()
    if (!prof?.is_internal) return ok({ ignored: 'sandbox_non_internal' })
  }

  const { data: sub, error: subErr } = await admin.from('subscriptions').select('*').eq('user_id', userId).maybeSingle()
  if (subErr) return new Response('lookup failed', { status: 500 }) // RevenueCat retries
  if (!sub) return ok({ ignored: 'no_subscription_row' })

  const expires = typeof ev.expiration_at_ms === 'number' ? new Date(ev.expiration_at_ms) : null
  const stored = sub.current_period_end ? new Date(sub.current_period_end) : null
  let update: Record<string, unknown> | null = null

  if (GRANTS.has(ev.type)) {
    const end = expires && stored && sub.plan === 'pro' && stored > expires ? stored : expires
    update = {
      plan: 'pro',
      current_period_end: end ? end.toISOString() : null,
      store: 'app_store',
      store_transaction_id: ev.original_transaction_id ?? ev.transaction_id ?? sub.store_transaction_id ?? 'unknown',
      store_product_id: ev.product_id ?? sub.store_product_id ?? null,
    }
  } else if (ev.type === 'CANCELLATION' && ev.cancel_reason === 'CUSTOMER_SUPPORT') {
    // A refund: Pro from this purchase ends now. Only if the row is this purchase.
    if (sub.store_transaction_id && (!ev.original_transaction_id || sub.store_transaction_id === ev.original_transaction_id)) {
      update = { current_period_end: new Date().toISOString() }
    }
  }
  // CANCELLATION (auto-renew off), BILLING_ISSUE and EXPIRATION need nothing:
  // the stored end date is Apple's, so Pro simply runs out on time.

  if (update) {
    const { error } = await admin.from('subscriptions').update(update).eq('user_id', userId)
    // Supabase writes resolve with an error rather than throwing.
    if (error) return new Response('update failed', { status: 500 })
  }

  try {
    if (POSTHOG_KEY) {
      await fetch('https://eu.i.posthog.com/capture/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: POSTHOG_KEY, event: 'app_store_subscription_event', distinct_id: userId, properties: { type: ev.type, product: ev.product_id, environment: ev.environment, applied: !!update } }),
      })
    }
  } catch { /* analytics must never fail the webhook */ }

  return ok({ ok: true, applied: !!update })
})

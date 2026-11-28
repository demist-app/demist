import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { captureServer } from '@/lib/serverCapture'
import { isPaidRow } from '@/lib/entitlementRules'

// Claims a university offer (migration 044) for the signed-in student: their
// comped Pro runs to the offer's pro_until. Idempotent, so the page and the
// after-sign-in hook (lib/uniOffer.ts) can both call it safely.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const code = typeof body?.code === 'string' ? body.code.trim().toLowerCase() : ''
  if (!/^[a-z0-9-]{3,40}$/.test(code)) return NextResponse.json({ error: 'bad_code' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'signed_out' }, { status: 401 })

  const admin = createAdminClient()
  const { data: offer, error: offerErr } = await admin
    .from('uni_offers').select('code, org_name, pro_until, active').eq('code', code).maybeSingle()
  if (offerErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  if (!offer || !offer.active || new Date(offer.pro_until) <= new Date()) {
    return NextResponse.json({ error: 'ended' }, { status: 410 })
  }

  // Every account gets a subscriptions row at sign-up, so this is an update.
  const { data: sub, error: subErr } = await admin
    .from('subscriptions').select('*').eq('user_id', user.id).maybeSingle()
  if (subErr || !sub) return NextResponse.json({ error: 'no_subscription_row' }, { status: 500 })

  const now = new Date()
  const paidAndCurrent = isPaidRow(sub) && sub.plan === 'pro'
    && (!sub.current_period_end || new Date(sub.current_period_end) > now)
  let proUntil = offer.pro_until as string

  // Someone already paying keeps their Stripe subscription untouched.
  if (!paidAndCurrent) {
    // Never shorten Pro someone already has (a longer hand-comped month).
    const existingEnd = sub.plan === 'pro' && sub.current_period_end ? new Date(sub.current_period_end) : null
    if (existingEnd && existingEnd > new Date(proUntil)) proUntil = existingEnd.toISOString()
    const { error } = await admin
      .from('subscriptions')
      // stripe_subscription_id is left alone: the webhook finds rows by it.
      .update({ plan: 'pro', current_period_end: proUntil, org_code: code })
      .eq('user_id', user.id)
    // Supabase writes resolve with an error rather than throwing.
    if (error) return NextResponse.json({ error: 'update_failed' }, { status: 500 })
  }

  const { error: claimErr } = await admin
    .from('uni_offer_claims').upsert({ user_id: user.id, code }, { onConflict: 'user_id', ignoreDuplicates: true })
  if (claimErr) console.error('uni_offer_claims insert failed', claimErr.message)

  await captureServer(user.id, 'uni_offer_claimed', { code, already_paid: paidAndCurrent })
  return NextResponse.json({ ok: true, org: offer.org_name, proUntil, alreadyPaid: paidAndCurrent })
}

// Daily: emails people whose free Pro (a comped month or the reverse trial)
// is about to end, or just has. Scheduled in vercel.json.
//
// WHY. The in-app notice (ProExpiryNotice) only reaches people who open the
// app, and the people drifting away are exactly the ones who need telling.
// As of 2026-09-24, 21 strangers' comped months end between 11 and 19 Oct:
// the first decision moment this product has ever had.
//
// SAFETY, in order of what would hurt most:
// - Nothing is sent unless PRO_EXPIRY_EMAILS_ENABLED is exactly 'true'.
//   Otherwise (and always with ?dry=1) it reports what it WOULD send: user
//   ids, stages and counts, never an email address.
// - Never emails: internal accounts (profiles.is_internal), anyone paying,
//   anyone under MINIMUM_AGE by their date of birth, anyone listed in
//   PRO_EXPIRY_EXCLUDE_USER_IDS, anonymous accounts, or anyone with no
//   lectures (nothing to lose, so the email would be empty words).
// - At most once per user, stage and end date: the log row is claimed BEFORE
//   the send (migration 038's unique key), and released if the send fails.
// - If the internal-account check cannot be read, the whole run stops. A run
//   that cannot tell who is internal must not email anyone.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. With no
// CRON_SECRET set the route refuses every request rather than running open.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail, proExpiryEmail, type ExpiryStage } from '@/lib/email'
import { stageFor } from '@/lib/proExpiryStage'
import { REVERSE_TRIAL_START, REVERSE_TRIAL_DAYS, LIMITS, type SubscriptionRow } from '@/lib/entitlementRules'
import { ageFromDob, MINIMUM_AGE } from '@/lib/age'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DAY_MS = 86_400_000
const HISTORY_DAYS = LIMITS.free.historyDays ?? 7

interface Candidate {
  userId: string
  email: string | null
  isAnonymous: boolean
  createdAt: string
  sub: SubscriptionRow | null
}

interface Planned {
  userId: string
  stage: ExpiryStage
  source: 'comped' | 'trial'
  periodEnd: string
  sessions: number
  terms: number
  locked: number
}

async function captureServer(userId: string, event: string, properties: Record<string, unknown>) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return
  try {
    await fetch('https://eu.i.posthog.com/capture/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, event, distinct_id: userId, properties }),
    })
  } catch { /* analytics must never fail a send */ }
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const live = process.env.PRO_EXPIRY_EMAILS_ENABLED === 'true' && url.searchParams.get('dry') !== '1'
  const stagesOn = new Set((process.env.PRO_EXPIRY_STAGES ?? 'minus7,minus1,day0').split(',').map(s => s.trim()))
  const excluded = new Set((process.env.PRO_EXPIRY_EXCLUDE_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean))
  const now = new Date()
  const sb = createAdminClient()

  // ── Candidates ─────────────────────────────────────────────────────────
  // Comped rows ending in the next 8 days or in the last 3, plus accounts
  // whose reverse trial does. Both windows are wider than the stages need;
  // stageFor decides precisely.
  const windowStart = new Date(now.getTime() - 3 * DAY_MS).toISOString()
  const windowEnd = new Date(now.getTime() + 8 * DAY_MS).toISOString()
  const { data: comped, error: compedErr } = await sb
    .from('subscriptions')
    .select('user_id, plan, current_period_end, stripe_customer_id, stripe_subscription_id')
    .eq('plan', 'pro')
    .is('stripe_subscription_id', null)
    .gte('current_period_end', windowStart)
    .lte('current_period_end', windowEnd)
  if (compedErr) return NextResponse.json({ error: `subscriptions: ${compedErr.code} ${compedErr.message}` }, { status: 500 })

  const users = new Map<string, Candidate>()
  // auth.users has no filterable listing through the admin API, so page
  // through it. At this scale (hundreds of accounts) that is a few calls.
  const trialFrom = Math.max(new Date(REVERSE_TRIAL_START).getTime(), now.getTime() - (REVERSE_TRIAL_DAYS + 3) * DAY_MS)
  const trialTo = now.getTime() - (REVERSE_TRIAL_DAYS - 8) * DAY_MS
  const compedIds = new Set((comped ?? []).map(c => c.user_id as string))
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return NextResponse.json({ error: `listUsers: ${error.message}` }, { status: 500 })
    for (const u of data.users) {
      const created = new Date(u.created_at).getTime()
      const inTrialWindow = created >= trialFrom && created <= trialTo
      if (inTrialWindow || compedIds.has(u.id)) {
        users.set(u.id, { userId: u.id, email: u.email ?? null, isAnonymous: !!u.is_anonymous, createdAt: u.created_at, sub: null })
      }
    }
    if (data.users.length < 1000) break
  }
  if (!users.size) return NextResponse.json({ live, planned: [], skipped: {} })

  const ids = [...users.keys()]
  // Everyone's subscription row, not only the comped ones: a trial user who
  // has since paid must resolve as paid and be skipped.
  const [{ data: subs, error: subsErr }, { data: profiles, error: profErr }] = await Promise.all([
    sb.from('subscriptions').select('user_id, plan, current_period_end, stripe_customer_id, stripe_subscription_id').in('user_id', ids),
    sb.from('profiles').select('id, is_internal, date_of_birth').in('id', ids),
  ])
  if (subsErr) return NextResponse.json({ error: `subscriptions: ${subsErr.code} ${subsErr.message}` }, { status: 500 })
  if (profErr) return NextResponse.json({ error: `profiles (is_internal must exist): ${profErr.code} ${profErr.message}` }, { status: 500 })
  for (const s of subs ?? []) {
    const c = users.get(s.user_id as string)
    if (c) c.sub = s as SubscriptionRow
  }
  const profileById = new Map((profiles ?? []).map(p => [p.id as string, p as { id: string; is_internal: boolean | null; date_of_birth: string | null }]))

  // ── Decide ─────────────────────────────────────────────────────────────
  const skipped: Record<string, number> = {}
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1 }
  const planned: Planned[] = []
  const lockBefore = new Date(now.getTime() - HISTORY_DAYS * DAY_MS).toISOString()

  for (const c of users.values()) {
    const st = stageFor(c.sub, c.createdAt, now)
    if (!st) { skip('no_stage_today'); continue }
    if (!stagesOn.has(st.stage)) { skip(`stage_off_${st.stage}`); continue }
    const prof = profileById.get(c.userId)
    if (prof?.is_internal) { skip('internal'); continue }
    if (excluded.has(c.userId)) { skip('excluded'); continue }
    if (c.isAnonymous || !c.email) { skip('no_email'); continue }
    const age = ageFromDob(prof?.date_of_birth)
    if (age !== null && age < MINIMUM_AGE) { skip('under_minimum_age'); continue }

    const [{ count: sessions }, { count: terms }, { count: locked }] = await Promise.all([
      sb.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', c.userId),
      sb.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', c.userId),
      sb.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', c.userId).lt('started_at', lockBefore),
    ])
    if (!sessions) { skip('no_lectures'); continue }
    planned.push({ userId: c.userId, ...st, sessions, terms: terms ?? 0, locked: locked ?? 0 })
  }

  if (!live) return NextResponse.json({ live, planned, skipped })

  // ── Send ───────────────────────────────────────────────────────────────
  const results: { userId: string; stage: ExpiryStage; outcome: string }[] = []
  for (const p of planned) {
    const { data: claim, error: claimErr } = await sb
      .from('pro_expiry_emails')
      .insert({ user_id: p.userId, stage: p.stage, source: p.source, period_end: p.periodEnd })
      .select('id')
      .single()
    if (claimErr) {
      if (claimErr.code === '23505') { results.push({ userId: p.userId, stage: p.stage, outcome: 'already_sent' }); continue }
      // Anything else (a missing grant, a missing table) would repeat for
      // every row. Stop and say so rather than report a quiet zero.
      return NextResponse.json({ error: `claim failed: ${claimErr.code} ${claimErr.message}`, results }, { status: 500 })
    }
    const endDate = new Date(p.periodEnd).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })
    const mail = proExpiryEmail({ stage: p.stage, source: p.source, endDate, sessions: p.sessions, terms: p.terms, locked: p.locked, historyDays: HISTORY_DAYS })
    const email = users.get(p.userId)!.email!
    const sent = await sendEmail({ to: email, subject: mail.subject, html: mail.html, text: mail.text, tag: `pro_expiry_${p.stage}` })
    if (!sent.ok) {
      // Release the claim so tomorrow's run retries it.
      await sb.from('pro_expiry_emails').delete().eq('id', claim.id)
      results.push({ userId: p.userId, stage: p.stage, outcome: `send_failed: ${sent.error.slice(0, 120)}` })
      continue
    }
    await sb.from('pro_expiry_emails').update({ resend_id: sent.id }).eq('id', claim.id)
    await captureServer(p.userId, 'pro_expiry_email_sent', { stage: p.stage, source: p.source, sessions: p.sessions, terms: p.terms, locked: p.locked })
    results.push({ userId: p.userId, stage: p.stage, outcome: 'sent' })
  }
  return NextResponse.json({ live, results, skipped })
}

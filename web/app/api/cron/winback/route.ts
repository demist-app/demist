// One email, once, to people whose free Pro trial ended after they had
// recorded at least one lecture. Approved by the user on 2026-11-17: of 73
// accounts whose trial had ended, none was still active, and most had tried
// Demist while desktop term detection found almost nothing.
//
// NOT scheduled. Run by hand: GET with the cron secret reports who it would
// email; add ?send=1 to send. Each account is marked (winback_sent_at in its
// auth metadata) BEFORE its email goes, so a second run never repeats one.
//
// Never emails: guests (no address), internal accounts, anyone under
// MINIMUM_AGE, anyone who has paid, anyone who turned study emails off, or
// anyone with no lectures.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail, winbackEmail } from '@/lib/email'
import { REVERSE_TRIAL_START, trialDaysFor } from '@/lib/entitlementRules'
import { ageFromDob, MINIMUM_AGE } from '@/lib/age'
import { studyEmailsOn, unsubscribeUrl, unsubscribeHeaders } from '@/lib/emailPrefs'
import { captureServer } from '@/lib/serverCapture'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DAY_MS = 86_400_000

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const send = new URL(req.url).searchParams.get('send') === '1'
  const now = Date.now()
  const sb = createAdminClient()

  type U = { id: string; email: string; meta: Record<string, unknown> }
  const ended: U[] = []
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) return NextResponse.json({ error: `listUsers: ${error.message}` }, { status: 500 })
    for (const u of data.users) {
      const created = new Date(u.created_at).getTime()
      if (created < new Date(REVERSE_TRIAL_START).getTime()) continue
      if (created + trialDaysFor(u.created_at) * DAY_MS > now) continue
      if (u.is_anonymous || !u.email) continue
      ended.push({ id: u.id, email: u.email, meta: (u.user_metadata ?? {}) as Record<string, unknown> })
    }
    if (data.users.length < 1000) break
  }

  const ids = ended.map(u => u.id)
  const [{ data: profiles, error: pErr }, { data: subs, error: sErr }] = await Promise.all([
    sb.from('profiles').select('id, is_internal, date_of_birth').in('id', ids),
    sb.from('subscriptions').select('user_id, stripe_subscription_id').in('user_id', ids),
  ])
  if (pErr || sErr) return NextResponse.json({ error: `lookup: ${(pErr ?? sErr)!.code}` }, { status: 500 })
  const profile = new Map((profiles ?? []).map(p => [p.id as string, p]))
  const paid = new Set((subs ?? []).filter(s => s.stripe_subscription_id).map(s => s.user_id as string))

  const skipped: Record<string, number> = {}
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1 }
  const planned: { id: string; sessions: number }[] = []
  for (const u of ended) {
    const p = profile.get(u.id)
    if (p?.is_internal) { skip('internal'); continue }
    const age = ageFromDob(p?.date_of_birth as string | null)
    if (age !== null && age < MINIMUM_AGE) { skip('under_minimum_age'); continue }
    if (paid.has(u.id)) { skip('paid'); continue }
    if (!studyEmailsOn(u.meta)) { skip('emails_off'); continue }
    if (u.meta.winback_sent_at) { skip('already_sent'); continue }
    const { count } = await sb.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', u.id)
    if (!count) { skip('no_lectures'); continue }
    planned.push({ id: u.id, sessions: count })
  }

  if (!send) return NextResponse.json({ send, planned: planned.length, skipped })

  const results: Record<string, number> = {}
  const tally = (k: string) => { results[k] = (results[k] ?? 0) + 1 }
  for (const p of planned) {
    const u = ended.find(x => x.id === p.id)!
    // Claim first, so a crash or a second run cannot send it twice.
    const { error: claimErr } = await sb.auth.admin.updateUserById(u.id, { user_metadata: { ...u.meta, winback_sent_at: new Date().toISOString() } })
    if (claimErr) { tally('claim_failed'); continue }
    const mail = winbackEmail({ sessions: p.sessions, unsubUrl: unsubscribeUrl(u.id) })
    const sent = await sendEmail({ to: u.email, subject: mail.subject, html: mail.html, text: mail.text, tag: 'winback', headers: unsubscribeHeaders(u.id) })
    if (!sent.ok) {
      await sb.auth.admin.updateUserById(u.id, { user_metadata: { ...u.meta, winback_sent_at: null } })
      tally('send_failed')
      continue
    }
    await captureServer(u.id, 'winback_email_sent', { sessions: p.sessions })
    tally('sent')
  }
  return NextResponse.json({ send, results, skipped })
}

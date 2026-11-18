// Daily (vercel.json): emails students who have words to revise.
//
// WHY (2026-11-17). Only 10% of new users came back on a second day and 3%
// in a second week, and nothing ever reminded them their flashcards were
// waiting. Approved by the user with an easy way to stop them.
//
// Rules, kindest first:
// - Only students who recorded in the last 21 days, so nobody who has moved
//   on is chased.
// - Only with at least MIN_DUE words due, and not if they revised in the last
//   day.
// - At most one every GAP_DAYS days (last_study_email_at in auth metadata).
// - Never guests, internal accounts, anyone under MINIMUM_AGE, or anyone who
//   turned study emails off.
//
// Live by default. STUDY_REMINDERS_DISABLED=true stops it, and ?dry=1 (with
// the cron secret) reports what it would send without sending.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail, studyReminderEmail } from '@/lib/email'
import { ageFromDob, MINIMUM_AGE } from '@/lib/age'
import { studyEmailsOn, unsubscribeUrl, unsubscribeHeaders } from '@/lib/emailPrefs'
import { captureServer } from '@/lib/serverCapture'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DAY_MS = 86_400_000
const ACTIVE_DAYS = 21
const MIN_DUE = 3
const GAP_DAYS = 3
const MAX_PER_RUN = 300

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const live = process.env.STUDY_REMINDERS_DISABLED !== 'true' && new URL(req.url).searchParams.get('dry') !== '1'
  const now = new Date()
  const sb = createAdminClient()

  // Who recorded recently, and their latest lecture's subject.
  const { data: recent, error: rErr } = await sb
    .from('sessions')
    .select('user_id, subject, started_at')
    .gte('started_at', new Date(now.getTime() - ACTIVE_DAYS * DAY_MS).toISOString())
    .order('started_at', { ascending: false })
  if (rErr) return NextResponse.json({ error: `sessions: ${rErr.code}` }, { status: 500 })
  const latestSubject = new Map<string, string | null>()
  for (const s of recent ?? []) if (!latestSubject.has(s.user_id as string)) latestSubject.set(s.user_id as string, (s.subject as string | null) ?? null)
  const ids = [...latestSubject.keys()]
  if (!ids.length) return NextResponse.json({ live, planned: 0 })

  const { data: profiles, error: pErr } = await sb.from('profiles').select('id, is_internal, date_of_birth').in('id', ids)
  if (pErr) return NextResponse.json({ error: `profiles: ${pErr.code}` }, { status: 500 })
  const profile = new Map((profiles ?? []).map(p => [p.id as string, p]))

  const skipped: Record<string, number> = {}
  const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1 }
  const results: Record<string, number> = {}
  const tally = (k: string) => { results[k] = (results[k] ?? 0) + 1 }
  let planned = 0

  for (const id of ids) {
    if (planned >= MAX_PER_RUN) { skip('run_cap'); continue }
    const p = profile.get(id)
    if (p?.is_internal) { skip('internal'); continue }
    const age = ageFromDob(p?.date_of_birth as string | null)
    if (age !== null && age < MINIMUM_AGE) { skip('under_minimum_age'); continue }

    const { data: got } = await sb.auth.admin.getUserById(id)
    const u = got?.user
    if (!u || u.is_anonymous || !u.email) { skip('no_email'); continue }
    const meta = (u.user_metadata ?? {}) as Record<string, unknown>
    if (!studyEmailsOn(meta)) { skip('emails_off'); continue }
    const last = typeof meta.last_study_email_at === 'string' ? new Date(meta.last_study_email_at).getTime() : 0
    if (now.getTime() - last < GAP_DAYS * DAY_MS) { skip('emailed_recently'); continue }

    const [{ count: due }, { count: revisedToday }] = await Promise.all([
      sb.from('terms').select('id', { count: 'exact', head: true })
        .eq('user_id', id).eq('known', false)
        .or('dismissed.is.null,dismissed.eq.false')
        .or(`sm2_due_at.is.null,sm2_due_at.lte.${now.toISOString()}`),
      sb.from('review_log').select('id', { count: 'exact', head: true })
        .eq('user_id', id).gte('reviewed_at', new Date(now.getTime() - DAY_MS).toISOString()),
    ])
    if ((due ?? 0) < MIN_DUE) { skip('not_enough_due'); continue }
    if (revisedToday) { skip('revised_today'); continue }
    planned++
    if (!live) continue

    const mail = studyReminderEmail({ due: due!, subject: latestSubject.get(id) ?? null, unsubUrl: unsubscribeUrl(id) })
    const { error: claimErr } = await sb.auth.admin.updateUserById(id, { user_metadata: { ...meta, last_study_email_at: now.toISOString() } })
    if (claimErr) { tally('claim_failed'); continue }
    const sent = await sendEmail({ to: u.email, subject: mail.subject, html: mail.html, text: mail.text, tag: 'study_reminder', headers: unsubscribeHeaders(id) })
    if (!sent.ok) {
      await sb.auth.admin.updateUserById(id, { user_metadata: { ...meta, last_study_email_at: meta.last_study_email_at ?? null } })
      tally('send_failed')
      continue
    }
    await captureServer(id, 'study_reminder_sent', { due })
    tally('sent')
  }
  return NextResponse.json({ live, planned, results, skipped })
}

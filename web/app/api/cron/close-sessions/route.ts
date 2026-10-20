// Closes lectures that were never stopped.
//
// WHY (2026-10-20). 12 of the last 30 days' lectures had no ended_at: the tab
// was closed mid-lecture, or the connection dropped at the moment Stop was
// pressed (one desktop lecture's end time and transcript writes both failed
// at stop). A session with no end has no duration, so it breaks the lecture
// list, time-recorded stats and anything averaged over lectures, and it reads
// as "still recording" forever.
//
// The end is set to the last thing the lecture is known to have done: its
// last term, transcription call or "I'm lost" mark. With none of those, it is
// estimated from the transcript at 130 words a minute, and with no transcript
// either, the lecture is closed at its start (length unknown, shown as 0,
// rather than inventing a length).
//
// Runs as the service role, which migration 041's stamp_session_end trigger
// deliberately leaves alone (it only overrides ended_at written by a signed-in
// user), so the reconstructed time is kept.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; with no
// CRON_SECRET set the route refuses every request. ?dry=1 reports without
// writing.
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HOUR_MS = 3_600_000
const STALE_AFTER_MS = 6 * HOUR_MS        // nobody records a 6-hour lecture without stopping
const LOOK_BACK_MS = 30 * 24 * HOUR_MS    // older orphans stay as they are
const WORDS_PER_MINUTE = 130
const MAX_ESTIMATE_MS = 3 * HOUR_MS

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const sb = createAdminClient()
  const now = Date.now()

  const { data: open, error } = await sb.from('sessions')
    .select('id, started_at, transcript')
    .is('ended_at', null)
    .lt('started_at', new Date(now - STALE_AFTER_MS).toISOString())
    .gt('started_at', new Date(now - LOOK_BACK_MS).toISOString())
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!open?.length) return NextResponse.json({ closed: 0, dry })

  const ids = open.map(s => s.id)
  const latest = new Map<string, number>()
  const note = (id: string | null, at: string | null) => {
    if (!id || !at) return
    const t = new Date(at).getTime()
    if (t > (latest.get(id) ?? 0)) latest.set(id, t)
  }
  const [terms, usage, marks] = await Promise.all([
    sb.from('terms').select('session_id, created_at').in('session_id', ids),
    sb.from('usage_events').select('session_id, created_at').in('session_id', ids),
    sb.from('session_marks').select('session_id, created_at').in('session_id', ids),
  ])
  for (const r of [...(terms.data ?? []), ...(usage.data ?? []), ...(marks.data ?? [])]) note(r.session_id, r.created_at)

  let closed = 0, estimated = 0, zeroLength = 0
  const failures: string[] = []
  for (const s of open) {
    const start = new Date(s.started_at).getTime()
    let end = latest.get(s.id) ?? 0
    if (!end) {
      const words = (s.transcript ?? '').trim().split(/\s+/).filter(Boolean).length
      if (words) { end = start + Math.min(MAX_ESTIMATE_MS, (words / WORDS_PER_MINUTE) * 60_000); estimated++ }
      else { end = start; zeroLength++ }
    }
    end = Math.max(end, start)
    if (dry) { closed++; continue }
    const { error: upErr } = await sb.from('sessions')
      .update({ ended_at: new Date(end).toISOString() })
      .eq('id', s.id)
      .is('ended_at', null)   // never overwrite an end that arrived meanwhile
    if (upErr) failures.push(upErr.code ?? upErr.message)
    else closed++
  }
  return NextResponse.json({ dry, closed, estimated, zeroLength, failures: failures.slice(0, 5) })
}

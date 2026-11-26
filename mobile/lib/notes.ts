// Lecture notes on the iPhone: the same notes as the website, written by the
// lecture-notes edge function from the saved transcript (the phone has no
// model of its own). The function enforces the free limit; this module only
// counts it for the screen, and keeps one lecture's progress visible to every
// screen showing it. Mirrors web/lib/makeNotes.ts, minus the desktop engine.
//
// What is shown is decided by lib/shared/lectureNotes.ts, generated from the
// web, so a point the transcript does not support is dropped here exactly as
// it is there.
import { supabase } from './supabase'
import { capture } from './analytics'
import { LIMITS, resolveEntitlement, type SubscriptionRow } from './shared/entitlementRules'
import { NOTES_MIN_CHARS } from './shared/lectureNotes'

export type NotesFailure = 'free_limit' | 'too_short' | 'busy' | 'failed'
export type NotesState =
  | { status: 'idle' }
  | { status: 'working' }
  | { status: 'done'; raw: string }
  | { status: 'failed'; reason: NotesFailure }

const states = new Map<string, NotesState>()
const listeners = new Set<() => void>()
const IDLE: NotesState = { status: 'idle' }
let running: string | null = null

const set = (id: string, s: NotesState) => { states.set(id, s); listeners.forEach(l => l()) }
export const notesState = (id: string): NotesState => states.get(id) ?? IDLE
export function subscribeNotes(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString() }

/** Free notes left this month, or null for unlimited (Pro, trial included). */
export async function freeNotesLeft(): Promise<number | null> {
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user
  if (!user) return 0
  const { data: sub } = await supabase.from('subscriptions')
    .select('plan, current_period_end, stripe_customer_id, stripe_subscription_id').eq('user_id', user.id).maybeSingle()
  const plan = resolveEntitlement(sub as SubscriptionRow | null, user.created_at ?? null).plan
  const limit = LIMITS[plan].notesPerMonth
  if (limit === null) return null
  const { count, error } = await supabase.from('usage_events').select('id', { count: 'exact', head: true })
    .eq('user_id', user.id).eq('event_type', 'lecture_notes').gte('created_at', monthStart())
  // Cannot tell: let them try. The server still decides.
  if (error) return limit
  return Math.max(0, limit - (count ?? 0))
}

export async function makeNotes(opts: { sessionId: string; transcriptChars: number; language?: string | null; auto?: boolean }): Promise<void> {
  const { sessionId } = opts
  if (running) return
  if (opts.transcriptChars < NOTES_MIN_CHARS) return set(sessionId, { status: 'failed', reason: 'too_short' })
  running = sessionId
  const startedAt = Date.now()
  const base = { engine: 'server', platform: 'ios', auto: !!opts.auto, chars: opts.transcriptChars }
  set(sessionId, { status: 'working' })
  capture('lecture_notes_started', base)
  try {
    const { data, error } = await supabase.functions.invoke('lecture-notes', {
      body: { session_id: sessionId, lecture_language: opts.language ?? undefined },
    })
    if (data?.ok && data.notes) {
      set(sessionId, { status: 'done', raw: data.notes })
      capture('lecture_notes_made', { ...base, seconds: Math.round((Date.now() - startedAt) / 1000) })
      return
    }
    const reason: NotesFailure = data?.reason === 'free_limit' || data?.reason === 'too_short' ? data.reason
      : data?.reason === 'busy' || data?.reason === 'rate_limited' ? 'busy' : 'failed'
    if (reason === 'failed') console.error('[demist] lecture notes:', data?.reason ?? error?.message)
    set(sessionId, { status: 'failed', reason })
    capture('lecture_notes_failed', { ...base, reason: data?.reason ?? 'request_failed' })
  } catch (e) {
    console.error('[demist] lecture notes failed:', e)
    set(sessionId, { status: 'failed', reason: 'failed' })
    capture('lecture_notes_failed', { ...base, reason: 'exception' })
  } finally {
    running = null
  }
}

// About ten minutes of speech, the same as the web: a test recording never
// spends one of a free account's notes.
const AUTO_FREE_MIN_CHARS = 6000

/** After a lecture whose transcript was saved. Pro: always. Free: while the
 *  month's notes last, for real lectures only. */
export async function autoNotes(sessionId: string, transcriptChars: number, language?: string | null): Promise<void> {
  if (transcriptChars < NOTES_MIN_CHARS) return
  const left = await freeNotesLeft()
  if (left === 0) return
  if (left !== null && transcriptChars < AUTO_FREE_MIN_CHARS) return
  await makeNotes({ sessionId, transcriptChars, language, auto: true })
}

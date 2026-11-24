// Making lecture notes: which engine, the free limit, progress, and stopping.
//
// Desktop app (1.0.12+): written on the student's own computer, one piece of
// transcript at a time, and NEVER sent anywhere. It stops the moment a new
// recording starts (transcription needs the machine) and picks up where it
// left off. An older desktop app is told to update, not quietly sent to the
// server: "nothing leaves this computer" has no exceptions.
// Website: the lecture-notes edge function, from the saved transcript.
//
// One lecture at a time, module-wide, and every screen showing that lecture
// sees the same progress (subscribeNotes).

import { createClient } from '@/lib/supabase'
import { getDemistNative } from '@/lib/electronNative'
import { capture, reportWriteFailure } from '@/lib/analytics'
import { fetchEntitlement, LIMITS } from '@/lib/entitlements'
import { cleanSection, splitForNotes, NOTES_MIN_CHARS, type NotesSection } from '@/lib/lectureNotes'

export type NotesState =
  | { status: 'idle' }
  | { status: 'working'; done: number; total: number }   // total 0: no measure (website)
  | { status: 'paused' }                                  // a recording started
  | { status: 'done'; raw: string }
  | { status: 'failed'; reason: NotesFailure }

export type NotesFailure = 'free_limit' | 'too_short' | 'update_app' | 'busy' | 'failed'

const states = new Map<string, NotesState>()
const listeners = new Set<() => void>()
// Sections already written for a lecture whose notes were paused, so a lecture
// is never read twice. Memory only: closing the app starts it again.
const partial = new Map<string, NotesSection[]>()
let running: string | null = null
let recordingNow: () => boolean = () => false

/** recordingSession tells this module whether the microphone is live. */
export function setRecordingProbe(fn: () => boolean) { recordingNow = fn }

const set = (id: string, s: NotesState) => { states.set(id, s); listeners.forEach(l => l()) }
const IDLE: NotesState = { status: 'idle' }
export const notesState = (id: string): NotesState => states.get(id) ?? IDLE
export function subscribeNotes(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } }

/** 'device', 'server', or null when this desktop app is too old for notes. */
export function notesEngine(): 'device' | 'server' | null {
  const native = getDemistNative()
  if (!native) return 'server'
  return native.noteChunk ? 'device' : null
}

// The small model on the computer follows a language's name, not its code.
const LANGUAGE_NAME: Record<string, string> = { en: 'English', fr: 'French', nl: 'Dutch', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese' }

const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString() }

/** Free notes left this month, or null for unlimited. Same count as the server's. */
export async function freeNotesLeft(): Promise<number | null> {
  const sb = createClient()
  const { data: { session } } = await sb.auth.getSession()
  if (!session?.user) return 0
  const ent = await fetchEntitlement(sb, session.user.id)
  const limit = LIMITS[ent.plan].notesPerMonth
  if (limit === null) return null
  const { count, error } = await sb.from('usage_events').select('id', { count: 'exact', head: true })
    .eq('user_id', session.user.id).eq('event_type', 'lecture_notes').gte('created_at', monthStart())
  // Cannot tell: let them try rather than lock a student out on a bad network.
  // On the website the server still decides.
  if (error) return limit
  return Math.max(0, limit - (count ?? 0))
}

export async function makeNotes(opts: { sessionId: string; transcript: string; language?: string | null; auto?: boolean }): Promise<void> {
  const { sessionId, transcript } = opts
  if (running) return
  const text = transcript.trim()
  if (text.length < NOTES_MIN_CHARS) return set(sessionId, { status: 'failed', reason: 'too_short' })
  const engine = notesEngine()
  if (!engine) return set(sessionId, { status: 'failed', reason: 'update_app' })

  running = sessionId
  const startedAt = Date.now()
  const base = { engine, auto: !!opts.auto, chars: text.length }
  set(sessionId, { status: 'working', done: 0, total: 0 })
  capture('lecture_notes_started', base)
  try {
    if (engine === 'server') {
      const { data, error } = await createClient().functions.invoke('lecture-notes', {
        body: { session_id: sessionId, lecture_language: opts.language ?? undefined },
      })
      if (data?.ok && data.notes) {
        set(sessionId, { status: 'done', raw: data.notes })
        capture('lecture_notes_made', { ...base, seconds: Math.round((Date.now() - startedAt) / 1000) })
        return
      }
      const reason: NotesFailure = data?.reason === 'free_limit' || data?.reason === 'too_short' ? data.reason
        : data?.reason === 'busy' || data?.reason === 'rate_limited' ? 'busy' : 'failed'
      if (reason === 'failed') console.error('lecture notes:', data?.reason ?? error?.message)
      set(sessionId, { status: 'failed', reason })
      capture('lecture_notes_failed', { ...base, reason: data?.reason ?? 'request_failed' })
      return
    }

    const left = await freeNotesLeft()
    if (left === 0) {
      set(sessionId, { status: 'failed', reason: 'free_limit' })
      capture('lecture_notes_failed', { ...base, reason: 'free_limit' })
      return
    }
    const native = getDemistNative()!
    const pieces = splitForNotes(text)
    const sections = partial.get(sessionId) ?? []
    // partial is one entry per piece already read, empty sections included.
    for (let i = sections.length; i < pieces.length; i++) {
      if (recordingNow()) {
        partial.set(sessionId, sections)
        set(sessionId, { status: 'paused' })
        capture('lecture_notes_paused', { ...base, done: i, total: pieces.length })
        return
      }
      set(sessionId, { status: 'working', done: i, total: pieces.length })
      let sec: NotesSection | null = null
      try {
        sec = cleanSection(await native.noteChunk!(pieces[i], null, opts.language ? LANGUAGE_NAME[opts.language] ?? null : null))
      } catch (e) {
        // One piece that failed must not cost the student the other fifty.
        console.error(`lecture notes: piece ${i + 1} of ${pieces.length} failed`, e)
      }
      sections.push(sec ?? { heading: '', points: [] })
    }
    const kept = sections.filter(s => s.points.length)
    if (!kept.length) throw new Error('no sections')
    const raw = JSON.stringify({ v: 1, by: 'device', sections: kept })
    const sb = createClient()
    const { error: saveErr } = await sb.from('sessions').update({ summary: raw }).eq('id', sessionId)
    partial.delete(sessionId)
    // Shown even if the save failed: the student has them on screen to copy.
    reportWriteFailure('session.notes', saveErr, { chars: raw.length })
    set(sessionId, { status: 'done', raw })
    const { data: { session } } = await sb.auth.getSession()
    if (session?.user) {
      const { error } = await sb.from('usage_events').insert({ user_id: session.user.id, event_type: 'lecture_notes', provider: 'device', session_id: sessionId, cost_usd: 0 })
      reportWriteFailure('usage.lecture_notes', error)
    }
    capture('lecture_notes_made', { ...base, pieces: pieces.length, failed_pieces: sections.length - kept.length, seconds: Math.round((Date.now() - startedAt) / 1000) })
  } catch (e) {
    console.error('lecture notes failed:', e)
    set(sessionId, { status: 'failed', reason: 'failed' })
    capture('lecture_notes_failed', { ...base, reason: 'exception' })
  } finally {
    running = null
  }
}

/** After a lecture ends. Pro (trial included) only: free chooses which lectures to spend its notes on. */
export async function autoNotes(sessionId: string, transcript: string, language?: string | null): Promise<void> {
  if (transcript.trim().length < NOTES_MIN_CHARS || !notesEngine()) return
  if ((await freeNotesLeft()) !== null) return
  await makeNotes({ sessionId, transcript, language, auto: true })
}

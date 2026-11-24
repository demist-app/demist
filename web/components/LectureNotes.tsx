'use client'

// A lecture's notes: shown when they exist, offered when they could, and
// nothing at all when the lecture has no transcript to make them from.
// How they are made and limited: lib/makeNotes.ts. What is shown: only points
// the transcript supports, plus the lecturer's own words on deadlines and
// exams (lib/lectureNotes.ts).

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'
import { PaywallModal } from '@/components/PaywallModal'
import { ReadAloudButton } from '@/components/ReadAloudButton'
import { groundedNotes, notesAsText, parseNotes, reminders, NOTES_MIN_CHARS } from '@/lib/lectureNotes'
import { freeNotesLeft, makeNotes, notesEngine, notesState, subscribeNotes, type NotesFailure } from '@/lib/makeNotes'
import { LIMITS } from '@/lib/entitlements'

const FAILED: Record<Exclude<NotesFailure, 'free_limit'>, string> = {
  too_short: 'This lecture is too short to make notes from.',
  update_app: 'Update Demist from the Microsoft Store to make notes on this computer.',
  busy: 'Too many notes at once. Try again in a few minutes.',
  failed: 'The notes could not be made. Try again.',
}

export function LectureNotes({ sessionId, title, transcript }: { sessionId: string; title: string; transcript: string | null }) {
  const [saved, setSaved] = useState<string | null | undefined>(undefined)   // undefined: not read yet
  const [left, setLeft] = useState<number | null | undefined>(undefined)     // null: unlimited
  const [paywall, setPaywall] = useState(false)
  const [copied, setCopied] = useState(false)
  const state = useSyncExternalStore(subscribeNotes, () => notesState(sessionId), () => notesState(sessionId))

  useEffect(() => {
    let cancelled = false
    createClient().from('sessions').select('summary').eq('id', sessionId).maybeSingle()
      .then(({ data }) => { if (!cancelled) setSaved((data?.summary as string | null) ?? null) })
    return () => { cancelled = true }
  }, [sessionId])
  useEffect(() => {
    let cancelled = false
    freeNotesLeft().then(n => { if (!cancelled) setLeft(n) })
    return () => { cancelled = true }
  }, [sessionId, state.status])

  const raw = state.status === 'done' ? state.raw : saved ?? null
  const notes = useMemo(() => parseNotes(raw), [raw])
  const sections = useMemo(() => (notes ? groundedNotes(notes, transcript) : []), [notes, transcript])
  const remind = useMemo(() => (notes ? reminders(transcript) : []), [notes, transcript])

  if (saved === undefined) return null
  const usable = (transcript ?? '').trim().length >= NOTES_MIN_CHARS
  if (!notes && !usable) return null

  const label = 'text-[11px] font-bold tracking-[0.15em] uppercase text-gray-600'
  const box = 'mt-4 rounded-xl border dark:border-white/[0.08] border-black/[0.08] dark:bg-white/[0.03] bg-[#F8F6FB] px-4 py-3.5'

  if (notes && (sections.length > 0 || remind.length > 0)) {
    const text = notesAsText(title, sections, remind)
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
        capture('lecture_notes_copied', {})
      } catch { /* clipboard blocked: the notes are still on screen */ }
    }
    return (
      <div className={box}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className={label}>Notes</p>
          <div className="flex items-center gap-2">
            <ReadAloudButton text={text} label="Read these notes aloud" />
            <button onClick={copy} className="text-[12px] font-medium text-brand-700 dark:text-brand-300 hover:opacity-80 transition-opacity px-1 py-1">{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>
        <div className="space-y-4">
          {sections.map((s, i) => (
            <div key={i}>
              {s.heading && <p className="text-[calc(0.9375rem*var(--df-scale))] font-semibold dark:text-white/90 text-gray-900 mb-1">{s.heading}</p>}
              <ul className="space-y-1.5 list-disc pl-5 marker:text-brand-500/60">
                {s.points.map((p, j) => (
                  <li key={j} className="text-[calc(0.875rem*var(--df-scale))] leading-relaxed dark:text-white/75 text-gray-800">{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {remind.length > 0 && (
          <div className="mt-4 rounded-lg border dark:border-brand-500/20 border-brand-200 dark:bg-brand-500/[0.05] bg-brand-50/60 px-3.5 py-2.5">
            <p className="text-[12px] font-semibold dark:text-brand-300 text-brand-700 mb-1">Dates and reminders, in the lecturer&rsquo;s words</p>
            <ul className="space-y-1 list-disc pl-4">
              {remind.map((r, i) => <li key={i} className="text-[13px] leading-relaxed dark:text-white/75 text-gray-800">{r}</li>)}
            </ul>
          </div>
        )}
        <p className="text-[11px] text-gray-500 mt-3">
          Made automatically from the transcript{notes.by === 'device' ? ', on this computer' : ''}. Check anything important against your lecture.
        </p>
      </div>
    )
  }

  const limit = LIMITS.free.notesPerMonth
  const outOfFree = left === 0 || (state.status === 'failed' && state.reason === 'free_limit')
  const working = state.status === 'working'
  const start = () => {
    if (outOfFree) { capture('lecture_notes_locked_clicked', {}); setPaywall(true); return }
    void makeNotes({ sessionId, transcript: transcript ?? '' })
  }
  const note =
    working ? (state.total ? `Reading part ${state.done + 1} of ${state.total}. You can carry on using Demist.` : 'Reading your lecture. This takes a few seconds.')
      : state.status === 'paused' ? 'Paused while you record. Press to carry on after your lecture.'
        : state.status === 'failed' && state.reason !== 'free_limit' ? FAILED[state.reason]
          : outOfFree ? `You have used your ${limit} free notes this month. Pro makes them for every lecture.`
            : notesEngine() === 'device' ? 'Written on this computer from your transcript. Nothing is sent anywhere.'
              : notesEngine() === null ? FAILED.update_app
                : 'Your transcript is sent to our server to write them.'

  return (
    <div className={`${box} flex items-center justify-between gap-4`}>
      <div className="min-w-0">
        <p className="text-[13px] font-medium dark:text-white/85 text-gray-800">
          Full lecture notes{typeof left === 'number' && left > 0 ? <span className="text-gray-500 font-normal"> · {left} of {limit} free left this month</span> : null}
        </p>
        <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed" aria-live="polite">{note}</p>
      </div>
      {notesEngine() !== null && (
        <button
          onClick={start}
          disabled={working || left === undefined}
          className="shrink-0 px-3.5 py-2 rounded-xl bg-brand-600 hover:brightness-110 text-white text-[13px] font-semibold disabled:opacity-50 transition-[filter]"
        >
          {working ? 'Making…' : outOfFree ? 'See Pro' : state.status === 'paused' ? 'Carry on' : 'Make notes'}
        </button>
      )}
      {paywall && <PaywallModal source="lecture_notes" onClose={() => setPaywall(false)} />}
    </div>
  )
}

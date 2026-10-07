'use client'

// "Moments you marked" (2026-10-07): the other half of the "I'm lost" button.
// For each moment a student marked in a lecture, show what was being said
// around it and which terms were explained near it, so they can catch up on
// exactly the bit they lost, not re-read the whole lecture.
//
// Renders nothing when there are no marks, or when the session_marks table is
// not there yet (migration 042): this is an addition to a lecture, never an
// error on it.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { ReadAloudButton } from '@/components/ReadAloudButton'

interface Mark { at_ms: number; transcript_offset: number }
interface NearTerm { term: string; definition: string; created_at: string }

// How much transcript to show around a mark. Weighted towards what came
// BEFORE the press: that is what the student lost. A little after, because
// the last few seconds were often still being transcribed when they pressed.
const BEFORE_CHARS = 420
const AFTER_CHARS = 260
// Terms explained from 3 minutes before to 2 minutes after the mark.
const TERM_WINDOW_BEFORE_MS = 3 * 60_000
const TERM_WINDOW_AFTER_MS = 2 * 60_000

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

// Cut on word boundaries so an excerpt never starts or ends mid-word.
function excerpt(text: string, offset: number): string | null {
  if (!text) return null
  const at = Math.min(offset, text.length)
  let start = Math.max(0, at - BEFORE_CHARS)
  let end = Math.min(text.length, at + AFTER_CHARS)
  if (start > 0) { const sp = text.indexOf(' ', start); if (sp !== -1 && sp < at) start = sp + 1 }
  if (end < text.length) { const sp = text.lastIndexOf(' ', end); if (sp > at) end = sp }
  const body = text.slice(start, end).trim()
  if (!body) return null
  return `${start > 0 ? '… ' : ''}${body}${end < text.length ? ' …' : ''}`
}

export function LostMoments({ sessionId, startedAt, transcript }: { sessionId: string; startedAt: string; transcript: string | null }) {
  const [marks, setMarks] = useState<Mark[]>([])
  const [terms, setTerms] = useState<NearTerm[]>([])

  useEffect(() => {
    let cancelled = false
    const sb = createClient()
    sb.from('session_marks').select('at_ms, transcript_offset').eq('session_id', sessionId).order('at_ms')
      .then(({ data, error }) => {
        if (cancelled || error || !data?.length) return
        setMarks(data as Mark[])
        sb.from('terms').select('term, definition, created_at').eq('session_id', sessionId).order('created_at')
          .then(({ data: t }) => { if (!cancelled) setTerms((t ?? []) as NearTerm[]) })
      })
    return () => { cancelled = true }
  }, [sessionId])

  if (!marks.length) return null
  const t0 = new Date(startedAt).getTime()

  return (
    <div className="mt-4">
      <p className="text-[11px] font-bold tracking-[0.15em] uppercase text-gray-600 mb-2">
        {marks.length === 1 ? 'The moment you marked' : `Moments you marked (${marks.length})`}
      </p>
      <div className="space-y-3">
        {marks.map((m, i) => {
          const text = transcript ? excerpt(transcript, m.transcript_offset) : null
          const near = terms.filter(t => {
            const d = new Date(t.created_at).getTime() - (t0 + m.at_ms)
            return d >= -TERM_WINDOW_BEFORE_MS && d <= TERM_WINDOW_AFTER_MS
          }).slice(0, 4)
          return (
            <div key={i} className="rounded-xl border dark:border-brand-500/20 border-brand-200 dark:bg-brand-500/[0.05] bg-brand-50/60 px-4 py-3">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <p className="text-[12px] font-semibold dark:text-brand-300 text-brand-700">At {fmt(m.at_ms)}</p>
                {text && <ReadAloudButton text={text.replace(/…/g, '')} label={`Read the moment at ${fmt(m.at_ms)} aloud`} />}
              </div>
              {text ? (
                <p className="text-[calc(0.8125rem*var(--df-scale))] leading-relaxed dark:text-white/75 text-gray-800">{text}</p>
              ) : (
                <p className="text-[12px] dark:text-white/60 text-gray-600">The transcript for this lecture wasn&apos;t saved, so only the time is shown.</p>
              )}
              {near.length > 0 && (
                <div className="mt-2.5 pt-2.5 border-t dark:border-white/[0.06] border-black/[0.06] space-y-1.5">
                  <p className="text-[11px] text-gray-600">Terms explained around then</p>
                  {near.map(t => (
                    <p key={t.term} className="text-[calc(0.8125rem*var(--df-scale))] leading-snug dark:text-white/70 text-gray-700">
                      <span className="font-semibold dark:text-white/90 text-gray-900">{t.term}</span>: {t.definition}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

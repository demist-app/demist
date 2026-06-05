'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'

const NEW_CARDS_PER_DAY = 15

interface FlashCard {
  id: string
  term: string
  definition: string
  sm2_interval: number
  sm2_ease: number
  sm2_review_count: number
  isNew: boolean
}

function sm2Update(ease: number, interval: number, grade: 0 | 1 | 2 | 3): { interval: number; ease: number } {
  const newEase = Math.max(1.3, Math.min(3.0, ease + ([-0.2, -0.15, 0, 0.15] as const)[grade]))
  let newInterval: number
  if (grade === 0) {
    newInterval = 1
  } else if (grade === 1) {
    newInterval = Math.max(1, Math.round(interval * 1.2))
  } else if (grade === 2) {
    newInterval = Math.max(1, Math.round(interval * ease))
  } else {
    newInterval = Math.max(1, Math.round(interval * ease * 1.3))
  }
  return { interval: newInterval, ease: newEase }
}

const GRADE_LABELS: { grade: 0 | 1 | 2 | 3; label: string; ariaLabel: string; className: string }[] = [
  {
    grade: 0,
    label: 'Again',
    ariaLabel: 'Again — forgotten, review again soon',
    className:
      'bg-red-500/[0.10] border border-red-500/[0.20] text-red-400 hover:bg-red-500/[0.18] rounded-xl h-12 font-semibold text-[13px] active:scale-[0.97] transition-all duration-150',
  },
  {
    grade: 1,
    label: 'Hard',
    ariaLabel: 'Hard — remembered with difficulty',
    className:
      'bg-orange-500/[0.10] border border-orange-500/[0.20] text-orange-400 hover:bg-orange-500/[0.18] rounded-xl h-12 font-semibold text-[13px] active:scale-[0.97] transition-all duration-150',
  },
  {
    grade: 2,
    label: 'Good',
    ariaLabel: 'Good — remembered correctly',
    className:
      'bg-emerald-500/[0.10] border border-emerald-500/[0.20] text-emerald-400 hover:bg-emerald-500/[0.18] rounded-xl h-12 font-semibold text-[13px] active:scale-[0.97] transition-all duration-150',
  },
  {
    grade: 3,
    label: 'Easy',
    ariaLabel: 'Easy — remembered without effort',
    className:
      'bg-blue-500/[0.10] border border-blue-500/[0.20] text-blue-400 hover:bg-blue-500/[0.18] rounded-xl h-12 font-semibold text-[13px] active:scale-[0.97] transition-all duration-150',
  },
]

type Phase = 'loading' | 'empty' | 'review' | 'done'

export default function Flashcards() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [queue, setQueue] = useState<FlashCard[]>([])
  const [current, setCurrent] = useState<FlashCard | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const [dueCount, setDueCount] = useState(0)
  const [newCount, setNewCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [stuckOnLast, setStuckOnLast] = useState(false)
  const [reviewedCards, setReviewedCards] = useState<FlashCard[]>([])

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      posthog.capture('flashcards_viewed')

      const now = new Date().toISOString()

      // Two parallel queries - due reviews (unlimited) + new cards (daily budget)
      const [{ data: reviews }, { data: newCards }] = await Promise.all([
        supabase
          .from('terms')
          .select('id, term, definition, sm2_interval, sm2_ease, sm2_review_count')
          .eq('user_id', user.id)
          .eq('known', false)
          .gt('sm2_review_count', 0)
          .lte('sm2_due_at', now)
          .order('sm2_due_at', { ascending: true }),
        supabase
          .from('terms')
          .select('id, term, definition, sm2_interval, sm2_ease, sm2_review_count')
          .eq('user_id', user.id)
          .eq('known', false)
          .eq('sm2_review_count', 0)
          .order('created_at', { ascending: true })
          .limit(NEW_CARDS_PER_DAY),
      ])

      const due = (reviews ?? []).map(c => ({ ...c, isNew: false })) as FlashCard[]
      const fresh = (newCards ?? []).map(c => ({ ...c, isNew: true })) as FlashCard[]
      const cards = [...due, ...fresh]

      if (!cards.length) { setPhase('empty'); return }

      setDueCount(due.length)
      setNewCount(fresh.length)
      setQueue(cards.slice(1))
      setCurrent(cards[0])
      setPhase('review')
    })()
  }, [])

  const handleGrade = async (grade: 0 | 1 | 2 | 3) => {
    if (!current || saving) return
    setSaving(true)

    const { interval, ease } = sm2Update(
      current.sm2_ease ?? 2.5,
      current.sm2_interval ?? 1,
      grade,
    )
    const dueAt = new Date(Date.now() + interval * 86400000).toISOString()

    const supabase = createClient()
    const { error } = await supabase
      .from('terms')
      .update({
        sm2_interval: interval,
        sm2_ease: ease,
        sm2_due_at: dueAt,
        sm2_review_count: (current.sm2_review_count ?? 0) + 1,
      })
      .eq('id', current.id)

    if (error) {
      console.error('sm2 update failed:', error)
      setSaving(false)
      return
    }

    posthog.capture('flashcard_graded', { grade, interval, isNew: current.isNew })

    setFlipped(false)
    setSaving(false)

    if (grade === 0) {
      if (queue.length === 0) {
        setCurrent(current)
        setStuckOnLast(true)
      } else {
        setQueue(q => [...q, { ...current, isNew: false }])
        setCurrent(queue[0])
        setQueue(q => q.slice(1))
        setStuckOnLast(false)
      }
      return
    }

    setStuckOnLast(false)
    setReviewedCards(prev => [...prev, current])
    setReviewed(r => r + 1)
    if (queue.length === 0) {
      setPhase('done')
    } else {
      setCurrent(queue[0])
      setQueue(q => q.slice(1))
    }
  }

  const total = dueCount + newCount
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0

  return (
    <main className="min-h-dvh bg-[#08080E] text-white flex flex-col nav-bottom-pad">
      {/* Mobile header */}
      <header className="sm:hidden shrink-0 flex items-center justify-between px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Flashcards</span>
        {phase === 'review' && (
          <span className="text-[12px] text-white/30">
            {reviewed}/{total}
          </span>
        )}
      </header>

      {/* ── LOADING ── */}
      {phase === 'loading' && (
        <div className="flex-1 flex flex-col px-4 sm:px-6 pt-4 pb-4 animate-pulse">
          <div className="h-1.5 bg-white/[0.06] rounded-full mb-5" />
          <div className="flex items-center gap-2 mb-5">
            <div className="h-5 w-16 bg-white/[0.06] rounded-md" />
            <div className="h-5 w-14 bg-white/[0.06] rounded-md" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-md h-56 sm:h-64 bg-white/[0.03] border border-white/[0.06] rounded-2xl" />
          </div>
          <div className="grid grid-cols-4 gap-2 mt-5">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-white/[0.04] border border-white/[0.06] rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {/* ── EMPTY ── */}
      {phase === 'empty' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center gap-4">
          <div className="w-14 h-14 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-1">
            <svg className="w-6 h-6 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-[22px] font-bold text-white">All caught up</p>
          <p className="text-white/40 text-[14px] leading-relaxed max-w-xs">
            No cards due today. Record a lecture to add more terms.
          </p>
          <Button variant="secondary" size="lg" asChild className="mt-2">
            <Link href="/history">Browse past sessions</Link>
          </Button>
        </div>
      )}

      {/* ── DONE ── */}
      {phase === 'done' && (
        <div className="flex-1 flex flex-col px-4 sm:px-6 pt-8 pb-4 overflow-y-auto">
          {/* Completion hero */}
          <div className="flex flex-col items-center text-center gap-3 mb-8">
            <div className="w-16 h-16 rounded-full bg-emerald-500/[0.12] border border-emerald-500/[0.20] flex items-center justify-center mb-1">
              <svg className="w-8 h-8 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-[24px] font-bold text-white">Session complete</p>
            <p className="text-white/40 text-[14px] leading-relaxed max-w-xs">
              Come back tomorrow for the next batch.
            </p>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3 w-full max-w-xs mt-2">
              <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl px-4 py-3 text-center">
                <p className="text-[24px] font-bold text-white">{reviewed}</p>
                <p className="text-[11px] text-white/40 mt-0.5">Cards reviewed</p>
              </div>
              <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl px-4 py-3 text-center">
                <p className="text-[24px] font-bold text-emerald-400">100%</p>
                <p className="text-[11px] text-white/40 mt-0.5">Completion</p>
              </div>
            </div>

            <Button variant="secondary" size="lg" asChild className="mt-1 w-full max-w-xs">
              <Link href="/history">Browse past sessions</Link>
            </Button>
          </div>

          {/* Reviewed cards list */}
          {reviewedCards.length > 0 && (
            <>
              <p className="text-[10px] font-bold tracking-[0.18em] text-white/25 uppercase mb-3">
                Cards you reviewed
              </p>
              <div className="space-y-2">
                {reviewedCards.map(c => (
                  <div
                    key={c.id}
                    className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3"
                  >
                    <p className="text-[14px] font-medium text-white/90">{c.term}</p>
                    <p className="text-[12px] text-white/40 mt-1 leading-relaxed">{c.definition}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── REVIEW ── */}
      {phase === 'review' && current && (
        <div className="flex-1 flex flex-col px-4 sm:px-6 pt-4 pb-4">
          {/* Progress bar */}
          <Progress value={progressPct} className="shrink-0 mb-4" />

          {/* Queue badges + counter */}
          <div className="shrink-0 flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {dueCount > 0 && (
                <Badge variant="warning">{dueCount} due</Badge>
              )}
              {newCount > 0 && (
                <Badge variant="new">{newCount} new</Badge>
              )}
            </div>
            <span className="text-[12px] text-white/25">{reviewed}/{total}</span>
          </div>

          {/* Flip card */}
          <div className="flex-1 flex items-center justify-center">
            <div
              className="flashcard-flip w-full max-w-md cursor-pointer select-none"
              onClick={() => !flipped && setFlipped(true)}
              style={{ perspective: '1000px' }}
            >
              <div
                className="flashcard-inner relative"
                style={{
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  minHeight: '224px',
                }}
              >
                {/* Front face */}
                <div
                  className="flashcard-front absolute inset-0 bg-[#0F0F1B] border border-white/[0.10] rounded-2xl flex flex-col items-center justify-between p-8 sm:min-h-64"
                  style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                >
                  <div className="flex-1 flex flex-col items-center justify-center gap-4">
                    {current.isNew ? (
                      <Badge variant="new" className="rounded-full px-3 py-1 tracking-[0.16em] uppercase text-[10px]">
                        New
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="rounded-full px-3 py-1 tracking-[0.16em] uppercase text-[10px]">
                        Review
                      </Badge>
                    )}
                    <p className="text-[22px] sm:text-[26px] font-bold text-white text-center leading-snug">
                      {current.term}
                    </p>
                  </div>
                  {!flipped && (
                    <p className="text-[12px] text-white/25 mt-4">Tap to reveal</p>
                  )}
                </div>

                {/* Back face */}
                <div
                  className="flashcard-back absolute inset-0 bg-gradient-to-br from-amber-950/80 to-[#0F0F1B] border border-amber-500/[0.25] rounded-2xl flex flex-col items-center justify-center p-8 sm:min-h-64"
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                  }}
                >
                  <p className="text-[11px] font-bold tracking-[0.18em] text-amber-400/60 uppercase mb-4">
                    Definition
                  </p>
                  <p className="text-[15px] text-white/75 text-center leading-relaxed">
                    {current.definition}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Grade buttons (shown after flip) */}
          {flipped && (
            <>
              <div className="shrink-0 grid grid-cols-4 gap-2 mt-5 animate-step">
                {GRADE_LABELS.map(({ grade, label, ariaLabel, className }) => (
                  <button
                    key={grade}
                    onClick={() => handleGrade(grade)}
                    disabled={saving}
                    aria-label={ariaLabel}
                    className={cn(
                      'disabled:opacity-40 disabled:cursor-not-allowed',
                      className,
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {stuckOnLast && (
                <button
                  onClick={() => setPhase('done')}
                  className="shrink-0 mt-3 w-full text-center text-[13px] text-white/25 hover:text-white/50 transition-colors"
                >
                  Done for today →
                </button>
              )}
            </>
          )}

          {/* Show definition button (before flip) */}
          {!flipped && (
            <div className="shrink-0 mt-5">
              <Button
                variant="secondary"
                size="lg"
                className="w-full text-[15px]"
                onClick={() => setFlipped(true)}
              >
                Show definition
              </Button>
            </div>
          )}
        </div>
      )}
    </main>
  )
}

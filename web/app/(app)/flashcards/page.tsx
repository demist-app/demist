'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

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

const GRADE_LABELS: { grade: 0 | 1 | 2 | 3; label: string; ariaLabel: string; color: string }[] = [
  { grade: 0, label: 'Again', ariaLabel: 'Again: forgotten, review again soon',      color: 'border-red-500/40 hover:bg-red-500/10 text-red-400' },
  { grade: 1, label: 'Hard',  ariaLabel: 'Hard: remembered with difficulty',         color: 'border-orange-500/40 hover:bg-orange-500/10 text-orange-400' },
  { grade: 2, label: 'Good',  ariaLabel: 'Good: remembered correctly',               color: 'border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-400' },
  { grade: 3, label: 'Easy',  ariaLabel: 'Easy: remembered without effort',          color: 'border-yellow-500/40 hover:bg-yellow-500/10 dark:text-yellow-400 text-yellow-700' },
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
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
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

  const queueLabel = [
    dueCount > 0 && `${dueCount} due`,
    newCount > 0 && `${newCount} new`,
  ].filter(Boolean).join(' · ')

  return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col nav-bottom-pad">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-yellow-700/[0.05] blur-[120px]" />
      </div>
      <header className="sm:hidden relative z-10 shrink-0 flex items-center justify-between px-6 h-14 border-b dark:border-white/[0.05] border-black/[0.06]">
        <span className="font-semibold tracking-tight text-[15px]">Flashcards</span>
        {phase === 'review' && (
          <span className="text-[13px] text-gray-600">{queueLabel}</span>
        )}
      </header>

      {phase === 'loading' && (
        <div className="flex-1 flex flex-col px-4 sm:px-6 pt-4 pb-4 animate-pulse">
          <div className="h-1 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full mb-6" />
          <div className="flex items-center gap-2 mb-4">
            <div className="h-5 w-16 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full" />
            <div className="h-5 w-14 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-[380px] dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-[24px] h-[220px]" />
          </div>
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[0,1,2,3].map(i => (
              <div key={i} className="h-12 dark:bg-white/[0.04] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl" />
            ))}
          </div>
        </div>
      )}

      {phase === 'empty' && (
        <div className="flex-1 flex flex-col px-4 sm:px-6 py-8">
          <div className="flex flex-col items-center text-center gap-3 mb-8">
            <p className="text-[22px] font-bold">All caught up</p>
            <p className="text-gray-700 text-[14px] leading-relaxed max-w-xs">
              No cards due today. Record a lecture to add more terms.
            </p>
            <Link
              href="/history"
              className="mt-2 px-5 py-2.5 rounded-2xl dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.09] border-black/[0.14] text-[14px] font-medium text-gray-600 hover:dark:text-white text-gray-900 hover:dark:bg-white/[0.08] bg-[#EFEDE7] transition-all"
            >
              Browse past sessions
            </Link>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="flex-1 flex flex-col px-4 sm:px-6 py-6 overflow-y-auto">
          <div className="flex flex-col items-center text-center gap-2 mb-6">
            <p className="text-[22px] font-bold">Session done</p>
            <p className="text-gray-700 text-[14px]">
              {reviewed} card{reviewed !== 1 ? 's' : ''} reviewed. Come back tomorrow for the next batch.
            </p>
            <Link
              href="/history"
              className="mt-2 px-5 py-2.5 rounded-2xl dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.09] border-black/[0.14] text-[14px] font-medium text-gray-600 hover:dark:text-white text-gray-900 hover:dark:bg-white/[0.08] bg-[#EFEDE7] transition-all"
            >
              Browse past sessions
            </Link>
          </div>

          {reviewedCards.length > 0 && (
            <>
              <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-3">Cards you just reviewed</p>
              <div className="space-y-2">
                {reviewedCards.map(c => (
                  <div key={c.id} className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-4 py-3">
                    <p className="text-[14px] font-medium dark:text-white/90 text-gray-900">{c.term}</p>
                    <p className="text-[12px] text-gray-700 mt-1 leading-relaxed">{c.definition}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'review' && current && (
        <div className="flex-1 flex flex-col px-4 sm:px-6 pt-4 pb-4">
          {/* Progress bar */}
          <div className="shrink-0 h-1 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full mb-2 overflow-hidden">
            <div
              className="h-full bg-yellow-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Queue breakdown - visible on desktop where header is hidden */}
          <div className="shrink-0 flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {dueCount > 0 && (
                <span className="text-[11px] font-medium dark:text-orange-400/80 text-orange-700 dark:bg-orange-500/10 bg-orange-100 dark:border-orange-500/20 border-orange-200 rounded-full px-2 py-0.5">
                  {dueCount} due
                </span>
              )}
              {newCount > 0 && (
                <span className="text-[11px] font-medium dark:text-yellow-400 text-yellow-700/80 bg-yellow-500/10 border border-yellow-500/20 rounded-full px-2 py-0.5">
                  {newCount} new
                </span>
              )}
            </div>
            <span className="text-[12px] text-gray-600">{reviewed}/{total}</span>
          </div>

          {/* Flip card */}
          <div className="flex-1 flex items-center justify-center">
            <div
              className="flashcard-flip w-full max-w-[380px] cursor-pointer select-none"
              onClick={() => !flipped && setFlipped(true)}
              style={{ perspective: '1000px' }}
            >
              <div
                className="flashcard-inner relative"
                style={{
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  minHeight: '220px',
                }}
              >
                {/* Front */}
                <div
                  className="absolute inset-0 dark:bg-[#0d0d1c] bg-gray-50 border dark:border-white/[0.09] border-black/[0.14] rounded-[24px] flex flex-col items-center justify-center p-8"
                  style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                >
                  {current.isNew ? (
                    <span className="text-[10px] font-bold tracking-[0.18em] dark:text-yellow-400 text-yellow-700/70 bg-yellow-500/10 border border-yellow-500/20 rounded-full px-3 py-1 uppercase mb-4">New</span>
                  ) : (
                    <span className="text-[10px] font-bold tracking-[0.18em] text-gray-700/70 dark:bg-white/[0.04] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-full px-3 py-1 uppercase mb-4">Review</span>
                  )}
                  <p className="text-[26px] font-bold text-center leading-snug">{current.term}</p>
                  {!flipped && (
                    <p className="text-[12px] text-gray-700 mt-6">Tap to reveal definition</p>
                  )}
                </div>

                {/* Back */}
                <div
                  className="absolute inset-0 rounded-[24px] flex flex-col items-center justify-center p-8"
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                    background: 'linear-gradient(160deg, var(--accent-soft) 0%, var(--surface) 100%)',
                    border: '1px solid var(--accent-border)',
                  }}
                >
                  <p className="text-[11px] font-bold tracking-[0.18em] dark:text-yellow-400 text-yellow-700/60 uppercase mb-4">Definition</p>
                  <p className="text-[16px] text-center leading-relaxed" style={{ color: 'var(--fg)' }}>{current.definition}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Rating buttons */}
          {flipped && (
            <>
              <div className="shrink-0 grid grid-cols-4 gap-2 mt-4 animate-step">
                {GRADE_LABELS.map(({ grade, label, ariaLabel, color }) => (
                  <button
                    key={grade}
                    onClick={() => handleGrade(grade)}
                    disabled={saving}
                    aria-label={ariaLabel}
                    className={`py-3 rounded-2xl text-[13px] font-semibold border bg-transparent transition-colors duration-150 active:scale-[0.97] disabled:opacity-40 ${color}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {stuckOnLast && (
                <button
                  onClick={() => setPhase('done')}
                  className="shrink-0 mt-3 w-full text-center text-[13px] text-gray-600 hover:text-gray-600 transition-colors"
                >
                  Done for today →
                </button>
              )}
            </>
          )}

          {!flipped && (
            <div className="shrink-0 mt-4">
              <button
                onClick={() => setFlipped(true)}
                className="w-full py-4 rounded-2xl text-[15px] font-semibold dark:bg-white/[0.06] bg-[#F3F1EC] border dark:border-white/[0.08] border-black/[0.13] dark:text-white text-gray-900 hover:bg-white/[0.09] active:scale-[0.97] transition-colors duration-150"
              >
                Show definition
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  )
}

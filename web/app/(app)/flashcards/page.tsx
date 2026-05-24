'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

interface FlashCard {
  id: string
  term: string
  definition: string
  sm2_interval: number
  sm2_ease: number
  sm2_review_count: number
}

// SM-2 algorithm: grade 0=Again, 1=Hard, 2=Good, 3=Easy
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

const GRADE_LABELS: { grade: 0 | 1 | 2 | 3; label: string; color: string }[] = [
  { grade: 0, label: 'Again', color: 'border-red-500/40 hover:bg-red-500/10 text-red-400' },
  { grade: 1, label: 'Hard', color: 'border-orange-500/40 hover:bg-orange-500/10 text-orange-400' },
  { grade: 2, label: 'Good', color: 'border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-400' },
  { grade: 3, label: 'Easy', color: 'border-violet-500/40 hover:bg-violet-500/10 text-violet-400' },
]

type Phase = 'loading' | 'empty' | 'review' | 'done'

export default function Flashcards() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [queue, setQueue] = useState<FlashCard[]>([])
  const [current, setCurrent] = useState<FlashCard | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const [total, setTotal] = useState(0)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      posthog.capture('flashcards_viewed')

      const now = new Date().toISOString()
      const { data } = await supabase
        .from('terms')
        .select('id, term, definition, sm2_interval, sm2_ease, sm2_review_count')
        .eq('user_id', user.id)
        .eq('known', false)
        .lte('sm2_due_at', now)
        .order('sm2_due_at', { ascending: true })
        .limit(50)

      const cards = (data ?? []) as FlashCard[]
      if (!cards.length) { setPhase('empty'); return }

      setTotal(cards.length)
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
    await supabase
      .from('terms')
      .update({
        sm2_interval: interval,
        sm2_ease: ease,
        sm2_due_at: dueAt,
        sm2_review_count: (current.sm2_review_count ?? 0) + 1,
      })
      .eq('id', current.id)

    posthog.capture('flashcard_graded', { grade, interval, term: current.term })

    setReviewed(r => r + 1)
    setFlipped(false)
    setSaving(false)

    if (queue.length === 0) {
      setPhase('done')
    } else {
      setCurrent(queue[0])
      setQueue(q => q.slice(1))
    }
  }

  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0

  return (
    <main
      className="min-h-dvh bg-[#080810] text-white flex flex-col"
      style={{ paddingBottom: 'calc(52px + env(safe-area-inset-bottom))' }}
    >
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Flashcards</span>
        {phase === 'review' && (
          <span className="text-[13px] text-gray-600">{reviewed}/{total}</span>
        )}
      </header>

      {phase === 'loading' && <div className="flex-1" />}

      {phase === 'empty' && (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4">
          <div className="text-[44px]">🎉</div>
          <h2 className="text-[22px] font-bold">All caught up</h2>
          <p className="text-gray-500 text-[15px] leading-relaxed">
            No cards due for review. Start a lecture to add new terms to your deck.
          </p>
        </div>
      )}

      {phase === 'done' && (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-4">
          <div className="text-[44px]">✅</div>
          <h2 className="text-[22px] font-bold">Session complete</h2>
          <p className="text-gray-500 text-[15px]">
            You reviewed {reviewed} card{reviewed !== 1 ? 's' : ''}. Check back tomorrow.
          </p>
        </div>
      )}

      {phase === 'review' && current && (
        <div className="flex-1 flex flex-col px-4 sm:px-6 pt-4 pb-4">
          {/* Progress bar */}
          <div className="shrink-0 h-1 bg-white/[0.06] rounded-full mb-6 overflow-hidden">
            <div
              className="h-full bg-violet-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
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
                  className="absolute inset-0 bg-white/[0.04] border border-white/[0.08] rounded-[24px] flex flex-col items-center justify-center p-8"
                  style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                >
                  <p className="text-[11px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-4">Term</p>
                  <p className="text-[24px] font-bold text-center leading-snug">{current.term}</p>
                  {!flipped && (
                    <p className="text-[12px] text-gray-700 mt-6">Tap to reveal definition</p>
                  )}
                </div>

                {/* Back */}
                <div
                  className="absolute inset-0 bg-white/[0.04] border border-violet-500/20 rounded-[24px] flex flex-col items-center justify-center p-8"
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                  }}
                >
                  <p className="text-[11px] font-bold tracking-[0.18em] text-violet-500/70 uppercase mb-4">Definition</p>
                  <p className="text-[16px] text-gray-200 text-center leading-relaxed">{current.definition}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Rating buttons */}
          {flipped && (
            <div className="shrink-0 grid grid-cols-4 gap-2 mt-4 animate-step">
              {GRADE_LABELS.map(({ grade, label, color }) => (
                <button
                  key={grade}
                  onClick={() => handleGrade(grade)}
                  disabled={saving}
                  className={`py-3 rounded-2xl text-[13px] font-semibold border bg-transparent transition-all disabled:opacity-40 ${color}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {!flipped && (
            <div className="shrink-0 mt-4">
              <button
                onClick={() => setFlipped(true)}
                className="w-full py-4 rounded-2xl text-[15px] font-semibold bg-white/[0.06] border border-white/[0.08] text-white hover:bg-white/[0.09] transition-all"
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

'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'

interface StudyStats {
  dueCount: number
  newCount: number
  totalTerms: number
}

export default function StudyPage() {
  const router = useRouter()
  const [stats, setStats] = useState<StudyStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return
      capture('study_viewed')

      const now = new Date().toISOString()
      const [
        { count: dueCount },
        { count: newCount },
        { count: totalTerms },
      ] = await Promise.all([
        supabase
          .from('terms')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', session.user.id)
          .eq('known', false)
          .gt('sm2_review_count', 0)
          .lte('sm2_due_at', now),
        supabase
          .from('terms')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', session.user.id)
          .eq('known', false)
          .eq('sm2_review_count', 0),
        supabase
          .from('terms')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', session.user.id)
          .eq('known', false),
      ])

      setStats({
        dueCount: dueCount ?? 0,
        newCount: Math.min(newCount ?? 0, 15),
        totalTerms: totalTerms ?? 0,
      })
      setLoading(false)
    })()
  }, [])

  const goFlashcards = () => {
    capture('study_mode_selected', { mode: 'flashcards' })
    router.push('/flashcards?from=study')
  }

  const goQuiz = () => {
    capture('study_mode_selected', { mode: 'quiz' })
    router.push('/quiz?from=study')
  }

  const flashcardsDue = (stats?.dueCount ?? 0) + (stats?.newCount ?? 0)
  const hasCards = flashcardsDue > 0 || (stats?.totalTerms ?? 0) > 0

  return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col nav-bottom-pad overflow-x-hidden">
      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-yellow-700/[0.06] blur-[100px]" />
      </div>

      <header className="sm:hidden relative z-10 shrink-0 flex items-center px-6 h-14 border-b dark:border-white/[0.05] border-black/[0.06]">
        <span className="font-semibold tracking-tight text-[15px]">Study</span>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto">
        <div className="w-full max-w-lg mx-auto px-4 sm:px-6 py-8">

          {/* Heading */}
          <div className="mb-8 animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
            <p className="text-[28px] font-bold leading-tight tracking-tight">
              How do you want to study?
            </p>
            <p className="text-[14px] text-gray-600 mt-1.5">
              {loading
                ? 'Loading your cards…'
                : stats?.totalTerms === 0
                  ? 'Record a lecture to build your study material.'
                  : `${stats?.totalTerms} terms available`}
            </p>
          </div>

          {/* Mode cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">

            {/* Flashcards */}
            <button
              onClick={goFlashcards}
              disabled={loading}
              className="group text-left rounded-[20px] border dark:border-white/[0.07] border-black/[0.14] dark:bg-white/[0.03] bg-[#FAF9F6] hover:dark:bg-white/[0.06] hover:bg-white hover:border-yellow-500/30 hover:shadow-[0_0_0_1px_rgba(234,179,8,0.15)] active:scale-[0.98] transition-all duration-150 overflow-hidden animate-step opacity-0 disabled:pointer-events-none"
              style={{ animationFillMode: 'forwards', animationDelay: '80ms' }}
            >
              {/* Card top accent */}
              <div className="h-[3px] dark:bg-yellow-500/30 bg-yellow-400/40 group-hover:bg-yellow-500/60 transition-colors" />

              <div className="p-5">
                {/* Icon + badge */}
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl dark:bg-white/[0.06] bg-[#F3F1EC] border dark:border-white/[0.08] border-black/[0.12] flex items-center justify-center dark:text-yellow-400 text-yellow-700">
                    <CardIcon />
                  </div>
                  {!loading && flashcardsDue > 0 && (
                    <span className="text-[11px] font-bold dark:bg-yellow-500/10 bg-yellow-100 dark:border-yellow-500/20 border-yellow-300/60 border rounded-full px-2.5 py-0.5 dark:text-yellow-300 text-yellow-800 tabular-nums">
                      {flashcardsDue} to review
                    </span>
                  )}
                  {!loading && flashcardsDue === 0 && (stats?.totalTerms ?? 0) > 0 && (
                    <span className="text-[11px] font-medium dark:text-emerald-400/70 text-emerald-700 dark:bg-emerald-500/10 bg-emerald-50 border dark:border-emerald-500/20 border-emerald-200 rounded-full px-2.5 py-0.5">
                      All caught up
                    </span>
                  )}
                </div>

                <p className="text-[17px] font-bold dark:text-white text-gray-900 mb-1.5 leading-snug">
                  Flashcards
                </p>
                <p className="text-[13px] dark:text-gray-500 text-gray-600 leading-relaxed mb-5">
                  Review terms at the right time. SM‑2 schedules each card based on how well you remembered it.
                </p>

                {/* Stats */}
                {loading ? (
                  <div className="flex gap-2 animate-pulse">
                    <div className="h-5 w-16 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full" />
                    <div className="h-5 w-12 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full" />
                  </div>
                ) : (
                  <div className="flex items-center flex-wrap gap-1.5">
                    {(stats?.dueCount ?? 0) > 0 && (
                      <span className="text-[11px] font-medium dark:text-orange-400 text-orange-700 dark:bg-orange-500/10 bg-orange-50 border dark:border-orange-500/20 border-orange-200/80 rounded-full px-2 py-0.5 tabular-nums">
                        {stats!.dueCount} due
                      </span>
                    )}
                    {(stats?.newCount ?? 0) > 0 && (
                      <span className="text-[11px] font-medium dark:text-yellow-400 text-yellow-700 bg-yellow-500/10 border border-yellow-500/20 rounded-full px-2 py-0.5 tabular-nums">
                        {stats!.newCount} new
                      </span>
                    )}
                    {flashcardsDue === 0 && (stats?.totalTerms ?? 0) === 0 && (
                      <span className="text-[11px] text-gray-700">No cards yet</span>
                    )}
                  </div>
                )}

                {/* CTA */}
                <div className="mt-5 flex items-center gap-1.5 dark:text-yellow-400 text-yellow-700 text-[13px] font-semibold group-hover:gap-2.5 transition-all duration-150">
                  <span>{flashcardsDue > 0 ? 'Start session' : 'Browse cards'}</span>
                  <span className="text-[16px] leading-none">→</span>
                </div>
              </div>
            </button>

            {/* Quiz */}
            <button
              onClick={goQuiz}
              disabled={loading || (stats?.totalTerms ?? 0) < 4}
              className="group text-left rounded-[20px] border dark:border-white/[0.07] border-black/[0.14] dark:bg-white/[0.03] bg-[#FAF9F6] hover:dark:bg-white/[0.06] hover:bg-white hover:border-yellow-500/30 hover:shadow-[0_0_0_1px_rgba(234,179,8,0.15)] active:scale-[0.98] transition-all duration-150 overflow-hidden animate-step opacity-0 disabled:opacity-50 disabled:pointer-events-none"
              style={{ animationFillMode: 'forwards', animationDelay: '140ms' }}
            >
              <div className="h-[3px] dark:bg-white/[0.08] bg-black/[0.06] group-hover:bg-yellow-500/40 transition-colors" />

              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl dark:bg-white/[0.06] bg-[#F3F1EC] border dark:border-white/[0.08] border-black/[0.12] flex items-center justify-center dark:text-gray-400 text-gray-600 group-hover:dark:text-yellow-400 group-hover:text-yellow-700 transition-colors">
                    <QuizIcon />
                  </div>
                  {!loading && (stats?.totalTerms ?? 0) < 4 && (
                    <span className="text-[11px] font-medium dark:text-gray-600 text-gray-500 dark:bg-white/[0.04] bg-gray-100 border dark:border-white/[0.06] border-gray-200 rounded-full px-2.5 py-0.5">
                      Need 4+ terms
                    </span>
                  )}
                </div>

                <p className="text-[17px] font-bold dark:text-white text-gray-900 mb-1.5 leading-snug">
                  Quiz
                </p>
                <p className="text-[13px] dark:text-gray-500 text-gray-600 leading-relaxed mb-5">
                  Test yourself with multiple choice and recall questions across any scope or time range.
                </p>

                {loading ? (
                  <div className="animate-pulse h-5 w-20 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full" />
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-medium dark:text-gray-400 text-gray-600 dark:bg-white/[0.05] bg-gray-100 border dark:border-white/[0.07] border-gray-200 rounded-full px-2 py-0.5 tabular-nums">
                      {stats?.totalTerms ?? 0} terms
                    </span>
                    <span className="text-[11px] dark:text-gray-600 text-gray-500">available</span>
                  </div>
                )}

                <div className="mt-5 flex items-center gap-1.5 dark:text-gray-400 text-gray-600 group-hover:dark:text-yellow-400 group-hover:text-yellow-700 text-[13px] font-semibold group-hover:gap-2.5 transition-all duration-150">
                  <span>Set up quiz</span>
                  <span className="text-[16px] leading-none">→</span>
                </div>
              </div>
            </button>
          </div>

          {/* Browse all cards link */}
          {!loading && hasCards && (
            <button
              onClick={() => router.push('/flashcards?from=study&view=browse')}
              className="w-full flex items-center justify-between px-5 py-4 rounded-2xl dark:bg-white/[0.02] bg-[#F6F5F2] border dark:border-white/[0.06] border-black/[0.10] dark:text-gray-500 text-gray-600 dark:hover:text-white hover:text-gray-900 hover:border-yellow-500/20 active:scale-[0.98] transition-all duration-150 animate-step opacity-0"
              style={{ animationFillMode: 'forwards', animationDelay: '200ms' }}
            >
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg dark:bg-white/[0.05] bg-gray-200/60 flex items-center justify-center shrink-0">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                </div>
                <span className="text-[13px] font-medium">Browse all cards</span>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-40">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}

          {/* Empty state */}
          {!loading && (stats?.totalTerms ?? 0) === 0 && (
            <div className="flex flex-col items-center text-center py-6 gap-4 animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '200ms' }}>
              <p className="text-[14px] text-gray-600 leading-relaxed max-w-xs">
                Record your first lecture and Demist will build your flashcards and quiz material automatically.
              </p>
              <button
                onClick={() => router.push('/dashboard')}
                className="px-6 py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform]"
              >
                Start recording →
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

function CardIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  )
}

function QuizIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

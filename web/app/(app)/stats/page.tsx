'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

interface DayBar { label: string; count: number }
interface WeekBar { label: string; count: number }
interface SubjectBar { subject: string; count: number }

function calculateStreak(timestamps: string[]): number {
  if (!timestamps.length) return 0
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = new Set(timestamps.map(t => { const d = new Date(t); d.setHours(0,0,0,0); return d.getTime() }))
  let streak = 0; let cur = today.getTime()
  while (days.has(cur)) { streak++; cur -= 86400000 }
  return streak
}

function get7DayBars(sessionTimestamps: string[]): DayBar[] {
  const DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0,0,0,0)
    const next = new Date(d.getTime() + 86400000)
    const count = sessionTimestamps.filter(t => {
      const ts = new Date(t).getTime()
      return ts >= d.getTime() && ts < next.getTime()
    }).length
    return { label: DAY[d.getDay()], count }
  })
}

function get8WeekBars(termTimestamps: string[]): WeekBar[] {
  const now = new Date(); now.setHours(0,0,0,0)
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  return Array.from({ length: 8 }, (_, i) => {
    const start = new Date(monday.getTime() - (7 - i) * 7 * 86400000)
    const end = new Date(start.getTime() + 7 * 86400000)
    const count = termTimestamps.filter(t => {
      const ts = new Date(t).getTime()
      return ts >= start.getTime() && ts < end.getTime()
    }).length
    const label = i === 7 ? 'This wk' : start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    return { label, count }
  })
}

export default function Stats() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  const [totalTerms, setTotalTerms] = useState(0)
  const [totalSessions, setTotalSessions] = useState(0)
  const [streak, setStreak] = useState(0)
  const [dueFlashcards, setDueFlashcards] = useState(0)
  const [masteredTerms, setMasteredTerms] = useState(0)
  const [dailySessions, setDailySessions] = useState<DayBar[]>([])
  const [weeklyTerms, setWeeklyTerms] = useState<WeekBar[]>([])
  const [subjects, setSubjects] = useState<SubjectBar[]>([])

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }

      const now = new Date().toISOString()

      const [
        { data: allSessions },
        { data: allTerms },
        { count: dueCount },
        { count: newCount },
        { count: masteredCount },
      ] = await Promise.all([
        supabase.from('sessions').select('started_at').eq('user_id', user.id).order('started_at', { ascending: false }),
        supabase.from('terms').select('created_at, subject, known').eq('user_id', user.id),
        supabase.from('terms').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id).eq('known', false).gt('sm2_review_count', 0).lte('sm2_due_at', now),
        supabase.from('terms').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id).eq('known', false).eq('sm2_review_count', 0),
        supabase.from('terms').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id).eq('known', true),
      ])

      const sessions = allSessions ?? []
      const terms = allTerms ?? []

      setTotalSessions(sessions.length)
      setTotalTerms(terms.length)
      setStreak(calculateStreak(sessions.map(s => s.started_at)))
      setDueFlashcards((dueCount ?? 0) + Math.min(15, newCount ?? 0))
      setMasteredTerms(masteredCount ?? 0)
      setDailySessions(get7DayBars(sessions.map(s => s.started_at)))
      setWeeklyTerms(get8WeekBars(terms.map(t => t.created_at)))

      const subjectMap: Record<string, number> = {}
      for (const t of terms) {
        const key = t.subject?.trim() || 'Other'
        subjectMap[key] = (subjectMap[key] ?? 0) + 1
      }
      setSubjects(
        Object.entries(subjectMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([subject, count]) => ({ subject, count }))
      )

      setLoading(false)
    })()
  }, [])

  const maxDaily = Math.max(...dailySessions.map(d => d.count), 1)
  const maxWeekly = Math.max(...weeklyTerms.map(w => w.count), 1)
  const maxSubject = Math.max(...subjects.map(s => s.count), 1)

  if (loading) return <div className="min-h-dvh bg-[#080810]" />

  const hasAnyData = totalTerms > 0 || totalSessions > 0

  return (
    <main className="min-h-dvh bg-[#080810] text-white flex flex-col nav-bottom-pad">
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Stats</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">

          {/* Header */}
          <div className="animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
            <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-1">Your progress</p>
            <p className="text-[22px] font-bold leading-tight">Stats</p>
          </div>

          {/* Key numbers — 2 cols mobile, 4 cols desktop */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-step opacity-0" style={{ animationDelay: '50ms', animationFillMode: 'forwards' }}>
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl px-4 py-4">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <p className="text-[11px] text-gray-600 uppercase tracking-[0.12em]">Terms</p>
              </div>
              <p className="text-[28px] font-bold leading-none text-emerald-400">{totalTerms}</p>
              {masteredTerms > 0 && (
                <p className="text-[11px] text-gray-600 mt-1.5">{masteredTerms} mastered</p>
              )}
            </div>
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl px-4 py-4">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                <p className="text-[11px] text-gray-600 uppercase tracking-[0.12em]">Sessions</p>
              </div>
              <p className="text-[28px] font-bold leading-none text-violet-400">{totalSessions}</p>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl px-4 py-4">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <p className="text-[11px] text-gray-600 uppercase tracking-[0.12em]">Streak</p>
              </div>
              <p className="text-[28px] font-bold leading-none text-amber-400">{streak}</p>
              <p className="text-[11px] text-gray-600 mt-1.5">{streak === 1 ? 'day' : 'days'}</p>
            </div>
            <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl px-4 py-4">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                <p className="text-[11px] text-gray-600 uppercase tracking-[0.12em]">Due</p>
              </div>
              <p className="text-[28px] font-bold leading-none text-white/80">{dueFlashcards}</p>
              <p className="text-[11px] text-gray-600 mt-1.5">flashcards</p>
            </div>
          </div>

          {/* Charts row — side by side on desktop */}
          {hasAnyData && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-step opacity-0" style={{ animationDelay: '100ms', animationFillMode: 'forwards' }}>
              {/* Sessions this week */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-4">
                <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-4">Sessions this week</p>
                <div className="flex items-end gap-1.5 h-[60px]">
                  {dailySessions.map((d, i) => {
                    const h = Math.max(3, Math.round((d.count / maxDaily) * 52))
                    const isToday = i === dailySessions.length - 1
                    return (
                      <div key={i} className="flex flex-col items-center gap-1 flex-1">
                        <div
                          className={`w-full rounded-sm transition-all ${isToday ? 'bg-violet-500' : d.count > 0 ? 'bg-white/[0.18]' : 'bg-white/[0.05]'}`}
                          style={{ height: `${h}px` }}
                        />
                        <span className={`text-[9px] ${isToday ? 'text-violet-400' : 'text-gray-700'}`}>{d.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Terms over 8 weeks */}
              <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-4">
                <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-4">Terms detected (8 weeks)</p>
                <div className="flex items-end gap-1 h-[60px]">
                  {weeklyTerms.map((w, i) => {
                    const h = Math.max(3, Math.round((w.count / maxWeekly) * 52))
                    const isThis = i === weeklyTerms.length - 1
                    return (
                      <div key={i} className="flex flex-col items-center gap-1 flex-1">
                        <div
                          className={`w-full rounded-sm transition-all ${isThis ? 'bg-emerald-500' : w.count > 0 ? 'bg-white/[0.15]' : 'bg-white/[0.04]'}`}
                          style={{ height: `${h}px` }}
                        />
                        <span className={`text-[8px] truncate w-full text-center ${isThis ? 'text-emerald-400' : 'text-gray-700'}`}>{w.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Subjects breakdown */}
          {subjects.length > 0 && (
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-4 animate-step opacity-0" style={{ animationDelay: '150ms', animationFillMode: 'forwards' }}>
              <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-4">Terms by subject</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                {subjects.map(({ subject, count }) => {
                  const pct = Math.round((count / maxSubject) * 100)
                  return (
                    <div key={subject}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[13px] text-white/80 truncate max-w-[80%]">{subject}</span>
                        <span className="text-[12px] text-gray-500 tabular-nums">{count}</span>
                      </div>
                      <div className="h-1 rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-violet-500/60"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!hasAnyData && (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
              <p className="text-gray-600">No data yet.</p>
              <p className="text-gray-700 text-[13px]">Record your first lecture on the Home tab to get started.</p>
            </div>
          )}

        </div>
      </div>
    </main>
  )
}

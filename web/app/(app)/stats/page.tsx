'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'

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

  if (loading) return <div className="min-h-dvh bg-[#08080E]" />

  const hasAnyData = totalTerms > 0 || totalSessions > 0

  return (
    <main className="min-h-dvh bg-[#08080E] text-white flex flex-col nav-bottom-pad">
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Stats</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4">

          {/* Page header */}
          <div className="animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
            <p className="text-[11px] font-bold tracking-[0.14em] text-white/30 uppercase mb-1">Your progress</p>
            <p className="text-[22px] font-bold leading-tight">Stats</p>
          </div>

          {/* 4 metric cards — 2x2 mobile, 4-col desktop */}
          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-step opacity-0"
            style={{ animationDelay: '50ms', animationFillMode: 'forwards' }}
          >
            {/* Terms */}
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                {/* Book icon — violet */}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-violet-400 shrink-0">
                  <path d="M10.75 16.82A7.462 7.462 0 0 1 15 15.5c.71 0 1.396.098 2.046.282A.75.75 0 0 0 18 15.06v-11a.75.75 0 0 0-.546-.721A9.006 9.006 0 0 0 15 3a8.963 8.963 0 0 0-4.25 1.065V16.82ZM9.25 4.065A8.963 8.963 0 0 0 5 3c-.85 0-1.673.118-2.454.339A.75.75 0 0 0 2 4.06v11a.75.75 0 0 0 .954.721A7.506 7.506 0 0 1 5 15.5c1.579 0 3.042.487 4.25 1.32V4.065Z" />
                </svg>
                <p className="text-[11px] text-white/35 uppercase tracking-[0.12em]">Terms</p>
              </div>
              <p className="text-[32px] font-bold leading-none text-violet-400 tabular-nums">{totalTerms}</p>
              <p className="text-[11px] text-white/30 mt-2">total terms learned</p>
              {masteredTerms > 0 && (
                <p className="text-[11px] text-white/35 mt-1">{masteredTerms} mastered</p>
              )}
            </div>

            {/* Sessions */}
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                {/* Play icon — indigo */}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-indigo-400 shrink-0">
                  <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" />
                </svg>
                <p className="text-[11px] text-white/35 uppercase tracking-[0.12em]">Sessions</p>
              </div>
              <p className="text-[32px] font-bold leading-none text-indigo-400 tabular-nums">{totalSessions}</p>
              <p className="text-[11px] text-white/30 mt-2">total sessions</p>
            </div>

            {/* Streak */}
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                {/* Flame SVG icon — amber */}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-amber-400 shrink-0">
                  <path fillRule="evenodd" d="M13.5 4.938a7 7 0 1 1-7.313 11.424A5.5 5.5 0 0 0 13.5 4.938ZM10 3a7 7 0 0 0-1.398.14c-.362.074-.72.177-1.063.311C8.898 4.374 9.5 5.8 9.5 7.5c0 2.485-1.336 4.657-3.329 5.837A7 7 0 0 1 10 3Z" clipRule="evenodd" />
                </svg>
                <p className="text-[11px] text-white/35 uppercase tracking-[0.12em]">Streak</p>
              </div>
              <p className="text-[32px] font-bold leading-none text-amber-400 tabular-nums">{streak}</p>
              <p className="text-[11px] text-white/30 mt-2">{streak === 1 ? 'day' : 'days'}</p>
            </div>

            {/* Due flashcards */}
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                {/* Cards/stack icon — emerald */}
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-emerald-400 shrink-0">
                  <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h11A1.5 1.5 0 0 1 17 3.5v1A1.5 1.5 0 0 1 15.5 6h-11A1.5 1.5 0 0 1 3 4.5v-1ZM3.25 8A.75.75 0 0 1 4 7.25h12a.75.75 0 0 1 .75.75v1a.75.75 0 0 1-.75.75H4A.75.75 0 0 1 3.25 9V8ZM4 11.25a.75.75 0 0 0-.75.75v1c0 .414.336.75.75.75h12a.75.75 0 0 0 .75-.75v-1a.75.75 0 0 0-.75-.75H4Z" />
                </svg>
                <p className="text-[11px] text-white/35 uppercase tracking-[0.12em]">Due</p>
              </div>
              <p className="text-[32px] font-bold leading-none text-emerald-400 tabular-nums">{dueFlashcards}</p>
              <p className="text-[11px] text-white/30 mt-2">flashcards due</p>
            </div>
          </div>

          {/* Charts */}
          {(dailySessions.some(d => d.count > 0) || weeklyTerms.some(w => w.count > 0)) && (
            <div
              className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-step opacity-0"
              style={{ animationDelay: '100ms', animationFillMode: 'forwards' }}
            >
              {/* Sessions this week */}
              {dailySessions.some(d => d.count > 0) && (
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl px-5 py-5">
                  <p className="text-[11px] font-bold tracking-[0.14em] text-white/30 uppercase mb-4">Sessions this week</p>
                  <div className="flex items-end gap-1.5 h-[64px]">
                    {dailySessions.map((d, i) => {
                      const h = Math.max(4, Math.round((d.count / maxDaily) * 56))
                      const isToday = i === dailySessions.length - 1
                      return (
                        <div key={i} className="flex flex-col items-center gap-1.5 flex-1 group">
                          <div
                            className={cn(
                              'w-full rounded-full transition-all duration-200',
                              isToday
                                ? 'bg-violet-500 group-hover:bg-violet-400'
                                : d.count > 0
                                  ? 'bg-white/[0.12] group-hover:bg-white/[0.20]'
                                  : 'bg-white/[0.05]'
                            )}
                            style={{ height: `${h}px` }}
                          />
                          <span className={cn(
                            'text-[9px]',
                            isToday ? 'text-violet-400' : 'text-white/25'
                          )}>
                            {d.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Terms over 8 weeks */}
              {weeklyTerms.some(w => w.count > 0) && (
                <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl px-5 py-5">
                  <p className="text-[11px] font-bold tracking-[0.14em] text-white/30 uppercase mb-4">Terms detected (8 weeks)</p>
                  <div className="flex items-end gap-1 h-[64px]">
                    {weeklyTerms.map((w, i) => {
                      const h = Math.max(4, Math.round((w.count / maxWeekly) * 56))
                      const isThis = i === weeklyTerms.length - 1
                      return (
                        <div key={i} className="flex flex-col items-center gap-1.5 flex-1 group">
                          <div
                            className={cn(
                              'w-full rounded-full transition-all duration-200',
                              isThis
                                ? 'bg-violet-500 group-hover:bg-violet-400'
                                : w.count > 0
                                  ? 'bg-white/[0.12] group-hover:bg-white/[0.20]'
                                  : 'bg-white/[0.05]'
                            )}
                            style={{ height: `${h}px` }}
                          />
                          <span className={cn(
                            'text-[8px] truncate w-full text-center',
                            isThis ? 'text-violet-400' : 'text-white/25'
                          )}>
                            {w.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Subject breakdown */}
          {subjects.length > 0 && (
            <div
              className="bg-white/[0.04] border border-white/[0.08] rounded-2xl px-5 py-5 animate-step opacity-0"
              style={{ animationDelay: '150ms', animationFillMode: 'forwards' }}
            >
              <p className="text-[11px] font-bold tracking-[0.14em] text-white/30 uppercase mb-4">Terms by subject</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                {subjects.map(({ subject, count }) => {
                  const pct = Math.round((count / maxSubject) * 100)
                  return (
                    <div key={subject}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[13px] text-white/80 truncate max-w-[80%]">{subject}</span>
                        <span className="text-[12px] text-white/35 tabular-nums">{count}</span>
                      </div>
                      <Progress value={pct} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {!hasAnyData && (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
              <p className="text-white/30">No data yet.</p>
              <p className="text-white/20 text-[13px]">Record your first lecture on the Home tab to get started.</p>
            </div>
          )}

        </div>
      </div>
    </main>
  )
}

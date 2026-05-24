'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

interface ProfileData {
  display_name: string | null
  course: string | null
  year_of_study: number | null
  email: string
}

interface ChartDay {
  label: string
  count: number
}

const YEAR_LABELS: Record<number, string> = {
  1: '1st Year', 2: '2nd Year', 3: '3rd Year', 4: '4th Year', 5: 'Postgrad',
}

function get7DayChart(timestamps: string[]): ChartDay[] {
  const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0,0,0,0)
    const next = new Date(d.getTime() + 86400000)
    const count = timestamps.filter(t => { const ts = new Date(t).getTime(); return ts >= d.getTime() && ts < next.getTime() }).length
    return { label: DAY_LABELS[d.getDay()], count }
  })
}

export default function Profile() {
  const router = useRouter()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [course, setCourse] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [totalTerms, setTotalTerms] = useState(0)
  const [totalSessions, setTotalSessions] = useState(0)
  const [chartData, setChartData] = useState<ChartDay[]>([])
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
      const [
        { data: prof },
        { count: termCount },
        { count: sessionCount },
        { data: recentTerms },
      ] = await Promise.all([
        supabase.from('profiles').select('display_name, course, year_of_study').eq('id', user.id).single(),
        supabase.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        supabase.from('terms').select('created_at').eq('user_id', user.id).gte('created_at', weekAgo),
      ])

      const p = prof as { display_name: string | null; course: string | null; year_of_study: number | null }
      setProfile({ display_name: p?.display_name ?? null, course: p?.course ?? null, year_of_study: p?.year_of_study ?? null, email: user.email ?? '' })
      setDisplayName(p?.display_name ?? '')
      setCourse(p?.course ?? '')
      setYear(p?.year_of_study ?? null)
      setTotalTerms(termCount ?? 0)
      setTotalSessions(sessionCount ?? 0)
      setChartData(get7DayChart((recentTerms ?? []).map((t: { created_at: string }) => t.created_at)))
    })()
  }, [])

  const handleSave = async () => {
    if (!userId) return
    setSaving(true)
    const supabase = createClient()
    await supabase.from('profiles')
      .update({ display_name: displayName.trim() || null, course: course.trim() || null, year_of_study: year })
      .eq('id', userId)
    posthog.capture('profile_updated')
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSignOut = async () => {
    await createClient().auth.signOut()
    posthog.reset()
    router.replace('/login')
  }

  const initials = (displayName || profile?.email || '?').slice(0, 1).toUpperCase()
  const maxChart = Math.max(...chartData.map(d => d.count), 1)

  if (!profile) return <div className="min-h-dvh bg-[#080810]" />

  return (
    <main
      className="min-h-dvh bg-[#080810] text-white flex flex-col"
      style={{ paddingBottom: 'calc(52px + env(safe-area-inset-bottom))' }}
    >
      <header className="shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Profile</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Avatar + name */}
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-[22px] font-bold text-violet-400 shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-semibold truncate">{displayName || 'No name set'}</p>
            <p className="text-[13px] text-gray-500 truncate">{profile.email}</p>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3">
            <p className="text-[10px] text-gray-600 uppercase tracking-[0.12em]">Total terms</p>
            <p className="text-[26px] font-bold leading-none mt-1">{totalTerms}</p>
          </div>
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3">
            <p className="text-[10px] text-gray-600 uppercase tracking-[0.12em]">Sessions</p>
            <p className="text-[26px] font-bold leading-none mt-1">{totalSessions}</p>
          </div>
        </div>

        {/* 7-day chart */}
        {chartData.some(d => d.count > 0) && (
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-4">
            <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-4">Terms this week</p>
            <div className="flex items-end gap-1.5 h-[52px]">
              {chartData.map((d, i) => {
                const height = Math.max(3, Math.round((d.count / maxChart) * 44))
                const isToday = i === chartData.length - 1
                return (
                  <div key={i} className="flex flex-col items-center gap-1 flex-1">
                    <div
                      className={`w-full rounded-sm ${isToday ? 'bg-violet-500' : 'bg-white/[0.12]'}`}
                      style={{ height: `${height}px` }}
                    />
                    <span className={`text-[9px] ${isToday ? 'text-violet-400' : 'text-gray-700'}`}>{d.label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Edit form */}
        <div className="space-y-3">
          <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase">Settings</p>

          <div>
            <label className="text-[12px] text-gray-600 mb-1.5 block">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Your name"
              className="w-full bg-white/[0.05] border border-white/[0.1] rounded-2xl px-5 py-3.5 text-white text-[15px] placeholder-gray-700 focus:outline-none focus:border-violet-500/50 transition-all"
            />
          </div>

          <div>
            <label className="text-[12px] text-gray-600 mb-1.5 block">Course / subject</label>
            <input
              type="text"
              value={course}
              onChange={e => setCourse(e.target.value)}
              placeholder="e.g. Molecular Biology"
              className="w-full bg-white/[0.05] border border-white/[0.1] rounded-2xl px-5 py-3.5 text-white text-[15px] placeholder-gray-700 focus:outline-none focus:border-violet-500/50 transition-all"
            />
          </div>

          <div>
            <label className="text-[12px] text-gray-600 mb-1.5 block">Year of study</label>
            <div className="grid grid-cols-5 gap-2">
              {[1,2,3,4,5].map(v => (
                <button
                  key={v}
                  onClick={() => setYear(v)}
                  className={`py-3 rounded-2xl text-[13px] font-medium transition-all ${
                    year === v
                      ? 'bg-violet-600 border border-violet-400/40 text-white'
                      : 'bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:bg-white/[0.09]'
                  }`}
                >
                  {v === 5 ? 'PG' : `Y${v}`}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-4 rounded-2xl text-[15px] font-semibold transition-all ${
              saved
                ? 'bg-emerald-600 text-white'
                : 'bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40'
            }`}
          >
            {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="w-full py-4 rounded-2xl text-[15px] font-medium bg-white/[0.03] border border-white/[0.06] text-gray-500 hover:text-red-400 hover:border-red-500/20 transition-all"
        >
          Sign out
        </button>
      </div>
    </main>
  )
}

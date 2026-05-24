'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

interface LeaderboardEntry {
  user_id: string
  display_name: string
  terms_this_week: number
  total_terms: number
}

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const [{ data: { user } }, { data }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc('get_weekly_leaderboard'),
      ])
      setCurrentUserId(user?.id ?? null)
      setEntries((data ?? []) as LeaderboardEntry[])
      setLoading(false)
    })()
  }, [])

  const medals = ['🥇', '🥈', '🥉']

  return (
    <main className="min-h-dvh bg-[#080810] text-white flex flex-col nav-bottom-pad">
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Leaderboard</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-1">This week</p>
          <p className="text-[13px] text-gray-600">Top learners by terms picked up in the last 7 days</p>
        </div>

        {loading && <div className="py-12" />}

        {!loading && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <p className="text-gray-600">No public learners yet.</p>
            <p className="text-gray-700 text-[13px]">Enable your public profile in Settings to appear here.</p>
          </div>
        )}

        {entries.length > 0 && (
          <div className="space-y-2">
            {entries.map((entry, i) => {
              const isYou = entry.user_id === currentUserId
              return (
                <a
                  key={entry.user_id}
                  href={`/u/${entry.user_id}`}
                  className={`flex items-center gap-4 px-4 py-3 rounded-2xl border transition-all ${
                    isYou
                      ? 'bg-violet-500/10 border-violet-500/25'
                      : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.05]'
                  }`}
                >
                  <span className="text-[20px] w-7 text-center shrink-0">
                    {medals[i] ?? <span className="text-[14px] font-bold text-gray-600">{i + 1}</span>}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[14px] font-medium truncate ${isYou ? 'text-violet-300' : 'text-white/90'}`}>
                      {entry.display_name}{isYou && <span className="text-[11px] text-violet-500/70 ml-2">you</span>}
                    </p>
                    <p className="text-[12px] text-gray-600 mt-0.5">{entry.total_terms} total</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-[18px] font-bold ${isYou ? 'text-violet-400' : 'text-white'}`}>
                      {entry.terms_this_week}
                    </p>
                    <p className="text-[11px] text-gray-600">this week</p>
                  </div>
                </a>
              )
            })}
          </div>
        )}

        {!loading && (
          <p className="text-center text-[12px] text-gray-700 mt-8">
            Enable your public profile in{' '}
            <a href="/profile" className="text-violet-500/70 hover:text-violet-400 transition-colors">Settings</a>
            {' '}to appear here.
          </p>
        )}
      </div>
    </main>
  )
}

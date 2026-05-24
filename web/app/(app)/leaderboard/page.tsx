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
  const [error, setError] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const [{ data: { user } }, { data, error: rpcError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.rpc('get_weekly_leaderboard'),
      ])
      setCurrentUserId(user?.id ?? null)
      if (rpcError) { setError(true); setLoading(false); return }
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

        {loading && (
          <div className="animate-pulse space-y-2">
            {[0,1,2,3,4].map(i => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 bg-white/[0.03] border border-white/[0.06] rounded-2xl">
                <div className="w-7 h-5 bg-white/[0.06] rounded" />
                <div className="flex-1 flex flex-col gap-2">
                  <div className="h-3.5 w-32 bg-white/[0.07] rounded-full" />
                  <div className="h-3 w-20 bg-white/[0.05] rounded-full" />
                </div>
                <div className="h-6 w-8 bg-white/[0.07] rounded" />
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <p className="text-gray-600">Couldn't load the leaderboard.</p>
            <p className="text-gray-700 text-[13px]">Check your connection and try refreshing.</p>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
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
                  <span className="w-7 text-center shrink-0" aria-hidden>
                    {i < 3
                      ? <span className="text-[20px]">{medals[i]}</span>
                      : <span className="text-[14px] font-bold text-gray-600">{i + 1}</span>
                    }
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[14px] font-medium truncate ${isYou ? 'text-violet-300' : 'text-white/90'}`}>
                      {entry.display_name}
                      {isYou && <span className="text-[11px] text-violet-500/70 ml-2" aria-label="(you)">you</span>}
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

        {!loading && !error && (
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

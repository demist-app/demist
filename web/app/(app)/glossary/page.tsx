'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

interface Term {
  id: string
  term: string
  definition: string
  session_id: string | null
}

interface GlossarySession {
  id: string
  started_at: string
  number: number
  terms: Term[]
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Glossary() {
  const [sessions, setSessions] = useState<GlossarySession[]>([])
  const [orphanTerms, setOrphanTerms] = useState<Term[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      posthog.capture('glossary_viewed')

      const [
        { data: termsData },
        { data: sessionsData },
      ] = await Promise.all([
        supabase.from('terms').select('id, term, definition, session_id').eq('user_id', user.id).order('created_at', { ascending: true }),
        supabase.from('sessions').select('id, started_at').eq('user_id', user.id).order('started_at', { ascending: true }),
      ])

      const allTerms = (termsData ?? []) as Term[]
      const allSessions = sessionsData ?? []
      setTotalCount(allTerms.length)

      const sessionNumberMap = new Map(allSessions.map((s, i) => [s.id, i + 1]))
      const sessionIdSet = new Set(allSessions.map(s => s.id))

      const grouped = new Map<string, Term[]>()
      const orphans: Term[] = []

      for (const t of allTerms) {
        if (!t.session_id || !sessionIdSet.has(t.session_id)) {
          orphans.push(t)
        } else {
          if (!grouped.has(t.session_id)) grouped.set(t.session_id, [])
          grouped.get(t.session_id)!.push(t)
        }
      }

      const sessionList: GlossarySession[] = allSessions
        .filter(s => grouped.has(s.id))
        .map(s => ({
          id: s.id,
          started_at: s.started_at,
          number: sessionNumberMap.get(s.id) ?? 0,
          terms: grouped.get(s.id)!,
        }))
        .reverse()

      setSessions(sessionList)
      setOrphanTerms(orphans)
      setLoading(false)
    })()
  }, [])

  const q = search.toLowerCase()
  const filteredSessions = sessions
    .map(s => ({ ...s, terms: q ? s.terms.filter(t => t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q)) : s.terms }))
    .filter(s => s.terms.length > 0)
  const filteredOrphans = q ? orphanTerms.filter(t => t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q)) : orphanTerms

  return (
    <main className="min-h-dvh bg-[#080810] text-white flex flex-col nav-bottom-pad">
      <header className="sm:hidden shrink-0 flex items-center justify-between px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Glossary</span>
        {!loading && <span className="text-[13px] text-gray-600">{totalCount} terms</span>}
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {!loading && totalCount > 0 && (
          <div className="mb-4">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search terms..."
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-2xl px-4 py-3 text-[14px] text-white placeholder-gray-700 focus:outline-none focus:border-violet-500/40 transition-all"
            />
          </div>
        )}

        {loading && (
          <div className="animate-pulse space-y-6">
            {[0, 1, 2].map(i => (
              <div key={i}>
                <div className="h-3 w-36 bg-white/[0.06] rounded-full mb-3" />
                <div className="space-y-2">
                  {[0, 1, 2].map(j => (
                    <div key={j} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3">
                      <div className="h-3.5 w-28 bg-white/[0.08] rounded-full mb-2" />
                      <div className="h-3 w-4/5 bg-white/[0.05] rounded-full" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && totalCount === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
            <p className="text-gray-500 text-[15px] font-medium">No terms yet</p>
            <p className="text-gray-700 text-[13px]">Record a lecture to start building your glossary.</p>
          </div>
        )}

        {!loading && totalCount > 0 && filteredSessions.length === 0 && filteredOrphans.length === 0 && (
          <p className="text-center text-gray-600 text-[14px] py-10">No results for &ldquo;{search}&rdquo;</p>
        )}

        {!loading && (
          <div className="space-y-6">
            {filteredSessions.map(s => (
              <div key={s.id}>
                <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-2">
                  Session {s.number} · {fmtDate(s.started_at)}
                </p>
                <div className="space-y-2">
                  {s.terms.map(t => (
                    <div key={t.id} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3">
                      <p className="text-[14px] font-medium text-white/90">{t.term}</p>
                      <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">{t.definition}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {filteredOrphans.length > 0 && (
              <div>
                <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-2">Other</p>
                <div className="space-y-2">
                  {filteredOrphans.map(t => (
                    <div key={t.id} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3">
                      <p className="text-[14px] font-medium text-white/90">{t.term}</p>
                      <p className="text-[12px] text-gray-500 mt-1 leading-relaxed">{t.definition}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  )
}

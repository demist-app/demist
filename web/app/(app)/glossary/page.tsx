'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface Term {
  id: string
  term: string
  definition: string
  session_id: string | null
}

interface GlossarySession {
  id: string
  name: string | null
  started_at: string
  subject: string | null
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
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return
        posthog.capture('glossary_viewed')

        const [
          { data: termsData, error: termsErr },
          { data: sessionsData, error: sessionsErr },
        ] = await Promise.all([
          supabase.from('terms').select('id, term, definition, session_id').eq('user_id', user.id).order('created_at', { ascending: true }),
          supabase.from('sessions').select('id, name, started_at, subject').eq('user_id', user.id).order('started_at', { ascending: true }),
        ])

        if (termsErr) throw termsErr
        if (sessionsErr) throw sessionsErr

        const allTerms = (termsData ?? []) as Term[]
        const allSessions = (sessionsData ?? []) as { id: string; name: string | null; started_at: string; subject: string | null }[]
        setTotalCount(allTerms.length)

        const sessionIdSet = new Set(allSessions.map(s => s.id))
        const sessionMetaMap = new Map(allSessions.map(s => [s.id, s]))

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
            name: sessionMetaMap.get(s.id)?.name ?? null,
            started_at: s.started_at,
            subject: sessionMetaMap.get(s.id)?.subject ?? null,
            terms: grouped.get(s.id)!,
          }))
          .reverse()

        setSessions(sessionList)
        setOrphanTerms(orphans)
      } catch (e) {
        console.error('glossary load error:', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const q = search.toLowerCase()
  const filteredSessions = sessions
    .map(s => ({ ...s, terms: q ? s.terms.filter(t => t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q)) : s.terms }))
    .filter(s => s.terms.length > 0)
  const filteredOrphans = q
    ? orphanTerms.filter(t => t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q))
    : orphanTerms

  const hasResults = filteredSessions.length > 0 || filteredOrphans.length > 0

  return (
    <main className="min-h-dvh bg-[#08080E] text-white flex flex-col nav-bottom-pad">
      {/* Mobile top bar */}
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Glossary</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-2xl mx-auto animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>

          {/* Page header */}
          <div className="relative overflow-hidden px-4 sm:px-6 pt-8 pb-5">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-10 -left-10 w-[280px] h-[180px] rounded-full bg-amber-600/[0.08] blur-[60px]"
            />

            {loading ? (
              <div className="animate-pulse space-y-3">
                <div className="h-7 w-28 bg-white/[0.07] rounded-xl" />
                <div className="h-3.5 w-48 bg-white/[0.04] rounded-full" />
                <div className="flex gap-3 mt-4">
                  <div className="h-10 w-28 bg-white/[0.04] rounded-xl" />
                  <div className="h-10 w-28 bg-white/[0.04] rounded-xl" />
                </div>
                <div className="h-10 w-full bg-white/[0.04] rounded-xl mt-2" />
              </div>
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight text-white">Glossary</h1>
                <p className="text-[13px] text-white/40 mt-1">
                  {totalCount} term{totalCount !== 1 ? 's' : ''} across {sessions.length} session{sessions.length !== 1 ? 's' : ''}
                </p>

                {/* Stat chips */}
                {totalCount > 0 && (
                  <div className="flex gap-3 mt-4">
                    <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 shrink-0">
                        <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                      </svg>
                      <div>
                        <p className="text-[11px] text-white/35 leading-none mb-0.5">Total terms</p>
                        <p className="text-[15px] font-semibold text-white leading-none">{totalCount}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-2.5">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 shrink-0">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      <div>
                        <p className="text-[11px] text-white/35 leading-none mb-0.5">Sessions</p>
                        <p className="text-[15px] font-semibold text-white leading-none">{sessions.length}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Search bar */}
                {totalCount > 0 && (
                  <div className="relative mt-5">
                    <svg
                      className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
                      width="16" height="16" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <Input
                      type="text"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search terms..."
                      className="pl-10 rounded-xl"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Term list */}
          <div className="px-4 sm:px-6 pb-8">

            {/* Loading skeleton */}
            {loading && (
              <div className="animate-pulse space-y-7">
                {[4, 3, 5].map((count, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="h-4 w-28 bg-white/[0.05] rounded-full" />
                      <div className="h-3 w-16 bg-white/[0.04] rounded-full" />
                      <div className="h-5 w-10 bg-amber-500/10 rounded-md" />
                    </div>
                    <div className="space-y-2">
                      {Array.from({ length: count }).map((_, j) => (
                        <div key={j} className="bg-white/[0.04] border border-white/[0.07] rounded-xl px-4 py-3.5">
                          <div className="h-4 w-32 bg-white/[0.08] rounded-full mb-2" />
                          <div className="h-3 w-full bg-white/[0.05] rounded-full" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state — no terms at all */}
            {!loading && totalCount === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
                <div className="w-14 h-14 rounded-2xl bg-amber-600/[0.12] border border-amber-500/[0.20] flex items-center justify-center mb-1">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                </div>
                <p className="text-[15px] font-semibold text-white/70">No terms yet</p>
                <p className="text-[13px] text-white/35">Record a lecture to grow your glossary.</p>
              </div>
            )}

            {/* No search results */}
            {!loading && totalCount > 0 && !hasResults && (
              <p className="text-center text-white/35 text-[14px] py-12">
                No results for &ldquo;{search}&rdquo;
              </p>
            )}

            {/* Results */}
            {!loading && hasResults && (
              <div className="space-y-7">

                {filteredSessions.map(s => (
                  <div key={s.id}>
                    {/* Session header */}
                    <div className="flex items-center gap-2 mb-3">
                      <span className={cn(
                        'text-[13px] font-semibold shrink-0 truncate max-w-[180px]',
                        s.name ? 'text-white/70' : 'text-white/40'
                      )}>
                        {s.name || fmtDate(s.started_at)}
                      </span>
                      {s.name && (
                        <span className="text-[12px] text-white/30 shrink-0">{fmtDate(s.started_at)}</span>
                      )}
                      <Badge variant="default" className="shrink-0">
                        {s.terms.length} term{s.terms.length !== 1 ? 's' : ''}
                      </Badge>
                      {s.subject && (
                        <span className="text-[11px] text-white/35 bg-white/[0.04] border border-white/[0.06] rounded-full px-2 py-[2px] truncate max-w-[100px]">
                          {s.subject}
                        </span>
                      )}
                    </div>

                    {/* Term items */}
                    <div className="space-y-1.5">
                      {s.terms.map(t => (
                        <div
                          key={t.id}
                          className="bg-white/[0.04] border border-white/[0.07] rounded-xl px-4 py-3.5 hover:bg-white/[0.07] transition-colors duration-150"
                        >
                          <p className="text-[15px] font-bold text-white leading-snug">{t.term}</p>
                          <p className="text-[13px] text-white/50 mt-1 leading-relaxed">{t.definition}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Orphaned / ungrouped terms */}
                {filteredOrphans.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-[13px] font-semibold text-white/40 shrink-0">Ungrouped</span>
                      <Badge variant="default" className="shrink-0">
                        {filteredOrphans.length} term{filteredOrphans.length !== 1 ? 's' : ''}
                      </Badge>
                    </div>
                    <div className="space-y-1.5">
                      {filteredOrphans.map(t => (
                        <div
                          key={t.id}
                          className="bg-white/[0.04] border border-white/[0.07] rounded-xl px-4 py-3.5 hover:bg-white/[0.07] transition-colors duration-150"
                        >
                          <p className="text-[15px] font-bold text-white leading-snug">{t.term}</p>
                          <p className="text-[13px] text-white/50 mt-1 leading-relaxed">{t.definition}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}

          </div>
        </div>
      </div>
    </main>
  )
}

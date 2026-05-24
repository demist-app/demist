'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

interface SessionTerm {
  id: string
  term: string
  definition: string
  known: boolean
}

interface Session {
  id: string
  subject: string | null
  started_at: string
  ended_at: string | null
  termCount: number
  terms?: SessionTerm[]
  expanded: boolean
}

function fmtDuration(start: string, end: string | null): string {
  if (!end) return '—'
  const mins = Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function sessionLabel(subject: string | null, startedAt: string): string {
  if (subject) return subject
  const d = new Date(startedAt)
  return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const today = new Date(); today.setHours(0,0,0,0)
  const yesterday = new Date(today.getTime() - 86400000)
  const day = new Date(d); day.setHours(0,0,0,0)
  if (day.getTime() === today.getTime()) return 'Today'
  if (day.getTime() === yesterday.getTime()) return 'Yesterday'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export default function History() {
  const [loading, setLoading] = useState(true)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loadingTerms, setLoadingTerms] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: sessionsRaw } = await supabase
        .from('sessions')
        .select('id, subject, started_at, ended_at')
        .eq('user_id', user.id)
        .order('started_at', { ascending: false })
        .limit(100)

      if (!sessionsRaw?.length) { setLoading(false); return }

      const ids = sessionsRaw.map(s => s.id)
      const { data: termRows } = await supabase
        .from('terms')
        .select('session_id, id')
        .in('session_id', ids)

      const countMap: Record<string, number> = {}
      for (const r of termRows ?? []) countMap[r.session_id] = (countMap[r.session_id] ?? 0) + 1

      setSessions(sessionsRaw.map(s => ({
        ...s,
        termCount: countMap[s.id] ?? 0,
        expanded: false,
      })))
      setLoading(false)
    })()
  }, [])

  const toggleExpand = async (id: string) => {
    setSessions(prev => {
      const s = prev.find(x => x.id === id)
      if (!s) return prev
      // If already has terms loaded, just toggle
      if (s.terms !== undefined) {
        return prev.map(x => x.id === id ? { ...x, expanded: !x.expanded } : x)
      }
      return prev
    })

    // Check if already loaded
    const s = sessions.find(x => x.id === id)
    if (!s || s.terms !== undefined) return

    setLoadingTerms(id)
    const supabase = createClient()
    const { data } = await supabase
      .from('terms')
      .select('id, term, definition, known')
      .eq('session_id', id)
      .order('created_at', { ascending: true })

    setSessions(prev =>
      prev.map(x => x.id === id ? { ...x, terms: (data ?? []) as SessionTerm[], expanded: true } : x)
    )
    setLoadingTerms(null)
  }

  const toggleKnown = async (termId: string, currentlyKnown: boolean) => {
    const supabase = createClient()
    await supabase.from('terms').update({ known: !currentlyKnown }).eq('id', termId)
    setSessions(prev =>
      prev.map(s => ({
        ...s,
        terms: s.terms?.map(t => t.id === termId ? { ...t, known: !currentlyKnown } : t),
      }))
    )
  }

  // Group sessions by date label
  const grouped: { label: string; sessions: Session[] }[] = []
  for (const s of sessions) {
    const label = fmtDate(s.started_at)
    const last = grouped[grouped.length - 1]
    if (last && last.label === label) {
      last.sessions.push(s)
    } else {
      grouped.push({ label, sessions: [s] })
    }
  }

  return (
    <main
      className="min-h-dvh bg-[#080810] text-white flex flex-col nav-bottom-pad"
    >
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Session History</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading && <div className="py-12" />}

        {!loading && sessions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <p className="text-gray-600">No sessions yet.</p>
            <p className="text-gray-700 text-[13px]">Head to Home and start recording a lecture.</p>
          </div>
        )}

        {grouped.map(group => (
          <div key={group.label} className="mb-6">
            <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-3">
              {group.label}
            </p>
            <div className="space-y-2">
              {group.sessions.map(s => (
                <div
                  key={s.id}
                  className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden"
                >
                  <button
                    onClick={() => toggleExpand(s.id)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-medium text-white/90 truncate">
                        {sessionLabel(s.subject, s.started_at)}
                      </p>
                      <p className="text-[12px] text-gray-600 mt-0.5">
                        {fmtTime(s.started_at)} · {fmtDuration(s.started_at, s.ended_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      <div className="text-right">
                        <p className="text-[14px] font-semibold text-violet-400">{s.termCount}</p>
                        <p className="text-[11px] text-gray-600">terms</p>
                      </div>
                      <ChevronIcon expanded={s.expanded} />
                    </div>
                  </button>

                  {s.expanded && (
                    <div className="px-4 pb-4 border-t border-white/[0.04]">
                      {loadingTerms === s.id && (
                        <p className="text-gray-700 text-[13px] py-3">Loading…</p>
                      )}
                      {s.terms && s.terms.length === 0 && (
                        <p className="text-gray-700 text-[13px] py-3">No terms detected.</p>
                      )}
                      {s.terms && s.terms.length > 0 && (
                        <div className="space-y-3 pt-3">
                          {s.terms.map(t => (
                            <div key={t.id} className="flex items-start gap-3">
                              <div className="w-[3px] h-[3px] rounded-full bg-violet-500/60 mt-[9px] shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[13px] font-medium ${t.known ? 'text-gray-500 line-through' : 'text-white/90'}`}>
                                    {t.term}
                                  </span>
                                  {t.known && (
                                    <span className="text-[10px] text-emerald-500/70 font-medium shrink-0">known</span>
                                  )}
                                </div>
                                <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{t.definition}</p>
                              </div>
                              <button
                                onClick={() => toggleKnown(t.id, t.known)}
                                title={t.known ? 'Mark as not known' : 'Mark as known'}
                                className={`shrink-0 mt-0.5 text-[18px] leading-none transition-colors ${
                                  t.known ? 'text-emerald-500 hover:text-gray-600' : 'text-gray-700 hover:text-emerald-500'
                                }`}
                              >
                                ✓
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={`text-gray-600 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

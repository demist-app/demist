'use client'

import { useEffect, useRef, useState } from 'react'
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
  synopsis: string | null
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

function sessionLabel(n: number, startedAt: string): string {
  const d = new Date(startedAt)
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `Session ${n} · ${date}`
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
  const [totalCount, setTotalCount] = useState(0)
  const [loadingTerms, setLoadingTerms] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set())
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set())
  const summarizingRef = useRef(new Set<string>())

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const [{ data: sessionsRaw }, { count }] = await Promise.all([
        supabase
          .from('sessions')
          .select('id, subject, synopsis, started_at, ended_at')
          .eq('user_id', user.id)
          .order('started_at', { ascending: false })
          .limit(100),
        supabase
          .from('sessions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id),
      ])

      if (!sessionsRaw?.length) { setLoading(false); return }

      setTotalCount(count ?? sessionsRaw.length)

      const ids = sessionsRaw.map(s => s.id)
      const { data: termRows } = await supabase
        .from('terms')
        .select('session_id, id')
        .in('session_id', ids)

      const countMap: Record<string, number> = {}
      for (const r of termRows ?? []) countMap[r.session_id] = (countMap[r.session_id] ?? 0) + 1

      setSessions(sessionsRaw.map(s => ({
        ...s,
        synopsis: s.synopsis ?? null,
        termCount: countMap[s.id] ?? 0,
        expanded: false,
      })))
      setLoading(false)
    })()
  }, [])

  const maybeSummarize = async (s: Session) => {
    if (s.synopsis || s.termCount === 0) return
    if (summarizingRef.current.has(s.id)) return
    summarizingRef.current.add(s.id)
    setGeneratingIds(prev => new Set(prev).add(s.id))
    setFailedIds(prev => { const next = new Set(prev); next.delete(s.id); return next })
    let succeeded = false
    try {
      const supabase = createClient()
      const { data, error } = await supabase.functions.invoke('summarize-session', {
        body: { session_id: s.id, subject: s.subject },
      })
      if (error) {
        console.error('summarize-session error:', error)
      } else if (data?.ok && data?.synopsis) {
        setSessions(prev => prev.map(x => x.id === s.id ? { ...x, synopsis: data.synopsis } : x))
        succeeded = true
      } else {
        console.error('summarize-session: unexpected response', data)
      }
    } catch (e) {
      console.error('summarize-session: network error', e)
    } finally {
      summarizingRef.current.delete(s.id)
      setGeneratingIds(prev => { const next = new Set(prev); next.delete(s.id); return next })
      if (!succeeded) setFailedIds(prev => new Set(prev).add(s.id))
    }
  }

  const retrySummarize = (s: Session) => {
    summarizingRef.current.delete(s.id)
    setFailedIds(prev => { const next = new Set(prev); next.delete(s.id); return next })
    maybeSummarize(s)
  }

  const toggleExpand = async (id: string) => {
    const target = sessions.find(x => x.id === id)
    if (target && !target.expanded) maybeSummarize(target)

    setSessions(prev => {
      const s = prev.find(x => x.id === id)
      if (!s) return prev
      if (s.terms !== undefined) {
        return prev.map(x => x.id === id ? { ...x, expanded: !x.expanded } : x)
      }
      return prev
    })

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

  const deleteSession = async (id: string) => {
    setDeletingId(id)
    setConfirmingId(null)
    const supabase = createClient()
    await supabase.from('terms').delete().eq('session_id', id)
    await supabase.from('sessions').delete().eq('id', id)
    setSessions(prev => prev.filter(s => s.id !== id))
    setDeletingId(null)
  }

  const sessionNumber = (i: number) => totalCount - i

  const grouped: { label: string; sessions: { s: Session; n: number }[] }[] = []
  sessions.forEach((s, i) => {
    const label = fmtDate(s.started_at)
    const last = grouped[grouped.length - 1]
    if (last && last.label === label) {
      last.sessions.push({ s, n: sessionNumber(i) })
    } else {
      grouped.push({ label, sessions: [{ s, n: sessionNumber(i) }] })
    }
  })

  return (
    <main className="min-h-dvh bg-[#080810] text-white flex flex-col nav-bottom-pad">
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Session History</span>
      </header>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading && (
          <div className="animate-pulse space-y-6">
            {[0,1].map(g => (
              <div key={g}>
                <div className="h-2 w-16 bg-white/[0.05] rounded-full mb-3" />
                <div className="space-y-2">
                  {[0,1,2].map(i => (
                    <div key={i} className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3">
                      <div className="flex-1 flex flex-col gap-2">
                        <div className="h-3.5 w-40 bg-white/[0.07] rounded-full" />
                        <div className="h-3 w-24 bg-white/[0.05] rounded-full" />
                      </div>
                      <div className="flex flex-col items-end gap-1.5 mr-8">
                        <div className="h-4 w-6 bg-white/[0.07] rounded" />
                        <div className="h-2.5 w-8 bg-white/[0.05] rounded-full" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

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
              {group.sessions.map(({ s, n }) => (
                <div
                  key={s.id}
                  className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden"
                >
                  <div className="flex items-center px-4 py-3 gap-3">
                    <div
                      onClick={() => { setConfirmingId(null); toggleExpand(s.id) }}
                      className="flex-1 min-w-0 cursor-pointer"
                    >
                      <p className="text-[14px] font-medium text-white/90 truncate">
                        {sessionLabel(n, s.started_at)}
                      </p>
                      <p className="text-[12px] text-gray-600 mt-0.5">
                        {fmtTime(s.started_at)} · {fmtDuration(s.started_at, s.ended_at)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right mr-1">
                        <p className="text-[14px] font-semibold text-violet-400">{s.termCount}</p>
                        <p className="text-[11px] text-gray-600">terms</p>
                      </div>

                      {confirmingId === s.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => setConfirmingId(null)}
                            className="text-[12px] text-gray-500 hover:text-gray-300 transition-colors px-2 py-1"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => deleteSession(s.id)}
                            disabled={deletingId === s.id}
                            className="text-[12px] font-medium text-red-400 hover:text-red-300 transition-colors px-2 py-1 disabled:opacity-40"
                          >
                            {deletingId === s.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmingId(s.id)}
                          title="Delete session"
                          className="text-gray-700 hover:text-red-400 transition-colors p-1"
                        >
                          <TrashIcon />
                        </button>
                      )}

                      <button onClick={() => { setConfirmingId(null); toggleExpand(s.id) }}>
                        <ChevronIcon expanded={s.expanded} />
                      </button>
                    </div>
                  </div>

                  {s.expanded && (
                    <div className="px-4 pb-4 border-t border-white/[0.04]">
                      {s.synopsis ? (
                        <p className="text-[13px] text-gray-500 leading-relaxed pt-3 pb-1">{s.synopsis}</p>
                      ) : generatingIds.has(s.id) ? (
                        <p className="text-[12px] text-gray-700 pt-3 pb-1">Generating summary…</p>
                      ) : failedIds.has(s.id) ? (
                        <div className="flex items-center gap-3 pt-3 pb-1">
                          <p className="text-[12px] text-gray-700">Couldn't generate summary.</p>
                          <button
                            onClick={() => retrySummarize(s)}
                            className="text-[12px] text-violet-500 hover:text-violet-400 transition-colors shrink-0"
                          >
                            Retry
                          </button>
                        </div>
                      ) : null}

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

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

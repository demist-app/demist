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
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
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
    try {
      const supabase = createClient()
      const { data: { session: authSession } } = await supabase.auth.getSession()
      const token = authSession?.access_token
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/summarize-session`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: s.id, subject: s.subject }),
        }
      )
      if (res.ok) {
        const { ok, synopsis } = await res.json()
        if (ok && synopsis) {
          setSessions(prev => prev.map(x => x.id === s.id ? { ...x, synopsis } : x))
        }
      }
    } catch (e) {
      console.error('maybeSummarize error:', e)
    } finally {
      summarizingRef.current.delete(s.id)
    }
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

  const startRename = (s: Session, n: number) => {
    setEditingId(s.id)
    setEditValue(sessionLabel(n, s.started_at))
  }

  const saveRename = async (id: string) => {
    const name = editValue.trim()
    setEditingId(null)
    if (!name) return
    // Store custom names in synopsis field prefix or just update display
    // For now, we persist a custom label by keeping it in ai_name
    const supabase = createClient()
    await supabase.from('sessions').update({ synopsis: name }).eq('id', id)
    setSessions(prev => prev.map(s => s.id === id ? { ...s, synopsis: name } : s))
  }

  const deleteSession = async (id: string) => {
    if (!window.confirm('Delete this session and all its terms?')) return
    setDeletingId(id)
    const supabase = createClient()
    await supabase.from('terms').delete().eq('session_id', id)
    await supabase.from('sessions').delete().eq('id', id)
    setSessions(prev => prev.filter(s => s.id !== id))
    setDeletingId(null)
  }

  // sessions[0] = newest = totalCount, sessions[i] = totalCount - i
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
              {group.sessions.map(({ s, n }) => (
                <div
                  key={s.id}
                  className="bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden"
                >
                  <div className="flex items-center px-4 py-3 gap-3">
                    <div
                      onClick={() => !editingId && toggleExpand(s.id)}
                      className="flex-1 min-w-0 cursor-pointer"
                    >
                      {editingId === s.id ? (
                        <input
                          autoFocus
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') saveRename(s.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          onBlur={() => saveRename(s.id)}
                          onClick={e => e.stopPropagation()}
                          className="w-full bg-white/[0.07] border border-violet-500/40 rounded-lg px-2 py-1 text-[14px] text-white focus:outline-none"
                        />
                      ) : (
                        <>
                          <p className="text-[14px] font-medium text-white/90 truncate">
                            {sessionLabel(n, s.started_at)}
                          </p>
                          <p className="text-[12px] text-gray-600 mt-0.5">
                            {fmtTime(s.started_at)} · {fmtDuration(s.started_at, s.ended_at)}
                          </p>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right mr-1">
                        <p className="text-[14px] font-semibold text-violet-400">{s.termCount}</p>
                        <p className="text-[11px] text-gray-600">terms</p>
                      </div>
                      <button
                        onClick={() => startRename(s, n)}
                        title="Rename"
                        className="text-gray-700 hover:text-gray-300 transition-colors p-1"
                      >
                        <PencilIcon />
                      </button>
                      <button
                        onClick={() => deleteSession(s.id)}
                        title="Delete"
                        disabled={deletingId === s.id}
                        className="text-gray-700 hover:text-red-400 transition-colors p-1 disabled:opacity-40"
                      >
                        <TrashIcon />
                      </button>
                      <button onClick={() => toggleExpand(s.id)}>
                        <ChevronIcon expanded={s.expanded} />
                      </button>
                    </div>
                  </div>

                  {s.expanded && (
                    <div className="px-4 pb-4 border-t border-white/[0.04]">
                      {s.synopsis ? (
                        <p className="text-[13px] text-gray-500 leading-relaxed pt-3 pb-1">{s.synopsis}</p>
                      ) : s.termCount > 0 ? (
                        <p className="text-[12px] text-gray-700 pt-3 pb-1">Generating summary…</p>
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

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
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

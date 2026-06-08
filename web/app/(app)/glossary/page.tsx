'use client'

import { useEffect, useRef, useState } from 'react'
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
  name: string | null
  started_at: string
  subject: string | null
  terms: Term[]
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

export default function Glossary() {
  const [sessions, setSessions] = useState<GlossarySession[]>([])
  const [orphanTerms, setOrphanTerms] = useState<Term[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'session' | 'subject'>('session')

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)

  // Delete state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const editRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus()
      editRef.current.setSelectionRange(editRef.current.value.length, editRef.current.value.length)
    }
  }, [editingId])

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
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

  const startEdit = (t: Term) => {
    setEditingId(t.id)
    setEditValue(t.definition)
    setConfirmDeleteId(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditValue('')
  }

  const saveEdit = async (termId: string) => {
    const trimmed = editValue.trim()
    if (!trimmed) { cancelEdit(); return }
    setSavingId(termId)
    try {
      const supabase = createClient()
      await supabase.from('terms').update({ definition: trimmed }).eq('id', termId)
      const update = (t: Term) => t.id === termId ? { ...t, definition: trimmed } : t
      setSessions(prev => prev.map(s => ({ ...s, terms: s.terms.map(update) })))
      setOrphanTerms(prev => prev.map(update))
      setEditingId(null)
    } catch (e) {
      console.error('save edit error:', e)
    } finally {
      setSavingId(null)
    }
  }

  const deleteTerm = async (termId: string) => {
    setDeletingId(termId)
    try {
      const supabase = createClient()
      await supabase.from('terms').delete().eq('id', termId)
      setSessions(prev =>
        prev
          .map(s => ({ ...s, terms: s.terms.filter(t => t.id !== termId) }))
          .filter(s => s.terms.length > 0)
      )
      setOrphanTerms(prev => prev.filter(t => t.id !== termId))
      setTotalCount(c => c - 1)
      setConfirmDeleteId(null)
    } catch (e) {
      console.error('delete term error:', e)
    } finally {
      setDeletingId(null)
    }
  }

  const q = search.toLowerCase()
  const filteredSessions = sessions
    .map(s => ({ ...s, terms: q ? s.terms.filter(t => t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q)) : s.terms }))
    .filter(s => s.terms.length > 0)
  const filteredOrphans = q
    ? orphanTerms.filter(t => t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q))
    : orphanTerms

  const hasResults = filteredSessions.length > 0 || filteredOrphans.length > 0

  // Build subject groups
  const subjectGroups = (() => {
    if (groupBy !== 'subject') return null
    const map = new Map<string, { terms: Term[]; sessions: string[] }>()
    for (const s of filteredSessions) {
      const key = s.subject ?? 'Uncategorised'
      if (!map.has(key)) map.set(key, { terms: [], sessions: [] })
      map.get(key)!.terms.push(...s.terms)
      map.get(key)!.sessions.push(s.name ?? fmtDate(s.started_at))
    }
    if (filteredOrphans.length > 0) {
      const key = 'Uncategorised'
      if (!map.has(key)) map.set(key, { terms: [], sessions: [] })
      map.get(key)!.terms.push(...filteredOrphans)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  })()

  const renderTermRow = (t: Term, i: number) => (
    <div
      key={t.id}
      className={`px-4 py-3.5 transition-colors duration-150 ${i > 0 ? 'border-t dark:border-white/[0.04] border-black/[0.05]' : ''} ${editingId === t.id ? 'dark:bg-white/[0.03] bg-[#F3F1EC]' : 'hover:bg-yellow-500/[0.03]'}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold dark:text-white/90 text-gray-900 leading-snug">{t.term}</p>
          {editingId === t.id ? (
            <div className="mt-2">
              <textarea
                ref={editRef}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(t.id) }
                  if (e.key === 'Escape') cancelEdit()
                }}
                rows={3}
                className="w-full text-[13px] dark:text-white/80 text-gray-700 dark:bg-white/[0.05] bg-[#EFEDE7] border dark:border-amber-500/30 border-amber-500/40 rounded-xl px-3 py-2 resize-none focus:outline-none leading-relaxed"
              />
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  onClick={() => saveEdit(t.id)}
                  disabled={savingId === t.id}
                  className="text-[12px] font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-40 transition-colors"
                >
                  {savingId === t.id ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={cancelEdit}
                  className="text-[12px] text-gray-600 hover:text-gray-500 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-gray-700 mt-1 leading-relaxed">{t.definition}</p>
          )}
        </div>

        {editingId !== t.id && (
          <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
            <button
              onClick={() => startEdit(t)}
              title="Edit definition"
              className="p-1.5 text-gray-700 hover:dark:text-yellow-400 hover:text-yellow-700 transition-colors rounded-lg hover:dark:bg-white/[0.06] hover:bg-black/[0.05]"
            >
              <PencilIcon />
            </button>
            {confirmDeleteId === t.id ? (
              <div className="flex items-center gap-1 ml-1">
                <button
                  onClick={() => setConfirmDeleteId(null)}
                  className="text-[11px] text-gray-600 hover:text-gray-500 transition-colors px-1.5 py-1"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteTerm(t.id)}
                  disabled={deletingId === t.id}
                  className="text-[11px] font-semibold text-red-400 hover:text-red-300 transition-colors px-1.5 py-1 disabled:opacity-40"
                >
                  {deletingId === t.id ? '…' : 'Delete'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteId(t.id)}
                title="Delete term"
                className="p-1.5 text-gray-700 hover:text-red-400 transition-colors rounded-lg hover:dark:bg-white/[0.06] hover:bg-black/[0.05]"
              >
                <TrashIcon />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )

  // Whether to show subject toggle (only useful if sessions span >1 subject)
  const subjects = new Set(sessions.map(s => s.subject ?? 'Uncategorised'))
  const showGroupToggle = !loading && totalCount > 0 && subjects.size > 1

  return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col nav-bottom-pad">
      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-yellow-700/[0.05] blur-[120px]" />
      </div>

      <header className="sm:hidden relative z-10 shrink-0 flex items-center px-6 h-14 border-b dark:border-white/[0.05] border-black/[0.06]">
        <span className="font-semibold tracking-tight text-[15px]">Glossary</span>
      </header>

      <div className="flex-1 overflow-y-auto relative z-10">
      <div className="w-full max-w-2xl mx-auto animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
      {/* Hero */}
      <div className="px-4 sm:px-6 pt-6 pb-5">
        {loading ? (
          <div className="animate-pulse">
            <div className="h-10 w-24 dark:bg-white/[0.07] bg-[#EFEDE7] rounded-xl mb-2" />
            <div className="h-3.5 w-48 dark:bg-white/[0.04] bg-[#FAF9F6] rounded-full" />
          </div>
        ) : (
          <>
            <p className="text-[44px] font-bold leading-none tracking-tight">{totalCount}</p>
            <p className="text-[13px] text-gray-700 mt-1.5">
              words across{' '}
              <span className="text-gray-600">{sessions.length} session{sessions.length !== 1 ? 's' : ''}</span>
            </p>
          </>
        )}

        {/* Search + group toggle */}
        {!loading && totalCount > 0 && (
          <div className="flex items-center gap-2 mt-5">
            <div className="relative flex-1">
              <svg
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none"
                width="15" height="15" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search words..."
                className="w-full pl-10 pr-4 py-3 dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] rounded-2xl text-[14px] dark:text-white text-gray-900 placeholder-gray-700 focus:outline-none focus:border-yellow-500/40 focus:dark:bg-white/[0.07] bg-[#EFEDE7] transition-all"
              />
            </div>
            {showGroupToggle && (
              <div className="flex items-center dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] rounded-2xl p-1 shrink-0">
                <button
                  onClick={() => setGroupBy('session')}
                  className={`text-[12px] font-medium px-3 py-1.5 rounded-xl transition-all ${groupBy === 'session' ? 'dark:bg-white/[0.10] bg-white shadow-sm dark:text-white text-gray-900' : 'text-gray-600 hover:text-gray-500'}`}
                >
                  Session
                </button>
                <button
                  onClick={() => setGroupBy('subject')}
                  className={`text-[12px] font-medium px-3 py-1.5 rounded-xl transition-all ${groupBy === 'subject' ? 'dark:bg-white/[0.10] bg-white shadow-sm dark:text-white text-gray-900' : 'text-gray-600 hover:text-gray-500'}`}
                >
                  Subject
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* List */}
      <div className="px-4 sm:px-6 pb-6">
        {loading && (
          <div className="animate-pulse space-y-7">
            {[4, 3, 5].map((count, i) => (
              <div key={i}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="h-5 w-8 bg-yellow-500/10 rounded-full" />
                  <div className="h-3 w-28 dark:bg-white/[0.05] bg-[#F6F5F2] rounded-full" />
                  <div className="flex-1 h-px dark:bg-white/[0.04] bg-[#FAF9F6]" />
                  <div className="h-3 w-12 dark:bg-white/[0.04] bg-[#FAF9F6] rounded-full" />
                </div>
                <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl overflow-hidden">
                  {Array.from({ length: count }).map((_, j) => (
                    <div key={j} className={`px-4 py-4 flex gap-3 ${j > 0 ? 'border-t dark:border-white/[0.04] border-black/[0.05]' : ''}`}>
                      <div className="w-[3px] shrink-0 rounded-full dark:bg-white/[0.06] bg-[#F3F1EC] self-stretch" />
                      <div className="flex-1">
                        <div className="h-4 w-32 dark:bg-white/[0.08] bg-[#EFEDE7] rounded-full mb-2" />
                        <div className="h-3 w-full dark:bg-white/[0.05] bg-[#F6F5F2] rounded-full" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && totalCount === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center gap-2">
            <div className="w-12 h-12 rounded-2xl dark:bg-white/[0.04] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.16] flex items-center justify-center mb-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <p className="text-[15px] font-medium text-gray-600">No words yet</p>
            <p className="text-[13px] text-gray-700">Record a lecture to grow your glossary.</p>
          </div>
        )}

        {!loading && totalCount > 0 && !hasResults && (
          <p className="text-center text-gray-600 text-[14px] py-12">No results for &ldquo;{search}&rdquo;</p>
        )}

        {!loading && hasResults && groupBy === 'session' && (
          <div className="space-y-7">
            {filteredSessions.map(s => (
              <div key={s.id}>
                <div className="flex items-center gap-2.5 mb-3">
                  <span className={`text-[13px] font-semibold shrink-0 truncate max-w-[180px] ${s.name ? 'dark:text-white/80 text-gray-800' : 'text-gray-700'}`}>
                    {s.name || fmtDate(s.started_at)}
                  </span>
                  {s.name && (
                    <span className="text-[12px] text-gray-600 shrink-0">{fmtDate(s.started_at)}</span>
                  )}
                  {s.subject && (
                    <span className="text-[11px] text-gray-700 dark:bg-white/[0.04] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-full px-2 py-[2px] truncate max-w-[100px]">
                      {s.subject}
                    </span>
                  )}
                  <div className="flex-1 h-px dark:bg-white/[0.05] bg-[#F6F5F2]" />
                  <span className="text-[11px] text-gray-700 shrink-0 tabular-nums">
                    {s.terms.length} word{s.terms.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl overflow-hidden">
                  {s.terms.map((t, i) => renderTermRow(t, i))}
                </div>
              </div>
            ))}

            {filteredOrphans.length > 0 && (
              <div>
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em]">Other</span>
                  <div className="flex-1 h-px dark:bg-white/[0.05] bg-[#F6F5F2]" />
                </div>
                <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl overflow-hidden">
                  {filteredOrphans.map((t, i) => renderTermRow(t, i))}
                </div>
              </div>
            )}
          </div>
        )}

        {!loading && hasResults && groupBy === 'subject' && subjectGroups && (
          <div className="space-y-7">
            {subjectGroups.map(([subject, { terms }]) => (
              <div key={subject}>
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="text-[13px] font-semibold dark:text-white/80 text-gray-800 shrink-0 truncate max-w-[200px]">{subject}</span>
                  <div className="flex-1 h-px dark:bg-white/[0.05] bg-[#F6F5F2]" />
                  <span className="text-[11px] text-gray-700 shrink-0 tabular-nums">{terms.length} word{terms.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl overflow-hidden">
                  {terms.map((t, i) => renderTermRow(t, i))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
      </div>
    </main>
  )
}

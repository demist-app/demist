'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import dynamic from 'next/dynamic'
import { capture } from '@/lib/analytics'

const SummaryViewer = dynamic(() => import('../summary-viewer').then(m => ({ default: m.SummaryViewer })), { ssr: false })
const TranscriptViewer = dynamic(() => import('../transcript-viewer').then(m => ({ default: m.TranscriptViewer })), { ssr: false })

interface SessionTerm {
  id: string
  term: string
  definition: string
  known: boolean
}

interface Session {
  id: string
  name: string | null
  subject: string | null
  synopsis: string | null
  transcript: string | null
  started_at: string
  ended_at: string | null
  termCount: number
  preview: string[]
  terms?: SessionTerm[]
  expanded: boolean
}

function fmtDuration(start: string, end: string | null): string {
  if (!end) return ''
  const mins = Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (mins < 1) return '<1m'
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
  const [editingNameId, setEditingNameId] = useState<string | null>(null)
  const [nameInput, setNameInput] = useState('')

  // Bulk select state
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  const summarizingRef = useRef(new Set<string>())

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return

      const [{ data: sessionsRaw }, { count }] = await Promise.all([
        supabase
          .from('sessions')
          .select('id, name, subject, synopsis, transcript, started_at, ended_at')
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
        .select('session_id, term')
        .in('session_id', ids)
        .order('created_at', { ascending: true })

      const countMap: Record<string, number> = {}
      const previewMap: Record<string, string[]> = {}
      for (const r of termRows ?? []) {
        countMap[r.session_id] = (countMap[r.session_id] ?? 0) + 1
        if ((previewMap[r.session_id] ??= []).length < 3) previewMap[r.session_id].push(r.term)
      }

      const built = sessionsRaw.map(s => ({
        ...s,
        name: (s as { name?: string | null }).name ?? null,
        synopsis: s.synopsis ?? null,
        transcript: (s as { transcript?: string | null }).transcript ?? null,
        termCount: countMap[s.id] ?? 0,
        preview: previewMap[s.id] ?? [],
        expanded: false,
        terms: undefined as SessionTerm[] | undefined,
      }))

      const targetId = new URLSearchParams(window.location.search).get('session')
      if (targetId && built.find(s => s.id === targetId)) {
        const { data: termsData } = await supabase
          .from('terms')
          .select('id, term, definition, known')
          .eq('session_id', targetId)
          .order('created_at', { ascending: true })
        const idx = built.findIndex(s => s.id === targetId)
        if (idx !== -1) {
          built[idx] = { ...built[idx], terms: (termsData ?? []) as SessionTerm[], expanded: true }
        }
        setTimeout(() => {
          document.getElementById(`session-${targetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 150)
      }

      setSessions(built)
      setLoading(false)
    })()
  }, [])

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
    setConfirmBulkDelete(false)
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
    setConfirmBulkDelete(false)
  }

  const selectAll = () => {
    setSelectedIds(new Set(sessions.map(s => s.id)))
    setConfirmBulkDelete(false)
  }

  const deselectAll = () => {
    setSelectedIds(new Set())
    setConfirmBulkDelete(false)
  }

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    try {
      const supabase = createClient()
      const ids = [...selectedIds]
      await supabase.from('terms').delete().in('session_id', ids)
      await supabase.from('sessions').delete().in('id', ids)
      setSessions(prev => prev.filter(s => !selectedIds.has(s.id)))
      setTotalCount(prev => prev - ids.length)
      exitSelectMode()
    } catch (e) {
      console.error('bulkDelete error:', e)
      alert('Failed to delete sessions. Please try again.')
    } finally {
      setBulkDeleting(false)
    }
  }

  const maybeSummarize = async (s: Session) => {
    if (s.synopsis || s.termCount === 0) return
    if (summarizingRef.current.has(s.id)) return
    summarizingRef.current.add(s.id)
    setGeneratingIds(prev => new Set(prev).add(s.id))
    setFailedIds(prev => { const next = new Set(prev); next.delete(s.id); return next })
    let succeeded = false
    let skipFailed = false
    try {
      const supabase = createClient()
      const { data: termRows } = await supabase
        .from('terms')
        .select('term, definition')
        .eq('session_id', s.id)
        .limit(60)
      if (!termRows?.length) { skipFailed = true; return }
      const { data, error } = await supabase.functions.invoke('summarize-session', {
        body: { session_id: s.id, subject: s.subject, terms: termRows },
      })
      if (!error && data?.ok && data?.synopsis) {
        setSessions(prev => prev.map(x => x.id === s.id ? { ...x, synopsis: data.synopsis } : x))
        succeeded = true
      }
    } catch (e) {
      console.error('summarize-session error:', e)
    } finally {
      summarizingRef.current.delete(s.id)
      setGeneratingIds(prev => { const next = new Set(prev); next.delete(s.id); return next })
      if (!succeeded && !skipFailed) setFailedIds(prev => new Set(prev).add(s.id))
    }
  }

  const retrySummarize = (s: Session) => {
    summarizingRef.current.delete(s.id)
    setFailedIds(prev => { const next = new Set(prev); next.delete(s.id); return next })
    maybeSummarize(s)
  }

  const toggleExpand = async (id: string) => {
    if (selectMode) { toggleSelect(id); return }
    const target = sessions.find(x => x.id === id)
    if (target && !target.expanded) {
      maybeSummarize(target)
      capture('history_session_expanded', { term_count: target.termCount })
    }

    setSessions(prev => {
      const s = prev.find(x => x.id === id)
      if (!s) return prev
      if (s.terms !== undefined) return prev.map(x => x.id === id ? { ...x, expanded: !x.expanded } : x)
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
    setSessions(prev =>
      prev.map(s => ({
        ...s,
        terms: s.terms?.map(t => t.id === termId ? { ...t, known: !currentlyKnown } : t),
      }))
    )
    const { error } = await createClient().from('terms').update({ known: !currentlyKnown }).eq('id', termId)
    if (error) {
      setSessions(prev =>
        prev.map(s => ({
          ...s,
          terms: s.terms?.map(t => t.id === termId ? { ...t, known: currentlyKnown } : t),
        }))
      )
    }
  }

  const deleteSession = async (id: string) => {
    setDeletingId(id)
    setConfirmingId(null)
    try {
      const supabase = createClient()
      await supabase.from('terms').delete().eq('session_id', id)
      await supabase.from('sessions').delete().eq('id', id)
      setSessions(prev => prev.filter(s => s.id !== id))
      setTotalCount(prev => prev - 1)
    } catch (e) {
      console.error('deleteSession error:', e)
      alert('Failed to delete session. Please try again.')
    } finally {
      setDeletingId(null)
    }
  }

  const startRename = (s: Session) => {
    setEditingNameId(s.id)
    setNameInput(s.name ?? '')
    setConfirmingId(null)
  }

  const saveSessionName = async (id: string) => {
    const name = nameInput.trim().slice(0, 80) || null
    const prev_name = sessions.find(s => s.id === id)?.name ?? null
    setEditingNameId(null)
    setSessions(prev => prev.map(s => s.id === id ? { ...s, name } : s))
    const { error } = await createClient().from('sessions').update({ name }).eq('id', id)
    if (error) {
      setSessions(prev => prev.map(s => s.id === id ? { ...s, name: prev_name } : s))
    }
  }

  const sessionNumber = (i: number) => totalCount - i

  const grouped: { label: string; sessions: { s: Session; n: number }[] }[] = []
  sessions.forEach((s, i) => {
    const label = fmtDate(s.started_at)
    const last = grouped[grouped.length - 1]
    if (last && last.label === label) last.sessions.push({ s, n: sessionNumber(i) })
    else grouped.push({ label, sessions: [{ s, n: sessionNumber(i) }] })
  })

  const allSelected = sessions.length > 0 && selectedIds.size === sessions.length

  return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col nav-bottom-pad">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-yellow-700/[0.05] blur-[120px]" />
      </div>

      <header className="relative z-10 shrink-0 flex items-center justify-between px-4 sm:px-6 h-14 border-b dark:border-white/[0.05] border-black/[0.06]">
        <span className="font-semibold tracking-tight text-[15px]">
          {selectMode
            ? selectedIds.size > 0
              ? `${selectedIds.size} selected`
              : 'Select sessions'
            : 'Session History'}
        </span>
        <div className="flex items-center gap-2">
          {selectMode ? (
            <>
              <button
                onClick={allSelected ? deselectAll : selectAll}
                className="text-[13px] text-yellow-600 dark:text-yellow-400 hover:opacity-80 transition-opacity px-2 py-1"
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
              <button
                onClick={exitSelectMode}
                className="text-[13px] text-gray-600 hover:text-gray-500 transition-colors px-2 py-1"
              >
                Cancel
              </button>
            </>
          ) : (
            !loading && sessions.length > 0 && (
              <button
                onClick={() => setSelectMode(true)}
                className="text-[13px] text-gray-600 hover:dark:text-white/70 hover:text-gray-900 transition-colors px-2 py-1"
              >
                Select
              </button>
            )
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-4 animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
          {loading && (
            <div className="animate-pulse space-y-6">
              {[0,1].map(g => (
                <div key={g}>
                  <div className="h-2 w-16 dark:bg-white/[0.05] bg-[#F6F5F2] rounded-full mb-3" />
                  <div className="space-y-2">
                    {[0,1,2].map(i => (
                      <div key={i} className="flex items-center gap-3 dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-4 py-3">
                        <div className="flex-1 flex flex-col gap-2">
                          <div className="h-3.5 w-40 dark:bg-white/[0.07] bg-[#EFEDE7] rounded-full" />
                          <div className="h-3 w-24 dark:bg-white/[0.05] bg-[#F6F5F2] rounded-full" />
                        </div>
                        <div className="flex flex-col items-end gap-1.5 mr-8">
                          <div className="h-4 w-6 dark:bg-white/[0.07] bg-[#EFEDE7] rounded" />
                          <div className="h-2.5 w-8 dark:bg-white/[0.05] bg-[#F6F5F2] rounded-full" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && sessions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <p className="text-gray-600 text-[14px] font-medium">No sessions yet</p>
              <p className="text-gray-700 text-[13px]">Record or import a lecture to get started.</p>
              <div className="flex items-center gap-2 mt-2">
                <a href="/dashboard" className="px-4 py-2 rounded-xl bg-yellow-600 hover:brightness-110 text-white text-[13px] font-semibold transition-all active:scale-[0.97]">Start recording</a>
                <a href="/import" className="px-4 py-2 rounded-xl dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] text-[13px] font-medium dark:text-gray-300 text-gray-700 hover:dark:bg-white/[0.08] transition-all active:scale-[0.97]">Import a file</a>
              </div>
            </div>
          )}

          {grouped.map(group => (
            <div key={group.label} className="mb-6">
              <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-3">
                {group.label}
              </p>
              <div className="space-y-2">
                {group.sessions.map(({ s, n }) => {
                  const isSelected = selectedIds.has(s.id)
                  return (
                    <div
                      key={s.id}
                      id={`session-${s.id}`}
                      className={`dark:bg-white/[0.03] bg-[#FAF9F6] border rounded-2xl overflow-hidden transition-colors duration-150 ${
                        isSelected
                          ? 'dark:border-yellow-500/40 border-yellow-500/50 dark:bg-yellow-500/[0.05] bg-yellow-50'
                          : 'dark:border-white/[0.07] border-black/[0.16] hover:bg-yellow-500/[0.04] hover:border-yellow-500/[0.15]'
                      }`}
                    >
                      <div className="flex items-center px-4 py-3.5 gap-3">
                        {selectMode && (
                          <button
                            onClick={() => toggleSelect(s.id)}
                            className="shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors"
                            style={{
                              borderColor: isSelected ? '#D97706' : 'rgba(107,114,128,0.5)',
                              background: isSelected ? '#D97706' : 'transparent',
                            }}
                          >
                            {isSelected && (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </button>
                        )}

                        <div
                          className="flex-1 min-w-0"
                          onClick={() => selectMode ? toggleSelect(s.id) : undefined}
                        >
                          {editingNameId === s.id ? (
                            <input
                              autoFocus
                              value={nameInput}
                              onChange={e => setNameInput(e.target.value)}
                              onBlur={() => saveSessionName(s.id)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveSessionName(s.id)
                                if (e.key === 'Escape') setEditingNameId(null)
                              }}
                              placeholder={sessionLabel(n, s.started_at)}
                              maxLength={80}
                              className="text-[14px] font-medium bg-transparent border-b border-yellow-500/50 focus:outline-none dark:text-white/90 text-gray-900 w-full pb-0.5"
                            />
                          ) : (
                            <div
                              className={`flex items-center gap-1.5 ${selectMode ? 'cursor-pointer' : ''}`}
                              onClick={() => { if (!selectMode) { setConfirmingId(null); toggleExpand(s.id) } }}
                            >
                              {s.name ? (
                                <p className="text-[14px] font-medium truncate cursor-pointer dark:text-white/90 text-gray-900">
                                  {s.name}
                                </p>
                              ) : (
                                <button
                                  onClick={e => { e.stopPropagation(); startRename(s) }}
                                  className="text-[14px] font-medium text-gray-500 hover:dark:text-white/70 hover:text-gray-700 transition-colors truncate text-left"
                                  title="Click to name this session"
                                >
                                  {sessionLabel(n, s.started_at)}
                                  <span className="ml-1.5 text-[11px] text-gray-700 font-normal">+ name</span>
                                </button>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-[12px] text-gray-600">
                              {fmtTime(s.started_at)}
                              {fmtDuration(s.started_at, s.ended_at) && ` · ${fmtDuration(s.started_at, s.ended_at)}`}
                            </p>
                            {s.subject && (
                              <span className="text-[10px] font-medium dark:text-yellow-400/80 text-yellow-700 dark:bg-yellow-500/10 bg-yellow-500/[0.08] border dark:border-yellow-500/20 border-yellow-600/20 rounded-full px-2 py-px truncate max-w-[120px]">
                                {s.subject}
                              </span>
                            )}
                          </div>
                          {!s.expanded && s.preview.length > 0 && (
                            <div className="flex items-center gap-1.5 mt-2 overflow-hidden">
                              {s.preview.map((t, ti) => (
                                <span key={ti} className="text-[11px] dark:text-white/60 text-gray-600 dark:bg-white/[0.04] bg-[#F3F1EC] border dark:border-white/[0.06] border-black/[0.08] rounded-full px-2 py-0.5 truncate shrink-0 max-w-[140px]">
                                  {t.length > 20 ? `${t.slice(0, 20)}…` : t}
                                </span>
                              ))}
                              {s.termCount > 3 && (
                                <span className="text-[11px] text-gray-600 shrink-0">+{s.termCount - 3}</span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <div className="text-right mr-1">
                            <p className="text-[14px] font-semibold dark:text-yellow-400 text-yellow-700">{s.termCount}</p>
                            <p className="text-[11px] text-gray-600">words</p>
                          </div>

                          {!selectMode && (
                            <>
                              {confirmingId === s.id ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => setConfirmingId(null)}
                                    className="text-[12px] text-gray-700 hover:text-gray-500 transition-colors px-2 py-1"
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
                                <div className="flex items-center gap-0.5">
                                  <button
                                    onClick={() => startRename(s)}
                                    title="Rename session"
                                    className="text-gray-700 hover:dark:text-yellow-400 hover:text-yellow-700 transition-colors p-1"
                                  >
                                    <PencilIcon />
                                  </button>
                                  <button
                                    onClick={() => setConfirmingId(s.id)}
                                    title="Delete session"
                                    className="text-gray-700 hover:text-red-400 transition-colors p-1"
                                  >
                                    <TrashIcon />
                                  </button>
                                </div>
                              )}

                              <button onClick={() => { setConfirmingId(null); toggleExpand(s.id) }}>
                                <ChevronIcon expanded={s.expanded} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {s.expanded && !selectMode && (
                        <div className="px-4 pb-4 border-t dark:border-white/[0.04] border-black/[0.05]">
                          {s.synopsis ? (
                            <div className="pt-3 pb-1">
                              <SummaryViewer synopsis={s.synopsis} sessionId={s.id} subject={s.subject} year={null} />
                            </div>
                          ) : generatingIds.has(s.id) ? (
                            <p className="text-[12px] text-gray-700 pt-3 pb-1">Generating summary…</p>
                          ) : failedIds.has(s.id) ? (
                            <div className="flex items-center gap-3 pt-3 pb-1">
                              <p className="text-[12px] text-gray-700">Couldn't generate summary.</p>
                              <button onClick={() => retrySummarize(s)} className="text-[12px] text-yellow-500 hover:dark:text-yellow-400 hover:text-yellow-700 transition-colors shrink-0">Retry</button>
                            </div>
                          ) : null}

                          {loadingTerms === s.id && <p className="text-gray-700 text-[13px] py-3">Loading…</p>}
                          {s.terms && s.terms.length === 0 && (
                            <div className="py-3">
                              <p className="text-gray-700 text-[13px]">No terms were detected. Check your microphone is picking up audio clearly.</p>
                              <a href="/dashboard" className="inline-block mt-1.5 text-[13px] dark:text-yellow-400 text-yellow-700 hover:opacity-80 transition-opacity">
                                Try another recording →
                              </a>
                            </div>
                          )}
                          {s.terms && s.terms.length > 0 && (
                            <div className="pt-3">
                              <p className="text-[10px] font-bold tracking-[0.15em] text-gray-600 uppercase mb-2">Words</p>
                              <div className="space-y-2">
                                {s.terms.map(t => (
                                  <div key={t.id} className="flex items-start gap-3">
                                    <div className="flex-1 min-w-0">
                                      <span className={`text-[13px] font-medium ${t.known ? 'text-gray-600 line-through' : 'dark:text-white/80 text-gray-800'}`}>
                                        {t.term}
                                      </span>
                                      <span className="text-gray-600 text-[13px]"> - {t.definition}</span>
                                    </div>
                                    <button
                                      onClick={() => toggleKnown(t.id, t.known)}
                                      title={t.known ? 'Mark as not known' : 'Mark as known'}
                                      className={`shrink-0 mt-0.5 text-[17px] leading-none transition-colors ${
                                        t.known ? 'text-emerald-500 hover:text-gray-600' : 'text-gray-700 hover:text-emerald-500'
                                      }`}
                                    >
                                      ✓
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {s.transcript && (
                            <div className="mt-4 pt-3 border-t dark:border-white/[0.04] border-black/[0.05]">
                              <p className="text-[10px] font-bold tracking-[0.15em] text-gray-600 uppercase mb-2">Transcript</p>
                              <TranscriptViewer transcript={s.transcript} subject={s.subject} year={null} sessionId={s.id} terms={s.terms?.map(t => ({ term: t.term, definition: t.definition }))} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-50 flex items-center justify-between px-4 sm:px-6 py-4 dark:bg-[#0e0e1c]/95 bg-white/95 border-t dark:border-white/[0.07] border-black/[0.10]" style={{ backdropFilter: 'blur(16px)' }}>
          <p className="text-[14px] font-medium dark:text-white/80 text-gray-700">
            {selectedIds.size} session{selectedIds.size !== 1 ? 's' : ''} selected
          </p>
          <div className="flex items-center gap-2">
            {confirmBulkDelete ? (
              <>
                <button
                  onClick={() => setConfirmBulkDelete(false)}
                  className="text-[13px] text-gray-600 hover:text-gray-500 px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  onClick={bulkDelete}
                  disabled={bulkDeleting}
                  className="text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 px-4 py-1.5 rounded-xl transition-colors"
                >
                  {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmBulkDelete(true)}
                className="text-[13px] font-semibold text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-500/50 px-4 py-1.5 rounded-xl transition-colors"
              >
                Delete selected
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={`text-gray-600 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
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

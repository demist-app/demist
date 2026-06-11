'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'

interface Term {
  id: string
  term: string
  definition: string
  session_id: string | null
  subject: string | null
  created_at: string
  sm2_review_count: number
  known: boolean
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

function TagIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </svg>
  )
}

export default function Glossary() {
  const [sessions, setSessions] = useState<GlossarySession[]>([])
  const [orphanTerms, setOrphanTerms] = useState<Term[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'session' | 'tag'>('session')
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [sortMode, setSortMode] = useState<'recent' | 'alpha' | 'most_reviewed' | 'least_reviewed'>('recent')

  // Bulk select state
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)

  useEffect(() => {
    const savedGroup = localStorage.getItem('demist_glossary_group_by_session')
    if (savedGroup === 'tag' || savedGroup === 'session') setGroupBy(savedGroup)
    const savedSort = localStorage.getItem('demist_glossary_sort')
    if (savedSort === 'recent' || savedSort === 'alpha' || savedSort === 'most_reviewed' || savedSort === 'least_reviewed') setSortMode(savedSort)
  }, [])

  const changeGroupBy = (mode: 'session' | 'tag') => {
    setGroupBy(mode)
    localStorage.setItem('demist_glossary_group_by_session', mode)
    capture('glossary_group_toggled', { grouped: mode === 'session' })
  }

  const changeSortMode = (mode: typeof sortMode) => {
    setSortMode(mode)
    localStorage.setItem('demist_glossary_sort', mode)
    capture('glossary_sort_changed', { sort: mode })
  }

  const sortTerms = (terms: Term[]): Term[] => {
    const arr = [...terms]
    switch (sortMode) {
      case 'alpha': return arr.sort((a, b) => a.term.localeCompare(b.term))
      case 'most_reviewed': return arr.sort((a, b) => (b.sm2_review_count ?? 0) - (a.sm2_review_count ?? 0))
      case 'least_reviewed': return arr.sort((a, b) => (a.sm2_review_count ?? 0) - (b.sm2_review_count ?? 0))
      default: return arr.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    }
  }

  const toggleTermSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  const bulkMarkKnown = async () => {
    if (selectedIds.size === 0 || bulkWorking) return
    setBulkWorking(true)
    try {
      const ids = [...selectedIds]
      const supabase = createClient()
      const { error } = await supabase.from('terms').update({ known: true }).in('id', ids)
      if (error) throw error
      setSessions(prev => prev.map(s => ({ ...s, terms: s.terms.filter(t => !selectedIds.has(t.id)) })).filter(s => s.terms.length > 0))
      setOrphanTerms(prev => prev.filter(t => !selectedIds.has(t.id)))
      setTotalCount(prev => prev - ids.length)
      capture('glossary_bulk_mark_known', { count: ids.length })
      exitSelectMode()
    } catch (e) {
      console.error('bulkMarkKnown error:', e)
    } finally {
      setBulkWorking(false)
    }
  }

  const bulkExportCsv = () => {
    if (selectedIds.size === 0) return
    const selected = [...sessions.flatMap(s => s.terms), ...orphanTerms].filter(t => selectedIds.has(t.id))
    const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`
    const csv = ['Term,Definition,Group', ...selected.map(t => `${esc(t.term)},${esc(t.definition)},${esc(t.subject ?? '')}`)].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'demist-glossary.csv'
    a.click()
    URL.revokeObjectURL(url)
    capture('glossary_bulk_export', { count: selected.length })
  }

  // Definition edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)

  // Tag edit state
  const [tagEditingId, setTagEditingId] = useState<string | null>(null)
  const [tagEditValue, setTagEditValue] = useState('')
  const [savingTagId, setSavingTagId] = useState<string | null>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)

  // Suggestions
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])

  // Delete state
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus()
      editRef.current.setSelectionRange(editRef.current.value.length, editRef.current.value.length)
    }
  }, [editingId])

  useEffect(() => {
    if (tagEditingId && tagInputRef.current) tagInputRef.current.focus()
  }, [tagEditingId])

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const user = session?.user
        if (!user) return
        capture('glossary_viewed')

        const [
          { data: termsData, error: termsErr },
          { data: sessionsData, error: sessionsErr },
        ] = await Promise.all([
          supabase.from('terms').select('id, term, definition, session_id, subject, created_at, sm2_review_count, known').eq('user_id', user.id).order('created_at', { ascending: true }),
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

        // Collect unique non-null tags for autocomplete suggestions
        const tags = new Set<string>()
        for (const t of allTerms) if (t.subject) tags.add(t.subject)
        setTagSuggestions([...tags].sort())
      } catch (e) {
        console.error('glossary load error:', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  // ── All terms flattened (for tag grouping and suggestions) ───────────────────
  const allTerms: Term[] = [
    ...sessions.flatMap(s => s.terms),
    ...orphanTerms,
  ]

  const allTagsList = [...new Set(allTerms.map(t => t.subject).filter(Boolean) as string[])].sort()

  // ── Mutation helpers ─────────────────────────────────────────────────────────

  const applyTermUpdate = (update: (t: Term) => Term) => {
    setSessions(prev => prev.map(s => ({ ...s, terms: s.terms.map(update) })))
    setOrphanTerms(prev => prev.map(update))
  }

  const startEditDef = (t: Term) => {
    setEditingId(t.id)
    setEditValue(t.definition)
    setTagEditingId(null)
    setConfirmDeleteId(null)
  }

  const cancelEditDef = () => setEditingId(null)

  const saveDefinition = async (termId: string) => {
    const trimmed = editValue.trim()
    if (!trimmed) { cancelEditDef(); return }
    setSavingId(termId)
    try {
      const supabase = createClient()
      await supabase.from('terms').update({ definition: trimmed }).eq('id', termId)
      applyTermUpdate(t => t.id === termId ? { ...t, definition: trimmed } : t)
      setEditingId(null)
    } catch (e) {
      console.error('save definition error:', e)
    } finally {
      setSavingId(null)
    }
  }

  const startEditTag = (t: Term) => {
    setTagEditingId(t.id)
    setTagEditValue(t.subject ?? '')
    setEditingId(null)
    setConfirmDeleteId(null)
  }

  const cancelEditTag = () => setTagEditingId(null)

  const saveTag = async (termId: string) => {
    const trimmed = tagEditValue.trim()
    const value = trimmed || null
    setSavingTagId(termId)
    try {
      const supabase = createClient()
      await supabase.from('terms').update({ subject: value }).eq('id', termId)
      applyTermUpdate(t => t.id === termId ? { ...t, subject: value } : t)
      if (value) setTagSuggestions(prev => prev.includes(value) ? prev : [...prev, value].sort())
      setTagEditingId(null)
    } catch (e) {
      console.error('save tag error:', e)
    } finally {
      setSavingTagId(null)
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

  // ── Filtering ────────────────────────────────────────────────────────────────

  const q = search.toLowerCase()

  const termMatches = (t: Term) =>
    !q || t.term.toLowerCase().includes(q) || t.definition.toLowerCase().includes(q) || (t.subject ?? '').toLowerCase().includes(q)

  const filteredSessions = sessions
    .map(s => ({ ...s, terms: s.terms.filter(termMatches) }))
    .filter(s => s.terms.length > 0)

  const filteredOrphans = orphanTerms.filter(termMatches)

  const hasResults = filteredSessions.length > 0 || filteredOrphans.length > 0

  // ── Tag grouping ─────────────────────────────────────────────────────────────
  // Groups terms by their own subject field; untagged terms fall into "Untagged"
  const tagGroups = (() => {
    if (groupBy !== 'tag') return null
    const map = new Map<string, Term[]>()
    const add = (t: Term) => {
      const key = t.subject?.trim() || 'Untagged'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(t)
    }
    for (const s of filteredSessions) s.terms.forEach(add)
    filteredOrphans.forEach(add)

    let entries = [...map.entries()].sort((a, b) => {
      if (a[0] === 'Untagged') return 1
      if (b[0] === 'Untagged') return -1
      return a[0].localeCompare(b[0])
    })

    if (tagFilter) entries = entries.filter(([key]) => key === tagFilter)

    return entries
  })()

  // ── Term row renderer ────────────────────────────────────────────────────────
  const renderTermRow = (t: Term, i: number) => (
    <div
      key={t.id}
      onClick={selectMode ? () => toggleTermSelect(t.id) : undefined}
      className={`px-4 py-3.5 transition-colors duration-150 ${i > 0 ? 'border-t dark:border-white/[0.04] border-black/[0.05]' : ''} ${selectMode ? 'cursor-pointer' : ''} ${selectedIds.has(t.id) ? 'dark:bg-yellow-500/[0.06] bg-yellow-50' : editingId === t.id || tagEditingId === t.id ? 'dark:bg-white/[0.03] bg-[#F3F1EC]' : 'hover:bg-yellow-500/[0.02]'}`}
    >
      <div className="flex items-start gap-2">
        {selectMode && (
          <span
            className="shrink-0 w-5 h-5 mt-0.5 rounded-full border-2 flex items-center justify-center transition-colors"
            style={{
              borderColor: selectedIds.has(t.id) ? '#D97706' : 'rgba(107,114,128,0.5)',
              background: selectedIds.has(t.id) ? '#D97706' : 'transparent',
            }}
          >
            {selectedIds.has(t.id) && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5l2.5 2.5L8 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold dark:text-white/90 text-gray-900 leading-snug">{t.term}</p>

          {/* Definition */}
          {editingId === t.id ? (
            <div className="mt-2">
              <textarea
                ref={editRef}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveDefinition(t.id) }
                  if (e.key === 'Escape') cancelEditDef()
                }}
                rows={3}
                className="w-full text-[13px] dark:text-white/80 text-gray-700 dark:bg-white/[0.05] bg-[#EFEDE7] border dark:border-amber-500/30 border-amber-500/40 rounded-xl px-3 py-2 resize-none focus:outline-none leading-relaxed"
              />
              <div className="flex items-center gap-2 mt-1.5">
                <button onClick={() => saveDefinition(t.id)} disabled={savingId === t.id} className="text-[12px] font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-40 transition-colors">
                  {savingId === t.id ? 'Saving…' : 'Save'}
                </button>
                <button onClick={cancelEditDef} className="text-[12px] text-gray-600 hover:text-gray-500 transition-colors">Cancel</button>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-gray-700 mt-1 leading-relaxed">{t.definition}</p>
          )}

          {/* Tag pill / inline tag editor */}
          {editingId !== t.id && (
            <div className="mt-2">
              {tagEditingId === t.id ? (
                <div className="flex items-center gap-2">
                  <div className="relative flex-1 max-w-[220px]">
                    <input
                      ref={tagInputRef}
                      value={tagEditValue}
                      onChange={e => setTagEditValue(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveTag(t.id)
                        if (e.key === 'Escape') cancelEditTag()
                      }}
                      placeholder="Group name (e.g. Week 3, Exam prep…)"
                      list={`tag-suggestions-${t.id}`}
                      className="w-full text-[12px] dark:text-white/80 text-gray-700 dark:bg-white/[0.06] bg-[#EFEDE7] border dark:border-amber-500/30 border-amber-500/40 rounded-lg px-2.5 py-1.5 focus:outline-none"
                    />
                    {tagSuggestions.length > 0 && (
                      <datalist id={`tag-suggestions-${t.id}`}>
                        {tagSuggestions.map(s => <option key={s} value={s} />)}
                      </datalist>
                    )}
                  </div>
                  <button onClick={() => saveTag(t.id)} disabled={savingTagId === t.id} className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-40 transition-colors shrink-0">
                    {savingTagId === t.id ? '…' : 'Save'}
                  </button>
                  <button onClick={cancelEditTag} className="text-[11px] text-gray-600 hover:text-gray-500 transition-colors shrink-0">Cancel</button>
                </div>
              ) : t.subject ? (
                <button
                  onClick={() => startEditTag(t)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium dark:bg-amber-500/10 bg-amber-100 dark:text-amber-400/80 text-amber-700 dark:border-amber-500/20 border-amber-200 border hover:opacity-70 transition-opacity"
                >
                  <TagIcon />
                  {t.subject}
                </button>
              ) : (
                <button
                  onClick={() => startEditTag(t)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] text-gray-600 dark:bg-white/[0.04] bg-black/[0.04] border dark:border-white/[0.06] border-black/[0.08] hover:dark:border-amber-500/30 hover:border-amber-300 hover:dark:text-amber-400 hover:text-amber-600 transition-all"
                >
                  <TagIcon />
                  Add group
                </button>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        {editingId !== t.id && tagEditingId !== t.id && (
          <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
            <button onClick={() => startEditDef(t)} title="Edit definition" className="p-1.5 text-gray-700 hover:dark:text-yellow-400 hover:text-yellow-700 transition-colors rounded-lg hover:dark:bg-white/[0.06] hover:bg-black/[0.05]">
              <PencilIcon />
            </button>
            {confirmDeleteId === t.id ? (
              <div className="flex items-center gap-1 ml-1">
                <button onClick={() => setConfirmDeleteId(null)} className="text-[11px] text-gray-600 hover:text-gray-500 transition-colors px-1.5 py-1">Cancel</button>
                <button onClick={() => deleteTerm(t.id)} disabled={deletingId === t.id} className="text-[11px] font-semibold text-red-400 hover:text-red-300 transition-colors px-1.5 py-1 disabled:opacity-40">
                  {deletingId === t.id ? '…' : 'Delete'}
                </button>
              </div>
            ) : (
              <button onClick={() => setConfirmDeleteId(t.id)} title="Delete term" className="p-1.5 text-gray-700 hover:text-red-400 transition-colors rounded-lg hover:dark:bg-white/[0.06] hover:bg-black/[0.05]">
                <TrashIcon />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )

  const hasMultipleSessions = sessions.length > 1 || orphanTerms.length > 0

  return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col nav-bottom-pad">
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

        {!loading && totalCount > 0 && (
          <div className="mt-5 space-y-3">
            {/* Search */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search words…"
                  className="w-full pl-10 pr-4 py-3 dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] rounded-2xl text-[14px] dark:text-white text-gray-900 placeholder-gray-700 focus:outline-none focus:border-yellow-500/40 focus:dark:bg-white/[0.07] transition-all"
                />
              </div>

              {/* View toggle */}
              {hasMultipleSessions && (
                <div className="flex items-center dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] rounded-2xl p-1 shrink-0">
                  <button
                    onClick={() => { changeGroupBy('session'); setTagFilter(null) }}
                    className={`text-[12px] font-medium px-3 py-1.5 rounded-xl transition-all ${groupBy === 'session' ? 'dark:bg-white/[0.10] bg-white shadow-sm dark:text-white text-gray-900' : 'text-gray-600 hover:text-gray-500'}`}
                  >
                    Session
                  </button>
                  <button
                    onClick={() => changeGroupBy('tag')}
                    className={`text-[12px] font-medium px-3 py-1.5 rounded-xl transition-all ${groupBy === 'tag' ? 'dark:bg-white/[0.10] bg-white shadow-sm dark:text-white text-gray-900' : 'text-gray-600 hover:text-gray-500'}`}
                  >
                    Group
                  </button>
                </div>
              )}
            </div>

            {/* Sort + select controls */}
            <div className="flex items-center justify-between gap-2">
              <select
                value={sortMode}
                onChange={e => changeSortMode(e.target.value as typeof sortMode)}
                className="text-[12px] font-medium dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] rounded-xl px-3 py-2 dark:text-gray-300 text-gray-700 focus:outline-none focus:border-yellow-500/40 appearance-none cursor-pointer"
              >
                <option value="recent">Recently added</option>
                <option value="alpha">Alphabetical</option>
                <option value="most_reviewed">Most reviewed</option>
                <option value="least_reviewed">Least reviewed</option>
              </select>
              {selectMode ? (
                <button
                  onClick={exitSelectMode}
                  className="text-[12px] font-medium text-gray-600 hover:text-gray-500 transition-colors px-3 py-2"
                >
                  Cancel
                </button>
              ) : (
                <button
                  onClick={() => setSelectMode(true)}
                  className="text-[12px] font-medium text-gray-600 hover:dark:text-white/70 hover:text-gray-900 transition-colors px-3 py-2"
                >
                  Select
                </button>
              )}
            </div>

            {/* Tag filter chips (shown in Group view) */}
            {groupBy === 'tag' && allTagsList.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => setTagFilter(null)}
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${!tagFilter ? 'dark:bg-amber-500/15 bg-amber-100 dark:text-amber-300 text-amber-700 dark:border-amber-500/30 border-amber-300' : 'dark:bg-white/[0.04] bg-[#FAF9F6] text-gray-600 dark:border-white/[0.07] border-black/[0.10] hover:dark:border-white/[0.12] hover:border-black/[0.16]'}`}
                >
                  All
                </button>
                {allTagsList.map(tag => (
                  <button
                    key={tag}
                    onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border ${tagFilter === tag ? 'dark:bg-amber-500/15 bg-amber-100 dark:text-amber-300 text-amber-700 dark:border-amber-500/30 border-amber-300' : 'dark:bg-white/[0.04] bg-[#FAF9F6] text-gray-600 dark:border-white/[0.07] border-black/[0.10] hover:dark:border-white/[0.12] hover:border-black/[0.16]'}`}
                  >
                    <TagIcon />
                    {tag}
                  </button>
                ))}
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
                </div>
                <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl overflow-hidden">
                  {Array.from({ length: count }).map((_, j) => (
                    <div key={j} className={`px-4 py-4 flex gap-3 ${j > 0 ? 'border-t dark:border-white/[0.04] border-black/[0.05]' : ''}`}>
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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <p className="text-[15px] font-medium text-gray-600">No words yet</p>
            <p className="text-[13px] text-gray-700">Record or import a lecture and Demist will fill this in automatically.</p>
            <div className="flex items-center gap-2 mt-3">
              <Link
                href="/dashboard"
                className="px-4 py-2 rounded-xl bg-yellow-600 hover:brightness-110 text-white text-[13px] font-semibold transition-all active:scale-[0.97]"
              >
                Start recording
              </Link>
              <Link
                href="/import"
                className="px-4 py-2 rounded-xl dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] text-[13px] font-medium dark:text-gray-300 text-gray-700 hover:dark:bg-white/[0.08] transition-all active:scale-[0.97]"
              >
                Import a file
              </Link>
            </div>
          </div>
        )}

        {!loading && totalCount > 0 && !hasResults && (
          <p className="text-center text-gray-600 text-[14px] py-12">No results for &ldquo;{search}&rdquo;</p>
        )}

        {/* Session view */}
        {!loading && hasResults && groupBy === 'session' && (
          <div className="space-y-7">
            {filteredSessions.map(s => (
              <div key={s.id}>
                <div className="flex items-center gap-2.5 mb-3">
                  <span className={`text-[13px] font-semibold shrink-0 truncate max-w-[180px] ${s.name ? 'dark:text-white/80 text-gray-800' : 'text-gray-700'}`}>
                    {s.name || fmtDate(s.started_at)}
                  </span>
                  {s.name && <span className="text-[12px] text-gray-600 shrink-0">{fmtDate(s.started_at)}</span>}
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
                  {sortTerms(s.terms).map((t, i) => renderTermRow(t, i))}
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
                  {sortTerms(filteredOrphans).map((t, i) => renderTermRow(t, i))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tag / Group view */}
        {!loading && hasResults && groupBy === 'tag' && tagGroups && (
          <div className="space-y-7">
            {tagGroups.length === 0 ? (
              <p className="text-center text-gray-600 text-[14px] py-12">No terms in this group.</p>
            ) : tagGroups.map(([tag, terms]) => (
              <div key={tag}>
                <div className="flex items-center gap-2.5 mb-3">
                  {tag !== 'Untagged' ? (
                    <div className="inline-flex items-center gap-1.5 shrink-0">
                      <TagIcon />
                      <span className="text-[13px] font-semibold dark:text-white/80 text-gray-800 truncate max-w-[200px]">{tag}</span>
                    </div>
                  ) : (
                    <span className="text-[11px] font-bold text-gray-600 uppercase tracking-[0.14em] shrink-0">Untagged</span>
                  )}
                  <div className="flex-1 h-px dark:bg-white/[0.05] bg-[#F6F5F2]" />
                  <span className="text-[11px] text-gray-700 shrink-0 tabular-nums">{terms.length} word{terms.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl overflow-hidden">
                  {sortTerms(terms).map((t, i) => renderTermRow(t, i))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
      </div>

      {/* Bulk action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-50 flex items-center justify-between px-4 sm:px-6 py-4 dark:bg-[#0e0e1c]/95 bg-white/95 border-t dark:border-white/[0.07] border-black/[0.10]" style={{ backdropFilter: 'blur(16px)' }}>
          <p className="text-[14px] font-medium dark:text-white/80 text-gray-700">
            {selectedIds.size} term{selectedIds.size !== 1 ? 's' : ''} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={bulkExportCsv}
              className="text-[13px] font-medium dark:text-gray-300 text-gray-700 border dark:border-white/[0.12] border-black/[0.15] hover:dark:bg-white/[0.06] hover:bg-black/[0.04] px-4 py-1.5 rounded-xl transition-colors"
            >
              Export CSV
            </button>
            <button
              onClick={bulkMarkKnown}
              disabled={bulkWorking}
              className="text-[13px] font-semibold text-white bg-yellow-600 hover:brightness-110 disabled:opacity-50 px-4 py-1.5 rounded-xl transition-[filter]"
            >
              {bulkWorking ? 'Working…' : 'Mark as known'}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}

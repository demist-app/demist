'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'

const NEW_CARDS_PER_DAY = 15

interface FlashCard {
  id: string
  term: string
  definition: string
  sm2_interval: number
  sm2_ease: number
  sm2_review_count: number
  sm2_due_at: string | null
  isNew: boolean
}

function sm2Update(ease: number, interval: number, grade: 0 | 1 | 2 | 3): { interval: number; ease: number } {
  const newEase = Math.max(1.3, Math.min(3.0, ease + ([-0.2, -0.15, 0, 0.15] as const)[grade]))
  let newInterval: number
  if (grade === 0) {
    newInterval = 1
  } else if (grade === 1) {
    newInterval = Math.max(1, Math.round(interval * 1.2))
  } else if (grade === 2) {
    newInterval = Math.max(1, Math.round(interval * ease))
  } else {
    newInterval = Math.max(1, Math.round(interval * ease * 1.3))
  }
  return { interval: newInterval, ease: newEase }
}

const GRADE_LABELS: { grade: 0 | 1 | 2 | 3; label: string; ariaLabel: string; color: string }[] = [
  { grade: 0, label: 'Again', ariaLabel: 'Again: forgotten, review again soon',      color: 'border-red-500/40 hover:bg-red-500/10 text-red-400' },
  { grade: 1, label: 'Hard',  ariaLabel: 'Hard: remembered with difficulty',         color: 'border-orange-500/40 hover:bg-orange-500/10 text-orange-400' },
  { grade: 2, label: 'Good',  ariaLabel: 'Good: remembered correctly',               color: 'border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-400' },
  { grade: 3, label: 'Easy',  ariaLabel: 'Easy: remembered without effort',          color: 'border-yellow-500/40 hover:bg-yellow-500/10 dark:text-yellow-400 text-yellow-700' },
]

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

function calculateStreak(timestamps: string[]): number {
  if (!timestamps.length) return 0
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = new Set(timestamps.map(t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime() }))
  let streak = 0; let cur = today.getTime()
  if (!days.has(cur)) cur -= 86400000
  while (days.has(cur)) { streak++; cur -= 86400000 }
  return streak
}

type Phase = 'loading' | 'empty' | 'review' | 'done'

export default function Flashcards() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [queue, setQueue] = useState<FlashCard[]>([])
  const [current, setCurrent] = useState<FlashCard | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const [dueCount, setDueCount] = useState(0)
  const [newCount, setNewCount] = useState(0)
  const [saving, setSaving] = useState(false)
  const [stuckOnLast, setStuckOnLast] = useState(false)
  const [reviewedCards, setReviewedCards] = useState<FlashCard[]>([])
  const [gradeCounts, setGradeCounts] = useState<[number, number, number, number]>([0, 0, 0, 0])
  const [streak, setStreak] = useState(0)
  const [displayStreak, setDisplayStreak] = useState(0)
  const doneTrackedRef = useRef(false)

  // Browse mode
  const [hasAnyTerms, setHasAnyTerms] = useState(true)

  // Browse mode
  const [browseMode, setBrowseMode] = useState(false)
  const [allCards, setAllCards] = useState<FlashCard[]>([])
  const [browseLoading, setBrowseLoading] = useState(false)
  const [browseSearch, setBrowseSearch] = useState('')

  // Edit state in browse
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTerm, setEditTerm] = useState('')
  const [editDef, setEditDef] = useState('')
  const [savingEditId, setSavingEditId] = useState<string | null>(null)

  // Delete state in browse
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const termInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingId && termInputRef.current) termInputRef.current.focus()
  }, [editingId])

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return
      capture('flashcards_viewed')

      const now = new Date().toISOString()

      const [{ data: reviews }, { data: newCards }, { count: totalTerms }, { data: sessionDates }] = await Promise.all([
        supabase
          .from('terms')
          .select('id, term, definition, sm2_interval, sm2_ease, sm2_review_count, sm2_due_at')
          .eq('user_id', user.id)
          .eq('known', false)
          .gt('sm2_review_count', 0)
          .lte('sm2_due_at', now)
          .order('sm2_due_at', { ascending: true }),
        supabase
          .from('terms')
          .select('id, term, definition, sm2_interval, sm2_ease, sm2_review_count, sm2_due_at')
          .eq('user_id', user.id)
          .eq('known', false)
          .eq('sm2_review_count', 0)
          .order('created_at', { ascending: true })
          .limit(NEW_CARDS_PER_DAY),
        supabase
          .from('terms')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id),
        supabase
          .from('sessions')
          .select('started_at')
          .eq('user_id', user.id)
          .order('started_at', { ascending: false })
          .limit(365),
      ])
      setHasAnyTerms((totalTerms ?? 0) > 0)
      setStreak(calculateStreak((sessionDates ?? []).map(s => s.started_at)))

      const due = (reviews ?? []).map(c => ({ ...c, isNew: false })) as FlashCard[]
      const fresh = (newCards ?? []).map(c => ({ ...c, isNew: true })) as FlashCard[]
      const cards = [...due, ...fresh]

      if (!cards.length) { setPhase('empty'); return }

      setDueCount(due.length)
      setNewCount(fresh.length)
      setQueue(cards.slice(1))
      setCurrent(cards[0])
      setPhase('review')
    })()
  }, [])

  const loadAllCards = async () => {
    if (allCards.length > 0 || browseLoading) return
    setBrowseLoading(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return
      const { data } = await supabase
        .from('terms')
        .select('id, term, definition, sm2_interval, sm2_ease, sm2_review_count, sm2_due_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      setAllCards(((data ?? []) as FlashCard[]).map(c => ({ ...c, isNew: false })))
    } catch (e) {
      console.error('loadAllCards error:', e)
    } finally {
      setBrowseLoading(false)
    }
  }

  const openBrowse = () => {
    setBrowseMode(true)
    loadAllCards()
  }

  const startEdit = (c: FlashCard) => {
    setEditingId(c.id)
    setEditTerm(c.term)
    setEditDef(c.definition)
    setConfirmDeleteId(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  const saveEdit = async (id: string) => {
    const term = editTerm.trim()
    const def = editDef.trim()
    if (!term || !def) { cancelEdit(); return }
    setSavingEditId(id)
    try {
      const supabase = createClient()
      await supabase.from('terms').update({ term, definition: def }).eq('id', id)
      const update = (c: FlashCard) => c.id === id ? { ...c, term, definition: def } : c
      setAllCards(prev => prev.map(update))
      setEditingId(null)
    } catch (e) {
      console.error('saveEdit error:', e)
    } finally {
      setSavingEditId(null)
    }
  }

  const deleteCard = async (id: string) => {
    setDeletingId(id)
    try {
      const supabase = createClient()
      await supabase.from('terms').delete().eq('id', id)
      setAllCards(prev => prev.filter(c => c.id !== id))
      setConfirmDeleteId(null)
    } catch (e) {
      console.error('deleteCard error:', e)
    } finally {
      setDeletingId(null)
    }
  }

  const handleGrade = async (grade: 0 | 1 | 2 | 3) => {
    if (!current || saving) return
    setSaving(true)

    const { interval, ease } = sm2Update(
      current.sm2_ease ?? 2.5,
      current.sm2_interval ?? 1,
      grade,
    )
    const dueAt = new Date(Date.now() + interval * 86400000).toISOString()

    const supabase = createClient()
    const { error } = await supabase
      .from('terms')
      .update({
        sm2_interval: interval,
        sm2_ease: ease,
        sm2_due_at: dueAt,
        sm2_review_count: (current.sm2_review_count ?? 0) + 1,
      })
      .eq('id', current.id)

    if (error) {
      console.error('sm2 update failed:', error)
      setSaving(false)
      return
    }

    capture('flashcard_graded', { grade, interval, isNew: current.isNew })
    setGradeCounts(prev => {
      const next = [...prev] as [number, number, number, number]
      next[grade]++
      return next
    })

    setFlipped(false)
    setSaving(false)

    if (grade === 0) {
      if (queue.length === 0) {
        setCurrent(current)
        setStuckOnLast(true)
      } else {
        setQueue(q => [...q, { ...current, isNew: false }])
        setCurrent(queue[0])
        setQueue(q => q.slice(1))
        setStuckOnLast(false)
      }
      return
    }

    setStuckOnLast(false)
    setReviewedCards(prev => [...prev, current])
    setReviewed(r => r + 1)
    if (queue.length === 0) {
      setPhase('done')
    } else {
      setCurrent(queue[0])
      setQueue(q => q.slice(1))
    }
  }

  const total = dueCount + newCount
  const progressPct = total > 0 ? Math.round((reviewed / total) * 100) : 0

  // Keyboard shortcuts: space/enter flips, 1-4 grades
  useEffect(() => {
    if (phase !== 'review' || browseMode) return
    const onKey = (e: KeyboardEvent) => {
      if (editingId || (e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setFlipped(f => f || true)
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        handleGrade((Number(e.key) - 1) as 0 | 1 | 2 | 3)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // intentionally re-bound each render so handleGrade sees fresh state

  const totalGrades = gradeCounts[0] + gradeCounts[1] + gradeCounts[2] + gradeCounts[3]
  const goodEasyPct = totalGrades > 0 ? Math.round(((gradeCounts[2] + gradeCounts[3]) / totalGrades) * 100) : 0

  useEffect(() => {
    if (phase !== 'done') return
    if (!doneTrackedRef.current) {
      doneTrackedRef.current = true
      capture('flashcard_session_completed', {
        cards_reviewed: reviewed,
        streak,
        good_easy_pct: goodEasyPct,
      })
    }
    if (streak === 0) { setDisplayStreak(0); return }
    setDisplayStreak(0)
    const stepMs = Math.max(40, Math.min(120, 600 / streak))
    let n = 0
    const id = setInterval(() => {
      n++
      setDisplayStreak(n)
      if (n >= streak) clearInterval(id)
    }, stepMs)
    return () => clearInterval(id)
  }, [phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const queueLabel = [
    dueCount > 0 && `${dueCount} due`,
    newCount > 0 && `${newCount} new`,
  ].filter(Boolean).join(' · ')

  const filteredCards = browseSearch
    ? allCards.filter(c =>
        c.term.toLowerCase().includes(browseSearch.toLowerCase()) ||
        c.definition.toLowerCase().includes(browseSearch.toLowerCase())
      )
    : allCards

  // ── Browse mode ──────────────────────────────────────────────────────────────
  if (browseMode) {
    return (
      <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col nav-bottom-pad">
        <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
          <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-yellow-700/[0.05] blur-[120px]" />
        </div>

        <header className="relative z-10 shrink-0 flex items-center justify-between px-4 sm:px-6 h-14 border-b dark:border-white/[0.05] border-black/[0.06]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setBrowseMode(false)}
              className="text-gray-600 hover:dark:text-white hover:text-gray-900 transition-colors p-1 -ml-1"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <span className="font-semibold tracking-tight text-[15px]">All Cards</span>
          </div>
          <span className="text-[13px] text-gray-600 tabular-nums">{allCards.length} total</span>
        </header>

        <div className="flex-1 overflow-y-auto relative z-10">
          <div className="w-full max-w-2xl mx-auto">
            <div className="px-4 sm:px-6 pt-4 pb-2">
              <div className="relative">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  value={browseSearch}
                  onChange={e => setBrowseSearch(e.target.value)}
                  placeholder="Search cards..."
                  className="w-full pl-10 pr-4 py-3 dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.13] rounded-2xl text-[14px] dark:text-white text-gray-900 placeholder-gray-700 focus:outline-none focus:border-yellow-500/40 transition-all"
                />
              </div>
            </div>

            <div className="px-4 sm:px-6 pb-6">
              {browseLoading ? (
                <div className="animate-pulse space-y-2 mt-2">
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className="h-20 dark:bg-white/[0.04] bg-[#FAF9F6] rounded-2xl" />
                  ))}
                </div>
              ) : filteredCards.length === 0 ? (
                <p className="text-center text-gray-600 text-[14px] py-12">
                  {browseSearch ? `No results for "${browseSearch}"` : 'No cards yet.'}
                </p>
              ) : (
                <div className="mt-2 dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl overflow-hidden">
                  {filteredCards.map((c, i) => (
                    <div
                      key={c.id}
                      className={`px-4 py-3.5 transition-colors ${i > 0 ? 'border-t dark:border-white/[0.04] border-black/[0.05]' : ''} ${editingId === c.id ? 'dark:bg-white/[0.03] bg-[#F3F1EC]' : 'hover:bg-yellow-500/[0.02]'}`}
                    >
                      {editingId === c.id ? (
                        <div className="space-y-2">
                          <input
                            ref={termInputRef}
                            value={editTerm}
                            onChange={e => setEditTerm(e.target.value)}
                            placeholder="Term"
                            className="w-full text-[14px] font-semibold dark:text-white text-gray-900 dark:bg-white/[0.05] bg-[#EFEDE7] border dark:border-amber-500/30 border-amber-500/40 rounded-xl px-3 py-2 focus:outline-none"
                          />
                          <textarea
                            value={editDef}
                            onChange={e => setEditDef(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Escape') cancelEdit() }}
                            placeholder="Definition"
                            rows={3}
                            className="w-full text-[13px] dark:text-white/80 text-gray-700 dark:bg-white/[0.05] bg-[#EFEDE7] border dark:border-amber-500/30 border-amber-500/40 rounded-xl px-3 py-2 resize-none focus:outline-none leading-relaxed"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => saveEdit(c.id)}
                              disabled={savingEditId === c.id}
                              className="text-[12px] font-semibold text-amber-400 hover:text-amber-300 disabled:opacity-40 transition-colors"
                            >
                              {savingEditId === c.id ? 'Saving…' : 'Save'}
                            </button>
                            <button onClick={cancelEdit} className="text-[12px] text-gray-600 hover:text-gray-500 transition-colors">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-semibold dark:text-white/90 text-gray-900 leading-snug">{c.term}</p>
                            <p className="text-[12px] text-gray-600 mt-0.5 leading-relaxed line-clamp-2">{c.definition}</p>
                            {(c.sm2_review_count ?? 0) > 0 && (
                              <p className="text-[11px] text-gray-700 mt-1 tabular-nums">
                                {c.sm2_review_count} review{c.sm2_review_count !== 1 ? 's' : ''}
                                {c.sm2_due_at ? ` · next ${new Date(c.sm2_due_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                            <button
                              onClick={() => startEdit(c)}
                              title="Edit card"
                              className="p-1.5 text-gray-700 hover:dark:text-yellow-400 hover:text-yellow-700 transition-colors rounded-lg hover:dark:bg-white/[0.06] hover:bg-black/[0.05]"
                            >
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            {confirmDeleteId === c.id ? (
                              <div className="flex items-center gap-1 ml-1">
                                <button onClick={() => setConfirmDeleteId(null)} className="text-[11px] text-gray-600 hover:text-gray-500 px-1.5 py-1 transition-colors">Cancel</button>
                                <button
                                  onClick={() => deleteCard(c.id)}
                                  disabled={deletingId === c.id}
                                  className="text-[11px] font-semibold text-red-400 hover:text-red-300 px-1.5 py-1 disabled:opacity-40 transition-colors"
                                >
                                  {deletingId === c.id ? '…' : 'Delete'}
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(c.id)}
                                title="Delete card"
                                className="p-1.5 text-gray-700 hover:text-red-400 transition-colors rounded-lg hover:dark:bg-white/[0.06] hover:bg-black/[0.05]"
                              >
                                <TrashIcon />
                              </button>
                            )}
                          </div>
                        </div>
                      )}
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

  // ── Review mode ──────────────────────────────────────────────────────────────
  return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col nav-bottom-pad">
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-yellow-700/[0.05] blur-[120px]" />
      </div>
      <header className="sm:hidden relative z-10 shrink-0 flex items-center justify-between px-6 h-14 border-b dark:border-white/[0.05] border-black/[0.06]">
        <span className="font-semibold tracking-tight text-[15px]">Flashcards</span>
        <div className="flex items-center gap-3">
          {phase === 'review' && (
            <span className="text-[13px] text-gray-600">{queueLabel}</span>
          )}
          <button
            onClick={openBrowse}
            className="text-[13px] text-gray-600 hover:dark:text-white hover:text-gray-900 transition-colors"
          >
            Browse all
          </button>
        </div>
      </header>

      {phase === 'loading' && (
        <div className="flex-1 flex flex-col px-4 sm:px-6 pt-4 pb-4 animate-pulse">
          <div className="h-1 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full mb-6" />
          <div className="flex items-center gap-2 mb-4">
            <div className="h-5 w-16 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full" />
            <div className="h-5 w-14 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-[380px] dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-[24px] h-[220px]" />
          </div>
          <div className="grid grid-cols-4 gap-2 mt-4">
            {[0,1,2,3].map(i => (
              <div key={i} className="h-12 dark:bg-white/[0.04] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl" />
            ))}
          </div>
        </div>
      )}

      {phase === 'empty' && (
        <div className="flex-1 flex flex-col px-4 sm:px-6 py-8">
          <div className="flex flex-col items-center text-center gap-3 mb-8">
            {hasAnyTerms ? (
              <>
                <p className="text-[22px] font-bold">All caught up</p>
                <p className="text-gray-700 text-[14px] leading-relaxed max-w-xs">
                  Nothing due today. Check back after your next lecture.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Link
                    href="/history"
                    className="px-5 py-2.5 rounded-2xl dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.09] border-black/[0.14] text-[14px] font-medium text-gray-600 hover:dark:text-white text-gray-900 hover:dark:bg-white/[0.08] bg-[#EFEDE7] transition-all"
                  >
                    Browse sessions
                  </Link>
                  <button
                    onClick={openBrowse}
                    className="px-5 py-2.5 rounded-2xl dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.09] border-black/[0.14] text-[14px] font-medium text-gray-600 hover:dark:text-white text-gray-900 hover:dark:bg-white/[0.08] bg-[#EFEDE7] transition-all"
                  >
                    Browse all cards
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-2xl dark:bg-white/[0.04] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.16] flex items-center justify-center mb-1">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-gray-600">
                    <rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
                  </svg>
                </div>
                <p className="text-[22px] font-bold">No flashcards yet</p>
                <p className="text-gray-700 text-[14px] leading-relaxed max-w-xs">
                  Record or import a lecture — every term Demist detects becomes a flashcard automatically.
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Link
                    href="/dashboard"
                    className="px-5 py-2.5 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold transition-all active:scale-[0.97]"
                  >
                    Start recording
                  </Link>
                  <Link
                    href="/import"
                    className="px-5 py-2.5 rounded-2xl dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.09] border-black/[0.14] text-[14px] font-medium dark:text-gray-300 text-gray-700 hover:dark:bg-white/[0.08] bg-[#EFEDE7] transition-all"
                  >
                    Import a file
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="flex-1 flex flex-col px-4 sm:px-6 py-6 overflow-y-auto">
          <div className="w-full max-w-md mx-auto flex flex-col gap-5">

            <div className="flex flex-col items-center text-center gap-1 animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '0ms' }}>
              <p className="text-[22px] font-bold">Session done</p>
              <p className="text-gray-700 text-[14px]">
                {reviewed} card{reviewed !== 1 ? 's' : ''} reviewed
              </p>
            </div>

            {streak > 0 && (
              <div className="flex flex-col items-center gap-1 dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl py-5 animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '80ms' }}>
                <p className="text-[40px] font-bold leading-none dark:text-amber-400 text-amber-600 tabular-nums">{displayStreak}</p>
                <p className="text-[12px] text-gray-600 mt-1">day streak{streak > 1 ? ' going strong' : ''}</p>
              </div>
            )}

            {totalGrades > 0 && (
              <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-5 py-4 animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '160ms' }}>
                <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-3">This session</p>
                <div className="space-y-2.5">
                  {([
                    { label: 'Again', count: gradeCounts[0], cls: 'bg-red-500/50' },
                    { label: 'Hard',  count: gradeCounts[1], cls: 'bg-orange-500/50' },
                    { label: 'Good',  count: gradeCounts[2], cls: 'bg-yellow-500' },
                    { label: 'Easy',  count: gradeCounts[3], cls: 'bg-amber-400' },
                  ]).map(({ label, count, cls }) => (
                    <div key={label} className="flex items-center gap-3">
                      <span className="text-[11px] text-gray-600 w-10 shrink-0">{label}</span>
                      <div className="flex-1 h-2 dark:bg-white/[0.05] bg-black/[0.06] rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${cls}`}
                          style={{ width: `${totalGrades > 0 ? Math.round((count / totalGrades) * 100) : 0}%`, transition: 'width 0.6s cubic-bezier(0.16, 1, 0.3, 1)' }}
                        />
                      </div>
                      <span className="text-[11px] text-gray-600 w-5 text-right tabular-nums shrink-0">{count}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[13px] mt-4 dark:text-white/80 text-gray-700">
                  {goodEasyPct >= 80
                    ? "Strong session. You're retaining this well."
                    : goodEasyPct >= 50
                      ? 'Good progress. A few terms need more practice.'
                      : 'Keep at it. These will click soon.'}
                </p>
              </div>
            )}

            <div className="flex flex-col items-center gap-2 animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '240ms' }}>
              <Link
                href="/dashboard"
                className="w-full text-center px-5 py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150"
              >
                Start a new recording
              </Link>
              <button
                onClick={openBrowse}
                className="w-full px-5 py-3 rounded-2xl dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.09] border-black/[0.14] text-[14px] font-medium dark:text-gray-300 text-gray-700 hover:dark:bg-white/[0.08] active:scale-[0.97] transition-[background-color,transform] duration-150"
              >
                Browse all flashcards
              </button>
            </div>

            {reviewedCards.length > 0 && (
              <div className="animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '320ms' }}>
                <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-3">Cards you just reviewed</p>
                <div className="space-y-2">
                  {reviewedCards.map(c => (
                    <div key={c.id} className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-4 py-3">
                      <p className="text-[14px] font-medium dark:text-white/90 text-gray-900">{c.term}</p>
                      <p className="text-[12px] text-gray-700 mt-1 leading-relaxed">{c.definition}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {phase === 'review' && current && (
        <div className="flex-1 flex flex-col px-4 sm:px-6 pt-4 pb-4">
          {/* Progress bar */}
          <div className="shrink-0 h-1 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full mb-2 overflow-hidden">
            <div
              className="h-full bg-yellow-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Queue breakdown */}
          <div className="shrink-0 flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {dueCount > 0 && (
                <span className="text-[11px] font-medium dark:text-orange-400/80 text-orange-700 dark:bg-orange-500/10 bg-orange-100 dark:border-orange-500/20 border-orange-200 rounded-full px-2 py-0.5">
                  {dueCount} due
                </span>
              )}
              {newCount > 0 && (
                <span className="text-[11px] font-medium dark:text-yellow-400 text-yellow-700/80 bg-yellow-500/10 border border-yellow-500/20 rounded-full px-2 py-0.5">
                  {newCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-gray-600">{reviewed}/{total}</span>
              <button
                onClick={openBrowse}
                className="hidden sm:block text-[12px] text-gray-600 hover:dark:text-white hover:text-gray-900 transition-colors"
              >
                Browse all
              </button>
            </div>
          </div>

          {/* Flip card */}
          <div className="flex-1 flex items-center justify-center">
            <div
              className="flashcard-flip w-full max-w-[380px] cursor-pointer select-none"
              onClick={() => !flipped && setFlipped(true)}
              style={{ perspective: '1000px' }}
            >
              <div
                className="flashcard-inner relative"
                style={{
                  transformStyle: 'preserve-3d',
                  transition: 'transform 0.45s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  minHeight: '220px',
                }}
              >
                {/* Front */}
                <div
                  className="absolute inset-0 dark:bg-[#0d0d1c] bg-gray-50 border dark:border-white/[0.09] border-black/[0.14] rounded-[24px] flex flex-col items-center justify-center p-8"
                  style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
                >
                  {current.isNew ? (
                    <span className="text-[10px] font-bold tracking-[0.18em] dark:text-yellow-400 text-yellow-700/70 bg-yellow-500/10 border border-yellow-500/20 rounded-full px-3 py-1 uppercase mb-4">New</span>
                  ) : (
                    <span className="text-[10px] font-bold tracking-[0.18em] text-gray-700/70 dark:bg-white/[0.04] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-full px-3 py-1 uppercase mb-4">Review</span>
                  )}
                  <p className="text-[26px] font-bold text-center leading-snug">{current.term}</p>
                  {!flipped && (
                    <p className="text-[12px] text-gray-700 mt-6">Tap to reveal definition</p>
                  )}
                </div>

                {/* Back */}
                <div
                  className="absolute inset-0 rounded-[24px] flex flex-col items-center justify-center p-8"
                  style={{
                    backfaceVisibility: 'hidden',
                    WebkitBackfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                    background: 'linear-gradient(160deg, var(--accent-soft) 0%, var(--surface) 100%)',
                    border: '1px solid var(--accent-border)',
                  }}
                >
                  <p className="text-[11px] font-bold tracking-[0.18em] dark:text-yellow-400 text-yellow-700/60 uppercase mb-4">Definition</p>
                  <p className="text-[16px] text-center leading-relaxed" style={{ color: 'var(--fg)' }}>{current.definition}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Rating buttons */}
          {flipped && (
            <>
              <div className="shrink-0 grid grid-cols-4 gap-2 mt-4 animate-step">
                {GRADE_LABELS.map(({ grade, label, ariaLabel, color }) => (
                  <button
                    key={grade}
                    onClick={() => handleGrade(grade)}
                    disabled={saving}
                    aria-label={ariaLabel}
                    className={`py-3 rounded-2xl text-[13px] font-semibold border bg-transparent transition-colors duration-150 active:scale-[0.97] disabled:opacity-40 ${color}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="hidden sm:block shrink-0 text-center text-[11px] text-gray-600 mt-2">
                Press 1–4 to rate · Space to flip
              </p>
              {stuckOnLast && (
                <button
                  onClick={() => setPhase('done')}
                  className="shrink-0 mt-3 w-full text-center text-[13px] text-gray-600 hover:text-gray-600 transition-colors"
                >
                  Done for today →
                </button>
              )}
            </>
          )}

          {!flipped && (
            <div className="shrink-0 mt-4">
              <button
                onClick={() => setFlipped(true)}
                className="w-full py-4 rounded-2xl text-[15px] font-semibold dark:bg-white/[0.06] bg-[#F3F1EC] border dark:border-white/[0.08] border-black/[0.13] dark:text-white text-gray-900 hover:bg-white/[0.09] active:scale-[0.97] transition-colors duration-150"
              >
                Show definition
              </button>
            </div>
          )}
        </div>
      )}
    </main>
  )
}

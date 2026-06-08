'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'

interface Popup {
  term: string
  definition: string | null
  loading: boolean
  saving: boolean
  saved: boolean
  x: number
  y: number
  flipDown: boolean
}

interface TermHint {
  term: string
  definition: string
}

type Segment =
  | { highlight: false; content: string }
  | { highlight: true; content: string; definition: string }

function buildSegments(text: string, terms: TermHint[]): Segment[] {
  if (!terms.length) return [{ highlight: false, content: text }]

  // Longest terms first so "elasticity of demand" matches before "demand"
  const sorted = [...terms].sort((a, b) => b.term.length - a.term.length)
  let segs: Segment[] = [{ highlight: false, content: text }]

  for (const { term, definition } of sorted) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${escaped}\\b`, 'gi')
    const next: Segment[] = []
    for (const seg of segs) {
      if (seg.highlight) { next.push(seg); continue }
      let last = 0
      let m
      while ((m = re.exec(seg.content)) !== null) {
        if (m.index > last) next.push({ highlight: false, content: seg.content.slice(last, m.index) })
        next.push({ highlight: true, content: m[0], definition })
        last = m.index + m[0].length
      }
      if (last < seg.content.length) next.push({ highlight: false, content: seg.content.slice(last) })
    }
    segs = next
  }
  return segs
}

export function TranscriptViewer({
  transcript,
  subject,
  year,
  terms,
  sessionId,
}: {
  transcript: string
  subject: string | null
  year: number | null
  terms?: TermHint[]
  sessionId?: string
}) {
  const [popup, setPopup] = useState<Popup | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const showAt = (term: string, definition: string | null, loading: boolean, el: Element) => {
    const rect = el.getBoundingClientRect()
    const x = Math.min(Math.max(rect.left + rect.width / 2, 140), window.innerWidth - 140)
    const flipDown = rect.top < 140
    const y = flipDown ? rect.bottom : rect.top
    setPopup({ term, definition, loading, saving: false, saved: false, x, y, flipDown })
  }

  const handleTermClick = (term: string, definition: string, e: React.PointerEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    showAt(term, definition, false, e.currentTarget)
  }

  const handlePointerUp = async () => {
    const sel = window.getSelection()
    const text = sel?.toString().trim()
    if (!text || text.length < 2 || text.length > 120) {
      setPopup(null)
      return
    }
    const range = sel!.getRangeAt(0)
    if (!containerRef.current?.contains(range.commonAncestorContainer)) return

    const rect = range.getBoundingClientRect()
    const x = Math.min(Math.max(rect.left + rect.width / 2, 140), window.innerWidth - 140)
    const flipDown = rect.top < 140
    const y = flipDown ? rect.bottom : rect.top
    setPopup({ term: text, definition: null, loading: true, saving: false, saved: false, x, y, flipDown })

    try {
      const supabase = createClient()
      const { data } = await supabase.functions.invoke('detect-terms', {
        body: {
          transcript: text,
          subject: subject ?? 'general',
          year: year ?? 1,
          known_terms: [],
        },
      })
      const def: string | null = data?.terms?.[0]?.definition ?? null
      setPopup(prev => prev ? { ...prev, definition: def, loading: false } : null)
    } catch {
      setPopup(null)
    }
  }

  const saveFlashcard = async () => {
    if (!popup?.definition || !sessionId) return
    setPopup(prev => prev ? { ...prev, saving: true } : null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return
      const term = popup.term.length > 80 ? popup.term.slice(0, 77) + '...' : popup.term
      await supabase.from('terms').insert({
        user_id: user.id,
        session_id: sessionId,
        term,
        definition: popup.definition,
        subject: subject ?? null,
      })
      setPopup(prev => prev ? { ...prev, saving: false, saved: true } : null)
      setTimeout(() => setPopup(null), 1600)
    } catch {
      setPopup(prev => prev ? { ...prev, saving: false } : null)
    }
  }

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setPopup(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const segments = buildSegments(transcript, terms ?? [])

  return (
    <div ref={containerRef} className="relative">
      <p
        className="text-[13px] text-gray-500 leading-relaxed select-text cursor-text whitespace-pre-wrap"
        onPointerUp={handlePointerUp}
      >
        {segments.map((seg, i) =>
          seg.highlight ? (
            <span
              key={i}
              className="text-amber-400/80 underline decoration-amber-500/40 decoration-dotted underline-offset-2 cursor-pointer"
              onPointerUp={e => handleTermClick(seg.content, seg.definition, e)}
            >
              {seg.content}
            </span>
          ) : (
            seg.content
          )
        )}
      </p>

      {popup && (
        <div
          className="fixed z-[100] w-[260px] bg-[#0e0e1c] border border-amber-500/25 rounded-xl px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.7)]"
          style={{
            left: popup.x,
            top: popup.flipDown ? popup.y + 8 : popup.y - 8,
            transform: popup.flipDown ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
          onMouseDown={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
        >
          <p className="text-[10px] font-bold tracking-[0.15em] text-amber-400/60 uppercase mb-1.5 truncate">
            {popup.term}
          </p>
          {popup.loading ? (
            <p className="text-[12px] text-gray-600">Looking up...</p>
          ) : popup.definition ? (
            <>
              <p className="text-[12px] text-gray-400 leading-relaxed mb-2.5">{popup.definition}</p>
              {sessionId && (
                <button
                  onClick={saveFlashcard}
                  disabled={popup.saving || popup.saved}
                  className="w-full text-[12px] font-medium py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 hover:text-amber-300 transition-all disabled:opacity-50"
                >
                  {popup.saved ? 'Saved to flashcards ✓' : popup.saving ? 'Saving...' : '+ Save as flashcard'}
                </button>
              )}
            </>
          ) : (
            <p className="text-[12px] text-gray-600">No definition found.</p>
          )}
        </div>
      )}
    </div>
  )
}

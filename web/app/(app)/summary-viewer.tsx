'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'

const POPUP_WIDTH = 280
const POPUP_HALF  = POPUP_WIDTH / 2
const EXPLAIN_TIMEOUT_MS = 10_000

interface Popup {
  text: string
  explanation: string | null
  loading: boolean
  saving: boolean
  saved: boolean
  x: number
  y: number
}

export function SummaryViewer({
  synopsis,
  sessionId,
  subject,
  year,
}: {
  synopsis: string
  sessionId: string
  subject: string | null
  year: number | null
}) {
  const [popup, setPopup] = useState<Popup | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handlePointerUp = async () => {
    const sel = window.getSelection()
    const text = sel?.toString().trim()
    if (!text || text.length < 3 || text.length > 400) {
      setPopup(null)
      return
    }
    const range = sel!.getRangeAt(0)
    if (!containerRef.current?.contains(range.commonAncestorContainer)) return

    const rect = range.getBoundingClientRect()
    // Clamp x so the 280px popup never clips off either edge (8px screen margin)
    const rawX = rect.left + rect.width / 2
    const x = Math.min(Math.max(rawX, POPUP_HALF + 8), window.innerWidth - POPUP_HALF - 8)

    setPopup({ text, explanation: null, loading: true, saving: false, saved: false, x, y: rect.top })

    // Cancel any in-flight timeout from a previous selection
    if (abortRef.current) clearTimeout(abortRef.current)

    // Auto-dismiss if detection hangs
    abortRef.current = setTimeout(() => {
      setPopup(prev => prev?.loading ? { ...prev, loading: false, explanation: null } : prev)
    }, EXPLAIN_TIMEOUT_MS)

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
      const explanation: string | null = data?.terms?.[0]?.definition ?? null
      setPopup(prev => prev ? { ...prev, explanation, loading: false } : null)
    } catch {
      setPopup(prev => prev ? { ...prev, loading: false, explanation: null } : null)
    } finally {
      if (abortRef.current) { clearTimeout(abortRef.current); abortRef.current = null }
    }
  }

  const saveFlashcard = async () => {
    if (!popup?.explanation || popup.saving) return
    setPopup(prev => prev ? { ...prev, saving: true } : null)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const term = popup.text.length > 80 ? popup.text.slice(0, 77) + '...' : popup.text
      await supabase.from('terms').insert({
        user_id: user.id,
        session_id: sessionId,
        term,
        definition: popup.explanation,
        subject: subject ?? null,
      })
      setPopup(prev => prev ? { ...prev, saving: false, saved: true } : null)
      setTimeout(() => setPopup(null), 1600)
    } catch {
      setPopup(prev => prev ? { ...prev, saving: false } : null)
    }
  }

  // Close popup when clicking outside
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setPopup(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => () => { if (abortRef.current) clearTimeout(abortRef.current) }, [])

  return (
    <div ref={containerRef} className="relative">
      <p
        className="text-[13px] text-gray-500 leading-relaxed select-text cursor-text"
        onPointerUp={handlePointerUp}
      >
        {synopsis}
      </p>
      <p className="text-[11px] text-gray-700 mt-1.5 select-none">
        Select any text to explain or save as a flashcard
      </p>

      {popup && (
        <div
          role="dialog"
          aria-label="Term explanation"
          className="fixed z-[100] bg-[#0e0e1c] border border-amber-500/25 rounded-xl px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.7)]"
          style={{
            width: POPUP_WIDTH,
            left: popup.x,
            top: popup.y - 10,
            transform: 'translate(-50%, -100%)',
          }}
          onMouseDown={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <p className="text-[10px] font-bold tracking-[0.15em] text-amber-400/60 uppercase line-clamp-2 leading-snug flex-1">
              {popup.text}
            </p>
            <button
              onClick={() => setPopup(null)}
              aria-label="Close"
              className="text-gray-700 hover:text-gray-400 transition-colors shrink-0 leading-none text-[18px] -mt-0.5"
            >
              ×
            </button>
          </div>

          {popup.loading ? (
            <p className="text-[12px] text-gray-600" aria-live="polite">Explaining…</p>
          ) : popup.explanation ? (
            <>
              <p className="text-[12px] text-gray-400 leading-relaxed mb-2.5">{popup.explanation}</p>
              <button
                onClick={saveFlashcard}
                disabled={popup.saving || popup.saved}
                className="w-full text-[12px] font-medium py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 hover:text-amber-300 transition-all disabled:opacity-50"
              >
                {popup.saved ? 'Saved ✓' : popup.saving ? 'Saving…' : '+ Save as flashcard'}
              </button>
            </>
          ) : (
            <p className="text-[12px] text-gray-600">Nothing to explain here.</p>
          )}
        </div>
      )}
    </div>
  )
}

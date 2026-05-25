'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'

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
    const x = Math.min(Math.max(rect.left + rect.width / 2, 150), window.innerWidth - 150)
    setPopup({ text, explanation: null, loading: true, saving: false, saved: false, x, y: rect.top })

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
      setPopup(null)
    }
  }

  const saveFlashcard = async () => {
    if (!popup?.explanation) return
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

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setPopup(null)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  return (
    <div ref={containerRef} className="relative">
      <p
        className="text-[13px] text-gray-500 leading-relaxed select-text cursor-text"
        onPointerUp={handlePointerUp}
      >
        {synopsis}
      </p>
      <p className="text-[11px] text-gray-700 mt-1.5 select-none">Select any text to explain or save as a flashcard</p>

      {popup && (
        <div
          className="fixed z-[100] w-[280px] bg-[#0e0e1c] border border-violet-500/25 rounded-xl px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.7)]"
          style={{ left: popup.x, top: popup.y - 10, transform: 'translate(-50%, -100%)' }}
          onMouseDown={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
        >
          <p className="text-[10px] font-bold tracking-[0.15em] text-violet-400/60 uppercase mb-1.5 line-clamp-2 leading-snug">
            {popup.text}
          </p>
          {popup.loading ? (
            <p className="text-[12px] text-gray-600">Explaining...</p>
          ) : popup.explanation ? (
            <>
              <p className="text-[12px] text-gray-400 leading-relaxed mb-2.5">{popup.explanation}</p>
              <button
                onClick={saveFlashcard}
                disabled={popup.saving || popup.saved}
                className="w-full text-[12px] font-medium py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-400 hover:text-violet-300 transition-all disabled:opacity-50"
              >
                {popup.saved ? 'Saved to flashcards ✓' : popup.saving ? 'Saving...' : '+ Save as flashcard'}
              </button>
            </>
          ) : (
            <p className="text-[12px] text-gray-600">Nothing found to explain.</p>
          )}
        </div>
      )}
    </div>
  )
}

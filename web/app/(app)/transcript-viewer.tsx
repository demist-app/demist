'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'

interface Popup {
  term: string
  definition: string | null
  loading: boolean
  x: number
  y: number
}

export function TranscriptViewer({
  transcript,
  subject,
  year,
}: {
  transcript: string
  subject: string | null
  year: number | null
}) {
  const [popup, setPopup] = useState<Popup | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

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

    setPopup({ term: text, definition: null, loading: true, x, y: rect.top })

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
        className="text-[13px] text-gray-500 leading-relaxed select-text cursor-text whitespace-pre-wrap"
        onPointerUp={handlePointerUp}
      >
        {transcript}
      </p>

      {popup && (
        <div
          className="fixed z-[100] w-[260px] bg-[#0e0e1c] border border-violet-500/25 rounded-xl px-4 py-3 shadow-[0_8px_32px_rgba(0,0,0,0.7)]"
          style={{ left: popup.x, top: popup.y - 10, transform: 'translate(-50%, -100%)' }}
          onMouseDown={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
        >
          <p className="text-[10px] font-bold tracking-[0.15em] text-violet-400/60 uppercase mb-1.5 truncate">
            {popup.term}
          </p>
          {popup.loading ? (
            <p className="text-[12px] text-gray-600">Looking up...</p>
          ) : popup.definition ? (
            <p className="text-[12px] text-gray-400 leading-relaxed">{popup.definition}</p>
          ) : (
            <p className="text-[12px] text-gray-600">No definition found.</p>
          )}
        </div>
      )}
    </div>
  )
}

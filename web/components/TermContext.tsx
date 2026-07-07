'use client'

// Wraps a glossary/flashcard term. Hover (desktop) or tap (mobile) reveals the
// sentence the term appeared in, with the term emphasised. Same component, both inputs.

import { useState, useRef, useCallback } from 'react'

export function TermContext({
  term,
  definition,
  context,
  translation,
  children,
}: {
  term: string
  definition: string
  context?: string | null
  translation?: string | null
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }, [])
  const hideSoon = useCallback(() => {
    closeTimer.current = setTimeout(() => setOpen(false), 120)
  }, [])

  const highlighted = context
    ? context.split(new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'))
        .map((part, i) =>
          part.toLowerCase() === term.toLowerCase()
            ? <mark key={i} className="bg-amber-500/25 dark:text-amber-200 text-amber-800 rounded px-0.5">{part}</mark>
            : <span key={i}>{part}</span>
        )
    : null

  return (
    <span
      className="relative inline-block"
      onMouseEnter={show}
      onMouseLeave={hideSoon}
      onClick={() => setOpen(o => !o)}
    >
      <span className="cursor-help underline decoration-dotted decoration-amber-500/50 underline-offset-2">
        {children}
      </span>
      {open && (
        <span
          className="absolute z-50 left-0 top-full mt-1.5 w-[280px] dark:bg-[#0d0d1c] bg-[#FDFCF9] border dark:border-white/[0.1] border-black/[0.12] rounded-2xl p-3.5 shadow-xl text-left"
          onMouseEnter={show}
          onMouseLeave={hideSoon}
        >
          <span className="block text-[13px] font-semibold dark:text-white text-gray-900 mb-1">{term}</span>
          <span className="block text-[12px] dark:text-white/70 text-gray-700 leading-relaxed">{definition}</span>
          {translation && (
            <span className="block text-[12px] dark:text-amber-300 text-amber-700 leading-relaxed mt-1.5">{translation}</span>
          )}
          {highlighted && (
            <span className="block text-[11px] dark:text-white/50 text-gray-500 leading-relaxed mt-2 pt-2 border-t dark:border-white/[0.08] border-black/[0.08] italic">
              {highlighted}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

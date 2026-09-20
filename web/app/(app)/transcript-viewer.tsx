'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createClient } from '@/lib/supabase'
import { explainSelection, ExplainUnavailableError } from '@/lib/explainSelection'
import { capture, reportWriteFailure } from '@/lib/analytics'
import { useReadAloud } from '@/lib/readAloud'

interface Popup {
  term: string
  definition: string | null
  context?: string | null
  unavailable?: boolean
  saveFailed?: boolean
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
  context?: string | null
}

type Segment =
  | { highlight: false; content: string }
  | { highlight: true; content: string; definition: string; context?: string | null }

function buildSegments(text: string, terms: TermHint[]): Segment[] {
  if (!terms.length) return [{ highlight: false, content: text }]

  // Longest terms first so "elasticity of demand" matches before "demand"
  const sorted = [...terms].sort((a, b) => b.term.length - a.term.length)
  let segs: Segment[] = [{ highlight: false, content: text }]

  for (const { term, definition, context } of sorted) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\b${escaped}\\b`, 'gi')
    const next: Segment[] = []
    for (const seg of segs) {
      if (seg.highlight) { next.push(seg); continue }
      let last = 0
      let m
      while ((m = re.exec(seg.content)) !== null) {
        if (m.index > last) next.push({ highlight: false, content: seg.content.slice(last, m.index) })
        next.push({ highlight: true, content: m[0], definition, context })
        last = m.index + m[0].length
      }
      if (last < seg.content.length) next.push({ highlight: false, content: seg.content.slice(last) })
    }
    segs = next
  }
  return segs
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).filter(s => s.trim())
}

export function TranscriptViewer({
  transcript,
  subject,
  year,
  terms,
  sessionId,
  translation,
  translationLang,
}: {
  transcript: string
  subject: string | null
  year: number | null
  terms?: TermHint[]
  sessionId?: string
  translation?: string | null
  translationLang?: string | null
}) {
  const [popup, setPopup] = useState<Popup | null>(null)
  const [bilingual, setBilingual] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const readAloud = useReadAloud(transcript)

  const showAt = (term: string, definition: string | null, loading: boolean, el: Element, context?: string | null) => {
    const rect = el.getBoundingClientRect()
    const x = Math.min(Math.max(rect.left + rect.width / 2, 140), window.innerWidth - 140)
    const flipDown = rect.top < 140
    const y = flipDown ? rect.bottom : rect.top
    setPopup({ term, definition, context, loading, saving: false, saved: false, x, y, flipDown })
  }

  const handleTermClick = (term: string, definition: string, context: string | null | undefined, e: React.PointerEvent<HTMLSpanElement>) => {
    e.stopPropagation()
    showAt(term, definition, false, e.currentTarget, context)
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
      const def = await explainSelection(text, subject ?? null, year ?? null)
      setPopup(prev => prev ? { ...prev, definition: def, loading: false } : null)
    } catch (e) {
      // Dismissing the popup on failure made this the most silent surface of
      // all: tapping a word did nothing at all, indistinguishable from a
      // missed tap. Keep it open and say what happened.
      const unavailable = e instanceof ExplainUnavailableError
      setPopup(prev => prev ? { ...prev, definition: null, unavailable, loading: false } : null)
    }
  }

  const speakPopup = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window) || !popup) return
    const parts = [popup.term, popup.context, popup.definition].filter(Boolean) as string[]
    if (!parts.length) return
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(parts.join('. ')))
  }

  const copyTranscript = async () => {
    const text = bilingual && translation ? `${transcript}

---

${translation}` : transcript
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      capture('transcript_copied', { chars: text.length, bilingual: bilingual && !!translation })
      setTimeout(() => setCopied(false), 1600)
    } catch (e) {
      // Clipboard access can be refused outright (insecure context, Safari
      // without a user gesture, a locked-down school device). Say so rather
      // than leaving the button looking like it worked.
      console.error('copy transcript failed:', e)
      setCopyError(true)
      setTimeout(() => setCopyError(false), 2400)
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
      // A Supabase mutation resolves with { error }; it does not throw. So the
      // catch below never fired on a real failure and "Saved to flashcards ✓"
      // appeared for a card that was never written.
      const { error } = await supabase.from('terms').insert({
        user_id: user.id,
        session_id: sessionId,
        term,
        definition: popup.definition,
        subject: subject ?? null,
      })
      if (reportWriteFailure('term.save_from_transcript', error)) {
        setPopup(prev => prev ? { ...prev, saving: false, saveFailed: true } : null)
        return
      }
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
  const active = readAloud.activeSentence >= 0 ? readAloud.sentences[readAloud.activeSentence] : null
  const activeRange = active ? { start: active.start, end: active.start + active.text.length } : null

  let charOffset = 0

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 mb-2.5">
          {readAloud.supported && (
            <button
              onClick={() => (readAloud.speaking ? (readAloud.paused ? readAloud.resume() : readAloud.pause()) : readAloud.play())}
              className="flex items-center gap-1.5 text-[12px] font-medium text-amber-400 hover:text-amber-300 bg-amber-500/10 hover:bg-amber-500/15 rounded-full px-3 py-1.5 transition-colors"
            >
              {readAloud.speaking && !readAloud.paused ? '⏸ Pause' : readAloud.paused ? '▶ Resume' : '▶ Read aloud'}
            </button>
          )}
          {readAloud.supported && readAloud.speaking && (
            <button
              onClick={readAloud.stop}
              className="text-[12px] text-gray-600 hover:text-gray-400 transition-colors"
            >
              Stop
            </button>
          )}
          {translation && (
            <button
              onClick={() => setBilingual(b => !b)}
              className={`flex items-center gap-1.5 text-[12px] font-medium rounded-full px-3 py-1.5 transition-colors ${
                bilingual ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-500/10 hover:bg-amber-500/15 text-amber-400 hover:text-amber-300'
              }`}
            >
              Bilingual
            </button>
          )}
          {/* Free for everyone, deliberately. Anki export is the Pro feature;
              getting your own words out of the app is not, and a note-taking
              tool you cannot copy out of is worth very little. The closest
              competitor's only public review is one star for exactly this. */}
          <button
            onClick={copyTranscript}
            className="ml-auto flex items-center gap-1.5 text-[12px] font-medium rounded-full px-3 py-1.5 transition-colors dark:text-gray-400 text-gray-600 dark:hover:text-white hover:text-gray-900 dark:bg-white/[0.05] bg-black/[0.04] dark:hover:bg-white/[0.09] hover:bg-black/[0.07]"
          >
            {copyError ? "Couldn't copy" : copied ? 'Copied ✓' : 'Copy transcript'}
          </button>
        </div>

      {bilingual && translation ? (
        <div className="space-y-2.5">
          {splitSentences(transcript).map((sentence, i) => {
            const segs = buildSegments(sentence, terms ?? [])
            const tgt = splitSentences(translation)[i]
            return (
              <div key={i} className="space-y-0.5">
                <p
                  className="text-[calc(0.8125rem*var(--df-scale))] text-gray-500 leading-relaxed select-text cursor-text"
                  onPointerUp={handlePointerUp}
                >
                  {segs.map((seg, j) => seg.highlight ? (
                    <span
                      key={j}
                      className="text-amber-400/80 underline decoration-amber-500/40 decoration-dotted underline-offset-2 cursor-pointer"
                      onPointerUp={e => handleTermClick(seg.content, seg.definition, seg.context, e)}
                    >
                      {seg.content}
                    </span>
                  ) : (
                    <span key={j}>{seg.content}</span>
                  ))}
                </p>
                <p
                  dir={translationLang === 'ar' ? 'rtl' : undefined}
                  className="text-[calc(0.8125rem*var(--df-scale))] leading-relaxed dark:text-amber-300/80 text-amber-700"
                >
                  {tgt ?? ''}
                </p>
              </div>
            )
          })}
          {splitSentences(translation).slice(splitSentences(transcript).length).map((extra, i) => (
            <p
              key={`extra-${i}`}
              dir={translationLang === 'ar' ? 'rtl' : undefined}
              className="text-[calc(0.8125rem*var(--df-scale))] leading-relaxed dark:text-amber-300/80 text-amber-700"
            >
              {extra}
            </p>
          ))}
        </div>
      ) : (
        <p
          className="text-[calc(0.8125rem*var(--df-scale))] text-gray-500 leading-relaxed select-text cursor-text whitespace-pre-wrap"
          onPointerUp={handlePointerUp}
        >
          {segments.map((seg, i) => {
            const segStart = charOffset
            charOffset += seg.content.length
            const isSpoken = !!activeRange && segStart < activeRange.end && segStart + seg.content.length > activeRange.start
            const spokenClass = isSpoken ? 'bg-amber-500/20 rounded' : ''
            return seg.highlight ? (
              <span
                key={i}
                className={`text-amber-400/80 underline decoration-amber-500/40 decoration-dotted underline-offset-2 cursor-pointer ${spokenClass}`}
                onPointerUp={e => handleTermClick(seg.content, seg.definition, seg.context, e)}
              >
                {seg.content}
              </span>
            ) : (
              <span key={i} className={spokenClass}>{seg.content}</span>
            )
          })}
        </p>
      )}

      {popup && createPortal(
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
          <div className="flex items-start justify-between gap-2 mb-1.5">
            <p className="text-[10px] font-bold tracking-[0.15em] text-amber-400/60 uppercase truncate">
              {popup.term}
            </p>
            {!popup.loading && (popup.definition || popup.context) && readAloud.supported && (
              <button
                onClick={speakPopup}
                aria-label="Read aloud"
                title="Read term, sentence, and definition aloud"
                className="shrink-0 text-amber-400/70 hover:text-amber-300 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                </svg>
              </button>
            )}
          </div>
          {popup.loading ? (
            <p className="text-[12px] text-gray-600">Looking up...</p>
          ) : popup.definition ? (
            <>
              <p className="text-[12px] text-gray-400 leading-relaxed mb-2.5">{popup.definition}</p>
              {popup.context && (
                <p className="text-[11px] text-gray-600 leading-relaxed mb-2.5 pb-2.5 border-b border-white/[0.08] italic">
                  {popup.context}
                </p>
              )}
              {sessionId && (
                <button
                  onClick={saveFlashcard}
                  disabled={popup.saving || popup.saved}
                  className="w-full text-[12px] font-medium py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 hover:text-amber-300 transition-all disabled:opacity-50"
                >
                  {popup.saveFailed ? "Couldn't save, tap to retry" : popup.saved ? 'Saved to flashcards ✓' : popup.saving ? 'Saving...' : '+ Save as flashcard'}
                </button>
              )}
            </>
          ) : (
            <p className="text-[12px] text-gray-600">
              {popup.unavailable
                ? "Can't reach the definition service right now. This isn't your connection - try again later."
                : "Couldn't fetch an explanation. Try again."}
            </p>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

'use client'

// A small "read this out" button for short texts: a term card, a flashcard, a
// session summary. Uses the browser's own speech (free, runs on the device),
// like the transcript's read-back in lib/readAloud.ts, which handles the
// long-form case with sentence highlighting.
//
// Only one thing speaks at a time: starting here cancels anything already
// playing, and every button listens for that so its icon stays truthful.

import { useEffect, useState } from 'react'

const EVENT = 'demist-read-aloud'

export function ReadAloudButton({ text, label = 'Read aloud', className = '' }: { text: string; label?: string; className?: string }) {
  const [speaking, setSpeaking] = useState(false)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    setSupported('speechSynthesis' in window)
    // Another button started speaking: this one is no longer the voice.
    const onOther = (e: Event) => { if ((e as CustomEvent).detail !== text) setSpeaking(false) }
    window.addEventListener(EVENT, onOther)
    return () => window.removeEventListener(EVENT, onOther)
  }, [text])

  // Leaving the screen mid-sentence should not keep talking.
  useEffect(() => () => { if (speaking) window.speechSynthesis?.cancel() }, [speaking])

  if (!supported || !text.trim()) return null

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    const synth = window.speechSynthesis
    if (speaking) { synth.cancel(); setSpeaking(false); return }
    synth.cancel()
    window.dispatchEvent(new CustomEvent(EVENT, { detail: text }))
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'en-GB'
    u.rate = 0.95
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    setSpeaking(true)
    synth.speak(u)
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={speaking ? 'Stop reading' : label}
      aria-pressed={speaking}
      className={`inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors dark:text-white/60 text-gray-600 dark:hover:text-brand-300 hover:text-brand-700 ${className}`}
    >
      {speaking ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      )}
      {speaking ? 'Stop' : 'Listen'}
    </button>
  )
}

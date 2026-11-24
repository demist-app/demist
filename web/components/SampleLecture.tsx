'use client'

// "See it work": a 30-second sample lecture, for people who have not recorded
// one yet.
//
// WHY (2026-11-24). 49 of 83 new people made a first recording of under two
// minutes, talking at their laptop to see what would happen. 6 of them saw a
// word explained, and 7 came back another day. People whose first recording
// was a real lecture came back twelve times out of twenty-nine. A test that
// shows nothing looks like an app that does nothing, so this shows what a
// lecture looks like, with no microphone involved.
//
// Written by us and clearly labelled a sample: nothing here is detected live,
// nothing is saved, and it makes no claim beyond what Demist does.

import { useEffect, useRef, useState } from 'react'
import { capture } from '@/lib/analytics'
import { notesEngine } from '@/lib/makeNotes'

const LINES: { at: number; text: string }[] = [
  { at: 0.4, text: 'Okay, so last week we looked at how the older model explains memory.' },
  { at: 4, text: 'Today we are moving on to working memory, from Baddeley and Hitch in 1974.' },
  { at: 8, text: 'The central executive decides what you pay attention to, but it doesn’t store anything itself.' },
  { at: 13, text: 'The phonological loop deals with sound, so it is what you use when you repeat a number in your head.' },
  { at: 18, text: 'And if you stop people rehearsing, with articulatory suppression, that advantage disappears.' },
  { at: 23, text: 'Right, the essay is due on the 12th of December, and it goes through Turnitin.' },
]
const CARDS: { at: number; term: string; def: string }[] = [
  { at: 10, term: 'Central executive', def: 'The part of working memory that controls attention and decides what to focus on.' },
  { at: 15, term: 'Phonological loop', def: 'The part of working memory that briefly holds sounds and words, like an inner voice.' },
  { at: 20, term: 'Articulatory suppression', def: 'Saying something over and over so you cannot silently rehearse what you are trying to remember.' },
]
const NOTES_AT = 27
const END_AT = 30
const NOTES: { heading: string; points: string[] }[] = [
  { heading: 'Working memory', points: ['Proposed by Baddeley and Hitch in 1974, after the older model of memory.', 'The central executive decides what you pay attention to. It does not store anything itself.', 'The phonological loop deals with sound, for example repeating a number in your head.'] },
]
const REMINDER = 'The essay is due on the 12th of December, and it goes through Turnitin.'

export function SampleLecture({ source, onClose, onRecord }: { source: string; onClose: () => void; onRecord?: () => void }) {
  const [t, setT] = useState(0)
  const startRef = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const showNotes = t >= NOTES_AT

  useEffect(() => {
    capture('sample_lecture_started', { source })
    startRef.current = Date.now()
    // A timer rather than animation frames: it must keep time when the window
    // is not on top, and four updates a second is plenty.
    const id = setInterval(() => {
      const s = (Date.now() - startRef.current) / 1000
      setT(s)
      if (s >= END_AT) { clearInterval(id); capture('sample_lecture_finished', { source }) }
    }, 250)
    return () => clearInterval(id)
  }, [source])

  const lines = LINES.filter(l => l.at <= t)
  const cards = CARDS.filter(c => c.at <= t)
  const card = cards[cards.length - 1]
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }) }, [lines.length])

  const skip = () => { startRef.current = Date.now() - NOTES_AT * 1000; setT(NOTES_AT); capture('sample_lecture_skipped', { source }) }
  const close = () => { capture('sample_lecture_closed', { source, seconds: Math.round(t) }); onClose() }

  return (
    <div className="fixed inset-0 z-[65] flex items-end sm:items-center justify-center sm:px-4 bg-black/30" style={{ backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }} role="dialog" aria-modal="true" aria-label="Sample lecture">
      <div className="w-full max-w-lg dark:bg-[#181121] bg-[#FFFFFF] border dark:border-white/[0.08] border-black/[0.10] rounded-t-[24px] sm:rounded-[24px] shadow-2xl px-5 sm:px-6 py-6 max-h-[92dvh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase dark:text-brand-400/70 text-brand-700/80 mb-1">Sample lecture</p>
            <p className="text-[18px] font-bold dark:text-white text-gray-900">{showNotes ? 'And when it ends' : 'While the lecturer is talking'}</p>
          </div>
          <button onClick={close} aria-label="Close" className="text-gray-500 hover:dark:text-white/60 hover:text-gray-900 text-[22px] leading-none transition-colors shrink-0">×</button>
        </div>
        <div className="h-1 rounded-full dark:bg-white/[0.06] bg-[#ECE8F4] mb-4 overflow-hidden" aria-hidden>
          <div className="h-full bg-brand-600 transition-[width] duration-300" style={{ width: `${Math.min(100, (t / END_AT) * 100)}%` }} />
        </div>

        {!showNotes ? (
          <>
            <div ref={listRef} className="h-44 overflow-y-auto space-y-2 pr-1" aria-live="polite">
              {lines.map((l, i) => (
                <p key={l.at} className={`text-[calc(0.9375rem*var(--df-scale))] leading-relaxed transition-colors ${i === lines.length - 1 ? 'dark:text-white text-gray-900' : 'dark:text-white/50 text-gray-500'}`}>{l.text}</p>
              ))}
            </div>
            <div className="min-h-[104px] mt-4">
              {card && (
                <div key={card.term} className="rounded-2xl border dark:border-brand-500/25 border-brand-200 dark:bg-brand-500/[0.07] bg-brand-50/70 px-4 py-3 animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
                  <p className="text-[15px] font-semibold dark:text-white text-gray-900">{card.term}</p>
                  <p className="text-[13px] dark:text-white/70 text-gray-700 leading-relaxed mt-0.5">{card.def}</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border dark:border-white/[0.08] border-black/[0.08] dark:bg-white/[0.03] bg-[#F8F6FB] px-4 py-3">
              {!notesEngine() && (
                <ul className="list-disc pl-5 space-y-1 marker:text-brand-500/60">
                  {CARDS.map(c => <li key={c.term} className="text-[13px] dark:text-white/75 text-gray-800 leading-relaxed"><span className="font-semibold">{c.term}</span>: {c.def}</li>)}
                </ul>
              )}
              {notesEngine() && NOTES.map(s => (
                <div key={s.heading}>
                  <p className="text-[14px] font-semibold dark:text-white/90 text-gray-900 mb-1">Notes: {s.heading}</p>
                  <ul className="list-disc pl-5 space-y-1 marker:text-brand-500/60">
                    {s.points.map(p => <li key={p} className="text-[13px] dark:text-white/75 text-gray-800 leading-relaxed">{p}</li>)}
                  </ul>
                </div>
              ))}
              {notesEngine() && (
                <>
                  <p className="text-[12px] font-semibold dark:text-brand-300 text-brand-700 mt-3">In the lecturer&rsquo;s words</p>
                  <p className="text-[13px] dark:text-white/75 text-gray-800 leading-relaxed">{REMINDER}</p>
                </>
              )}
            </div>
            <p className="text-[13px] dark:text-white/60 text-gray-600 leading-relaxed">
              In a real lecture those three words would already be flashcards. Demist finds words in real teaching, so a quick test of everyday talking often shows nothing.
            </p>
          </div>
        )}

        <div className="flex gap-2 mt-5">
          {!showNotes ? (
            <button onClick={skip} className="flex-1 py-3 rounded-2xl dark:bg-white/[0.04] bg-[#F1EEF7] border dark:border-white/[0.07] border-black/[0.12] text-[14px] font-medium dark:text-gray-300 text-gray-700 active:scale-[0.97] transition-all">
              Skip to the end
            </button>
          ) : (
            <>
              <button onClick={close} className="flex-1 py-3 rounded-2xl dark:bg-white/[0.04] bg-[#F1EEF7] border dark:border-white/[0.07] border-black/[0.12] text-[14px] font-medium dark:text-gray-300 text-gray-700 active:scale-[0.97] transition-all">
                Close
              </button>
              {onRecord && (
                <button onClick={() => { capture('sample_lecture_record_clicked', { source }); onRecord() }} className="flex-1 py-3 rounded-2xl bg-brand-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150">
                  Record a lecture
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

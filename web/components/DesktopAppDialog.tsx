'use client'

// Shown on Windows when someone presses record in the BROWSER (2026-10-02).
// The desktop app is where lectures should be recorded: it runs on the
// student's own computer, so it costs nothing per hour, never hits the cloud
// transcription limits a whole class recording at once would, and keeps the
// audio local. The corner InstallPrompt is easy to miss; this is the moment
// the choice actually matters.
//
// It never blocks. "Record in the browser this time" goes straight on to the
// mic check, so a student who is already in the lecture hall is not stuck.
// The claims below are the same ones InstallPrompt makes; keep them in step,
// and do not add any the desktop app cannot back up.

import { useEffect } from 'react'
import { MS_STORE_URL } from '@/lib/links'
import { capture } from '@/lib/analytics'
import { DemistWaveform } from '@/components/BrandMark'

const POINTS = [
  'Free, with no limit on how much you record',
  'Transcription and term detection run on your own computer',
  'Your lecture audio never leaves it',
]

export function DesktopAppDialog({ onContinueInBrowser, onClose }: {
  onContinueInBrowser: () => void
  onClose: () => void
}) {
  useEffect(() => { capture('desktop_push_shown', { placement: 'record_button' }) }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:px-4 bg-black/30"
      style={{ backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-app-title"
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm dark:bg-[#181121] bg-[#FFFFFF] border dark:border-white/[0.08] border-black/[0.10] rounded-t-[24px] sm:rounded-[24px] shadow-2xl px-6 py-7 animate-step opacity-0"
        style={{ animationFillMode: 'forwards' }}
      >
        <div className="w-12 h-12 rounded-2xl bg-[#EEE9F7] border border-brand-500/25 flex items-center justify-center mb-5">
          <DemistWaveform size={26} />
        </div>

        <p className="text-[10px] font-bold tracking-[0.18em] uppercase dark:text-brand-400/80 text-brand-700 mb-1.5">Windows app</p>
        <h2 id="desktop-app-title" className="text-[19px] font-bold leading-snug dark:text-white text-gray-900 mb-2">
          Record lectures in the Demist app
        </h2>
        <p className="text-[13px] leading-relaxed dark:text-white/60 text-gray-600 mb-5">
          Same account, same glossary and flashcards. Sign in once and everything you have here is there.
        </p>

        <ul className="space-y-2.5 mb-6">
          {POINTS.map(p => (
            <li key={p} className="flex items-start gap-2.5 text-[13px] leading-snug dark:text-white/80 text-gray-800">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-[1px] text-calm" aria-hidden>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {p}
            </li>
          ))}
        </ul>

        <a
          href={MS_STORE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => { capture('ms_store_clicked', { placement: 'record_button_dialog' }); onClose() }}
          className="block w-full text-center py-3.5 rounded-2xl text-[15px] font-semibold text-white active:scale-[0.97] transition-transform"
          style={{ background: 'var(--accent-solid)' }}
        >
          Get it free from the Microsoft Store
        </a>
        <p className="text-[12px] text-center dark:text-white/50 text-gray-600 mt-2.5 mb-4">
          Already installed? Open Demist from your Start menu.
        </p>

        <button
          onClick={() => { capture('desktop_push_continue_web'); onContinueInBrowser() }}
          className="w-full py-3 rounded-2xl text-[14px] font-medium dark:bg-white/[0.04] bg-[#F1EEF7] border dark:border-white/[0.07] border-black/[0.10] dark:text-gray-300 text-gray-700 active:scale-[0.97] transition-all"
        >
          Record in the browser this time
        </button>
      </div>
    </div>
  )
}

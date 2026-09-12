'use client'

// Distinct from PaywallModal: that one is the Pro-plan gate (a waitlist,
// since Pro isn't purchasable yet). This one is the web-trial wall from
// webTrial.ts - there's a real, already-live thing to send someone to here
// (the Windows Store app, the Mac beta), so the CTA is a download link, not
// an email capture.

import { useEffect } from 'react'
import { capture } from '@/lib/analytics'
import { MS_STORE_URL, MAC_SUPPORT_URL } from '@/lib/links'
import type { TrialGateResult } from '@/lib/webTrial'

// Small inline icons, duplicated from landing-client.tsx rather than
// imported from it: that file is a page, not a shared component module, and
// importing a page's internals from a component here would be the wrong
// direction of coupling for two SVGs this small.
function WindowsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M2.4 5.6 10 4.5v7.1H2.4z" />
      <path d="M11.1 4.35 21.6 2.8v8.8h-10.5z" />
      <path d="M2.4 12.6H10v7.1L2.4 18.6z" />
      <path d="M11.1 12.6h10.5v8.8l-10.5-1.55z" />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.416 2.06-1.248 2.76-.832.7-1.813 1.09-2.86.99-.14-1.1.4-2.05 1.23-2.75.83-.7 1.9-1.06 2.878-1z" />
      <path d="M20.5 17.14c-.55 1.27-.81 1.84-1.52 2.96-.99 1.56-2.39 3.5-4.12 3.52-1.54.02-1.94-1-4.02-.99-2.08.01-2.52 1.01-4.06.99-1.73-.02-3.06-1.77-4.05-3.33C.35 16.9-.35 12.24 1.02 9.06c.78-1.82 2.18-2.98 3.71-3 1.47-.02 2.85.99 3.75.99.9 0 2.58-1.22 4.35-1.04.74.03 2.82.3 4.15 2.24-.11.07-2.48 1.45-2.46 4.32.03 3.44 3.02 4.58 3.05 4.6-.03.08-.48 1.63-1.57 2.97z" />
    </svg>
  )
}

export function TrialLimitModal({
  gate,
  onClose,
}: {
  gate: TrialGateResult
  onClose: () => void
}) {
  useEffect(() => {
    capture('web_trial_blocked', { platform: gate.platform })
  }, [gate.platform])

  const isMac = gate.platform === 'mac'
  const href = isMac ? MAC_SUPPORT_URL : MS_STORE_URL
  const external = !isMac

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 dark:bg-black/60 bg-black/30"
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md dark:bg-[#0d0d1c] bg-[#FDFCF9] border dark:border-white/[0.08] border-black/[0.12] rounded-[24px] p-6 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[17px] font-bold dark:text-white text-gray-900 leading-snug">You&apos;ve used your free trial in the browser</p>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:dark:text-white/60 hover:text-gray-900 text-[22px] leading-none shrink-0 mt-[-2px] transition-colors">×</button>
        </div>

        <p className="text-[13px] dark:text-white/60 text-gray-600 leading-relaxed">
          {gate.reason} Your glossary, flashcards and history are still here. The {isMac ? 'Mac' : 'Windows'} app runs entirely on your own machine, so recording, transcription and term detection are unlimited, free, and your audio never leaves your computer.
        </p>

        <a
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          onClick={() => capture(isMac ? 'mac_install_guide_clicked' : 'ms_store_clicked', { placement: 'trial_limit_modal' })}
          className="flex items-center justify-center gap-2.5 py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-all"
        >
          {isMac ? <AppleIcon /> : <WindowsIcon />}
          {isMac ? 'Get the Mac beta' : 'Get it on the Microsoft Store'}
        </a>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-2xl dark:bg-white/[0.04] bg-black/[0.04] border dark:border-white/[0.07] border-black/[0.10] text-[13px] font-medium dark:text-gray-300 text-gray-700 active:scale-[0.97] transition-all"
        >
          Not now
        </button>
      </div>
    </div>
  )
}

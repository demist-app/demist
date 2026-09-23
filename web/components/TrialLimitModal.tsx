'use client'

// The web-trial wall from webTrial.ts: shown when a free user has used their
// browser recordings. Offers both ways to keep going - Pro, which lifts the
// browser cap, and the free desktop app - ordered by which actually works on
// this device (see the component body).

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
  onUpgrade,
}: {
  gate: TrialGateResult
  onClose: () => void
  // Opens Pro checkout. Pro lifts the browser cap (entitlements.ts), so this
  // is a real answer to "I want to keep recording", not an upsell beside it.
  onUpgrade: () => void
}) {
  useEffect(() => {
    capture('web_trial_blocked', { platform: gate.platform })
  }, [gate.platform])

  const isMobile = gate.platform === 'mobile'
  const isMac = gate.platform === 'mac'

  // Which route leads depends on which one actually works on this device,
  // not on which one earns money:
  //
  // - Windows: the free Store app is solid, on-device and unlimited. It leads,
  //   and Pro is offered for people who cannot or would rather not install
  //   (a school laptop, a shared machine).
  // - Mac: the beta is an unsigned .dmg behind a Gatekeeper warning, and as of
  //   2026-09-23 nobody has ever recorded with it (13 install-guide clicks,
  //   0 recordings). Leading with it sends people into a dead end, so Pro leads.
  // - Mobile: a phone cannot install either build, so Pro is the only way to
  //   keep recording on the device in their hand. The laptop apps follow.
  const proLeads = isMac || isMobile

  const goPro = () => {
    capture('trial_wall_pro_clicked', { platform: gate.platform })
    onUpgrade()
  }

  const proButton = (primary: boolean) => (
    <button
      onClick={goPro}
      className={primary
        ? 'w-full py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-all'
        : 'w-full py-3 rounded-2xl text-[14px] font-semibold active:scale-[0.97] transition-all dark:bg-white/[0.06] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.12] dark:text-white text-gray-900'}
    >
      Keep recording in the browser with Pro
    </button>
  )

  const windowsLink = (primary: boolean, placement: string) => (
    <a
      href={MS_STORE_URL}
      target="_blank" rel="noopener noreferrer"
      onClick={() => capture('ms_store_clicked', { placement })}
      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-[13px] font-semibold active:scale-[0.97] transition-all ${primary
        ? 'bg-yellow-600 hover:brightness-110 text-white'
        : 'dark:bg-white/[0.06] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.12] dark:text-white text-gray-900'}`}
    >
      <WindowsIcon />
      {primary ? 'Get the free Windows app' : 'Windows'}
    </a>
  )

  const macLink = (placement: string) => (
    <a
      href={MAC_SUPPORT_URL}
      onClick={() => capture('mac_install_guide_clicked', { placement })}
      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-[13px] font-semibold active:scale-[0.97] transition-all dark:bg-white/[0.06] bg-[#F6F5F2] border dark:border-white/[0.08] border-black/[0.12] dark:text-white text-gray-900"
    >
      <AppleIcon />
      Mac (beta)
    </a>
  )

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
          <p className="text-[17px] font-bold dark:text-white text-gray-900 leading-snug">You&apos;ve used your free recordings in the browser</p>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:dark:text-white/60 hover:text-gray-900 text-[22px] leading-none shrink-0 mt-[-2px] transition-colors">×</button>
        </div>

        <p className="text-[13px] dark:text-white/60 text-gray-600 leading-relaxed">
          {gate.reason} Your glossary, flashcards and history are all still here. There are two ways to keep going:
        </p>

        <ul className="text-[13px] dark:text-white/60 text-gray-600 leading-relaxed space-y-1.5 pl-4 list-disc">
          <li>
            <span className="dark:text-white text-gray-900 font-medium">Pro</span>: keep recording right here in the
            browser with no limit, plus every lecture from your term kept for exams.
          </li>
          <li>
            <span className="dark:text-white text-gray-900 font-medium">The free app</span>: install Demist on a Windows
            or Mac laptop and record as much as you like, with your audio never leaving the computer.
            {isMobile && ' It cannot be installed on a phone.'}
          </li>
        </ul>

        {proLeads ? (
          <div className="space-y-2">
            {proButton(true)}
            <p className="text-[12px] dark:text-white/40 text-gray-500 pt-1">Or install the free app on a laptop:</p>
            <div className="flex gap-2">
              {windowsLink(false, isMobile ? 'trial_limit_modal_mobile' : 'trial_limit_modal')}
              {macLink(isMobile ? 'trial_limit_modal_mobile' : 'trial_limit_modal')}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex">{windowsLink(true, 'trial_limit_modal')}</div>
            {proButton(false)}
          </div>
        )}

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

'use client'

// Desktop-only install nudge, pointing straight at the real native app.
// Mobile isn't prompted at all: the recording flow doesn't really work
// hands-free on a phone screen anyway (you can't have Demist and your notes
// open side by side), and there's no mobile app to send anyone to.
//
// Previously this offered installing the PWA as the primary action, with the
// real desktop app mentioned as a footnote ("still processes via the cloud,
// same as the website... for on-device transcription, get the Windows app").
// That worked against the whole point of pushing people to the on-device
// app: a more "installed"-feeling cloud experience is the opposite of what
// should happen. Dropped entirely - see webTrial.ts for the matching change
// on the recording side (a lifetime cap on web, exempting platforms with no
// desktop app to switch to).

import { useEffect, useState } from 'react'
import { isElectronNative } from '@/lib/electronNative'
import { detectDesktopPlatform, isMobileUA, type DesktopPlatform } from '@/lib/platform'
import { MS_STORE_URL, MAC_SUPPORT_URL } from '@/lib/links'
import { capture } from '@/lib/analytics'

const DISMISS_KEY = 'demist_install_dismissed'

function isStandalone() {
  // A PWA installed before this change (or via the browser's own generic
  // "install this site" affordance, which this component doesn't control)
  // still shouldn't get nagged to install something it's already running
  // inside.
  return window.matchMedia('(display-mode: standalone)').matches
}

export function InstallPrompt() {
  const [platform, setPlatform] = useState<DesktopPlatform>(null)

  useEffect(() => {
    // Already the real native app: nothing to nudge.
    if (isElectronNative()) return
    if (isMobileUA() || isStandalone() || sessionStorage.getItem(DISMISS_KEY)) return
    setPlatform(detectDesktopPlatform())
  }, [])

  const dismiss = () => {
    setPlatform(null)
    sessionStorage.setItem(DISMISS_KEY, '1')
  }

  if (!platform) return null

  const isMac = platform === 'mac'
  const href = isMac ? MAC_SUPPORT_URL : MS_STORE_URL
  const external = !isMac

  return (
    <div className="fixed inset-x-4 bottom-6 sm:left-6 sm:right-auto sm:max-w-[340px] z-50 dark:bg-[#0d0d1c] bg-[#FDFCF9] border dark:border-white/[0.08] border-black/[0.10] rounded-2xl p-4 shadow-[0_8px_32px_rgba(0,0,0,0.28)] flex items-start gap-3 animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-600/40 to-amber-600/30 border border-yellow-500/40 flex items-center justify-center shrink-0">
        <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
          <line x1="7" y1="14" x2="7" y2="18" stroke="#f5a623" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="11" y1="11" x2="11" y2="21" stroke="#f5a623" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="16" y1="8" x2="16" y2="24" stroke="#f5a623" strokeWidth="3" strokeLinecap="round" />
          <line x1="21" y1="11" x2="21" y2="21" stroke="#f5a623" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="25" y1="14" x2="25" y2="18" stroke="#f5a623" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold dark:text-white text-gray-900">
          {isMac ? 'Get Demist for Mac' : 'Get Demist for Windows'}
        </p>
        <p className="text-[12px] dark:text-white/50 text-gray-600 mt-0.5 leading-relaxed">
          Runs entirely on your own computer: transcription and term detection never touch the cloud, and it's unlimited, free.
        </p>
        <a
          href={href}
          target={external ? '_blank' : undefined}
          rel={external ? 'noopener noreferrer' : undefined}
          onClick={() => { capture(isMac ? 'mac_install_guide_clicked' : 'ms_store_clicked', { placement: 'install_prompt' }); dismiss() }}
          className="mt-2.5 inline-block px-3.5 py-1.5 rounded-full bg-yellow-600 hover:brightness-[1.1] text-white text-[12px] font-semibold transition-all active:scale-[0.97]"
        >
          {isMac ? 'Get the Mac beta' : 'Get it on the Microsoft Store'}
        </a>
      </div>

      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="dark:text-white/30 text-gray-400 dark:hover:text-white/60 hover:text-gray-600 transition-colors text-[16px] leading-none shrink-0"
      >
        ×
      </button>
    </div>
  )
}

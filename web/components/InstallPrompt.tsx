'use client'

// Desktop-only install nudge. Mobile isn't prompted at all: none of the
// on-device work (Chrome's Translator API today, the native app later) runs
// on mobile browsers, so installing there wouldn't unlock anything, and the
// browser tab is already the optimal experience there.

import { useEffect, useState } from 'react'

const DISMISS_KEY = 'demist_install_dismissed'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BeforeInstallPromptEvent = Event & { prompt: () => void; userChoice: Promise<any> }

declare global {
  interface Window {
    __demistInstallPrompt?: BeforeInstallPromptEvent
  }
}

function isMobileUA() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

function isMacSafari() {
  const ua = navigator.userAgent
  return /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua)
}

// Firefox desktop has no install path at all (no beforeinstallprompt, no
// manual equivalent): safe to say so immediately. Any Chromium-family
// browser (Chrome, Edge, Opera, Brave...) genuinely might support it; Chrome
// in particular can delay firing beforeinstallprompt based on its own
// engagement heuristics, so "hasn't fired yet" is never proof it's
// unsupported there. Never claim otherwise for those.
function isKnownUnsupported() {
  return /Firefox/.test(navigator.userAgent) && !/Seamonkey/.test(navigator.userAgent)
}

function isStandalone() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [mode, setMode] = useState<'chromium' | 'mac-safari' | 'unsupported' | null>(null)

  useEffect(() => {
    if (isMobileUA() || isStandalone() || sessionStorage.getItem(DISMISS_KEY)) return

    // The event may have already fired and been captured by the inline
    // script in layout.tsx <head>, before this component ever mounted.
    if (window.__demistInstallPrompt) {
      setDeferredPrompt(window.__demistInstallPrompt)
      setMode('chromium')
      return
    }

    if (isMacSafari()) { setMode('mac-safari'); return }
    if (isKnownUnsupported()) { setMode('unsupported'); return }

    // Chromium-family browser that hasn't fired the event yet: keep
    // listening for the rest of this page view rather than giving up after
    // a fixed wait. Chrome's own address-bar install icon is always there
    // regardless, so showing nothing here is honest; it's never wrong the
    // way a false "unsupported" claim would be.
    const handler = () => {
      if (window.__demistInstallPrompt) {
        setDeferredPrompt(window.__demistInstallPrompt)
        setMode('chromium')
      }
    }
    window.addEventListener('demist:bip', handler)
    return () => window.removeEventListener('demist:bip', handler)
  }, [])

  const dismiss = () => {
    setMode(null)
    sessionStorage.setItem(DISMISS_KEY, '1')
  }

  const install = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    dismiss()
  }

  if (!mode) return null

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
        <p className="text-[13px] font-semibold dark:text-white text-gray-900">Install Demist</p>
        <p className="text-[12px] dark:text-white/50 text-gray-600 mt-0.5 leading-relaxed">
          {mode === 'chromium' && <>Its own window, no browser tabs: the best way to use Demist on desktop.</>}
          {mode === 'mac-safari' && (
            <>Add it to your Dock: <span className="font-medium dark:text-white/70 text-gray-800">File → Add to Dock</span>.</>
          )}
          {mode === 'unsupported' && <>This browser doesn&apos;t support one-click install yet, try Chrome or Edge.</>}
        </p>
        {mode === 'chromium' && (
          <button
            onClick={install}
            className="mt-2.5 px-3.5 py-1.5 rounded-full bg-yellow-600 hover:brightness-[1.1] text-white text-[12px] font-semibold transition-all active:scale-[0.97]"
          >
            Install
          </button>
        )}
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

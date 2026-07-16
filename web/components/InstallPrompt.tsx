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

    const handler = () => {
      if (window.__demistInstallPrompt) {
        setDeferredPrompt(window.__demistInstallPrompt)
        setMode('chromium')
      }
    }
    window.addEventListener('demist:bip', handler)

    // Nothing fired after a few seconds: either this is Safari on macOS
    // (never fires it, no programmatic install exists there), or a
    // Chromium-based browser with incomplete PWA support. Opera GX is a
    // known case, it fires the event per spec but its own install UI is
    // reportedly unreliable, so treat "never fired" the same as "doesn't
    // support it" rather than promise a button that may not work.
    const fallbackTimer = setTimeout(() => {
      setMode(isMacSafari() ? 'mac-safari' : 'unsupported')
    }, 3000)

    return () => {
      window.removeEventListener('demist:bip', handler)
      clearTimeout(fallbackTimer)
    }
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
    <div className="fixed inset-x-4 bottom-6 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:max-w-sm z-50 dark:bg-[#13120e] bg-[#FDFCF9] border dark:border-amber-500/20 border-amber-300/70 rounded-2xl px-4 py-3.5 shadow-lg flex items-start gap-3">
      <div className="flex-1 text-[13px] dark:text-white/80 text-gray-800 leading-relaxed">
        {mode === 'chromium' && <>Install Demist for the best desktop experience: its own window, no browser tabs.</>}
        {mode === 'mac-safari' && (
          <>For the best desktop experience, add Demist to your Dock: <span className="font-semibold">File → Add to Dock</span>.</>
        )}
        {mode === 'unsupported' && (
          <>Your browser doesn&apos;t support one-click install yet. Chrome or Edge give Demist its own window with no browser tabs.</>
        )}
      </div>
      {mode === 'chromium' && (
        <button
          onClick={install}
          className="shrink-0 text-[13px] font-semibold dark:text-yellow-400 text-yellow-700 hover:opacity-80 transition-opacity"
        >
          Install
        </button>
      )}
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="dark:text-white/30 text-gray-400 dark:hover:text-white/60 hover:text-gray-600 transition-colors text-[18px] leading-none shrink-0"
      >
        ×
      </button>
    </div>
  )
}

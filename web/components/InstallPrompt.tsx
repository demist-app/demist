'use client'

// Desktop-only install nudge. Mobile isn't prompted at all: none of the
// on-device work (Chrome's Translator API today, the native app later) runs
// on mobile browsers, so installing there wouldn't unlock anything, and the
// browser tab is already the optimal experience there.

import { useEffect, useState } from 'react'

const DISMISS_KEY = 'demist_install_dismissed'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BeforeInstallPromptEvent = Event & { prompt: () => void; userChoice: Promise<any> }

function isMobileUA() {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

function isMacSafari() {
  const ua = navigator.userAgent
  return /Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)
}

function isStandalone() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [mode, setMode] = useState<'chromium' | 'mac-safari' | null>(null)

  useEffect(() => {
    if (isMobileUA() || isStandalone() || sessionStorage.getItem(DISMISS_KEY)) return

    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
      setMode('chromium')
    }
    window.addEventListener('beforeinstallprompt', handler)

    // Safari on macOS never fires beforeinstallprompt (no programmatic
    // install there) — fall back to manual instructions if nothing claimed
    // the chromium path after a moment.
    const fallbackTimer = setTimeout(() => {
      if (isMacSafari()) setMode('mac-safari')
    }, 2000)

    return () => {
      window.removeEventListener('beforeinstallprompt', handler)
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
        {mode === 'chromium' ? (
          <>Install Demist for the best desktop experience: its own window, no browser tabs.</>
        ) : (
          <>For the best desktop experience, add Demist to your Dock: <span className="font-semibold">File → Add to Dock</span>.</>
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

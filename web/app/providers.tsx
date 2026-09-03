'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { ThemeProvider, useTheme } from 'next-themes'
import { startSessionRecording, stopSessionRecording } from '@/lib/analytics'

const THEME_COLOR = { light: '#EDEAE3', dark: '#080810' }

// Session recording is off by default (disable_session_recording: true in
// instrumentation-client.ts) and enabled ONLY on this exact set of public,
// logged-out, static-content pages - deliberately an allowlist, not a
// blocklist of (app)/ routes. A blocklist fails open: a new authenticated
// page that forgets to add itself gets recorded by default. An allowlist
// fails closed: anything not explicitly listed here, including every current
// and future (app)/ route (dashboard, history, flashcards, glossary, import,
// leaderboard, profile, quiz, stats, study - all of them render real lecture
// transcript or term-definition text as DOM content) and /onboarding and
// /u/[userId] (post-auth or another user's data), simply never records.
const RECORDABLE_PATHS = new Set(['/', '/login', '/about', '/privacy', '/terms', '/support'])

function SessionReplayGate() {
  const pathname = usePathname()
  useEffect(() => {
    if (RECORDABLE_PATHS.has(pathname)) startSessionRecording()
    else stopSessionRecording()
  }, [pathname])
  return null
}

// Theme here is a manual toggle (enableSystem={false}), not OS preference, so
// the installed-app window chrome/status bar color has to track the actual
// resolved theme via JS rather than a prefers-color-scheme media query.
function ThemeColorSync() {
  const { resolvedTheme } = useTheme()
  useEffect(() => {
    const color = resolvedTheme === 'dark' ? THEME_COLOR.dark : THEME_COLOR.light
    document.querySelectorAll('meta[name="theme-color"]').forEach(el => el.setAttribute('content', color))
  }, [resolvedTheme])
  return null
}

function ServiceWorkerRegistration() {
  useEffect(() => {
    // Never on iOS (all browsers there, not just Safari - Apple mandates
    // WebKit underneath every one of them, so Chrome/Firefox on iOS inherit
    // the identical behavior). Reported bug: cold-starting the site froze for
    // ~20s on an iPhone. Root cause is a WebKit characteristic, not a bug in
    // sw.js itself: iOS terminates an idle service worker's execution context
    // to save memory, and the NEXT navigation has to pay the cost of
    // resurrecting that whole context - parsing and running sw.js again -
    // BEFORE the fetch event this app's SW handles even fires, let alone
    // before the actual network request begins. That resurrection is measured
    // in real iOS PWA performance reports as multiple seconds on its own, on
    // top of whatever the network itself takes; Chromium does not have this
    // tax to nearly the same degree.
    //
    // And nothing here needs it on iOS. The two things this SW exists for
    // (see sw.js's own header comment) are Chromium's install-banner
    // criteria, which Safari's Add to Home Screen never checks in the first
    // place, and a custom offline page, for an app that already does not try
    // to work offline. Registering here traded a benefit that does not apply
    // on this platform for a tax that is unique to it.
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    if (isIOS) {
      // Not registering from here on is not enough on its own: anyone who
      // already visited on iOS before this fix shipped has the old SW
      // installed and controlling their device right now, and it stays that
      // way indefinitely - browsers do not expire a registration just
      // because the page stops calling register(). Actively unregister it,
      // one time, for exactly the people this bug actually affected.
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations()
          .then(regs => Promise.all(regs.map(r => r.unregister())))
          .catch(() => {})
      }
      return
    }
    if ('serviceWorker' in navigator) {
      // A registered SW with a fetch handler is part of Chrome's PWA
      // installability checklist alongside the manifest: a silently failed
      // registration here is a plausible reason beforeinstallprompt never
      // fires, so surface it instead of masking it.
      navigator.serviceWorker.register('/sw.js').catch(e => console.error('[demist] service worker registration failed:', e))
    }
  }, [])
  return null
}

export function PHProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const el = document.getElementById('init-loader')
    if (!el) return
    el.style.opacity = '0'
    // Use display:none after fade; never call el.remove() since React owns this node
    // and removing it from the DOM without React's knowledge causes insertBefore errors on navigation
    setTimeout(() => { el.style.display = 'none' }, 300)
  }, [])

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <ThemeColorSync />
      <ServiceWorkerRegistration />
      <SessionReplayGate />
      {children}
    </ThemeProvider>
  )
}

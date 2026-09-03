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

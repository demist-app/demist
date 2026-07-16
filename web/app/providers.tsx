'use client'

import { useEffect } from 'react'
import { ThemeProvider, useTheme } from 'next-themes'

const THEME_COLOR = { light: '#EDEAE3', dark: '#080810' }

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
      navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA install still works without it */ })
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
      {children}
    </ThemeProvider>
  )
}

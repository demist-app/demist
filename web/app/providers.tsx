'use client'

import { useEffect } from 'react'
import { ThemeProvider } from 'next-themes'

export function PHProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const el = document.getElementById('init-loader')
    if (!el) return
    el.style.opacity = '0'
    el.addEventListener('transitionend', () => el.remove(), { once: true })
  }, [])

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      {children}
    </ThemeProvider>
  )
}

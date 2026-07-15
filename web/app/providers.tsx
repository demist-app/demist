'use client'

import { useEffect } from 'react'
import { ThemeProvider } from 'next-themes'

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
      {children}
    </ThemeProvider>
  )
}

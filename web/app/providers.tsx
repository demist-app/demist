'use client'

import { ThemeProvider } from 'next-themes'

export function PHProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      {children}
    </ThemeProvider>
  )
}

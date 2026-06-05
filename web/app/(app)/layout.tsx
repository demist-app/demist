'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase'

const NAV = [
  { href: '/dashboard',  label: 'Home',       icon: HomeIcon },
  { href: '/flashcards', label: 'Flashcards',  icon: CardsIcon },
  { href: '/glossary',   label: 'Glossary',    icon: GlossaryIcon },
  { href: '/history',    label: 'History',     icon: HistoryIcon },
  { href: '/import',     label: 'Import',      icon: ImportIcon },
]

const DESKTOP_EXTRA = [
  { href: '/profile', label: 'Profile' },
  { href: '/stats',   label: 'Stats' },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (!data.user) { router.replace('/login'); return }
      setReady(true)
    })
  }, [])

  if (!ready) return (
    <div className="min-h-dvh flex flex-col" style={{ background: 'var(--bg)' }}>
      {/* Skeleton nav strip */}
      <div className="hidden sm:flex h-14 items-center px-8 gap-8 animate-pulse" style={{ borderBottom: '1px solid var(--border)' }}>
        <div className="h-3.5 w-14 rounded-full" style={{ background: 'var(--surface-2)' }} />
        {[60,52,56,52,48].map((w,i) => (
          <div key={i} className="h-2.5 rounded-full" style={{ width: w, background: 'var(--surface)' }} />
        ))}
      </div>
      {/* Skeleton content */}
      <div className="flex-1 px-4 sm:px-8 py-6 animate-pulse max-w-4xl mx-auto w-full">
        <div className="h-6 w-40 rounded-full mb-8" style={{ background: 'var(--surface-2)' }} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          {[0,1,2].map(i => (
            <div key={i} className="h-20 rounded-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
          ))}
        </div>
        {[0,1,2,3].map(i => (
          <div key={i} className="h-14 rounded-2xl mb-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} />
        ))}
      </div>
      {/* Skeleton mobile nav */}
      <div className="sm:hidden h-[52px] flex items-center justify-around px-2 animate-pulse" style={{ borderTop: '1px solid var(--border)', background: 'var(--mobile-nav-bg)' }}>
        {[0,1,2,3,4].map(i => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <div className="w-5 h-5 rounded-md" style={{ background: 'var(--surface-2)' }} />
            <div className="w-8 h-1.5 rounded-full" style={{ background: 'var(--surface)' }} />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <>
      {/* ── Desktop top nav ── */}
      <nav
        className="hidden sm:flex fixed top-0 inset-x-0 h-14 z-40 items-center px-8 gap-8 backdrop-blur-xl"
        style={{ background: 'var(--nav-bg)', borderBottom: '1px solid var(--border)' }}
      >
        <Link
          href="/dashboard"
          className="text-[15px] font-semibold tracking-tight mr-2 active:scale-[0.97] transition-colors duration-150 select-none"
          style={{ color: 'var(--accent)' }}
        >
          Demist
        </Link>

        {[...NAV, ...DESKTOP_EXTRA].map(({ href, label }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center h-14 border-b-[2px] text-[14px] font-medium transition-all"
              style={active
                ? { color: 'var(--fg)', borderColor: 'var(--accent)' }
                : { color: 'var(--fg-muted)', borderColor: 'transparent' }
              }
            >
              {label}
            </Link>
          )
        })}

        {/* Theme toggle — pushed to right */}
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>

      {/* Content */}
      <div className="sm:pt-14">
        {children}
      </div>

      {/* ── Mobile bottom nav ── */}
      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 z-40 flex items-center justify-around backdrop-blur-xl"
        style={{
          height: 'calc(52px + env(safe-area-inset-bottom))',
          paddingBottom: 'env(safe-area-inset-bottom)',
          background: 'var(--mobile-nav-bg)',
          borderTop: '1px solid var(--border)',
        }}
      >
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className="flex flex-col items-center gap-[3px] py-1 px-4 transition-colors"
              style={{ color: active ? 'var(--accent)' : 'var(--fg-muted)' }}
            >
              <Icon active={active} />
              <span className="text-[10px] font-medium">{label}</span>
            </Link>
          )
        })}
        <div className="flex flex-col items-center gap-[3px] py-1 px-4">
          <ThemeToggle />
        </div>
      </nav>
    </>
  )
}

/* ── Theme toggle ── */
function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="w-8 h-8" />
  const isDark = theme === 'dark'
  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
      style={{ background: 'var(--surface)', color: 'var(--fg-muted)' }}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

/* ── Icons ── */
function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}
function CardsIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  )
}
function HistoryIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  )
}
function GlossaryIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}
function ImportIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
    </svg>
  )
}
function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  )
}
function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  )
}

'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

const NAV = [
  { href: '/dashboard', label: 'Home', icon: HomeIcon },
  { href: '/flashcards', label: 'Flashcards', icon: CardsIcon },
  { href: '/glossary', label: 'Glossary', icon: GlossaryIcon },
  { href: '/history', label: 'History', icon: HistoryIcon },
  { href: '/profile', label: 'Profile', icon: ProfileIcon },
]

const DESKTOP_EXTRA = [
  { href: '/leaderboard', label: 'Leaderboard' },
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

  if (!ready) return <div className="min-h-dvh bg-[#080810]" />

  return (
    <>
      {/* ── Desktop top nav (hidden on mobile) ── */}
      <nav className="hidden sm:flex fixed top-0 inset-x-0 h-14 z-40 items-center px-8 gap-8 bg-[#080810]/96 backdrop-blur-xl border-b border-white/[0.05]">
        <Link
          href="/dashboard"
          className="text-[15px] font-semibold tracking-tight text-white mr-2 hover:text-violet-300 active:scale-[0.97] transition-colors duration-150 select-none"
        >
          Demist
        </Link>
        {[...NAV, ...DESKTOP_EXTRA].map(({ href, label }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center h-14 border-b-[2px] text-[14px] font-medium transition-all ${
                active
                  ? 'text-white border-violet-500/60'
                  : 'text-gray-500 hover:text-gray-300 border-transparent'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Content - offset by top nav on desktop */}
      <div className="sm:pt-14">
        {children}
      </div>

      {/* ── Mobile bottom nav (hidden on desktop) ── */}
      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-[#080810]/96 backdrop-blur-xl border-t border-white/[0.05] flex items-center justify-around"
        style={{ height: 'calc(52px + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center gap-[3px] py-1 px-5 transition-colors ${
                active ? 'text-violet-400' : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              <Icon active={active} />
              <span className={`text-[10px] font-medium ${active ? 'text-violet-400' : 'text-gray-600'}`}>
                {label}
              </span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}

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

function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2 : 1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

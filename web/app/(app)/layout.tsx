'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { cn } from '@/lib/utils'

/* ─── Navigation items ─────────────────────────────────────────────────── */
const NAV_MAIN = [
  { href: '/dashboard', label: 'Home',       icon: HomeIcon },
  { href: '/flashcards', label: 'Flashcards', icon: CardsIcon },
  { href: '/glossary',   label: 'Glossary',   icon: GlossaryIcon },
  { href: '/history',    label: 'History',    icon: HistoryIcon },
  { href: '/import',     label: 'Import',     icon: ImportIcon },
]
const NAV_SECONDARY = [
  { href: '/stats',   label: 'Stats',   icon: StatsIcon },
  { href: '/profile', label: 'Profile', icon: ProfileIcon },
]
const NAV_MOBILE = NAV_MAIN // 5 items fits bottom bar perfectly

/* ─── Layout ───────────────────────────────────────────────────────────── */
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
    <div className="min-h-dvh bg-[#08080E] flex items-center justify-center">
      <div className="w-5 h-5 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
    </div>
  )

  return (
    <div className="min-h-dvh flex bg-[#08080E]">
      {/* ── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="hidden sm:flex flex-col fixed left-0 top-0 bottom-0 w-[216px] z-40 bg-[#09090F]/95 backdrop-blur-xl border-r border-white/[0.07]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-5">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center shadow-[0_0_14px_rgba(124,58,237,0.5)] shrink-0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
            </svg>
          </div>
          <span className="text-[15px] font-bold text-white tracking-tight">Demist</span>
        </div>

        {/* Main nav */}
        <nav className="flex-1 px-2 py-1 flex flex-col gap-0.5 overflow-y-auto">
          {NAV_MAIN.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <SidebarLink key={href} href={href} active={active}>
                <Icon active={active} />
                {label}
              </SidebarLink>
            )
          })}

          <div className="my-2 h-px bg-white/[0.06] mx-2" />

          {NAV_SECONDARY.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <SidebarLink key={href} href={href} active={active}>
                <Icon active={active} />
                {label}
              </SidebarLink>
            )
          })}
        </nav>

        {/* Footer watermark */}
        <div className="px-4 py-4 border-t border-white/[0.06]">
          <p className="text-[11px] text-white/20 font-medium">demist.app</p>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────── */}
      <main className="flex-1 sm:pl-[216px] min-h-dvh">
        {children}
      </main>

      {/* ── Mobile bottom nav ───────────────────────────────────────── */}
      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 z-40 border-t border-white/[0.07] flex items-stretch justify-around bg-[#09090F]/96 backdrop-blur-xl"
        style={{ height: 'calc(60px + env(safe-area-inset-bottom))', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {NAV_MOBILE.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center gap-[3px] flex-1 pt-1 transition-colors duration-150',
                active ? 'text-violet-400' : 'text-white/30 hover:text-white/60'
              )}
            >
              <Icon active={active} />
              <span className={cn(
                'text-[9.5px] font-semibold tracking-wide',
                active ? 'text-violet-400' : 'text-white/30'
              )}>
                {label}
              </span>
              {active && (
                <span className="absolute bottom-0 w-5 h-[2px] rounded-full bg-violet-400" style={{ marginBottom: 'env(safe-area-inset-bottom)' }} />
              )}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

/* ─── Sidebar link ──────────────────────────────────────────────────────── */
function SidebarLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-all duration-150',
        active
          ? 'bg-violet-500/[0.14] text-violet-300 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.18)]'
          : 'text-white/50 hover:bg-white/[0.05] hover:text-white/80'
      )}
    >
      {children}
    </Link>
  )
}

/* ─── Icons ─────────────────────────────────────────────────────────────── */
function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'rgba(167,139,250,0.18)' : 'none'} stroke="currentColor"
      strokeWidth={active ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function CardsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'rgba(167,139,250,0.18)' : 'none'} stroke="currentColor"
      strokeWidth={active ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  )
}

function GlossaryIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'rgba(167,139,250,0.18)' : 'none'} stroke="currentColor"
      strokeWidth={active ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function HistoryIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'rgba(167,139,250,0.18)' : 'none'} stroke="currentColor"
      strokeWidth={active ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  )
}

function ImportIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={active ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
    </svg>
  )
}

function StatsIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'rgba(167,139,250,0.18)' : 'none'} stroke="currentColor"
      strokeWidth={active ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  )
}

function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? 'rgba(167,139,250,0.18)' : 'none'} stroke="currentColor"
      strokeWidth={active ? 2 : 1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

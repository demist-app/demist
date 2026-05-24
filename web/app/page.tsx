'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

export default function Home() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) setAuthed(true)
    })
  }, [])

  const handleCta = () => {
    posthog.capture('get_started_clicked')
    router.push(authed ? '/dashboard' : '/login')
  }

  return (
    <main className="relative min-h-dvh bg-[#080810] text-white flex flex-col overflow-hidden">
      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[900px] h-[900px] rounded-full bg-violet-600/[0.07] blur-[140px]" />
      </div>

      {/* Nav */}
      <header className="relative z-10 shrink-0 flex items-center justify-between px-6 sm:px-10 h-16">
        <span className="text-[13px] font-bold tracking-[0.2em] text-violet-400/70 uppercase">Demist</span>
        <button
          onClick={handleCta}
          className="text-[13px] font-medium text-gray-400 hover:text-white transition-colors"
        >
          {authed ? 'Open app →' : 'Sign in'}
        </button>
      </header>

      {/* Hero */}
      <section className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
        <p className="text-[11px] font-bold tracking-[0.22em] text-violet-400/60 uppercase mb-6">
          For university students
        </p>

        <h1 className="text-[40px] sm:text-[60px] font-bold tracking-tight leading-[1.08] mb-5 max-w-2xl">
          Never feel lost<br className="hidden sm:block" /> in a lecture again.
        </h1>

        <p className="text-gray-500 text-[16px] sm:text-[18px] leading-relaxed mb-10 max-w-md">
          Demist listens in the background and quietly surfaces definitions for unfamiliar terms — so you stay focused without falling behind.
        </p>

        <button
          onClick={handleCta}
          className="px-8 py-4 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[15px] transition-all hover:shadow-[0_0_40px_rgba(139,92,246,0.35)] select-none"
        >
          {authed ? 'Open app →' : 'Get started →'}
        </button>
      </section>

      {/* How it works */}
      <section className="relative z-10 shrink-0 px-6 sm:px-10 pb-20 max-w-2xl mx-auto w-full">
        <p className="text-[10px] font-bold tracking-[0.2em] text-gray-600 uppercase mb-6 text-center">
          How it works
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { n: '1', title: 'Open Demist', body: 'Start a session before or during a lecture. No setup needed.' },
            { n: '2', title: 'Terms appear as you listen', body: 'Unfamiliar concepts surface as subtle cards — never intrusive, always relevant.' },
            { n: '3', title: 'Review and retain', body: 'Every term is saved to your glossary. Build flashcards. Track your progress.' },
          ].map(({ n, title, body }) => (
            <div key={n} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-5">
              <span className="text-[11px] font-bold text-violet-500/60 tracking-widest">{n}</span>
              <p className="text-[14px] font-semibold text-white/90 mt-2 mb-1">{title}</p>
              <p className="text-[13px] text-gray-600 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}

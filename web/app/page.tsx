'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) router.replace('/dashboard')
    })
  }, [])

  return (
    <main className="relative min-h-dvh bg-[#080810] text-white flex flex-col items-center justify-center px-6 overflow-hidden">
      {/* Ambient glow */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[700px] h-[700px] rounded-full bg-violet-600/[0.08] blur-[130px]" />
      </div>

      <div className="relative flex flex-col items-center text-center max-w-lg">
        <p className="text-[11px] font-bold tracking-[0.22em] text-violet-400/70 uppercase mb-8">
          Demist
        </p>

        <h1 className="text-[38px] sm:text-[52px] font-bold tracking-tight leading-[1.1] mb-4">
          Never feel lost<br />in a lecture again.
        </h1>

        <p className="text-gray-500 text-[15px] sm:text-[17px] leading-relaxed mb-10 max-w-sm">
          Demist listens alongside you and quietly explains unfamiliar terms as they come up.
        </p>

        <a
          href="/login"
          onClick={() => posthog.capture('get_started_clicked')}
          className="px-8 py-4 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[15px] transition-all hover:shadow-[0_0_40px_rgba(139,92,246,0.35)]"
        >
          Get started →
        </a>
      </div>
    </main>
  )
}

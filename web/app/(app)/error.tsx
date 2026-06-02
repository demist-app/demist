'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => { console.error(error) }, [error])

  return (
    <main className="min-h-dvh bg-[#080810] text-white flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <p className="text-[11px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-4">
          Something went wrong
        </p>
        <p className="text-[15px] text-gray-400 leading-relaxed mb-8">
          An unexpected error occurred on this page.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-6 py-3 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white text-[14px] font-semibold transition-colors active:scale-[0.97]"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="px-6 py-3 rounded-2xl bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:text-white text-[14px] font-medium transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  )
}

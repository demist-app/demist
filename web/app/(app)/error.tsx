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
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex items-center justify-center px-6">
      <div className="text-center max-w-sm">
        <p className="text-[11px] font-bold tracking-[0.18em] dark:text-gray-400 text-gray-600 uppercase mb-4">
          Something went wrong
        </p>
        <p className="text-[15px] dark:text-gray-400 text-gray-700 leading-relaxed mb-8">
          An unexpected error occurred on this page.
        </p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={reset}
            className="px-6 py-3 rounded-2xl text-white text-[14px] font-semibold transition-colors active:scale-[0.97]"
            style={{ background: 'var(--accent)' }}
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="px-6 py-3 rounded-2xl dark:bg-white/[0.05] bg-[#FAF9F6] dark:border-white/[0.08] border-black/[0.12] border dark:text-gray-400 text-gray-700 hover:dark:text-white hover:text-gray-900 text-[14px] font-medium transition-colors"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  )
}

'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => { console.error(error) }, [error])

  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#080810', color: 'white', fontFamily: 'sans-serif' }}>
        <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
          <div style={{ maxWidth: 360 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: '#4b5563', textTransform: 'uppercase', marginBottom: 16 }}>
              Something went wrong
            </p>
            <p style={{ fontSize: 15, color: '#9ca3af', marginBottom: 32 }}>
              An unexpected error occurred. Refresh the page to continue.
            </p>
            <button
              onClick={reset}
              style={{ padding: '12px 24px', borderRadius: 16, background: '#D97706', color: 'white', fontSize: 14, fontWeight: 600, border: 'none', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  )
}

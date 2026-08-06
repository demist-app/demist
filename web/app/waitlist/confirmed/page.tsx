import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Waitlist',
  // Nothing here is worth indexing, and the URL carries a status of a personal
  // action - keep it out of search results entirely.
  robots: { index: false, follow: false },
}

const STORE_URL = 'https://apps.microsoft.com/detail/9N4TZSCFHZN8'

// Keyed by the status the verify route redirects with. Anything unrecognised
// falls through to 'invalid', which is also the honest answer for a mangled
// link.
const STATES = {
  verified: {
    title: 'You’re on the list',
    body: 'Your email is confirmed. We’ll email you once — when Demist Pro is ready. Nothing else, no newsletter.',
    tone: 'good',
  },
  expired: {
    title: 'That link has expired',
    body: 'Confirmation links last 7 days. Enter your email on the homepage again and we’ll send a fresh one.',
    tone: 'bad',
  },
  invalid: {
    title: 'That link didn’t work',
    body: 'It may have been broken in half by your email client. Enter your email on the homepage again and we’ll send a new one.',
    tone: 'bad',
  },
  error: {
    title: 'Something went wrong on our end',
    body: 'Not your fault, and nothing was lost. Try the link again in a minute, or email hello@demist.app if it keeps happening.',
    tone: 'bad',
  },
} as const

export default async function WaitlistConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const raw = (await searchParams).status
  const key = typeof raw === 'string' && raw in STATES ? (raw as keyof typeof STATES) : 'invalid'
  const { title, body, tone } = STATES[key]

  return (
    <main
      className="min-h-dvh flex flex-col items-center justify-center px-6 py-20 text-center"
      style={{ background: 'var(--bg)', color: 'var(--fg)' }}
    >
      <Link
        href="/"
        className="text-[13px] font-bold tracking-[0.2em] uppercase mb-10"
        style={{ color: 'var(--accent)' }}
      >
        Demist
      </Link>

      <div
        className="w-full max-w-md rounded-2xl px-7 py-9"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div
          aria-hidden
          className="w-11 h-11 rounded-2xl mx-auto mb-6 flex items-center justify-center text-[20px]"
          style={
            tone === 'good'
              ? { background: 'var(--accent-soft)', border: '1px solid var(--accent-border)', color: 'var(--accent)' }
              : { background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--fg-faint)' }
          }
        >
          {tone === 'good' ? '✓' : '!'}
        </div>

        <h1 className="text-[24px] font-bold tracking-tight mb-3 leading-snug">{title}</h1>
        <p className="text-[15px] leading-relaxed mb-8" style={{ color: 'var(--fg-muted)' }}>
          {body}
        </p>

        <div className="flex flex-col gap-2.5">
          <Link
            href={tone === 'good' ? '/login' : '/#pro-waitlist'}
            className="px-6 py-3.5 rounded-2xl text-white font-semibold text-[15px] transition-all active:scale-[0.97]"
            style={{ background: 'var(--accent)' }}
          >
            {tone === 'good' ? 'Start using Demist free →' : 'Back to the homepage'}
          </Link>

          {tone === 'good' && (
            <a
              href={STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3.5 rounded-2xl text-[15px] font-medium transition-all"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--fg-muted)' }}
            >
              Get the Windows app
            </a>
          )}
        </div>
      </div>
    </main>
  )
}

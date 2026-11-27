import type { Metadata } from 'next'
import Link from 'next/link'
import { ReferralClaim } from './referral-claim'

// A friend's invite link (migration 045). Not indexed: it is for the person
// who was sent it. Nothing here reveals who sent it.
export const metadata: Metadata = {
  title: 'A friend invited you to Demist',
  robots: { index: false, follow: false },
}

export default async function ReferralPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params
  const valid = /^[a-z0-9]{6,12}$/i.test(code)
  return (
    <main className="min-h-dvh dark:bg-[#110B1C] bg-[#F3F0F8] dark:text-white text-gray-900 px-6 py-16">
      <div className="max-w-[600px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] dark:text-brand-400/70 text-brand-700 uppercase">
          Demist, by Graceful Minds
        </Link>
        <h1 className="text-[30px] sm:text-[36px] font-bold tracking-tight leading-[1.15] mt-8 mb-4">
          A friend invited you: Demist Pro free for 30 days
        </h1>
        <p className="text-[17px] leading-relaxed dark:text-gray-300 text-gray-700 mb-8">
          Demist shows a live transcript of your lecture and explains difficult words in plain English as the
          lecturer says them. Afterwards it writes notes you can revise from. Free to use, with no card needed.
        </p>
        {valid ? <ReferralClaim code={code.toLowerCase()} /> : (
          <Link href="/login" className="inline-block px-7 py-4 rounded-2xl bg-brand-600 text-white font-semibold text-[15px]">Start free</Link>
        )}
        <p className="mt-10 text-[13px] dark:text-gray-400 text-gray-600">
          The 30 days are for new accounts. Explanations are generated automatically, so they can be wrong.
        </p>
      </div>
    </main>
  )
}

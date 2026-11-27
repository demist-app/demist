import type { Metadata } from 'next'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { UniClaim } from './uni-claim'

// The link a university disability office shares with its students
// (migration 044). Not indexed: each page exists for one university's
// students, and the offer is not something to find by searching.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Demist Pro for your university',
  robots: { index: false, follow: false },
}

export default async function UniOfferPage(props: { params: Promise<{ code: string }> }) {
  const { code: raw } = await props.params
  const code = raw.toLowerCase()
  const { data: offer } = /^[a-z0-9-]{3,40}$/.test(code)
    ? await createAdminClient().from('uni_offers').select('code, org_name, pro_until, active').eq('code', code).maybeSingle()
    : { data: null }
  const live = !!offer && offer.active && new Date(offer.pro_until) > new Date()
  const until = offer ? new Date(offer.pro_until).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''

  return (
    <main className="min-h-dvh dark:bg-[#110B1C] bg-[#F3F0F8] dark:text-white text-gray-900 px-6 py-16">
      <div className="max-w-[600px] mx-auto">
        <Link href="/" className="text-[11px] font-bold tracking-[0.2em] dark:text-brand-400/70 text-brand-700 uppercase">
          Demist, by Graceful Minds
        </Link>
        {live ? (
          <>
            <h1 className="text-[30px] sm:text-[36px] font-bold tracking-tight leading-[1.15] mt-8 mb-4">
              {offer!.org_name} students get Demist Pro free until {until}
            </h1>
            <p className="text-[17px] leading-relaxed dark:text-gray-300 text-gray-700 mb-8">
              Demist shows a live transcript of your lecture and explains difficult words in plain English as
              the lecturer says them. Afterwards it writes notes you can revise from. Pro keeps every lecture,
              with no limit on notes.
            </p>
            <UniClaim code={offer!.code} />
            <div className="mt-12 space-y-3 text-[15px] leading-relaxed dark:text-gray-400 text-gray-700">
              <p>
                <strong className="dark:text-gray-200 text-gray-900">Use the free Windows app for lectures.</strong>{' '}
                On Windows the transcription runs on your own computer. Recording in the browser is limited to a
                few lectures.
              </p>
              <p>
                It does not replace a note-taker or captioner, and the explanations are generated automatically, so
                they can be wrong. Nothing to pay, and no card needed. When Pro ends you keep a free account.
              </p>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-[30px] font-bold tracking-tight mt-8 mb-4">This offer has ended</h1>
            <p className="text-[17px] leading-relaxed dark:text-gray-300 text-gray-700 mb-8">
              You can still use Demist for free.
            </p>
            <Link href="/login" className="inline-block px-7 py-4 rounded-2xl bg-brand-600 hover:brightness-[1.1] text-white font-semibold text-[15px]">
              Start free
            </Link>
          </>
        )}
      </div>
    </main>
  )
}

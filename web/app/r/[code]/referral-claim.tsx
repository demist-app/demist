'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { MS_STORE_URL } from '@/lib/links'
import { capture } from '@/lib/analytics'
import { claimReferral, rememberReferral } from '@/lib/referral'

const MESSAGES: Record<string, string> = {
  ok: 'Done. Pro is on your account for your first 30 days.',
  already: 'You have already used an invite, so nothing changes.',
  too_old: 'Invites are for new accounts, so this one does not change your plan. You can keep using Demist as you are.',
  own_code: 'That is your own invite link. Share it with a friend instead.',
  unknown_code: 'This invite link does not work. You can still use Demist for free.',
  error: 'Something went wrong. Please reload this page.',
}

export function ReferralClaim({ code }: { code: string }) {
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    rememberReferral(code)
    capture('referral_page_viewed')
    createClient().auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setStatus('signed_out'); return }
      setStatus(await claimReferral(code))
    })
  }, [code])

  const button = 'inline-block px-7 py-4 rounded-2xl bg-brand-600 hover:brightness-[1.1] text-white font-semibold text-[15px] text-center transition-all active:scale-[0.97]'
  const secondary = 'inline-block px-7 py-4 rounded-2xl font-semibold text-[15px] text-center dark:bg-white/[0.05] bg-white border dark:border-white/[0.08] border-black/[0.12]'

  if (status === null) return <p className="text-[15px] dark:text-gray-400 text-gray-600">One moment...</p>
  if (status === 'signed_out') {
    return (
      <div className="flex flex-col sm:flex-row gap-3">
        <Link href="/login" className={button}>Create your free account</Link>
        <a href={MS_STORE_URL} target="_blank" rel="noopener noreferrer" className={secondary}>Get the Windows app</a>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      <p className="text-[16px] font-semibold">{MESSAGES[status] ?? MESSAGES.error}</p>
      <div className="flex flex-col sm:flex-row gap-3">
        <a href={MS_STORE_URL} target="_blank" rel="noopener noreferrer" className={button}>Get the Windows app</a>
        <Link href="/dashboard" className={secondary}>Go to Demist</Link>
      </div>
    </div>
  )
}

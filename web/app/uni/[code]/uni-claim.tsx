'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { MS_STORE_URL } from '@/lib/links'
import { capture } from '@/lib/analytics'
import { claimUniCode, rememberUniCode } from '@/lib/uniOffer'

type State = 'checking' | 'signed_out' | 'claiming' | 'done' | 'paid' | 'error'

export function UniClaim({ code }: { code: string }) {
  const [state, setState] = useState<State>('checking')

  useEffect(() => {
    rememberUniCode(code)
    capture('uni_offer_viewed', { code })
    createClient().auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setState('signed_out'); return }
      setState('claiming')
      const r = await claimUniCode(code)
      setState(r.ok ? (r.alreadyPaid ? 'paid' : 'done') : 'error')
    })
  }, [code])

  const button = 'inline-block px-7 py-4 rounded-2xl bg-brand-600 hover:brightness-[1.1] text-white font-semibold text-[15px] text-center transition-all active:scale-[0.97]'
  const secondary = 'inline-block px-7 py-4 rounded-2xl font-semibold text-[15px] text-center dark:bg-white/[0.05] bg-white border dark:border-white/[0.08] border-black/[0.12]'

  if (state === 'checking' || state === 'claiming') {
    return <p className="text-[15px] dark:text-gray-400 text-gray-600">{state === 'claiming' ? 'Adding Pro to your account...' : 'One moment...'}</p>
  }
  if (state === 'signed_out') {
    return (
      <div className="flex flex-col sm:flex-row gap-3">
        <Link href="/login" className={button}>Create your free account</Link>
        <Link href="/login" className={secondary}>I already have an account</Link>
      </div>
    )
  }
  if (state === 'error') {
    return <p className="text-[15px] dark:text-gray-300 text-gray-700">Something went wrong adding Pro. Please reload this page, or email hello@demist.app and we will add it for you.</p>
  }
  return (
    <div className="space-y-4">
      <p className="text-[16px] font-semibold">
        {state === 'paid' ? 'You already have Pro, so nothing changes and you keep your subscription.' : 'Done. Pro is on your account.'}
      </p>
      <div className="flex flex-col sm:flex-row gap-3">
        <a href={MS_STORE_URL} target="_blank" rel="noopener noreferrer" className={button}>Get the Windows app</a>
        <Link href="/dashboard" className={secondary}>Go to Demist</Link>
      </div>
    </div>
  )
}

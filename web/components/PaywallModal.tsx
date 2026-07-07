'use client'

// Not a checkout. A waitlist. Shown when a free-plan user hits a Pro gate.

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'

const PRO_POINTS = [
  'Unlimited session history',
  'Unlimited AI summaries',
  'Export flashcards to Anki',
  'Unlimited course packs',
]

export function PaywallModal({
  source,
  onClose,
}: {
  source: string          // which gate triggered this, e.g. 'anki_export'
  onClose: () => void
}) {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'already'>('idle')

  useEffect(() => {
    capture('paywall_shown', { source })
    const sb = createClient()
    Promise.all([
      sb.auth.getSession(),
      sb.from('pro_waitlist').select('id').maybeSingle(),
    ]).then(([{ data: { session } }, { data: row }]) => {
      if (session?.user?.email) setEmail(session.user.email)
      if (row) setState('already')
    })
  }, [source])

  const join = async () => {
    if (!email.trim()) return
    setState('saving')
    const { error } = await createClient()
      .from('pro_waitlist')
      .upsert({ email: email.trim(), source }, { onConflict: 'user_id' })
    if (!error) {
      capture('paywall_waitlist_joined', { source })
      setState('done')
    } else {
      setState('idle')
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 dark:bg-black/60 bg-black/30"
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md dark:bg-[#0d0d1c] bg-[#FDFCF9] border dark:border-white/[0.08] border-black/[0.12] rounded-[24px] p-6 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[17px] font-bold dark:text-white text-gray-900 leading-snug">This one&apos;s part of Pro</p>
          <button onClick={onClose} className="text-gray-500 hover:dark:text-white/60 hover:text-gray-900 text-[22px] leading-none shrink-0 mt-[-2px] transition-colors">×</button>
        </div>

        <p className="text-[13px] dark:text-white/60 text-gray-600 leading-relaxed">
          Pro isn&apos;t live yet. Everything you already use stays free. Join the list and you&apos;ll get Pro free for a month when it launches.
        </p>

        <ul className="space-y-1.5">
          {PRO_POINTS.map(p => (
            <li key={p} className="text-[13px] dark:text-white/70 text-gray-700 flex gap-2">
              <span className="text-amber-500 shrink-0">✓</span>{p}
            </li>
          ))}
        </ul>

        {state === 'done' || state === 'already' ? (
          <p className="text-[13px] dark:text-white/70 text-gray-700 py-2">
            {state === 'done' ? 'You’re on the list ✓' : 'You’re already on the list ✓'}
          </p>
        ) : (
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@university.ac.uk"
              className="flex-1 rounded-xl px-3 py-2.5 text-[13px] bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08] outline-none dark:text-white text-gray-900 placeholder:text-gray-400 placeholder:dark:text-white/30"
            />
            <button
              onClick={join}
              disabled={state === 'saving' || !email.trim()}
              className="shrink-0 px-4 py-2.5 rounded-xl bg-amber-600 text-white text-[13px] font-semibold active:scale-[0.97] transition-transform disabled:opacity-40"
            >
              {state === 'saving' ? '…' : 'Join waitlist'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

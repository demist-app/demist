'use client'

// "Give a month, get a month" on Profile (migration 045). Hidden if the
// referral functions are not there or fail, so it can never show a broken card.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'

export function InviteFriends() {
  const [link, setLink] = useState<string | null>(null)
  const [joined, setJoined] = useState(0)
  const [earned, setEarned] = useState(0)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const sb = createClient()
    sb.rpc('my_referral_code').then(async ({ data, error }) => {
      if (error || typeof data !== 'string') return
      setLink(`https://demist.app/r/${data}`)
      const { data: rows } = await sb.from('referrals').select('rewarded_at, reward_note')
      setJoined(rows?.length ?? 0)
      setEarned(rows?.filter(r => r.rewarded_at && !r.reward_note).length ?? 0)
    })
  }, [])

  if (!link) return null

  const share = async () => {
    const text = 'I use Demist for lectures. It shows what the lecturer says and explains hard words as they go. This link gets you Pro free for 30 days:'
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title: 'Demist', text, url: link }); capture('referral_shared', { how: 'share_sheet' }); return } catch { /* closed: fall back to copy */ }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${link}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
      capture('referral_shared', { how: 'copy' })
    } catch { /* clipboard blocked: the link is on screen to copy by hand */ }
  }

  return (
    <div>
      <label className="text-[12px] text-gray-600 mb-1.5 block">Invite a friend</label>
      <div className="px-4 py-3 rounded-xl dark:bg-white/[0.05] bg-[#F8F6FB] border dark:border-white/[0.08] border-black/[0.13]">
        <p className="text-[13px] leading-relaxed dark:text-gray-300 text-gray-700">
          Your friend gets Pro free for 30 days. When they record their first lecture of 10 minutes or more, you get a month of Pro too.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="flex-1 min-w-0 truncate text-[12px] px-3 py-2 rounded-lg dark:bg-black/30 bg-white border dark:border-white/[0.08] border-black/[0.1]">{link}</code>
          <button onClick={share} className="shrink-0 px-4 py-2 rounded-lg bg-brand-600 hover:brightness-110 text-white text-[13px] font-semibold active:scale-[0.97]">
            {copied ? 'Copied' : 'Share'}
          </button>
        </div>
        {joined > 0 && (
          <p className="mt-2 text-[12px] text-gray-500">
            {joined} {joined === 1 ? 'friend has' : 'friends have'} joined. {earned > 0 ? `You have earned ${earned} ${earned === 1 ? 'month' : 'months'} of Pro.` : 'Your month arrives after their first full lecture.'}
          </p>
        )}
      </div>
    </div>
  )
}

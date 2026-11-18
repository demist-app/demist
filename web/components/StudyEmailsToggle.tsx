'use client'

// Profile's on/off switch for study emails (lib/emailPrefs.ts): reminders
// when there are words to revise, and the occasional note about what's new.
// Stored in the user's own auth metadata, so the student changes it directly.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'

export function StudyEmailsToggle() {
  const [on, setOn] = useState<boolean | null>(null)
  const [hasEmail, setHasEmail] = useState(false)

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      setHasEmail(!!data.user?.email)
      setOn(data.user?.user_metadata?.study_emails !== false)
    })
  }, [])

  if (on === null || !hasEmail) return null

  const toggle = async () => {
    const next = !on
    setOn(next)
    const { error } = await createClient().auth.updateUser({ data: { study_emails: next } })
    if (error) setOn(!next)
    else capture('study_emails_toggled', { on: next })
  }

  return (
    <div>
      <label className="text-[12px] text-gray-600 mb-1.5 block">Study reminders</label>
      <button
        onClick={toggle}
        role="switch"
        aria-checked={on}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-left dark:bg-white/[0.05] bg-[#F8F6FB] border dark:border-white/[0.08] border-black/[0.13]"
      >
        <span className="text-[13px] dark:text-white/80 text-gray-700">
          Email me when I have words to revise
        </span>
        <span
          aria-hidden
          className={`shrink-0 w-10 h-6 rounded-full p-0.5 transition-colors ${on ? 'bg-brand-600' : 'dark:bg-white/[0.15] bg-black/[0.15]'}`}
        >
          <span className={`block w-5 h-5 rounded-full bg-white transition-transform ${on ? 'translate-x-4' : ''}`} />
        </span>
      </button>
      <p className="text-[12px] text-gray-500 mt-1.5">At most every few days, and only when there is something to revise.</p>
    </div>
  )
}

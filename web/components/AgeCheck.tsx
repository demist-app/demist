'use client'

// Asks existing accounts for a date of birth we never required.
//
// date_of_birth was optional (the onboarding button literally said "Skip"),
// and nothing ever read it - while the onboarding screen and the privacy
// policy both told users it was being used "to keep Demist age-appropriate".
// 28 accounts have no date on file at all, and one that did turned out to
// belong to a 10-year-old who had recorded 8 sessions of primary school
// audio. Onboarding now enforces 18+ for new accounts; this closes the gap
// for accounts created before that existed.
//
// Dismissible on purpose. Hard-blocking people mid-term over a question they
// were never asked is a worse first impression than asking again next visit,
// and the prompt reappears until it is answered.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'
import { MINIMUM_AGE, meetsMinimumAge } from '@/lib/age'

export function AgeCheck() {
  const [needed, setNeeded] = useState(false)
  const [dob, setDob] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionStorage.getItem('demist_age_check_dismissed') === '1') return
    const sb = createClient()
    sb.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user
      if (!user) return
      const { data: profile } = await sb
        .from('profiles').select('date_of_birth').eq('id', user.id).maybeSingle()
      // Only asks when we genuinely have nothing. An account that already
      // has a date is not re-interrogated, whatever that date says - see the
      // note in the commit about what to do with those.
      if (profile && !profile.date_of_birth) {
        setNeeded(true)
        capture('age_check_shown')
      }
    })
  }, [])

  const save = async () => {
    if (saving) return
    if (meetsMinimumAge(dob) !== true) {
      setError(`Demist is for users aged ${MINIMUM_AGE} and over.`)
      capture('age_check_under_minimum')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const sb = createClient()
      const { data: { session } } = await sb.auth.getSession()
      if (!session?.user) return
      const { error: saveError } = await sb
        .from('profiles').update({ date_of_birth: dob }).eq('id', session.user.id)
      if (saveError) throw saveError
      capture('age_check_completed')
      setNeeded(false)
    } catch (e) {
      console.error('age check save failed:', e)
      setError('Could not save that. Check your connection and try again.')
      setSaving(false)
    }
  }

  const dismiss = () => {
    sessionStorage.setItem('demist_age_check_dismissed', '1')
    capture('age_check_dismissed')
    setNeeded(false)
  }

  if (!needed) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 dark:bg-black/60 bg-black/30"
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm dark:bg-[#0d0d1c] bg-[#FDFCF9] border dark:border-white/[0.08] border-black/[0.12] rounded-[24px] p-6 space-y-4">
        <p className="text-[17px] font-bold dark:text-white text-gray-900">One quick thing</p>
        <p className="text-[13px] dark:text-white/60 text-gray-600 leading-relaxed">
          Demist is for users aged {MINIMUM_AGE} and over. We didn&apos;t ask when you signed up,
          so we&apos;re asking now. We never share this.
        </p>
        <div>
          <label htmlFor="age-check-dob" className="block text-[12px] dark:text-white/50 text-gray-500 mb-1.5">
            Date of birth
          </label>
          <input
            id="age-check-dob"
            type="date"
            value={dob}
            onChange={e => { setDob(e.target.value); if (error) setError(null) }}
            max={new Date().toISOString().slice(0, 10)}
            className="w-full dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.1] border-black/[0.15] rounded-2xl px-4 py-3 dark:text-white text-gray-900 text-[15px] focus:outline-none focus:border-amber-500/50 transition-colors"
          />
        </div>
        {error && <p className="text-[13px] text-red-400">{error}</p>}
        <div className="flex flex-col gap-2 pt-1">
          <button
            onClick={save}
            disabled={saving || !dob}
            className="w-full py-3 rounded-2xl bg-amber-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
          <button
            onClick={dismiss}
            className="w-full py-2.5 rounded-2xl text-[13px] font-medium dark:text-gray-400 text-gray-600 hover:opacity-80 transition-opacity"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}

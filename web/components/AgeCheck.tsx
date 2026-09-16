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

type Mode = 'none' | 'ask' | 'blocked'

export function AgeCheck() {
  const [mode, setMode] = useState<Mode>('none')
  const [dob, setDob] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const sb = createClient()
    sb.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user
      if (!user) return
      const { data: profile } = await sb
        .from('profiles').select('date_of_birth').eq('id', user.id).maybeSingle()
      if (!profile) return
      const meets = meetsMinimumAge(profile.date_of_birth)
      if (meets === false) {
        // Known to be under the minimum. Not dismissible: once the Terms
        // state a minimum age, continuing to serve an account we know is
        // below it is a decision rather than an oversight. Nothing is
        // deleted here - the account and its data stay put until they ask.
        setMode('blocked')
        capture('age_check_blocked')
        return
      }
      // Dismiss only applies to the "we don't know" case.
      if (sessionStorage.getItem('demist_age_check_dismissed') === '1') return
      if (meets === null) {
        setMode('ask')
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
      setMode('none')
    } catch (e) {
      console.error('age check save failed:', e)
      setError('Could not save that. Check your connection and try again.')
      setSaving(false)
    }
  }

  const dismiss = () => {
    sessionStorage.setItem('demist_age_check_dismissed', '1')
    capture('age_check_dismissed')
    setMode('none')
  }

  if (mode === 'none') return null

  if (mode === 'blocked') {
    return (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center px-4 dark:bg-[#080810] bg-[#EDEAE3]"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-sm text-center space-y-4">
          <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: 'var(--accent)' }}>Demist</p>
          <p className="text-[20px] font-bold dark:text-white text-gray-900 leading-snug">
            Demist is for ages {MINIMUM_AGE} and over
          </p>
          <p className="text-[14px] dark:text-white/60 text-gray-600 leading-relaxed">
            Recording a lecture also records your lecturer, and our Terms make getting their
            permission your responsibility. That is not something we are willing to ask of someone
            under {MINIMUM_AGE}, so we have paused access to this account.
          </p>
          <p className="text-[13px] dark:text-white/50 text-gray-500 leading-relaxed">
            Nothing has been deleted. Email <span className="dark:text-white/80 text-gray-800">hello@demist.app</span> and
            we will send you a copy of everything saved to this account, remove it, or both.
            If this is wrong and your date of birth was entered incorrectly, tell us and we will fix it.
          </p>
        </div>
      </div>
    )
  }

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

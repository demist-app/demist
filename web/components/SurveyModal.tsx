'use client'

// The Sean Ellis survey: "how would you feel if you could no longer use
// Demist?" The share answering "very disappointed" is the standard read on
// whether a product has found people who need it, and the free-text answers
// say WHO they are, which is the segment decision this exists to inform.
//
// Shown once, after a session ends, only to strangers with 3+ lectures (see
// surveyEligible in lib/recordingSession.tsx). Once means once: answering
// or dismissing both end it, because a survey that comes back is a survey
// that trains people to close it without reading.
//
// Answers go to survey_responses (migration 039). PostHog gets only the two
// multiple-choice answers; free text never leaves our own database, since in
// the desktop app anything typed here stays off third parties.

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { capture, reportWriteFailure } from '@/lib/analytics'
import { SURVEY_ID, SURVEY_DONE_KEY } from '@/lib/survey'


const FEEL = [
  { value: 'very', label: 'Very disappointed' },
  { value: 'somewhat', label: 'Somewhat disappointed' },
  { value: 'not', label: 'Not disappointed' },
] as const

export function SurveyModal({ onClose }: { onClose: () => void }) {
  const [feel, setFeel] = useState<string | null>(null)
  const [mainThing, setMainThing] = useState('')
  const [who, setWho] = useState('')
  const [english, setEnglish] = useState<'yes' | 'no' | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { capture('survey_shown', { survey: SURVEY_ID }) }, [])

  const markDone = () => { try { localStorage.setItem(SURVEY_DONE_KEY, '1') } catch { /* nothing to do */ } }

  const dismiss = () => {
    markDone()
    capture('survey_dismissed', { survey: SURVEY_ID, answered_feel: !!feel })
    onClose()
  }

  const submit = async () => {
    if (!feel || saving) return
    setSaving(true)
    setError(null)
    const rows = [
      { question_key: 'disappointment', answer: feel },
      { question_key: 'main_benefit', answer: mainThing.trim() },
      { question_key: 'ideal_user', answer: who.trim() },
      { question_key: 'english_first_language', answer: english ?? '' },
    ].filter(r => r.answer).map(r => ({ ...r, survey: SURVEY_ID }))
    const { error: insertErr } = await createClient().from('survey_responses').insert(rows)
    // 23505: already answered (a double submit, or a second device). Their
    // answer is on record either way, so that is a success.
    if (insertErr && insertErr.code !== '23505') {
      reportWriteFailure('survey_responses.insert', insertErr)
      setError('That did not save. Try again in a moment.')
      setSaving(false)
      return
    }
    markDone()
    capture('survey_answered', {
      survey: SURVEY_ID,
      disappointment: feel,
      english_first_language: english,
      // Whether they wrote anything, not what.
      has_main_benefit: !!mainThing.trim(),
      has_ideal_user: !!who.trim(),
    })
    onClose()
  }

  const choice = (on: boolean) =>
    `w-full text-left px-4 py-2.5 rounded-xl border text-[14px] transition-colors ${on
      ? 'dark:bg-yellow-500/[0.08] bg-yellow-50 dark:border-yellow-500/40 border-yellow-600/50 font-medium'
      : 'dark:bg-white/[0.02] bg-[#FAF9F6] dark:border-white/[0.08] border-black/[0.12]'}`
  const field = 'w-full px-3.5 py-2.5 rounded-xl text-[14px] dark:bg-white/[0.03] bg-white border dark:border-white/[0.08] border-black/[0.12] focus:outline-none focus:border-yellow-600/60'

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:px-4 dark:bg-black/60 bg-black/30"
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Four quick questions"
    >
      <div className="w-full sm:max-w-md max-h-[90dvh] overflow-y-auto dark:bg-[#0d0d1c] bg-[#FDFCF9] border dark:border-white/[0.09] border-black/[0.12] rounded-t-[24px] sm:rounded-[24px] p-5 sm:p-6 space-y-5">
        <div>
          <p className="text-[18px] font-bold">Four quick questions</p>
          <p className="text-[13px] dark:text-white/50 text-gray-600 mt-1">
            You have used Demist for a few lectures now. Your answers decide what gets built next.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-[14px] font-semibold mb-2">How would you feel if you could no longer use Demist?</legend>
          {FEEL.map(f => (
            <button key={f.value} type="button" onClick={() => setFeel(f.value)} className={choice(feel === f.value)} aria-pressed={feel === f.value}>
              {f.label}
            </button>
          ))}
        </fieldset>

        <label className="block space-y-2">
          <span className="block text-[14px] font-semibold">What is the main thing Demist does for you?</span>
          <textarea value={mainThing} onChange={e => setMainThing(e.target.value.slice(0, 2000))} rows={2} className={field} />
        </label>

        <label className="block space-y-2">
          <span className="block text-[14px] font-semibold">What type of person would get the most out of Demist?</span>
          <textarea value={who} onChange={e => setWho(e.target.value.slice(0, 2000))} rows={2} className={field} />
        </label>

        <fieldset>
          <legend className="text-[14px] font-semibold mb-2">Is English your first language?</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['yes', 'no'] as const).map(v => (
              <button key={v} type="button" onClick={() => setEnglish(v)} className={choice(english === v)} aria-pressed={english === v}>
                {v === 'yes' ? 'Yes' : 'No'}
              </button>
            ))}
          </div>
        </fieldset>

        {error && <p className="text-[13px] text-red-400" role="alert">{error}</p>}

        <div className="flex items-center justify-between gap-3 pt-1">
          <button onClick={dismiss} className="text-[13px] dark:text-white/50 text-gray-600 hover:underline">
            Skip
          </button>
          <button
            onClick={submit}
            disabled={!feel || saving}
            className="px-5 py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-all disabled:opacity-40"
          >
            {saving ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}

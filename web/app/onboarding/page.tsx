'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { capture, identify, reportWriteFailure, setOnce } from '@/lib/analytics'
import { getFirstTouch } from '@/lib/firstTouch'
import { MINIMUM_AGE, meetsMinimumAge } from '@/lib/age'
import { LIMITS, useEntitlements, REVERSE_TRIAL_DAYS } from '@/lib/entitlements'

const YEARS = [
  { value: 1, label: '1st Year' },
  { value: 2, label: '2nd Year' },
  { value: 3, label: '3rd Year' },
  { value: 4, label: '4th Year' },
  { value: 5, label: '5th Year' },
  { value: 6, label: '6th Year' },
  { value: 7, label: 'Masters' },
  { value: 8, label: 'PhD' },
]

type SupportNeed = 'hearing' | 'dyslexia' | 'attention' | 'language' | 'other' | 'none'

// 'none' is a real, storable answer, not the absence of one.
//
// Without it the only way past this step was to claim a support need, and any
// value other than 'none' unlocks saving a microphone transcript without
// lecturer consent (see summaryEligibility.ts and the gate in
// recordingSession.tsx). So everyone who completed onboarding was granted that
// exemption, the consent path became unreachable in practice, and the consent
// question the app asks was one it never acted on. Someone who simply wants
// term cards should be able to say so.
const SUPPORT_NEEDS: { value: SupportNeed; label: string }[] = [
  { value: 'hearing', label: 'Hearing' },
  { value: 'dyslexia', label: 'Reading or dyslexia' },
  { value: 'attention', label: 'Focus or attention' },
  { value: 'language', label: 'English isn’t my first language' },
  { value: 'none', label: 'None of these' },
  { value: 'other', label: 'Prefer not to say' },
]

// Deliberately not a free-text box: 111 users will produce 111 spellings of
// "tiktok" and nothing countable. The list is drawn from what referrer data
// already shows (search, ChatGPT, Instagram) plus the two channels it
// structurally CANNOT see - word of mouth, and Microsoft Store installs,
// which arrive with no referrer at all.
//
// 2026-09-25: split search into Google and Bing (ChatGPT's web search leans on
// Bing, so the two are different channels to work on), split YouTube and
// Reddit, and added LinkedIn and "a lecturer or my university". Old stored
// values ('search', 'youtube_reddit') stay valid for existing rows; anything
// reading heard_from must accept both sets. 'other' now asks for one line,
// because the channel we are not listing is the one we most need to hear
// about.
const HEARD_FROM: { value: string; label: string }[] = [
  { value: 'ai_assistant', label: 'ChatGPT or another AI assistant' },
  { value: 'google', label: 'Google' },
  { value: 'bing', label: 'Bing' },
  { value: 'microsoft_store', label: 'The Microsoft Store' },
  { value: 'friend', label: 'A friend or coursemate' },
  { value: 'lecturer', label: 'A lecturer or my university' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'other', label: 'Somewhere else' },
]

const FREE_HISTORY_DAYS = LIMITS.free.historyDays

export default function Onboarding() {
  const router = useRouter()
  // Only true for accounts inside the reverse trial; older accounts re-shown
  // onboarding for the date-of-birth prompt never had one and must not be told so.
  const { isTrial } = useEntitlements()
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1)
  const [course, setCourse] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [supportNeed, setSupportNeed] = useState<SupportNeed | null>(null)
  const [dob, setDob] = useState('')
  const [saving, setSaving] = useState(false)
  const [heardFrom, setHeardFrom] = useState<string | null>(null)
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user
      if (!user) { router.replace('/login'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('course, year_of_study')
        .eq('id', user.id)
        .maybeSingle()
      if (profile?.course || profile?.year_of_study) router.replace('/dashboard')
    })
  }, [])

  const handleFinish = async () => {
    if (!year || saving) return
    // Enforced here as well as on the button's disabled state: the date input
    // can be populated by autofill or a paste after the last render, and this
    // is the only place the profile actually gets written.
    if (meetsMinimumAge(dob) !== true) {
      setSaveError(`You need to be ${MINIMUM_AGE} or over to use Demist.`)
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) { router.replace('/login'); return }
      const { error } = await supabase
        .from('profiles')
        .upsert({ id: user.id, course: course.trim() || null, year_of_study: year, support_need: supportNeed, date_of_birth: dob || null, ai_disclaimer_ack_at: new Date().toISOString() })
      if (error) throw error
      identify(user.id)
      void recordFirstTouch()
      capture('onboarding_completed', { course: course.trim() || null, year_of_study: year, support_need: supportNeed, has_dob: !!dob })
      // The profile is saved. Everything from here is optional and cannot
      // cost a signup: if they close the tab on step 5, the account exists
      // and onboarding_completed has already fired.
      setSaving(false)
      setStep(5)
    } catch (e) {
      console.error('onboarding save failed:', e)
      setSaveError('Could not save your profile. Check your connection and try again.')
      setSaving(false)
    }
  }

  // Where this person first came from (lib/firstTouch.ts), written once to
  // their profile through record_first_touch (migration 040; users cannot
  // write those columns directly) and to PostHog as $set_once. Never blocks:
  // the profile is already saved. No stored touch means we genuinely do not
  // know, and the columns stay NULL rather than pretending "direct".
  const recordFirstTouch = async () => {
    const ft = getFirstTouch()
    if (!ft) { capture('first_touch_missing'); return }
    setOnce({
      first_touch_source: ft.source, first_touch_medium: ft.medium, first_touch_campaign: ft.campaign,
      first_touch_content: ft.content, first_touch_referrer: ft.referrer,
      first_touch_landing_path: ft.landing_path, first_touch_at: ft.at,
    })
    const { error } = await createClient().rpc('record_first_touch', { p: ft })
    reportWriteFailure('profile.first_touch', error)
  }

  // Required now: a single tap, and without it 88% of accounts had no known
  // source. Still never blocks the dashboard on the network: a failed write
  // loses one answer and is reported, rather than trapping the user.
  const finishHeardFrom = async (value: string, detail?: string) => {
    if (saving) return
    setHeardFrom(value)
    setSaving(true)
    const trimmed = detail?.trim().slice(0, 200) || null
    capture('heard_about_us', { source: value, has_detail: !!trimmed })
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const { error } = await supabase.from('profiles')
          .update({ heard_from: value, ...(trimmed ? { heard_from_detail: trimmed } : {}) })
          .eq('id', session.user.id)
        reportWriteFailure('profile.heard_from', error, { source: value })
      }
    } catch (e) {
      console.error('heard_from save failed:', e)
    }
    router.replace('/dashboard')
  }

  return (
    <main className="relative min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex items-center justify-center px-6 overflow-y-auto py-12">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[800px] h-[800px] rounded-full dark:bg-amber-600/[0.07] bg-yellow-500/[0.12] blur-[140px]" />
      </div>

      <div className="relative w-full max-w-[420px]">
        {/* Logo */}
        <p className="text-[13px] font-semibold tracking-[0.2em] text-amber-400/70 uppercase mb-10">
          Demist
        </p>

        {/* Step 1 */}
        {step === 1 && (
          <div key="step1" className="animate-step">
            <h1 className="text-[32px] sm:text-[38px] font-bold tracking-tight leading-tight mb-2">
              What are you<br />studying?
            </h1>
            <p className="dark:text-gray-500 text-gray-600 mb-8">
              We use this to get explanations at the right level.
            </p>

            <input
              type="text"
              value={course}
              onChange={e => setCourse(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && course.trim() && setStep(2)}
              placeholder="e.g. Molecular Biology, Computer Science…"
              autoFocus
              className="w-full dark:bg-white/[0.05] bg-[#FAF9F6] border dark:border-white/[0.1] border-black/[0.15] rounded-2xl px-5 py-4 dark:text-white text-gray-900 text-[15px] placeholder-gray-500 focus:outline-none focus:border-amber-500/50 transition-all"
            />

            <button
              onClick={() => setStep(2)}
              className="mt-4 w-full py-4 rounded-2xl text-[15px] font-semibold transition-all bg-amber-600 hover:brightness-[1.1] text-white"
            >
              {course.trim() ? 'Continue →' : 'Skip for now →'}
            </button>
          </div>
        )}

        {/* Step 2 */}
        {step === 2 && (
          <div key="step2" className="animate-step">
            <h1 className="text-[32px] sm:text-[38px] font-bold tracking-tight leading-tight mb-2">
              What year<br />are you in?
            </h1>
            <p className="dark:text-gray-500 text-gray-600 mb-8">
              So we get the depth just right.
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              {YEARS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setYear(value)}
                  className={`py-4 rounded-2xl text-[15px] font-medium transition-all ${
                    year === value
                      ? 'bg-amber-600 border border-amber-400/40 text-white shadow-[0_0_24px_rgba(245,158,11,0.35)]'
                      : 'dark:bg-white/[0.05] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.12] dark:text-gray-300 text-gray-700 dark:hover:bg-white/[0.09] hover:bg-white hover:border-black/[0.2] dark:hover:border-white/[0.15]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex gap-2.5 mt-4">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-4 rounded-2xl text-[15px] font-medium dark:bg-white/[0.05] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.12] dark:text-gray-400 text-gray-700 dark:hover:bg-white/[0.09] hover:bg-white transition-all"
              >
                ←
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!year}
                className="flex-1 py-4 rounded-2xl text-[15px] font-semibold bg-amber-600 hover:brightness-[1.1] disabled:opacity-25 disabled:cursor-not-allowed text-white transition-all"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 3 */}
        {step === 3 && (
          <div key="step3" className="animate-step">
            <h1 className="text-[32px] sm:text-[38px] font-bold tracking-tight leading-tight mb-2">
              Does anything make<br />lectures harder to follow?
            </h1>
            <p className="dark:text-gray-500 text-gray-600 mb-8">
              This tailors Demist to you. You can change it anytime in settings.
            </p>

            <div className="space-y-2.5">
              {SUPPORT_NEEDS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setSupportNeed(value)}
                  className={`w-full py-4 px-5 rounded-2xl text-[15px] font-medium text-left transition-all ${
                    supportNeed === value
                      ? 'bg-amber-600 border border-amber-400/40 text-white shadow-[0_0_24px_rgba(245,158,11,0.35)]'
                      : 'dark:bg-white/[0.05] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.12] dark:text-gray-300 text-gray-700 dark:hover:bg-white/[0.09] hover:bg-white hover:border-black/[0.2] dark:hover:border-white/[0.15]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex gap-2.5 mt-4">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-4 rounded-2xl text-[15px] font-medium dark:bg-white/[0.05] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.12] dark:text-gray-400 text-gray-700 dark:hover:bg-white/[0.09] hover:bg-white transition-all"
              >
                ←
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={!supportNeed}
                className="flex-1 py-4 rounded-2xl text-[15px] font-semibold bg-amber-600 hover:brightness-[1.1] disabled:opacity-25 disabled:cursor-not-allowed text-white transition-all"
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 4 */}
        {step === 4 && (
          <div key="step4" className="animate-step">
            <h1 className="text-[32px] sm:text-[38px] font-bold tracking-tight leading-tight mb-2">
              When&apos;s your<br />birthday?
            </h1>
            <p className="dark:text-gray-500 text-gray-600 mb-1">
              Demist is for users aged {MINIMUM_AGE} and over, so we need to check. We never share this.
            </p>
            <p className="text-[12px] dark:text-gray-600 text-gray-500 mb-6">
              Recording a lecture captures your lecturer too, and our Terms make that your responsibility.
            </p>
            <input
              type="date"
              value={dob}
              onChange={e => { setDob(e.target.value); if (saveError) setSaveError(null) }}
              max={new Date().toISOString().slice(0, 10)}
              aria-label="Date of birth"
              className="w-full dark:bg-white/[0.05] bg-[#FAF9F6] border dark:border-white/[0.1] border-black/[0.15] rounded-2xl px-5 py-4 dark:text-white text-gray-900 text-[15px] placeholder-gray-500 focus:outline-none focus:border-amber-500/50 transition-all"
            />
            {meetsMinimumAge(dob) === false && (
              <p className="text-[13px] text-red-400 mt-3">
                Sorry, you need to be {MINIMUM_AGE} or over to use Demist.
              </p>
            )}
            <p className="text-[12px] dark:text-gray-500 text-gray-600 mt-3 leading-relaxed">
              Demist&apos;s explanations are AI-generated and occasionally imperfect. Always check anything important against your course materials.
            </p>
            <div className="flex gap-2.5 mt-4">
              <button
                onClick={() => setStep(3)}
                className="px-6 py-4 rounded-2xl text-[15px] font-medium dark:bg-white/[0.05] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.12] dark:text-gray-400 text-gray-700 dark:hover:bg-white/[0.09] hover:bg-white transition-all"
              >
                ←
              </button>
              <button
                onClick={handleFinish}
                disabled={saving || meetsMinimumAge(dob) !== true}
                className="flex-1 py-4 rounded-2xl text-[15px] font-semibold bg-amber-600 hover:brightness-[1.1] disabled:opacity-25 disabled:cursor-not-allowed text-white transition-all"
              >
                {saving ? 'Setting up…' : 'Done →'}
              </button>
            </div>
          </div>
        )}

        {/* Step 5 - required, one tap, after the profile is already written */}
        {step === 5 && (
          <div key="step5" className="animate-step">
            <h1 className="text-[32px] sm:text-[38px] font-bold tracking-tight leading-tight mb-2">
              One last thing.<br />How did you find us?
            </h1>
            <p className="dark:text-gray-500 text-gray-600 mb-8">
              One tap. It tells us where to put our effort.
            </p>

            <div className="space-y-2.5">
              {HEARD_FROM.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => value === 'other' ? setOtherOpen(true) : finishHeardFrom(value)}
                  disabled={saving}
                  className={`w-full py-4 px-5 rounded-2xl text-[15px] font-medium text-left transition-all disabled:opacity-40 ${
                    heardFrom === value
                      ? 'bg-amber-600 border border-amber-400/40 text-white shadow-[0_0_24px_rgba(245,158,11,0.35)]'
                      : 'dark:bg-white/[0.05] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.12] dark:text-gray-300 text-gray-700 dark:hover:bg-white/[0.09] hover:bg-white hover:border-black/[0.2] dark:hover:border-white/[0.15]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {otherOpen && (
              <div className="mt-4 flex gap-2">
                <input
                  autoFocus
                  value={otherText}
                  onChange={e => setOtherText(e.target.value.slice(0, 200))}
                  onKeyDown={e => { if (e.key === 'Enter') finishHeardFrom('other', otherText) }}
                  placeholder="Where? (optional)"
                  aria-label="Where did you hear about Demist?"
                  className="flex-1 px-4 py-3.5 rounded-2xl text-[15px] dark:bg-white/[0.05] bg-[#FAF9F6] border dark:border-white/[0.08] border-black/[0.12] focus:outline-none focus:border-amber-500/60"
                />
                <button
                  onClick={() => finishHeardFrom('other', otherText)}
                  disabled={saving}
                  className="px-5 rounded-2xl text-[15px] font-semibold bg-amber-600 hover:brightness-[1.1] text-white disabled:opacity-40"
                >
                  Done
                </button>
              </div>
            )}

            {/* Stated up front, before the first recording, rather than at the
                moment a lecture disappears. Microsoft Store policy 10.8.4
                requires notice in advance where access to a user's own content
                is restricted, and more plainly: finding out your notes expired
                only when you go looking for them is a bad way to learn it. */}
            <p className="text-[12px] dark:text-gray-600 text-gray-500 mt-8 leading-relaxed text-center">
              {isTrial && <>Your first {REVERSE_TRIAL_DAYS} days are Pro, free and with no card. </>}
              Live definitions, your glossary and flashcards are free. Recording is free and
              unlimited in the Windows app; in the browser, free accounts get 3 recordings.
              Free accounts keep lecture history for {FREE_HISTORY_DAYS} days; Pro keeps everything.
            </p>
          </div>
        )}

        {saveError && (
          <p className="mt-4 text-sm text-red-400 text-center" role="alert">{saveError}</p>
        )}

        {/* Step dots */}
        <div className="flex items-center gap-2 mt-10">
          <div className={`h-1 rounded-full transition-all duration-400 ${step === 1 ? 'w-8 bg-amber-500' : 'w-2 dark:bg-white/20 bg-black/15'}`} />
          <div className={`h-1 rounded-full transition-all duration-400 ${step === 2 ? 'w-8 bg-amber-500' : 'w-2 dark:bg-white/20 bg-black/15'}`} />
          <div className={`h-1 rounded-full transition-all duration-400 ${step === 3 ? 'w-8 bg-amber-500' : 'w-2 dark:bg-white/20 bg-black/15'}`} />
          <div className={`h-1 rounded-full transition-all duration-400 ${step === 4 ? 'w-8 bg-amber-500' : 'w-2 dark:bg-white/20 bg-black/15'}`} />
          <div className={`h-1 rounded-full transition-all duration-400 ${step === 5 ? 'w-8 bg-amber-500' : 'w-2 dark:bg-white/20 bg-black/15'}`} />
        </div>
      </div>
    </main>
  )
}

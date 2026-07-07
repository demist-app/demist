'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { capture, identify } from '@/lib/analytics'

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

type SupportNeed = 'hearing' | 'dyslexia' | 'attention' | 'language' | 'other'

const SUPPORT_NEEDS: { value: SupportNeed; label: string }[] = [
  { value: 'hearing', label: 'Hearing' },
  { value: 'dyslexia', label: 'Reading or dyslexia' },
  { value: 'attention', label: 'Focus or attention' },
  { value: 'language', label: 'English isn’t my first language' },
  { value: 'other', label: 'Prefer not to say' },
]

export default function Onboarding() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [course, setCourse] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [supportNeed, setSupportNeed] = useState<SupportNeed | null>(null)
  const [dob, setDob] = useState('')
  const [saving, setSaving] = useState(false)
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
      capture('onboarding_completed', { course: course.trim() || null, year_of_study: year, support_need: supportNeed, has_dob: !!dob })
      router.replace('/dashboard')
    } catch (e) {
      console.error('onboarding save failed:', e)
      setSaveError('Could not save your profile. Check your connection and try again.')
      setSaving(false)
    }
  }

  return (
    <main className="relative min-h-dvh bg-[#080810] text-white flex items-center justify-center px-6 overflow-y-auto py-12">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[800px] h-[800px] rounded-full bg-amber-600/[0.07] blur-[140px]" />
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
            <p className="text-gray-500 mb-8">
              We use this to get explanations at the right level.
            </p>

            <input
              type="text"
              value={course}
              onChange={e => setCourse(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && course.trim() && setStep(2)}
              placeholder="e.g. Molecular Biology, Computer Science…"
              autoFocus
              className="w-full bg-white/[0.05] border border-white/[0.1] rounded-2xl px-5 py-4 text-white text-[15px] placeholder-gray-600 focus:outline-none focus:border-amber-500/50 focus:bg-white/[0.07] transition-all"
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
            <p className="text-gray-500 mb-8">
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
                      : 'bg-white/[0.05] border border-white/[0.08] text-gray-300 hover:bg-white/[0.09] hover:border-white/[0.15]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex gap-2.5 mt-4">
              <button
                onClick={() => setStep(1)}
                className="px-6 py-4 rounded-2xl text-[15px] font-medium bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:bg-white/[0.09] transition-all"
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
            <p className="text-gray-500 mb-8">
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
                      : 'bg-white/[0.05] border border-white/[0.08] text-gray-300 hover:bg-white/[0.09] hover:border-white/[0.15]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex gap-2.5 mt-4">
              <button
                onClick={() => setStep(2)}
                className="px-6 py-4 rounded-2xl text-[15px] font-medium bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:bg-white/[0.09] transition-all"
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
            <p className="text-gray-500 mb-1">
              We use this to keep Demist age-appropriate. We never share it.
            </p>
            <p className="text-[12px] text-gray-600 mb-6">Optional — you can skip this.</p>
            <input
              type="date"
              value={dob}
              onChange={e => setDob(e.target.value)}
              className="w-full bg-white/[0.05] border border-white/[0.1] rounded-2xl px-5 py-4 text-white text-[15px] placeholder-gray-600 focus:outline-none focus:border-amber-500/50 focus:bg-white/[0.07] transition-all"
            />
            <p className="text-[12px] text-gray-500 mt-3 leading-relaxed">
              Demist&apos;s explanations are AI-generated and occasionally imperfect. Always check anything important against your course materials.
            </p>
            <div className="flex gap-2.5 mt-4">
              <button
                onClick={() => setStep(3)}
                className="px-6 py-4 rounded-2xl text-[15px] font-medium bg-white/[0.05] border border-white/[0.08] text-gray-400 hover:bg-white/[0.09] transition-all"
              >
                ←
              </button>
              <button
                onClick={handleFinish}
                disabled={saving}
                className="flex-1 py-4 rounded-2xl text-[15px] font-semibold bg-amber-600 hover:brightness-[1.1] disabled:opacity-25 disabled:cursor-not-allowed text-white transition-all"
              >
                {saving ? 'Setting up…' : dob ? 'Done →' : 'Skip →'}
              </button>
            </div>
          </div>
        )}

        {saveError && (
          <p className="mt-4 text-sm text-red-400 text-center" role="alert">{saveError}</p>
        )}

        {/* Step dots */}
        <div className="flex items-center gap-2 mt-10">
          <div className={`h-1 rounded-full transition-all duration-400 ${step === 1 ? 'w-8 bg-amber-500' : 'w-2 bg-white/20'}`} />
          <div className={`h-1 rounded-full transition-all duration-400 ${step === 2 ? 'w-8 bg-amber-500' : 'w-2 bg-white/20'}`} />
          <div className={`h-1 rounded-full transition-all duration-400 ${step === 3 ? 'w-8 bg-amber-500' : 'w-2 bg-white/20'}`} />
          <div className={`h-1 rounded-full transition-all duration-400 ${step === 4 ? 'w-8 bg-amber-500' : 'w-2 bg-white/20'}`} />
        </div>
      </div>
    </main>
  )
}

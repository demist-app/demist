'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'

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

export default function Onboarding() {
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [course, setCourse] = useState('')
  const [year, setYear] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.replace('/login'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('course')
        .eq('id', data.user.id)
        .maybeSingle()
      if (profile?.course) router.replace('/dashboard')
    })
  }, [])

  const handleFinish = async () => {
    if (!year) return
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase
        .from('profiles')
        .upsert({ id: user.id, course: course.trim(), year_of_study: year })
    }
    router.replace('/dashboard')
  }

  return (
    <main className="relative min-h-dvh bg-[#080810] text-white flex items-center justify-center px-6 overflow-y-auto py-12">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="w-[800px] h-[800px] rounded-full bg-violet-600/[0.07] blur-[140px]" />
      </div>

      <div className="relative w-full max-w-[420px]">
        {/* Logo */}
        <p className="text-[13px] font-semibold tracking-[0.2em] text-violet-400/70 uppercase mb-10">
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
              className="w-full bg-white/[0.05] border border-white/[0.1] rounded-2xl px-5 py-4 text-white text-[15px] placeholder-gray-600 focus:outline-none focus:border-violet-500/50 focus:bg-white/[0.07] transition-all"
            />

            <button
              onClick={() => setStep(2)}
              disabled={!course.trim()}
              className="mt-4 w-full py-4 rounded-2xl text-[15px] font-semibold transition-all bg-violet-600 hover:bg-violet-500 disabled:opacity-25 disabled:cursor-not-allowed text-white"
            >
              Continue →
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
                      ? 'bg-violet-600 border border-violet-400/40 text-white shadow-[0_0_24px_rgba(139,92,246,0.35)]'
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
                onClick={handleFinish}
                disabled={!year || saving}
                className="flex-1 py-4 rounded-2xl text-[15px] font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-25 disabled:cursor-not-allowed text-white transition-all"
              >
                {saving ? "Setting up…" : "Let's go →"}
              </button>
            </div>
          </div>
        )}

        {/* Step dots */}
        <div className="flex items-center gap-2 mt-10">
          <div className={`h-1 rounded-full transition-all duration-400 ${step === 1 ? 'w-8 bg-violet-500' : 'w-2 bg-white/20'}`} />
          <div className={`h-1 rounded-full transition-all duration-400 ${step === 2 ? 'w-8 bg-violet-500' : 'w-2 bg-white/20'}`} />
        </div>
      </div>
    </main>
  )
}

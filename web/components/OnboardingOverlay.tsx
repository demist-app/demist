'use client'

import { useEffect, useState } from 'react'
import { capture } from '@/lib/analytics'
import { createClient } from '@/lib/supabase'

const STORAGE_KEY = 'demist_onboarding_seen'
const LANG_KEY = 'demist_language'

const LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Mandarin', 'Arabic', 'Portuguese',
  'Hindi', 'Italian', 'Japanese', 'Korean', 'Russian', 'Dutch', 'Turkish',
  'Polish', 'Swedish', 'Danish', 'Norwegian', 'Finnish', 'Greek', 'Hebrew',
  'Indonesian', 'Malay', 'Thai', 'Vietnamese', 'Czech', 'Hungarian', 'Romanian',
  'Ukrainian', 'Catalan', 'Tagalog', 'Swahili', 'Bengali', 'Punjabi', 'Urdu',
  'Persian', 'Afrikaans', 'Welsh', 'Irish', 'Slovak', 'Croatian', 'Bulgarian',
  'Serbian', 'Slovenian', 'Lithuanian', 'Latvian', 'Estonian', 'Icelandic', 'Other',
]

const HOW_STEPS = [
  {
    title: 'Hit record before your lecture starts',
    body: 'Demist listens through your mic or a browser tab.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
      </svg>
    ),
  },
  {
    title: "Unfamiliar terms get caught as they're spoken",
    body: 'A quiet card appears with a plain-English definition. No Googling mid-lecture.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
    ),
  },
  {
    title: 'Review your glossary and flashcards after',
    body: 'Every term becomes a flashcard automatically. Spaced repetition does the rest.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
]

type Step = 'how' | 'language' | 'consent'

export function OnboardingOverlay() {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState<Step>('how')
  const [selectedLang, setSelectedLang] = useState<string | null>(null)

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return
    setVisible(true)
    capture('onboarding_overlay_shown')
  }, [])

  if (!visible) return null

  const finish = async () => {
    localStorage.setItem(STORAGE_KEY, '1')
    if (selectedLang) {
      localStorage.setItem(LANG_KEY, selectedLang)
      try {
        const supabase = createClient()
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.user) {
          await supabase.from('profiles').upsert({ id: session.user.id, native_language: selectedLang })
        }
      } catch {}
    }
    capture('onboarding_overlay_completed', { language: selectedLang ?? 'not_set' })
    setVisible(false)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:px-4 bg-black/25"
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Demist"
    >
      <div className="w-full max-w-md bg-[#FDFCF9] border border-black/[0.10] rounded-t-[24px] sm:rounded-[24px] shadow-xl animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>

        {/* ── Step 1: How it works ── */}
        {step === 'how' && (
          <div className="p-6 sm:p-7">
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-amber-700/80 mb-1.5">Welcome to Demist</p>
            <p className="text-[20px] font-bold text-gray-900 mb-5">Never feel lost in a lecture again</p>

            <div className="space-y-4 mb-6">
              {HOW_STEPS.map((s, i) => (
                <div key={i} className="flex items-start gap-3 animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: `${(i + 1) * 90}ms` }}>
                  <div className="shrink-0 w-8 h-8 rounded-xl bg-amber-500/[0.08] border border-amber-600/20 flex items-center justify-center text-amber-700">
                    {s.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-gray-900 leading-snug">{s.title}</p>
                    <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: '360ms' }}>
              <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-gray-500 mb-2">What a term card looks like</p>
              <div className="rounded-2xl px-4 py-3.5 bg-[#FAF9F6] border border-amber-400/40 mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-[3px] self-stretch rounded-full shrink-0 bg-amber-600" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] font-bold tracking-[0.18em] uppercase text-amber-700/80 mb-1">Just detected</p>
                    <p className="text-[14px] font-semibold text-gray-900">Elasticity of Demand</p>
                    <p className="text-[12px] leading-relaxed mt-0.5 text-gray-600">How sensitive consumer demand is to a change in price or income.</p>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setStep('language')}
                className="w-full py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Language ── */}
        {step === 'language' && (
          <div className="p-6 sm:p-7">
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-amber-700/80 mb-1.5">One quick thing</p>
            <p className="text-[20px] font-bold text-gray-900 mb-1">What's your native language?</p>
            <p className="text-[13px] text-gray-500 mb-4">Demist uses this to tailor definitions for you.</p>

            <div className="h-[200px] overflow-y-auto rounded-2xl border border-black/[0.08] bg-[#FAF9F6] p-3 mb-2">
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map(lang => (
                  <button
                    key={lang}
                    onClick={() => setSelectedLang(lang)}
                    className={`px-3.5 py-2 rounded-xl text-[13px] font-medium border transition-colors active:scale-[0.96] ${
                      selectedLang === lang
                        ? 'bg-yellow-50 border-yellow-500/40 text-yellow-800'
                        : 'bg-white border-black/[0.12] text-gray-700 hover:border-yellow-400/40'
                    }`}
                  >
                    {lang === 'English' ? 'English (this is my first language)' : lang}
                  </button>
                ))}
              </div>
            </div>

            {!selectedLang && (
              <p className="text-[11px] text-amber-600 mb-3 text-center">Please select your native language to continue</p>
            )}

            <button
              onClick={() => selectedLang && setStep('consent')}
              disabled={!selectedLang}
              className="w-full py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150 disabled:opacity-40 disabled:cursor-not-allowed mt-1"
            >
              Continue →
            </button>
          </div>
        )}

        {/* ── Step 3: Consent ── */}
        {step === 'consent' && (
          <div className="p-6 sm:p-7">
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-amber-700/80 mb-1.5">Before you start</p>
            <p className="text-[20px] font-bold text-gray-900 mb-4">A note on recording</p>

            <div className="space-y-3 mb-6">
              <div className="rounded-2xl bg-amber-50 border border-amber-400/30 px-4 py-3.5">
                <p className="text-[13px] font-semibold text-amber-900 mb-1">Recording lectures</p>
                <p className="text-[12px] text-amber-800/80 leading-relaxed">
                  Many universities allow lecture recording as a learning support measure. If that doesn't apply to you, check your institution's policy or get your lecturer's consent from Settings before recording.
                </p>
              </div>

              <div className="rounded-2xl bg-[#FAF9F6] border border-black/[0.08] px-4 py-3.5 space-y-2.5">
                <p className="text-[12px] font-semibold text-gray-800">How your audio is handled</p>
                <ul className="space-y-1.5">
                  {[
                    'Audio is processed in real time and is not stored permanently',
                    'Only transcribed text and detected terms are saved to your account',
                    'Nothing is shared with third parties except the AI transcription service',
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px] text-gray-600">
                      <span className="mt-0.5 text-emerald-600 shrink-0">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <button
              onClick={finish}
              className="w-full py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150"
            >
              Got it, let&apos;s go
            </button>
          </div>
        )}

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5 pb-4">
          {(['how', 'language', 'consent'] as Step[]).map(s => (
            <div
              key={s}
              className={`h-1.5 rounded-full transition-all duration-300 ${step === s ? 'w-4 bg-yellow-500' : 'w-1.5 bg-black/[0.12]'}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

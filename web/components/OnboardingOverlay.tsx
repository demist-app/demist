'use client'

import { useEffect, useState } from 'react'
import { capture } from '@/lib/analytics'

const STORAGE_KEY = 'demist_onboarding_seen'

const STEPS = [
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
    title: 'Unfamiliar terms get caught as they’re spoken',
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

export function OnboardingOverlay() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return
    setVisible(true)
    capture('onboarding_overlay_shown')
  }, [])

  if (!visible) return null

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1')
    capture('onboarding_overlay_dismissed')
    setVisible(false)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-black/25"
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      aria-label="How Demist works"
    >
      <div className="w-full max-w-md bg-[#FDFCF9] border border-black/[0.10] rounded-[24px] shadow-xl p-6 sm:p-7 animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
        <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-amber-700/80 mb-1.5">
          Welcome to Demist
        </p>
        <p className="text-[20px] font-bold text-gray-900 mb-5">
          Never feel lost in a lecture again
        </p>

        <div className="space-y-4 mb-6">
          {STEPS.map((step, i) => (
            <div key={i} className="flex items-start gap-3 animate-step opacity-0" style={{ animationFillMode: 'forwards', animationDelay: `${(i + 1) * 90}ms` }}>
              <div className="shrink-0 w-8 h-8 rounded-xl bg-amber-500/[0.08] border border-amber-600/20 flex items-center justify-center text-amber-700">
                {step.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-gray-900 leading-snug">{step.title}</p>
                <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{step.body}</p>
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
            onClick={dismiss}
            className="w-full py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150"
          >
            Got it, let&apos;s go
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

const SPRING = 'cubic-bezier(0.16, 1, 0.3, 1)'
const BOUNCE = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

function anim(delay: number, duration = 580) {
  return { style: { animation: `step-fade-up ${duration}ms ${SPRING} ${delay}ms both` } }
}

function useInView(threshold = 0.08) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); obs.disconnect() }
    }, { threshold })
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}

function scrollAnim(visible: boolean, delay: number, duration = 560) {
  return visible
    ? { style: { animation: `step-fade-up ${duration}ms ${SPRING} ${delay}ms both` } }
    : { style: { opacity: 0, transform: 'translateY(18px)' } }
}

// Deterministic waveform bar heights
const BARS = [10, 22, 34, 26, 14, 38, 28, 18, 32, 42, 30, 16, 36, 26, 18, 12, 30, 22, 14, 20]

// Update CHROME_STORE_URL once the Web Store listing is live
const CHROME_STORE_URL: string | null = null
// Put your zipped extension in web/public/demist-extension.zip
const EXTENSION_DOWNLOAD_URL = '/demist-extension.zip'

const FEATURES = [
  {
    title: 'Listens in real time',
    body: 'Processes audio every 10 seconds and surfaces definitions the moment a term appears — not after the lecture.',
    Icon: MicIcon,
  },
  {
    title: 'Builds your glossary',
    body: 'Every detected term is saved to your personal library, organised by session and subject. Search anything, any time.',
    Icon: BookIcon,
  },
  {
    title: 'Reinforces with flashcards',
    body: 'Terms queue automatically for spaced repetition review. The more you review, the longer the gaps between sessions.',
    Icon: CardIcon,
  },
]

const STEPS = [
  {
    n: '01',
    title: 'Open Demist before your lecture',
    body: 'No download, no setup. Open the web app, hit record, and keep your notes open alongside it.',
  },
  {
    n: '02',
    title: 'Terms appear as you listen',
    body: 'Unfamiliar concepts surface as subtle cards that disappear after a few seconds. Never intrusive — only when it matters.',
  },
  {
    n: '03',
    title: 'Review after. Retain forever.',
    body: 'Your full session glossary is waiting after the lecture. Flashcards queue themselves based on what needs your attention.',
  },
]

export default function LandingClient() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [elapsed, setElapsed] = useState(154)

  const featuresRef = useInView()
  const stepsRef = useInView()
  const extRef = useInView()
  const ctaRef = useInView()

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) setAuthed(true)
    })
  }, [])

  useEffect(() => {
    const t = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const cta = () => {
    posthog.capture('get_started_clicked')
    router.push(authed ? '/dashboard' : '/login')
  }

  return (
    <main className="relative bg-[#080810] text-white overflow-x-hidden">

      {/* Fixed ambient glows */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[900px] h-[900px] rounded-full bg-violet-600/[0.065] blur-[150px] animate-float"
        />
        <div
          className="absolute bottom-0 right-0 w-[500px] h-[500px] rounded-full bg-indigo-700/[0.045] blur-[110px] animate-float"
          style={{ animationDelay: '-4s' }}
        />
      </div>

      {/* ── Nav ── */}
      <header
        className="relative z-20 flex items-center justify-between px-6 sm:px-12 h-16"
        {...anim(0)}
      >
        <span className="text-[13px] font-bold tracking-[0.2em] text-violet-400/70 uppercase select-none">
          Demist
        </span>
        <button
          onClick={cta}
          className="text-[13px] font-medium text-gray-500 hover:text-white transition-colors duration-200"
        >
          {authed ? 'Open app →' : 'Sign in'}
        </button>
      </header>

      {/* ── Hero ── */}
      <section className="relative z-10 min-h-[calc(100dvh-4rem)] flex flex-col items-center justify-center text-center px-6 pb-12">

        <p className="text-[11px] font-bold tracking-[0.24em] text-violet-400/60 uppercase mb-6" {...anim(60)}>
          For university students
        </p>

        <h1
          className="text-[44px] sm:text-[66px] lg:text-[76px] font-bold tracking-tight leading-[1.04] mb-6 max-w-3xl"
          {...anim(150)}
        >
          Never feel{' '}
          <span className="text-violet-400">lost</span>
          <br />in a lecture again.
        </h1>

        <p
          className="text-gray-500 text-[16px] sm:text-[18px] leading-relaxed mb-10 max-w-[480px]"
          {...anim(240)}
        >
          Demist listens as you learn and quietly surfaces definitions for unfamiliar terms — so you stay focused without falling behind.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-3 mb-16" {...anim(320)}>
          <button
            onClick={cta}
            className="px-8 py-4 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[15px] transition-all duration-200 hover:shadow-[0_0_44px_rgba(139,92,246,0.42)] active:scale-95 select-none"
          >
            {authed ? 'Open app →' : 'Get started free →'}
          </button>
          <button
            onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            className="text-[14px] text-gray-600 hover:text-gray-400 transition-colors px-3 py-4 select-none"
          >
            See how it works ↓
          </button>
        </div>

        {/* Product mockup */}
        <div className="w-full max-w-[340px] mx-auto" {...anim(440, 700)}>
          <div className="bg-[#0b0b17] border border-white/[0.07] rounded-3xl p-5 shadow-[0_0_80px_rgba(139,92,246,0.09),inset_0_0_0_1px_rgba(255,255,255,0.03)]">

            {/* Top bar */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="font-mono text-[12px] text-gray-600">{fmt(elapsed)}</span>
              </div>
              <span className="text-[11px] text-gray-700">Microeconomics · Year 2</span>
            </div>

            {/* Term card — bounces in after hero settles */}
            <div
              className="bg-white/[0.04] border border-violet-500/[0.18] rounded-2xl p-4 mb-5 shadow-[0_0_30px_rgba(139,92,246,0.07)]"
              style={{ animation: `term-slide-up 640ms ${BOUNCE} 1100ms both` }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-[3px] rounded-full bg-violet-500/60 shrink-0"
                  style={{ alignSelf: 'stretch', minHeight: 48 }}
                />
                <div>
                  <p className="text-[10px] font-bold tracking-[0.18em] text-violet-400/60 uppercase mb-1.5">
                    Just detected
                  </p>
                  <p className="text-[14px] font-semibold text-white/90 mb-1">
                    Elasticity of Demand
                  </p>
                  <p className="text-[12px] text-gray-500 leading-relaxed">
                    How sensitive consumer demand is to a change in price or income.
                  </p>
                </div>
              </div>
            </div>

            {/* Waveform */}
            <div className="flex items-end gap-[3px] h-10 px-1" style={{ transformOrigin: 'bottom' }}>
              {BARS.map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-full"
                  style={{
                    height: `${h}px`,
                    transformOrigin: 'bottom',
                    background: `rgba(139,92,246,${0.22 + (h / 42) * 0.58})`,
                    animation: `equalizer ${0.9 + (i % 5) * 0.15}s ease-in-out ${i * 55}ms infinite alternate`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Scroll cue */}
        <div className="mt-10 flex flex-col items-center gap-2" {...anim(800)}>
          <div
            className="w-px h-8 bg-gradient-to-b from-transparent to-white/20"
            style={{ animation: 'glow-float 2s ease-in-out infinite' }}
          />
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" ref={featuresRef.ref} className="relative z-10 px-6 sm:px-12 py-28 max-w-5xl mx-auto">
        <p className="text-[10px] font-bold tracking-[0.2em] text-gray-600 uppercase mb-4 text-center"
          {...scrollAnim(featuresRef.visible, 0)}>
          What it does
        </p>
        <h2
          className="text-[30px] sm:text-[42px] font-bold tracking-tight text-center mb-14 leading-tight"
          {...scrollAnim(featuresRef.visible, 80)}
        >
          Everything you need.{' '}
          <span className="text-gray-600 font-normal">Nothing you don't.</span>
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {FEATURES.map(({ title, body, Icon }, i) => (
            <div
              key={title}
              className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-6 group hover:bg-white/[0.05] hover:border-white/[0.1] transition-all duration-300"
              {...scrollAnim(featuresRef.visible, 160 + i * 110)}
            >
              <div className="w-9 h-9 rounded-xl bg-violet-600/10 border border-violet-500/20 flex items-center justify-center mb-5 text-violet-400 group-hover:bg-violet-600/16 group-hover:border-violet-500/30 transition-all duration-300">
                <Icon />
              </div>
              <p className="text-[15px] font-semibold text-white/90 mb-2">{title}</p>
              <p className="text-[13px] text-gray-600 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section ref={stepsRef.ref} className="relative z-10 px-6 sm:px-12 py-28 max-w-2xl mx-auto">
        <p
          className="text-[10px] font-bold tracking-[0.2em] text-gray-600 uppercase mb-4 text-center"
          {...scrollAnim(stepsRef.visible, 0)}
        >
          How it works
        </p>
        <h2
          className="text-[30px] sm:text-[42px] font-bold tracking-tight text-center mb-16 leading-tight"
          {...scrollAnim(stepsRef.visible, 80)}
        >
          From zero to glossary{' '}
          <span className="text-gray-600 font-normal">in one lecture.</span>
        </h2>
        <div>
          {STEPS.map(({ n, title, body }, i) => (
            <div
              key={n}
              className="flex gap-6 py-8 border-b border-white/[0.05] last:border-0 group"
              {...scrollAnim(stepsRef.visible, 160 + i * 100)}
            >
              <span className="text-[13px] font-bold text-violet-500/35 tabular-nums pt-0.5 w-8 shrink-0 group-hover:text-violet-400/70 transition-colors duration-300">
                {n}
              </span>
              <div>
                <p className="text-[17px] font-semibold text-white/90 mb-2 leading-snug">{title}</p>
                <p className="text-[14px] text-gray-600 leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Extension ── */}
      <section ref={extRef.ref} className="relative z-10 px-6 sm:px-12 py-28 max-w-3xl mx-auto text-center">
        <p className="text-[10px] font-bold tracking-[0.2em] text-gray-600 uppercase mb-4"
          {...scrollAnim(extRef.visible, 0)}>
          Chrome Extension
        </p>
        <h2
          className="text-[30px] sm:text-[42px] font-bold tracking-tight mb-4 leading-tight"
          {...scrollAnim(extRef.visible, 80)}
        >
          Term popups,{' '}
          <span className="text-gray-600 font-normal">anywhere you learn.</span>
        </h2>
        <p
          className="text-gray-600 text-[15px] leading-relaxed mb-10 max-w-[460px] mx-auto"
          {...scrollAnim(extRef.visible, 160)}
        >
          The Demist extension surfaces definitions on any page — lecture slides, YouTube, PDFs, reading lists. Pairs with the web app automatically.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3" {...scrollAnim(extRef.visible, 240)}>
          {CHROME_STORE_URL ? (
            <a
              href={CHROME_STORE_URL}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[15px] transition-all hover:shadow-[0_0_40px_rgba(139,92,246,0.4)] active:scale-95"
            >
              <ChromeIcon />
              Add to Chrome
            </a>
          ) : (
            <div className="relative">
              <div className="flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-white/30 font-semibold text-[15px] cursor-not-allowed select-none">
                <ChromeIcon />
                Add to Chrome
              </div>
              <span className="absolute -top-2.5 -right-2.5 text-[10px] font-bold tracking-[0.1em] text-violet-400 bg-violet-600/20 border border-violet-500/30 rounded-full px-2 py-0.5 uppercase">
                Soon
              </span>
            </div>
          )}

          <a
            href={EXTENSION_DOWNLOAD_URL}
            download
            className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-white/[0.05] border border-white/[0.09] text-white/70 hover:text-white hover:bg-white/[0.08] hover:border-white/[0.14] transition-all text-[15px] font-medium"
          >
            <DownloadIcon />
            Download beta
          </a>
        </div>

        {!CHROME_STORE_URL && (
          <div className="mt-8 bg-white/[0.03] border border-white/[0.06] rounded-2xl px-6 py-5 max-w-sm mx-auto text-left" {...scrollAnim(extRef.visible, 320)}>
            <p className="text-[11px] font-bold tracking-[0.16em] text-gray-600 uppercase mb-3">Manual install (beta)</p>
            <ol className="space-y-2">
              {[
                'Download and unzip the file',
                'Go to chrome://extensions',
                'Enable Developer mode (top right)',
                'Click Load unpacked → select the folder',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="text-[11px] font-bold text-violet-500/50 mt-[3px] shrink-0 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-[13px] text-gray-500">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {/* ── Final CTA ── */}
      <section ref={ctaRef.ref} className="relative z-10 px-6 py-36 text-center">
        <h2
          className="text-[34px] sm:text-[52px] font-bold tracking-tight mb-4 leading-[1.08] max-w-lg mx-auto"
          {...scrollAnim(ctaRef.visible, 0)}
        >
          Start your next lecture
          <br />already ahead.
        </h2>
        <p
          className="text-gray-600 text-[16px] mb-10"
          {...scrollAnim(ctaRef.visible, 100)}
        >
          Free to use. Works in your browser.
        </p>
        <div {...scrollAnim(ctaRef.visible, 180)}>
          <button
            onClick={cta}
            className="px-10 py-5 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[16px] transition-all duration-200 hover:shadow-[0_0_60px_rgba(139,92,246,0.48)] active:scale-95 select-none"
          >
            {authed ? 'Open app →' : 'Get started free →'}
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 px-6 sm:px-12 py-8 border-t border-white/[0.04] flex items-center justify-between gap-4">
        <span className="text-[11px] font-bold tracking-[0.2em] text-gray-700 uppercase">Demist</span>
        <div className="flex items-center gap-5">
          <a href="/privacy" className="text-[12px] text-gray-700 hover:text-gray-500 transition-colors">Privacy</a>
          <p className="text-[12px] text-gray-700">© {new Date().getFullYear()} Demist</p>
        </div>
      </footer>
    </main>
  )
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  )
}

function BookIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function CardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  )
}

function ChromeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="4" />
      <line x1="21.17" y1="8" x2="12" y2="8" />
      <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
      <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

const SPRING = 'cubic-bezier(0.16, 1, 0.3, 1)'

function anim(delay: number, duration = 700) {
  return { style: { animation: `step-fade-up ${duration}ms ${SPRING} ${delay}ms both` } }
}

function useInView(threshold = 0.06) {
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

function scrollAnim(visible: boolean, delay: number, duration = 650) {
  return visible
    ? { style: { animation: `step-fade-up ${duration}ms ${SPRING} ${delay}ms both` } }
    : { style: { opacity: 0, transform: 'translateY(22px)' } }
}

/* ─── Waveform data — 72 bars, realistic speech-like envelope ─────────── */
const WAVE_BASE = [
  18, 28, 42, 58, 72, 86, 98, 108, 116, 120, 114, 104, 90, 76, 62, 48, 36, 26, 20,
  30, 46, 64, 80, 96, 110, 118, 112, 100, 86, 70, 54, 38, 28, 22, 32, 50, 68, 84,
  100, 114, 120, 116, 106, 92, 78, 64, 48, 34, 24, 18, 26, 44, 62, 78, 94, 108, 116,
  112, 102, 88, 74, 58, 42, 30, 20, 16, 24, 40, 58, 76, 92, 104,
]

const CHROME_STORE_URL: string | null = null
const EXTENSION_DOWNLOAD_URL = '/demist-extension.zip'

const FEATURES = [
  { title: 'Live term detection',       body: 'Definitions pop up as your lecturer speaks — matched to your subject and year.',    hero: true },
  { title: 'Automatic glossary',        body: 'Every detected term saves itself. Your glossary fills while you focus.',             hero: false },
  { title: 'Spaced repetition',         body: 'SM-2 algorithm schedules each term at the exact moment you\'re about to forget it.', hero: false },
  { title: 'AI session summaries',      body: 'Stop recording and Demist generates a full summary alongside your term list.',       hero: false },
  { title: 'YouTube & file import',     body: 'Paste a URL or upload a recording, deck, or transcript. Terms extracted in seconds.', hero: true, tag: 'New' },
  { title: 'Full session history',      body: 'Every lecture stored with terms, transcript, and summary. Return to anything.',       hero: false },
  { title: 'Notion sync',               body: 'Push your glossary to Notion or pull lecture notes in — one tap.',                    hero: false, tag: 'New' },
]

const STEPS = [
  { n: '01', title: 'Record live or import from anywhere',       body: 'Tap record before a lecture, paste a YouTube URL, or upload a recording or slide deck.' },
  { n: '02', title: 'Unfamiliar terms are explained instantly',  body: 'Definitions appear on screen the moment your lecturer says something you might not know.' },
  { n: '03', title: 'Your glossary builds itself',               body: 'Every term saves with its definition. Flashcards queue automatically — reviewed at the right time.' },
]

export default function LandingClient() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [scrollY, setScrollY] = useState(0)

  const featuresRef = useInView()
  const stepsRef = useInView()
  const extRef = useInView()
  const ctaRef = useInView()

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (data.user) setAuthed(true)
    })
  }, [])

  /* Scroll tracker for waveform */
  useEffect(() => {
    const onScroll = () => setScrollY(window.scrollY)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const cta = () => {
    posthog.capture('get_started_clicked')
    router.push(authed ? '/dashboard' : '/login')
  }

  /* Waveform bar height driven by scroll — 0→400px scroll maps to full animation */
  const waveProgress = Math.min(scrollY / 380, 1)
  const barHeight = (base: number, idx: number) => {
    const wave = Math.sin(waveProgress * Math.PI * 2.5 + idx * 0.22)
    const scale = 0.08 + waveProgress * 0.92
    return Math.max(3, base * scale * (0.55 + 0.45 * wave))
  }

  return (
    <main className="relative bg-[#08080E] text-white overflow-x-hidden">

      {/* ── Minimal top nav ── */}
      <header className="fixed top-0 inset-x-0 z-30 flex items-center justify-between px-6 sm:px-14 h-14" {...anim(0, 500)}>
        <span className="text-[14px] font-semibold text-white tracking-tight select-none">Demist</span>
        <button
          onClick={cta}
          className="text-[13px] font-medium text-white/35 hover:text-white/80 transition-colors duration-200 cursor-pointer select-none"
        >
          {authed ? 'Open app →' : 'Sign in'}
        </button>
      </header>

      {/* ── Hero ── */}
      <section className="relative min-h-dvh flex flex-col items-center justify-center px-6 sm:px-14 pb-0 pt-14 overflow-hidden">

        {/* Heading — above the waveform */}
        <div className="flex-1 flex flex-col items-center justify-end pb-8 sm:pb-12 text-center">
          <h1
            className="text-[52px] sm:text-[78px] lg:text-[96px] font-bold tracking-[-0.03em] leading-[1.0] max-w-4xl"
            {...anim(100, 900)}
          >
            Never feel lost
            <br />
            <span className="text-white/40">in a lecture again.</span>
          </h1>
        </div>

        {/* ── Scroll-driven waveform band ── */}
        <div
          className="w-screen relative left-1/2 right-1/2 -mx-[50vw] flex items-end justify-center gap-[3px] sm:gap-[4px] overflow-hidden"
          style={{ height: '140px', padding: '0 0 4px', ...anim(300, 800).style }}
        >
          {WAVE_BASE.map((base, i) => {
            const h = barHeight(base, i)
            const opacity = 0.12 + (h / 120) * 0.70
            return (
              <div
                key={i}
                className="rounded-full shrink-0 transition-none"
                style={{
                  width: 'clamp(3px, 0.9vw, 10px)',
                  height: `${h}px`,
                  background: `rgba(255,255,255,${opacity.toFixed(3)})`,
                  willChange: 'height',
                  transformOrigin: 'bottom',
                }}
              />
            )
          })}
        </div>

        {/* Subheading + CTA — below the waveform */}
        <div className="flex-1 flex flex-col items-center justify-start pt-8 sm:pt-12 text-center">
          <p
            className="text-white/40 text-[16px] sm:text-[18px] leading-relaxed max-w-[480px] mb-9"
            {...anim(500, 700)}
          >
            Record a live lecture or import from YouTube, audio, or slides. Demist catches every unfamiliar term, explains it on screen, and builds your glossary automatically.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-3" {...anim(640, 700)}>
            <button
              onClick={cta}
              className="px-7 py-3.5 rounded-xl bg-white text-[#08080E] font-semibold text-[14px] hover:bg-white/90 active:scale-[0.97] transition-all duration-150 select-none cursor-pointer"
            >
              {authed ? 'Open app →' : 'Get started free →'}
            </button>
            <button
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="text-[13px] text-white/30 hover:text-white/60 transition-colors px-3 py-3 select-none cursor-pointer"
            >
              See features
            </button>
          </div>
        </div>

      </section>

      {/* ── Features ── */}
      <section id="features" ref={featuresRef.ref} className="relative z-10 px-6 sm:px-14 py-32 max-w-6xl mx-auto">
        <div className="mb-20" {...scrollAnim(featuresRef.visible, 0)}>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-white/25 uppercase mb-5">What Demist does</p>
          <h2 className="text-[32px] sm:text-[48px] font-bold tracking-[-0.02em] leading-[1.06] max-w-xl">
            Everything you need.
            <br /><span className="text-white/30 font-medium">Nothing you don&apos;t.</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/[0.06] rounded-2xl overflow-hidden border border-white/[0.06]">

          {/* Wide hero card — Live detection */}
          <div
            className="sm:col-span-2 bg-[#08080E] p-8 hover:bg-white/[0.02] transition-colors duration-200"
            style={scrollAnim(featuresRef.visible, 60).style}
          >
            <p className="text-[11px] font-semibold tracking-[0.18em] text-white/25 uppercase mb-4">Core feature</p>
            <p className="text-[22px] font-semibold text-white leading-snug mb-3">{FEATURES[0].title}</p>
            <p className="text-[14px] text-white/40 leading-relaxed max-w-sm">{FEATURES[0].body}</p>
          </div>

          <div className="bg-[#08080E] p-8 hover:bg-white/[0.02] transition-colors duration-200" style={scrollAnim(featuresRef.visible, 100).style}>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-white/25 uppercase mb-4">&nbsp;</p>
            <p className="text-[18px] font-semibold text-white leading-snug mb-3">{FEATURES[1].title}</p>
            <p className="text-[13px] text-white/40 leading-relaxed">{FEATURES[1].body}</p>
          </div>

          <div className="bg-[#08080E] p-8 hover:bg-white/[0.02] transition-colors duration-200 border-t border-white/[0.06]" style={scrollAnim(featuresRef.visible, 140).style}>
            <p className="text-[18px] font-semibold text-white leading-snug mb-3">{FEATURES[2].title}</p>
            <p className="text-[13px] text-white/40 leading-relaxed">{FEATURES[2].body}</p>
          </div>

          <div className="bg-[#08080E] p-8 hover:bg-white/[0.02] transition-colors duration-200 border-t border-white/[0.06]" style={scrollAnim(featuresRef.visible, 170).style}>
            <p className="text-[18px] font-semibold text-white leading-snug mb-3">{FEATURES[3].title}</p>
            <p className="text-[13px] text-white/40 leading-relaxed">{FEATURES[3].body}</p>
          </div>

          <div className="bg-[#08080E] p-8 hover:bg-white/[0.02] transition-colors duration-200 border-t border-white/[0.06]" style={scrollAnim(featuresRef.visible, 200).style}>
            <p className="text-[18px] font-semibold text-white leading-snug mb-3">{FEATURES[5].title}</p>
            <p className="text-[13px] text-white/40 leading-relaxed">{FEATURES[5].body}</p>
          </div>

          {/* Wide hero — import */}
          <div
            className="sm:col-span-2 bg-[#08080E] p-8 hover:bg-white/[0.02] transition-colors duration-200 border-t border-white/[0.06]"
            style={scrollAnim(featuresRef.visible, 230).style}
          >
            <div className="flex items-start justify-between mb-4">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-white/25 uppercase">Import</p>
              <span className="text-[10px] font-bold tracking-[0.12em] text-amber-400 border border-amber-500/[0.30] rounded-md px-2 py-0.5 uppercase">New</span>
            </div>
            <p className="text-[22px] font-semibold text-white leading-snug mb-3">{FEATURES[4].title}</p>
            <p className="text-[14px] text-white/40 leading-relaxed max-w-sm">{FEATURES[4].body}</p>
          </div>

          <div
            className="bg-[#08080E] p-8 hover:bg-white/[0.02] transition-colors duration-200 border-t border-white/[0.06]"
            style={scrollAnim(featuresRef.visible, 260).style}
          >
            <div className="flex items-center justify-between mb-4">
              <p className="text-[11px] font-semibold tracking-[0.18em] text-white/25 uppercase">&nbsp;</p>
              <span className="text-[10px] font-bold tracking-[0.12em] text-amber-400 border border-amber-500/[0.30] rounded-md px-2 py-0.5 uppercase">New</span>
            </div>
            <p className="text-[18px] font-semibold text-white leading-snug mb-3">{FEATURES[6].title}</p>
            <p className="text-[13px] text-white/40 leading-relaxed">{FEATURES[6].body}</p>
          </div>

        </div>
      </section>

      {/* ── How it works ── */}
      <section ref={stepsRef.ref} className="relative z-10 px-6 sm:px-14 py-32 max-w-3xl mx-auto">
        <div className="mb-20" {...scrollAnim(stepsRef.visible, 0)}>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-white/25 uppercase mb-5">How it works</p>
          <h2 className="text-[32px] sm:text-[48px] font-bold tracking-[-0.02em] leading-[1.06]">
            Three steps.
            <br /><span className="text-white/30 font-medium">That&apos;s it.</span>
          </h2>
        </div>
        <div>
          {STEPS.map(({ n, title, body }, i) => (
            <div
              key={n}
              className="flex gap-8 py-9 border-b border-white/[0.06] last:border-0 group"
              {...scrollAnim(stepsRef.visible, 80 + i * 100)}
            >
              <span className="font-mono text-[12px] font-semibold text-white/18 tabular-nums pt-1.5 w-7 shrink-0 group-hover:text-white/40 transition-colors duration-300">
                {n}
              </span>
              <div>
                <p className="text-[19px] font-semibold text-white/90 mb-3 leading-snug">{title}</p>
                <p className="text-[14px] text-white/40 leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Extension ── */}
      <section ref={extRef.ref} className="relative z-10 px-6 sm:px-14 py-32 max-w-3xl mx-auto">
        <div className="mb-12" {...scrollAnim(extRef.visible, 0)}>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-white/25 uppercase mb-5">Chrome Extension</p>
          <h2 className="text-[32px] sm:text-[48px] font-bold tracking-[-0.02em] leading-[1.06]">
            Keep your notes open.
            <br /><span className="text-white/30 font-medium">Terms show in a side panel.</span>
          </h2>
          <p className="text-white/40 text-[15px] leading-relaxed mt-5 max-w-lg">
            Start recording in Demist, then switch to your slides or notes. The extension keeps a live panel on the side showing every term as it&apos;s detected.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3" {...scrollAnim(extRef.visible, 120)}>
          {CHROME_STORE_URL ? (
            <a
              href={CHROME_STORE_URL}
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-white text-[#08080E] font-semibold text-[14px] hover:bg-white/90 active:scale-[0.97] transition-all"
            >
              <ChromeIcon />
              Add to Chrome
            </a>
          ) : (
            <div className="relative inline-flex">
              <div className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-white/[0.05] border border-white/[0.09] text-white/25 font-semibold text-[14px] cursor-not-allowed select-none">
                <ChromeIcon />
                Add to Chrome
              </div>
              <span className="absolute -top-2 -right-2 text-[9px] font-bold tracking-[0.14em] text-amber-400 border border-amber-500/[0.35] rounded-md px-1.5 py-0.5 uppercase bg-[#08080E]">Soon</span>
            </div>
          )}
          <a
            href={EXTENSION_DOWNLOAD_URL}
            download
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white/55 hover:text-white hover:bg-white/[0.09] transition-all text-[14px] font-medium"
          >
            <DownloadIcon />
            Download beta
          </a>
        </div>

        {!CHROME_STORE_URL && (
          <div
            className="mt-10 border-t border-white/[0.06] pt-8 max-w-sm"
            {...scrollAnim(extRef.visible, 200)}
          >
            <p className="text-[10px] font-semibold tracking-[0.20em] text-white/20 uppercase mb-5">Install the beta</p>
            <ol className="space-y-4">
              {[
                'Download the zip and unzip it',
                'In Chrome, go to chrome://extensions',
                'Enable Developer mode (top right toggle)',
                'Click Load unpacked — select the demist-extension folder',
                'Pin the extension and open the Demist app',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3.5">
                  <span className="font-mono text-[11px] font-semibold text-white/18 mt-[2px] shrink-0 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-[13px] text-white/40 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {/* ── Final CTA ── */}
      <section ref={ctaRef.ref} className="relative z-10 px-6 py-40 text-center">
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 500px 250px at 50% 50%, rgba(255,255,255,0.025) 0%, transparent 70%)' }}
        />
        <h2
          className="text-[36px] sm:text-[58px] font-bold tracking-[-0.025em] mb-5 leading-[1.04] max-w-lg mx-auto"
          {...scrollAnim(ctaRef.visible, 0)}
        >
          Start your next lecture
          <br />already ahead.
        </h2>
        <p className="text-white/30 text-[15px] mb-10" {...scrollAnim(ctaRef.visible, 100)}>
          Free to use. Works in your browser.
        </p>
        <div {...scrollAnim(ctaRef.visible, 180)}>
          <button
            onClick={cta}
            className="px-10 py-4 rounded-xl bg-white text-[#08080E] font-semibold text-[15px] hover:bg-white/90 active:scale-[0.97] transition-all duration-150 select-none cursor-pointer"
          >
            {authed ? 'Open app →' : 'Get started free →'}
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer
        className="relative z-10 px-6 sm:px-14 py-7 flex items-center justify-between gap-4"
        style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
      >
        <span className="text-[13px] font-semibold text-white/20">Demist</span>
        <div className="flex items-center gap-5">
          <a href="/privacy" className="text-[12px] text-white/20 hover:text-white/40 transition-colors">Privacy</a>
          <span className="text-[12px] text-white/20">© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </main>
  )
}

function ChromeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" />
      <line x1="21.17" y1="8" x2="12" y2="8" />
      <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
      <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
    </svg>
  )
}
function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

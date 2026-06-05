'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

const SPRING = 'cubic-bezier(0.16, 1, 0.3, 1)'

/* ─── Helpers ─────────────────────────────────────────────────────────── */
function anim(delay: number, duration = 700) {
  return { style: { animation: `step-fade-up ${duration}ms ${SPRING} ${delay}ms both` } }
}
function useInView(threshold = 0.06) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setVisible(true); obs.disconnect() }
    }, { threshold })
    obs.observe(el); return () => obs.disconnect()
  }, [threshold])
  return { ref, visible }
}
function scrollAnim(visible: boolean, delay: number, duration = 650) {
  return visible
    ? { style: { animation: `step-fade-up ${duration}ms ${SPRING} ${delay}ms both` } }
    : { style: { opacity: 0, transform: 'translateY(22px)' } }
}

/* ─── Waveform — RAF-driven, mouse/touch reactive ────────────────────── */
interface WaveformProps {
  barCount?: number
  maxH?: number
  minH?: number
  sigma?: number
  idleAmp?: number
  baseOpacity?: number
  peakOpacity?: number
  mouseXRef: React.RefObject<number>
  className?: string
  style?: React.CSSProperties
}
function Waveform({
  barCount = 80, maxH = 140, minH = 3, sigma = 0.19,
  idleAmp = 8, baseOpacity = 0.08, peakOpacity = 0.90,
  mouseXRef, className, style,
}: WaveformProps) {
  const barsRef = useRef<(HTMLDivElement | null)[]>([])
  const heights = useRef<number[]>([])

  useEffect(() => {
    heights.current = new Array(barCount).fill(minH)
    barsRef.current = new Array(barCount).fill(null)
  }, [barCount, minH])

  useEffect(() => {
    let raf: number; let t = 0
    const tick = () => {
      t += 0.016
      const mx = mouseXRef.current
      for (let i = 0; i < barCount; i++) {
        const norm = i / Math.max(barCount - 1, 1)
        // Organic idle — two overlapping sines for natural breath
        const idle = minH
          + Math.sin(t * 0.60 + i * 0.31) * idleAmp
          + Math.sin(t * 1.15 + i * 0.17) * (idleAmp * 0.45)
        // Mouse Gaussian bell
        const d = norm - mx
        const influence = Math.exp(-(d * d) / (2 * sigma * sigma))
        const target = Math.max(minH, idle + influence * maxH)
        // Faster lerp near cursor
        heights.current[i] += (target - heights.current[i]) * (0.036 + influence * 0.14)
        const bar = barsRef.current[i]
        if (bar) {
          const h = heights.current[i]
          bar.style.height = `${h}px`
          const t2 = h / (maxH + idleAmp)
          const opacity = baseOpacity + t2 * (peakOpacity - baseOpacity)
          // Gradient: dark amber at base → bright gold at tip
          bar.style.background =
            `linear-gradient(to top, rgba(180,100,5,${(opacity * 0.55).toFixed(3)}), rgba(251,191,36,${opacity.toFixed(3)}))`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [barCount, maxH, minH, sigma, idleAmp, baseOpacity, peakOpacity, mouseXRef])

  return (
    <div
      className={className}
      style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', overflow: 'hidden', ...style }}
    >
      {Array.from({ length: barCount }, (_, i) => (
        <div
          key={i}
          ref={el => { barsRef.current[i] = el }}
          className="flex-1 rounded-full"
          style={{
            height: `${minH}px`,
            background: `rgba(251,191,36,${baseOpacity})`,
            willChange: 'height, background',
            minWidth: 0,
          }}
        />
      ))}
    </div>
  )
}

/* ─── Constants ──────────────────────────────────────────────────────── */
const CHROME_STORE_URL: string | null = null
const EXTENSION_DOWNLOAD_URL = '/demist-extension.zip'

const FEATURES = [
  { title: 'Live term detection',   body: 'Definitions appear as your lecturer speaks — matched to your subject and year.' },
  { title: 'Automatic glossary',    body: 'Every detected term saves itself. Your glossary fills while you focus.' },
  { title: 'Spaced repetition',     body: 'SM-2 schedules each term at the exact moment you\'re about to forget it.' },
  { title: 'AI session summaries',  body: 'Stop recording and Demist generates a full summary alongside your term list.' },
  { title: 'YouTube & file import', body: 'Paste a URL or upload a recording, deck, or transcript. Terms extracted in seconds.', tag: 'New' },
  { title: 'Full session history',  body: 'Every lecture stored with terms, transcript, and summary. Return to anything.' },
  { title: 'Notion sync',           body: 'Push your glossary to Notion or pull lecture notes in — one tap.', tag: 'New' },
]

const STEPS = [
  { n: '01', title: 'Record live or import from anywhere',      body: 'Tap record before a lecture, paste a YouTube URL, or upload a recording or slide deck.' },
  { n: '02', title: 'Unfamiliar terms are explained instantly', body: 'Definitions appear on screen the moment your lecturer says something you might not know.' },
  { n: '03', title: 'Your glossary builds itself',              body: 'Every term saves with its definition. Flashcards queue automatically on a spaced schedule.' },
]

/* ─── Page ───────────────────────────────────────────────────────────── */
export default function LandingClient() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const mouseXRef = useRef<number>(0.5)

  const featuresRef = useInView()
  const stepsRef = useInView()
  const extRef = useInView()
  const ctaRef = useInView()

  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => { if (data.user) setAuthed(true) })
  }, [])

  /* Global mouse + touch tracking — shared by all Waveform instances */
  useEffect(() => {
    const onMouse = (e: MouseEvent) => { mouseXRef.current = e.clientX / window.innerWidth }
    const onTouch = (e: TouchEvent) => { mouseXRef.current = e.touches[0].clientX / window.innerWidth }
    window.addEventListener('mousemove', onMouse, { passive: true })
    window.addEventListener('touchmove', onTouch, { passive: true })
    return () => {
      window.removeEventListener('mousemove', onMouse)
      window.removeEventListener('touchmove', onTouch)
    }
  }, [])

  const cta = () => {
    posthog.capture('get_started_clicked')
    router.push(authed ? '/dashboard' : '/login')
  }

  return (
    <main className="relative bg-[#08080E] text-white overflow-x-hidden">

      {/* ── Fixed ambient waveform — always visible at viewport bottom ── */}
      <div
        aria-hidden
        className="pointer-events-none fixed bottom-0 inset-x-0 z-20"
        style={{ height: 110 }}
      >
        {/* Gradient scrim so bars emerge from the dark */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, transparent 0%, #08080E 100%)' }}
        />
        <Waveform
          mouseXRef={mouseXRef}
          barCount={96}
          maxH={80}
          minH={2}
          sigma={0.22}
          idleAmp={5}
          baseOpacity={0.06}
          peakOpacity={0.75}
          style={{ position: 'absolute', inset: 0, alignItems: 'flex-end', padding: '0 0 2px' }}
        />
      </div>

      {/* ── Nav ── */}
      <header
        className="fixed top-0 inset-x-0 z-30 flex items-center justify-between px-6 sm:px-14 h-14"
        {...anim(0, 500)}
      >
        <span className="text-[14px] font-semibold text-white tracking-tight select-none">Demist</span>
        <button
          onClick={cta}
          className="text-[13px] font-medium text-white/35 hover:text-white/80 transition-colors duration-200 cursor-pointer select-none"
        >
          {authed ? 'Open app →' : 'Sign in'}
        </button>
      </header>

      {/* ── Hero ── */}
      <section className="relative min-h-dvh flex flex-col items-center justify-between px-6 sm:px-14 pt-14 pb-[110px]">

        {/* Top: heading */}
        <div className="flex-1 flex flex-col items-center justify-end pb-10 sm:pb-14 text-center w-full">
          <h1
            className="text-[50px] sm:text-[80px] lg:text-[100px] font-bold tracking-[-0.03em] leading-[1.0] max-w-4xl"
            {...anim(120, 900)}
          >
            Never feel lost
            <br />
            <span className="text-white/35">in a lecture again.</span>
          </h1>
        </div>

        {/* Middle: hero waveform — the main visual event */}
        <div
          className="w-screen relative -mx-6 sm:-mx-14"
          {...anim(280, 1000)}
        >
          <Waveform
            mouseXRef={mouseXRef}
            barCount={90}
            maxH={150}
            minH={3}
            sigma={0.18}
            idleAmp={9}
            baseOpacity={0.09}
            peakOpacity={0.92}
            style={{ height: 160, width: '100vw', padding: '0 8px' }}
          />
        </div>

        {/* Bottom: subheading + CTA */}
        <div className="flex-1 flex flex-col items-center justify-start pt-10 sm:pt-14 text-center w-full">
          <p
            className="text-white/40 text-[16px] sm:text-[18px] leading-relaxed max-w-[500px] mb-9"
            {...anim(460, 700)}
          >
            Record a live lecture or import from YouTube, audio, or slides. Demist catches every unfamiliar term, explains it on screen, and builds your glossary automatically.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-3" {...anim(580, 700)}>
            <button
              onClick={cta}
              className="px-7 py-3.5 rounded-xl bg-white text-[#08080E] font-semibold text-[14px] hover:bg-white/90 active:scale-[0.97] transition-all duration-150 select-none cursor-pointer"
            >
              {authed ? 'Open app →' : 'Get started free →'}
            </button>
            <button
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
              className="text-[13px] text-white/28 hover:text-white/60 transition-colors px-3 py-3 select-none cursor-pointer"
            >
              See features ↓
            </button>
          </div>
        </div>

      </section>

      {/* ── Features ── */}
      <section id="features" ref={featuresRef.ref} className="relative z-10 px-6 sm:px-14 pt-28 pb-28 max-w-6xl mx-auto">
        <div className="mb-16" {...scrollAnim(featuresRef.visible, 0)}>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-white/22 uppercase mb-5">What Demist does</p>
          <h2 className="text-[32px] sm:text-[48px] font-bold tracking-[-0.022em] leading-[1.06] max-w-xl">
            Everything you need.
            <br /><span className="text-white/28 font-medium">Nothing you don&apos;t.</span>
          </h2>
        </div>

        {/* Editorial grid — cells separated by 1px gaps */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-white/[0.06] rounded-2xl overflow-hidden border border-white/[0.06]">

          <div className="sm:col-span-2 bg-[#08080E] p-8 hover:bg-white/[0.025] transition-colors duration-200" style={scrollAnim(featuresRef.visible, 60).style}>
            <p className="text-[10px] font-bold tracking-[0.20em] text-white/22 uppercase mb-4">Core feature</p>
            <p className="text-[22px] font-semibold text-white leading-snug mb-3">{FEATURES[0].title}</p>
            <p className="text-[14px] text-white/38 leading-relaxed max-w-sm">{FEATURES[0].body}</p>
          </div>
          <div className="bg-[#08080E] p-8 hover:bg-white/[0.025] transition-colors duration-200" style={scrollAnim(featuresRef.visible, 100).style}>
            <p className="text-[10px] font-bold tracking-[0.20em] text-white/22 uppercase mb-4">&nbsp;</p>
            <p className="text-[18px] font-semibold text-white leading-snug mb-3">{FEATURES[1].title}</p>
            <p className="text-[13px] text-white/38 leading-relaxed">{FEATURES[1].body}</p>
          </div>

          <div className="bg-[#08080E] p-8 hover:bg-white/[0.025] transition-colors duration-200 border-t border-white/[0.06]" style={scrollAnim(featuresRef.visible, 140).style}>
            <p className="text-[18px] font-semibold text-white leading-snug mb-3">{FEATURES[2].title}</p>
            <p className="text-[13px] text-white/38 leading-relaxed">{FEATURES[2].body}</p>
          </div>
          <div className="bg-[#08080E] p-8 hover:bg-white/[0.025] transition-colors duration-200 border-t border-white/[0.06]" style={scrollAnim(featuresRef.visible, 165).style}>
            <p className="text-[18px] font-semibold text-white leading-snug mb-3">{FEATURES[3].title}</p>
            <p className="text-[13px] text-white/38 leading-relaxed">{FEATURES[3].body}</p>
          </div>
          <div className="bg-[#08080E] p-8 hover:bg-white/[0.025] transition-colors duration-200 border-t border-white/[0.06]" style={scrollAnim(featuresRef.visible, 190).style}>
            <p className="text-[18px] font-semibold text-white leading-snug mb-3">{FEATURES[5].title}</p>
            <p className="text-[13px] text-white/38 leading-relaxed">{FEATURES[5].body}</p>
          </div>

          <div className="sm:col-span-2 bg-[#08080E] p-8 hover:bg-white/[0.025] transition-colors duration-200 border-t border-white/[0.06]" style={scrollAnim(featuresRef.visible, 220).style}>
            <div className="flex items-start justify-between mb-4">
              <p className="text-[10px] font-bold tracking-[0.20em] text-white/22 uppercase">Import</p>
              <Tag>New</Tag>
            </div>
            <p className="text-[22px] font-semibold text-white leading-snug mb-3">{FEATURES[4].title}</p>
            <p className="text-[14px] text-white/38 leading-relaxed max-w-sm">{FEATURES[4].body}</p>
          </div>
          <div className="bg-[#08080E] p-8 hover:bg-white/[0.025] transition-colors duration-200 border-t border-white/[0.06]" style={scrollAnim(featuresRef.visible, 250).style}>
            <div className="flex justify-end mb-4"><Tag>New</Tag></div>
            <p className="text-[18px] font-semibold text-white leading-snug mb-3">{FEATURES[6].title}</p>
            <p className="text-[13px] text-white/38 leading-relaxed">{FEATURES[6].body}</p>
          </div>

        </div>
      </section>

      {/* ── How it works ── */}
      <section ref={stepsRef.ref} className="relative z-10 px-6 sm:px-14 pt-20 pb-28 max-w-3xl mx-auto">
        <div className="mb-16" {...scrollAnim(stepsRef.visible, 0)}>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-white/22 uppercase mb-5">How it works</p>
          <h2 className="text-[32px] sm:text-[48px] font-bold tracking-[-0.022em] leading-[1.06]">
            Three steps.
            <br /><span className="text-white/28 font-medium">That&apos;s it.</span>
          </h2>
        </div>
        <div>
          {STEPS.map(({ n, title, body }, i) => (
            <div key={n} className="flex gap-8 py-9 border-b border-white/[0.06] last:border-0 group" {...scrollAnim(stepsRef.visible, 80 + i * 110)}>
              <span className="font-mono text-[11px] font-bold text-white/18 tabular-nums pt-1.5 w-7 shrink-0 group-hover:text-white/45 transition-colors duration-300">
                {n}
              </span>
              <div>
                <p className="text-[19px] font-semibold text-white/90 mb-3 leading-snug">{title}</p>
                <p className="text-[14px] text-white/38 leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Extension ── */}
      <section ref={extRef.ref} className="relative z-10 px-6 sm:px-14 pt-20 pb-28 max-w-3xl mx-auto">
        <div className="mb-12" {...scrollAnim(extRef.visible, 0)}>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-white/22 uppercase mb-5">Chrome Extension</p>
          <h2 className="text-[32px] sm:text-[48px] font-bold tracking-[-0.022em] leading-[1.06]">
            Keep your notes open.
            <br /><span className="text-white/28 font-medium">Terms show in a side panel.</span>
          </h2>
          <p className="text-white/38 text-[15px] leading-relaxed mt-5 max-w-lg">
            Start recording in Demist, then switch to your slides or notes. The extension keeps a live panel on the side showing every term as it&apos;s detected.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3" {...scrollAnim(extRef.visible, 120)}>
          {CHROME_STORE_URL ? (
            <a href={CHROME_STORE_URL} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl bg-white text-[#08080E] font-semibold text-[14px] hover:bg-white/90 active:scale-[0.97] transition-all">
              <ChromeIcon /> Add to Chrome
            </a>
          ) : (
            <div className="relative inline-flex">
              <div className="inline-flex items-center gap-2.5 px-6 py-3 rounded-xl border border-white/[0.09] text-white/22 font-semibold text-[14px] cursor-not-allowed select-none" style={{ background: 'rgba(255,255,255,0.04)' }}>
                <ChromeIcon /> Add to Chrome
              </div>
              <span className="absolute -top-2 -right-2 text-[9px] font-bold tracking-[0.14em] text-amber-400 border border-amber-500/[0.35] rounded-md px-1.5 py-0.5 uppercase bg-[#08080E]">Soon</span>
            </div>
          )}
          <a href={EXTENSION_DOWNLOAD_URL} download
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.06] transition-all text-[14px] font-medium" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <DownloadIcon /> Download beta
          </a>
        </div>

        {!CHROME_STORE_URL && (
          <div className="mt-10 border-t border-white/[0.06] pt-8 max-w-sm" {...scrollAnim(extRef.visible, 200)}>
            <p className="text-[10px] font-semibold tracking-[0.20em] text-white/20 uppercase mb-5">Install the beta</p>
            <ol className="space-y-4">
              {['Download the zip and unzip it', 'In Chrome, go to chrome://extensions', 'Enable Developer mode (top right)', 'Click Load unpacked — select the demist-extension folder', 'Pin the extension and open Demist'].map((step, i) => (
                <li key={i} className="flex items-start gap-3.5">
                  <span className="font-mono text-[11px] font-bold text-white/18 mt-[2px] shrink-0 tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-[13px] text-white/38 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {/* ── Final CTA ── */}
      <section ref={ctaRef.ref} className="relative z-10 px-6 pt-24 pb-[160px] text-center">
        <div aria-hidden className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse 500px 200px at 50% 40%, rgba(255,255,255,0.018) 0%, transparent 70%)' }} />
        <h2
          className="text-[36px] sm:text-[58px] font-bold tracking-[-0.025em] mb-5 leading-[1.04] max-w-lg mx-auto"
          {...scrollAnim(ctaRef.visible, 0)}
        >
          Start your next lecture
          <br />already ahead.
        </h2>
        <p className="text-white/28 text-[15px] mb-10" {...scrollAnim(ctaRef.visible, 100)}>
          Free to use. Works in your browser.
        </p>
        <div {...scrollAnim(ctaRef.visible, 180)}>
          <button onClick={cta}
            className="px-10 py-4 rounded-xl bg-white text-[#08080E] font-semibold text-[15px] hover:bg-white/90 active:scale-[0.97] transition-all duration-150 select-none cursor-pointer">
            {authed ? 'Open app →' : 'Get started free →'}
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 px-6 sm:px-14 py-7 flex items-center justify-between gap-4 border-t border-white/[0.05]">
        <span className="text-[13px] font-semibold text-white/18">Demist</span>
        <div className="flex items-center gap-5">
          <a href="/privacy" className="text-[12px] text-white/18 hover:text-white/40 transition-colors">Privacy</a>
          <span className="text-[12px] text-white/18">© {new Date().getFullYear()}</span>
        </div>
      </footer>

    </main>
  )
}

/* ─── Small components ───────────────────────────────────────────────── */
function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-bold tracking-[0.12em] text-amber-400 border border-amber-500/[0.30] rounded-md px-2 py-0.5 uppercase">
      {children}
    </span>
  )
}
function ChromeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" />
      <line x1="21.17" y1="8" x2="12" y2="8" /><line x1="3.95" y1="6.06" x2="8.54" y2="14" /><line x1="10.88" y1="21.94" x2="15.46" y2="14" />
    </svg>
  )
}
function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

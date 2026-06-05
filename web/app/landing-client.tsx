'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

const SPRING = 'cubic-bezier(0.16, 1, 0.3, 1)'

function anim(delay: number, duration = 600) {
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

function scrollAnim(visible: boolean, delay: number, duration = 580) {
  return visible
    ? { style: { animation: `step-fade-up ${duration}ms ${SPRING} ${delay}ms both` } }
    : { style: { opacity: 0, transform: 'translateY(20px)' } }
}

const BARS = [10, 22, 34, 26, 14, 38, 28, 18, 32, 42, 30, 16, 36, 26, 18, 12, 30, 22, 14, 20]

const CHROME_STORE_URL: string | null = null
const EXTENSION_DOWNLOAD_URL = '/demist-extension.zip'

const FEATURES = [
  {
    title: 'Live term detection',
    body: 'Demist listens to your microphone and flags unfamiliar terms as your lecturer speaks. Each definition shows on screen, matched to your subject and year.',
    Icon: MicIcon,
    tag: null as string | null,
    hero: true,
  },
  {
    title: 'Automatic glossary',
    body: 'Every term saves itself with its definition. Your glossary fills while you focus on the lecture.',
    Icon: BookIcon,
    tag: null as string | null,
    hero: false,
  },
  {
    title: 'Spaced repetition flashcards',
    body: <>SM-2 algorithm schedules each term as a flashcard at the exact moment you&apos;re about to forget it.</>,
    Icon: CardIcon,
    tag: null as string | null,
    hero: false,
  },
  {
    title: 'AI session summaries',
    body: 'Stop recording and Demist generates a summary of your lecture alongside the term list and full transcript.',
    Icon: SummaryIcon,
    tag: null as string | null,
    hero: false,
  },
  {
    title: 'YouTube & file import',
    body: 'Paste a YouTube URL or upload a recording, slide deck, or transcript. Demist extracts every unfamiliar term and builds your glossary in seconds.',
    Icon: ImportIcon,
    tag: 'New' as string | null,
    hero: true,
  },
  {
    title: 'Full session history',
    body: 'Every lecture stored with terms, transcript, and summary. Rename, browse, return to anything.',
    Icon: HistoryIconFeat,
    tag: null as string | null,
    hero: false,
  },
  {
    title: 'Notion sync',
    body: 'Export glossary or summaries to Notion, or import your own lecture notes to extract terms automatically.',
    Icon: NotionIconFeat,
    tag: 'New' as string | null,
    hero: false,
  },
]

const STEPS = [
  {
    n: '01',
    title: 'Record live or import from anywhere',
    body: 'Tap record before a lecture, paste a YouTube URL, or upload a recording or slide deck. No setup required.',
  },
  {
    n: '02',
    title: 'Unfamiliar terms are explained as they appear',
    body: 'During live recording, definitions pop up on screen the moment your lecturer says something you might not know.',
  },
  {
    n: '03',
    title: 'Your glossary and flashcards build themselves',
    body: <>Every term saves with its definition and an AI summary. Flashcards queue with <span className="text-violet-400 font-medium">spaced repetition</span> on a schedule built around when you&apos;ll forget.</>,
  },
]

export default function LandingClient() {
  const router = useRouter()
  const [authed, setAuthed] = useState(false)
  const [elapsed, setElapsed] = useState(154)
  const [cardVisible, setCardVisible] = useState(false)
  const [termHighlighted, setTermHighlighted] = useState(false)

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

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    let cancelled = false
    const t = (fn: () => void, ms: number) => { const id = setTimeout(fn, ms); timers.push(id) }
    const cycle = (initialDelay: number) => {
      t(() => {
        if (cancelled) return
        setTermHighlighted(true)
        t(() => {
          if (cancelled) return
          setCardVisible(true)
          t(() => {
            if (cancelled) return
            setCardVisible(false)
            setTermHighlighted(false)
            cycle(1800)
          }, 3400)
        }, 400)
      }, initialDelay)
    }
    cycle(1600)
    return () => { cancelled = true; timers.forEach(clearTimeout) }
  }, [])

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const cta = () => {
    posthog.capture('get_started_clicked')
    router.push(authed ? '/dashboard' : '/login')
  }

  return (
    <main className="relative bg-[#08080E] text-white overflow-x-hidden">

      {/* ── Ambient background ── */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden z-0">
        {/* Primary violet glow */}
        <div
          className="absolute top-[30%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1100px] h-[900px] rounded-full opacity-[0.055] blur-[160px] animate-float"
          style={{ background: 'radial-gradient(ellipse, #7C3AED 0%, #4C1D95 60%, transparent 100%)' }}
        />
        {/* Secondary indigo glow */}
        <div
          className="absolute -bottom-20 right-0 w-[600px] h-[500px] rounded-full bg-indigo-800/[0.04] blur-[120px] animate-float"
          style={{ animationDelay: '-5s' }}
        />
        {/* Subtle top edge highlight */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-px bg-gradient-to-r from-transparent via-violet-500/[0.15] to-transparent" />
      </div>

      {/* ── Nav ── */}
      <header
        className="relative z-20 flex items-center justify-between px-6 sm:px-14 h-16"
        {...anim(0)}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center shadow-[0_0_12px_rgba(124,58,237,0.45)] shrink-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
            </svg>
          </div>
          <span className="text-[15px] font-bold text-white tracking-tight">Demist</span>
        </div>
        <button
          onClick={cta}
          className="text-[13px] font-medium text-white/40 hover:text-white/80 transition-colors duration-200 cursor-pointer"
        >
          {authed ? 'Open app →' : 'Sign in'}
        </button>
      </header>

      {/* ── Hero ── */}
      <section className="relative z-10 min-h-[calc(100dvh-4rem)] flex flex-col items-center justify-center text-center px-6 pb-16">

        {/* Eyebrow pill */}
        <div
          className="mb-8 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-violet-500/[0.10] border border-violet-500/[0.22] text-violet-300 text-[12px] font-semibold"
          {...anim(60)}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
          Real-time lecture intelligence
        </div>

        <h1
          className="text-[46px] sm:text-[68px] lg:text-[80px] font-bold tracking-[-0.025em] leading-[1.02] mb-6 max-w-3xl"
          {...anim(150)}
        >
          <span className="text-violet-400">Never</span>{' '}feel lost
          <br />in a lecture again.
        </h1>

        <p
          className="text-white/45 text-[16px] sm:text-[18px] leading-relaxed mb-10 max-w-[500px]"
          {...anim(250)}
        >
          Record live or import from YouTube, audio files, or slide decks. Demist catches every unfamiliar term, explains it on screen, and builds your glossary, summaries, and flashcards automatically.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-3 mb-20" {...anim(340)}>
          <button
            onClick={cta}
            className="px-7 py-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[15px] transition-all duration-150 hover:shadow-[0_0_40px_rgba(124,58,237,0.42)] active:scale-[0.97] select-none cursor-pointer"
          >
            {authed ? 'Open app →' : 'Get started free →'}
          </button>
          <button
            onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            className="text-[14px] text-white/30 hover:text-white/60 transition-colors px-3 py-3.5 select-none cursor-pointer"
          >
            See how it works
          </button>
        </div>

        {/* Product mockup */}
        <div className="w-full max-w-[360px] mx-auto" {...anim(460, 700)}>
          {/* Glow behind mockup */}
          <div className="absolute inset-0 -z-10 blur-[80px] rounded-full bg-violet-600/[0.08] scale-75" />

          <div
            className="relative rounded-[24px] p-5 overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              backdropFilter: 'blur(20px)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)',
            }}
          >
            {/* Top chrome */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-red-500">
                  <span className="animate-ping absolute inline-flex h-2 w-2 rounded-full bg-red-400 opacity-60" />
                </span>
                <span className="font-mono text-[12px] text-white/25">{fmt(elapsed)}</span>
              </div>
              <span className="text-[11px] text-white/20 font-medium">Microeconomics</span>
            </div>

            {/* Live transcript line */}
            <p className="text-[12px] text-white/25 font-mono mb-4 leading-relaxed tracking-tight">
              &ldquo;...the{' '}
              <span
                className="transition-colors duration-300"
                style={{ color: termHighlighted ? '#a78bfa' : undefined }}
              >
                elasticity of demand
              </span>
              {' '}refers to...&rdquo;
            </p>

            {/* Detected term card */}
            <div
              style={{
                opacity: cardVisible ? 1 : 0,
                transform: cardVisible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.96)',
                transition: `opacity 0.4s ${SPRING}, transform 0.4s ${SPRING}`,
                pointerEvents: cardVisible ? 'auto' : 'none',
              }}
            >
              <div
                className="rounded-[14px] p-4 mb-4"
                style={{
                  background: 'rgba(124,58,237,0.07)',
                  border: '1px solid rgba(139,92,246,0.20)',
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="w-[2.5px] rounded-full self-stretch bg-violet-500/50 shrink-0" />
                  <div>
                    <p className="text-[10px] font-bold tracking-[0.18em] text-violet-400/60 uppercase mb-1.5">
                      Detected
                    </p>
                    <p className="text-[14px] font-semibold text-white/90 mb-1">
                      Elasticity of Demand
                    </p>
                    <p className="text-[12px] text-white/40 leading-relaxed">
                      How sensitive consumer demand is to a change in price or income.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Waveform */}
            <div className="flex items-end gap-[3px] h-10 px-1">
              {BARS.map((h, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-full"
                  style={{
                    height: `${h}px`,
                    transformOrigin: 'bottom',
                    background: `rgba(139,92,246,${0.20 + (h / 42) * 0.55})`,
                    animation: `equalizer ${0.85 + (i % 5) * 0.15}s ease-in-out ${i * 55}ms infinite alternate`,
                  }}
                />
              ))}
            </div>

            {/* Bottom inset shadow */}
            <div className="absolute inset-x-0 bottom-0 h-10 rounded-b-[24px] bg-gradient-to-t from-black/20 to-transparent pointer-events-none" />
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" ref={featuresRef.ref} className="relative z-10 px-6 sm:px-14 py-28 max-w-6xl mx-auto">
        <div className="text-center mb-16" {...scrollAnim(featuresRef.visible, 0)}>
          <p className="text-[11px] font-bold tracking-[0.20em] text-white/25 uppercase mb-4">Features</p>
          <h2 className="text-[30px] sm:text-[44px] font-bold tracking-tight leading-tight">
            Everything you need.{' '}
            <span className="text-white/30 font-semibold">All built in.</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">

          {/* Wide hero — Live term detection */}
          <div
            className="sm:col-span-2 rounded-2xl p-7 group transition-all duration-200 cursor-default"
            style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(139,92,246,0.16)', ...scrollAnim(featuresRef.visible, 60).style }}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-violet-400 mb-6"
              style={{ background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(139,92,246,0.22)' }}
            >
              <MicIcon />
            </div>
            <p className="text-[18px] font-bold text-white mb-2.5">{FEATURES[0].title}</p>
            <p className="text-[14px] text-white/40 leading-relaxed max-w-sm">{FEATURES[0].body}</p>
          </div>

          {/* Regular — Automatic glossary */}
          <FeatureCard feature={FEATURES[1]} delay={featuresRef.visible ? 120 : 0} visible={featuresRef.visible} />

          {/* Row 2 */}
          <FeatureCard feature={FEATURES[2]} delay={featuresRef.visible ? 180 : 0} visible={featuresRef.visible} />
          <FeatureCard feature={FEATURES[3]} delay={featuresRef.visible ? 220 : 0} visible={featuresRef.visible} />
          <FeatureCard feature={FEATURES[5]} delay={featuresRef.visible ? 260 : 0} visible={featuresRef.visible} />

          {/* Wide hero — YouTube import */}
          <div
            className="sm:col-span-2 rounded-2xl p-7 group transition-all duration-200 cursor-default"
            style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(139,92,246,0.16)', ...scrollAnim(featuresRef.visible, 300).style }}
          >
            <div className="flex items-center justify-between mb-6">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-violet-400"
                style={{ background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(139,92,246,0.22)' }}
              >
                <ImportIcon />
              </div>
              <span className="text-[10px] font-bold tracking-[0.12em] text-violet-300 bg-violet-600/[0.18] border border-violet-500/[0.28] rounded-full px-2.5 py-0.5 uppercase">New</span>
            </div>
            <p className="text-[18px] font-bold text-white mb-2.5">{FEATURES[4].title}</p>
            <p className="text-[14px] text-white/40 leading-relaxed max-w-sm">{FEATURES[4].body}</p>
          </div>

          {/* Notion sync */}
          <div
            className="rounded-2xl p-6 group transition-all duration-200 cursor-default"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', ...scrollAnim(featuresRef.visible, 340).style }}
          >
            <div className="flex items-center justify-between mb-5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white/50"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}
              >
                <NotionIconFeat />
              </div>
              <span className="text-[10px] font-bold tracking-[0.12em] text-violet-300 bg-violet-600/[0.18] border border-violet-500/[0.28] rounded-full px-2.5 py-0.5 uppercase">New</span>
            </div>
            <p className="text-[15px] font-semibold text-white/90 mb-2">{FEATURES[6].title}</p>
            <p className="text-[13px] text-white/40 leading-relaxed">{FEATURES[6].body}</p>
          </div>

        </div>
      </section>

      {/* ── How it works ── */}
      <section ref={stepsRef.ref} className="relative z-10 px-6 sm:px-14 py-28 max-w-2xl mx-auto">
        <div className="text-center mb-16" {...scrollAnim(stepsRef.visible, 0)}>
          <p className="text-[11px] font-bold tracking-[0.20em] text-white/25 uppercase mb-4">How it works</p>
          <h2 className="text-[30px] sm:text-[44px] font-bold tracking-tight leading-tight">
            Record, import, or paste.{' '}
            <span className="text-white/30 font-semibold">Demist handles the rest.</span>
          </h2>
        </div>

        <div className="space-y-0">
          {STEPS.map(({ n, title, body }, i) => (
            <div
              key={n}
              className="flex gap-6 py-8 border-b border-white/[0.05] last:border-0 group"
              {...scrollAnim(stepsRef.visible, 120 + i * 90)}
            >
              <span className="text-[12px] font-bold text-violet-500/25 tabular-nums pt-1 w-7 shrink-0 group-hover:text-violet-400/60 transition-colors duration-300 font-mono">
                {n}
              </span>
              <div>
                <p className="text-[17px] font-semibold text-white/90 mb-2 leading-snug">{title}</p>
                <p className="text-[14px] text-white/40 leading-relaxed">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Extension ── */}
      <section ref={extRef.ref} className="relative z-10 px-6 sm:px-14 py-28 max-w-3xl mx-auto text-center">
        <div {...scrollAnim(extRef.visible, 0)}>
          <p className="text-[11px] font-bold tracking-[0.20em] text-white/25 uppercase mb-4">Chrome Extension</p>
          <h2 className="text-[30px] sm:text-[44px] font-bold tracking-tight mb-4 leading-tight">
            Keep your notes open.{' '}
            <span className="text-white/30 font-semibold">Terms show in a side panel.</span>
          </h2>
          <p className="text-white/40 text-[15px] leading-relaxed mb-10 max-w-[480px] mx-auto">
            Start recording in Demist, then switch to your lecture slides or notes. The Chrome extension keeps a live panel open on the side showing every term as Demist detects it.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3" {...scrollAnim(extRef.visible, 120)}>
          {CHROME_STORE_URL ? (
            <a
              href={CHROME_STORE_URL}
              target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[14px] transition-all hover:shadow-[0_0_36px_rgba(124,58,237,0.42)] active:scale-[0.97]"
            >
              <ChromeIcon />
              Add to Chrome
            </a>
          ) : (
            <div className="relative">
              <div
                className="flex items-center gap-2.5 px-6 py-3.5 rounded-xl text-white/25 font-semibold text-[14px] cursor-not-allowed select-none"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
              >
                <ChromeIcon />
                Add to Chrome
              </div>
              <span className="absolute -top-2.5 -right-2.5 text-[10px] font-bold tracking-[0.12em] text-violet-300 bg-violet-600/[0.20] border border-violet-500/[0.30] rounded-full px-2 py-0.5 uppercase">
                Soon
              </span>
            </div>
          )}

          <a
            href={EXTENSION_DOWNLOAD_URL}
            download
            className="flex items-center gap-2 px-6 py-3.5 rounded-xl text-white/60 hover:text-white transition-all text-[14px] font-medium"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <DownloadIcon />
            Download beta
          </a>
        </div>

        {!CHROME_STORE_URL && (
          <div
            className="mt-8 rounded-2xl px-6 py-5 max-w-sm mx-auto text-left"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', ...scrollAnim(extRef.visible, 240).style }}
          >
            <p className="text-[10px] font-bold tracking-[0.18em] text-white/25 uppercase mb-4">Install in 60 seconds (beta)</p>
            <ol className="space-y-3">
              {[
                'Click Download beta above and save the zip file',
                'Unzip it — you will get a single folder called demist-extension',
                'In Chrome, go to chrome://extensions',
                'Turn on Developer mode in the top right',
                'Click Load unpacked and select the demist-extension folder',
                'Pin the extension, open Demist, and click the icon to open the side panel',
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="text-[11px] font-bold text-violet-500/35 mt-[2px] shrink-0 tabular-nums font-mono">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-[13px] text-white/40 leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {/* ── Final CTA ── */}
      <section ref={ctaRef.ref} className="relative z-10 px-6 py-36 text-center overflow-hidden">
        {/* CTA ambient glow */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 600px 300px at 50% 50%, rgba(124,58,237,0.055) 0%, transparent 70%)',
          }}
        />
        <h2
          className="text-[34px] sm:text-[54px] font-bold tracking-[-0.02em] mb-4 leading-[1.06] max-w-lg mx-auto"
          {...scrollAnim(ctaRef.visible, 0)}
        >
          Start your next lecture
          <br />already ahead.
        </h2>
        <p
          className="text-white/35 text-[16px] mb-10"
          {...scrollAnim(ctaRef.visible, 100)}
        >
          Free to use. Works in your browser.
        </p>
        <div {...scrollAnim(ctaRef.visible, 180)}>
          <button
            onClick={cta}
            className="px-10 py-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-[16px] transition-all duration-150 hover:shadow-[0_0_56px_rgba(124,58,237,0.48)] active:scale-[0.97] select-none cursor-pointer"
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
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-violet-600/70 flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
            </svg>
          </div>
          <span className="text-[12px] font-semibold text-white/20">Demist</span>
        </div>
        <div className="flex items-center gap-5">
          <a href="/privacy" className="text-[12px] text-white/20 hover:text-white/40 transition-colors">Privacy</a>
          <p className="text-[12px] text-white/20">© {new Date().getFullYear()}</p>
        </div>
      </footer>
    </main>
  )
}

/* ─── Feature card component ────────────────────────────────────────────── */
function FeatureCard({ feature, delay, visible }: {
  feature: typeof FEATURES[0]
  delay: number
  visible: boolean
}) {
  return (
    <div
      className="rounded-2xl p-6 transition-all duration-200 cursor-default group hover:border-white/[0.13]"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', ...scrollAnim(visible, delay).style }}
    >
      <div className="flex items-start justify-between mb-5">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white/50"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}
        >
          <feature.Icon />
        </div>
        {feature.tag && (
          <span className="text-[10px] font-bold tracking-[0.12em] text-violet-300 bg-violet-600/[0.18] border border-violet-500/[0.28] rounded-full px-2.5 py-0.5 uppercase">
            {feature.tag}
          </span>
        )}
      </div>
      <p className="text-[15px] font-semibold text-white/90 mb-2 leading-snug">{feature.title}</p>
      <p className="text-[13px] text-white/40 leading-relaxed">{feature.body}</p>
    </div>
  )
}

/* ─── Icons ─────────────────────────────────────────────────────────────── */
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
function SummaryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <line x1="10" y1="9" x2="8" y2="9" />
    </svg>
  )
}
function ImportIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 17 12 21 16 17" />
      <line x1="12" y1="12" x2="12" y2="21" />
      <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29" />
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
function HistoryIconFeat() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  )
}
function NotionIconFeat() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933z" />
    </svg>
  )
}

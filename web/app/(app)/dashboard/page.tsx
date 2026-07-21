'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'
import { tabCaptureSupported } from '@/lib/tabCapture'
import { summaryFailureMessage } from '@/lib/summaryFailure'
import { isElectronNative } from '@/lib/electronNative'
import { useRecordingSession, LANGUAGE_NAMES, type LiveTerm } from '@/lib/recordingSession'

const SummaryViewer = dynamic(() => import('../summary-viewer').then(m => ({ default: m.SummaryViewer })), { ssr: false })
const OnboardingOverlay = dynamic(() => import('@/components/OnboardingOverlay').then(m => ({ default: m.OnboardingOverlay })), { ssr: false })
const SessionReview = dynamic(() => import('@/components/SessionReview').then(m => ({ default: m.SessionReview })), { ssr: false })
import { PaywallModal } from '@/components/PaywallModal'
import { TranscriptBilingual } from '@/components/TranscriptBilingual'

function fmtTime(s: number) {
  return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(diff / 3600000)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(diff / 86400000)
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

function sessionLabel(n: number, startedAt: string): string {
  const d = new Date(startedAt)
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return `Session ${n} · ${date}`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default function Dashboard() {
  // Recording is owned by a provider mounted at the (app) layout level (see
  // lib/recordingSession.tsx) so it survives navigating to other tabs: this
  // page only renders it and keeps its own page-local UI state (scroll
  // position, animation refs, the subject/transcript-view pickers).
  const {
    loading, isRecording, elapsed, liveTerms, setLiveTerms, sessionGlossary, profile, stats,
    recentSessions, sessionGenIds, sessionFailIds, sessionFailReasons, sessionTermLoading,
    recordingError, recordingWarning, wakeLockUnsupported, captureMode, setCaptureMode, capturedTabTitle,
    sentences, translatedSentences, reviewTerms, setReviewTerms, sessionSubject, setSessionSubject,
    sessionSubjectRef, paywall, setPaywall, localTranslate, liveTranslateAvailable,
    nativeModelsReady, nativeModelProgress,
    vizAnalyserRef, chunkPeakRef, startRecording, stopRecording, dismissTerm, pinTerm, markKnown,
    retrySessionSummarize, toggleExpandSession,
  } = useRecordingSession()

  const [isScrolledUp, setIsScrolledUp] = useState(false)
  const [transcriptView, setTranscriptView] = useState<'both' | 'source' | 'translated'>('both')
  const [showSubjectInput, setShowSubjectInput] = useState(false)
  const [tabCaptureSupportedState, setTabCaptureSupportedState] = useState(false)

  const ring1Ref = useRef<HTMLSpanElement | null>(null)
  const ring2Ref = useRef<HTMLSpanElement | null>(null)
  const ring3Ref = useRef<HTMLSpanElement | null>(null)
  const barsRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const transcriptContainerRef = useRef<HTMLDivElement | null>(null)
  const autoScrollRef = useRef(true)

  useEffect(() => {
    if (!isRecording) return
    const analyser = vizAnalyserRef.current
    if (!analyser) return

    const data = new Uint8Array(analyser.frequencyBinCount)
    const usable = Math.floor(analyser.frequencyBinCount * 0.55)
    const BAR_COUNT = 28
    let raf: number
    const tick = () => {
      analyser.getByteFrequencyData(data)
      let sum = 0; for (let i = 0; i < usable; i++) sum += data[i]
      const level = (sum / usable) / 255
      if (level > chunkPeakRef.current) chunkPeakRef.current = level
      if (ring1Ref.current) ring1Ref.current.style.transform = `scale(${1 + level * 2.8})`
      if (ring2Ref.current) ring2Ref.current.style.transform = `scale(${1 + level * 2.0})`
      if (ring3Ref.current) ring3Ref.current.style.transform = `scale(${1 + level * 1.3})`
      if (btnRef.current) btnRef.current.style.boxShadow = `0 0 ${20 + Math.round(level * 60)}px rgba(239,68,68,${(0.3 + level * 0.5).toFixed(2)})`
      if (barsRef.current) {
        const bars = barsRef.current.children; const step = usable / BAR_COUNT
        for (let i = 0; i < bars.length; i++) {
          const val = data[Math.floor(i * step)] / 255
          ;(bars[i] as HTMLElement).style.height = `${4 + val * 44}px`
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      // Do NOT close ctx here: it's the processing context owned by startRecording/stopRecording
      if (btnRef.current) btnRef.current.style.boxShadow = ''
      if (barsRef.current) Array.from(barsRef.current.children).forEach(b => { (b as HTMLElement).style.height = '4px' })
    }
  }, [isRecording, vizAnalyserRef, chunkPeakRef])

  // Auto-scroll the live transcript to the bottom as new sentences arrive
  useEffect(() => {
    if (!autoScrollRef.current) return
    const el = transcriptContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sentences])

  useEffect(() => {
    setTabCaptureSupportedState(tabCaptureSupported())
    const savedView = localStorage.getItem('demist_transcript_view')
    if (savedView === 'both' || savedView === 'source' || savedView === 'translated') setTranscriptView(savedView)
  }, [])

  const changeTranscriptView = (view: 'both' | 'source' | 'translated') => {
    setTranscriptView(view)
    localStorage.setItem('demist_transcript_view', view)
  }

  // The live bilingual view is on-device only (no cloud fallback, see
  // localTranslateUsable). If the on-device model fails outright, sentences
  // would otherwise sit on the pending "…" marker forever with no visual cue
  // anything's wrong beyond the small note in the toggle bar. Drop back to
  // English-only automatically so the transcript itself doesn't look broken;
  // term definitions keep working regardless, via the cloud fallback. This is
  // a transient override for this session only: setTranscriptView, not
  // changeTranscriptView, so it doesn't overwrite the user's saved preference
  // for future sessions on a device where translation might work fine.
  useEffect(() => {
    if (localTranslate.status === 'error' && transcriptView !== 'source') {
      setTranscriptView('source')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTranslate.status])

  // ── Live transcript: scroll handling, term highlighting, term-card re-open ──

  const handleTranscriptScroll = () => {
    const el = transcriptContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distanceFromBottom < 32
    autoScrollRef.current = atBottom
    setIsScrolledUp(prev => (prev === !atBottom ? prev : !atBottom))
  }

  const scrollToLive = () => {
    const el = transcriptContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
    autoScrollRef.current = true
    setIsScrolledUp(false)
  }

  const openTermCard = (term: string) => {
    const entry = sessionGlossary.find(g => g.term.toLowerCase() === term.toLowerCase())
    if (!entry) return
    const id = `${Date.now()}-${Math.random()}`
    setLiveTerms(prev => [...prev, { id, term: entry.term, definition: entry.definition, dismissing: false }].slice(-3))
    setTimeout(() => {
      setLiveTerms(prev => prev.map(t => t.id === id ? { ...t, dismissing: true } : t))
      setTimeout(() => setLiveTerms(prev => prev.filter(t => t.id !== id)), 380)
    }, 8000)
  }

  const handleTranscriptClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    if (!target.classList.contains('transcript-term')) return
    const term = target.getAttribute('data-term')
    if (term) openTermCard(term)
  }

  const highlightTerms = (text: string): string => {
    const escaped = escapeHtml(text)
    const terms = sessionGlossary.map(g => g.term).filter(Boolean)
    if (!terms.length) return escaped
    const pattern = terms.map(escapeRegExp).sort((a, b) => b.length - a.length).join('|')
    const re = new RegExp(`\\b(${pattern})\\b`, 'gi')
    return escaped.replace(re, m => `<span class="transcript-term" data-term="${escapeHtml(m)}">${m}</span>`)
  }

  const reportDefinition = async (term: string, definition: string) => {
    await createClient().from('definition_reports').insert({ term, definition })
    capture('definition_reported', { term })
  }

  if (loading) return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col overflow-hidden nav-bottom-pad">
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b dark:border-white/[0.05] border-black/[0.06]">
        <span className="font-bold tracking-tight text-[15px]">Demist</span>
      </header>
      <div className="flex-1 overflow-y-auto animate-pulse">
        <div className="w-full max-w-4xl mx-auto">
          <div className="flex flex-col items-center pt-12 pb-8 px-6 gap-3">
            <div className="w-[96px] h-[96px] rounded-full dark:bg-white/[0.06] bg-[#F3F1EC]" />
            <div className="h-4 w-32 dark:bg-white/[0.04] bg-[#FAF9F6] rounded-full" />
            <div className="h-3 w-48 dark:bg-white/[0.03] bg-[#FAF9F6] rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-3 px-4 sm:px-6 pb-5">
            {[0,1].map(i => (
              <div key={i} className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-4 py-4">
                <div className="h-2 w-12 dark:bg-white/[0.06] bg-[#F3F1EC] rounded-full mb-3" />
                <div className="h-7 w-14 dark:bg-white/[0.08] bg-[#EFEDE7] rounded-md" />
              </div>
            ))}
          </div>
          <div className="px-4 sm:px-6 pb-4">
            <div className="h-2 w-28 dark:bg-white/[0.05] bg-[#F6F5F2] rounded-full mb-3" />
            <div className="space-y-2">
              {[0,1,2].map(i => (
                <div key={i} className="flex items-center gap-3 dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.16] rounded-2xl px-4 py-3.5">
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="h-3.5 w-36 dark:bg-white/[0.07] bg-[#EFEDE7] rounded-full" />
                    <div className="h-3 w-20 dark:bg-white/[0.05] bg-[#F6F5F2] rounded-full" />
                  </div>
                  <div className="h-5 w-12 dark:bg-white/[0.05] bg-[#F6F5F2] rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  )

  return (
    <main className="min-h-dvh dark:bg-[#080810] bg-[#EDEAE3] dark:text-white text-gray-900 flex flex-col overflow-hidden nav-bottom-pad">
      {/* Ambient blobs */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-yellow-700/[0.06] blur-[120px]"
          style={{ animation: 'blob-drift 22s ease-in-out infinite' }}
        />
        <div
          className="absolute -bottom-24 -right-24 w-[380px] h-[380px] rounded-full bg-amber-800/[0.05] blur-[100px]"
          style={{ animation: 'blob-drift 28s ease-in-out infinite reverse' }}
        />
      </div>

      {/* Mobile header */}
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b dark:border-white/[0.05] border-black/[0.06] relative z-20">
        {isRecording ? (
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono text-[17px] tabular-nums">{fmtTime(elapsed)}</span>
          </div>
        ) : (
          <Link href="/dashboard" className="font-bold tracking-tight text-[15px] hover:dark:text-yellow-300 text-yellow-700 active:scale-[0.97] transition-all duration-150 select-none">Demist</Link>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 flex flex-col overflow-y-auto relative z-10">
        {isRecording ? (
          <>
            {/* Red ambient glow during recording */}
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center z-0">
              <div className="w-[600px] h-[600px] rounded-full bg-red-600/[0.06] blur-[120px]" />
            </div>

            {wakeLockUnsupported && (
              <div className="relative z-10 mx-4 sm:mx-6 mt-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 text-sm text-amber-800">
                Keep your screen on to avoid interrupting the recording.
              </div>
            )}

            {/* Visualizer */}
            <div className="shrink-0 flex flex-col items-center justify-center pt-8 pb-2 relative z-10">
              <div className="hidden sm:flex items-center gap-2 mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="font-mono text-[20px] tabular-nums">{fmtTime(elapsed)}</span>
              </div>

              {capturedTabTitle && (
                <p className="text-xs text-amber-600 mb-4 text-center max-w-xs truncate px-4">
                  Capturing from: {capturedTabTitle}
                </p>
              )}

              <div className="relative flex items-center justify-center mb-6">
                <span ref={ring1Ref} className="absolute w-[88px] h-[88px] rounded-full bg-red-500/[0.18]" style={{ willChange: 'transform' }} />
                <span ref={ring2Ref} className="absolute w-[88px] h-[88px] rounded-full bg-red-500/[0.11]" style={{ willChange: 'transform' }} />
                <span ref={ring3Ref} className="absolute w-[88px] h-[88px] rounded-full bg-red-500/[0.06]" style={{ willChange: 'transform' }} />
                <button
                  ref={btnRef}
                  onClick={stopRecording}
                  aria-label="Stop recording"
                  className="relative z-10 w-[88px] h-[88px] rounded-full bg-red-600 hover:bg-red-500 active:scale-[0.97] flex items-center justify-center transition-colors duration-200 select-none"
                >
                  <StopIcon />
                </button>
              </div>

              <div ref={barsRef} className="flex items-end gap-[2.5px]" style={{ height: '48px' }}>
                {Array.from({ length: 28 }).map((_, i) => (
                  <div
                    key={i}
                    className="w-[3px] rounded-full"
                    style={{ height: '4px', background: `rgba(239, 68, 68, ${0.4 + (i / 28) * 0.4})`, willChange: 'height' }}
                  />
                ))}
              </div>
            </div>

            {!wakeLockUnsupported && (
              <p className="relative z-10 text-[11px] text-gray-600 text-center -mt-1 mb-1 px-4">
                Switching tabs is fine. Your screen stays awake while recording; locking your phone stops the mic.
              </p>
            )}

            {/* Live transcript: fills the space between the recording button and term cards */}
            <div className="flex-1 min-h-[80px] px-4 sm:px-6 py-3 relative z-10">
              <div className="relative h-full flex flex-col">
                {profile?.translate_to && liveTranslateAvailable && (
                  <div className="shrink-0 flex items-center justify-between gap-2 mb-2">
                    <div className="flex dark:bg-white/[0.07] bg-black/[0.06] rounded-full p-1">
                      {([
                        { key: 'source', label: 'English' },
                        { key: 'both', label: 'Both' },
                        { key: 'translated', label: LANGUAGE_NAMES[profile.translate_to] ?? 'Translated' },
                      ] as const).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => changeTranscriptView(key)}
                          className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-all ${
                            transcriptView === key
                              ? 'bg-amber-500 text-white shadow-sm'
                              : 'text-gray-500 dark:text-white/45 hover:text-gray-700 dark:hover:text-white/65'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {localTranslate.status === 'downloading' && (
                      <span className="text-[11px] text-gray-600 shrink-0" title="A one-time Chrome download shared by every site, not specific to Demist">Chrome downloading translation model… {localTranslate.progress}%</span>
                    )}
                    {localTranslate.status === 'error' && (
                      <span className="text-[11px] text-red-400 shrink-0">Live translation unavailable, term definitions still translated</span>
                    )}
                  </div>
                )}
                <div
                  ref={transcriptContainerRef}
                  onScroll={handleTranscriptScroll}
                  onClick={handleTranscriptClick}
                  className={`transcript-container flex-1 overflow-y-auto ${isScrolledUp ? 'scrolled-up' : ''}`}
                >
                  {sentences.length === 0 && (
                    <p className="text-[13px] text-gray-700 italic">Transcription will appear here as you speak…</p>
                  )}
                  {profile?.translate_to && liveTranslateAvailable && transcriptView === 'both' && (
                    <TranscriptBilingual
                      pairs={sentences.map((s, i) => ({ srcHtml: highlightTerms(s), tgt: translatedSentences[i] ?? null }))}
                      lang={profile.translate_to}
                    />
                  )}
                  {(!profile?.translate_to || !liveTranslateAvailable || transcriptView === 'source') && (
                    sentences.map((sentence, index) => {
                      const age = Math.min(sentences.length - 1 - index, 5)
                      return (
                        <p
                          key={index}
                          data-age={age}
                          className="text-[calc(0.875rem*var(--df-scale))] leading-relaxed mb-1 transition-opacity duration-500"
                          dangerouslySetInnerHTML={{ __html: highlightTerms(sentence) }}
                        />
                      )
                    })
                  )}
                  {profile?.translate_to && liveTranslateAvailable && transcriptView === 'translated' && (
                    sentences.map((_, index) => {
                      const age = Math.min(sentences.length - 1 - index, 5)
                      const tgt = translatedSentences[index]
                      return (
                        <p
                          key={index}
                          data-age={age}
                          dir={profile.translate_to === 'ar' ? 'rtl' : undefined}
                          className="text-[calc(0.875rem*var(--df-scale))] leading-relaxed mb-1 transition-opacity duration-500 dark:text-amber-300/80 text-amber-700"
                        >
                          {tgt === null ? <span className="dark:text-white/25 text-gray-400">⋯</span> : tgt}
                        </p>
                      )
                    })
                  )}
                </div>
                {isScrolledUp && (
                  <button
                    onClick={scrollToLive}
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-xs px-3 py-1.5 rounded-full"
                  >
                    back to live ↓
                  </button>
                )}
              </div>
            </div>

            {sessionGlossary.length > 0 && (
              <div className="shrink-0 px-4 sm:px-6 pb-4 max-h-[32vh] overflow-y-auto">
                <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-3 sticky top-0 dark:bg-[#080810] bg-[#EDEAE3]">
                  This Session
                </p>
                <div className="space-y-2">
                  {sessionGlossary.map((t, i) => (
                    <div key={i} className="flex gap-3 dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.16] rounded-xl px-3 py-2.5">
                      <div className="min-w-0">
                        <span className="text-[calc(0.8125rem*var(--df-scale))] font-semibold dark:text-white/90 text-gray-900">{t.term}</span>
                        <p className="text-[calc(0.75rem*var(--df-scale))] text-gray-700 mt-0.5 leading-relaxed">{t.definition}</p>
                        {t.translation && (
                          <p className="text-[calc(0.75rem*var(--df-scale))] dark:text-amber-400/80 text-amber-700 mt-0.5 leading-relaxed">{t.translation}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Home mode */
          <div className="flex-1 overflow-y-auto">
          <div className="w-full max-w-4xl mx-auto flex flex-col">

            {/* Mic hero */}
            <div className="flex flex-col items-center pt-12 pb-8 px-4 sm:px-6 animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>
              <div className="relative flex items-center justify-center mb-5">
                <span className="absolute w-[130px] h-[130px] rounded-full bg-yellow-600/[0.08]" style={{ animation: 'glow-float 4s ease-in-out infinite' }} />
                <span className="absolute w-[162px] h-[162px] rounded-full bg-yellow-600/[0.05]" style={{ animation: 'glow-float 4s ease-in-out -1.3s infinite' }} />
                <span className="absolute w-[194px] h-[194px] rounded-full bg-yellow-600/[0.025]" style={{ animation: 'glow-float 4s ease-in-out -2.7s infinite' }} />
                <button
                  ref={btnRef}
                  onClick={() => nativeModelsReady && startRecording(captureMode)}
                  disabled={!nativeModelsReady}
                  aria-label={nativeModelsReady ? 'Start recording' : 'Preparing on-device models'}
                  className="relative z-10 w-[96px] h-[96px] rounded-full dark:bg-white/[0.08] bg-[#FAF9F6] border border-yellow-500/40 hover:bg-yellow-500/10 hover:border-yellow-500/60 hover:shadow-[0_0_48px_rgba(161,98,7,0.30)] dark:hover:shadow-[0_0_48px_rgba(251,191,36,0.30)] active:scale-[0.97] flex items-center justify-center transition-all duration-200 select-none shadow-sm disabled:opacity-40 disabled:pointer-events-none disabled:hover:shadow-none"
                >
                  <MicIcon />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <p className="dark:text-white/90 text-gray-900 font-semibold text-[17px]">
                  {!nativeModelsReady ? 'Preparing on-device models…' : sessionSubject ? `Ready for ${sessionSubject}` : 'Start recording'}
                </p>
                {nativeModelsReady && (
                  <button
                    onClick={() => setShowSubjectInput(true)}
                    aria-label="Change subject"
                    className="p-1 -m-1 rounded-full text-gray-500 dark:text-white/40 hover:text-gray-700 dark:hover:text-white/70 transition-colors"
                  >
                    <EditIcon />
                  </button>
                )}
              </div>
              {!nativeModelsReady ? (
                <div className="w-full max-w-[220px] mt-2.5">
                  <p className="text-gray-600 text-[12px] text-center mb-1.5">
                    {nativeModelProgress
                      ? `Downloading ${nativeModelProgress.label}… ${nativeModelProgress.pct}%`
                      : 'Loading models into memory…'}
                  </p>
                  <div className="h-1 rounded-full dark:bg-white/[0.08] bg-black/[0.08] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-yellow-500 transition-all duration-300"
                      style={{ width: `${nativeModelProgress?.pct ?? 8}%` }}
                    />
                  </div>
                  <p className="text-gray-500 text-[11px] text-center mt-1.5">One-time setup. Only needed the first time, or after a model change.</p>
                </div>
              ) : (
                <p className="text-gray-600 text-[13px] mt-1.5">Tap the mic before your next lecture</p>
              )}

              {/* Subject picker: only shown while actively editing (or before any subject is set) */}
              {(showSubjectInput || !sessionSubject) && (
                <div className="w-full max-w-xs mt-4">
                  <input
                    type="text"
                    value={sessionSubject}
                    onChange={e => { sessionSubjectRef.current = e.target.value; setSessionSubject(e.target.value) }}
                    onBlur={() => { setShowSubjectInput(false); capture('session_subject_selected', { source: showSubjectInput ? 'new' : 'default' }) }}
                    placeholder={profile?.course || 'Subject or module'}
                    className="w-full dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.10] border-black/[0.13] rounded-2xl px-4 py-2.5 text-[13px] dark:text-white text-gray-900 placeholder-gray-500 focus:outline-none focus:border-yellow-500/50 transition-colors"
                    autoFocus={showSubjectInput}
                  />
                </div>
              )}

              {/* Capture mode toggle */}
              <div className="mt-4 w-full max-w-xs">
                <div className="flex dark:bg-white/[0.07] bg-black/[0.06] rounded-full p-1">
                  <button
                    onClick={() => setCaptureMode('microphone')}
                    className={`flex-1 text-[13px] font-medium px-4 py-2.5 rounded-full transition-all duration-200 active:scale-[0.97] ${
                      captureMode === 'microphone'
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'text-gray-500 dark:text-white/45 hover:text-gray-700 dark:hover:text-white/65'
                    }`}
                  >
                    Live mic capture
                  </button>
                  <Tooltip content={tabCaptureSupportedState ? "When the sharing dialog opens, make sure to tick 'Share tab audio'" : isElectronNative() ? 'Not available in the desktop app, use the web version at demist.app for tab capture' : 'Not supported on this browser, try a desktop browser instead'}>
                    <button
                      onClick={() => tabCaptureSupportedState && setCaptureMode('tab')}
                      disabled={!tabCaptureSupportedState}
                      className={`flex-1 text-[13px] font-medium px-4 py-2.5 rounded-full transition-all duration-200 active:scale-[0.97] ${
                        !tabCaptureSupportedState
                          ? 'text-gray-400 dark:text-white/20 cursor-not-allowed'
                          : captureMode === 'tab'
                            ? 'bg-amber-500 text-white shadow-sm'
                            : 'text-gray-500 dark:text-white/45 hover:text-gray-700 dark:hover:text-white/65'
                      }`}
                    >
                      Tab capture
                    </button>
                  </Tooltip>
                </div>
                <p className="text-[12px] text-gray-500 dark:text-white/60 text-center mt-2 leading-relaxed">
                  {captureMode === 'microphone'
                    ? 'Uses your microphone'
                    : <>Pick the tab playing audio, tick <span className="text-gray-700 dark:text-white/70 font-medium">Share tab audio</span>, and Demist listens in.</>}
                </p>
              </div>
              {recordingWarning && (
                <p className="mt-3 text-amber-500 text-[12px] text-center max-w-xs leading-relaxed" role="status">{recordingWarning}</p>
              )}
              {recordingError && (
                <p className="mt-2 text-red-400 text-[13px] text-center max-w-xs" role="alert">{recordingError}</p>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 px-4 sm:px-6 pb-5 animate-step opacity-0" style={{ animationDelay: '60ms', animationFillMode: 'forwards' }}>
              {stats.dueFlashcards > 0 && (
                <Link
                  href="/flashcards"
                  className="col-span-2 flex items-center justify-between dark:bg-amber-500/[0.07] bg-amber-50 dark:border-amber-500/20 border-amber-300/70 border rounded-2xl px-4 py-3.5 dark:hover:bg-amber-500/[0.11] hover:bg-amber-100 transition-all group"
                >
                  <div>
                    <p className="text-[14px] font-semibold dark:text-amber-300 text-amber-800">{stats.dueFlashcards} flashcard{stats.dueFlashcards !== 1 ? 's' : ''} due</p>
                    <p className="text-[12px] dark:text-amber-400/50 text-amber-700/80 mt-0.5">
                      {stats.streak > 1 ? `Don't break your ${stats.streak}-day streak` : 'Review now: spaced repetition only works if you show up'}
                    </p>
                  </div>
                  <span className="dark:text-amber-400/60 text-amber-700/50 dark:group-hover:text-amber-300 group-hover:text-amber-900 transition-colors text-[20px] leading-none">›</span>
                </Link>
              )}
              <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.16] rounded-2xl px-4 py-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <p className="text-[11px] text-gray-600 uppercase tracking-[0.12em]">Streak</p>
                </div>
                <p className="text-[28px] font-bold leading-none text-amber-400">
                  {stats.streak}<span className="text-[14px] font-normal text-gray-600 ml-1">days</span>
                </p>
              </div>
              <div className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.16] rounded-2xl px-4 py-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                  <p className="text-[11px] text-gray-600 uppercase tracking-[0.12em]">This week</p>
                </div>
                <p className="text-[28px] font-bold leading-none dark:text-yellow-400 text-yellow-700">
                  {stats.termsThisWeek}<span className="text-[14px] font-normal text-gray-600 ml-1">concepts</span>
                </p>
              </div>
            </div>

            {/* Recent sessions */}
            <div className="px-4 sm:px-6 pb-4 animate-step opacity-0" style={{ animationDelay: '120ms', animationFillMode: 'forwards' }}>
              {recentSessions.length > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[11px] font-bold tracking-[0.18em] text-gray-600 uppercase">Recent Sessions</p>
                    <Link href="/history" className="text-[12px] text-yellow-500/70 hover:dark:text-yellow-400 text-yellow-700 transition-colors">See all</Link>
                  </div>
                  <div className="space-y-2">
                    {recentSessions.map(s => (
                      <div key={s.id} className="dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.07] border-black/[0.16] rounded-2xl overflow-hidden hover:bg-yellow-500/[0.04] hover:border-yellow-500/[0.15] transition-colors duration-200">
                        <div
                          onClick={() => s.termCount > 0 && toggleExpandSession(s.id)}
                          className={`flex items-center gap-3 px-4 py-3.5 ${s.termCount > 0 ? 'cursor-pointer' : ''}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`text-[14px] font-semibold truncate ${s.name ? 'dark:text-white/90 text-gray-900' : 'text-gray-600'}`}>
                              {s.name || sessionLabel(s.sessionNumber, s.started_at)}
                            </p>
                            <p className="text-[12px] text-gray-600 mt-0.5">{fmtRelative(s.started_at)}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {s.termCount > 0 && (
                              <span className="bg-yellow-500/10 border border-yellow-500/20 rounded-full px-2.5 py-0.5 text-[12px] font-semibold dark:text-yellow-400 text-yellow-700 tabular-nums">
                                {s.termCount}
                              </span>
                            )}
                            {s.termCount > 0 && <DashChevron expanded={s.expanded} />}
                          </div>
                        </div>

                        {s.expanded && (
                          <div className="px-4 pb-4 border-t dark:border-white/[0.04] border-black/[0.05]">
                            {s.synopsis ? (
                              <div className="pt-3">
                                <SummaryViewer synopsis={s.synopsis} sessionId={s.id} subject={profile?.course ?? null} year={profile?.year_of_study ?? null} />
                              </div>
                            ) : sessionGenIds.has(s.id) ? (
                              <p className="text-[12px] text-gray-700 pt-3">Generating summary...</p>
                            ) : sessionFailIds.has(s.id) ? (
                              <div className="flex items-center gap-3 pt-3">
                                <p className="text-[12px] text-gray-700">{summaryFailureMessage(sessionFailReasons[s.id])}</p>
                                <button onClick={() => retrySessionSummarize(s)} className="text-[12px] text-yellow-500 hover:dark:text-yellow-400 text-yellow-700 transition-colors shrink-0">Retry</button>
                              </div>
                            ) : null}

                            {sessionTermLoading === s.id && (
                              <p className="text-gray-700 text-[13px] pt-3">Loading...</p>
                            )}
                            {s.terms && s.terms.length > 0 && (
                              <div className="pt-3">
                                <p className="text-[10px] font-bold tracking-[0.15em] text-gray-600 uppercase mb-2">Words</p>
                                <div className="space-y-1.5">
                                  {s.terms.slice(0, 3).map(t => (
                                    <p key={t.id} className="text-[13px] text-gray-700 leading-snug">
                                      <span className="dark:text-white/70 text-gray-700 font-medium">{t.term}</span>
                                      {' '}- {t.definition}
                                    </p>
                                  ))}
                                </div>
                                {s.terms.length > 3 && (
                                  <Link href={`/history?session=${s.id}`} className="inline-block mt-2 text-[12px] text-yellow-500 hover:dark:text-yellow-400 text-yellow-700 transition-colors">
                                    +{s.terms.length - 3} more words in History
                                  </Link>
                                )}
                              </div>
                            )}
                            {s.terms && s.terms.length === 0 && (
                              <p className="text-gray-700 text-[13px] pt-3">No words detected.</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center py-8 text-center gap-5">
                  <div>
                    <p className="text-gray-600 text-[14px] font-medium mb-1">No sessions yet</p>
                    <p className="text-gray-700 text-[13px]">Hit record before your next lecture. Demist transcribes it, explains unfamiliar terms, and reads it back for you.</p>
                  </div>
                  <div className="w-full max-w-xs flex flex-col gap-2 text-left">
                    {[
                      { n: '1', text: 'Tap the mic at the top of this page' },
                      { n: '2', text: 'Unfamiliar terms appear on screen as you listen' },
                      { n: '3', text: 'Your glossary and flashcards build automatically' },
                    ].map(({ n, text }) => (
                      <div key={n} className="flex items-start gap-3 px-4 py-3 rounded-xl dark:bg-white/[0.03] bg-[#FAF9F6] border dark:border-white/[0.06] border-black/[0.10]">
                        <span className="w-5 h-5 rounded-full bg-yellow-500/20 dark:text-yellow-400 text-yellow-700 text-[11px] font-bold flex items-center justify-center shrink-0 mt-[1px]">{n}</span>
                        <p className="text-[13px] text-gray-600 leading-snug">{text}</p>
                      </div>
                    ))}
                  </div>
                  {tabCaptureSupportedState && (
                    <p className="text-[12px] text-gray-700 max-w-xs leading-relaxed">
                      On Zoom or in an online lecture? Switch to <span className="dark:text-white/60 text-gray-800 font-medium">Tab capture</span> above to capture the audio directly from your browser.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          </div>
        )}
      </div>

      {paywall && <PaywallModal source={paywall} onClose={() => setPaywall(null)} />}

      {/* End-of-session flashcard review */}
      {reviewTerms && <SessionReview terms={reviewTerms} onClose={() => setReviewTerms(null)} />}

      {/* First-time onboarding */}
      <OnboardingOverlay />

      {/* Term overlay */}
      <div className="term-overlay-bottom fixed inset-x-0 flex flex-col gap-3 items-center px-4 sm:px-5 z-50 pointer-events-none">
        {liveTerms.map(t => (
          <TermCard
            key={t.id}
            {...t}
            onDismiss={() => dismissTerm(t.id)}
            onKnown={() => markKnown(t)}
            onPin={() => pinTerm(t.id)}
            onReport={() => reportDefinition(t.term, t.definition)}
          />
        ))}
      </div>
    </main>
  )
}

function TermCard({
  term,
  definition,
  translation,
  dismissing,
  pinned,
  onDismiss,
  onKnown,
  onPin,
  onReport,
}: Omit<LiveTerm, 'id'> & { onDismiss: () => void; onKnown: () => void; onPin: () => void; onReport: () => void }) {
  const [reported, setReported] = useState(false)
  return (
    <div className={`pointer-events-auto w-full max-w-[420px] ${dismissing ? 'animate-slide-down' : 'animate-slide-up'}`}>
      <div
        onClick={onPin}
        className={`rounded-2xl px-5 py-4 dark:bg-[#13120e]/96 bg-[#FDFCF9]/96 border cursor-pointer ${pinned ? 'dark:border-amber-500/40 border-amber-500/60' : 'dark:border-amber-500/[0.18] border-amber-400/40'}`}
        style={{
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.20), 0 1px 0 rgba(255,255,255,0.04) inset',
        }}
      >
        <div className="flex items-start gap-3">
          {/* Amber left accent bar */}
          <div className="w-[3px] self-stretch rounded-full shrink-0 dark:bg-amber-400 bg-amber-600" />

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 mb-1.5">
              <p className="text-[10px] font-bold tracking-[0.18em] uppercase dark:text-amber-400/70 text-amber-700/80">
                {pinned ? 'Pinned' : 'Just detected'}
              </p>
              <button
                onClick={e => { e.stopPropagation(); onDismiss() }}
                aria-label="Dismiss"
                className="dark:text-white/25 text-gray-400 dark:hover:text-white/60 hover:text-gray-600 transition-colors shrink-0 text-[18px] leading-none mt-[-1px]"
              >
                ×
              </button>
            </div>
            <p className="text-[15px] font-semibold truncate dark:text-white/95 text-gray-900">{term}</p>
            <p className="text-[13px] leading-relaxed mt-1 dark:text-white/55 text-gray-600">{definition}</p>
            {translation && (
              <p className="text-[13px] leading-relaxed mt-1 dark:text-amber-300/80 text-amber-700">{translation}</p>
            )}
          </div>
        </div>

        <div className="mt-3 pt-2.5 border-t dark:border-white/[0.06] border-black/[0.07] ml-[15px] flex items-center justify-between">
          <button
            onClick={e => { e.stopPropagation(); onKnown() }}
            className="text-[12px] dark:text-white/60 text-gray-500 dark:hover:text-amber-400 hover:text-amber-700 transition-colors"
          >
            I already know this
          </button>
          {reported ? (
            <span className="text-[11px] text-gray-600 dark:text-white/25">Reported ✓</span>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); onReport(); setReported(true) }}
              className="text-[11px] text-gray-400 dark:text-white/30 hover:text-red-500 transition-colors"
            >
              Report
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Tooltip({ content, children }: { content: string; children: React.ReactNode }) {
  return (
    <span className="relative inline-flex group">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[220px] text-center text-[11px] leading-snug px-2.5 py-1.5 rounded-lg dark:bg-white/10 bg-gray-900 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-20"
      >
        {content}
      </span>
    </span>
  )
}

function MicIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="dark:text-gray-200 text-gray-800">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function StopIcon() {
  return <div className="w-[22px] h-[22px] rounded-[5px] dark:bg-white bg-gray-800" />
}

function DashChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={`text-gray-600 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

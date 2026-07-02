'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { capture, identify } from '@/lib/analytics'
import { requestWakeLock, releaseWakeLock, reacquireWakeLockOnVisibility, wakeLockSupported } from '@/lib/wakeLock'
import { startTabCapture, tabCaptureSupported } from '@/lib/tabCapture'
import { checkRecordingLimit } from '@/lib/subscription'

const SummaryViewer = dynamic(() => import('../summary-viewer').then(m => ({ default: m.SummaryViewer })), { ssr: false })
const OnboardingOverlay = dynamic(() => import('@/components/OnboardingOverlay').then(m => ({ default: m.OnboardingOverlay })), { ssr: false })
const MicCheck = dynamic(() => import('@/components/MicCheck').then(m => ({ default: m.MicCheck })), { ssr: false })
const SessionReview = dynamic(() => import('@/components/SessionReview').then(m => ({ default: m.SessionReview })), { ssr: false })
import { ConsentUnlockBanner, ConsentModal, MicModeNotice } from '@/components/ConsentUnlock'

type CaptureMode = 'microphone' | 'tab'

interface LiveTerm {
  id: string
  term: string
  definition: string
  dismissing: boolean
  dbId?: string
  pinned?: boolean
}

interface SessionTerm {
  id: string
  term: string
  definition: string
  known: boolean
}

interface RecentSession {
  id: string
  name: string | null
  subject: string | null
  started_at: string
  ended_at: string | null
  termCount: number
  sessionNumber: number
  synopsis: string | null
  transcript: string | null
  expanded: boolean
  terms?: SessionTerm[]
}

interface Profile {
  course: string | null
  year_of_study: number | null
}

interface Stats {
  streak: number
  termsThisWeek: number
  dueFlashcards: number
}

function calculateStreak(timestamps: string[]): number {
  if (!timestamps.length) return 0
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = new Set(timestamps.map(t => { const d = new Date(t); d.setHours(0,0,0,0); return d.getTime() }))
  let streak = 0; let cur = today.getTime()
  while (days.has(cur)) { streak++; cur -= 86400000 }
  return streak
}

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

function isLatinTerm(term: string): boolean {
  return /^[\x20-\x7EÀ-ɏͰ-Ͽ\s'-]+$/.test(term)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [isRecording, setIsRecording] = useState(false)

  const [elapsed, setElapsed] = useState(0)
  const [liveTerms, setLiveTerms] = useState<LiveTerm[]>([])
  const [sessionGlossary, setSessionGlossary] = useState<{ term: string; definition: string }[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState<Stats>({ streak: 0, termsThisWeek: 0, dueFlashcards: 0 })
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])
  const [sessionGenIds, setSessionGenIds] = useState<Set<string>>(new Set())
  const [sessionFailIds, setSessionFailIds] = useState<Set<string>>(new Set())
  const [sessionTermLoading, setSessionTermLoading] = useState<string | null>(null)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const [recordingWarning, setRecordingWarning] = useState<string | null>(null)
  const [wakeLockUnsupported, setWakeLockUnsupported] = useState(false)
  const [showAddToHomeScreen, setShowAddToHomeScreen] = useState(false)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('microphone')
  const [capturedTabTitle, setCapturedTabTitle] = useState<string | null>(null)
  const [tabCaptureSupportedState, setTabCaptureSupportedState] = useState(false)
  const [sentences, setSentences] = useState<string[]>([])
  const [isScrolledUp, setIsScrolledUp] = useState(false)
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null)
  const [showMicCheck, setShowMicCheck] = useState(false)
  const [reviewTerms, setReviewTerms] = useState<{ term: string; definition: string; dbId?: string }[] | null>(null)
  const [showConsentModal, setShowConsentModal] = useState(false)
  const [consentVersion, setConsentVersion] = useState(0)
  const [sessionSubject, setSessionSubject] = useState<string>('')
  const [recentSubjects, setRecentSubjects] = useState<string[]>([])
  const [showSubjectInput, setShowSubjectInput] = useState(false)
  const [micCheckAcknowledged, setMicCheckAcknowledged] = useState(false)

  const profileRef = useRef<Profile | null>(null)
  const sessionSubjectRef = useRef<string>('')
  const userIdRef = useRef<string | null>(null)
  const totalSessionCountRef = useRef(0)
  const sessionIdRef = useRef<string | null>(null)
  const isActiveRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const knownTermsRef = useRef<Set<string>>(new Set())
  const termFrequencyRef = useRef<Map<string, number>>(new Map())
  const sessionSummarizingRef = useRef(new Set<string>())
  const transcriptRef = useRef<string>('')
  const chunkIndexRef = useRef(0)
  const startRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const stopRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const startingRef = useRef(false)
  const captureModeRef = useRef<CaptureMode>('microphone')

  const detectionBufferRef = useRef('')   // accumulated Whisper text waiting for detect-terms
  const lastDetectionTimeRef = useRef(0)  // ms timestamp of last detect-terms call
  const recentContextRef = useRef('')     // last ~60s of transcript, passed as context to detect-terms
  const cardTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())  // live term card auto-dismiss timers, cancellable by pin
  const chunkIntervalRef = useRef(5_000)  // adaptive: 5s default, 10s during silence
  const zeroTermChunksRef = useRef(0)     // consecutive detect-terms calls with 0 terms
  const chunkPeakRef = useRef(0)           // max audio level seen during current chunk
  const webSpeechFinalRef = useRef('')     // accumulated final Web Speech results (fallback transcript)
  const allSessionTermsRef = useRef<{ term: string; definition: string; dbId?: string }[]>([])
  const speechModeRef = useRef(false)     // true = Web Speech is active display source
  const webSpeechHasFiredRef = useRef(false) // true once Web Speech onresult fires
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const hasInterimRef = useRef(false)     // true when last sentence item is still interim
  const audioProcessingCtxRef = useRef<AudioContext | null>(null)
  const vizAnalyserRef = useRef<AnalyserNode | null>(null)
  const processedStreamRef = useRef<MediaStream | null>(null)

  const ring1Ref = useRef<HTMLSpanElement | null>(null)
  const ring2Ref = useRef<HTMLSpanElement | null>(null)
  const ring3Ref = useRef<HTMLSpanElement | null>(null)
  const barsRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const webLockReleaseRef = useRef<(() => void) | null>(null)
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
      // Do NOT close ctx here — it's the processing context owned by startRecording/stopRecording
      if (btnRef.current) btnRef.current.style.boxShadow = ''
      if (barsRef.current) Array.from(barsRef.current.children).forEach(b => { (b as HTMLElement).style.height = '4px' })
    }
  }, [isRecording])

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== window || (e.data as Record<string, unknown>)?.source !== 'demist-ext') return
      const cmd = (e.data as Record<string, unknown>).command
      if (cmd === 'start-recording' && !isActiveRef.current) startRecordingRef.current()
      else if (cmd === 'stop-recording' && isActiveRef.current) stopRecordingRef.current()
      else if (cmd === 'mark-known') {
        const termId = (e.data as Record<string, unknown>).termId as string | undefined
        if (termId) {
          createClient().from('terms').update({ known: true }).eq('id', termId)
          knownTermsRef.current.add(termId)
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // Live transcript — subscribe to new chunks for the active session via Supabase Realtime
  useEffect(() => {
    if (!liveSessionId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`transcript-${liveSessionId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'transcript_chunks',
        filter: `session_id=eq.${liveSessionId}`,
      }, (payload) => {
        const text = (payload.new as { text?: string }).text
        // Skip if processChunk already added this sentence locally
        if (text) setSentences(prev => prev[prev.length - 1] === text ? prev : [...prev, text])
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [liveSessionId])

  // Auto-scroll the live transcript to the bottom as new sentences arrive
  useEffect(() => {
    if (!autoScrollRef.current) return
    const el = transcriptContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [sentences])

  // iOS "Add to Home Screen" prompt — once per session, for users not already standalone
  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    if (isIOS && !isStandalone && !sessionStorage.getItem('demist-a2hs-shown')) {
      sessionStorage.setItem('demist-a2hs-shown', '1')
      setShowAddToHomeScreen(true)
    }
    setTabCaptureSupportedState(tabCaptureSupported())
  }, [])

  // Stop Web Speech and the recording session cleanly if the user closes the
  // tab or navigates away mid-recording.
  useEffect(() => {
    const handleUnload = () => {
      if (!isActiveRef.current) return
      try { recognitionRef.current?.stop() } catch { /* ignore */ }
      stopRecordingRef.current()
    }
    window.addEventListener('beforeunload', handleUnload)
    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      handleUnload()
    }
  }, [])

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const user = session?.user
      if (!user) return
      userIdRef.current = user.id
      identify(user.id); capture('dashboard_viewed')

      const now = new Date()
      const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString()

      const [
        { data: prof },
        { data: allTerms },
        { data: sessionDays },
        { count: dueReviewCount },
        { count: newCardCount },
        { data: sessionsRaw },
        { count: totalCount },
      ] = await Promise.all([
        supabase.from('profiles').select('course, year_of_study').eq('id', user.id).maybeSingle(),
        supabase.from('terms').select('term, known, created_at').eq('user_id', user.id),
        supabase.from('sessions').select('started_at').eq('user_id', user.id).order('started_at', { ascending: false }),
        supabase.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('known', false).gt('sm2_review_count', 0).lte('sm2_due_at', now.toISOString()),
        supabase.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('known', false).eq('sm2_review_count', 0),
        supabase.from('sessions').select('id, name, subject, started_at, ended_at, synopsis, transcript').eq('user_id', user.id).order('started_at', { ascending: false }).limit(5),
        supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ])
      totalSessionCountRef.current = totalCount ?? 0

      profileRef.current = prof as Profile
      setProfile(prof as Profile)

      const defaultSubject = (prof as Profile)?.course ?? ''
      if (!sessionSubjectRef.current) {
        sessionSubjectRef.current = defaultSubject
        setSessionSubject(defaultSubject)
      }

      const known = new Set<string>()
      const freq = new Map<string, number>()
      for (const t of allTerms ?? []) {
        const key = t.term.toLowerCase()
        if (t.known) known.add(key)
        freq.set(key, (freq.get(key) ?? 0) + 1)
      }
      knownTermsRef.current = known
      termFrequencyRef.current = freq

      const termsThisWeek = (allTerms ?? []).filter(t => t.created_at >= weekAgo).length
      const streak = calculateStreak((sessionDays ?? []).map(s => s.started_at))
      const dueFlashcards = (dueReviewCount ?? 0) + Math.min(15, newCardCount ?? 0)
      setStats({ streak, termsThisWeek, dueFlashcards })

      if (sessionsRaw?.length) {
        const ids = sessionsRaw.map(s => s.id)
        const { data: termRows } = await supabase.from('terms').select('session_id').in('session_id', ids)
        const countMap: Record<string, number> = {}
        for (const r of termRows ?? []) countMap[r.session_id] = (countMap[r.session_id] ?? 0) + 1
        const tc = totalSessionCountRef.current
        setRecentSessions(sessionsRaw.map((s, i) => ({ id: s.id, name: (s as { name?: string | null }).name ?? null, subject: (s as { subject?: string | null }).subject ?? null, started_at: s.started_at, ended_at: s.ended_at, termCount: countMap[s.id] ?? 0, sessionNumber: tc - i, synopsis: (s as { synopsis?: string | null }).synopsis ?? null, transcript: (s as { transcript?: string | null }).transcript ?? null, expanded: false })))
        setRecentSubjects([...new Set(sessionsRaw.map((s: { subject?: string | null }) => s.subject).filter(Boolean))].slice(0, 6) as string[])
      }

      setLoading(false)
    })()
  }, [])

  // ── Shared: detect terms, save to DB, update UI ──────────────────────────────

  const runDetection = async (transcript: string, sessionId: string, token: string, context = '') => {
    const supabase = createClient()
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!

    const dtRes = await fetch(`${base}/functions/v1/detect-terms`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        context,
        subject: sessionSubjectRef.current || profileRef.current?.course || 'general',
        year: profileRef.current?.year_of_study ?? 1,
        known_terms: Array.from(knownTermsRef.current),
      }),
    })
    if (!dtRes.ok) {
      if (dtRes.status === 429) {
        setRecordingWarning('Term detection rate limit reached for this hour — recording and transcription continue normally.')
      } else if (dtRes.status === 401) {
        setRecordingError('Session expired. Sign in again to continue recording.')
        stopRecordingRef.current()
      }
      return
    }
    const detected = await dtRes.json()

    // Adaptive chunking: after 3 consecutive empty detections, slow the chunk
    // loop to 10s to halve API calls during silence. Reset to 5s on any hit.
    if (!detected?.terms?.length) {
      zeroTermChunksRef.current++
      if (zeroTermChunksRef.current >= 3 && chunkIntervalRef.current !== 10_000) {
        chunkIntervalRef.current = 10_000
        console.log('[demist] 3 empty detections — chunk interval expanded to 10s')
      }
      return
    }
    if (chunkIntervalRef.current !== 5_000) {
      console.log('[demist] terms detected — chunk interval reset to 5s')
    }
    zeroTermChunksRef.current = 0
    chunkIntervalRef.current = 5_000

    const filtered = (detected.terms as { term: string; definition: string }[]).filter(t => {
      const key = t.term.toLowerCase()
      return isLatinTerm(t.term) &&
             !knownTermsRef.current.has(key) &&
             (termFrequencyRef.current.get(key) ?? 0) < 3
    })
    if (!filtered.length) return

    for (const t of filtered) {
      termFrequencyRef.current.set(t.term.toLowerCase(), (termFrequencyRef.current.get(t.term.toLowerCase()) ?? 0) + 1)
    }

    // Optimistic UI: show the card and glossary entry immediately, before the
    // DB insert round-trip. dbId arriving later confirms the save.
    setSessionGlossary(prev => [...filtered.map(t => ({ term: t.term, definition: t.definition })), ...prev])
    const incoming: LiveTerm[] = filtered.slice(0, 1).map(t => ({
      id: `${Date.now()}-${Math.random()}`,
      term: t.term,
      definition: t.definition,
      dismissing: false,
    }))
    setLiveTerms(prev => [...prev, ...incoming].slice(-3))
    incoming.forEach(({ id, term }) => {
      capture('term_card_shown', { term })
      scheduleCardDismiss(id, term)
    })

    const { data: saved, error: saveErr } = await supabase
      .from('terms')
      .insert(filtered.map(t => ({
        user_id: userIdRef.current,
        session_id: sessionId,
        term: t.term,
        definition: t.definition,
        subject: sessionSubjectRef.current || profileRef.current?.course,
      })))
      .select('id, term, definition')

    if (saveErr || !saved?.length) {
      // Roll back the optimistic glossary entries and dismiss the card quietly
      console.error('term save failed:', saveErr)
      const failedKeys = new Set(filtered.map(t => t.term.toLowerCase()))
      setSessionGlossary(prev => {
        const next = [...prev]
        for (const key of failedKeys) {
          const i = next.findIndex(g => g.term.toLowerCase() === key)
          if (i !== -1) next.splice(i, 1)
        }
        return next
      })
      incoming.forEach(({ id }) => dismissTerm(id))
      return
    }

    const dbMap = Object.fromEntries(saved.map((s: { id: string; term: string }) => [s.term.toLowerCase(), s.id]))
    setLiveTerms(prev => prev.map(t => {
      const dbId = dbMap[t.term.toLowerCase()]
      return dbId ? { ...t, dbId } : t
    }))

    for (const t of filtered) {
      allSessionTermsRef.current.push({ term: t.term, definition: t.definition, dbId: dbMap[t.term.toLowerCase()] })
    }

    // Include DB id so the extension can offer "mark as known" on the overlay card
    for (const t of filtered) {
      window.postMessage({
        source: 'demist',
        type: 'term',
        term: t.term,
        definition: t.definition,
        termId: dbMap[t.term.toLowerCase()] ?? null,
      }, window.location.origin)
    }
  }

  const scheduleCardDismiss = (id: string, term: string) => {
    const timer = setTimeout(() => {
      cardTimersRef.current.delete(id)
      capture('term_card_auto_dismissed', { term })
      setLiveTerms(prev => prev.map(t => t.id === id ? { ...t, dismissing: true } : t))
      setTimeout(() => setLiveTerms(prev => prev.filter(t => t.id !== id)), 380)
    }, 10_000)
    cardTimersRef.current.set(id, timer)
  }

  // Tapping a card pins it open so the user can finish reading
  const pinTerm = (id: string) => {
    const timer = cardTimersRef.current.get(id)
    if (!timer) return
    clearTimeout(timer)
    cardTimersRef.current.delete(id)
    setLiveTerms(prev => prev.map(t => {
      if (t.id === id && !t.pinned) capture('term_card_expanded', { term: t.term })
      return t.id === id ? { ...t, pinned: true } : t
    }))
  }

  // ── Whisper path: transcribe audio blob then detect terms ─────────────────────
  // Skips Whisper entirely if audio level was below silence threshold.

  const processChunk = async (blob: Blob, sessionId: string) => {
    const peak = chunkPeakRef.current
    chunkPeakRef.current = 0
    if (peak < 0.015) {
      console.log('[demist] silent chunk skipped (peak', peak.toFixed(3) + ')')
      return
    }
    if (blob.size < 500) return
    const supabase = createClient()
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { console.error('processChunk: no auth token'); return }
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const chunkIndex = chunkIndexRef.current++

      const txRes = await fetch(`${base}/functions/v1/transcribe?session_id=${encodeURIComponent(sessionId)}&chunk_index=${chunkIndex}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
      })
      if (!txRes.ok) {
        if (txRes.status === 429) {
          setRecordingWarning('Transcription rate limit reached — recording continues but text won\'t display until the next hour.')
        } else if (txRes.status === 401) {
          setRecordingError('Session expired. Sign in again to continue recording.')
          stopRecordingRef.current()
        }
        return
      }
      const tx = await txRes.json()
      if (!tx?.text?.trim()) return
      const chunkText = tx.text.trim()
      transcriptRef.current = transcriptRef.current ? transcriptRef.current + ' ' + chunkText : chunkText
      if (!speechModeRef.current || !webSpeechHasFiredRef.current) setSentences(prev => [...prev, chunkText])

      // Accumulate text; only call detect-terms every ~15s to keep GPT cost constant
      detectionBufferRef.current += (detectionBufferRef.current ? ' ' : '') + chunkText
      const msSinceDetection = Date.now() - lastDetectionTimeRef.current
      if ((msSinceDetection >= 15_000 || !isActiveRef.current) && detectionBufferRef.current.trim()) {
        const toDetect = detectionBufferRef.current
        const context = recentContextRef.current
        // Roll context forward: keep last ~60s worth (~300 chars) as future context
        recentContextRef.current = (context + ' ' + toDetect).trim().slice(-300)
        detectionBufferRef.current = ''
        lastDetectionTimeRef.current = Date.now()
        await runDetection(toDetect, sessionId, token, context)
      }
    } catch (e) {
      console.error('processChunk error:', e)
    }
  }

  const startRecording = async (mode: CaptureMode = 'microphone') => {
    if (isActiveRef.current || startingRef.current) return
    startingRef.current = true
    captureModeRef.current = mode
    setCapturedTabTitle(null)

    // Paywall gate — no-op while PAYWALL_ENABLED is false
    if (userIdRef.current) {
      const gate = await checkRecordingLimit(createClient(), userIdRef.current)
      if (!gate.allowed) {
        startingRef.current = false
        setRecordingError(gate.reason ?? 'Recording limit reached.')
        return
      }
    }

    // Create and resume AudioContext synchronously within the user gesture — if deferred past
    // any await, iOS Safari considers the gesture consumed and keeps the context suspended.
    const audioCtx = new AudioContext()
    audioCtx.resume()
    audioProcessingCtxRef.current = audioCtx

    let stream: MediaStream
    if (mode === 'tab') {
      let tabStream: MediaStream | null
      try {
        tabStream = await startTabCapture()
      } catch (err) {
        audioCtx.close()
        audioProcessingCtxRef.current = null
        startingRef.current = false
        setRecordingError((err as Error)?.message || 'No audio detected. Make sure to select a browser tab, not a window or screen. Also check the "Share tab audio" checkbox in the sharing dialog.')
        return
      }
      if (!tabStream) {
        // User cancelled the tab picker
        audioCtx.close()
        audioProcessingCtxRef.current = null
        startingRef.current = false
        return
      }
      stream = tabStream
      const audioTrack = stream.getAudioTracks()[0]
      setCapturedTabTitle(audioTrack?.label || 'Browser tab')
      audioTrack?.addEventListener('ended', () => {
        if (!isActiveRef.current) return
        setRecordingError('The shared tab was closed or sharing was stopped.')
        stopRecordingRef.current()
      })
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        })
      } catch {
        audioCtx.close()
        audioProcessingCtxRef.current = null
        startingRef.current = false
        alert('Microphone access is needed to use Demist.')
        return
      }
    }
    streamRef.current = stream

    // Audio processing pipeline: boost quiet audio and normalise volume.
    // Raw stream → gain(2.5×) → compressor → processedStream → MediaRecorder
    const src = audioCtx.createMediaStreamSource(stream)
    const gain = audioCtx.createGain()
    gain.gain.value = 2.5
    const compressor = audioCtx.createDynamicsCompressor()
    compressor.threshold.value = -30
    compressor.knee.value = 20
    compressor.ratio.value = 4
    compressor.attack.value = 0.003
    compressor.release.value = 0.15
    const dest = audioCtx.createMediaStreamDestination()
    // Branch the analyser off src so the visualizer reads raw levels without
    // a second MediaStreamAudioSourceNode (Chrome only allows one per stream per context).
    const vizAnalyser = audioCtx.createAnalyser()
    vizAnalyser.fftSize = 512; vizAnalyser.smoothingTimeConstant = 0.78
    src.connect(vizAnalyser)
    vizAnalyserRef.current = vizAnalyser
    src.connect(gain)
    gain.connect(compressor)
    compressor.connect(dest)
    processedStreamRef.current = dest.stream
    sessionIdRef.current = null

    const supabase = createClient()
    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .insert({ user_id: userIdRef.current, subject: sessionSubjectRef.current || profileRef.current?.course, year_of_study: profileRef.current?.year_of_study, capture_mode: mode })
      .select('id').single()

    if (sessionErr || !session) {
      streamRef.current?.getTracks().forEach(t => t.stop())
      audioProcessingCtxRef.current?.close()
      audioProcessingCtxRef.current = null
      startingRef.current = false
      alert('Could not start session. Check your connection and try again.')
      return
    }
    const sessionId = session.id
    sessionIdRef.current = sessionId
    isActiveRef.current = true
    termFrequencyRef.current = new Map()
    transcriptRef.current = ''
    chunkIndexRef.current = 0
    detectionBufferRef.current = ''
    recentContextRef.current = ''
    lastDetectionTimeRef.current = Date.now()
    chunkIntervalRef.current = 5_000
    zeroTermChunksRef.current = 0
    chunkPeakRef.current = 0
    webSpeechFinalRef.current = ''
    allSessionTermsRef.current = []
    startingRef.current = false
    setIsRecording(true); setElapsed(0); setLiveTerms([]); setSessionGlossary([]); setRecordingError(null)
    setSentences([]); setIsScrolledUp(false); autoScrollRef.current = true
    setLiveSessionId(sessionId)
    setWakeLockUnsupported(!wakeLockSupported())
    window.postMessage({ source: 'demist', type: 'recording-started' }, window.location.origin)
    timerRef.current = setInterval(() => setElapsed(t => t + 1), 1000)

    // Keep the screen on for the duration of the recording so audio capture
    // isn't interrupted when the device locks.
    await requestWakeLock()
    reacquireWakeLockOnVisibility()

    // Hold a Web Lock for the duration of recording so Chrome doesn't throttle
    // background-tab timers (which would delay the 10-second Whisper chunk loop).
    if ('locks' in navigator) {
      navigator.locks.request('demist-recording', () => new Promise<void>(resolve => {
        webLockReleaseRef.current = resolve
      })).catch(() => {})
    }

    // ── Whisper path: 10-second chunk loop ──────────────────────────────────────
    const doChunk = () => {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      // Use raw getUserMedia stream — Chrome suspends AudioContext in background tabs
      // but always delivers audio from getUserMedia regardless of tab visibility.
      const recorder = new MediaRecorder(streamRef.current!, { mimeType })
      recorderRef.current = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = (e: BlobEvent) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType })
        if (sessionIdRef.current) processChunk(blob, sessionIdRef.current)
        if (isActiveRef.current) doChunk()
      }
      recorder.start()
      chunkTimerRef.current = setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, chunkIntervalRef.current)
    }

    doChunk()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI = typeof window !== 'undefined' ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null) : null
    if (SpeechRecognitionAPI) {
      speechModeRef.current = true
      webSpeechHasFiredRef.current = false
      hasInterimRef.current = false

      const recognition = new SpeechRecognitionAPI()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'
      recognitionRef.current = recognition
      let consecutiveNoSpeech = 0

      const noResultWatchdog = setTimeout(() => {
        if (!isActiveRef.current || webSpeechHasFiredRef.current) return
        speechModeRef.current = false
        try { recognition.stop() } catch { /* ignore */ }
      }, 5_000)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        clearTimeout(noResultWatchdog)
        webSpeechHasFiredRef.current = true
        consecutiveNoSpeech = 0
        let interimText = ''
        let finalText = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const t = event.results[i][0].transcript
          if (event.results[i].isFinal) finalText += t + ' '
          else interimText += t
        }
        if (interimText) {
          setSentences(prev => {
            if (hasInterimRef.current && prev.length > 0) return [...prev.slice(0, -1), interimText]
            hasInterimRef.current = true
            return [...prev, interimText]
          })
        }
        if (finalText.trim()) {
          webSpeechFinalRef.current += finalText.trim() + ' '
          setSentences(prev => {
            const base = hasInterimRef.current && prev.length > 0 ? prev.slice(0, -1) : prev
            hasInterimRef.current = false
            return [...base, finalText.trim()]
          })
        }
      }

      recognition.onend = () => {
        if (isActiveRef.current && speechModeRef.current) {
          try { recognition.start() } catch { /* already starting */ }
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') {
          consecutiveNoSpeech++
          if (consecutiveNoSpeech >= 3 && !webSpeechHasFiredRef.current) {
            speechModeRef.current = false
            clearTimeout(noResultWatchdog)
          }
          return
        }
        speechModeRef.current = false
        clearTimeout(noResultWatchdog)
      }

      recognition.start()
    }

    capture('recording_started', { subject: sessionSubjectRef.current || profileRef.current?.course, mode: SpeechRecognitionAPI ? 'whisper+speech_api' : 'whisper' })
  }

  const stopRecording = async () => {
    isActiveRef.current = false

    // Always stop the Whisper MediaRecorder loop
    if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()

    speechModeRef.current = false
    hasInterimRef.current = false
    try { recognitionRef.current?.stop() } catch { /* ignore */ }
    recognitionRef.current = null

    // Flush any text waiting for the 15s detect-terms window so terms from the
    // final seconds of the lecture aren't lost.
    if (detectionBufferRef.current.trim() && sessionIdRef.current) {
      const toDetect = detectionBufferRef.current
      const context = recentContextRef.current
      detectionBufferRef.current = ''
      lastDetectionTimeRef.current = Date.now()
      const flushSid = sessionIdRef.current
      createClient().auth.getSession().then(({ data: { session } }) => {
        const token = session?.access_token
        if (token) runDetection(toDetect, flushSid, token, context)
      }).catch(() => {})
    }

    // Release the Web Lock so Chrome can resume normal background throttling
    webLockReleaseRef.current?.()
    webLockReleaseRef.current = null

    // Let the screen lock again now that recording has stopped
    await releaseWakeLock()

    if (timerRef.current) clearInterval(timerRef.current)
    audioProcessingCtxRef.current?.close()
    audioProcessingCtxRef.current = null
    vizAnalyserRef.current = null
    processedStreamRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    const sid = sessionIdRef.current
    if (sid) {
      const supabase = createClient()
      await supabase.from('sessions').update({ ended_at: new Date().toISOString() }).eq('id', sid)
    }
    setIsRecording(false)
    setRecordingWarning(null)
    setCapturedTabTitle(null)
    setLiveSessionId(null)
    window.postMessage({ source: 'demist', type: 'recording-stopped' }, window.location.origin)
    capture('recording_stopped', { duration_seconds: elapsed })
    if (allSessionTermsRef.current.length > 0) setReviewTerms([...allSessionTermsRef.current])

    const supabase = createClient()
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
    const [
      { data: allTerms },
      { data: sessionDays },
      { count: dueReviewCount },
      { count: newCardCount },
    ] = await Promise.all([
      supabase.from('terms').select('term, known, created_at').eq('user_id', userIdRef.current!),
      supabase.from('sessions').select('started_at').eq('user_id', userIdRef.current!).order('started_at', { ascending: false }),
      supabase.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', userIdRef.current!).eq('known', false).gt('sm2_review_count', 0).lte('sm2_due_at', now.toISOString()),
      supabase.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', userIdRef.current!).eq('known', false).eq('sm2_review_count', 0),
    ])
    const termsThisWeek = (allTerms ?? []).filter(t => t.created_at >= weekAgo).length
    const streak = calculateStreak((sessionDays ?? []).map((s: { started_at: string }) => s.started_at))
    const dueFlashcards = (dueReviewCount ?? 0) + Math.min(15, newCardCount ?? 0)
    setStats({ streak, termsThisWeek, dueFlashcards })

    const [{ data: sessionsRaw }, { count: newTotal }] = await Promise.all([
      supabase.from('sessions').select('id, name, subject, started_at, ended_at, synopsis, transcript')
        .eq('user_id', userIdRef.current!).order('started_at', { ascending: false }).limit(5),
      supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', userIdRef.current!),
    ])
    totalSessionCountRef.current = newTotal ?? totalSessionCountRef.current
    if (sessionsRaw?.length) {
      const ids = sessionsRaw.map((s: { id: string }) => s.id)
      const { data: termRows } = await supabase.from('terms').select('session_id').in('session_id', ids)
      const countMap: Record<string, number> = {}
      for (const r of termRows ?? []) countMap[r.session_id] = (countMap[r.session_id] ?? 0) + 1
      const tc = totalSessionCountRef.current
      setRecentSessions(sessionsRaw.map((s: { id: string; name?: string | null; subject?: string | null; started_at: string; ended_at: string | null; synopsis?: string | null; transcript?: string | null }, i: number) => ({ id: s.id, name: s.name ?? null, subject: s.subject ?? null, started_at: s.started_at, ended_at: s.ended_at, termCount: countMap[s.id] ?? 0, sessionNumber: tc - i, synopsis: s.synopsis ?? null, transcript: s.transcript ?? null, expanded: false })))
      setRecentSubjects([...new Set(sessionsRaw.map((s: { subject?: string | null }) => s.subject).filter(Boolean))].slice(0, 6) as string[])
    }

    if (sid) {
      const capturedSid = sid
      const capturedSubject = sessionSubjectRef.current || profileRef.current?.course
      const capturedGlossary = [...sessionGlossary]
      const capturedMode = captureModeRef.current
      setTimeout(async () => {
        try {
          const sb = createClient()

          // Mic mode requires lecturer consent before storing transcript or summary
          if (capturedMode === 'microphone') {
            const { data: consent } = await sb
              .from('lecturer_consents')
              .select('id')
              .eq('module_name', capturedSubject ?? '')
              .maybeSingle()
            if (!consent) {
              await sb.from('transcript_chunks').delete().eq('session_id', capturedSid)
              return
            }
          }

          const whisperTx = transcriptRef.current.trim()
          const speechTx = webSpeechFinalRef.current.trim()
          const tx = speechTx.length > whisperTx.length ? speechTx : whisperTx
          if (tx) {
            await sb.from('sessions').update({ transcript: tx }).eq('id', capturedSid)
            setRecentSessions(prev => prev.map(s => s.id === capturedSid ? { ...s, transcript: tx } : s))
          }
          const { data } = await sb.functions.invoke('summarize-session', {
            body: { session_id: capturedSid, subject: capturedSubject, terms: capturedGlossary },
          })
          if (data?.ok && data?.synopsis) {
            setRecentSessions(prev => prev.map(s => s.id === capturedSid ? { ...s, synopsis: data.synopsis } : s))
          }
        } catch (e) {
          console.error('post-session error:', e)
          setSessionFailIds(prev => new Set(prev).add(capturedSid))
        }
      }, 6000)
    }
  }

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

  const dismissTerm = (id: string) => {
    const timer = cardTimersRef.current.get(id)
    if (timer) { clearTimeout(timer); cardTimersRef.current.delete(id) }
    setLiveTerms(prev => prev.map(t => t.id === id ? { ...t, dismissing: true } : t))
    setTimeout(() => setLiveTerms(prev => prev.filter(t => t.id !== id)), 380)
  }

  const markKnown = async (liveTerm: LiveTerm) => {
    dismissTerm(liveTerm.id)
    const key = liveTerm.term.toLowerCase()
    knownTermsRef.current.add(key)
    if (liveTerm.dbId) {
      const supabase = createClient()
      await supabase.from('terms').update({ known: true }).eq('id', liveTerm.dbId)
    }
  }

  const maybeGenerateOnDashboard = async (s: RecentSession) => {
    if (s.synopsis || !s.terms?.length) return
    if (sessionSummarizingRef.current.has(s.id)) return
    sessionSummarizingRef.current.add(s.id)
    setSessionGenIds(prev => new Set(prev).add(s.id))
    setSessionFailIds(prev => { const next = new Set(prev); next.delete(s.id); return next })
    let succeeded = false
    try {
      const supabase = createClient()
      const { data, error } = await supabase.functions.invoke('summarize-session', {
        body: { session_id: s.id, subject: profileRef.current?.course, terms: s.terms },
      })
      if (!error && data?.ok && data?.synopsis) {
        setRecentSessions(prev => prev.map(x => x.id === s.id ? { ...x, synopsis: data.synopsis } : x))
        succeeded = true
      }
    } catch (e) {
      console.error('dashboard summarize error:', e)
    } finally {
      sessionSummarizingRef.current.delete(s.id)
      setSessionGenIds(prev => { const next = new Set(prev); next.delete(s.id); return next })
      if (!succeeded) setSessionFailIds(prev => new Set(prev).add(s.id))
    }
  }

  const retrySessionSummarize = (s: RecentSession) => {
    sessionSummarizingRef.current.delete(s.id)
    setSessionFailIds(prev => { const next = new Set(prev); next.delete(s.id); return next })
    maybeGenerateOnDashboard(s)
  }

  const reportDefinition = async (term: string, definition: string) => {
    await createClient().from('definition_reports').insert({ term, definition })
    capture('definition_reported', { term })
  }

  const toggleExpandSession = async (id: string) => {
    const target = recentSessions.find(s => s.id === id)
    if (!target) return
    if (target.expanded) {
      setRecentSessions(prev => prev.map(s => s.id === id ? { ...s, expanded: false } : s))
      return
    }
    if (target.terms !== undefined) {
      setRecentSessions(prev => prev.map(s => s.id === id ? { ...s, expanded: true } : s))
      maybeGenerateOnDashboard(target)
      return
    }
    setSessionTermLoading(id)
    const supabase = createClient()
    const { data } = await supabase
      .from('terms').select('id, term, definition, known')
      .eq('session_id', id).order('created_at', { ascending: true })
    const terms = (data ?? []) as SessionTerm[]
    setRecentSessions(prev => prev.map(s => s.id === id ? { ...s, terms, expanded: true } : s))
    setSessionTermLoading(null)
    maybeGenerateOnDashboard({ ...target, terms })
  }

  startRecordingRef.current = startRecording
  stopRecordingRef.current = stopRecording

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

            {/* Live transcript — fills the space between the recording button and term cards */}
            <div className="flex-1 min-h-[80px] px-4 sm:px-6 py-3 relative z-10">
              <div className="relative h-full">
                <div
                  ref={transcriptContainerRef}
                  onScroll={handleTranscriptScroll}
                  onClick={handleTranscriptClick}
                  className={`transcript-container h-full overflow-y-auto ${isScrolledUp ? 'scrolled-up' : ''}`}
                >
                  {sentences.length === 0 && (
                    <p className="text-[13px] text-gray-700 italic">Transcription will appear here as you speak…</p>
                  )}
                  {sentences.map((sentence, index) => {
                    const age = Math.min(sentences.length - 1 - index, 5)
                    return (
                      <p
                        key={index}
                        data-age={age}
                        className="text-sm leading-relaxed mb-1 transition-opacity duration-500"
                        dangerouslySetInnerHTML={{ __html: highlightTerms(sentence) }}
                      />
                    )
                  })}
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
                        <span className="text-[13px] font-semibold dark:text-white/90 text-gray-900">{t.term}</span>
                        <p className="text-[12px] text-gray-700 mt-0.5 leading-relaxed">{t.definition}</p>
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
                  onClick={async () => {
                    if (captureMode !== 'microphone') { startRecording(captureMode); return }
                    const sb = createClient()
                    const { data } = await sb.from('mic_acknowledgments').select('user_id').eq('subject', sessionSubjectRef.current).maybeSingle()
                    setMicCheckAcknowledged(!!data)
                    setShowMicCheck(true)
                  }}
                  aria-label="Start recording"
                  className="relative z-10 w-[96px] h-[96px] rounded-full dark:bg-white/[0.08] bg-[#FAF9F6] border border-yellow-500/40 hover:bg-yellow-500/10 hover:border-yellow-500/60 hover:shadow-[0_0_48px_rgba(161,98,7,0.30)] dark:hover:shadow-[0_0_48px_rgba(251,191,36,0.30)] active:scale-[0.97] flex items-center justify-center transition-all duration-200 select-none shadow-sm"
                >
                  <MicIcon />
                </button>
              </div>
              <p className="dark:text-white/90 text-gray-900 font-semibold text-[17px]">
                {sessionSubject ? `Ready for ${sessionSubject}` : 'Start recording'}
              </p>
              <p className="text-gray-600 text-[13px] mt-1.5">Tap the mic before your next lecture</p>

              {/* Subject picker */}
              <div className="w-full max-w-xs mt-4">
                {recentSubjects.length > 0 && !showSubjectInput ? (
                  <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                    {recentSubjects.map(s => (
                      <button
                        key={s}
                        onClick={() => { sessionSubjectRef.current = s; setSessionSubject(s); capture('session_subject_selected', { source: 'chip' }) }}
                        className={`shrink-0 text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors ${sessionSubject === s ? 'bg-amber-500 text-white border-amber-500' : 'dark:border-white/10 border-black/10 text-gray-600 dark:hover:border-white/20 hover:border-black/20'}`}
                      >
                        {s}
                      </button>
                    ))}
                    <button
                      onClick={() => setShowSubjectInput(true)}
                      className="shrink-0 text-[12px] font-medium px-3 py-1.5 rounded-full border dark:border-white/10 border-black/10 text-gray-600 dark:hover:border-white/20 hover:border-black/20 transition-colors"
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={sessionSubject}
                    onChange={e => { sessionSubjectRef.current = e.target.value; setSessionSubject(e.target.value) }}
                    onBlur={() => { if (recentSubjects.length > 0) { setShowSubjectInput(false) } capture('session_subject_selected', { source: showSubjectInput ? 'new' : 'default' }) }}
                    placeholder={profile?.course || 'Subject or module'}
                    className="w-full dark:bg-white/[0.05] bg-[#F6F5F2] border dark:border-white/[0.10] border-black/[0.13] rounded-2xl px-4 py-2.5 text-[13px] dark:text-white text-gray-900 placeholder-gray-500 focus:outline-none focus:border-yellow-500/50 transition-colors"
                    autoFocus={showSubjectInput}
                  />
                )}
              </div>

              {/* Capture mode toggle */}
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={() => setCaptureMode('microphone')}
                  className={`text-[12px] font-medium px-3.5 py-2.5 min-h-[44px] rounded-full border transition-colors ${captureMode === 'microphone' ? 'bg-amber-500 text-white border-amber-500' : 'dark:border-white/10 border-black/10 text-gray-600 dark:hover:border-white/20 hover:border-black/20'}`}
                >
                  <span className="block">In person</span>
                  {captureMode === 'microphone' && <span className="block text-[10px] opacity-80 font-normal leading-tight mt-0.5">uses your mic</span>}
                </button>
                {tabCaptureSupportedState && (
                  <Tooltip content="When the sharing dialog opens, make sure to tick 'Share tab audio'">
                    <button
                      onClick={() => setCaptureMode('tab')}
                      className={`text-[12px] font-medium px-3.5 py-2.5 min-h-[44px] rounded-full border transition-colors ${captureMode === 'tab' ? 'bg-amber-500 text-white border-amber-500' : 'dark:border-white/10 border-black/10 text-gray-600 dark:hover:border-white/20 hover:border-black/20'}`}
                    >
                      <span className="block">Online lecture</span>
                      {captureMode === 'tab' && <span className="block text-[10px] opacity-80 font-normal leading-tight mt-0.5">Zoom / Teams / Panopto</span>}
                    </button>
                  </Tooltip>
                )}
              </div>
              {captureMode === 'tab' && (
                <p className="text-gray-600 dark:text-white/60 text-[12px] mt-2 text-center max-w-xs leading-relaxed">
                  Pick the tab playing audio, tick <span className="dark:text-white/80 text-gray-800 font-medium">Share tab audio</span>, and Demist listens in.
                </p>
              )}
              {captureMode === 'microphone' && <MicModeNotice />}
              {captureMode === 'microphone' && (
                <div className="w-full max-w-xs mt-3">
                  <ConsentUnlockBanner
                    key={consentVersion}
                    currentSubject={sessionSubject}
                    onOpenModal={() => { capture('consent_modal_opened', { subject: sessionSubject }); setShowConsentModal(true) }}
                    refreshKey={consentVersion}
                  />
                </div>
              )}
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
                      {stats.streak > 1 ? `Don't break your ${stats.streak}-day streak` : 'Review now — spaced repetition only works if you show up'}
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
                                <p className="text-[12px] text-gray-700">Could not generate summary.</p>
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
                    <p className="text-gray-700 text-[13px]">Hit record before your next lecture and Demist handles the rest.</p>
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
                      On Zoom or in an online lecture? Switch to <span className="dark:text-white/60 text-gray-800 font-medium">From tab</span> above to capture the audio directly from your browser.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          </div>
        )}
      </div>

      {/* Consent modal */}
      {showConsentModal && (
        <ConsentModal
          subject={sessionSubject}
          onClose={() => setShowConsentModal(false)}
          onGranted={() => { setShowConsentModal(false); setConsentVersion(v => v + 1) }}
        />
      )}

      {/* Mic check overlay (with acknowledgment gate on first use per subject) */}
      {showMicCheck && (
        <MicCheck
          subject={sessionSubject}
          initialAcknowledged={micCheckAcknowledged}
          onStart={() => { setShowMicCheck(false); startRecording('microphone') }}
          onCancel={() => setShowMicCheck(false)}
        />
      )}

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

      {/* iOS "Add to Home Screen" prompt */}
      {showAddToHomeScreen && (
        <div className="fixed inset-x-4 bottom-20 sm:bottom-6 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 sm:max-w-sm z-50 dark:bg-[#13120e] bg-[#FDFCF9] border dark:border-amber-500/20 border-amber-300/70 rounded-2xl px-4 py-3.5 shadow-lg flex items-start gap-3">
          <div className="flex-1 text-[13px] dark:text-white/80 text-gray-800 leading-relaxed">
            For the best experience, add Demist to your home screen. Tap <span className="font-semibold">Share</span> → <span className="font-semibold">Add to Home Screen</span>.
          </div>
          <button
            onClick={() => setShowAddToHomeScreen(false)}
            aria-label="Dismiss"
            className="dark:text-white/30 text-gray-400 dark:hover:text-white/60 hover:text-gray-600 transition-colors text-[18px] leading-none shrink-0"
          >
            ×
          </button>
        </div>
      )}
    </main>
  )
}

function TermCard({
  term,
  definition,
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

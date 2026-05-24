'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

interface LiveTerm {
  id: string
  term: string
  definition: string
  dismissing: boolean
  dbId?: string
}

interface RecentSession {
  id: string
  started_at: string
  ended_at: string | null
  termCount: number
  sessionNumber: number
}

interface ChartDay {
  label: string
  count: number
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

// ─── SM-2 helpers ─────────────────────────────────────────────────────────────

function calculateStreak(timestamps: string[]): number {
  if (!timestamps.length) return 0
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = new Set(timestamps.map(t => { const d = new Date(t); d.setHours(0,0,0,0); return d.getTime() }))
  let streak = 0; let cur = today.getTime()
  while (days.has(cur)) { streak++; cur -= 86400000 }
  return streak
}

function get7DayChart(timestamps: string[]): ChartDay[] {
  const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0,0,0,0)
    const next = new Date(d.getTime() + 86400000)
    const count = timestamps.filter(t => {
      const ts = new Date(t).getTime()
      return ts >= d.getTime() && ts < next.getTime()
    }).length
    return { label: DAY_LABELS[d.getDay()], count }
  })
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

// Filter out non-English terms (catches Japanese, Chinese, Arabic, etc.)
function isLatinTerm(term: string): boolean {
  return /^[\x20-\x7EÀ-ɏͰ-Ͽ\s'-]+$/.test(term)
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [liveTerms, setLiveTerms] = useState<LiveTerm[]>([])
  const [sessionGlossary, setSessionGlossary] = useState<{ term: string; definition: string }[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState<Stats>({ streak: 0, termsThisWeek: 0, dueFlashcards: 0 })
  const [chartData, setChartData] = useState<ChartDay[]>([])
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])

  const profileRef = useRef<Profile | null>(null)
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
  const lastPopupAtRef = useRef<number>(0)

  // Audio visualizer refs
  const ring1Ref = useRef<HTMLSpanElement | null>(null)
  const ring2Ref = useRef<HTMLSpanElement | null>(null)
  const ring3Ref = useRef<HTMLSpanElement | null>(null)
  const barsRef = useRef<HTMLDivElement | null>(null)
  const btnRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isRecording || !streamRef.current) return
    const stream = streamRef.current
    let raf: number; let ctx: AudioContext
    ;(async () => {
      ctx = new AudioContext(); await ctx.resume()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.78
      ctx.createMediaStreamSource(stream).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      const usable = Math.floor(analyser.frequencyBinCount * 0.55)
      const BAR_COUNT = 28
      const tick = () => {
        analyser.getByteFrequencyData(data)
        let sum = 0; for (let i = 0; i < usable; i++) sum += data[i]
        const level = (sum / usable) / 255
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
    })()
    return () => {
      cancelAnimationFrame(raf); ctx?.close()
      if (btnRef.current) btnRef.current.style.boxShadow = ''
      if (barsRef.current) Array.from(barsRef.current.children).forEach(b => { (b as HTMLElement).style.height = '4px' })
    }
  }, [isRecording])

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      userIdRef.current = user.id
      posthog.identify(user.id); posthog.capture('dashboard_viewed')

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
        supabase.from('profiles').select('course, year_of_study').eq('id', user.id).single(),
        supabase.from('terms').select('term, known, created_at').eq('user_id', user.id),
        supabase.from('sessions').select('started_at').eq('user_id', user.id).order('started_at', { ascending: false }),
        supabase.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('known', false).gt('sm2_review_count', 0).lte('sm2_due_at', now.toISOString()),
        supabase.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('known', false).eq('sm2_review_count', 0),
        supabase.from('sessions').select('id, started_at, ended_at').eq('user_id', user.id).order('started_at', { ascending: false }).limit(5),
        supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ])
      totalSessionCountRef.current = totalCount ?? 0

      profileRef.current = prof as Profile
      setProfile(prof as Profile)

      // Build known + frequency maps for smart filtering
      const known = new Set<string>()
      const freq = new Map<string, number>()
      for (const t of allTerms ?? []) {
        const key = t.term.toLowerCase()
        if (t.known) known.add(key)
        freq.set(key, (freq.get(key) ?? 0) + 1)
      }
      knownTermsRef.current = known
      termFrequencyRef.current = freq

      // Stats
      const termsThisWeek = (allTerms ?? []).filter(t => t.created_at >= weekAgo).length
      const streak = calculateStreak((sessionDays ?? []).map(s => s.started_at))
      const dueFlashcards = (dueReviewCount ?? 0) + Math.min(15, newCardCount ?? 0)
      setStats({ streak, termsThisWeek, dueFlashcards })

      // 7-day chart
      const chart7 = get7DayChart((allTerms ?? []).filter(t => t.created_at >= weekAgo).map(t => t.created_at))
      setChartData(chart7)

      // Recent sessions with term counts
      if (sessionsRaw?.length) {
        const ids = sessionsRaw.map(s => s.id)
        const { data: termRows } = await supabase.from('terms').select('session_id').in('session_id', ids)
        const countMap: Record<string, number> = {}
        for (const r of termRows ?? []) countMap[r.session_id] = (countMap[r.session_id] ?? 0) + 1
        const tc = totalSessionCountRef.current
        setRecentSessions(sessionsRaw.map((s, i) => ({ id: s.id, started_at: s.started_at, ended_at: s.ended_at, termCount: countMap[s.id] ?? 0, sessionNumber: tc - i })))
      }

      setLoading(false)
    })()
  }, [])

  const processChunk = async (blob: Blob, sessionId: string) => {
    if (blob.size < 500) return
    const supabase = createClient()
    setIsProcessing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL!

      const txRes = await fetch(`${base}/functions/v1/transcribe`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
      })
      if (!txRes.ok) { console.error('transcribe error:', await txRes.text()); return }
      const tx = await txRes.json()
      if (!tx?.text?.trim()) return

      const dtRes = await fetch(`${base}/functions/v1/detect-terms`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: tx.text,
          subject: profileRef.current?.course ?? 'general',
          year: profileRef.current?.year_of_study ?? 1,
          known_terms: Array.from(knownTermsRef.current),
        }),
      })
      if (!dtRes.ok) { console.error('detect-terms error:', await dtRes.text()); return }
      const detected = await dtRes.json()
      if (!detected?.terms?.length) return

      // Smart filter: English-only, skip known, skip seen 3+ times
      const filtered = (detected.terms as { term: string; definition: string }[]).filter(t => {
        const key = t.term.toLowerCase()
        return isLatinTerm(t.term) &&
               !knownTermsRef.current.has(key) &&
               (termFrequencyRef.current.get(key) ?? 0) < 3
      })
      if (!filtered.length) return

      // Rate limit: at most 1 popup every 30 seconds
      const now = Date.now()
      const rateLimited = filtered.slice(0, now - lastPopupAtRef.current >= 30_000 ? 1 : 0)
      if (!rateLimited.length) return
      lastPopupAtRef.current = now

      const incoming: LiveTerm[] = rateLimited.map(t => ({
        id: `${Date.now()}-${Math.random()}`,
        term: t.term,
        definition: t.definition,
        dismissing: false,
      }))

      setLiveTerms(prev => [...prev, ...incoming].slice(-3))

      incoming.forEach(t => {
        window.postMessage({ source: 'demist', type: 'term', term: t.term, definition: t.definition }, '*')
      })

      incoming.forEach(({ id }) => {
        setTimeout(() => {
          setLiveTerms(prev => prev.map(t => t.id === id ? { ...t, dismissing: true } : t))
          setTimeout(() => setLiveTerms(prev => prev.filter(t => t.id !== id)), 380)
        }, 8000)
      })

      const { data: saved } = await supabase
        .from('terms')
        .insert(incoming.map(t => ({
          user_id: userIdRef.current,
          session_id: sessionId,
          term: t.term,
          definition: t.definition,
          subject: profileRef.current?.course,
        })))
        .select('id, term, definition')

      // Update frequency map
      for (const t of incoming) {
        const key = t.term.toLowerCase()
        termFrequencyRef.current.set(key, (termFrequencyRef.current.get(key) ?? 0) + 1)
      }

      // Attach DB ids to live terms so "I know this" can update them
      if (saved?.length) {
        const dbMap = Object.fromEntries(saved.map((s: { id: string; term: string }) => [s.term.toLowerCase(), s.id]))
        setLiveTerms(prev => prev.map(t => {
          const dbId = dbMap[t.term.toLowerCase()]
          return dbId ? { ...t, dbId } : t
        }))
        setSessionGlossary(prev => [...saved.map((s: { term: string; definition: string }) => ({ term: s.term, definition: s.definition })), ...prev])
      }
    } catch (e) {
      console.error('processChunk error:', e)
    } finally {
      setIsProcessing(false)
    }
  }

  const startRecording = async () => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      alert('Microphone access is needed to use Demist.')
      return
    }
    streamRef.current = stream
    sessionIdRef.current = null

    const supabase = createClient()
    const { data: session } = await supabase
      .from('sessions')
      .insert({ user_id: userIdRef.current, subject: profileRef.current?.course, year_of_study: profileRef.current?.year_of_study })
      .select('id').single()

    const sessionId = session?.id ?? null
    sessionIdRef.current = sessionId
    isActiveRef.current = true
    lastPopupAtRef.current = 0
    termFrequencyRef.current = new Map()
    setIsRecording(true); setElapsed(0); setLiveTerms([]); setSessionGlossary([])
    window.postMessage({ source: 'demist', type: 'recording-started' }, '*')
    timerRef.current = setInterval(() => setElapsed(t => t + 1), 1000)

    const doChunk = () => {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder
      const chunks: Blob[] = []
      recorder.ondataavailable = (e: BlobEvent) => { if (e.data.size > 0) chunks.push(e.data) }
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType })
        if (sessionId) processChunk(blob, sessionId)
        if (isActiveRef.current) doChunk()
      }
      recorder.start()
      chunkTimerRef.current = setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, 10_000)
    }
    doChunk()
    posthog.capture('recording_started', { subject: profileRef.current?.course })
  }

  const stopRecording = async () => {
    isActiveRef.current = false
    if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current)
    if (timerRef.current) clearInterval(timerRef.current)
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    streamRef.current?.getTracks().forEach(t => t.stop())
    const sid = sessionIdRef.current
    if (sid) {
      const supabase = createClient()
      await supabase.from('sessions').update({ ended_at: new Date().toISOString() }).eq('id', sid)
    }
    setIsRecording(false)
    window.postMessage({ source: 'demist', type: 'recording-stopped' }, '*')
    posthog.capture('recording_stopped', { duration_seconds: elapsed })

    // Refresh stats after session
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
    setChartData(get7DayChart((allTerms ?? []).filter(t => t.created_at >= weekAgo).map(t => t.created_at)))

    // Refresh recent sessions list
    const [{ data: sessionsRaw }, { count: newTotal }] = await Promise.all([
      supabase.from('sessions').select('id, started_at, ended_at')
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
      setRecentSessions(sessionsRaw.map((s: { id: string; started_at: string; ended_at: string | null }, i: number) => ({ id: s.id, started_at: s.started_at, ended_at: s.ended_at, termCount: countMap[s.id] ?? 0, sessionNumber: tc - i })))
    }

    // Generate synopsis — delayed 6s to let the last processChunk finish saving terms
    if (sid) {
      const capturedSid = sid
      const capturedSubject = profileRef.current?.course
      setTimeout(() => {
        const sb = createClient()
        sb.functions.invoke('summarize-session', {
          body: { session_id: capturedSid, subject: capturedSubject },
        }).catch(console.error)
      }, 6000)
    }
  }

  const dismissTerm = (id: string) => {
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

  if (loading) return (
    <main className="min-h-dvh bg-[#080810] text-white flex flex-col overflow-hidden nav-bottom-pad">
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Demist</span>
      </header>
      <div className="flex-1 flex flex-col overflow-y-auto animate-pulse">
        <div className="shrink-0 grid grid-cols-3 gap-3 px-4 sm:px-6 pt-5 pb-1">
          {[0,1,2].map(i => (
            <div key={i} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-3 py-3 flex flex-col gap-2.5">
              <div className="h-2 w-14 bg-white/[0.06] rounded-full" />
              <div className="h-7 w-10 bg-white/[0.08] rounded-md" />
            </div>
          ))}
        </div>
        <div className="shrink-0 flex flex-col items-center py-6 gap-3">
          <div className="w-[88px] h-[88px] rounded-full bg-white/[0.06]" />
          <div className="h-3 w-32 bg-white/[0.05] rounded-full" />
        </div>
        <div className="flex-1 px-4 sm:px-6 pb-4">
          <div className="h-2 w-28 bg-white/[0.05] rounded-full mb-3" />
          <div className="space-y-2">
            {[0,1,2].map(i => (
              <div key={i} className="flex items-center justify-between bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3">
                <div className="flex flex-col gap-2">
                  <div className="h-3.5 w-36 bg-white/[0.07] rounded-full" />
                  <div className="h-3 w-20 bg-white/[0.05] rounded-full" />
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <div className="h-4 w-6 bg-white/[0.07] rounded" />
                  <div className="h-2.5 w-8 bg-white/[0.05] rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )

  const maxChart = Math.max(...chartData.map(d => d.count), 1)

  return (
    <main className="min-h-dvh bg-[#080810] text-white flex flex-col overflow-hidden nav-bottom-pad">
      {/* Mobile-only header (desktop uses top nav from layout) */}
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05]">
        {isRecording ? (
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono text-[17px] tabular-nums">{fmtTime(elapsed)}</span>
            {isProcessing && <span className="text-gray-600 text-[12px]">processing</span>}
          </div>
        ) : (
          <Link href="/dashboard" className="font-semibold tracking-tight text-[15px] hover:text-violet-300 active:scale-95 transition-all duration-150 select-none">Demist</Link>
        )}
      </header>

      {/* Body */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        {isRecording ? (
          /* ── Recording mode ── */
          <>
            {/* Ambient glow */}
            <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center z-0">
              <div className="w-[700px] h-[700px] rounded-full bg-red-600/[0.05] blur-[120px]" />
            </div>

            {/* Visualizer zone */}
            <div className="flex-1 flex flex-col items-center justify-center relative z-10">
              {/* Desktop recording status (header is hidden on sm+) */}
              <div className="hidden sm:flex items-center gap-2 mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="font-mono text-[20px] tabular-nums">{fmtTime(elapsed)}</span>
                {isProcessing && <span className="text-gray-600 text-[13px]">processing</span>}
              </div>

              <div className="relative flex items-center justify-center mb-6">
                <span ref={ring1Ref} className="absolute w-[88px] h-[88px] rounded-full bg-red-500/[0.18]" style={{ willChange: 'transform' }} />
                <span ref={ring2Ref} className="absolute w-[88px] h-[88px] rounded-full bg-red-500/[0.11]" style={{ willChange: 'transform' }} />
                <span ref={ring3Ref} className="absolute w-[88px] h-[88px] rounded-full bg-red-500/[0.06]" style={{ willChange: 'transform' }} />
                <button
                  ref={btnRef}
                  onClick={stopRecording}
                  className="relative z-10 w-[88px] h-[88px] rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-colors duration-200 select-none"
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

            {/* Session glossary */}
            {sessionGlossary.length > 0 && (
              <div className="shrink-0 px-4 sm:px-6 pb-4 max-h-[32vh] overflow-y-auto">
                <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-3 sticky top-0 bg-[#080810]">
                  This Session
                </p>
                <div className="space-y-3">
                  {sessionGlossary.map((t, i) => (
                    <div key={i} className="flex gap-3">
                      <div className="w-[3px] h-[3px] rounded-full bg-red-500/60 mt-[9px] shrink-0" />
                      <div>
                        <span className="text-[14px] font-medium text-white/90">{t.term}</span>
                        <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{t.definition}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* ── Home mode ── */
          <>
            {/* Stats row */}
            <div className="shrink-0 grid grid-cols-3 gap-3 px-4 sm:px-6 pt-5 pb-1">
              <StatCard label="Streak" value={`${stats.streak}d`} />
              <StatCard label="This week" value={String(stats.termsThisWeek)} />
              <StatCard label="Flashcards due" value={String(stats.dueFlashcards)} accent={stats.dueFlashcards > 0} />
            </div>

            {/* 7-day chart */}
            {chartData.some(d => d.count > 0) && (
              <div className="shrink-0 px-4 sm:px-6 pt-4 pb-2">
                <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-3">7 days</p>
                <div className="flex items-end gap-1.5 h-[52px]">
                  {chartData.map((d, i) => {
                    const height = Math.max(3, Math.round((d.count / maxChart) * 44))
                    const isToday = i === chartData.length - 1
                    return (
                      <div key={i} className="flex flex-col items-center gap-1 flex-1">
                        <div
                          className={`w-full rounded-sm transition-all ${isToday ? 'bg-violet-500' : 'bg-white/[0.12]'}`}
                          style={{ height: `${height}px` }}
                        />
                        <span className={`text-[9px] ${isToday ? 'text-violet-400' : 'text-gray-700'}`}>{d.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Record button */}
            <div className="shrink-0 flex flex-col items-center py-6">
              <button
                ref={btnRef}
                onClick={startRecording}
                className="w-[88px] h-[88px] rounded-full bg-white/[0.07] border border-white/[0.11] hover:bg-white/[0.11] hover:border-violet-500/30 hover:shadow-[0_0_40px_rgba(139,92,246,0.18)] flex items-center justify-center transition-all duration-200 select-none"
              >
                <MicIcon />
              </button>
              <p className="text-gray-500 text-sm mt-3">
                {profile?.course ? `Ready for ${profile.course}` : 'Tap to start listening'}
              </p>
            </div>

            {/* Recent sessions */}
            <div className="flex-1 px-4 sm:px-6 pb-4 overflow-y-auto">
              {recentSessions.length > 0 ? (
                <>
                  <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-3">Recent Sessions</p>
                  <div className="space-y-2">
                    {recentSessions.map(s => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3"
                      >
                        <div>
                          <p className="text-[14px] font-medium text-white/90">
                            {sessionLabel(s.sessionNumber, s.started_at)}
                          </p>
                          <p className="text-[12px] text-gray-600 mt-0.5">{fmtRelative(s.started_at)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[14px] font-semibold text-violet-400">{s.termCount}</p>
                          <p className="text-[11px] text-gray-600">terms</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-center text-gray-700 text-sm py-8">
                  Start a session to build your glossary.
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Term card overlay */}
      <div
        className="term-overlay-bottom fixed inset-x-0 flex flex-col gap-3 items-center px-4 sm:px-5 z-50 pointer-events-none"
      >
        {liveTerms.map(t => (
          <TermCard
            key={t.id}
            {...t}
            onDismiss={() => dismissTerm(t.id)}
            onKnown={() => markKnown(t)}
          />
        ))}
      </div>
    </main>
  )
}

// ─── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-3 py-3 flex flex-col gap-1">
      <p className="text-[10px] text-gray-600 uppercase tracking-[0.12em]">{label}</p>
      <p className={`text-[22px] font-bold leading-none ${accent ? 'text-violet-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}

// ─── Term card ─────────────────────────────────────────────────────────────────

function TermCard({
  term,
  definition,
  dismissing,
  onDismiss,
  onKnown,
}: Omit<LiveTerm, 'id'> & { onDismiss: () => void; onKnown: () => void }) {
  return (
    <div className={`pointer-events-auto w-full max-w-[400px] ${dismissing ? 'animate-slide-down' : 'animate-slide-up'}`}>
      <div
        className="animate-gradient rounded-[22px] p-[1.5px]"
        style={{
          background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 35%, #a855f7 65%, #8b5cf6 100%)',
          backgroundSize: '300% 300%',
        }}
      >
        <div
          className="rounded-[20.5px] px-5 py-4"
          style={{ background: 'rgba(10, 9, 22, 0.96)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)' }} />
                <span className="text-[15px] font-semibold text-white truncate">{term}</span>
              </div>
              <p className="text-[13px] text-gray-300 leading-relaxed">{definition}</p>
            </div>
            <button
              onClick={onDismiss}
              aria-label="Dismiss"
              className="text-gray-600 hover:text-gray-300 transition-colors shrink-0 text-[20px] leading-none mt-[-2px]"
            >
              ×
            </button>
          </div>
          <button
            onClick={onKnown}
            className="mt-3 text-[12px] text-gray-600 hover:text-violet-400 transition-colors"
          >
            ✓ I already know this
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function MicIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-gray-200">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  )
}

function StopIcon() {
  return <div className="w-[22px] h-[22px] rounded-[5px] bg-white" />
}

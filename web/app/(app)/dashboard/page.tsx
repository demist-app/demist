'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'
import { SummaryViewer } from '../summary-viewer'

interface LiveTerm {
  id: string
  term: string
  definition: string
  dismissing: boolean
  dbId?: string
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

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [liveTerms, setLiveTerms] = useState<LiveTerm[]>([])
  const [sessionGlossary, setSessionGlossary] = useState<{ term: string; definition: string }[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState<Stats>({ streak: 0, termsThisWeek: 0, dueFlashcards: 0 })
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])
  const [sessionGenIds, setSessionGenIds] = useState<Set<string>>(new Set())
  const [sessionFailIds, setSessionFailIds] = useState<Set<string>>(new Set())
  const [sessionTermLoading, setSessionTermLoading] = useState<string | null>(null)

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
  const sessionSummarizingRef = useRef(new Set<string>())
  const transcriptRef = useRef<string>('')
  const startRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const stopRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve())

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
    const handler = (e: MessageEvent) => {
      if (e.source !== window || (e.data as Record<string, unknown>)?.source !== 'demist-ext') return
      const cmd = (e.data as Record<string, unknown>).command
      if (cmd === 'start-recording' && !isActiveRef.current) startRecordingRef.current()
      else if (cmd === 'stop-recording' && isActiveRef.current) stopRecordingRef.current()
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

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
        supabase.from('profiles').select('course, year_of_study').eq('id', user.id).maybeSingle(),
        supabase.from('terms').select('term, known, created_at').eq('user_id', user.id),
        supabase.from('sessions').select('started_at').eq('user_id', user.id).order('started_at', { ascending: false }),
        supabase.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('known', false).gt('sm2_review_count', 0).lte('sm2_due_at', now.toISOString()),
        supabase.from('terms').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('known', false).eq('sm2_review_count', 0),
        supabase.from('sessions').select('id, name, started_at, ended_at, synopsis, transcript').eq('user_id', user.id).order('started_at', { ascending: false }).limit(5),
        supabase.from('sessions').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      ])
      totalSessionCountRef.current = totalCount ?? 0

      profileRef.current = prof as Profile
      setProfile(prof as Profile)

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
        setRecentSessions(sessionsRaw.map((s, i) => ({ id: s.id, name: (s as { name?: string | null }).name ?? null, started_at: s.started_at, ended_at: s.ended_at, termCount: countMap[s.id] ?? 0, sessionNumber: tc - i, synopsis: (s as { synopsis?: string | null }).synopsis ?? null, transcript: (s as { transcript?: string | null }).transcript ?? null, expanded: false })))
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
      if (!token) { console.error('processChunk: no auth token'); return }
      const base = process.env.NEXT_PUBLIC_SUPABASE_URL!

      const txRes = await fetch(`${base}/functions/v1/transcribe`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
      })
      if (!txRes.ok) { console.error('transcribe error:', await txRes.text()); return }
      const tx = await txRes.json()
      if (!tx?.text?.trim()) return
      transcriptRef.current = transcriptRef.current ? transcriptRef.current + ' ' + tx.text.trim() : tx.text.trim()

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

      const filtered = (detected.terms as { term: string; definition: string }[]).filter(t => {
        const key = t.term.toLowerCase()
        return isLatinTerm(t.term) &&
               !knownTermsRef.current.has(key) &&
               (termFrequencyRef.current.get(key) ?? 0) < 3
      })
      if (!filtered.length) return

      const { data: saved } = await supabase
        .from('terms')
        .insert(filtered.map(t => ({
          user_id: userIdRef.current,
          session_id: sessionId,
          term: t.term,
          definition: t.definition,
          subject: profileRef.current?.course,
        })))
        .select('id, term, definition')

      for (const t of filtered) {
        const key = t.term.toLowerCase()
        termFrequencyRef.current.set(key, (termFrequencyRef.current.get(key) ?? 0) + 1)
      }

      if (saved?.length) {
        setSessionGlossary(prev => [...saved.map((s: { term: string; definition: string }) => ({ term: s.term, definition: s.definition })), ...prev])
      }

      for (const t of filtered) {
        window.postMessage({ source: 'demist', type: 'term', term: t.term, definition: t.definition }, '*')
      }

      const now = Date.now()
      const toShow = filtered.slice(0, now - lastPopupAtRef.current >= 30_000 ? 1 : 0)
      if (!toShow.length) return
      lastPopupAtRef.current = now

      const incoming: LiveTerm[] = toShow.map(t => ({
        id: `${Date.now()}-${Math.random()}`,
        term: t.term,
        definition: t.definition,
        dismissing: false,
      }))

      setLiveTerms(prev => [...prev, ...incoming].slice(-3))

      incoming.forEach(({ id }) => {
        setTimeout(() => {
          setLiveTerms(prev => prev.map(t => t.id === id ? { ...t, dismissing: true } : t))
          setTimeout(() => setLiveTerms(prev => prev.filter(t => t.id !== id)), 380)
        }, 8000)
      })

      if (saved?.length) {
        const dbMap = Object.fromEntries(saved.map((s: { id: string; term: string }) => [s.term.toLowerCase(), s.id]))
        setLiveTerms(prev => prev.map(t => {
          const dbId = dbMap[t.term.toLowerCase()]
          return dbId ? { ...t, dbId } : t
        }))
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
    const { data: session, error: sessionErr } = await supabase
      .from('sessions')
      .insert({ user_id: userIdRef.current, subject: profileRef.current?.course, year_of_study: profileRef.current?.year_of_study })
      .select('id').single()

    if (sessionErr || !session) {
      streamRef.current?.getTracks().forEach(t => t.stop())
      alert('Could not start session. Check your connection and try again.')
      return
    }
    const sessionId = session.id
    sessionIdRef.current = sessionId
    isActiveRef.current = true
    lastPopupAtRef.current = 0
    termFrequencyRef.current = new Map()
    transcriptRef.current = ''
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
      supabase.from('sessions').select('id, name, started_at, ended_at, synopsis, transcript')
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
      setRecentSessions(sessionsRaw.map((s: { id: string; name?: string | null; started_at: string; ended_at: string | null; synopsis?: string | null; transcript?: string | null }, i: number) => ({ id: s.id, name: s.name ?? null, started_at: s.started_at, ended_at: s.ended_at, termCount: countMap[s.id] ?? 0, sessionNumber: tc - i, synopsis: s.synopsis ?? null, transcript: s.transcript ?? null, expanded: false })))
    }

    if (sid) {
      const capturedSid = sid
      const capturedSubject = profileRef.current?.course
      const capturedGlossary = [...sessionGlossary]
      setTimeout(async () => {
        try {
          const sb = createClient()
          const tx = transcriptRef.current
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
        }
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
    <main className="min-h-dvh bg-[#080810] text-white flex flex-col overflow-hidden nav-bottom-pad">
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05]">
        <span className="font-bold tracking-tight text-[15px]">Demist</span>
      </header>
      <div className="flex-1 flex flex-col overflow-y-auto animate-pulse">
        <div className="shrink-0 flex flex-col items-center pt-12 pb-8 px-6 gap-3">
          <div className="w-[96px] h-[96px] rounded-full bg-white/[0.06]" />
          <div className="h-4 w-32 bg-white/[0.04] rounded-full" />
          <div className="h-3 w-48 bg-white/[0.03] rounded-full" />
        </div>
        <div className="shrink-0 grid grid-cols-2 gap-3 px-4 sm:px-6 pb-5">
          {[0,1].map(i => (
            <div key={i} className="bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-4">
              <div className="h-2 w-12 bg-white/[0.06] rounded-full mb-3" />
              <div className="h-7 w-14 bg-white/[0.08] rounded-md" />
            </div>
          ))}
        </div>
        <div className="flex-1 px-4 sm:px-6 pb-4">
          <div className="h-2 w-28 bg-white/[0.05] rounded-full mb-3" />
          <div className="space-y-2">
            {[0,1,2].map(i => (
              <div key={i} className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-2xl px-4 py-3.5">
                <div className="flex-1 flex flex-col gap-2">
                  <div className="h-3.5 w-36 bg-white/[0.07] rounded-full" />
                  <div className="h-3 w-20 bg-white/[0.05] rounded-full" />
                </div>
                <div className="h-5 w-12 bg-white/[0.05] rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )

  return (
    <main className="min-h-dvh bg-[#080810] text-white flex flex-col overflow-hidden nav-bottom-pad">
      {/* Ambient blobs */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div
          className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full bg-violet-700/[0.06] blur-[120px]"
          style={{ animation: 'blob-drift 22s ease-in-out infinite' }}
        />
        <div
          className="absolute -bottom-24 -right-24 w-[380px] h-[380px] rounded-full bg-indigo-800/[0.05] blur-[100px]"
          style={{ animation: 'blob-drift 28s ease-in-out infinite reverse' }}
        />
      </div>

      {/* Mobile header */}
      <header className="sm:hidden shrink-0 flex items-center px-6 h-14 border-b border-white/[0.05] relative z-20">
        {isRecording ? (
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono text-[17px] tabular-nums">{fmtTime(elapsed)}</span>
            {isProcessing && <span className="text-gray-600 text-[12px] ml-1">processing</span>}
          </div>
        ) : (
          <Link href="/dashboard" className="font-bold tracking-tight text-[15px] hover:text-violet-300 active:scale-[0.97] transition-all duration-150 select-none">Demist</Link>
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

            {/* Visualizer */}
            <div className="flex-1 flex flex-col items-center justify-center relative z-10">
              <div className="hidden sm:flex items-center gap-2 mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="font-mono text-[20px] tabular-nums">{fmtTime(elapsed)}</span>
                {isProcessing && <span className="text-gray-600 text-[13px] ml-1">processing</span>}
              </div>

              <div className="relative flex items-center justify-center mb-6">
                <span ref={ring1Ref} className="absolute w-[88px] h-[88px] rounded-full bg-red-500/[0.18]" style={{ willChange: 'transform' }} />
                <span ref={ring2Ref} className="absolute w-[88px] h-[88px] rounded-full bg-red-500/[0.11]" style={{ willChange: 'transform' }} />
                <span ref={ring3Ref} className="absolute w-[88px] h-[88px] rounded-full bg-red-500/[0.06]" style={{ willChange: 'transform' }} />
                <button
                  ref={btnRef}
                  onClick={stopRecording}
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

            {sessionGlossary.length > 0 && (
              <div className="shrink-0 px-4 sm:px-6 pb-4 max-h-[32vh] overflow-y-auto">
                <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-3 sticky top-0 bg-[#080810]">
                  This Session
                </p>
                <div className="space-y-2">
                  {sessionGlossary.map((t, i) => (
                    <div key={i} className="flex gap-3 bg-red-500/[0.04] border border-red-500/[0.12] rounded-xl px-3 py-2.5">
                      <div className="min-w-0">
                        <span className="text-[13px] font-semibold text-white/90">{t.term}</span>
                        <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{t.definition}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Home mode */
          <div className="flex-1 flex flex-col overflow-y-auto">

            {/* Mic hero */}
            <div className="shrink-0 flex flex-col items-center pt-12 pb-8 px-6">
              <div className="relative flex items-center justify-center mb-5">
                <span className="absolute w-[130px] h-[130px] rounded-full bg-violet-600/[0.08]" style={{ animation: 'glow-float 4s ease-in-out infinite' }} />
                <span className="absolute w-[162px] h-[162px] rounded-full bg-violet-600/[0.05]" style={{ animation: 'glow-float 4s ease-in-out -1.3s infinite' }} />
                <span className="absolute w-[194px] h-[194px] rounded-full bg-violet-600/[0.025]" style={{ animation: 'glow-float 4s ease-in-out -2.7s infinite' }} />
                <button
                  ref={btnRef}
                  onClick={startRecording}
                  className="relative z-10 w-[96px] h-[96px] rounded-full bg-white/[0.07] border border-violet-500/30 hover:bg-violet-600/20 hover:border-violet-500/50 hover:shadow-[0_0_56px_rgba(139,92,246,0.3)] active:scale-[0.97] flex items-center justify-center transition-transform,background-color,border-color,box-shadow duration-200 select-none"
                >
                  <MicIcon />
                </button>
              </div>
              <p className="text-white/90 font-semibold text-[17px]">
                {profile?.course ? `Ready for ${profile.course}` : 'Start recording'}
              </p>
              <p className="text-gray-600 text-[13px] mt-1.5">Tap the mic before your next lecture</p>
            </div>

            {/* Stats */}
            <div className="shrink-0 grid grid-cols-2 gap-3 px-4 sm:px-6 pb-5">
              {stats.dueFlashcards > 0 && (
                <Link
                  href="/flashcards"
                  className="col-span-2 flex items-center justify-between bg-amber-500/[0.07] border border-amber-500/20 rounded-2xl px-4 py-3.5 hover:bg-amber-500/[0.11] transition-all group"
                >
                  <div>
                    <p className="text-[14px] font-semibold text-amber-300">{stats.dueFlashcards} flashcards due</p>
                    <p className="text-[12px] text-amber-400/50 mt-0.5">Review now to stay on track</p>
                  </div>
                  <span className="text-amber-400/60 group-hover:text-amber-300 transition-colors text-[20px] leading-none">›</span>
                </Link>
              )}
              <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl px-4 py-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                  <p className="text-[11px] text-gray-600 uppercase tracking-[0.12em]">Streak</p>
                </div>
                <p className="text-[28px] font-bold leading-none text-amber-400">
                  {stats.streak}<span className="text-[14px] font-normal text-gray-600 ml-1">days</span>
                </p>
              </div>
              <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl px-4 py-4">
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-500" />
                  <p className="text-[11px] text-gray-600 uppercase tracking-[0.12em]">This week</p>
                </div>
                <p className="text-[28px] font-bold leading-none text-violet-400">
                  {stats.termsThisWeek}<span className="text-[14px] font-normal text-gray-600 ml-1">terms</span>
                </p>
              </div>
            </div>

            {/* Recent sessions */}
            <div className="flex-1 px-4 sm:px-6 pb-4">
              {recentSessions.length > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[11px] font-bold tracking-[0.18em] text-gray-600 uppercase">Recent Sessions</p>
                    <Link href="/history" className="text-[12px] text-violet-500/70 hover:text-violet-400 transition-colors">See all</Link>
                  </div>
                  <div className="space-y-2">
                    {recentSessions.map(s => (
                      <div key={s.id} className="bg-white/[0.03] border border-white/[0.07] rounded-2xl overflow-hidden hover:bg-violet-500/[0.04] hover:border-violet-500/[0.15] transition-colors duration-200">
                        <div
                          onClick={() => s.termCount > 0 && toggleExpandSession(s.id)}
                          className={`flex items-center gap-3 px-4 py-3.5 ${s.termCount > 0 ? 'cursor-pointer' : ''}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className={`text-[14px] font-semibold truncate ${s.name ? 'text-white/90' : 'text-gray-400'}`}>
                              {s.name || sessionLabel(s.sessionNumber, s.started_at)}
                            </p>
                            <p className="text-[12px] text-gray-600 mt-0.5">{fmtRelative(s.started_at)}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {s.termCount > 0 && (
                              <span className="bg-violet-500/10 border border-violet-500/20 rounded-full px-2.5 py-0.5 text-[12px] font-semibold text-violet-400 tabular-nums">
                                {s.termCount}
                              </span>
                            )}
                            {s.termCount > 0 && <DashChevron expanded={s.expanded} />}
                          </div>
                        </div>

                        {s.expanded && (
                          <div className="px-4 pb-4 border-t border-white/[0.04]">
                            {s.synopsis ? (
                              <div className="pt-3">
                                <SummaryViewer synopsis={s.synopsis} sessionId={s.id} subject={profile?.course ?? null} year={profile?.year_of_study ?? null} />
                              </div>
                            ) : sessionGenIds.has(s.id) ? (
                              <p className="text-[12px] text-gray-700 pt-3">Generating summary...</p>
                            ) : sessionFailIds.has(s.id) ? (
                              <div className="flex items-center gap-3 pt-3">
                                <p className="text-[12px] text-gray-700">Could not generate summary.</p>
                                <button onClick={() => retrySessionSummarize(s)} className="text-[12px] text-violet-500 hover:text-violet-400 transition-colors shrink-0">Retry</button>
                              </div>
                            ) : null}

                            {sessionTermLoading === s.id && (
                              <p className="text-gray-700 text-[13px] pt-3">Loading...</p>
                            )}
                            {s.terms && s.terms.length > 0 && (
                              <div className="pt-3">
                                <p className="text-[10px] font-bold tracking-[0.15em] text-gray-600 uppercase mb-2">Terms</p>
                                <div className="space-y-1.5">
                                  {s.terms.slice(0, 3).map(t => (
                                    <p key={t.id} className="text-[13px] text-gray-500 leading-snug">
                                      <span className="text-white/70 font-medium">{t.term}</span>
                                      {' '}- {t.definition}
                                    </p>
                                  ))}
                                </div>
                                {s.terms.length > 3 && (
                                  <Link href={`/history?session=${s.id}`} className="inline-block mt-2 text-[12px] text-violet-500 hover:text-violet-400 transition-colors">
                                    +{s.terms.length - 3} more in History
                                  </Link>
                                )}
                              </div>
                            )}
                            {s.terms && s.terms.length === 0 && (
                              <p className="text-gray-700 text-[13px] pt-3">No terms detected.</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <div className="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-1">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-gray-700">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                  </div>
                  <p className="text-gray-600 text-[14px] font-medium">No sessions yet</p>
                  <p className="text-gray-700 text-[13px]">Tap the mic above before your next lecture.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Term overlay */}
      <div className="term-overlay-bottom fixed inset-x-0 flex flex-col gap-3 items-center px-4 sm:px-5 z-50 pointer-events-none">
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
            I already know this
          </button>
        </div>
      </div>
    </div>
  )
}

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

function DashChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      className={`text-gray-600 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

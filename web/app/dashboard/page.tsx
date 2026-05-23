'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import posthog from 'posthog-js'

interface LiveTerm {
  id: string
  term: string
  definition: string
  dismissing: boolean
}

interface StoredTerm {
  id: string
  term: string
  definition: string
  created_at: string
  subject: string | null
}

interface Profile {
  course: string | null
  year_of_study: number | null
}

export default function Dashboard() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [isRecording, setIsRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [liveTerms, setLiveTerms] = useState<LiveTerm[]>([])
  const [glossary, setGlossary] = useState<StoredTerm[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)

  // Refs for values needed inside async/recursive callbacks
  const profileRef = useRef<Profile | null>(null)
  const userIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const isActiveRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/login'); return }

      userIdRef.current = user.id
      posthog.identify(user.id)
      posthog.capture('dashboard_viewed')

      const [{ data: prof }, { data: terms }] = await Promise.all([
        supabase.from('profiles').select('course, year_of_study').eq('id', user.id).single(),
        supabase
          .from('terms')
          .select('id, term, definition, created_at, subject')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(30),
      ])

      profileRef.current = prof as Profile
      setProfile(prof as Profile)
      setGlossary((terms ?? []) as StoredTerm[])
      setLoading(false)
    })()
  }, [])

  const processChunk = async (blob: Blob, sessionId: string) => {
    if (blob.size < 2000) return
    const supabase = createClient()

    try {
      const { data: tx, error: txErr } = await supabase.functions.invoke('transcribe', {
        body: blob,
        headers: { 'Content-Type': blob.type || 'audio/webm' },
      })
      if (txErr || !tx?.text?.trim()) return

      const { data: detected, error: dtErr } = await supabase.functions.invoke('detect-terms', {
        body: {
          transcript: tx.text,
          subject: profileRef.current?.course ?? 'general',
          year: profileRef.current?.year_of_study ?? 1,
        },
      })
      if (dtErr || !detected?.terms?.length) return

      const incoming: LiveTerm[] = (detected.terms as { term: string; definition: string }[]).map(t => ({
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

      const { data: saved } = await supabase
        .from('terms')
        .insert(
          incoming.map(t => ({
            user_id: userIdRef.current,
            session_id: sessionId,
            term: t.term,
            definition: t.definition,
            subject: profileRef.current?.course,
          }))
        )
        .select('id, term, definition, created_at, subject')

      if (saved?.length) {
        setGlossary(prev => [...(saved as StoredTerm[]).reverse(), ...prev].slice(0, 30))
      }
    } catch {
      // Silent — never interrupt recording for a processing error
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
    sessionIdRef.current = null  // clear previous session ref

    const supabase = createClient()
    const { data: session } = await supabase
      .from('sessions')
      .insert({
        user_id: userIdRef.current,
        subject: profileRef.current?.course,
        year_of_study: profileRef.current?.year_of_study,
      })
      .select('id')
      .single()

    const sessionId = session?.id ?? null
    sessionIdRef.current = sessionId

    isActiveRef.current = true
    setIsRecording(true)
    setElapsed(0)
    setLiveTerms([])

    timerRef.current = setInterval(() => setElapsed(t => t + 1), 1000)

    const doChunk = () => {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4'

      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder
      const chunks: Blob[] = []

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType })
        if (sessionId) processChunk(blob, sessionId)
        if (isActiveRef.current) doChunk()
      }

      recorder.start()
      chunkTimerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop()
      }, 15_000)
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
    posthog.capture('recording_stopped', { duration_seconds: elapsed })
  }

  const dismissTerm = (id: string) => {
    setLiveTerms(prev => prev.map(t => t.id === id ? { ...t, dismissing: true } : t))
    setTimeout(() => setLiveTerms(prev => prev.filter(t => t.id !== id)), 380)
  }

  const fmtTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  if (loading) return <div className="min-h-screen bg-[#080810]" />

  return (
    <main className="min-h-screen bg-[#080810] text-white flex flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between px-6 h-14 border-b border-white/[0.05]">
        <span className="font-semibold tracking-tight text-[15px]">Demist</span>
        <button
          onClick={async () => { await createClient().auth.signOut(); router.replace('/login') }}
          className="text-[13px] text-gray-600 hover:text-gray-400 transition-colors"
        >
          Sign out
        </button>
      </header>

      {/* Recording zone */}
      <div className="flex-1 flex flex-col items-center justify-center relative">
        {/* Ambient glow when recording */}
        {isRecording && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <div className="w-[700px] h-[700px] rounded-full bg-red-600/[0.05] blur-[120px] animate-pulse" />
          </div>
        )}

        {/* Pulse rings + button */}
        <div className="relative flex items-center justify-center mb-5">
          {isRecording && (
            <>
              <span className="absolute w-[100px] h-[100px] rounded-full bg-red-500/20 animate-ring" />
              <span className="absolute w-[100px] h-[100px] rounded-full bg-red-500/[0.13] animate-ring [animation-delay:0.8s]" />
              <span className="absolute w-[100px] h-[100px] rounded-full bg-red-500/[0.07] animate-ring [animation-delay:1.6s]" />
            </>
          )}

          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`relative z-10 w-[88px] h-[88px] rounded-full flex items-center justify-center transition-all duration-300 select-none ${
              isRecording
                ? 'bg-red-600 hover:bg-red-500 shadow-[0_0_50px_rgba(239,68,68,0.4)]'
                : 'bg-white/[0.07] border border-white/[0.11] hover:bg-white/[0.11] hover:border-violet-500/30 hover:shadow-[0_0_40px_rgba(139,92,246,0.18)]'
            }`}
          >
            {isRecording ? <StopIcon /> : <MicIcon />}
          </button>
        </div>

        {/* Status label */}
        <div className="h-8 flex items-center justify-center">
          {isRecording ? (
            <div className="flex items-center gap-2.5">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono text-[18px] tabular-nums text-white">{fmtTime(elapsed)}</span>
              <span className="text-gray-500 text-sm">Listening</span>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">
              {profile?.course ? `Ready for ${profile.course}` : 'Tap to start listening'}
            </p>
          )}
        </div>
      </div>

      {/* Glossary */}
      <div className="shrink-0 px-6 pb-8 max-h-[260px] overflow-y-auto">
        {glossary.length > 0 ? (
          <>
            <p className="text-[10px] font-bold tracking-[0.18em] text-gray-600 uppercase mb-3 sticky top-0 bg-[#080810]">
              Your Glossary
            </p>
            <div className="space-y-3">
              {glossary.map(t => (
                <div key={t.id} className="flex gap-3 group">
                  <div className="w-[3px] h-[3px] rounded-full bg-violet-500/60 mt-[9px] shrink-0" />
                  <div>
                    <span className="text-[14px] font-medium text-white/90">{t.term}</span>
                    <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{t.definition}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-center text-gray-700 text-sm py-4">
            Start a session to build your glossary.
          </p>
        )}
      </div>

      {/* Siri-like term card overlay — fixed at bottom */}
      <div className="fixed bottom-6 inset-x-0 flex flex-col gap-3 items-center px-5 z-50 pointer-events-none">
        {liveTerms.map(t => (
          <TermCard key={t.id} {...t} onDismiss={() => dismissTerm(t.id)} />
        ))}
      </div>
    </main>
  )
}

// ─── Siri-style animated term card ────────────────────────────────────────────

function TermCard({
  term,
  definition,
  dismissing,
  onDismiss,
}: Omit<LiveTerm, 'id'> & { onDismiss: () => void }) {
  return (
    <div
      className={`pointer-events-auto w-full max-w-[400px] ${
        dismissing ? 'animate-slide-down' : 'animate-slide-up'
      }`}
    >
      {/* Gradient border wrapper */}
      <div
        className="animate-gradient rounded-[22px] p-[1.5px]"
        style={{
          background:
            'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 35%, #a855f7 65%, #8b5cf6 100%)',
          backgroundSize: '300% 300%',
        }}
      >
        {/* Card inner */}
        <div
          className="rounded-[20.5px] px-5 py-4"
          style={{
            background: 'rgba(10, 9, 22, 0.96)',
            backdropFilter: 'blur(28px)',
            WebkitBackdropFilter: 'blur(28px)',
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)' }}
                />
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
        </div>
      </div>
    </div>
  )
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function MicIcon() {
  return (
    <svg
      width="26" height="26" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round"
      className="text-gray-200"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  )
}

function StopIcon() {
  return (
    <div className="w-[22px] h-[22px] rounded-[5px] bg-white" />
  )
}

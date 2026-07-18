'use client'

// Owns the entire live-recording lifecycle (MediaRecorder, audio graph, the
// Whisper/term-detection/translation chunk loop, session DB writes) as a
// single provider mounted once at the (app) layout level, not inside the
// Dashboard page component.
//
// This used to all live inside Dashboard itself. That meant navigating to
// any other tab (Study, Glossary, History, ...) unmounted Dashboard, which
// unmounted this logic with it, including the beforeunload-handler effect,
// whose cleanup function calls stopRecordingRef.current() on ANY unmount,
// not just a real page close. So switching tabs mid-recording silently
// ended the session (confirmed by real testing). Mounting this at the
// layout level instead means it survives route navigation the same way
// NativeTranslateProvider already does.

import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { createClient } from '@/lib/supabase'
import { capture, identify } from '@/lib/analytics'
import { requestWakeLock, releaseWakeLock, reacquireWakeLockOnVisibility, wakeLockSupported } from '@/lib/wakeLock'
import { startTabCapture } from '@/lib/tabCapture'
import { checkRecordingLimit } from '@/lib/subscription'
import { useEntitlements } from '@/lib/entitlements'
import { useNativeTranslate } from '@/lib/useNativeTranslate'
import { extractCandidates } from '@/lib/extractTerms'
import { isElectronNative, getDemistNative } from '@/lib/electronNative'
import { startNativeSession, type NativeSessionHandle } from '@/lib/nativeSession'

export type CaptureMode = 'microphone' | 'tab'

export const LANGUAGE_NAMES: Record<string, string> = {
  zh: 'Mandarin',
  ar: 'Arabic',
  hi: 'Hindi',
  es: 'Spanish',
  fr: 'French',
}

export interface LiveTerm {
  id: string
  term: string
  definition: string
  translation?: string | null
  dismissing: boolean
  dbId?: string
  pinned?: boolean
}

export interface SessionTerm {
  id: string
  term: string
  definition: string
  known: boolean
}

export interface RecentSession {
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

export interface Profile {
  course: string | null
  year_of_study: number | null
  support_need: string | null
  translate_to: string | null
}

export interface Stats {
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

function isLatinTerm(term: string): boolean {
  return /^[\x20-\x7EÀ-ɏͰ-Ͽ\s'-]+$/.test(term)
}

interface RecordingSessionValue {
  loading: boolean
  isRecording: boolean
  elapsed: number
  liveTerms: LiveTerm[]
  setLiveTerms: React.Dispatch<React.SetStateAction<LiveTerm[]>>
  sessionGlossary: { term: string; definition: string; context?: string | null; translation?: string | null }[]
  profile: Profile | null
  stats: Stats
  recentSessions: RecentSession[]
  setRecentSessions: React.Dispatch<React.SetStateAction<RecentSession[]>>
  sessionGenIds: Set<string>
  sessionFailIds: Set<string>
  sessionFailReasons: Record<string, string>
  sessionTermLoading: string | null
  recordingError: string | null
  recordingWarning: string | null
  wakeLockUnsupported: boolean
  captureMode: CaptureMode
  setCaptureMode: (mode: CaptureMode) => void
  capturedTabTitle: string | null
  sentences: string[]
  translatedSentences: (string | null)[]
  liveSessionId: string | null
  reviewTerms: { term: string; definition: string; dbId?: string }[] | null
  setReviewTerms: React.Dispatch<React.SetStateAction<{ term: string; definition: string; dbId?: string }[] | null>>
  sessionSubject: string
  setSessionSubject: (s: string) => void
  sessionSubjectRef: React.RefObject<string>
  paywall: string | null
  setPaywall: (p: string | null) => void
  localTranslate: ReturnType<typeof useNativeTranslate>
  localTranslateUsable: () => boolean
  liveTranslateAvailable: boolean
  vizAnalyserRef: React.RefObject<AnalyserNode | null>
  chunkPeakRef: React.RefObject<number>
  startRecording: (mode?: CaptureMode) => Promise<void>
  stopRecording: () => Promise<void>
  dismissTerm: (id: string) => void
  pinTerm: (id: string) => void
  markKnown: (liveTerm: LiveTerm) => Promise<void>
  maybeGenerateOnDashboard: (s: RecentSession) => Promise<void>
  retrySessionSummarize: (s: RecentSession) => void
  toggleExpandSession: (id: string) => Promise<void>
}

const RecordingSessionContext = createContext<RecordingSessionValue | null>(null)

export function RecordingSessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [isRecording, setIsRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [liveTerms, setLiveTerms] = useState<LiveTerm[]>([])
  const [sessionGlossary, setSessionGlossary] = useState<{ term: string; definition: string; context?: string | null; translation?: string | null }[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState<Stats>({ streak: 0, termsThisWeek: 0, dueFlashcards: 0 })
  const [recentSessions, setRecentSessions] = useState<RecentSession[]>([])
  const [sessionGenIds, setSessionGenIds] = useState<Set<string>>(new Set())
  const [sessionFailIds, setSessionFailIds] = useState<Set<string>>(new Set())
  const [sessionFailReasons, setSessionFailReasons] = useState<Record<string, string>>({})
  const [sessionTermLoading, setSessionTermLoading] = useState<string | null>(null)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const [recordingWarning, setRecordingWarning] = useState<string | null>(null)
  const [wakeLockUnsupported, setWakeLockUnsupported] = useState(false)
  const [captureMode, setCaptureMode] = useState<CaptureMode>('microphone')
  const [capturedTabTitle, setCapturedTabTitle] = useState<string | null>(null)
  const [sentences, setSentences] = useState<string[]>([])
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null)
  const [reviewTerms, setReviewTerms] = useState<{ term: string; definition: string; dbId?: string }[] | null>(null)
  const [sessionSubject, setSessionSubject] = useState<string>('')
  const { limits } = useEntitlements()
  const [paywall, setPaywall] = useState<string | null>(null)
  const [translatedSentences, setTranslatedSentences] = useState<(string | null)[]>([])

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
  const sentTermsRef = useRef<Set<string>>(new Set())  // lowercased candidate terms already sent to detect-terms this session
  const termFrequencyRef = useRef<Map<string, number>>(new Map())
  const sessionSummarizingRef = useRef(new Set<string>())
  const transcriptRef = useRef<string>('')
  const chunkIndexRef = useRef(0)
  const startRecordingRef = useRef<(mode?: CaptureMode) => Promise<void>>(() => Promise.resolve())
  const stopRecordingRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const startingRef = useRef(false)
  const captureModeRef = useRef<CaptureMode>('microphone')
  const localTranslate = useNativeTranslate()
  // Only 'ready' counts as usable: everything else (unsupported browser,
  // still downloading Chrome's own model, or errored) falls back to cloud.
  // Each detect-terms call decides independently, so this naturally switches
  // from cloud to native the moment Chrome's model finishes downloading.
  const localTranslateUsable = () => localTranslate.status === 'ready'
  // Whether the live bilingual view has any on-device translation path at
  // all: Chrome's Translator API, or the desktop app's bundled model.
  const liveTranslateAvailable = localTranslate.supported || !!getDemistNative()
  const sentenceCountRef = useRef(0)

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
  const webLockReleaseRef = useRef<(() => void) | null>(null)
  const nativeSessionRef = useRef<NativeSessionHandle | null>(null)

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

  // Live transcript: subscribe to new chunks for the active session via Supabase Realtime
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

  // Stop Web Speech and the recording session cleanly if the user closes the
  // tab/app mid-recording. Mounted once here (not per-page), so this only
  // fires on a real app close, not on in-app route navigation.
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
        supabase.from('profiles').select('course, year_of_study, support_need, translate_to').eq('id', user.id).maybeSingle(),
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
      if ((prof as Profile)?.translate_to) localTranslate.start((prof as Profile).translate_to as string)

      // Warm the desktop app's on-device models as soon as the app opens,
      // not on first use mid-recording: this mounts once at the layout
      // level (see file header), so it fires well before anyone reaches
      // for the record button, not per-page-navigation. Fire-and-forget,
      // in the background; a session that starts before these resolve just
      // waits on the same in-flight load these calls kick off (see the
      // loadingPromise/translators-map guards in native/llm.js and
      // native/translate.js).
      const native = getDemistNative()
      if (native) {
        native.preloadWhisper().catch(() => {})
        native.preloadTermDetection().catch(() => {})
        if ((prof as Profile)?.translate_to) {
          native.preloadTranslation((prof as Profile).translate_to as string).catch(() => {})
        }
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
        const recentSubjectsArr = [...new Set(sessionsRaw.map((s: { subject?: string | null }) => s.subject).filter(Boolean))].slice(0, 6) as string[]
        if (!sessionSubjectRef.current) {
          const defaultSubject = recentSubjectsArr[0] || (prof as Profile)?.course || ''
          sessionSubjectRef.current = defaultSubject
          setSessionSubject(defaultSubject)
        }
      }

      if (!sessionsRaw?.length && !sessionSubjectRef.current) {
        const defaultSubject = (prof as Profile)?.course || ''
        sessionSubjectRef.current = defaultSubject
        setSessionSubject(defaultSubject)
      }

      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Shared: detect terms, save to DB, update UI ──────────────────────────────

  const runDetection = async (transcript: string, sessionId: string, token: string, context = '') => {
    const supabase = createClient()
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const native = getDemistNative()

    let terms: { term: string; definition: string; context?: string; translation?: string }[]

    if (native) {
      // Fully on-device: the raw transcript chunk goes straight to the local
      // model. No candidate pre-filtering (below) and no cloud call at all:
      // that filtering exists purely to minimize what leaves the device on
      // the cloud path, which doesn't apply here since nothing leaves it.
      terms = await native.detectTerms(
        transcript,
        context,
        sessionSubjectRef.current || profileRef.current?.course || null,
        profileRef.current?.year_of_study ?? null,
      )
    } else {
      // Client-side candidate extraction: only isolated terms + one sentence each
      // leave the device, never full transcript windows.
      const newSentences = transcript.split(/(?<=[.!?])\s+/).filter(s => s.trim())
      const candidates = newSentences.flatMap(s => extractCandidates(s, knownTermsRef.current, sentTermsRef.current))
      if (sentTermsRef.current.size > 500) {
        sentTermsRef.current = new Set(Array.from(sentTermsRef.current).slice(-500))
      }
      if (candidates.length === 0) return   // nothing new, skip the network call entirely

      // Cloud translation fallback: only ask the server to translate definitions
      // when on-device translation isn't usable (unsupported browser, still
      // downloading, or errored); otherwise the on-device model handles it, so
      // nothing extra leaves the device.
      const cloudTargetLangName = (profileRef.current?.translate_to && !localTranslateUsable())
        ? LANGUAGE_NAMES[profileRef.current.translate_to]
        : undefined

      const dtRes = await fetch(`${base}/functions/v1/detect-terms`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidates,
          context,
          subject: sessionSubjectRef.current || profileRef.current?.course || 'general',
          year: profileRef.current?.year_of_study ?? 1,
          known_terms: Array.from(knownTermsRef.current),
          target_lang_name: cloudTargetLangName,
        }),
      })
      if (!dtRes.ok) {
        if (dtRes.status === 429) {
          setRecordingWarning('Term detection rate limit reached for this hour. Recording and transcription continue normally.')
        } else if (dtRes.status === 401) {
          setRecordingError('Session expired. Sign in again to continue recording.')
          stopRecordingRef.current()
        }
        return
      }
      const detected = await dtRes.json()
      terms = detected?.terms ?? []
    }

    // Adaptive chunking: after 3 consecutive empty detections, slow the chunk
    // loop to 10s to halve API calls during silence. Reset to 5s on any hit.
    if (!terms.length) {
      zeroTermChunksRef.current++
      if (zeroTermChunksRef.current >= 3 && chunkIntervalRef.current !== 10_000) {
        chunkIntervalRef.current = 10_000
        console.log('[demist] 3 empty detections: chunk interval expanded to 10s')
      }
      return
    }
    if (chunkIntervalRef.current !== 5_000) {
      console.log('[demist] terms detected: chunk interval reset to 5s')
    }
    zeroTermChunksRef.current = 0
    chunkIntervalRef.current = 5_000

    const filtered = terms.filter(t => {
      const key = t.term.toLowerCase()
      return isLatinTerm(t.term) &&
             !knownTermsRef.current.has(key) &&
             (termFrequencyRef.current.get(key) ?? 0) < 3
    })
    if (!filtered.length) return

    for (const t of filtered) {
      termFrequencyRef.current.set(t.term.toLowerCase(), (termFrequencyRef.current.get(t.term.toLowerCase()) ?? 0) + 1)
      knownTermsRef.current.add(t.term.toLowerCase())
    }

    // Cards render immediately; translations patch in whenever they resolve.
    // Preference order: Chrome's on-device Translator, then the desktop
    // app's bundled model, then (browser/PWA only, never in the desktop
    // app) the translation detect-terms already did server-side.
    if (profileRef.current?.translate_to) {
      const targetLang = profileRef.current.translate_to
      for (const t of filtered) {
        const applyTranslation = (translated: string) => {
          if (!translated) return
          setSessionGlossary(prev => prev.map(g => (g.term === t.term && g.definition === t.definition) ? { ...g, translation: translated } : g))
          setLiveTerms(prev => prev.map(lt => lt.term === t.term ? { ...lt, translation: translated } : lt))
        }
        if (localTranslateUsable()) {
          localTranslate.translate(t.definition).then(applyTranslation)
        } else if (native) {
          native.translate(t.definition, targetLang).then(applyTranslation)
        } else if (t.translation) {
          applyTranslation(t.translation)
        }
      }
    }

    // Optimistic UI: show the card and glossary entry immediately, before the
    // DB insert round-trip. dbId arriving later confirms the save.
    setSessionGlossary(prev => [...filtered.map(t => ({ term: t.term, definition: t.definition, context: t.context ?? null, translation: null })), ...prev])
    const incoming: LiveTerm[] = filtered.slice(0, 1).map(t => ({
      id: `${Date.now()}-${Math.random()}`,
      term: t.term,
      definition: t.definition,
      translation: null,
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
        context: t.context ?? null,
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

  // Appends a sentence to the live transcript and, if the user has a translation
  // language set, kicks off an on-device translation for it (never sent anywhere).
  // Chrome's Translator first, then the desktop app's bundled model: both
  // on-device either way, never the cloud, matching definition translation.
  const translateSentenceAt = (idx: number, text: string) => {
    const native = getDemistNative()
    const translated = localTranslateUsable()
      ? localTranslate.translate(text)
      : native
      ? native.translate(text, profileRef.current!.translate_to!)
      : Promise.resolve('')
    translated.then(result => {
      setTranslatedSentences(prev => {
        if (idx >= prev.length) return prev
        const next = [...prev]
        next[idx] = result || ''
        return next
      })
    })
  }

  const appendSentence = (chunkText: string) => {
    const idx = sentenceCountRef.current++
    setSentences(prev => [...prev, chunkText])
    setTranslatedSentences(prev => [...prev, null])
    // Live sentence-by-sentence translation is on-device only: no cloud
    // fallback, since per-sentence cloud calls at this cadence would be slow
    // and costly. Term/glossary definitions still get the cloud fallback above.
    if (profileRef.current?.translate_to && (localTranslateUsable() || getDemistNative())) translateSentenceAt(idx, chunkText)
  }

  // Shared by both transcription paths: the cloud chunk loop (processChunk)
  // and the native on-device session (onTranscript in startRecording) each
  // hand a piece of transcript here. Appends to the live transcript/sentence
  // display and, every ~10s, fires a detect-terms pass. Kept synchronous up
  // to the point detection actually fires (the token fetch below is the only
  // async part) so that stopRecording's flush-on-stop check, which runs right
  // after the native session's stop() resolves, always sees this chunk's text
  // already in detectionBufferRef, not still pending on a promise.
  const accumulateAndMaybeDetect = (chunkText: string, sessionId: string) => {
    transcriptRef.current = transcriptRef.current ? transcriptRef.current + ' ' + chunkText : chunkText
    if (!speechModeRef.current || !webSpeechHasFiredRef.current) appendSentence(chunkText)

    // Accumulate text; only call detect-terms every ~10s to bound cost while
    // keeping the wait for a definition to appear reasonable.
    detectionBufferRef.current += (detectionBufferRef.current ? ' ' : '') + chunkText
    const msSinceDetection = Date.now() - lastDetectionTimeRef.current
    if ((msSinceDetection >= 10_000 || !isActiveRef.current) && detectionBufferRef.current.trim()) {
      const toDetect = detectionBufferRef.current
      const context = recentContextRef.current
      // Roll context forward: keep last ~60s worth (~300 chars) as future context
      recentContextRef.current = (context + ' ' + toDetect).trim().slice(-300)
      detectionBufferRef.current = ''
      lastDetectionTimeRef.current = Date.now()
      createClient().auth.getSession().then(({ data: { session } }) => {
        const token = session?.access_token
        if (token) runDetection(toDetect, sessionId, token, context)
      }).catch(() => {})
    }
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

      // Cloud transcription path only: native mic sessions never call
      // processChunk at all (see startRecording: the MediaRecorder loop
      // isn't started when isElectronNative() && mode === 'microphone').
      const txRes = await fetch(`${base}/functions/v1/transcribe?session_id=${encodeURIComponent(sessionId)}&chunk_index=${chunkIndex}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': blob.type || 'audio/webm' },
        body: blob,
      })
      if (!txRes.ok) {
        if (txRes.status === 429) {
          setRecordingWarning('Transcription rate limit reached. Recording continues but text won\'t display until the next hour.')
        } else if (txRes.status === 401) {
          setRecordingError('Session expired. Sign in again to continue recording.')
          stopRecordingRef.current()
        }
        return
      }
      const tx = await txRes.json()
      if (!tx?.text?.trim()) return
      accumulateAndMaybeDetect(tx.text.trim(), sessionId)
    } catch (e) {
      console.error('processChunk error:', e)
    }
  }

  // Audio processing pipeline: boost quiet audio and normalise volume.
  // Raw stream → gain(2.5×) → compressor → processedStream → MediaRecorder.
  // Pulled out of startRecording so recoverMicStream can rebuild the same
  // graph on a replacement stream without duplicating the wiring.
  const attachAudioGraph = (ctx: AudioContext, rawStream: MediaStream) => {
    const src = ctx.createMediaStreamSource(rawStream)
    const gain = ctx.createGain()
    gain.gain.value = 2.5
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -30
    compressor.knee.value = 20
    compressor.ratio.value = 4
    compressor.attack.value = 0.003
    compressor.release.value = 0.15
    const dest = ctx.createMediaStreamDestination()
    // Branch the analyser off src so the visualizer reads raw levels without
    // a second MediaStreamAudioSourceNode (Chrome only allows one per stream per context).
    const vizAnalyser = ctx.createAnalyser()
    vizAnalyser.fftSize = 512; vizAnalyser.smoothingTimeConstant = 0.78
    src.connect(vizAnalyser)
    vizAnalyserRef.current = vizAnalyser
    src.connect(gain)
    gain.connect(compressor)
    compressor.connect(dest)
    processedStreamRef.current = dest.stream
  }

  // Chrome has been observed (mic-mode, desktop) silently ending the
  // getUserMedia track on some background-tab transitions, not something
  // any of our timer/lock mitigations touch, since those only protect
  // against throttling, not the browser revoking the track outright. Rather
  // than let recording go dead with no signal, listen for the track ending
  // and try to reacquire the same (or default) microphone and rebuild the
  // audio graph in place, keeping the session/transcript intact.
  const recoverMicStream = async () => {
    if (!isActiveRef.current || captureModeRef.current !== 'microphone') return
    setRecordingWarning('Microphone disconnected, reconnecting…')
    const baseAudioConstraints = { echoCancellation: false, noiseSuppression: true, autoGainControl: true }
    const preferredMicId = localStorage.getItem('demist_mic_device_id') || undefined
    try {
      let newStream: MediaStream
      try {
        newStream = await navigator.mediaDevices.getUserMedia({
          audio: preferredMicId ? { ...baseAudioConstraints, deviceId: { exact: preferredMicId } } : baseAudioConstraints,
          video: false,
        })
      } catch {
        newStream = await navigator.mediaDevices.getUserMedia({ audio: baseAudioConstraints, video: false })
      }
      if (!isActiveRef.current) { newStream.getTracks().forEach(t => t.stop()); return }
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = newStream
      newStream.getAudioTracks().forEach(track => track.addEventListener('ended', recoverMicStream, { once: true }))
      if (audioProcessingCtxRef.current) attachAudioGraph(audioProcessingCtxRef.current, newStream)
      setRecordingWarning(null)
    } catch (e) {
      console.error('recoverMicStream failed:', e)
      setRecordingWarning('Microphone disconnected and could not be reconnected. Please start a new session.')
      stopRecordingRef.current()
    }
  }

  const startRecording = async (mode: CaptureMode = 'microphone') => {
    if (isActiveRef.current || startingRef.current) return
    startingRef.current = true
    captureModeRef.current = mode
    setCapturedTabTitle(null)

    // Fire-and-forget, still within the click gesture: if the on-device
    // translation model hasn't been downloaded on this device yet, this is
    // the one guaranteed real user gesture every session goes through, so
    // it's the right place to let Chrome ask for it (see useNativeTranslate).
    if (profileRef.current?.translate_to) localTranslate.start(profileRef.current.translate_to)

    // Paywall gate: no-op while PAYWALL_ENABLED is false
    if (userIdRef.current) {
      const gate = await checkRecordingLimit(createClient(), userIdRef.current)
      if (!gate.allowed) {
        startingRef.current = false
        setRecordingError(gate.reason ?? 'Recording limit reached.')
        return
      }
    }

    // Create and resume AudioContext synchronously within the user gesture: if deferred past
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
      const baseAudioConstraints = { echoCancellation: false, noiseSuppression: true, autoGainControl: true }
      const preferredMicId = localStorage.getItem('demist_mic_device_id') || undefined
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: preferredMicId ? { ...baseAudioConstraints, deviceId: { exact: preferredMicId } } : baseAudioConstraints,
          video: false,
        })
      } catch (err) {
        // The saved microphone may have been unplugged or renamed: fall back
        // to the system default rather than blocking recording entirely.
        let fallbackStream: MediaStream | null = null
        if (preferredMicId && (err as DOMException)?.name === 'OverconstrainedError') {
          try {
            fallbackStream = await navigator.mediaDevices.getUserMedia({ audio: baseAudioConstraints, video: false })
          } catch { /* fall through to the error path below */ }
        }
        if (!fallbackStream) {
          audioCtx.close()
          audioProcessingCtxRef.current = null
          startingRef.current = false
          alert('Microphone access is needed to use Demist.')
          return
        }
        stream = fallbackStream
      }
    }
    streamRef.current = stream
    if (mode === 'microphone') {
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', recoverMicStream, { once: true }))
    }
    attachAudioGraph(audioCtx, stream)
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
    sentTermsRef.current = new Set()
    sentenceCountRef.current = 0
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
    setSentences([]); setTranslatedSentences([])
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

    const useNativeMic = isElectronNative() && mode === 'microphone'
    let recordingMode: 'native' | 'whisper+speech_api' | 'whisper' = 'whisper'

    if (useNativeMic) {
      // Fully on-device: raw PCM streamed to Whisper via an AudioWorklet +
      // native segmenter (desktop/native/whisper.js + pcm-segmenter.js).
      // Web Speech must NOT start here: it routes audio through Google's
      // servers, which would falsify "nothing leaves the device", and the
      // cloud MediaRecorder/processChunk loop never runs in this branch.
      recordingMode = 'native'
      try {
        nativeSessionRef.current = await startNativeSession(streamRef.current!, {
          onTranscript: (text) => {
            const sid = sessionIdRef.current
            if (sid) accumulateAndMaybeDetect(text, sid)
          },
          onModelProgress: (label, pct) => {
            setRecordingWarning(pct >= 100 ? null : `Downloading on-device model (${label})… ${pct}%`)
          },
          onError: (message) => {
            console.error('[demist] native session error:', message)
          },
        })
      } catch (e) {
        console.error('[demist] failed to start native session:', e)
        setRecordingError('Could not start on-device transcription.')
      }
    } else {
      // ── Cloud transcription: chunk loop ─────────────────────────────────────
      const doChunk = () => {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
        // Use raw getUserMedia stream: Chrome suspends AudioContext in background tabs
        // but always delivers audio from getUserMedia regardless of tab visibility.
        const recorder = new MediaRecorder(streamRef.current!, { mimeType })
        recorderRef.current = recorder
        const chunks: Blob[] = []
        recorder.ondataavailable = (e: BlobEvent) => { if (e.data.size > 0) chunks.push(e.data) }
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType })
          const sid = sessionIdRef.current
          if (sid) processChunk(blob, sid)
          if (isActiveRef.current) doChunk()
        }
        recorder.start()
        chunkTimerRef.current = setTimeout(() => { if (recorder.state === 'recording') recorder.stop() }, chunkIntervalRef.current)
      }

      doChunk()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SpeechRecognitionAPI = typeof window !== 'undefined' ? ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null) : null
      if (SpeechRecognitionAPI) {
        recordingMode = 'whisper+speech_api'
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
    }

    capture('recording_started', { subject: sessionSubjectRef.current || profileRef.current?.course, mode: recordingMode })
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

    // Native session flush: waits for in-flight segments so the final
    // utterance's text (via accumulateAndMaybeDetect, called synchronously
    // from onTranscript) is already in detectionBufferRef before the flush
    // check below runs.
    if (nativeSessionRef.current) {
      await nativeSessionRef.current.stop()
      nativeSessionRef.current = null
    }

    // Flush any text waiting for the 10s detect-terms window so terms from the
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
    }

    if (sid) {
      const capturedSid = sid
      const capturedSubject = sessionSubjectRef.current || profileRef.current?.course
      const capturedGlossary = [...sessionGlossary]
      const capturedMode = captureModeRef.current
      const capturedTranslation = translatedSentences.filter(Boolean).join(' ')
      const capturedTranslateLang = profileRef.current?.translate_to || null
      setTimeout(async () => {
        try {
          const sb = createClient()

          // Mic mode requires lecturer consent OR a declared support need before storing transcript or summary
          if (capturedMode === 'microphone') {
            const supportNeed = profileRef.current?.support_need
            const eligibleBySupportNeed = !!supportNeed && supportNeed !== 'none'
            if (!eligibleBySupportNeed) {
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
          }

          const whisperTx = transcriptRef.current.trim()
          const speechTx = webSpeechFinalRef.current.trim()
          const tx = speechTx.length > whisperTx.length ? speechTx : whisperTx
          if (tx) {
            await sb.from('sessions').update({
              transcript: tx,
              transcript_translation: capturedTranslation || null,
              translation_lang: capturedTranslation ? capturedTranslateLang : null,
            }).eq('id', capturedSid)
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
    if (limits.summariesPerWeek != null) {
      const supabase = createClient()
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
      const { count } = await supabase
        .from('sessions')
        .select('id', { count: 'exact', head: true })
        .not('synopsis', 'is', null)
        .gte('started_at', weekAgo)
      if ((count ?? 0) >= limits.summariesPerWeek) { setPaywall('summary_cap'); return }
    }
    sessionSummarizingRef.current.add(s.id)
    setSessionGenIds(prev => new Set(prev).add(s.id))
    setSessionFailIds(prev => { const next = new Set(prev); next.delete(s.id); return next })
    let succeeded = false
    let reason: string | undefined
    try {
      const supabase = createClient()
      const { data, error } = await supabase.functions.invoke('summarize-session', {
        body: { session_id: s.id, subject: profileRef.current?.course, terms: s.terms },
      })
      reason = data?.reason
      if (!error && data?.ok && data?.synopsis) {
        setRecentSessions(prev => prev.map(x => x.id === s.id ? { ...x, synopsis: data.synopsis } : x))
        succeeded = true
      }
    } catch (e) {
      console.error('dashboard summarize error:', e)
    } finally {
      sessionSummarizingRef.current.delete(s.id)
      setSessionGenIds(prev => { const next = new Set(prev); next.delete(s.id); return next })
      if (!succeeded) {
        setSessionFailIds(prev => new Set(prev).add(s.id))
        setSessionFailReasons(prev => ({ ...prev, [s.id]: reason ?? '' }))
      }
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

  const value: RecordingSessionValue = {
    loading, isRecording, elapsed, liveTerms, setLiveTerms, sessionGlossary, profile, stats,
    recentSessions, setRecentSessions, sessionGenIds, sessionFailIds, sessionFailReasons, sessionTermLoading,
    recordingError, recordingWarning, wakeLockUnsupported, captureMode, setCaptureMode, capturedTabTitle,
    sentences, translatedSentences, liveSessionId, reviewTerms, setReviewTerms, sessionSubject, setSessionSubject,
    sessionSubjectRef, paywall, setPaywall, localTranslate, localTranslateUsable, liveTranslateAvailable,
    vizAnalyserRef, chunkPeakRef, startRecording, stopRecording, dismissTerm, pinTerm, markKnown,
    maybeGenerateOnDashboard, retrySessionSummarize, toggleExpandSession,
  }

  return <RecordingSessionContext.Provider value={value}>{children}</RecordingSessionContext.Provider>
}

export function useRecordingSession(): RecordingSessionValue {
  const ctx = useContext(RecordingSessionContext)
  if (!ctx) throw new Error('useRecordingSession must be used within RecordingSessionProvider')
  return ctx
}

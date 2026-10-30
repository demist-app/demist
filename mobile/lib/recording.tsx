// The iOS recorder. Lives above the tabs so a lecture keeps going while the
// student opens Glossary or Flashcards, and (with UIBackgroundModes audio)
// while the phone is locked in their pocket.
//
// Speech to text is Apple's on-device recogniser. The audio is never sent
// anywhere: requiresOnDeviceRecognition is set, and recording refuses to start
// on a phone that cannot do it, because SFSpeechRecognizer otherwise falls
// back to Apple's servers without telling anyone.
//
// Things that went wrong on the web and are designed out here from the start:
// - Nothing that keeps recording alive depends on a screen being visible
//   (web/public/level-worklet.js, 2026-10-07).
// - Supabase writes resolve with { error }; every one is checked.
// - The transcript is only stored where recording consent allows
//   (lecturer consent for the subject, or a declared support need), the same
//   gate as web persistTranscript and the summarize-session function.
// - A session row that fails to insert is retried at stop, not given up on.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, Linking } from 'react-native'
import { getLocales } from 'expo-localization'
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition'
import { supabase } from './supabase'
import { useAccount } from './account'
import { usePrefs } from './prefs'
import type { LectureLanguage } from './shared/lectureLanguage'
import { capture, reportWriteFailure, reportError } from './analytics'
import { detectTerms, splitSentences, type DetectState, type DetectedTerm } from './detect'
import { analyzer, analyzerReady, type SpeechEngine } from './speech'

export type RecStatus = 'idle' | 'starting' | 'recording' | 'stopping'

export interface LiveCard { id: string; term: string; definition: string; pinned: boolean; shownAt: number }
export interface LostMark { atMs: number; transcriptOffset: number }

interface Ctx {
  status: RecStatus
  subject: string
  setSubject: (s: string) => void
  transcript: string        // settled text
  interim: string           // the sentence still being heard
  cards: LiveCard[]
  sessionTerms: DetectedTerm[]
  lostCount: number
  elapsedMs: number
  level: number             // 0..1, for the calm level meter
  notice: string | null     // gentle, non-blocking
  error: string | null      // blocking, recording did not start or stopped
  /** Set when a recording has just finished, so the screen can open it. */
  finishedSessionId: string | null
  start: () => Promise<void>
  stop: () => Promise<void>
  markLost: () => void
  pinCard: (id: string) => void
  dismissCard: (id: string) => void
  clearFinished: () => void
  clearError: () => void
}

const RecordingContext = createContext<Ctx | null>(null)

const MIN_SHOWN_MS = 8_000      // a card is never replaced sooner than this
const CARDS_VISIBLE = 2        // unpinned cards on screen at once
const CARDS_MAX_TOTAL = 3      // including opened (pinned) ones
const CARD_QUEUE_MAX = 6       // waiting beyond this are only in the glossary
const DETECT_EVERY_MS = 15_000
const AUTOSAVE_MS = 45_000

// The speech locale for a lecture language. Apple's recogniser needs the
// language up front (it cannot detect it), so the student picks it on the
// Record screen. The phone's own region is kept when it matches, so a Belgian
// phone recording Dutch gets nl-BE rather than nl-NL.
const DEFAULT_LOCALE: Record<LectureLanguage, string> = {
  en: 'en-GB', fr: 'fr-FR', nl: 'nl-NL', de: 'de-DE', es: 'es-ES', it: 'it-IT', pt: 'pt-PT',
}
function speechLocale(lang: LectureLanguage): string {
  const device = getLocales()[0]
  if (device?.languageCode === lang && device.languageTag) return device.languageTag
  return DEFAULT_LOCALE[lang]
}

export function RecordingProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAccount()
  const { lectureLanguage } = usePrefs()
  const langRef = useRef<LectureLanguage>(lectureLanguage)
  langRef.current = lectureLanguage

  // Fetch the new engine's language model in the background as soon as the
  // app knows the lecture language, so the first recording does not wait.
  useEffect(() => { void analyzerReady(speechLocale(lectureLanguage)) }, [lectureLanguage])
  const userId = session?.user.id ?? null

  const [status, setStatus] = useState<RecStatus>('idle')
  const [subject, setSubject] = useState('')
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [cards, setCards] = useState<LiveCard[]>([])
  const [sessionTerms, setSessionTerms] = useState<DetectedTerm[]>([])
  const [lostCount, setLostCount] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [level, setLevel] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [finishedSessionId, setFinishedSessionId] = useState<string | null>(null)

  // Refs: event listeners and timers outlive renders.
  const wantRef = useRef(false)                 // the student wants to be recording
  const statusRef = useRef<RecStatus>('idle')
  const sessionIdRef = useRef<string | null>(null)
  const startedAtRef = useRef(0)
  const finalRef = useRef('')                   // settled transcript
  const interimRef = useRef('')
  const segSentencesSentRef = useRef(0)         // sentences of the current segment already queued
  const pendingRef = useRef<string[]>([])       // sentences waiting for detection
  const detectingRef = useRef(false)
  const detectStateRef = useRef<DetectState>({ known: new Set(), sent: new Set(), sessionTerms: [] })
  const termsRef = useRef<DetectedTerm[]>([])
  const marksRef = useRef<LostMark[]>([])
  const unsavedMarksRef = useRef<LostMark[]>([])
  const eligibleRef = useRef<boolean | null>(null)
  const lastSavedRef = useRef('')
  const rotateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cardsRef = useRef<LiveCard[]>([])
  const cardQueueRef = useRef<DetectedTerm[]>([])
  const subjectRef = useRef('')
  const restartsRef = useRef<number[]>([])
  // Whether this recording has heard anything at all. A recogniser that ends
  // over and over before its first word cannot run on this phone in this
  // language (on-device is required, see patches/expo-speech-recognition).
  const heardAnythingRef = useRef(false)
  const engineRef = useRef<SpeechEngine>('legacy')
  const stopRef = useRef<() => Promise<void>>(async () => {})
  const statsRef = useRef({ detectOk: 0, detectFailed: 0, lastFailure: null as string | null, restarts: 0, termsSaved: 0 })
  const endWaiterRef = useRef<(() => void) | null>(null)
  const profileRef = useRef(profile)
  const userIdRef = useRef(userId)
  userIdRef.current = userId
  profileRef.current = profile
  subjectRef.current = subject

  const setStatusBoth = (s: RecStatus) => { statusRef.current = s; setStatus(s) }
  const fullText = () => [finalRef.current, interimRef.current].filter(Boolean).join(' ').trim()
  const subjectFor = () => subjectRef.current.trim() || profileRef.current?.course || null

  // ---- recognition -------------------------------------------------------

  const startRecognizer = useCallback(() => {
    if (engineRef.current === 'analyzer' && analyzer) {
      // A start that fails (model missing, microphone busy) hands this
      // lecture to the old engine instead of stopping it.
      analyzer.start(speechLocale(langRef.current)).catch((e: unknown) => {
        capture('ios_analyzer_start_failed', { message: String((e as Error)?.message ?? e).slice(0, 120) })
        engineRef.current = 'legacy'
        if (wantRef.current) startRecognizer()
      })
      return
    }
    const known = Array.from(detectStateRef.current.known).slice(-80)
    const s = subjectFor()
    ExpoSpeechRecognitionModule.start({
      lang: speechLocale(langRef.current),
      interimResults: true,
      continuous: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: true,
      maxAlternatives: 1,
      iosTaskHint: 'dictation',
      // Biases recognition toward the student's own vocabulary, so a term
      // they have met before is less likely to come back mis-heard.
      contextualStrings: s ? [s, ...known] : known,
      iosCategory: {
        category: 'playAndRecord',
        categoryOptions: ['defaultToSpeaker', 'allowBluetooth'],
        mode: 'default',
      },
      volumeChangeEventOptions: { enabled: true, intervalMillis: 250 },
    })
  }, [])

  // Sentences from the segment being heard that are complete (a later
  // sentence has begun), so they can go to detection before the segment
  // ends. On iOS 17 a segment can be the whole lecture.
  const queueSegment = (segmentText: string, isFinal: boolean) => {
    const sentences = splitSentences(segmentText)
    const complete = isFinal ? sentences : sentences.slice(0, -1)
    if (complete.length > segmentSentencesSent()) {
      pendingRef.current.push(...complete.slice(segmentSentencesSent()))
      segSentencesSentRef.current = complete.length
    }
    if (isFinal) segSentencesSentRef.current = 0
    if (pendingRef.current.length >= 3) void runDetection()
  }
  const segmentSentencesSent = () => segSentencesSentRef.current

  useEffect(() => {
    const onResult = (raw: string, isFinal: boolean, engine: SpeechEngine) => {
      const text = raw.trim()
      if (text) heardAnythingRef.current = true
      if (isFinal) {
        if (text) finalRef.current = finalRef.current ? `${finalRef.current} ${text}` : text
        interimRef.current = ''
        setTranscript(finalRef.current)
        setInterim('')
        queueSegment(text, true)
      } else {
        interimRef.current = text
        setInterim(text)
        // The new engine's volatile text is only the part not yet final, and
        // its final pieces arrive every few seconds, so detection waits for
        // those rather than counting sentences in text that will be redone.
        if (engine === 'legacy') queueSegment(text, false)
      }
    }
    const subs = [
      ExpoSpeechRecognitionModule.addListener('result', e => {
        if (engineRef.current === 'legacy') onResult(e.results[0]?.transcript ?? '', e.isFinal, 'legacy')
      }),
      ExpoSpeechRecognitionModule.addListener('volumechange', e => {
        setLevel(Math.max(0, Math.min(1, (e.value + 2) / 12)))
      }),
      ...(analyzer ? [
        analyzer.addListener('onResult', e => {
          if (engineRef.current === 'analyzer') onResult(e.text ?? '', e.isFinal, 'analyzer')
        }),
        analyzer.addListener('onVolume', e => setLevel(e.level)),
        analyzer.addListener('onError', e => {
          statsRef.current.lastFailure = `analyzer_${e.code}`
          capture('ios_speech_error', { code: e.code, engine: 'analyzer' })
        }),
        analyzer.addListener('onEnd', () => { if (engineRef.current === 'analyzer') onEnd() }),
      ] : []),
      ExpoSpeechRecognitionModule.addListener('error', e => {
        // no-speech and aborted are normal in a long lecture (a quiet stretch,
        // our own stop). 'end' follows every error and handles the restart.
        if (e.error === 'no-speech' || e.error === 'aborted') return
        if (e.error === 'not-allowed') {
          wantRef.current = false
          setError('Demist needs the microphone and speech recognition. You can allow both in Settings.')
        } else if (e.error === 'language-not-supported' || e.error === 'service-not-allowed') {
          wantRef.current = false
          setError(NEEDS_DICTATION)
        }
        statsRef.current.lastFailure = `speech_${e.error}`
        capture('ios_speech_error', { code: e.error, engine: 'legacy' })
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => { if (engineRef.current === 'legacy') onEnd() }),
    ]
    function onEnd() {
        // Whatever was mid-sentence is kept, not dropped.
        if (interimRef.current) {
          const t = interimRef.current
          finalRef.current = finalRef.current ? `${finalRef.current} ${t}` : t
          queueSegment(t, true)
          interimRef.current = ''
          setTranscript(finalRef.current)
          setInterim('')
        }
        segSentencesSentRef.current = 0
        setLevel(0)
        if (endWaiterRef.current) { endWaiterRef.current(); endWaiterRef.current = null }
        if (!wantRef.current) return
        // The recogniser ended on its own: a phone call, Siri, a long
        // silence, or an iOS limit. Start it again, unless it is failing in a
        // tight loop, in which case say so instead of spinning.
        const now = Date.now()
        restartsRef.current = [...restartsRef.current.filter(t => now - t < 60_000), now]
        statsRef.current.restarts++
        // The new engine ending again and again before a single word: give
        // this lecture to the old one rather than giving up.
        if (engineRef.current === 'analyzer' && !heardAnythingRef.current && restartsRef.current.length >= 2) {
          capture('ios_analyzer_fell_back', { last_failure: statsRef.current.lastFailure })
          engineRef.current = 'legacy'
          restartsRef.current = []
          setTimeout(() => { if (wantRef.current) startRecognizer() }, 300)
          return
        }
        if (!heardAnythingRef.current && restartsRef.current.length >= 3) {
          capture('ios_recognizer_never_started', { lang: langRef.current, last_failure: statsRef.current.lastFailure })
          wantRef.current = false
          void stopRef.current().then(() => setError(needsDictation(langRef.current)))
          return
        }
        if (restartsRef.current.length > 8) {
          setNotice('Listening keeps pausing. Recording will carry on when it can.')
          setTimeout(() => { if (wantRef.current) startRecognizer() }, 5_000)
        } else {
          setTimeout(() => { if (wantRef.current) startRecognizer() }, 300)
        }
    }
    return () => subs.forEach(s => s.remove())
  }, [startRecognizer])

  // ---- detection ---------------------------------------------------------

  const runDetection = useCallback(async () => {
    if (detectingRef.current || !pendingRef.current.length) return
    detectingRef.current = true
    const batch = pendingRef.current.splice(0, pendingRef.current.length)
    const newText = batch.join(' ')
    const settled = finalRef.current
    const context = settled.slice(Math.max(0, settled.length - newText.length - 400), Math.max(0, settled.length - newText.length))
    try {
      const out = await detectTerms(newText, context, detectStateRef.current, {
        subject: subjectFor(), year: profileRef.current?.year_of_study ?? null, lang: langRef.current,
      })
      if (out.kind === 'terms') {
        statsRef.current.detectOk++
        await onTerms(out.terms)
      } else if (out.kind === 'none') {
        statsRef.current.detectOk++
      } else {
        statsRef.current.detectFailed++
        statsRef.current.lastFailure = out.kind === 'unavailable' ? out.detail : out.kind
        if (out.kind === 'rate_limited') setNotice('New words will pause for a little while. Your lecture is still being written down.')
        else if (out.kind === 'signed_out') setNotice('You have been signed out, so new words cannot be saved. Your lecture is still being written down.')
        else setNotice("New words can't be explained right now (no connection). Your lecture is still being written down.")
      }
    } catch (e) {
      statsRef.current.detectFailed++
      reportError('ios_detect_threw', { message: String((e as Error)?.message ?? e).slice(0, 120) })
    } finally {
      detectingRef.current = false
    }
  }, [])

  const onTerms = async (terms: DetectedTerm[]) => {
    setNotice(null)
    termsRef.current = [...terms, ...termsRef.current]
    setSessionTerms(termsRef.current)
    // Every word gets its card, two on screen at a time. Before, a batch of
    // four showed two and saved the rest silently: replaying a biology
    // lecture, mitochondria and ribosomes never appeared.
    cardQueueRef.current = [...cardQueueRef.current, ...terms].slice(-CARD_QUEUE_MAX)
    fillCards()
    const sid = sessionIdRef.current
    const uid = userIdRef.current
    if (!sid || !uid) return
    const { error } = await supabase.from('terms').insert(terms.map(t => ({
      user_id: uid, session_id: sid, term: t.term, definition: t.definition,
      context: t.context ?? null, subject: subjectFor(),
    })))
    if (!reportWriteFailure('terms.insert', error, { count: terms.length })) statsRef.current.termsSaved += terms.length
  }

  // Detection on a timer as well as on sentence count, so a slow speaker's
  // terms still arrive. Plain setInterval: it keeps running in the
  // background, where the audio session holds the app awake.
  useEffect(() => {
    if (status !== 'recording') return
    const detect = setInterval(() => { void runDetection() }, DETECT_EVERY_MS)
    const save = setInterval(() => { void persistTranscript() }, AUTOSAVE_MS)
    const tick = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 1000)
    return () => { clearInterval(detect); clearInterval(save); clearInterval(tick) }
  }, [status, runDetection])

  // ---- persistence -------------------------------------------------------

  const createSessionRow = async (): Promise<string | null> => {
    const uid = userIdRef.current
    if (!uid) return null
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { data, error } = await supabase.from('sessions').insert({
        user_id: uid,
        subject: subjectFor(),
        year_of_study: profileRef.current?.year_of_study ?? null,
        capture_mode: 'microphone',
        // No started_at: the server's clock stamps it, as on the web. A phone
        // whose clock is wrong would otherwise make lectures that end before
        // they start (migration 041).
      }).select('id').single()
      if (!error && data?.id) return data.id as string
      if (attempt === 3) capture('session_create_failed', { code: error?.code ?? 'no_row', message: error?.message?.slice(0, 200) ?? null })
      await new Promise(r => setTimeout(r, attempt * 800))
    }
    return null
  }

  const transcriptAllowed = async (): Promise<boolean> => {
    if (eligibleRef.current !== null) return eligibleRef.current
    const need = profileRef.current?.support_need
    if (need && need !== 'none') return (eligibleRef.current = true)
    const subj = (subjectFor() ?? '').trim().replace(/[%_]/g, c => '\\' + c)
    if (!subj) return (eligibleRef.current = false)
    const { data } = await supabase.from('lecturer_consents').select('id').ilike('module_name', subj).maybeSingle()
    return (eligibleRef.current = !!data)
  }

  const persistTranscript = async () => {
    const sid = sessionIdRef.current
    const tx = fullText()
    if (!sid || !tx || tx === lastSavedRef.current) return
    if (!(await transcriptAllowed())) return
    const { error } = await supabase.from('sessions').update({ transcript: tx }).eq('id', sid)
    if (!reportWriteFailure('session.transcript', error, { chars: tx.length })) lastSavedRef.current = tx
  }

  const saveMarks = async (sid: string, marks: LostMark[]) => {
    const uid = userIdRef.current
    if (!marks.length || !uid) return true
    const { error } = await supabase.from('session_marks').insert(marks.map(m => ({
      session_id: sid, user_id: uid, at_ms: Math.round(m.atMs), transcript_offset: m.transcriptOffset,
    })))
    // Table missing until migration 042 is applied: a known state, not an alert.
    if (error && (error.code === 'PGRST205' || error.code === '42P01')) return true
    return !reportWriteFailure('session_marks.insert', error, { count: marks.length })
  }

  // ---- public actions ----------------------------------------------------

  const start = useCallback(async () => {
    if (statusRef.current !== 'idle' || !userId) return
    setError(null); setNotice(null); setFinishedSessionId(null)
    setStatusBoth('starting')

    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync()
    if (!perm.granted) {
      setStatusBoth('idle')
      setError('Demist needs the microphone and speech recognition. You can allow both in Settings.')
      capture('ios_permission_denied', { can_ask_again: perm.canAskAgain })
      return
    }
    // The new engine when this phone and language have it (a first-time model
    // download is capped, see lib/speech.ts); otherwise the old one, which
    // must be able to run on the device.
    engineRef.current = await analyzerReady(speechLocale(langRef.current)) ? 'analyzer' : 'legacy'
    if (engineRef.current === 'legacy' && (!ExpoSpeechRecognitionModule.isRecognitionAvailable() || !ExpoSpeechRecognitionModule.supportsOnDeviceRecognition())) {
      setStatusBoth('idle')
      setError(NEEDS_DICTATION)
      capture('ios_on_device_unavailable', { available: ExpoSpeechRecognitionModule.isRecognitionAvailable() })
      return
    }

    // Fresh session state.
    heardAnythingRef.current = false
    finalRef.current = ''; interimRef.current = ''; pendingRef.current = []
    segSentencesSentRef.current = 0; termsRef.current = []; marksRef.current = []; unsavedMarksRef.current = []
    eligibleRef.current = null; lastSavedRef.current = ''; restartsRef.current = []
    statsRef.current = { detectOk: 0, detectFailed: 0, lastFailure: null, restarts: 0, termsSaved: 0 }
    setTranscript(''); setInterim(''); setCardsBoth([]); cardQueueRef.current = []; setSessionTerms([]); setLostCount(0); setElapsedMs(0)

    // Words already in the glossary are never carded again.
    const { data: knownRows } = await supabase.from('terms').select('term').eq('user_id', userId).order('created_at', { ascending: false }).limit(1000)
    detectStateRef.current = {
      known: new Set((knownRows ?? []).map(r => String(r.term).toLowerCase())),
      sent: new Set(),
      sessionTerms: [],
    }

    startedAtRef.current = Date.now()
    wantRef.current = true
    try {
      startRecognizer()
    } catch (e) {
      wantRef.current = false
      setStatusBoth('idle')
      setError('Recording could not start. Please try again.')
      reportError('ios_recognizer_start_threw', { message: String((e as Error)?.message ?? e).slice(0, 120) })
      return
    }
    setStatusBoth('recording')
    capture('recording_started', { mode: 'microphone', platform: 'ios', engine: engineRef.current })
    sessionIdRef.current = await createSessionRow()
    if (!sessionIdRef.current) setNotice('Your lecture is being written down, but could not be saved to your account yet. We will try again when you stop.')
  }, [userId, startRecognizer])

  const stop = useCallback(async () => {
    if (statusRef.current !== 'recording') return
    setStatusBoth('stopping')
    wantRef.current = false
    await new Promise<void>(resolve => {
      endWaiterRef.current = resolve
      if (engineRef.current === 'analyzer' && analyzer) analyzer.stop().catch(() => resolve())
      else try { ExpoSpeechRecognitionModule.stop() } catch { resolve() }
      // The new engine finalises its last words before ending, so it gets
      // a little longer.
      setTimeout(resolve, engineRef.current === 'analyzer' ? 4000 : 2500)
    })
    clearRotate()

    // Last words through detection, bounded so a slow network cannot hold
    // the student on a spinner.
    await Promise.race([
      (async () => { while (detectingRef.current) await new Promise(r => setTimeout(r, 200)); await runDetection() })(),
      new Promise(r => setTimeout(r, 8_000)),
    ])

    let sid = sessionIdRef.current
    if (!sid) {
      sid = await createSessionRow()
      sessionIdRef.current = sid
      const uid = userIdRef.current
      if (sid && termsRef.current.length && uid) {
        const { error } = await supabase.from('terms').insert(termsRef.current.map(t => ({
          user_id: uid, session_id: sid, term: t.term, definition: t.definition, context: t.context ?? null, subject: subjectFor(),
        })))
        reportWriteFailure('terms.insert_late', error, { count: termsRef.current.length })
      }
    }
    const durationSec = Math.round((Date.now() - startedAtRef.current) / 1000)
    if (sid) {
      const { error } = await supabase.from('sessions').update({ ended_at: new Date().toISOString() }).eq('id', sid)
      reportWriteFailure('session.ended_at', error)
      await persistTranscript()
      if (unsavedMarksRef.current.length && await saveMarks(sid, unsavedMarksRef.current)) unsavedMarksRef.current = []
      // The function checks consent itself; this only asks.
      if (termsRef.current.length) {
        void supabase.functions.invoke('summarize-session', {
          body: { session_id: sid, subject: subjectFor(), lecture_language: langRef.current, terms: termsRef.current.map(t => ({ term: t.term, definition: t.definition })) },
        }).catch(() => {})
      }
    }
    const words = fullText().split(/\s+/).filter(Boolean).length
    capture('recording_stopped', {
      duration_seconds: durationSec, platform: 'ios', words, terms: termsRef.current.length,
      lost_marks: marksRef.current.length, restarts: statsRef.current.restarts,
      detect_ok: statsRef.current.detectOk, detect_failed: statsRef.current.detectFailed,
      last_failure: statsRef.current.lastFailure, saved: !!sid, engine: engineRef.current,
    })
    setStatusBoth('idle')
    setLevel(0)
    setCardsBoth([]); cardQueueRef.current = []
    setNotice(sid ? null : 'This lecture could not be saved to your account. Check your connection; the text is still on screen.')
    if (sid) setFinishedSessionId(sid)
  }, [runDetection])
  stopRef.current = stop

  // "I'm lost": never asks anything, never blocks, as many as needed.
  const markLost = useCallback(() => {
    if (statusRef.current !== 'recording') return
    const mark = { atMs: Date.now() - startedAtRef.current, transcriptOffset: fullText().length }
    marksRef.current.push(mark)
    setLostCount(marksRef.current.length)
    capture('lost_marked', { at_seconds: Math.round(mark.atMs / 1000), count: marksRef.current.length, platform: 'ios' })
    const sid = sessionIdRef.current
    if (!sid) { unsavedMarksRef.current.push(mark); return }
    void saveMarks(sid, [mark]).then(ok => { if (!ok) unsavedMarksRef.current.push(mark) })
  }, [])

  // ---- cards ---------------------------------------------------------------
  // cardsRef mirrors the state so the queue can be read outside a render.

  const setCardsBoth = (next: LiveCard[]) => { cardsRef.current = next; setCards(next) }
  const clearRotate = () => { if (rotateTimer.current) clearTimeout(rotateTimer.current); rotateTimer.current = null }

  // Cards do not fade on a clock (the user's call, 2026-10-30: on a phone you
  // are often not looking). A card only leaves when a newer word is waiting
  // for its place, and only after it has been on screen MIN_SHOWN_MS while
  // the app is in front, so nothing is replaced inside a locked phone.
  const scheduleRotate = () => {
    clearRotate()
    if (!cardQueueRef.current.length || AppState.currentState !== 'active') return
    const oldest = cardsRef.current.find(c => !c.pinned)
    if (!oldest) return
    const wait = Math.max(0, oldest.shownAt + MIN_SHOWN_MS - Date.now())
    rotateTimer.current = setTimeout(() => dismissCard(oldest.id), wait)
  }

  const fillCards = () => {
    const unpinned = cardsRef.current.filter(c => !c.pinned).length
    const room = Math.min(CARDS_VISIBLE - unpinned, CARDS_MAX_TOTAL - cardsRef.current.length)
    if (room > 0 && cardQueueRef.current.length) {
      // A card first seen with the screen off counts as shown from when the
      // screen comes back on (see the AppState listener).
      const now = AppState.currentState === 'active' ? Date.now() : Infinity
      const next = cardQueueRef.current.splice(0, room).map(t => ({ id: `${Date.now()}-${Math.random()}`, term: t.term, definition: t.definition, pinned: false, shownAt: now }))
      setCardsBoth([...cardsRef.current, ...next])
      next.forEach(c => capture('term_card_shown', { chars: c.term.length }))
    }
    scheduleRotate()
  }

  const dismissCard = useCallback((id: string) => {
    setCardsBoth(cardsRef.current.filter(c => c.id !== id))
    fillCards()
  }, [])

  // Tapping a card opens its whole definition and keeps it until closed.
  const pinCard = useCallback((id: string) => {
    setCardsBoth(cardsRef.current.map(c => c.id === id ? { ...c, pinned: !c.pinned } : c))
    fillCards()
  }, [])

  // Signing out mid-lecture stops the recording rather than orphaning it.
  useEffect(() => {
    if (!userId && statusRef.current === 'recording') void stop()
  }, [userId, stop])

  // Coming back to the app after a long time locked: show the latest text.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active' && statusRef.current === 'recording') {
        setTranscript(finalRef.current)
        setElapsedMs(Date.now() - startedAtRef.current)
        const now = Date.now()
        if (cardsRef.current.some(c => c.shownAt === Infinity)) {
          setCardsBoth(cardsRef.current.map(c => c.shownAt === Infinity ? { ...c, shownAt: now } : c))
        }
        scheduleRotate()
      } else if (s !== 'active') {
        clearRotate()
      }
    })
    return () => sub.remove()
  }, [])

  return (
    <RecordingContext.Provider value={{
      status, subject, setSubject, transcript, interim, cards, sessionTerms, lostCount, elapsedMs, level,
      notice, error, finishedSessionId, start, stop, markLost, pinCard, dismissCard,
      clearFinished: () => setFinishedSessionId(null),
      clearError: () => setError(null),
    }}>
      {children}
    </RecordingContext.Provider>
  )
}

export const NEEDS_DICTATION =
  "This iPhone can't turn speech into text by itself yet. Turn on Dictation in Settings, General, Keyboard, wait a minute for it to finish setting up, then try again."

const LANGUAGE_IN_ENGLISH: Record<LectureLanguage, string> = {
  en: 'English', fr: 'French', nl: 'Dutch', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese',
}
/** For a lecture language this phone cannot transcribe by itself. */
export function needsDictation(lang: LectureLanguage): string {
  if (lang === 'en') return NEEDS_DICTATION
  const name = LANGUAGE_IN_ENGLISH[lang]
  return `This iPhone can't turn ${name} speech into text by itself yet. Add ${name} as a keyboard in Settings, General, Keyboard, make sure Dictation is on, wait a minute for it to set up, then try again.`
}

export function openSettings() { void Linking.openSettings() }

export function useRecording(): Ctx {
  const ctx = useContext(RecordingContext)
  if (!ctx) throw new Error('useRecording outside RecordingProvider')
  return ctx
}

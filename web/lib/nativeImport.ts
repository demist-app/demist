'use client'

// On-device Import for the desktop app: the local equivalent of the
// transcribe-audio and process-text-upload edge functions.
//
// Why this exists at all. The desktop app's whole proposition, its privacy
// policy, and its Store listing all say lecture material is processed on the
// machine and never sent anywhere. Import was the exception: uploading a
// recording sent the audio file to Supabase storage and on to Groq/OpenAI, and
// uploading slides sent their extracted text to OpenAI. Both from inside the
// app that promises neither happens.
//
// Why it costs nothing extra. The transcription model is already resident in
// the 'transcribe' worker from app launch and the term-detection model in the
// 'terms' worker, both kept warm on a timer whether or not anyone imports
// anything. An import loads no new model and allocates no new weights - it
// feeds files through what is already in memory. The only resource it spends
// is time, which is the right thing to spend (a slower machine waits longer,
// it does not get a worse transcript).
//
// This deliberately mirrors the edge functions' behaviour and response shape so
// the Import page can use either without branching on anything but the platform.

import { createClient } from '@/lib/supabase'
import { getDemistNative } from '@/lib/electronNative'
import { collidesWith } from '@/lib/termSimilarity'

// Matching backend/supabase/functions/process-text-upload/index.ts, so an
// import produces a comparable result on either path.
const CHUNK_SIZE = 3500
const MAX_CHUNKS = 30
const MAX_TERMS = 80

// The edge function silently coerces anything outside this set to
// 'text_upload'. The column itself has no constraint (checked directly against
// the live database), so without the same coercion here the two paths would
// write different `source` values for the same action and History would sort
// desktop imports into a category the web app never produces.
const VALID_SOURCES = new Set(['audio_import', 'text_upload', 'notion', 'pptx', 'docx', 'transcript_upload'])
const normalizeSource = (s: string | undefined) => (s && VALID_SOURCES.has(s) ? s : 'text_upload')

const TARGET_RATE = 16000
// Whisper's receptive field is 30 seconds and its cost does not scale with how
// much of that you use, so windows want to be as close to 30s as leaves room
// for the cut to move (see findQuietCut). 25s matches the coalescing cap the
// live path already uses.
const WINDOW_SAMPLES = TARGET_RATE * 25
// How far back from a window boundary the cut is allowed to move to land in a
// pause instead of the middle of a word.
const CUT_SEARCH_SAMPLES = TARGET_RATE * 3
const CUT_FRAME = Math.round(TARGET_RATE * 0.05)

export interface NativeImportResult {
  ok: true
  session_id: string
  term_count: number
  synopsis: string | null
  transcript?: string
}

export function nativeImportSupported(): boolean {
  const native = getDemistNative()
  return typeof native?.transcribeBuffer === 'function' && typeof native?.detectTerms === 'function'
}

// ── Audio decoding ──────────────────────────────────────────────────────────

// Chromium decodes mp3, m4a/aac, wav, ogg and webm natively, so importing an
// audio file needs no ffmpeg, no extra dependency and no upload - just the
// AudioContext the page can already create.
async function decodeToMono16k(file: File, onProgress?: (pct: number) => void): Promise<Float32Array> {
  const bytes = await file.arrayBuffer()
  onProgress?.(6)
  // An OfflineAudioContext lets us ask for 16kHz directly instead of decoding
  // at the device rate and resampling by hand. Some builds refuse a rate this
  // low, so fall back to a normal context plus our own downsample.
  let decoded: AudioBuffer
  try {
    const offline = new OfflineAudioContext(1, 1, TARGET_RATE)
    decoded = await offline.decodeAudioData(bytes)
  } catch {
    const ctx = new AudioContext()
    try {
      decoded = await ctx.decodeAudioData(bytes)
    } finally {
      ctx.close().catch(() => {})
    }
  }
  onProgress?.(12)

  // Mix to mono: a lecture recorded in stereo carries the same speech in both
  // channels, and Whisper wants one.
  const channels = decoded.numberOfChannels
  const length = decoded.length
  const mono = new Float32Array(length)
  for (let c = 0; c < channels; c++) {
    const data = decoded.getChannelData(c)
    for (let i = 0; i < length; i++) mono[i] += data[i]
  }
  if (channels > 1) for (let i = 0; i < length; i++) mono[i] /= channels

  if (decoded.sampleRate === TARGET_RATE) return mono
  return downsample(mono, decoded.sampleRate)
}

// Averaging over the source window rather than picking one sample: cheap
// anti-aliasing, adequate for speech, and the same approach lib/nativeSession.ts
// uses on the live path.
function downsample(input: Float32Array, inputRate: number): Float32Array {
  const ratio = inputRate / TARGET_RATE
  const out = new Float32Array(Math.floor(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio)
    const end = Math.min(Math.floor((i + 1) * ratio), input.length)
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = end > start ? sum / (end - start) : 0
  }
  return out
}

// Where to end this window. A fixed 25-second cut lands mid-word roughly every
// time, and Whisper handed half a word transcribes it as a different word, so
// the boundary is worth moving. Search the last three seconds for the quietest
// 50ms frame and cut there: in continuous speech that is the shortest gap
// between words, and in normal lecturing it is a real pause.
function findQuietCut(pcm: Float32Array, from: number, hardEnd: number): number {
  const searchStart = Math.max(from + 1, hardEnd - CUT_SEARCH_SAMPLES)
  if (hardEnd >= pcm.length) return pcm.length
  let bestAt = hardEnd
  let bestEnergy = Infinity
  for (let at = searchStart; at + CUT_FRAME <= hardEnd; at += CUT_FRAME) {
    let sum = 0
    for (let i = at; i < at + CUT_FRAME; i++) sum += pcm[i] * pcm[i]
    if (sum < bestEnergy) { bestEnergy = sum; bestAt = at + CUT_FRAME }
  }
  return bestAt
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function nativeImportAudio(opts: {
  file: File
  userId: string
  sessionName: string | null
  subject: string | null
  year: number | null
  // pct 0-100, plus terms as they are found, so the page can show the same
  // live feedback the cloud path gets from polling the terms table.
  onProgress?: (pct: number, stage: 'decoding' | 'transcribing' | 'detecting' | 'summarising') => void
  onTerms?: (terms: { term: string; definition: string }[]) => void
}): Promise<NativeImportResult> {
  const native = getDemistNative()
  if (!native?.transcribeBuffer) throw new Error('This build of the desktop app cannot import audio on-device.')

  opts.onProgress?.(2, 'decoding')
  const pcm = await decodeToMono16k(opts.file, p => opts.onProgress?.(p, 'decoding'))
  if (!pcm.length) throw new Error('No audio could be read from this file.')

  // Transcribe window by window, strictly one at a time. Awaiting each call is
  // the backpressure: the worker is single-threaded through one ONNX session,
  // so queuing windows ahead would only build a backlog and hold every
  // window's PCM in memory at once.
  const parts: string[] = []
  let at = 0
  while (at < pcm.length) {
    const hardEnd = Math.min(at + WINDOW_SAMPLES, pcm.length)
    const end = findQuietCut(pcm, at, hardEnd)
    // .slice(), not subarray: the buffer is handed across the process boundary
    // and must not be a view onto the whole file.
    const window = pcm.slice(at, end)
    const text = await native.transcribeBuffer(window.buffer as ArrayBuffer)
    if (text) parts.push(text)
    at = end
    // Transcription spans 15-75% of the bar; detection and the summary fill
    // the rest, matching how the cloud path paces its own progress.
    opts.onProgress?.(15 + Math.round((at / pcm.length) * 60), 'transcribing')
  }

  const transcript = parts.join(' ').trim()
  if (!transcript) throw new Error('Nothing could be transcribed from this file. It may be silent or not speech.')

  return finishImport({ ...opts, text: transcript, source: 'audio_import', storeTranscript: transcript })
}

export async function nativeImportText(opts: {
  text: string
  userId: string
  sessionName: string | null
  subject: string | null
  year: number | null
  source: string
  onProgress?: (pct: number, stage: 'decoding' | 'transcribing' | 'detecting' | 'summarising') => void
  onTerms?: (terms: { term: string; definition: string }[]) => void
}): Promise<NativeImportResult> {
  return finishImport({ ...opts, storeTranscript: opts.text })
}

// Everything after "we have the text": create the session, run term detection
// over it locally, save what was found, and summarise. Shared by both import
// kinds because from here on they are the same job, exactly as the two edge
// functions converge on the same code.
async function finishImport(opts: {
  text: string
  userId: string
  sessionName: string | null
  subject: string | null
  year: number | null
  source?: string
  storeTranscript: string
  onProgress?: (pct: number, stage: 'decoding' | 'transcribing' | 'detecting' | 'summarising') => void
  onTerms?: (terms: { term: string; definition: string }[]) => void
}): Promise<NativeImportResult> {
  const native = getDemistNative()
  if (!native) throw new Error('Not running in the desktop app.')
  const supabase = createClient()
  const now = new Date().toISOString()

  const { data: sessionRow, error: sessionErr } = await supabase
    .from('sessions')
    .insert({
      user_id: opts.userId,
      name: opts.sessionName?.slice(0, 100) ?? null,
      subject: opts.subject?.slice(0, 100) ?? null,
      year_of_study: Math.min(10, Math.max(1, Number(opts.year) || 1)),
      started_at: now,
      ended_at: now,
      source: normalizeSource(opts.source),
      transcript: opts.storeTranscript,
    })
    .select('id')
    .single()
  if (sessionErr || !sessionRow) throw new Error('Could not create the session. Check your connection and try again.')
  const sessionId = sessionRow.id as string

  const chunks: string[] = []
  for (let i = 0; i < opts.text.length && chunks.length < MAX_CHUNKS; i += CHUNK_SIZE) {
    chunks.push(opts.text.slice(i, i + CHUNK_SIZE))
  }

  const all: { term: string; definition: string; context?: string }[] = []
  const seen = new Set<string>()
  for (let i = 0; i < chunks.length && all.length < MAX_TERMS; i++) {
    // Sequential, not the cloud path's batches of four: those exist to overlap
    // network latency against a remote API. Here every call runs on one local
    // model through one queue, so four at once would simply take four times as
    // long to return the first result.
    let found: { term: string; definition: string; context?: string }[] = []
    try {
      // Same reason the live path sends these: consecutive chunks of one
      // document cover the same ground, and a model that is not told what it
      // has already named will name it again slightly differently.
      found = await native.detectTerms(chunks[i], '', opts.subject, opts.year, all.slice(-40).map(t => t.term))
    } catch (e) {
      // One bad chunk must not lose the whole import: the session and every
      // term found so far are already worth keeping.
      console.error('[demist] on-device term detection failed for one chunk:', e)
    }
    for (const t of found) {
      const key = t.term.toLowerCase().trim()
      if (seen.has(key) || all.length >= MAX_TERMS) continue
      // Not just exact keys: a document's chunks overlap in subject matter, so
      // the same concept comes back reworded ("proton motive" / "proton motive
      // force") or respelled, and an import saves 80 of these in one go.
      if (collidesWith(t.term, seen)) continue
      seen.add(key)
      all.push(t)
    }
    opts.onTerms?.(all.map(t => ({ term: t.term, definition: t.definition })))
    opts.onProgress?.(75 + Math.round(((i + 1) / chunks.length) * 20), 'detecting')
  }

  if (all.length) {
    await supabase.from('terms').insert(all.map(t => ({
      user_id: opts.userId,
      session_id: sessionId,
      term: t.term,
      definition: t.definition,
      context: t.context ?? null,
      subject: opts.subject ?? null,
    })))
  }

  opts.onProgress?.(96, 'summarising')
  let synopsis: string | null = null
  try {
    synopsis = await native.summarize(all.map(t => ({ term: t.term, definition: t.definition })), opts.subject)
    if (synopsis) await supabase.from('sessions').update({ synopsis }).eq('id', sessionId)
  } catch (e) {
    // A missing summary is a missing nicety; the terms and transcript are the
    // import. Never fail the whole thing over it.
    console.error('[demist] on-device summary failed:', e)
  }

  opts.onProgress?.(100, 'summarising')
  return { ok: true, session_id: sessionId, term_count: all.length, synopsis }
}

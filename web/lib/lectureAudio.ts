// Listen back, recording side (2026-11-18). Desktop app 1.0.11+ only.
//
// Records the lecture's audio alongside on-device transcription and streams
// it, chunk by chunk, to desktop/native/lecture-audio.js, which writes it to
// this computer. Nothing is uploaded.
//
// Rules, agreed with the user on 2026-11-18:
// - Pro (trial included) when the lecture starts. Others record no audio.
// - Kept only where the transcript itself is kept: system audio always, the
//   microphone only with lecturer consent for that module or a declared
//   support need. recordingSession decides that at the end of the lecture and
//   calls keep() or discard(); a recording neither kept nor discarded is
//   swept on the app's next start.
// - Playback is Pro too (components/ListenBack.tsx). Files stay on the
//   computer when Pro ends and play again on upgrade.
//
// timeline is [audioMs, transcriptOffset] pairs, one per piece of transcript:
// enough to jump from a sentence to the moment it was said.

import { getDemistNative } from '@/lib/electronNative'
import { capture } from '@/lib/analytics'

const BITRATE = 24_000          // Opus speech: clear at this rate, ~11 MB an hour
const CHUNK_MS = 5_000

export class LectureAudioRecorder {
  private recorder: MediaRecorder
  private recId = crypto.randomUUID()
  private startedAt = Date.now()
  private appends: Promise<unknown> = Promise.resolve()
  private failed = false
  private settled = false
  private bytes = 0
  private timeline: [number, number][] = []
  private stopped: Promise<void> | null = null
  // The transcription clock (PCM samples) starts when the native session
  // does, which is a moment after this recorder. Added to every startMs.
  private clockOffsetMs = 0

  private constructor(private userId: string, stream: MediaStream) {
    this.recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: BITRATE })
  }

  /** null when this machine/build cannot record (old desktop app, no Opus). */
  static async start(userId: string, stream: MediaStream): Promise<LectureAudioRecorder | null> {
    const store = getDemistNative()?.lectureAudio
    if (!store || typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return null
    try {
      const r = new LectureAudioRecorder(userId, stream)
      await store.begin(userId, r.recId)
      r.recorder.ondataavailable = (e) => {
        if (!e.data.size || r.failed) return
        r.bytes += e.data.size
        r.appends = r.appends.then(async () => {
          if (r.failed) return
          try { await store.append(userId, r.recId, await e.data.arrayBuffer()) } catch (err) {
            r.failed = true
            console.error('[demist] lecture audio: a chunk could not be saved, stopping audio for this lecture:', err)
            capture('listen_back_record_failed', { stage: 'append' })
          }
        })
      }
      r.startedAt = Date.now()
      r.recorder.start(CHUNK_MS)
      return r
    } catch (err) {
      console.error('[demist] lecture audio could not start:', err)
      capture('listen_back_record_failed', { stage: 'start' })
      return null
    }
  }

  /** Call just before the native transcription session starts. */
  markTranscriptionClockStart() { this.clockOffsetMs = Date.now() - this.startedAt }

  /** A piece of transcript beginning at transcriptOffset was said at startMs (transcription clock). */
  note(startMs: number | undefined, transcriptOffset: number) {
    const at = startMs != null && Number.isFinite(startMs)
      ? startMs + this.clockOffsetMs
      // No audio position from the engine: the arrival time, which runs a few
      // seconds behind the speaker, is still close enough to land nearby.
      : Math.max(0, Date.now() - this.startedAt - 3000)
    this.timeline.push([Math.round(at), transcriptOffset])
  }

  /** Stop recording and wait for every chunk to be written. Idempotent. */
  stop(): Promise<void> {
    if (!this.stopped) {
      this.stopped = new Promise<void>((resolve) => {
        if (this.recorder.state === 'inactive') return resolve()
        this.recorder.addEventListener('stop', () => resolve(), { once: true })
        try { this.recorder.stop() } catch { resolve() }
      }).then(() => this.appends).then(() => undefined)
    }
    return this.stopped
  }

  async keep(sessionId: string): Promise<boolean> {
    if (this.settled) return false
    this.settled = true
    await this.stop()
    const store = getDemistNative()?.lectureAudio
    if (!store) return false
    if (this.failed) { await store.discard(this.userId, this.recId).catch(() => {}); return false }
    try {
      const durationMs = Date.now() - this.startedAt
      const res = await store.finish(this.userId, this.recId, sessionId, {
        durationMs,
        timeline: [...this.timeline].sort((a, b) => a[1] - b[1]),
      })
      if (res.kept) capture('listen_back_saved', { minutes: Math.round(durationMs / 60000), mb: Math.round((res.bytes ?? this.bytes) / 1e6), points: this.timeline.length })
      return res.kept
    } catch (err) {
      console.error('[demist] lecture audio could not be kept:', err)
      capture('listen_back_record_failed', { stage: 'finish' })
      return false
    }
  }

  async discard(reason: string): Promise<void> {
    if (this.settled) return
    this.settled = true
    await this.stop()
    await getDemistNative()?.lectureAudio?.discard(this.userId, this.recId).catch(() => {})
    capture('listen_back_discarded', { reason })
  }
}

// Deleting a lecture deletes its audio; deleting the account deletes all of
// it. Best effort and silent: there is nothing to remove outside the desktop
// app, and a failure here must never block the delete the student asked for.
async function currentUserId(): Promise<string | null> {
  const { createClient } = await import('@/lib/supabase')
  const { data } = await createClient().auth.getUser()
  return data.user?.id ?? null
}

export async function removeLectureAudio(sessionIds: string[]): Promise<void> {
  const store = getDemistNative()?.lectureAudio
  if (!store || !sessionIds.length) return
  try {
    const uid = await currentUserId()
    if (uid) await Promise.all(sessionIds.map(id => store.remove(uid, id).catch(() => {})))
  } catch { /* best effort */ }
}

export async function removeAllLectureAudio(): Promise<void> {
  const store = getDemistNative()?.lectureAudio
  if (!store) return
  try {
    const uid = await currentUserId()
    if (uid) await store.removeAll(uid)
  } catch { /* best effort */ }
}

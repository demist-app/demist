'use client'

// Listen back, playback side (2026-11-18). See lib/lectureAudio.ts for how the
// audio is recorded and when it is kept.
//
// Renders nothing unless this lecture has audio on THIS computer (the desktop
// app, 1.0.11+). The transcript is split at the timeline's points so a student
// can tap any part to hear it, and the part being played is highlighted.
// "I'm lost" marks become jump points.
//
// Playback is Pro. When Pro has ended the recording stays on the computer and
// this shows a locked row instead, which opens the Pro screen.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'
import { getDemistNative } from '@/lib/electronNative'
import { useEntitlements } from '@/lib/entitlements'
import { capture } from '@/lib/analytics'
import { PaywallModal } from '@/components/PaywallModal'

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

interface Piece { atMs: number; text: string }

// Cut the transcript at each timeline offset. Points are [audioMs, offset].
export function piecesFrom(transcript: string, timeline: [number, number][]): Piece[] {
  const pts = timeline.filter(([, o]) => o <= transcript.length).sort((a, b) => a[1] - b[1])
  if (!pts.length) return []
  const out: Piece[] = []
  for (let i = 0; i < pts.length; i++) {
    const text = transcript.slice(pts[i][1], i + 1 < pts.length ? pts[i + 1][1] : undefined).trim()
    if (text) out.push({ atMs: pts[i][0], text })
  }
  return out
}

/**
 * Which of these lectures have audio on this computer. Empty outside the
 * desktop app. For the "Listen back" mark on lecture lists: 3 recordings were
 * kept in the first days of listen back and none was played, because the
 * player only appeared inside an opened lecture (2026-11-25).
 */
export function useLectureAudioIds(sessionIds: string[]): Set<string> {
  const [ids, setIds] = useState<Set<string>>(new Set())
  const key = sessionIds.join(',')
  useEffect(() => {
    const store = getDemistNative()?.lectureAudio
    if (!store || !sessionIds.length) return
    let cancelled = false
    createClient().auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id
      if (!uid) return
      const found = await store.list(uid, sessionIds).catch(() => ({}))
      if (!cancelled) setIds(new Set(Object.keys(found)))
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return ids
}

export function ListenBackChip() {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium dark:text-brand-300 text-brand-700 dark:bg-brand-500/10 bg-brand-500/[0.08] border dark:border-brand-500/20 border-brand-600/20 rounded-full px-2 py-px shrink-0">
      <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
      Listen back
    </span>
  )
}

export function ListenBack({ sessionId, transcript }: { sessionId: string; transcript: string | null }) {
  const store = getDemistNative()?.lectureAudio
  const { isPro, loaded } = useEntitlements()
  const [userId, setUserId] = useState<string | null>(null)
  const [info, setInfo] = useState<{ bytes: number; durationMs: number | null } | null>(null)
  const [src, setSrc] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<[number, number][]>([])
  const [marks, setMarks] = useState<number[]>([])
  const [nowMs, setNowMs] = useState(0)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paywall, setPaywall] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const pendingSeek = useRef<number | null>(null)

  useEffect(() => {
    if (!store) return
    let cancelled = false
    createClient().auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id
      if (!uid || cancelled) return
      setUserId(uid)
      const found = await store.list(uid, [sessionId]).catch(() => ({} as Record<string, { bytes: number; durationMs: number | null }>))
      if (!cancelled && found[sessionId]) {
        setInfo(found[sessionId])
        setDurationMs(found[sessionId].durationMs)
      }
    })
    return () => { cancelled = true }
  }, [store, sessionId])

  useEffect(() => () => { if (src) URL.revokeObjectURL(src) }, [src])

  const pieces = useMemo(() => piecesFrom(transcript ?? '', timeline), [transcript, timeline])
  const current = useMemo(() => {
    let idx = -1
    for (let i = 0; i < pieces.length; i++) { if (pieces[i].atMs <= nowMs + 250) idx = i; else break }
    return idx
  }, [pieces, nowMs])

  // Keep the piece being played in view, inside the list only.
  useEffect(() => {
    if (current < 0 || !playing || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-piece="${current}"]`)
    if (!el) return
    const box = listRef.current
    if (el.offsetTop < box.scrollTop || el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: el.offsetTop - box.clientHeight / 3, behavior: 'smooth' })
    }
  }, [current, playing])

  if (!store || !info || !loaded) return null

  const open = async (thenSeekMs?: number) => {
    if (!isPro) { capture('listen_back_locked_clicked', {}); setPaywall(true); return }
    if (src) { if (thenSeekMs != null) seek(thenSeekMs); else void audioRef.current?.play(); return }
    if (!userId) return
    setBusy(true); setError(null)
    try {
      const rec = await store.read(userId, sessionId)
      if (!rec) { setError('This recording could not be found on this computer.'); setInfo(null); return }
      setTimeline(rec.timeline ?? [])
      if (rec.durationMs) setDurationMs(rec.durationMs)
      const sb = createClient()
      sb.from('session_marks').select('at_ms').eq('session_id', sessionId).order('at_ms')
        .then(({ data }) => setMarks((data ?? []).map(m => m.at_ms as number)))
      pendingSeek.current = thenSeekMs ?? 0
      setSrc(URL.createObjectURL(new Blob([rec.audio], { type: 'audio/webm' })))
      capture('listen_back_opened', { mb: Math.round(info.bytes / 1e6), has_timeline: (rec.timeline?.length ?? 0) > 0 })
    } catch (e) {
      console.error('[demist] listen back: could not open the recording', e)
      setError('This recording could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  // MediaRecorder's WebM has no length or seek index; asking for a far-off
  // time makes the player scan the file once, after which seeking works.
  // Measured 2026-11-18: without this, duration is Infinity and nothing seeks.
  const onLoaded = async () => {
    const a = audioRef.current
    if (!a) return
    if (!Number.isFinite(a.duration)) {
      await new Promise<void>((resolve) => {
        const done = () => { a.removeEventListener('durationchange', done); resolve() }
        a.addEventListener('durationchange', done)
        a.currentTime = 1e101
        setTimeout(done, 4000)
      })
    }
    if (Number.isFinite(a.duration)) setDurationMs(a.duration * 1000)
    a.currentTime = (pendingSeek.current ?? 0) / 1000
    pendingSeek.current = null
    void a.play().catch(() => {})
  }

  const seek = (ms: number) => {
    const a = audioRef.current
    if (!a) return
    a.currentTime = Math.max(0, ms - 1500) / 1000   // a moment early, so the start of the sentence is heard
    void a.play().catch(() => {})
  }

  const remove = async () => {
    if (!userId) return
    await store.remove(userId, sessionId).catch(() => {})
    capture('listen_back_deleted', {})
    if (src) URL.revokeObjectURL(src)
    setSrc(null); setInfo(null)
  }

  const total = durationMs ?? info.durationMs

  return (
    <div className="mt-3 rounded-xl border dark:border-white/[0.08] border-black/[0.08] dark:bg-white/[0.03] bg-[#F8F6FB] px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => (src && playing ? audioRef.current?.pause() : open())}
          disabled={busy}
          aria-label={src && playing ? 'Pause' : 'Listen back'}
          className="shrink-0 w-9 h-9 rounded-full bg-brand-600 hover:bg-brand-500 text-white flex items-center justify-center disabled:opacity-50 transition-colors"
        >
          {src && playing
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium dark:text-white/85 text-gray-800 flex items-center gap-2">
            Listen back
            {!isPro && <span className="text-[10px] font-bold tracking-wide uppercase px-1.5 py-0.5 rounded bg-brand-500/15 dark:text-brand-300 text-brand-700">Pro</span>}
          </p>
          {src ? (
            <input
              type="range" min={0} max={Math.max(1, Math.round((total ?? 0) / 1000))} step={1}
              value={Math.round(nowMs / 1000)}
              onChange={(e) => { if (audioRef.current) audioRef.current.currentTime = Number(e.target.value) }}
              aria-label="Position in the lecture"
              className="w-full accent-brand-600 mt-1"
            />
          ) : (
            <p className="text-[12px] text-gray-500">
              {busy ? 'Opening…' : isPro ? 'Tap any part of the transcript to hear it.' : 'Your recording is saved on this computer. Pro plays it back.'}
            </p>
          )}
        </div>
        <span className="shrink-0 text-[12px] tabular-nums text-gray-500">{src ? `${fmt(nowMs)} / ` : ''}{total ? fmt(total) : ''}</span>
      </div>

      {error && <p className="text-[12px] text-red-500 mt-2">{error}</p>}

      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="auto"
          onLoadedMetadata={onLoaded}
          onTimeUpdate={(e) => setNowMs(e.currentTarget.currentTime * 1000)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}

      {src && marks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2.5">
          {marks.map((ms, i) => (
            <button key={i} onClick={() => seek(ms - 20_000)} className="text-[12px] px-2.5 py-1 rounded-full border dark:border-brand-500/30 border-brand-200 dark:text-brand-300 text-brand-700 hover:dark:bg-brand-500/10 hover:bg-brand-50 transition-colors">
              Marked at {fmt(ms)}
            </button>
          ))}
        </div>
      )}

      {src && pieces.length > 0 && (
        <div ref={listRef} className="relative mt-3 max-h-72 overflow-y-auto pr-1 space-y-0.5">
          {pieces.map((p, i) => (
            <button
              key={i}
              data-piece={i}
              onClick={() => seek(p.atMs)}
              className={`block w-full text-left rounded-lg px-2 py-1 text-[13px] leading-relaxed transition-colors ${i === current ? 'dark:bg-brand-500/15 bg-brand-100/70 dark:text-white text-gray-900' : 'dark:text-white/65 text-gray-600 hover:dark:bg-white/[0.05] hover:bg-black/[0.03]'}`}
            >
              <span className="text-[11px] tabular-nums text-gray-500 mr-2">{fmt(p.atMs)}</span>{p.text}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-2.5 text-[11px] text-gray-500">
        <span>Kept on this computer only · {Math.max(1, Math.round(info.bytes / 1e6))} MB</span>
        {confirmDelete ? (
          <span className="flex items-center gap-2">
            Delete the recording?
            <button onClick={remove} className="text-red-500 hover:text-red-400">Delete</button>
            <button onClick={() => setConfirmDelete(false)} className="hover:dark:text-white/80 hover:text-gray-800">Keep</button>
          </span>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="hover:dark:text-white/80 hover:text-gray-800">Delete recording</button>
        )}
      </div>

      {paywall && <PaywallModal source="listen_back" onClose={() => setPaywall(false)} />}
    </div>
  )
}

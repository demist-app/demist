'use client'

// Restored 2026-09: this existed from 2026-06-12 until 2026-07-07, when it
// was removed in the same commit as an unrelated lecturer-consent gate
// during a broader compliance-flow rollback - collateral damage, not a
// decision made on the audio check's own merits. Brought back WITHOUT the
// per-subject acknowledgment step the 2026-07-02 "compliance changes" commit
// had bolted onto it: just the level check.
//
// Real motivation for bringing it back: PostHog data showed roughly a third
// of users who finish onboarding never start a first recording, and the
// getUserMedia failure path (permission denied, no device, device busy) had
// been a silent alert() with no analytics - fixed separately, but that fix
// only shows a good message AFTER the real session has already tried and
// failed to start. This surfaces the same failure earlier and gentler: a
// deliberate, low-stakes moment to grant mic access and see it's working,
// before any session/recording state exists to unwind if it goes wrong.
//
// mic_acknowledgments re-added 2026-09-11, deliberately NOT as a gate this
// time: explicit product decision was Terms of Service covers the legal
// responsibility (see app/terms/page.tsx's "Acceptable use" section - you
// obtaining consent from anyone you record is yours, not Demist's, to get),
// and this only needs to surface a reminder at a sensible moment and leave a
// real record that it was shown, not block anyone. Shown once per subject
// (matches the table's existing (user_id, subject) key from migration 016)
// rather than once per account: getting one lecturer's OK doesn't cover a
// different course with a different lecturer, so re-surfacing per subject is
// the right granularity, not leftover friction.
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase'

type CheckState = 'sampling' | 'good' | 'quiet' | 'error'

interface Props {
  subject: string
  onStart: () => void
  onCancel: () => void
}

const SAMPLE_MS = 3000

export function MicCheck({ subject, onStart, onCancel }: Props) {
  const [checkState, setCheckState] = useState<CheckState>('sampling')
  const [bars, setBars] = useState<number[]>(Array(7).fill(0))
  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  // null while unknown (still checking), then true/false. Starts unknown so
  // the reminder doesn't flash on screen for the common case (already
  // acknowledged this subject) before the check resolves.
  const [needsAck, setNeedsAck] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    createClient()
      .from('mic_acknowledgments')
      .select('user_id')
      .eq('subject', subject || '')
      .maybeSingle()
      .then(({ data, error }) => { if (!cancelled) setNeedsAck(error ? true : !data) })
    return () => { cancelled = true }
  }, [subject])

  const handleStart = () => {
    if (needsAck) {
      // Fire-and-forget: the point is a timestamped record that the
      // reminder was on screen when they proceeded, not a gate blocking
      // recording on a network round trip. onConflict makes a double-click
      // (e.g. Skip check clicked twice) harmless rather than an error.
      const sb = createClient()
      sb.auth.getSession().then(({ data: { session } }) => {
        if (!session?.user) return
        sb.from('mic_acknowledgments')
          .upsert({ user_id: session.user.id, subject: subject || '' }, { onConflict: 'user_id,subject' })
          .then(({ error }) => { if (error) console.error('mic_acknowledgments upsert failed:', error.message) })
      })
    }
    onStart()
  }

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      } catch {
        if (!cancelled) setCheckState('error')
        return
      }
      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }

      streamRef.current = stream
      const ctx = new AudioContext()
      ctxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.7
      src.connect(analyser)

      const data = new Uint8Array(analyser.frequencyBinCount)
      const samples: number[] = []
      const started = Date.now()

      const tick = () => {
        analyser.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        const rms = Math.sqrt(sum / data.length)
        samples.push(rms)

        analyser.getByteFrequencyData(data)
        const step = Math.floor(data.length / 7)
        setBars(Array.from({ length: 7 }, (_, i) => data[i * step] / 255))

        const elapsed = Date.now() - started
        if (elapsed < SAMPLE_MS) {
          rafRef.current = requestAnimationFrame(tick)
        } else {
          const avg = samples.reduce((a, b) => a + b, 0) / samples.length
          if (!cancelled) {
            setCheckState(avg < 0.003 ? 'quiet' : 'good')
          }
          ctx.close()
          stream.getTracks().forEach(t => t.stop())
          ctxRef.current = null
          streamRef.current = null
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    run()

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      ctxRef.current?.close()
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const done = checkState !== 'sampling'

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:px-4 bg-black/30"
      style={{ backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
    >
      <div className="w-full max-w-sm dark:bg-[#0f0f17] bg-[#FDFCF9] border dark:border-white/[0.08] border-black/[0.10] rounded-t-[24px] sm:rounded-[24px] shadow-2xl px-6 py-7 animate-step opacity-0" style={{ animationFillMode: 'forwards' }}>

        <p className="text-[10px] font-bold tracking-[0.18em] uppercase dark:text-amber-400/70 text-amber-700/80 mb-1.5">Mic check</p>
        <p className="text-[18px] font-bold dark:text-white text-gray-900 mb-1">
          {checkState === 'sampling' ? 'Checking your mic…' : checkState === 'good' ? "You're good to go" : checkState === 'quiet' ? 'Mic seems very quiet' : 'Mic access needed'}
        </p>
        <p className="text-[13px] dark:text-white/60 text-gray-600 mb-6 leading-relaxed">
          {checkState === 'sampling' ? 'Make some noise, clap or say something.' : checkState === 'good' ? 'Audio detected. Start recording when ready.' : checkState === 'quiet' ? 'Check your mic settings or move closer. You can still start recording.' : 'Allow microphone access in your browser to use Demist.'}
        </p>

        <div className="flex items-end justify-center gap-1.5 mb-6" style={{ height: '48px' }}>
          {bars.map((level, i) => {
            const height = done
              ? checkState === 'good' ? `${16 + i * 4}px` : '4px'
              : `${4 + level * 44}px`
            const color = done
              ? checkState === 'good'
                ? 'rgb(234, 179, 8)'
                : checkState === 'error'
                  ? 'rgb(239, 68, 68)'
                  : 'rgb(107, 114, 128)'
              : 'rgb(234, 179, 8)'
            return (
              <div
                key={i}
                className="w-[6px] rounded-full transition-all duration-200"
                style={{ height, backgroundColor: color, willChange: 'height' }}
              />
            )
          })}
        </div>

        {done && (
          <div className="flex justify-center mb-5">
            {checkState === 'good' && (
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(52,211,153)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            )}
            {checkState === 'quiet' && (
              <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(245,158,11)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
            )}
            {checkState === 'error' && (
              <div className="w-10 h-10 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgb(239,68,68)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
            )}
          </div>
        )}

        {/* Non-blocking: informational only, never disables either button
            below. Terms of Service (app/terms/page.tsx) covers the actual
            legal responsibility; this is a reminder, not a gate, per
            explicit product direction after the 2026-07-02 version of this
            made it one. Shown once per subject - see the (user_id, subject)
            key on mic_acknowledgments. */}
        {needsAck && (
          <p className="text-[11px] dark:text-white/40 text-gray-500 mb-4 leading-relaxed text-center">
            Remember to get permission from anyone you record, like your lecturer. See our{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 dark:hover:text-white/60 hover:text-gray-700 transition-colors">Terms</a>.
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-2xl dark:bg-white/[0.04] bg-[#F3F1EC] border dark:border-white/[0.07] border-black/[0.12] text-[14px] font-medium dark:text-gray-300 text-gray-700 active:scale-[0.97] transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={checkState === 'error'}
            className="flex-1 py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150 disabled:opacity-40"
          >
            {checkState === 'sampling' ? 'Skip check' : 'Start recording'}
          </button>
        </div>
      </div>
    </div>
  )
}

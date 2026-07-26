'use client'

// web/lib/nativeSession.ts
// Everything the renderer needs to run a fully on-device transcription
// session inside the desktop app, in one self-contained module: AudioWorklet
// PCM capture from an existing MediaStream, downsampling to 16kHz, streaming
// frames over the bridge, and subscribing to ordered transcript segments and
// model-download progress. recordingSession.tsx calls exactly three things:
// startNativeSession, then reads callbacks, then stopNativeSession.

import { getDemistNative, dlog } from '@/lib/electronNative'

const TARGET_RATE = 16000
// How much audio to accumulate before sending one message across the bridge.
// The AudioWorklet hands us a render quantum (128 samples) at a time, which
// at 48kHz is a callback every ~2.7ms: sending each one straight through
// meant ~375 IPC messages per second, every one of them paying a
// structured-clone hop renderer -> main and a second postMessage hop main ->
// worker thread, to carry ~170 bytes of audio. Batching to 100ms cuts that to
// 10 messages per second for exactly the same audio. 100ms is far below any
// latency that matters here (the segmenter's own thresholds are measured in
// seconds) and well under the smallest thing it can detect.
const BATCH_MS = 100

// Returns the downsampled audio plus the number of input samples actually
// consumed. The caller carries the unconsumed tail into the next batch:
// inputRate/TARGET_RATE is rarely an integer multiple of the buffer length,
// so dropping the remainder each time (as this did when it ran per 128-sample
// quantum) silently discarded ~1.6% of every frame and slowly compressed the
// audio timeline.
function downsampleTo16k(
  input: Float32Array,
  inputRate: number,
): { out: Float32Array; consumed: number } {
  // .slice(), not the input itself: callers pass a view into a reused
  // accumulation buffer, and `out.buffer` is what gets handed to the bridge.
  if (inputRate === TARGET_RATE) return { out: input.slice(), consumed: input.length }
  const ratio = inputRate / TARGET_RATE
  const outLength = Math.floor(input.length / ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    // Average over the source window: cheap anti-aliasing that's adequate
    // for speech (we only need intelligibility, not fidelity).
    const start = Math.floor(i * ratio)
    const end = Math.min(Math.floor((i + 1) * ratio), input.length)
    let sum = 0
    for (let j = start; j < end; j++) sum += input[j]
    out[i] = end > start ? sum / (end - start) : 0
  }
  return { out, consumed: Math.floor(outLength * ratio) }
}

export interface NativeSessionCallbacks {
  onTranscript: (text: string) => void
  // Best-effort live preview of a segment that hasn't closed yet (see
  // desktop/native/pcm-segmenter.js's INTERIM_INTERVAL_MS comment): can be
  // flat-out wrong near the end, not just incomplete, and is always
  // followed by an onTranscript call for the same segment once it actually
  // closes. Callers should show it as provisional and replace it, not
  // append to it, when the real onTranscript for that segment arrives.
  onInterimTranscript?: (text: string) => void
  onModelProgress?: (label: string, pct: number) => void
  onError?: (message: string) => void
  // Checked after the backend session call resolves but BEFORE any audio
  // graph is attached. startSession() can block for a long time when the
  // native worker is busy loading models, and the caller may have given up
  // and started a different recording in the meantime. Without this hook the
  // abandoned call would still wake up and attach a second capture graph on
  // its own (stale) MediaStream: confirmed in a real session, where two
  // graphs ran concurrently and fed the SAME native session two interleaved
  // PCM streams - one silent, one real - shredding the audio and producing
  // fragments like "Shh!" and "Hmm" between correctly transcribed sentences.
  isStale?: () => boolean
}

export interface NativeSessionHandle {
  stop: () => Promise<void>
  // Rebuilds the browser-side capture graph (AudioContext/worklet) on a
  // replacement MediaStream without touching the backend session: used when
  // the mic track dies and reconnects mid-recording (see recoverMicStream in
  // recordingSession.tsx). The original implementation captured `stream` by
  // closure with no way to swap it, so a mic reconnect silently left the
  // worklet listening on the dead track forever, transcription went dark for
  // the rest of the session but recoverMicStream reported success because it
  // only ever touched the (separate) visualizer/gain graph.
  rebindStream: (stream: MediaStream) => Promise<void>
}

export async function startNativeSession(
  stream: MediaStream,
  callbacks: NativeSessionCallbacks,
): Promise<NativeSessionHandle> {
  dlog('[demist] startNativeSession: starting')
  const native = getDemistNative()
  if (!native) throw new Error('startNativeSession called outside the desktop app')

  const unsubscribe = native.onEvent((msg) => {
    dlog('[demist] native event:', msg.event, msg.payload)
    if (msg.event === 'transcript') {
      if (msg.payload.text) callbacks.onTranscript(msg.payload.text)
    } else if (msg.event === 'interimTranscript') {
      if (msg.payload.text) callbacks.onInterimTranscript?.(msg.payload.text)
    } else if (msg.event === 'modelProgress') {
      if (msg.payload.label !== undefined && msg.payload.pct !== undefined) {
        callbacks.onModelProgress?.(msg.payload.label, msg.payload.pct)
      }
    } else if (msg.event === 'sessionLost') {
      callbacks.onError?.(msg.payload.message ?? 'On-device transcription stopped unexpectedly.')
    }
  })

  await native.startSession()
  if (callbacks.isStale?.()) {
    // Give the backend session back rather than leaving it running: another
    // startNativeSession has taken over, and stopSession() here would race
    // with theirs. Only unsubscribe, so this abandoned call stops delivering
    // duplicate transcript events to a caller that has moved on.
    console.warn('[demist] startNativeSession: recording moved on while startSession was pending; abandoning this attempt')
    unsubscribe()
    throw new Error('Recording was restarted before on-device transcription finished starting.')
  }
  dlog('[demist] startNativeSession: backend session started, attaching audio graph next')

  let audioContext: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let worklet: AudioWorkletNode | null = null
  let silent: GainNode | null = null

  const teardownGraph = async () => {
    if (worklet) worklet.port.onmessage = null
    source?.disconnect()
    worklet?.disconnect()
    silent?.disconnect()
    const ctx = audioContext
    audioContext = null; source = null; worklet = null; silent = null
    await ctx?.close().catch(() => {})
  }

  // Diagnostic only: logs a running frame count and the loudest sample seen
  // once a second, so DevTools shows whether real audio is actually reaching
  // the worklet at all, and roughly how loud it is, without needing a
  // terminal (desktop/native/*.js's own console output goes to the main
  // process's stdout, invisible unless launched from a terminal - this is
  // the renderer-side equivalent, visible in the app's own DevTools).
  let frameCount = 0
  let peakSinceLastLog = 0
  let lastLogAt = 0

  const attachGraph = async (mediaStream: MediaStream) => {
    audioContext = new AudioContext()
    // This is a SECOND AudioContext, separate from the visualizer/gain one
    // startRecording creates: that one is created and resumed synchronously
    // inside the click gesture, but this one is created several awaits later
    // (recording-limit check, getUserMedia, the sessions insert, wake lock),
    // by which point the gesture is long consumed. A context created in that
    // state can start "suspended", and a suspended context never runs its
    // worklet's process() at all - no PCM is ever emitted, no frames are
    // logged below, and capture is silently dead end to end while everything
    // upstream reports success. resume() is a no-op when it is already
    // running, so this only ever helps. rebindStream re-enters here on a mic
    // reconnect and needs the same treatment.
    await audioContext.resume().catch(() => {})
    dlog('[demist] attachGraph: AudioContext sampleRate =', audioContext.sampleRate, 'state =', audioContext.state)
    if (audioContext.state !== 'running') {
      console.error('[demist] attachGraph: AudioContext is not running (state:', audioContext.state + '). No PCM will be captured.')
      callbacks.onError?.(`Audio capture could not start (audio context ${audioContext.state}).`)
    }
    await audioContext.audioWorklet.addModule('/pcm-worklet.js')
    dlog('[demist] attachGraph: pcm-worklet.js module loaded')
    // Which device we actually ended up capturing from. getUserMedia happily
    // returns a live, unmuted track that emits nothing but digital silence
    // when the selected device is a disconnected mic, a loopback/"Stereo Mix"
    // input with nothing playing, or one Windows has blocked at the OS
    // privacy level. Nothing downstream can tell that apart from a quiet
    // room, so the device identity has to be logged here.
    const track = mediaStream.getAudioTracks()[0]
    dlog('[demist] attachGraph: capturing from', JSON.stringify({
      label: track?.label,
      enabled: track?.enabled,
      muted: track?.muted,
      readyState: track?.readyState,
      deviceId: track?.getSettings?.().deviceId,
    }))
    if (track?.muted) {
      callbacks.onError?.(`Microphone "${track.label || 'unknown'}" is muted at the system level. Unmute it, or pick a different microphone in Profile.`)
    }

    source = audioContext.createMediaStreamSource(mediaStream)
    worklet = new AudioWorkletNode(audioContext, 'pcm-capture')
    const inputRate = audioContext.sampleRate

    // Silence watchdog. A working microphone always has a noise floor: even a
    // silent room reads ~0.001-0.005. A sustained EXACT zero means the device
    // is not really producing audio, which previously surfaced only as a
    // transcript that stayed empty forever with everything else reporting
    // success. Reported once per graph, and reset on rebindStream.
    const graphStartedAt = Date.now()
    let peakEver = 0
    let silenceReported = false

    // Raw input-rate audio waiting to be downsampled and sent (see BATCH_MS).
    // One reused buffer with a write offset rather than concatenating a new
    // array per quantum: concatenation would allocate ~37 progressively larger
    // arrays per batch (megabytes of garbage per second) to save 375 small
    // ones, which is the wrong trade. Sized with headroom for one oversized
    // quantum plus the few samples of remainder carried between batches.
    const batchTarget = Math.round((inputRate * BATCH_MS) / 1000)
    const batch = new Float32Array(batchTarget + 4096)
    let filled = 0

    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
      try {
        frameCount++
        for (let i = 0; i < e.data.length; i++) {
          const abs = Math.abs(e.data[i])
          if (abs > peakSinceLastLog) peakSinceLastLog = abs
        }
        if (peakSinceLastLog > peakEver) peakEver = peakSinceLastLog
        if (!silenceReported && peakEver === 0 && Date.now() - graphStartedAt > 5000) {
          silenceReported = true
          const name = track?.label || 'the selected microphone'
          console.error(`[demist] no audio at all from "${name}" after 5s (every sample exactly 0)`)
          callbacks.onError?.(
            `No audio is reaching Demist from "${name}". It is connected but sending silence: check Windows mic privacy settings, that the right input is selected in Profile, and that the device is not muted.`,
          )
        }
        const now = Date.now()
        if (now - lastLogAt >= 1000) {
          dlog(`[demist] pcm frames: ${frameCount} total, peak level since last log: ${peakSinceLastLog.toFixed(4)} (quiet room/silence is usually < 0.01; speaking should be well above that)`)
          lastLogAt = now
          peakSinceLastLog = 0
        }

        // Defensive: a quantum larger than the headroom would overflow the
        // buffer. Drop the backlog rather than throw, so capture continues.
        if (filled + e.data.length > batch.length) filled = 0
        batch.set(e.data, filled)
        filled += e.data.length
        if (filled < batchTarget) return

        const { out, consumed } = downsampleTo16k(batch.subarray(0, filled), inputRate)
        batch.copyWithin(0, consumed, filled)
        filled -= consumed
        // Transfer the underlying buffer: zero-copy across the bridge. Always a
        // plain ArrayBuffer at runtime (freshly allocated by downsampleTo16k, or
        // the worklet's own non-shared Float32Array); the cast just narrows past
        // TypedArray.buffer's overly-wide ArrayBufferLike type.
        native.sendPcm(out.buffer as ArrayBuffer)
      } catch (err) {
        console.error('[demist] pcm-worklet onmessage error:', err)
        callbacks.onError?.(String((err as Error)?.message ?? err))
      }
    }

    source.connect(worklet)
    // Worklets need a destination connection in some Chrome versions to keep
    // processing; route through a zero-gain node so nothing is audible.
    silent = audioContext.createGain()
    silent.gain.value = 0
    worklet.connect(silent)
    silent.connect(audioContext.destination)
  }

  await attachGraph(stream)
  dlog('[demist] startNativeSession: audio graph attached, streaming should be live now')

  let stopped = false
  return {
    stop: async () => {
      if (stopped) return
      stopped = true
      await teardownGraph()
      await native.stopSession() // flushes the segmenter; final words arrive via onEvent first
      unsubscribe()
    },
    rebindStream: async (newStream: MediaStream) => {
      if (stopped) return
      await teardownGraph()
      await attachGraph(newStream)
    },
  }
}

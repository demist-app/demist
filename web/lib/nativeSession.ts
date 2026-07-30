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

// Health report posted by the worklet itself (see public/pcm-worklet.js),
// distinguishable from an audio frame because it is a plain object.
interface PcmWorkletStats {
  pcmWorkletStats: true
  callsPerSecond: number
  postedPerSecond: number
  emptyInputs: number
}

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
  // Fired once the native backend is genuinely ready and any audio captured
  // while it was still loading has been flushed to it. Between startRecording
  // and this call, audio is being captured and buffered but not yet
  // transcribed, so the UI can say so instead of showing an empty transcript
  // that looks broken.
  onReady?: () => void
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

// The audio graph the caller has ALREADY built for its visualizer/gain chain.
// Supplying this makes capture share that one AudioContext and that one
// MediaStreamAudioSourceNode instead of standing up a second context.
//
// A second AudioContext was the original design and it is what broke capture.
// Two contexts each pulling the same microphone compete, and the loser is
// starved: measured at the main-process bridge, the renderer was delivering
// 0.1 PCM frames per second against an expected 10, with nothing dropped
// anywhere downstream - 1% of the audio ever left the renderer. The worklet's
// own health report never arrived either, which means its process() was not
// being called at all: that graph was simply not being rendered.
//
// Chrome allows only one MediaStreamAudioSourceNode per stream per context,
// which is why this takes the caller's existing node and branches off it (the
// visualizer analyser is already branched off the same node) rather than
// making another one.
export interface SharedAudioGraph {
  context: AudioContext
  source: MediaStreamAudioSourceNode
}

export async function startNativeSession(
  stream: MediaStream,
  callbacks: NativeSessionCallbacks,
  shared?: SharedAudioGraph | null,
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
    } else if (msg.event === 'diag') {
      // Native-side timing from the transcribe worker. Always printed: it is
      // low volume (a few lines per recording) and it is the only view into
      // why a session takes a long time to start without a terminal.
      //
      // This used to go through dlog, which contradicted the comment above and
      // silenced the one channel built specifically to answer "why did this
      // take 70 seconds" from DevTools alone. A real report of a 72826 ms
      // session start arrived with no native timing whatsoever, because these
      // lines - "startSession: entered (worker has transcriber cached: true)",
      // "transcriber ready after 0 ms" - were being dropped here. They are the
      // difference between "the model was not loaded" and "the worker was
      // busy", which are opposite problems with opposite fixes.
      //
      // Verbose ones are the exception. The per-5-second bridge and worker
      // reports, and the per-segment timings, were built to hunt a specific
      // bug and they emit 3-4 lines every five seconds - about 2500 lines an
      // hour, which is not "low volume" and buries the lifecycle lines above
      // that this branch exists for. Those go through dlog, so they are still
      // one localStorage flag away (demist_debug = '1') without shipping a
      // flooded console to every user.
      if (msg.payload.verbose) dlog('[demist][native]', msg.payload.message)
      else console.info('[demist][native]', msg.payload.message)
    } else if (msg.event === 'sessionLost') {
      callbacks.onError?.(msg.payload.message ?? 'On-device transcription stopped unexpectedly.')
    }
  })

  // Kick the backend session off but do NOT wait for it before capturing.
  // startSession can take a while when the model still has to load, and until
  // this resolved the audio graph did not exist at all, so everything said in
  // that window was gone for good - the user saw a running timer, an empty
  // transcript, and lost the opening of their lecture. Now capture begins
  // immediately and PCM is held in `pendingPcm` until the backend is ready,
  // then flushed in order. Nothing is dropped and the transcript catches up.
  const startedAt = Date.now()
  const sessionStarted = native.startSession()

  let sessionReady = false
  let pendingPcm: ArrayBuffer[] = []
  let pendingSamples = 0
  // ~2 minutes of 16kHz mono float32 (~7.7MB). A bound is needed because this
  // grows while the backend is unavailable; past it, drop the OLDEST audio,
  // since if we are this far behind the recent speech is the salvageable part.
  const MAX_PENDING_SAMPLES = TARGET_RATE * 120

  // Per-hop counters. "renderer sent N batches" used to be incremented before
  // this function ran, so it counted batches PRODUCED and said nothing about
  // whether any of them left the renderer - a batch that was buffered, or that
  // threw on the way out, looked identical to one delivered. That is the gap
  // that let a 1% delivery rate sit unexplained: capture measured perfect at
  // 375/375 frames while main received 0.1/sec, with nothing in between
  // reporting which of the two it was.
  // Sequence number on every PCM message. Counters at each end can only say
  // how many arrived; they cannot say whether the missing ones were never
  // sent or were sent and lost. A monotonic seq lets main compare what it
  // received against the highest number it has seen, which answers that
  // outright - and that distinction is the entire remaining question.
  let pcmSeq = 0
  let batchesDelivered = 0
  let batchesBuffered = 0
  let batchesFlushed = 0
  let sendFailures = 0
  let lastSendError = ''

  const sendOrBuffer = (buf: ArrayBuffer) => {
    if (sessionReady) {
      try { native.sendPcm(buf, ++pcmSeq); batchesDelivered++ } catch (err) {
        sendFailures++
        lastSendError = String((err as Error)?.message ?? err)
        if (sendFailures <= 3) console.error('[demist] sendPcm threw, this audio is lost:', err)
      }
      return
    }
    batchesBuffered++
    pendingPcm.push(buf)
    pendingSamples += buf.byteLength / 4
    while (pendingSamples > MAX_PENDING_SAMPLES && pendingPcm.length > 1) {
      const dropped = pendingPcm.shift()!
      pendingSamples -= dropped.byteLength / 4
    }
  }

  let audioContext: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let worklet: AudioWorkletNode | null = null
  let silent: GainNode | null = null
  // Our own clone of the mic stream (see attachGraph). Must be stopped
  // explicitly: clone() produces INDEPENDENT tracks, so stopping the caller's
  // stream does not stop these, and leaving them live holds the microphone
  // open after the recording ends.
  let capturedStream: MediaStream | null = null

  // True when the AudioContext belongs to the caller (see SharedAudioGraph):
  // we must disconnect our own nodes from it but must NOT close it, or the
  // visualizer and gain chain die with the capture graph.
  let ownsContext = true
  // Set once the capture watchdog below exists; teardown may run before then.
  let stopWatchdogRef: (() => void) | null = null
  // Set by wireWorklet once the context's real sample rate is known.
  let expectedFramesPerSec = 0

  const teardownGraph = async () => {
    clearInterval(rendererLoopProbe)
    stopWatchdogRef?.()
    if (worklet) worklet.port.onmessage = null
    // Only disconnect the worklet from the shared source, never the source
    // itself - the caller's analyser and gain chain are branched off it.
    if (source && worklet) { try { source.disconnect(worklet) } catch { /* already gone */ } }
    if (ownsContext) source?.disconnect()
    worklet?.disconnect()
    silent?.disconnect()
    capturedStream?.getTracks().forEach(t => t.stop())
    const ctx = audioContext
    audioContext = null; source = null; worklet = null; silent = null; capturedStream = null
    if (ownsContext) await ctx?.close().catch(() => {})
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
  // Event-loop lag for the renderer's JS thread. The worklet runs on the audio
  // thread and reports its own health, so capture can measure 375/375 while
  // the thread that must batch and forward those frames is stalled. sendPcm is
  // called from THIS thread, so its lag is part of the delivery path.
  let rendererLoopWorst = 0
  let rendererLoopLast = Date.now()
  const rendererLoopProbe = setInterval(() => {
    const now = Date.now()
    const late = now - rendererLoopLast - 100
    if (late > rendererLoopWorst) rendererLoopWorst = late
    rendererLoopLast = now
  }, 100)

  // Everything that turns a constructed AudioWorkletNode into a working PCM
  // feed: health reporting, the silence watchdog, batching and downsampling.
  // Shared by both the private-context and shared-context paths so they can
  // never drift apart.
  const wireWorklet = (inputRate: number, track: MediaStreamTrack | undefined) => {
    const node = worklet
    if (!node) return
    expectedFramesPerSec = inputRate / 128
    if (track?.muted) {
      callbacks.onError?.(`Microphone "${track.label || 'unknown'}" is muted at the system level. Unmute it, or pick a different microphone in Profile.`)
    }
    // Silence watchdog. A working microphone always has a noise floor: even a
    // silent room reads ~0.001-0.005. A sustained EXACT zero means the device
    // is not really producing audio, which previously surfaced only as a
    // transcript that stayed empty forever with everything else reporting
    // success. Reported once per graph, and reset on rebindStream.
    // Counted so the worklet's frame rate can be compared against what
    // actually leaves the renderer: 375 frames/sec arriving here but only
    // ~0.36 messages/sec reaching the native worker means the loss is in the
    // bridge, not in capture.
    let batchesSent = 0
    let samplesSent = 0
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

    node.port.onmessage = (e: MessageEvent<Float32Array | PcmWorkletStats>) => {
      try {
        // Periodic health report from the audio thread rather than audio.
        // Always logged: it is one line every 5 seconds, and it is the only
        // way to tell a graph that is not being pulled from a source node
        // that is connected but silent.
        if (!(e.data instanceof Float32Array) && (e.data as PcmWorkletStats)?.pcmWorkletStats) {
          const s = e.data as PcmWorkletStats
          const expected = Math.round(inputRate / 128)
          const line =
            `[demist] audio worklet: ${s.callsPerSecond.toFixed(0)} process calls/sec ` +
            `(expect ~${expected}), ${s.postedPerSecond.toFixed(0)} frames/sec delivered, ` +
            `${s.emptyInputs} with no input | renderer produced ${batchesSent} batches ` +
            `(${(samplesSent / TARGET_RATE).toFixed(1)}s of audio): ` +
            `${batchesDelivered} DELIVERED to main, ${batchesBuffered} buffered (session ` +
            `${sessionReady ? 'ready' : 'NOT ready'}), ${sendFailures} failed` +
            `${lastSendError ? ` [${lastSendError}]` : ''}` +
            `${batchesFlushed ? `, ${batchesFlushed} flushed from the backlog` : ''}` +
            `, ${pendingPcm.length} still queued` +
            ` | renderer event-loop worst stall ${rendererLoopWorst}ms` +
            `${rendererLoopWorst > 1000 ? ' <- THE RENDERER JS THREAD WAS BLOCKED' : ''}`
          // Always reported when capture is running below half rate, gated
          // otherwise. This exact signature - the worklet delivering a small
          // fraction of the expected frames while everything else reports
          // success - has now gone undiagnosed twice, because the one line
          // that identifies it was behind a debug flag nobody had set. It is
          // one line per five seconds; a broken capture pipeline is worth it.
          if (s.postedPerSecond < expected * 0.5) {
            console.warn(
              `${line}\n[demist] capture is running at ${(100 * s.postedPerSecond / expected).toFixed(0)}% of the expected frame rate - ` +
              `audio is being lost before it reaches transcription.`,
            )
          } else {
            console.info(line)
          }
          batchesSent = 0
          samplesSent = 0
          batchesDelivered = 0
          batchesBuffered = 0
          batchesFlushed = 0
          rendererLoopWorst = 0
          return
        }
        const data = e.data as Float32Array
        frameCount++
        for (let i = 0; i < data.length; i++) {
          const abs = Math.abs(data[i])
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
        if (filled + data.length > batch.length) filled = 0
        batch.set(data, filled)
        filled += data.length
        if (filled < batchTarget) return

        const { out, consumed } = downsampleTo16k(batch.subarray(0, filled), inputRate)
        batch.copyWithin(0, consumed, filled)
        filled -= consumed
        // Transfer the underlying buffer: zero-copy across the bridge. Always a
        // plain ArrayBuffer at runtime (freshly allocated by downsampleTo16k, or
        // the worklet's own non-shared Float32Array); the cast just narrows past
        // TypedArray.buffer's overly-wide ArrayBufferLike type.
        batchesSent++
        samplesSent += out.length
        sendOrBuffer(out.buffer as ArrayBuffer)
      } catch (err) {
        console.error('[demist] pcm-worklet onmessage error:', err)
        callbacks.onError?.(String((err as Error)?.message ?? err))
      }
    }
  }

  const attachGraph = async (mediaStream: MediaStream, sharedGraph?: SharedAudioGraph | null) => {
    if (sharedGraph) {
      ownsContext = false
      audioContext = sharedGraph.context
      source = sharedGraph.source
      await audioContext.resume().catch(() => {})
      console.info('[demist] capture graph: SHARING the caller AudioContext, sampleRate =', audioContext.sampleRate, 'state =', audioContext.state)
      await audioContext.audioWorklet.addModule('/pcm-worklet.js')
      worklet = new AudioWorkletNode(audioContext, 'pcm-capture')
      wireWorklet(audioContext.sampleRate, mediaStream.getAudioTracks()[0])
      source.connect(worklet)
      // The worklet STILL needs its own path to a destination, even though the
      // context is already rendering for the caller's chain. A branch that
      // terminates nowhere is not guaranteed to be pulled, and the private
      // path below has always carried this hop for exactly that reason. The
      // first version of this shared path omitted it on the reasoning that the
      // caller's graph was already being pulled - that was wrong, and capture
      // stayed at 0.1 frames/sec. Zero gain, so nothing is audible.
      silent = audioContext.createGain()
      silent.gain.value = 0
      worklet.connect(silent)
      silent.connect(audioContext.destination)
      return
    }
    ownsContext = true
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
    console.info('[demist] capture graph: OWN AudioContext, sampleRate =', audioContext.sampleRate, 'state =', audioContext.state)
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
    console.info('[demist] capturing from', JSON.stringify({
      label: track?.label,
      enabled: track?.enabled,
      muted: track?.muted,
      readyState: track?.readyState,
      deviceId: track?.getSettings?.().deviceId,
    }))
    if (track?.muted) {
      callbacks.onError?.(`Microphone "${track.label || 'unknown'}" is muted at the system level. Unmute it, or pick a different microphone in Profile.`)
    }

    // Capture from our OWN CLONE of the stream, never the caller's, when we
    // are running a private context (the shared path branches off the caller's
    // existing source node instead).
    capturedStream = mediaStream.clone()
    source = audioContext.createMediaStreamSource(capturedStream)
    worklet = new AudioWorkletNode(audioContext, 'pcm-capture')
    wireWorklet(audioContext.sampleRate, mediaStream.getAudioTracks()[0])
    source.connect(worklet)
    // Worklets need a destination connection in some Chrome versions to keep
    // processing; route through a zero-gain node so nothing is audible.
    silent = audioContext.createGain()
    silent.gain.value = 0
    worklet.connect(silent)
    silent.connect(audioContext.destination)
  }

  // Capture first, THEN wait for the backend. Audio recorded in between is
  // buffered by sendOrBuffer and flushed below.
  await attachGraph(stream, shared)

  // Capture watchdog, driven by a plain timer rather than by the worklet.
  //
  // Every other capture check lives inside worklet.port.onmessage, so all of
  // them go silent in the one case that matters most: process() not being
  // called at all. That is exactly what happened - the renderer delivered 0.1
  // PCM frames/sec against an expected 10, and not one warning fired anywhere,
  // because the code that would have warned only runs when a frame arrives.
  // A timer cannot be starved by the audio graph and so cannot miss it.
  //
  // Checks the RATE, not merely whether anything arrived. The first version
  // only tripped on zero frames, and the real failure delivers a trickle -
  // enough to keep the watchdog quiet while the renderer sent 1% of the audio.
  // A check that only catches total silence misses the bug it was written for.
  let lastWatchdogFrames = frameCount
  let lastWatchdogAt = Date.now()
  let starvedReports = 0
  const captureWatchdog = setInterval(() => {
    const now = Date.now()
    const secs = Math.max(0.001, (now - lastWatchdogAt) / 1000)
    const perSec = (frameCount - lastWatchdogFrames) / secs
    lastWatchdogFrames = frameCount
    lastWatchdogAt = now
    const expected = expectedFramesPerSec || 375
    if (perSec >= expected * 0.1) return
    if (++starvedReports > 3) return // said it enough; keep the log readable
    console.error(
      `[demist] audio capture is starved: the worklet delivered ${perSec.toFixed(1)} frames/sec, ` +
      `expected ~${Math.round(expected)}. The audio graph is barely being rendered, so almost no ` +
      'audio is reaching transcription.',
    )
    callbacks.onError?.('Audio capture is barely running, so transcription will lag badly. Stop and restart the recording; if it persists, restart Demist.')
  }, 5000)
  stopWatchdogRef = () => clearInterval(captureWatchdog)
  dlog('[demist] startNativeSession: capturing; waiting for the on-device model to be ready')

  // Say so if the backend is taking an unreasonable time. Without this the
  // UI shows "preparing... will appear shortly" indefinitely, which is what a
  // startSession that never resolves looked like for a whole recording.
  //
  // "Unreasonable" was 10 seconds, and it was wrong in the one case that
  // matters most: the FIRST recording on a machine, where startSession
  // legitimately pays the model load plus the warm-up. Measured on a clean
  // profile against the shipping build, that is 4.6-11s routinely - so a first
  // run reliably produced "The on-device transcription engine hasn't responded
  // in 11s", which reads as a malfunction while the app is doing exactly what
  // it is supposed to. It also contradicted main.js, which does not consider a
  // startSession late until 120s.
  //
  // Two stages now. Up to a minute the app says what is true and calm - it is
  // still preparing, and nothing said is being lost - and only past that does
  // it suggest something is actually wrong.
  const FIRST_NOTICE_MS = 25_000
  let noticeAt = FIRST_NOTICE_MS
  const stillWaiting = setInterval(() => {
    const waited = Math.round((Date.now() - startedAt) / 1000)
    if (waited * 1000 < noticeAt) return
    noticeAt += 20_000
    console.warn(`[demist] still waiting for the on-device transcription engine after ${waited}s`)
    callbacks.onError?.(waited < 60
      ? `Still preparing on-device transcription (${waited}s). Your audio is being recorded and will appear once it is ready.`
      : `The on-device transcription engine hasn't responded in ${waited}s. Your audio is still being recorded and will be transcribed if it comes back.`)
  }, 5_000)

  try {
    await sessionStarted
  } catch (err) {
    clearInterval(stillWaiting)
    await teardownGraph()
    unsubscribe()
    throw err
  } finally {
    clearInterval(stillWaiting)
  }

  if (callbacks.isStale?.()) {
    // Another startNativeSession has taken over. Tear down the graph this
    // call attached and stop delivering transcript events, so an abandoned
    // attempt can never become a second live capture pipeline feeding the
    // same native session (which shredded the audio when it happened).
    console.warn('[demist] startNativeSession: recording moved on while startSession was pending; abandoning this attempt. Its capture graph is being torn down; if audio keeps flowing after this line, TWO graphs are running.')
    await teardownGraph()
    unsubscribe()
    throw new Error('Recording was restarted before on-device transcription finished starting.')
  }

  // Backend is ready: release everything captured while it was loading, in
  // order, then switch to streaming straight through.
  sessionReady = true
  console.info(`[demist] native session READY after ${Date.now() - startedAt} ms; PCM now streams straight through (${pendingPcm.length} batches were buffered while waiting)`)
  // Kept always-on but only when it is actually slow. A fast start is not
  // worth a line; a slow one is the single most useful number for diagnosing
  // "nothing is happening", and it splits that into "the worker could not
  // accept the session" versus "the delay is downstream".
  const readyMs = Date.now() - startedAt
  if (readyMs > 3000) console.warn(`[demist] on-device session took ${readyMs} ms to start`)
  else dlog(`[demist] on-device session ready in ${readyMs} ms`)
  if (pendingPcm.length) {
    dlog(`[demist] startNativeSession: flushing ${(pendingSamples / TARGET_RATE).toFixed(1)}s of audio buffered while the model loaded`)
    for (const buf of pendingPcm) {
      try { native.sendPcm(buf, ++pcmSeq); batchesFlushed++ } catch (err) {
        sendFailures++
        lastSendError = String((err as Error)?.message ?? err)
      }
    }
  }
  pendingPcm = []
  pendingSamples = 0
  callbacks.onReady?.()
  dlog('[demist] startNativeSession: audio graph attached, streaming should be live now')

  let stopped = false
  return {
    stop: async () => {
      if (stopped) return
      stopped = true
      try {
        await teardownGraph()
        // Flushes the segmenter; final words arrive via onEvent first, which
        // is why the unsubscribe below cannot simply be moved above this.
        await native.stopSession()
      } finally {
        // MUST run even if stopSession rejects or times out. It used to sit
        // after that await unguarded, so a failing stop leaked this listener:
        // the next recording added a second one and every transcript was
        // then delivered twice, producing visibly duplicated lines in the
        // transcript from the second session onwards.
        unsubscribe()
      }
    },
    rebindStream: async (newStream: MediaStream) => {
      if (stopped) return
      await teardownGraph()
      await attachGraph(newStream)
    },
  }
}

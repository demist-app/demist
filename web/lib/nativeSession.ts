'use client'

// web/lib/nativeSession.ts
// Everything the renderer needs to run a fully on-device transcription
// session inside the desktop app, in one self-contained module: AudioWorklet
// PCM capture from an existing MediaStream, downsampling to 16kHz, streaming
// frames over the bridge, and subscribing to ordered transcript segments and
// model-download progress. recordingSession.tsx calls exactly three things:
// startNativeSession, then reads callbacks, then stopNativeSession.

import { getDemistNative } from '@/lib/electronNative'

const TARGET_RATE = 16000

function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_RATE) return input
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
  return out
}

export interface NativeSessionCallbacks {
  onTranscript: (text: string) => void
  onModelProgress?: (label: string, pct: number) => void
  onError?: (message: string) => void
}

export interface NativeSessionHandle {
  stop: () => Promise<void>
}

export async function startNativeSession(
  stream: MediaStream,
  callbacks: NativeSessionCallbacks,
): Promise<NativeSessionHandle> {
  const native = getDemistNative()
  if (!native) throw new Error('startNativeSession called outside the desktop app')

  const unsubscribe = native.onEvent((msg) => {
    if (msg.event === 'transcript') {
      if (msg.payload.text) callbacks.onTranscript(msg.payload.text)
    } else if (msg.event === 'modelProgress') {
      if (msg.payload.label !== undefined && msg.payload.pct !== undefined) {
        callbacks.onModelProgress?.(msg.payload.label, msg.payload.pct)
      }
    }
  })

  await native.startSession()

  const audioContext = new AudioContext()
  await audioContext.audioWorklet.addModule('/pcm-worklet.js')
  const source = audioContext.createMediaStreamSource(stream)
  const worklet = new AudioWorkletNode(audioContext, 'pcm-capture')
  const inputRate = audioContext.sampleRate

  worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
    try {
      const pcm16k = downsampleTo16k(e.data, inputRate)
      // Transfer the underlying buffer: zero-copy across the bridge. Always a
      // plain ArrayBuffer at runtime (freshly allocated by downsampleTo16k, or
      // the worklet's own non-shared Float32Array); the cast just narrows past
      // TypedArray.buffer's overly-wide ArrayBufferLike type.
      native.sendPcm(pcm16k.buffer as ArrayBuffer)
    } catch (err) {
      callbacks.onError?.(String((err as Error)?.message ?? err))
    }
  }

  source.connect(worklet)
  // Worklets need a destination connection in some Chrome versions to keep
  // processing; route through a zero-gain node so nothing is audible.
  const silent = audioContext.createGain()
  silent.gain.value = 0
  worklet.connect(silent)
  silent.connect(audioContext.destination)

  let stopped = false
  return {
    stop: async () => {
      if (stopped) return
      stopped = true
      worklet.port.onmessage = null
      source.disconnect()
      worklet.disconnect()
      silent.disconnect()
      await audioContext.close().catch(() => {})
      await native.stopSession() // flushes the segmenter; final words arrive via onEvent first
      unsubscribe()
    },
  }
}

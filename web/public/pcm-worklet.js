// web/public/pcm-worklet.js
// AudioWorkletProcessor that forwards raw mono PCM frames to the main JS
// thread. Served as a static file from /public so it loads under the site's
// existing CSP (worker-src 'self') with no policy changes. Downsampling to
// 16kHz happens on the JS side (nativeSession.ts), not here: worklets run at
// the AudioContext's native rate.

const STATS_INTERVAL_S = 5

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    // Diagnostics for a confirmed real failure: a session measured only 1.0s
    // of audio reaching the native transcriber over 34.2s of wall clock - ~3%
    // of real time, which starves transcription completely and looks exactly
    // like "transcription is slow". Working back from that rate, process()
    // was effectively producing ~11 frames per second where a 48kHz context
    // should produce ~375. Only this processor can tell the two possible
    // causes apart: process() not being called at all (the graph is not being
    // pulled), versus process() running normally but handed an input with no
    // channels (the source node is connected but delivering nothing).
    this.calls = 0
    this.emptyInputs = 0
    this.posted = 0
    this.lastReport = currentTime
  }

  process(inputs) {
    this.calls++
    const channel = inputs[0]?.[0]
    if (channel && channel.length > 0) {
      // Copy: the input buffer is reused by the audio engine after return.
      this.port.postMessage(channel.slice())
      this.posted++
    } else {
      this.emptyInputs++
    }

    const elapsed = currentTime - this.lastReport
    if (elapsed >= STATS_INTERVAL_S) {
      this.port.postMessage({
        pcmWorkletStats: true,
        callsPerSecond: this.calls / elapsed,
        postedPerSecond: this.posted / elapsed,
        emptyInputs: this.emptyInputs,
      })
      this.calls = 0
      this.emptyInputs = 0
      this.posted = 0
      this.lastReport = currentTime
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)

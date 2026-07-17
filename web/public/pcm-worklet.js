// web/public/pcm-worklet.js
// AudioWorkletProcessor that forwards raw mono PCM frames to the main JS
// thread. Served as a static file from /public so it loads under the site's
// existing CSP (worker-src 'self') with no policy changes. Downsampling to
// 16kHz happens on the JS side (nativeSession.ts), not here: worklets run at
// the AudioContext's native rate.

class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel && channel.length > 0) {
      // Copy: the input buffer is reused by the audio engine after return.
      this.port.postMessage(channel.slice())
    }
    return true
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)

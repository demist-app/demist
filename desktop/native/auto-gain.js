// Turns quiet lectures up before the segmenter sees them.
//
// WHY (2026-11-25). The segmenter opens a segment only for frames above an
// absolute level (0.006), and whisper.js drops any segment averaging below
// that as room tone. Both are right for silence and wrong for a laptop at the
// back of a lecture hall. Measured with the real segmenter on speech plus room
// hiss: speech at a level of 0.012 kept about 90%, at 0.008 kept 41%, at 0.006
// kept nothing, although at those levels the speech is still 20+ dB above the
// hiss and perfectly intelligible. 12 desktop students saw "too quiet to
// transcribe" in two weeks, and one regular's lectures came through at a
// quarter of the words of a clear recording.
//
// So this raises the level, but only when there is speech to raise:
// - The speech level is the loud end (95th percentile) of the last few seconds
//   of 30 ms frames; the noise level is the quiet end (10th percentile).
// - Gain is applied only while speech stands at least MIN_SNR above the noise.
//   Hiss alone, or a room where nobody is talking, is never boosted, so the
//   segmenter's own noise-relative threshold keeps silence out exactly as
//   before. Whisper invents words on amplified silence; this does not feed it
//   any.
// - Gain rises slowly (about a second from 1x to the cap) and falls at once if
//   a loud sound would clip, so it never pumps or distorts.
//
// Only what transcription hears changes. Listen-back records the microphone
// directly and is untouched.

const FRAME = 480                 // 30 ms at 16 kHz, the segmenter's frame
const HISTORY_FRAMES = 200        // about 6 seconds
const TARGET = 0.05               // the level of a clear, close recording
const MAX_GAIN = 8
const MIN_SNR = 4                 // speech level at least 4x the noise level (12 dB)
const RISE = 1.06                 // per frame, so 1x to 8x in about a second
const CEILING = 0.95              // peak allowed after gain

class AutoGain {
  constructor() {
    this.history = new Float32Array(HISTORY_FRAMES)
    this.count = 0
    this.gain = 1
    this.residual = new Float32Array(0)
  }

  // Level of the loud and quiet ends of recent audio.
  levels() {
    const n = Math.min(this.count, HISTORY_FRAMES)
    if (n < 30) return null
    const sorted = Array.from(this.history.subarray(0, n)).sort((a, b) => a - b)
    return { noise: sorted[Math.floor(n * 0.1)], speech: sorted[Math.floor(n * 0.95)] }
  }

  desiredGain() {
    const l = this.levels()
    if (!l || l.speech <= 0 || l.speech >= TARGET) return 1
    if (l.speech < Math.max(l.noise, 1e-5) * MIN_SNR) return 1
    return Math.min(MAX_GAIN, TARGET / l.speech)
  }

  /** Returns a new buffer with gain applied. Keeps no state that changes timing. */
  process(pcm) {
    const out = new Float32Array(pcm.length)
    for (let start = 0; start < pcm.length; start += FRAME) {
      const end = Math.min(start + FRAME, pcm.length)
      let sum = 0, peak = 0
      for (let i = start; i < end; i++) { const v = pcm[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a }
      this.history[this.count % HISTORY_FRAMES] = Math.sqrt(sum / (end - start))
      this.count++
      const want = this.desiredGain()
      this.gain = want > this.gain ? Math.min(want, this.gain * RISE) : want
      // Never clip: a door slam or a cough brings it straight down.
      if (peak * this.gain > CEILING) this.gain = Math.max(1, CEILING / peak)
      for (let i = start; i < end; i++) out[i] = pcm[i] * this.gain
    }
    return out
  }
}

module.exports = { AutoGain, AUTO_GAIN: { TARGET, MAX_GAIN, MIN_SNR } }

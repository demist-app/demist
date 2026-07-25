// desktop/native/pcm-segmenter.js
// Turns a continuous 16kHz mono Float32 PCM stream into speech segments cut
// at natural pauses. This is the architectural fix for terrible transcription:
// Whisper was being fed isolated 5-second MediaRecorder chunks, which slices
// words at every boundary, gives the model zero context, and hallucinates on
// near-silent chunks. Segmenting on silence means Whisper only ever sees
// complete utterances.
//
// Deliberately dependency-free energy VAD with an adaptive noise floor, not a
// neural VAD: deterministic, zero extra downloads, and tunable with three
// numbers. The floor adapts to the room, so a quiet lecture hall and a noisy
// one both work without configuration.

const SAMPLE_RATE = 16000
const FRAME_MS = 30
const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000  // 480

const HANGOVER_MS = 800        // silence this long ends a segment
const MIN_SEGMENT_MS = 1000    // ignore blips shorter than this
const MAX_SEGMENT_MS = 15000   // force a cut so live latency stays bounded
const PRE_ROLL_MS = 300        // audio kept from just before speech started
// Segments only reach Whisper once a natural pause closes them (or the
// MAX_SEGMENT_MS forced cut), which is the right call for final-transcript
// accuracy (see file header) but means nothing appears on screen for however
// long the speaker talks continuously - confirmed by testing, up to the full
// 15s in the worst case. onInterim (below) is a separate, best-effort escape
// hatch: a periodic snapshot of the still-accumulating segment, transcribed
// as a preview and REPLACED (never appended to) once the real segment
// closes. Direct testing against real speech confirmed early previews can
// be flat-out wrong at the truncation boundary (Whisper uses trailing
// context to disambiguate), not just incomplete - callers must treat this
// as provisional, not authoritative.
const INTERIM_INTERVAL_MS = 3000

const HANGOVER_FRAMES = HANGOVER_MS / FRAME_MS
const MIN_SEGMENT_SAMPLES = (SAMPLE_RATE * MIN_SEGMENT_MS) / 1000
const MAX_SEGMENT_SAMPLES = (SAMPLE_RATE * MAX_SEGMENT_MS) / 1000
const PRE_ROLL_FRAMES = PRE_ROLL_MS / FRAME_MS
const INTERIM_INTERVAL_FRAMES = Math.round(INTERIM_INTERVAL_MS / FRAME_MS)

class PcmSegmenter {
  /**
   * @param {(segment: Float32Array, meanRms: number) => void} onSegment
   *   Called with each complete speech segment, strictly in order.
   * @param {(segment: Float32Array) => void} [onInterim]
   *   Called periodically (every INTERIM_INTERVAL_MS) with a snapshot of the
   *   still-accumulating segment, for a best-effort live preview. Optional:
   *   omit for callers that only want final segments (e.g. term detection
   *   doesn't need this, only the live transcript display does).
   */
  constructor(onSegment, onInterim) {
    this.onSegment = onSegment
    this.onInterim = onInterim
    this.residual = new Float32Array(0)      // partial frame carried between feeds
    this.preRoll = []                        // last PRE_ROLL_FRAMES frames while silent
    this.segmentFrames = []                  // frames of the in-progress segment
    this.inSpeech = false
    this.silentFrames = 0
    this.noiseFloor = 0.002                  // adaptive; starts near typical mic hiss
    this.rmsSum = 0
    this.rmsCount = 0
    this.framesSinceInterim = 0
  }

  feed(chunk) {
    // Stitch residual + new chunk, then walk complete frames.
    const data = new Float32Array(this.residual.length + chunk.length)
    data.set(this.residual, 0)
    data.set(chunk, this.residual.length)
    let offset = 0
    while (offset + FRAME_SAMPLES <= data.length) {
      this._frame(data.subarray(offset, offset + FRAME_SAMPLES))
      offset += FRAME_SAMPLES
    }
    this.residual = data.slice(offset)
  }

  _frame(frame) {
    let sum = 0
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
    const rms = Math.sqrt(sum / frame.length)

    // Noise floor: slow rise, fast fall, so speech doesn't drag it up but a
    // quieter room is tracked quickly.
    this.noiseFloor = rms < this.noiseFloor
      ? this.noiseFloor * 0.95 + rms * 0.05
      : this.noiseFloor * 0.999 + rms * 0.001

    const threshold = Math.max(this.noiseFloor * 3, 0.006)
    const isSpeech = rms > threshold

    if (!this.inSpeech) {
      if (isSpeech) {
        this.inSpeech = true
        this.silentFrames = 0
        this.segmentFrames = [...this.preRoll, frame.slice()]
        this.preRoll = []
        this.rmsSum = rms
        this.rmsCount = 1
        this.framesSinceInterim = 0
      } else {
        this.preRoll.push(frame.slice())
        if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift()
      }
      return
    }

    // In speech
    this.segmentFrames.push(frame.slice())
    this.rmsSum += rms
    this.rmsCount++
    this.silentFrames = isSpeech ? 0 : this.silentFrames + 1
    this.framesSinceInterim++

    const totalSamples = this.segmentFrames.length * FRAME_SAMPLES
    if (this.silentFrames >= HANGOVER_FRAMES || totalSamples >= MAX_SEGMENT_SAMPLES) {
      this._emit()
      return
    }

    if (this.onInterim && this.framesSinceInterim >= INTERIM_INTERVAL_FRAMES) {
      this.framesSinceInterim = 0
      const snapshot = new Float32Array(totalSamples)
      let o = 0
      for (const f of this.segmentFrames) { snapshot.set(f, o); o += f.length }
      this.onInterim(snapshot)
    }
  }

  _emit() {
    const totalSamples = this.segmentFrames.length * FRAME_SAMPLES
    if (totalSamples >= MIN_SEGMENT_SAMPLES) {
      const segment = new Float32Array(totalSamples)
      let o = 0
      for (const f of this.segmentFrames) { segment.set(f, o); o += f.length }
      const meanRms = this.rmsCount ? this.rmsSum / this.rmsCount : 0
      this.onSegment(segment, meanRms)
    }
    this.inSpeech = false
    this.segmentFrames = []
    this.silentFrames = 0
    this.preRoll = []
    this.rmsSum = 0
    this.rmsCount = 0
  }

  // Flush whatever is buffered (call on session stop).
  flush() {
    if (this.inSpeech) this._emit()
  }
}

module.exports = { PcmSegmenter, SAMPLE_RATE }

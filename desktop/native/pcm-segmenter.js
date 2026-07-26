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
const PRE_ROLL_MS = 300        // audio kept from just before speech started

// Force a cut so live latency stays bounded. This was 15000, which was the
// single biggest cause of "transcription takes ~30 seconds to activate": a
// lecturer talking continuously never triggers the HANGOVER_MS pause, so the
// first final segment could not even *begin* transcribing until 15s of audio
// had accumulated, and the transcription itself then ran while more audio
// piled up behind it. Measured end-to-end against real continuous speech
// (before any of this change): first final transcript at 18.2s, and that was
// in an isolated harness with none of the desktop app's Electron IPC or
// competing term-detection/translation workers.
//
// 6000 is chosen on measurements, not taste. Two things make short cuts
// nearly free here:
//   - Whisper pads its mel input to 30s regardless of segment length, so a
//     short segment costs almost as much as a long one per call. There was
//     never a throughput argument for long segments.
//   - Measured word error rate against known ground truth did NOT degrade
//     with shorter forced cuts: 6s cuts scored 10.1% vs 15s cuts at 11.6%
//     (same audio, same model). The accuracy that matters comes from cutting
//     at natural pauses, which HANGOVER_MS still does; this constant only
//     ever applies to speech with no pause at all.
// Real inference cost also scales with segment length (more tokens to
// decode): ~2.0s for a 6s segment vs ~3.0s for a 15s one, so shorter cuts
// reduce the wait twice over.
const MAX_SEGMENT_MS = 6000

// Segments only reach Whisper once a natural pause closes them (or the
// MAX_SEGMENT_MS forced cut), which is the right call for final-transcript
// accuracy (see file header) but means nothing appears on screen for however
// long the speaker talks continuously. onInterim (below) is a separate,
// best-effort escape hatch: a periodic snapshot of the still-accumulating
// segment, transcribed as a preview and REPLACED (never appended to) once
// the real segment closes. Direct testing against real speech confirmed
// early previews can be flat-out wrong at the truncation boundary (Whisper
// uses trailing context to disambiguate), not just incomplete - callers must
// treat this as provisional, not authoritative.
//
// Two intervals rather than one: the first preview of a segment is what the
// user experiences as "did this thing even turn on", so it fires early, while
// later previews are only refinements and can be spaced out. A single 3000ms
// interval meant the very first words took 3s of speech plus ~2s of inference
// to appear even when the machine was completely idle.
//
// 1500 is not simply "as low as possible": Whisper invents plausible
// completions when handed very little audio, and that text is user-visible
// before the real segment replaces it. Measured on the same speech, a 1200ms
// first preview produced "Today we are going to talk about the future of the
// world" (pure invention) and 2100ms produced "...about MITRE"; 1500ms
// produced the correct, merely-incomplete "Today we are going to talk about"
// and was also the fastest of the three to appear. Lower is not better here.
//
// Note what these two values plus INTERIM_DEADZONE_SAMPLES add up to: a
// segment that runs all the way to the 6s forced cut gets exactly ONE
// preview, at 1.5s (the next would fall due at 4.0s, which the deadzone
// blocks). That is the intended budget, not an accident of arithmetic.
// Previews and finals share one model on one thread, so they compete for the
// same seconds: at ~1.9s per preview and ~2.2s per final, two previews per 6s
// segment would put the transcription worker at ~100% duty with nothing left
// over, and in the real app it is not alone - term detection (llama.cpp) and
// translation are running on their own workers against the same cores. Going
// over budget does not just drop previews, it pushes the *finals* late and
// the backlog compounds for the rest of the lecture, which is the failure
// this whole change set exists to remove. If MAX_SEGMENT_MS is ever raised,
// re-check this budget rather than assuming more previews are free.
const INTERIM_FIRST_MS = 1500
const INTERIM_INTERVAL_MS = 2500

const HANGOVER_FRAMES = HANGOVER_MS / FRAME_MS
const MIN_SEGMENT_SAMPLES = (SAMPLE_RATE * MIN_SEGMENT_MS) / 1000
const MAX_SEGMENT_SAMPLES = (SAMPLE_RATE * MAX_SEGMENT_MS) / 1000
const PRE_ROLL_FRAMES = PRE_ROLL_MS / FRAME_MS
const INTERIM_FIRST_FRAMES = Math.round(INTERIM_FIRST_MS / FRAME_MS)
const INTERIM_INTERVAL_FRAMES = Math.round(INTERIM_INTERVAL_MS / FRAME_MS)
// Don't start a preview this close to the forced cut: previews and finals
// share one model and run one at a time (see whisper.js), so a preview
// started just before MAX_SEGMENT_MS delays the real transcript it is about
// to be replaced by. Sized to roughly one inference.
const INTERIM_DEADZONE_SAMPLES = (SAMPLE_RATE * 2000) / 1000

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
    this.interimCount = 0                    // previews emitted for the in-progress segment
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
        this.interimCount = 0
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

    const interimDue = this.interimCount === 0 ? INTERIM_FIRST_FRAMES : INTERIM_INTERVAL_FRAMES
    if (
      this.onInterim &&
      this.framesSinceInterim >= interimDue &&
      totalSamples < MAX_SEGMENT_SAMPLES - INTERIM_DEADZONE_SAMPLES
    ) {
      this.framesSinceInterim = 0
      this.interimCount++
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
    this.interimCount = 0
  }

  // Flush whatever is buffered (call on session stop).
  flush() {
    if (this.inSpeech) this._emit()
  }
}

module.exports = { PcmSegmenter, SAMPLE_RATE }

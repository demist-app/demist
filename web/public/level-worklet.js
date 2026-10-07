// web/public/level-worklet.js
// Measures how loud the microphone is, on the audio thread (2026-10-07).
//
// The browser recorder skips a chunk as silence when nothing loud happened in
// it. That loudness used to be read inside the dashboard's requestAnimationFrame
// loop, which browsers stop running in a background tab and which does not run
// at all once the student opens another Demist page. From that moment every
// chunk read as silent and was thrown away: recordings transcribed for the
// first few minutes, then nothing for the rest of the lecture.
//
// A worklet runs with the audio graph, whatever is on screen, so the reading
// keeps flowing. It posts the loudest sample seen in each ~250ms window;
// MessagePort delivery is not throttled the way timers and animation are.

class LevelMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.peak = 0
    this.frames = 0
    this.window = Math.round(sampleRate / 4)
  }

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const v = channel[i] < 0 ? -channel[i] : channel[i]
        if (v > this.peak) this.peak = v
      }
      this.frames += channel.length
      if (this.frames >= this.window) {
        this.port.postMessage(this.peak)
        this.peak = 0
        this.frames = 0
      }
    }
    return true
  }
}

registerProcessor('level-meter', LevelMeterProcessor)

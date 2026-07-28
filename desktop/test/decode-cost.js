// Inference cost is flat in audio LENGTH (see coalesce-throughput.js), but is
// it flat in audio QUALITY? A stalled preview in a real session was 1.5s at
// meanRms 0.0122 - quiet, noisy speech - and took 13289 ms where clean audio
// of the same length takes ~1.6s. Whisper's decoder emits one token at a time
// and keeps going until it predicts an end-of-text, so audio it cannot read
// makes it ramble, and every extra token is another decoder pass.
//
// Prints tokens-ish (word count) alongside the time so the two can be
// correlated directly.
const os = require('os'), path = require('path'), fs = require('fs')
const { pipeline, env } = require('@huggingface/transformers')
env.cacheDir = path.join(os.homedir(), '.demist', 'model-cache')
const SR = 16000

function readWav(file) {
  const b = fs.readFileSync(file); let off = 12
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4)
    if (id === 'data') {
      const n = size / 2, out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(off + 8 + i * 2) / 32768
      return out
    }
    off += 8 + size + (size % 2)
  }
  throw new Error('no data chunk in ' + file)
}

const rmsOf = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length) }
const scaleTo = (a, target) => { const k = target / (rmsOf(a) || 1); const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * k; return o }
const addNoise = (a, level) => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] + (Math.random() - 0.5) * level; return o }

// The cap the shipped code applies.
const caps = (n) => ({ max_new_tokens: Math.min(448, Math.ceil((n / SR) * 15) + 16), no_repeat_ngram_size: 6 })

;(async () => {
  const clipPath = path.join(__dirname, 'fixtures', 'speech.wav')
  const full = readWav(clipPath)
  const clip = full.subarray(0, Math.round(1.5 * SR)) // same length as the stalled preview

  const t = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en', { dtype: 'q8' })
  await t(new Float32Array(SR), caps(SR))

  const cases = [
    ['clean, loud (rms 0.09)', scaleTo(clip, 0.09)],
    ['quiet (rms 0.012, as reported)', scaleTo(clip, 0.012)],
    ['quiet + noise', addNoise(scaleTo(clip, 0.012), 0.01)],
    ['very quiet (rms 0.006)', scaleTo(clip, 0.006)],
    ['noise only (rms 0.012)', addNoise(new Float32Array(clip.length), 0.024)],
    ['near-silence (rms 0.001)', scaleTo(clip, 0.001)],
  ]

  console.log('cap for 1.5s =', caps(clip.length).max_new_tokens, 'tokens\n')
  console.log('case                             ms      words  text')
  let worst = 0
  for (const [name, audio] of cases) {
    const runs = []
    let text = ''
    for (let i = 0; i < 2; i++) {
      const s = Date.now(); const r = await t(audio, caps(audio.length)); runs.push(Date.now() - s)
      text = (r?.text ?? '').trim()
    }
    const ms = Math.min(...runs)
    worst = Math.max(worst, ms)
    const words = text ? text.split(/\s+/).length : 0
    console.log(`${name.padEnd(32)} ${String(ms).padStart(5)}  ${String(words).padStart(5)}  ${JSON.stringify(text.slice(0, 70))}`)
  }
  console.log(`\nworst: ${worst} ms`)
  process.exit(0)
})()

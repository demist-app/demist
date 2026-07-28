// The first REAL segment of the first recording costs far more than every
// segment after it - measured at 6954 ms and 10317 ms against 1.8-2.2s for its
// neighbours - and that cost lands exactly on the words a user is waiting to
// see appear. preload() is supposed to have paid it already.
//
// The suspicion: preload warmed the model on digital SILENCE, and Whisper
// stops as soon as it predicts end-of-text, so the decode loop ran for
// approximately zero steps and whatever is expensive about the first decode
// was never touched. This measures whether a warm-up that forces real decode
// steps actually covers it.
//
//   node test/warmup-covers-first.js
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
  throw new Error('no data chunk')
}

const caps = (n) => ({ max_new_tokens: Math.min(448, Math.ceil((n / SR) * 15) + 16), no_repeat_ngram_size: 6 })
const silence = (n) => new Float32Array(n)
const buzz = (n) => {
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    a[i] = 0.1 * (Math.sin(2 * Math.PI * 130 * t) + 0.5 * Math.sin(2 * Math.PI * 700 * t))
  }
  return a
}

;(async () => {
  const clip = readWav(path.join(__dirname, 'fixtures', 'speech.wav'))
  const speech = clip.subarray(0, Math.round(3 * SR)).slice()

  const variants = [
    ['silence, no min_new_tokens (the old warm-up)', silence(SR), caps(SR)],
    ['buzz + min_new_tokens: 12', buzz(SR), { ...caps(SR), min_new_tokens: 12 }],
    // A real segment decodes far more than 12 tokens, and if what is expensive
    // the first time is allocation that grows with decode DEPTH, a shallow
    // warm-up cannot cover a deep first segment however many times it runs.
    ['buzz + min_new_tokens: 96', buzz(SR), { max_new_tokens: 112, min_new_tokens: 96, no_repeat_ngram_size: 6 }],
    ['real speech', speech, caps(speech.length)],
  ]

  console.log('warm-up variant                                warm-up ms   then 1st real   2nd    3rd\n')
  for (const [label, audio, opts] of variants) {
    // A fresh pipeline each time, so "first real inference" really is the
    // first one this model instance has ever done.
    const t = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en', { dtype: 'q8' })
    const tw = Date.now()
    const warm = await t(audio, opts)
    const warmMs = Date.now() - tw
    const runs = []
    for (let i = 0; i < 3; i++) {
      const s = Date.now()
      await t(speech, caps(speech.length))
      runs.push(Date.now() - s)
    }
    console.log(
      `${label.padEnd(45)} ${String(warmMs).padStart(9)}   ${String(runs[0]).padStart(11)}   ${String(runs[1]).padStart(4)}   ${String(runs[2]).padStart(4)}`
      + `\n${' '.repeat(45)} warm-up produced: ${JSON.stringify((warm?.text ?? '').trim().slice(0, 50))}`,
    )
  }
  process.exit(0)
})()

// The latency budget is set by one number: how long ONE inference takes, since
// Whisper pads every input to its 30s window and so costs the same whatever
// you feed it. Everything else (how often we cut, whether previews are
// affordable, how far behind the transcript runs) follows from it.
//
// Measured under ELECTRON, because that is what ships and it is materially
// slower and less predictable than plain Node (see inference-host.js).
//
//   npx electron test/tier-latency.js
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const { Worker } = require('worker_threads')

const SR = 16000
const RUNS = 5

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

const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads')
const os = require('os'), path = require('path')
const { pipeline, env } = require('@huggingface/transformers')
env.cacheDir = path.join(os.homedir(), '.demist', 'model-cache')
const SR = 16000
const caps = (n) => ({ max_new_tokens: Math.min(448, Math.ceil((n / SR) * 15) + 16), no_repeat_ngram_size: 6 })
;(async () => {
  const t = await pipeline('automatic-speech-recognition', workerData.model, { dtype: 'q8' })
  const out = []
  for (const secs of workerData.lengths) {
    const audio = new Float32Array(workerData.audio).subarray(0, Math.round(secs * SR))
    await t(audio, caps(audio.length))                      // warm this shape
    const times = []
    let text = ''
    for (let i = 0; i < workerData.runs; i++) {
      const s = Date.now()
      const r = await t(audio, caps(audio.length))
      times.push(Date.now() - s)
      text = (r?.text ?? '').trim()
    }
    out.push({ secs, times, text })
  }
  parentPort.postMessage(out)
})()
`

const run = (model, audio, lengths) => new Promise((res, rej) => {
  const w = new Worker(WORKER_SRC, { eval: true, workerData: { model, audio: audio.buffer.slice(0), lengths, runs: RUNS } })
  w.on('message', (m) => { w.terminate(); res(m) })
  w.on('error', rej)
})

app.whenReady().then(async () => {
  const clip = readWav(path.join(__dirname, 'fixtures', 'speech.wav'))
  const audio = clip.subarray(0, Math.round(6 * SR)).slice()
  const lengths = [2, 4, 6]
  console.log(`whisper tiers under Electron, ${RUNS} runs each\n`)
  for (const model of ['Xenova/whisper-base.en', 'Xenova/whisper-small.en']) {
    console.log(`--- ${model} ---`)
    const rows = await run(model, audio, lengths)
    for (const r of rows) {
      const med = [...r.times].sort((a, b) => a - b)[Math.floor(r.times.length / 2)]
      console.log(`  ${r.secs}s audio: median ${String(med).padStart(5)} ms  (${r.times.join(', ')})  duty ${(med / (r.secs * 1000)).toFixed(2)}x`)
    }
    console.log(`  text @6s: ${JSON.stringify(rows[rows.length - 1].text)}\n`)
  }
  app.exit(0)
})

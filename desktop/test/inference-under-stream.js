// inference-host.js showed a bare inference is only ~1.15x slower under
// Electron (2.6s vs 2.3s). But realtime-in-electron.js measured 4.1-6.6s for
// the SAME 6s segments. The only difference between those two is that in the
// real app PCM keeps arriving at the worker WHILE it decodes, and
// transformers.js hands the event loop back between tokens, so those messages
// are processed inside the decode loop.
//
// This isolates that one variable: identical inferences, with and without a
// message pump running, under both hosts.
//
//   node test/inference-under-stream.js
const path = require('path')
const fs = require('fs')

const RUNS = 4
const SR = 16000
const PUMP_MS = 750       // main.js's PCM_FLUSH_MS
const PUMP_SAMPLES = 12000 // 750ms at 16kHz, what one coalesced message carries

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
const { PcmSegmenter } = require(workerData.segmenterPath)
const SR = 16000
const caps = (n) => ({ max_new_tokens: Math.min(448, Math.ceil((n / SR) * 15) + 16), no_repeat_ngram_size: 6 })

// Same work the real worker does per PCM message: parse, then run the
// segmenter's per-frame RMS maths. onSegment is a no-op here - we are timing
// the inference, not starting more of them.
const seg = new PcmSegmenter(() => {}, null)
let pumped = 0
parentPort.on('message', (msg) => {
  if (msg.type !== 'pcm') return
  seg.feed(new Float32Array(msg.buffer))
  pumped++
})

;(async () => {
  const t = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en', { dtype: 'q8' })
  const audio = new Float32Array(workerData.audio)
  await t(new Float32Array(SR), caps(SR))    // warm-up, as whisper.js does
  parentPort.postMessage({ ready: true })
  await new Promise(r => setTimeout(r, workerData.settleMs))
  const times = []
  for (let i = 0; i < workerData.runs; i++) {
    const s = Date.now()
    await t(audio, caps(audio.length))
    times.push(Date.now() - s)
  }
  parentPort.postMessage({ times, pumped })
})()
`

async function measure({ audio, pump }) {
  const { Worker } = require('worker_threads')
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_SRC, {
      eval: true,
      workerData: {
        audio: audio.buffer.slice(0),
        runs: RUNS,
        settleMs: 800,
        segmenterPath: path.join(__dirname, '..', 'native', 'pcm-segmenter.js'),
      },
    })
    let pumper = null
    w.on('message', (m) => {
      if (m.ready) {
        if (pump) {
          pumper = setInterval(() => {
            const f = new Float32Array(PUMP_SAMPLES)
            for (let i = 0; i < PUMP_SAMPLES; i++) f[i] = Math.sin(i / 20) * 0.08
            const bytes = new Uint8Array(f.buffer)
            const copy = new Uint8Array(bytes.length)
            copy.set(bytes)
            w.postMessage({ type: 'pcm', buffer: copy.buffer }, [copy.buffer])
          }, PUMP_MS)
        }
        return
      }
      if (pumper) clearInterval(pumper)
      w.terminate()
      resolve(m)
    })
    w.on('error', reject)
  })
}

if (process.argv.includes('--child')) {
  let electronApp = null
  try { electronApp = require('electron').app } catch { /* plain node */ }
  const pump = process.argv.includes('--pump')
  const run = async () => {
    const clip = readWav(path.join(__dirname, 'fixtures', 'speech.wav'))
    const audio = clip.subarray(0, Math.round(6 * SR)).slice()
    const r = await measure({ audio, pump })
    console.log('RESULT ' + JSON.stringify(r))
    if (electronApp) electronApp.exit(0); else process.exit(0)
  }
  if (electronApp) electronApp.whenReady().then(run); else run()
} else {
  const { spawnSync } = require('child_process')
  const parse = (out) => { const m = /RESULT (\{.*\})/.exec(out || ''); return m ? JSON.parse(m[1]) : null }
  const electronPath = require('electron')
  const cleanEnv = { ...process.env }
  delete cleanEnv.ELECTRON_RUN_AS_NODE

  console.log(`6.0s of speech, whisper-small.en q8, ${RUNS} runs each\n`)
  console.log('host        PCM stream   inference times (ms)')
  for (const [label, exe, env] of [['Node    ', process.execPath, process.env], ['Electron', electronPath, cleanEnv]]) {
    for (const pump of [false, true]) {
      const args = [__filename, '--child']
      if (pump) args.push('--pump')
      const r = spawnSync(exe, args, { encoding: 'utf8', env, maxBuffer: 1 << 26 })
      const out = parse(r.stdout)
      if (!out) { console.log(`${label}    ${String(pump).padEnd(11)} FAILED\n${(r.stderr || r.stdout || '').slice(0, 500)}`); continue }
      console.log(`${label}    ${String(pump).padEnd(11)} ${out.times.join(', ')}   (${out.pumped} msgs processed)`)
    }
  }
  process.exit(0)
}

// Why is the SAME whisper inference, on the SAME machine, in the SAME kind of
// worker thread, 2-3x slower when the host process is Electron?
//
// realtime-in-electron.js measured 5555 ms for a 6.0s segment that plain Node
// transcribes in 2369 ms, and an 11322 ms FIRST inference against 1902 ms.
// Nothing else in the pipeline explains the reported 45s lag once that is
// true: at 5.5s of work per 6s of audio, plus previews, the backlog only grows.
//
// This strips everything else away: one worker thread, one model, N inferences
// of the same clip, no PCM stream, no segmenter, no window (unless asked).
//
//   node test/inference-host.js              # compare node vs electron
//   node test/inference-host.js --child      # internal
const path = require('path')
const fs = require('fs')

const RUNS = 5
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

// Runs in a worker thread, exactly like the app's transcribe worker.
const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads')
const os = require('os'), path = require('path')
const { pipeline, env } = require('@huggingface/transformers')
env.cacheDir = path.join(os.homedir(), '.demist', 'model-cache')
const SR = 16000
const caps = (n) => ({ max_new_tokens: Math.min(448, Math.ceil((n / SR) * 15) + 16), no_repeat_ngram_size: 6 })
;(async () => {
  const opts = { dtype: 'q8' }
  if (workerData.threads) opts.session_options = { intraOpNumThreads: workerData.threads, interOpNumThreads: 1 }
  const t = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en', opts)
  const audio = new Float32Array(workerData.audio)
  const times = []
  for (let i = 0; i < workerData.runs; i++) {
    const s = Date.now()
    await t(audio, caps(audio.length))
    times.push(Date.now() - s)
  }
  parentPort.postMessage(times)
})()
`

async function measure({ threads, audio, runs }) {
  const { Worker } = require('worker_threads')
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_SRC, {
      eval: true,
      workerData: { threads, audio: audio.buffer.slice(0), runs },
    })
    w.on('message', (times) => { w.terminate(); resolve(times) })
    w.on('error', reject)
  })
}

if (process.argv.includes('--child')) {
  let electronApp = null
  try { electronApp = require('electron').app } catch { /* plain node */ }
  const withWindow = process.argv.includes('--window')
  const threads = Number((process.argv.find(a => a.startsWith('--threads=')) || '').split('=')[1]) || 0
  const run = async () => {
    if (withWindow) {
      const { BrowserWindow } = require('electron')
      const win = new BrowserWindow({ width: 900, height: 600, show: true })
      win.loadURL('data:text/html,<h1>harness</h1>')
      await new Promise(r => setTimeout(r, 1500))
    }
    const clip = readWav(path.join(__dirname, 'fixtures', 'speech.wav'))
    const audio = clip.subarray(0, Math.round(6 * SR)).slice()
    const times = await measure({ threads, audio, runs: RUNS })
    console.log('RESULT ' + JSON.stringify(times))
    if (electronApp) electronApp.exit(0); else process.exit(0)
  }
  if (electronApp) electronApp.whenReady().then(run); else run()
} else {
  const { spawnSync } = require('child_process')
  const os = require('os')
  const parse = (out) => { const m = /RESULT (\[.*\])/.exec(out || ''); return m ? JSON.parse(m[1]) : null }
  const electronPath = require('electron')
  const cleanEnv = { ...process.env }
  delete cleanEnv.ELECTRON_RUN_AS_NODE

  console.log(`${os.cpus().length} logical CPUs; 6.0s of speech through whisper-small.en q8, ${RUNS} runs\n`)
  const cases = [
    ['plain Node', process.execPath, [__filename, '--child'], process.env],
    ['Electron, no window', electronPath, [__filename, '--child'], cleanEnv],
    ['Electron, window open', electronPath, [__filename, '--child', '--window'], cleanEnv],
    [`Electron, intraOp=${Math.max(1, os.cpus().length >> 1)}`, electronPath, [__filename, '--child', `--threads=${Math.max(1, os.cpus().length >> 1)}`], cleanEnv],
    ['Electron, intraOp=4', electronPath, [__filename, '--child', '--threads=4'], cleanEnv],
  ]
  console.log('host                        first     rest (ms)')
  for (const [label, exe, args, env] of cases) {
    const r = spawnSync(exe, args, { encoding: 'utf8', env, maxBuffer: 1 << 26 })
    const times = parse(r.stdout)
    if (!times) { console.log(`${label.padEnd(26)}  FAILED\n${(r.stderr || r.stdout || '').slice(0, 600)}`); continue }
    const rest = times.slice(1)
    console.log(`${label.padEnd(26)} ${String(times[0]).padStart(6)}     ${rest.join(', ')}`)
  }
  process.exit(0)
}

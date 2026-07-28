// Isolated harnesses could not reproduce the 13289 ms first inference: it is
// flat in audio length, flat in audio quality, and flat over idle time. The
// one thing those harnesses do NOT have is the rest of Electron - main
// process, renderer, GPU process - sitting on another ~1.5GB, on top of a
// machine that already has a browser and an editor open.
//
// So hold the three models resident and then squeeze the machine, measuring
// inference latency as free memory falls. Ballast is touched after allocation
// so it is real resident pages, not lazily-mapped address space.
//
//   node test/memory-pressure.js [ballastGB...]   default: 0 1 2 3
const os = require('os'), path = require('path')
const { Worker } = require('worker_threads')

const SR = 16000
const STEPS = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n))
const BALLAST_GB = STEPS.length ? STEPS : [0, 1, 2, 3]

let nextId = 1
function spawn() {
  const w = new Worker(path.join(__dirname, '..', 'native', 'worker.js'))
  const pending = new Map()
  w.on('message', (m) => {
    if (m.event) return
    const e = pending.get(m.id); if (!e) return
    pending.delete(m.id); m.error ? e.reject(new Error(m.error)) : e.resolve(m.result)
  })
  w.on('error', e => console.error('!! worker error', e))
  return {
    call: (type, ...args) => new Promise((res, rej) => {
      const id = nextId++; pending.set(id, { resolve: res, reject: rej })
      w.postMessage({ id, type, args })
    }),
    feed: (a) => { const c = new Float32Array(a); w.postMessage({ type: 'pcm', buffer: c.buffer }, [c.buffer]) },
    raw: w,
  }
}

const speechy = (secs) => Float32Array.from({ length: Math.round(secs * SR) }, (_, i) => {
  const t = i / SR
  return 0.25 * (Math.sin(2 * Math.PI * (140 + 40 * Math.sin(2 * Math.PI * 3 * t)) * t)
    + 0.5 * Math.sin(2 * Math.PI * 700 * t) * Math.sin(2 * Math.PI * 2.5 * t))
})
const sleep = ms => new Promise(r => setTimeout(r, ms))
const freeGB = () => os.freemem() / 1024 ** 3

// Time one inference on the transcribe worker via the real session path.
async function timeFirstInference(w) {
  let resolveFirst
  const first = new Promise(r => { resolveFirst = r })
  const onMsg = (m) => {
    if (m.event === 'transcript' || m.event === 'interimTranscript') resolveFirst(Date.now())
  }
  w.raw.on('message', onMsg)
  await w.call('startSession')
  const t0 = Date.now()
  const audio = speechy(4)
  const batch = Math.round(SR * 0.1)
  for (let i = 0; i < audio.length; i += batch) w.feed(audio.subarray(i, i + batch))
  for (let i = 0; i < 15; i++) w.feed(new Float32Array(batch)) // trailing silence closes it
  const at = await Promise.race([first, sleep(90_000).then(() => null)])
  await w.call('stopSession')
  w.raw.off('message', onMsg)
  return at ? at - t0 : null
}

const ballast = []
function addBallastGB(gb) {
  for (let i = 0; i < gb * 4; i++) {
    const buf = Buffer.allocUnsafe(256 * 1024 * 1024)
    buf.fill(1) // touch every page so it is genuinely resident
    ballast.push(buf)
  }
}

;(async () => {
  console.log(`machine: ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB total, ${freeGB().toFixed(1)}GB free\n`)
  const w = spawn(), terms = spawn(), translate = spawn()
  console.log('loading all three models...')
  await Promise.all([
    w.call('preloadWhisper'),
    terms.call('preloadTermDetection'),
    translate.call('preloadTranslation', 'hi'),
  ])
  console.log(`loaded. free ${freeGB().toFixed(1)}GB\n`)

  console.log('extra_pressure   free_before   time_to_first_text')
  let added = 0
  const rows = []
  for (const gb of BALLAST_GB) {
    if (gb > added) { addBallastGB(gb - added); added = gb }
    await sleep(1500)
    const before = freeGB()
    const ms = await timeFirstInference(w)
    rows.push({ gb, before, ms })
    const flag = ms === null ? '   <-- TIMED OUT' : ms > 8000 ? '   <-- STALL' : ''
    console.log(`${String(gb).padStart(13)}GB   ${before.toFixed(1).padStart(10)}GB   ${String(ms).padStart(15)} ms${flag}`)
  }
  const worst = Math.max(...rows.map(r => r.ms ?? 999999))
  console.log(`\nworst: ${worst} ms`)
  process.exit(0)
})()

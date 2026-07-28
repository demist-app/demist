// Why is the FIRST inference of a recording ~13s when later ones are ~1.6s?
//
// Replicates the real app's full footprint (all three worker threads with
// their models loaded) and then runs real recording sessions after increasing
// idle gaps, measuring time-to-first-transcript - the number the user actually
// experiences. If it grows with idle time, the model's weights are being
// trimmed out of the working set and the first inference of a session is the
// one paying to fault them back off disk.
//
//   node test/idle-decay.js            # with keep-warm (matches shipped app)
//   node test/idle-decay.js --no-warm  # keep-warm disabled, for comparison
const path = require('path')
const os = require('os')
const { Worker } = require('worker_threads')

const KEEP_WARM = !process.argv.includes('--no-warm')
const SR = 16000
const IDLE_GAPS_S = [0, 20, 70, 140]

let nextId = 1
function spawn() {
  const w = new Worker(path.join(__dirname, '..', 'native', 'worker.js'))
  const pending = new Map()
  const listeners = []
  w.on('message', (m) => {
    if (m.event) { listeners.forEach(fn => fn(m)); return }
    const e = pending.get(m.id); if (!e) return
    pending.delete(m.id); m.error ? e.reject(new Error(m.error)) : e.resolve(m.result)
  })
  w.on('error', (e) => console.error('!! worker error', e))
  return {
    call: (type, ...args) => new Promise((res, rej) => {
      const id = nextId++; pending.set(id, { resolve: res, reject: rej })
      w.postMessage({ id, type, args })
    }),
    feed: (a) => { const c = new Float32Array(a); w.postMessage({ type: 'pcm', buffer: c.buffer }, [c.buffer]) },
    onEvent: (fn) => listeners.push(fn),
  }
}

const speechy = (secs) => Float32Array.from({ length: Math.round(secs * SR) }, (_, i) => {
  const t = i / SR
  return 0.25 * (Math.sin(2 * Math.PI * (140 + 40 * Math.sin(2 * Math.PI * 3 * t)) * t)
    + 0.5 * Math.sin(2 * Math.PI * 700 * t) * Math.sin(2 * Math.PI * 2.5 * t))
})
const tone = (secs) => Float32Array.from({ length: Math.round(secs * SR) }, () => (Math.random() - 0.5) * 0.003)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const freeGB = () => (os.freemem() / 1024 ** 3).toFixed(1)

// One realistic recording: 4s of speech fed at real time, measuring from the
// first PCM frame to the first text (preview or final) coming back.
async function recordOnce(w) {
  let firstText = null
  const t0 = Date.now()
  const done = new Promise((resolve) => {
    w.onEvent((m) => {
      if ((m.event === 'transcript' || m.event === 'interimTranscript') && firstText === null) {
        firstText = Date.now() - t0
        resolve()
      }
    })
  })
  await w.call('startSession')
  const audio = new Float32Array(tone(0.3).length + speechy(4).length + tone(1.5).length)
  audio.set(tone(0.3), 0)
  audio.set(speechy(4), tone(0.3).length)
  audio.set(tone(1.5), tone(0.3).length + speechy(4).length)
  const batch = Math.round(SR * 0.1)
  const pump = (async () => {
    for (let i = 0; i < audio.length; i += batch) { w.feed(audio.subarray(i, i + batch)); await sleep(100) }
  })()
  await Promise.race([done, sleep(60_000)])
  await pump
  await w.call('stopSession')
  return firstText
}

;(async () => {
  console.log(`keep-warm: ${KEEP_WARM ? 'ON (as shipped)' : 'OFF'}`)
  console.log(`machine: ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB total, ${freeGB()}GB free\n`)

  const w = spawn()
  const terms = spawn(), translate = spawn()
  console.log('loading all three models, as the real app does...')
  await Promise.all([
    w.call('preloadWhisper'),
    terms.call('preloadTermDetection'),
    translate.call('preloadTranslation', 'hi'),
  ])
  console.log(`loaded. machine free ${freeGB()}GB\n`)

  console.log('idle_before_recording   time_to_first_text   free_mem')
  const results = []
  for (const gap of IDLE_GAPS_S) {
    let waited = 0
    while (waited < gap) {
      const step = Math.min(60, gap - waited)
      await sleep(step * 1000); waited += step
      if (KEEP_WARM && waited % 60 === 0) await w.call('keepWhisperWarm')
    }
    const ms = await recordOnce(w)
    results.push({ gap, ms })
    console.log(`${String(gap).padStart(19)}s   ${String(ms).padStart(15)} ms   ${freeGB()}GB${ms > 5000 ? '   <-- STALL' : ''}`)
  }

  const worst = Math.max(...results.map(r => r.ms))
  console.log(`\nworst time-to-first-text: ${worst} ms`)
  process.exit(worst > 8000 ? 1 : 0)
})()

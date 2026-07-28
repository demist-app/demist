// Every previous harness measured whisper ALONE and found it fast (25s of
// audio in 1579ms). In a real recording it is not alone: transcription, Hindi
// translation and llama term detection all run at once, on three worker
// threads inside one process. A real session measured a coalesced 21.6s batch
// at 11287 ms and a 1.8s preview at 26154 ms - 7-15x slower than the same
// model measured on its own, and capture itself collapsed to 7% of real time.
//
// onnxruntime and llama.cpp each default to using every core they can see, so
// three at once is heavy oversubscription. This measures the real cost AND
// the process's remaining responsiveness, because the AudioWorklet render
// thread needs CPU headroom - when it does not get any, process() stops being
// called and capture starves, which is exactly what the reported logs show.
//
//   node test/three-way-contention.js
const path = require('path')
const os = require('os')
const { Worker } = require('worker_threads')

const SR = 16000
const EXCERPT = 'Chemiosmosis drives ATP synthase using the proton motive force across the inner mitochondrial membrane. This gradient couples respiration to ATP production.'

let nextId = 1
function spawn(name) {
  const w = new Worker(path.join(__dirname, '..', 'native', 'worker.js'))
  const pending = new Map()
  let onTranscript = null
  w.on('message', (m) => {
    if (m.event === 'transcript' && onTranscript) { onTranscript(m.payload); return }
    if (m.event) return
    const e = pending.get(m.id); if (!e) return
    pending.delete(m.id); m.error ? e.reject(new Error(m.error)) : e.resolve(m.result)
  })
  w.on('error', e => console.error(`!! ${name} worker error`, e))
  return {
    call: (type, ...args) => new Promise((res, rej) => {
      const id = nextId++; pending.set(id, { resolve: res, reject: rej })
      w.postMessage({ id, type, args })
    }),
    feed: (a) => { const c = new Float32Array(a); w.postMessage({ type: 'pcm', buffer: c.buffer }, [c.buffer]) },
    set onTranscript(fn) { onTranscript = fn },
  }
}

const speechy = (secs) => Float32Array.from({ length: Math.round(secs * SR) }, (_, i) => {
  const t = i / SR
  return 0.25 * (Math.sin(2 * Math.PI * (140 + 40 * Math.sin(2 * Math.PI * 3 * t)) * t)
    + 0.5 * Math.sin(2 * Math.PI * 700 * t) * Math.sin(2 * Math.PI * 2.5 * t))
})

// A 20ms timer that should never drift. Drift of hundreds of ms means the
// process has no spare CPU - the same starvation that stops the audio render
// thread calling process(), which is what collapses capture to single-digit
// percentages of real time.
function probe() {
  let worst = 0, sum = 0, n = 0, last = Date.now()
  const iv = setInterval(() => {
    const now = Date.now(), late = Math.max(0, now - last - 20)
    last = now; sum += late; n++; if (late > worst) worst = late
  }, 20)
  return () => { clearInterval(iv); return { worst, mean: n ? sum / n : 0 } }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  console.log(`machine: ${os.cpus().length} cpus, ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB\n`)
  const transcribe = spawn('transcribe'), terms = spawn('terms'), translate = spawn('translate')
  console.log('loading all three models...')
  await Promise.all([
    transcribe.call('preloadWhisper'),
    terms.call('preloadTermDetection'),
    translate.call('preloadTranslation', 'hi'),
  ])
  console.log('loaded.\n')

  const audio = speechy(21.6) // the size of the coalesced batch in the report

  // One transcription pass through the real session path, timed from first
  // PCM frame to the transcript coming back.
  async function transcribePass(alongside) {
    let done
    const finished = new Promise(r => { done = r })
    transcribe.onTranscript = () => done()
    const stop = probe()
    await transcribe.call('startSession')
    const t0 = Date.now()
    const others = alongside ? alongside() : Promise.resolve()
    const batch = Math.round(SR * 0.1)
    for (let i = 0; i < audio.length; i += batch) transcribe.feed(audio.subarray(i, i + batch))
    for (let i = 0; i < 20; i++) transcribe.feed(new Float32Array(batch))
    await Promise.race([finished, sleep(120_000)])
    const ms = Date.now() - t0
    await transcribe.call('stopSession')
    await others.catch(() => {})
    return { ms, ...stop() }
  }

  console.log('scenario                                  transcribe   timer drift (mean/worst)')
  const rows = []

  const alone = await transcribePass(null)
  rows.push(['whisper alone', alone])

  const withTerms = await transcribePass(() => terms.call('detectTerms', EXCERPT, '', 'Biology', 2))
  rows.push(['+ term detection', withTerms])

  const withTranslate = await transcribePass(() => translate.call('translate', EXCERPT, 'hi'))
  rows.push(['+ translation', withTranslate])

  const withBoth = await transcribePass(() => Promise.all([
    terms.call('detectTerms', EXCERPT, '', 'Biology', 2),
    translate.call('translate', EXCERPT, 'hi'),
  ]))
  rows.push(['+ both (a real recording)', withBoth])

  for (const [name, r] of rows) {
    console.log(`${name.padEnd(42)} ${String(r.ms).padStart(7)} ms   ${r.mean.toFixed(0).padStart(4)}ms / ${String(r.worst).padStart(5)}ms`)
  }
  const slowdown = withBoth.ms / alone.ms
  console.log(`\nslowdown from running all three: ${slowdown.toFixed(1)}x`)
  console.log(`worst timer drift under full load: ${withBoth.worst} ms`)
  process.exit(0)
})()

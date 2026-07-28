// Reproduces the reported bug end-to-end: "transcription appears 45-50 seconds
// late". Everything earlier in test/ measured one hop or one inference in
// isolation; this streams real speech at REAL TIME into the real worker,
// through main.js's exact coalescing shape, and reports the only number the
// user actually experiences: how far behind wall clock the transcript is.
//
//   node test/realtime-latency.js [seconds]
const path = require('path')
const fs = require('fs')
const { Worker } = require('worker_threads')

const SR = 16000
const RUN_SECS = Number(process.argv[2]) || 45
// main.js's numbers, so this measures what ships.
const RENDERER_FRAME_MS = 100
const FLUSH_MS = Number(process.env.FLUSH_MS) || 750

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

const sleep = ms => new Promise(r => setTimeout(r, ms))

;(async () => {
  const clip = readWav(path.join(__dirname, 'fixtures', 'speech.wav'))
  console.log(`fixture: ${(clip.length / SR).toFixed(1)}s of speech, looped for ${RUN_SECS}s at real time`)

  const w = new Worker(path.join(__dirname, '..', 'native', 'worker.js'))
  let nextId = 1
  const pending = new Map()
  const t0 = Date.now()
  const el = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5)
  const transcripts = []
  w.on('message', (m) => {
    if (m.event === 'diag') { console.log(`[${el()}s] diag   ${m.payload.message}`); return }
    if (m.event === 'transcript') {
      transcripts.push({ at: Date.now() - t0, ...m.payload })
      console.log(`[${el()}s] FINAL  seq ${m.payload.seq}: ${JSON.stringify(m.payload.text.slice(0, 70))}`)
      return
    }
    if (m.event === 'interimTranscript') {
      console.log(`[${el()}s] prevw  ${JSON.stringify(m.payload.text.slice(0, 60))}`)
      return
    }
    if (m.event) return
    const e = pending.get(m.id); if (!e) return
    pending.delete(m.id); m.error ? e.reject(new Error(m.error)) : e.resolve(m.result)
  })
  const call = (type, ...args) => new Promise((res, rej) => {
    const id = nextId++; pending.set(id, { resolve: res, reject: rej })
    w.postMessage({ id, type, args })
  })

  console.log('loading model...')
  const tLoad = Date.now()
  await call('preloadWhisper')
  console.log(`model ready in ${Date.now() - tLoad} ms`)

  await call('startSession')

  // --- the renderer: a 100ms frame, 10x/sec, forever ---
  const queue = []
  let read = 0
  let framesProduced = 0
  const frameSamples = Math.round(SR * RENDERER_FRAME_MS / 1000)
  const producer = setInterval(() => {
    const f = new Float32Array(frameSamples)
    for (let i = 0; i < frameSamples; i++) f[i] = clip[(read + i) % clip.length]
    read = (read + frameSamples) % clip.length
    queue.push(new Uint8Array(f.buffer))
    framesProduced++
  }, RENDERER_FRAME_MS)

  // --- main.js: coalesce the queue into ONE message per FLUSH_MS ---
  let mseq = 0, posted = 0, postedSamples = 0
  const flusher = setInterval(() => {
    if (!queue.length) return
    let total = 0
    for (const c of queue) total += c.length
    const merged = new Uint8Array(total)
    let off = 0
    for (const c of queue) { merged.set(c, off); off += c.length }
    queue.length = 0
    w.postMessage({ type: 'pcm', buffer: merged.buffer, mseq: ++mseq }, [merged.buffer])
    posted++; postedSamples += total / 4
  }, FLUSH_MS)

  // Control-message responsiveness while all this is going on: a ping that
  // takes seconds to answer means the worker's event loop is blocked, which is
  // also why it is not draining PCM.
  let pingWorst = 0, pings = 0, pingTotal = 0
  const pinger = setInterval(async () => {
    const s = Date.now()
    await call('getTranscribeTier').catch(() => {})
    const ms = Date.now() - s
    pings++; pingTotal += ms
    if (ms > pingWorst) pingWorst = ms
  }, 1000)

  await sleep(RUN_SECS * 1000)
  clearInterval(producer); clearInterval(flusher); clearInterval(pinger)

  const fedSecs = postedSamples / SR
  console.log(`\n--- after ${RUN_SECS}s of real-time audio ---`)
  console.log(`renderer produced ${framesProduced} frames (${(framesProduced * RENDERER_FRAME_MS / 1000).toFixed(1)}s)`)
  console.log(`main posted ${posted} coalesced messages carrying ${fedSecs.toFixed(1)}s of audio`)
  console.log(`control-message round trip: ${pings} pings, mean ${(pingTotal / Math.max(1, pings)).toFixed(0)} ms, worst ${pingWorst} ms`)
  console.log(`final transcripts: ${transcripts.length}`)
  if (transcripts.length) {
    console.log(`  first at ${(transcripts[0].at / 1000).toFixed(1)}s, last at ${(transcripts[transcripts.length - 1].at / 1000).toFixed(1)}s`)
  }
  const tStop = Date.now()
  await call('stopSession')
  console.log(`stopSession (drains the whole backlog) took ${Date.now() - tStop} ms  <- THIS IS THE BACKLOG`)
  console.log(`total transcripts after drain: ${transcripts.length}`)
  await w.terminate()
  process.exit(0)
})()

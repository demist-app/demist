// Everything measured so far says the transcription thread is starved by the
// process it lives in, not by anything in the transcription code:
//
//   plain Node worker thread : steady 2.3s inferences, no starvation at all
//   Electron main's worker   : one core spins for 20-30s after the model
//                              loads, the worker's event loop ticks 0/60
//                              times, control messages take 20s to answer,
//                              and PCM sits undelivered in its port queue
//
// So the question this answers is: does the same code, streamed the same
// speech at the same rate, behave itself if the transcription lives in a
// genuine Node CHILD PROCESS forked from Electron's main process instead of a
// worker thread inside it?
//
//   npx electron test/child-process-host.js [seconds]
//   npx electron test/child-process-host.js [seconds] --thread   # the old way, for comparison
const { app } = require('electron')
const path = require('path')
const fs = require('fs')

const SR = 16000
const RUN_SECS = Number(process.argv.find(a => /^\d+$/.test(a))) || 40
const FLUSH_MS = 750
const USE_THREAD = process.argv.includes('--thread')

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

app.whenReady().then(async () => {
  const clip = readWav(path.join(__dirname, 'fixtures', 'speech.wav'))
  const t0 = Date.now()
  const el = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5)
  const transcripts = []

  let post, call
  const pending = new Map()
  let nextId = 1
  const onMessage = (m) => {
    if (m.event === 'diag') { console.log(`[${el()}s] diag   ${m.payload.message}`); return }
    if (m.event === 'transcript') {
      transcripts.push({ at: Date.now() - t0, ...m.payload })
      console.log(`[${el()}s] FINAL  seq ${m.payload.seq}: ${JSON.stringify(m.payload.text.slice(0, 60))}`)
      return
    }
    if (m.event) return
    const e = pending.get(m.id); if (!e) return
    pending.delete(m.id); m.error ? e.reject(new Error(m.error)) : e.resolve(m.result)
  }

  if (USE_THREAD) {
    const { Worker } = require('worker_threads')
    const w = new Worker(path.join(__dirname, '..', 'native', 'worker.js'))
    w.on('message', onMessage)
    post = (msg, transfer) => w.postMessage(msg, transfer)
  } else {
    const { fork } = require('child_process')
    const child = fork(path.join(__dirname, '..', 'native', 'worker.js'), [], {
      // ELECTRON_RUN_AS_NODE turns the Electron binary into a plain Node
      // process: no Chromium, no browser-process allocator or GC heuristics,
      // just the runtime the pipeline was measured healthy in.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      // Structured clone rather than JSON, so a Float32Array survives the hop
      // as binary instead of being stringified into an object of indices.
      serialization: 'advanced',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    child.on('message', onMessage)
    post = (msg) => child.send(msg)
  }
  call = (type, ...args) => new Promise((res, rej) => {
    const id = nextId++; pending.set(id, { resolve: res, reject: rej })
    post({ id, type, args })
  })

  let lastCpu = process.cpuUsage(), lastCpuAt = Date.now()
  setInterval(() => {
    const c = process.cpuUsage()
    const dt = Date.now() - lastCpuAt
    console.log(`[${el()}s] cpu    electron main process using ${(((c.user - lastCpu.user) + (c.system - lastCpu.system)) / 1000 / dt).toFixed(2)} cores`)
    lastCpu = c; lastCpuAt = Date.now()
  }, 5000).unref?.()

  console.log(`transcription host: ${USE_THREAD ? 'worker THREAD inside Electron main' : 'forked Node CHILD PROCESS'}`)
  await call('preloadWhisper')
  console.log(`whisper ready at ${el()}s`)
  // Is the expensive first segment a one-time cost that simply had not
  // finished when preload claimed to be ready (in which case paying it before
  // the record button unlocks fixes it), or is it triggered by the session?
  const settle = Number((process.argv.find(a => a.startsWith('--settle=')) || '').split('=')[1]) || 0
  if (settle) { await sleep(settle * 1000); console.log(`settled at ${el()}s`) }

  await call('startSession')
  const tSession = Date.now()

  const queue = []
  let read = 0
  const frameSamples = Math.round(SR * 0.1)
  const producer = setInterval(() => {
    const f = new Float32Array(frameSamples)
    for (let i = 0; i < frameSamples; i++) f[i] = clip[(read + i) % clip.length]
    read = (read + frameSamples) % clip.length
    queue.push(new Uint8Array(f.buffer))
  }, 100)

  let mseq = 0, posted = 0
  const flusher = setInterval(() => {
    if (!queue.length) return
    let total = 0
    for (const c of queue) total += c.length
    const merged = new Uint8Array(total)
    let off = 0
    for (const c of queue) { merged.set(c, off); off += c.length }
    queue.length = 0
    post({ type: 'pcm', buffer: merged.buffer, mseq: ++mseq, postedAt: Date.now() },
      USE_THREAD ? [merged.buffer] : undefined)
    posted++
  }, FLUSH_MS)

  let pingWorst = 0
  const pinger = setInterval(async () => {
    const s = Date.now()
    await call('getTranscribeTier').catch(() => {})
    const ms = Date.now() - s
    if (ms > pingWorst) pingWorst = ms
  }, 1000)

  await sleep(RUN_SECS * 1000)
  clearInterval(producer); clearInterval(flusher); clearInterval(pinger)
  console.log(`\n--- ${USE_THREAD ? 'WORKER THREAD' : 'CHILD PROCESS'}, ${RUN_SECS}s of real-time speech ---`)
  console.log(`main posted ${posted} coalesced PCM messages`)
  console.log(`worst control-message round trip: ${pingWorst} ms`)
  console.log(`transcripts during the recording: ${transcripts.length}`)
  if (transcripts.length) console.log(`  first arrived ${((transcripts[0].at - (tSession - t0)) / 1000).toFixed(1)}s into the session`)
  const tStop = Date.now()
  await call('stopSession')
  console.log(`stopSession drain (the leftover backlog): ${Date.now() - tStop} ms`)
  console.log(`transcripts after drain: ${transcripts.length}`)
  app.exit(0)
})

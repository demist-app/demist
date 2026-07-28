// The same real-time measurement as realtime-latency.js, but hosted in a real
// Electron main process with a real BrowserWindow open - i.e. the shipping
// topology - and feeding REAL SPEECH.
//
// Every earlier hop harness (ipc-rate/*, hop-in-electron.js) fed ZEROED
// buffers, so the worker was loaded but permanently idle: no segment ever
// closed, no inference ever ran, and the thing being measured (a worker that
// has to transcribe while audio keeps arriving) never happened once. That is
// why they all passed while the app stayed broken.
//
//   npx electron test/realtime-in-electron.js [seconds]
//   ...--roles adds the llama.cpp term worker + translation worker contending
//      for the same cores, as the real app does.
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const { Worker } = require('worker_threads')

const SR = 16000
const RUN_SECS = Number(process.argv.find(a => /^\d+$/.test(a))) || 45
const FLUSH_MS = Number(process.env.FLUSH_MS) || 750
const WITH_ROLES = process.argv.includes('--roles')

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

function spawnWorker(label, onDiag) {
  const HEAP = Number((process.argv.find(a => a.startsWith('--heap=')) || '').split('=')[1]) || 0
  const w = new Worker(path.join(__dirname, '..', 'native', 'worker.js'),
    HEAP ? { resourceLimits: { maxOldGenerationSizeMb: HEAP, maxYoungGenerationSizeMb: 64 } } : undefined)
  let nextId = 1
  const pending = new Map()
  w.on('message', (m) => {
    if (m.event) { onDiag?.(m); return }
    const e = pending.get(m.id); if (!e) return
    pending.delete(m.id); m.error ? e.reject(new Error(m.error)) : e.resolve(m.result)
  })
  return {
    worker: w,
    call: (type, ...args) => new Promise((res, rej) => {
      const id = nextId++; pending.set(id, { resolve: res, reject: rej })
      w.postMessage({ id, type, args })
    }),
  }
}

app.whenReady().then(async () => {
  const clip = readWav(path.join(__dirname, 'fixtures', 'speech.wav'))
  // Bisecting: a window plus a loaded model is the only combination any
  // earlier harness failed on, so both are switchable here.
  if (!process.argv.includes('--no-window')) {
    const win = new BrowserWindow({ width: 900, height: 600, show: !process.argv.includes('--hidden') })
    win.loadURL(process.argv.includes('--idle-window')
      ? 'data:text/html,<h1>demist harness</h1>'
      : 'data:text/html,<h1>demist harness</h1><script>setInterval(()=>{document.title=Date.now()},50)</script>')
  }

  // Is the worker thread BURNING cpu (blocked in a native call) or simply not
  // being scheduled (paged out / descheduled)? Those need opposite fixes and
  // look identical from a message counter.
  let lastCpu = process.cpuUsage()
  let lastCpuAt = Date.now()
  setInterval(() => {
    const c = process.cpuUsage()
    const dt = Date.now() - lastCpuAt
    const cores = ((c.user - lastCpu.user) + (c.system - lastCpu.system)) / 1000 / dt
    lastCpu = c; lastCpuAt = Date.now()
    console.log(`[${el()}s] cpu    process using ${cores.toFixed(2)} cores`)
  }, 2000).unref?.()

  const t0 = Date.now()
  const el = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(5)
  const transcripts = []
  const tx = spawnWorker('transcribe', (m) => {
    if (m.event === 'diag') console.log(`[${el()}s] diag   ${m.payload.message}`)
    else if (m.event === 'transcript') {
      transcripts.push({ at: Date.now() - t0, ...m.payload })
      console.log(`[${el()}s] FINAL  seq ${m.payload.seq}: ${JSON.stringify(m.payload.text.slice(0, 60))}`)
    } else if (m.event === 'interimTranscript') console.log(`[${el()}s] prevw  ${JSON.stringify(m.payload.text.slice(0, 50))}`)
  })

  console.log('loading whisper...')
  await tx.call('preloadWhisper')
  console.log(`whisper ready at ${el()}s`)

  let terms = null
  if (WITH_ROLES) {
    terms = spawnWorker('terms')
    console.log('loading term-detection LLM (as the real app does at startup)...')
    await terms.call('preloadTermDetection').catch(e => console.log('terms preload failed:', e.message))
    console.log(`terms ready at ${el()}s`)
  }

  // Does the ~25s single-core spin that follows a model load happen ONCE after
  // loading (in which case waiting it out before the session starts fixes the
  // symptom outright), or is it triggered by the session itself?
  const settle = Number((process.argv.find(a => a.startsWith('--settle=')) || '').split('=')[1]) || 0
  if (settle) {
    console.log(`waiting ${settle}s after the model load before starting the session...`)
    await sleep(settle * 1000)
    console.log(`settled at ${el()}s`)
  }

  await tx.call('startSession')
  const tSession = Date.now()

  // --- renderer: one 100ms frame, 10x/sec ---
  const queue = []
  let read = 0, framesProduced = 0
  const frameSamples = Math.round(SR * 0.1)
  const producer = setInterval(() => {
    const f = new Float32Array(frameSamples)
    for (let i = 0; i < frameSamples; i++) f[i] = clip[(read + i) % clip.length]
    read = (read + frameSamples) % clip.length
    queue.push(new Uint8Array(f.buffer))
    framesProduced++
  }, 100)

  // --- main.js: coalesce into one message per FLUSH_MS ---
  let mseq = 0, posted = 0, postedSamples = 0
  const flusher = setInterval(() => {
    if (!queue.length) return
    let total = 0
    for (const c of queue) total += c.length
    const merged = new Uint8Array(total)
    let off = 0
    for (const c of queue) { merged.set(c, off); off += c.length }
    queue.length = 0
    tx.worker.postMessage({ type: 'pcm', buffer: merged.buffer, mseq: ++mseq, postedAt: Date.now() }, [merged.buffer])
    posted++; postedSamples += total / 4
  }, FLUSH_MS)

  // Round-trip a real control message once a second. This is the independent
  // check on whether the transcribe thread is running at all: 'ping' does
  // literally nothing, so its round trip is pure scheduling + queue latency.
  const pinger = setInterval(async () => {
    const s = Date.now()
    await tx.call('getTranscribeTier').catch(() => {})
    const ms = Date.now() - s
    if (ms > 500) console.log(`[${el()}s] PING   control round trip ${ms} ms <- the worker thread is not answering`)
  }, 1000)

  // The real app runs term detection on each transcript. Simulate that load.
  let termCalls = 0
  const termLoad = WITH_ROLES ? setInterval(() => {
    if (!transcripts.length) return
    termCalls++
    terms.call('detectTerms', transcripts[transcripts.length - 1].text, '', 'Biology', 12).catch(() => {})
  }, 6000) : null

  await sleep(RUN_SECS * 1000)
  clearInterval(producer); clearInterval(flusher); clearInterval(pinger)
  if (termLoad) clearInterval(termLoad)

  console.log(`\n--- after ${RUN_SECS}s of real-time audio (electron${WITH_ROLES ? ' + llama/term contention' : ''}) ---`)
  console.log(`main posted ${posted} coalesced messages carrying ${(postedSamples / SR).toFixed(1)}s of audio`)
  console.log(`final transcripts while recording: ${transcripts.length}`)
  if (transcripts.length) {
    const lag = transcripts.map(t => t.at - tSession)
    console.log(`  first at ${(lag[0] / 1000).toFixed(1)}s into the session, last at ${(lag[lag.length - 1] / 1000).toFixed(1)}s`)
  }
  if (WITH_ROLES) console.log(`term-detection calls issued: ${termCalls}`)
  const tStop = Date.now()
  await tx.call('stopSession')
  console.log(`stopSession drain took ${Date.now() - tStop} ms  <- the size of the backlog`)
  console.log(`transcripts after drain: ${transcripts.length}`)
  app.exit(0)
})

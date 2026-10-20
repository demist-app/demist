// How much memory does a live desktop lecture actually need, per model
// combination? Two forked worker processes exactly as main.js runs them
// (transcribe + terms), transcription fed continuously at real time while
// term detection runs on lecture text, sampling each process's working set
// and private (committed) bytes the whole time.
//
// Written 2026-10-20 for the 8GB question: two 8GB students had ~240 failed
// term detections per lecture ("worker exited unexpectedly" / "still busy
// loading") and starved audio capture. Before changing tiers or bundling,
// measure what the pair really costs.
//
//   node test/footprint-8gb.js <transcribeTier> <llmTier> [seconds]
//   e.g. node test/footprint-8gb.js fast tiny 90
//
// Tiers are pinned with env overrides, never setTier: the app re-reads the
// tier files on every call (see feedback in memory: tests must not touch
// user state).
const { fork, execFileSync } = require('child_process')
const path = require('path')

const [transcribeTier = 'fast', llmTier = 'tiny', secsArg = '90'] = process.argv.slice(2)
const SECONDS = Number(secsArg)
const SR = 16000
const WORKER = path.join(__dirname, '..', 'native', 'worker.js')

function spawn(name) {
  const child = fork(WORKER, [], {
    env: { ...process.env, DEMIST_TRANSCRIBE_TIER: transcribeTier, DEMIST_LLM_TIER: llmTier },
    serialization: 'advanced',
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  })
  const pending = new Map()
  let nextId = 1
  const listeners = []
  child.on('message', (m) => {
    if (m.event) { listeners.forEach(fn => fn(m)); return }
    const e = pending.get(m.id); if (!e) return
    pending.delete(m.id); m.error ? e.reject(new Error(m.error)) : e.resolve(m.result)
  })
  child.on('exit', (code, sig) => console.log(`!! ${name} worker exited code=${code} signal=${sig}`))
  return {
    name, pid: child.pid,
    call: (type, ...args) => new Promise((res, rej) => { const id = nextId++; pending.set(id, { resolve: res, reject: rej }); child.send({ id, type, args }) }),
    feed: (a) => { const c = new Float32Array(a); child.send({ type: 'pcm', buffer: c.buffer }) },
    onEvent: (fn) => listeners.push(fn),
    kill: () => child.kill(),
  }
}

// Working set and private bytes for a set of pids, in MB, via PowerShell.
function sample(pids) {
  const out = execFileSync('powershell', ['-NoProfile', '-Command',
    `Get-Process -Id ${pids.join(',')} | ForEach-Object { "$($_.Id) $($_.WorkingSet64) $($_.PrivateMemorySize64)" }`], { encoding: 'utf8' })
  const res = {}
  for (const line of out.trim().split(/\r?\n/)) {
    const [pid, ws, priv] = line.trim().split(/\s+/).map(Number)
    res[pid] = { ws: Math.round(ws / 2 ** 20), priv: Math.round(priv / 2 ** 20) }
  }
  return res
}

const speechy = (secs) => Float32Array.from({ length: Math.round(secs * SR) }, (_, i) => {
  const t = i / SR
  return 0.25 * (Math.sin(2 * Math.PI * (140 + 40 * Math.sin(2 * Math.PI * 3 * t)) * t)
    + 0.5 * Math.sin(2 * Math.PI * 700 * t) * Math.sin(2 * Math.PI * 2.5 * t))
})
const sleep = ms => new Promise(r => setTimeout(r, ms))

const EXCERPTS = [
  'Chemiosmosis drives ATP synthase using the proton motive force across the inner mitochondrial membrane. This gradient is what couples respiration to ATP production.',
  'A Giffen good violates the law of demand. That happens because the income effect outweighs the substitution effect, so demand rises as the price rises.',
  'The enthalpy change of the reaction is measured by calorimetry. The activation energy determines the reaction rate, which is why a catalyst speeds things up.',
]

;(async () => {
  console.log(`transcribe=${transcribeTier} terms=${llmTier} for ${SECONDS}s`)
  const tx = spawn('transcribe'), terms = spawn('terms')
  const pids = [tx.pid, terms.pid]
  const peak = { [tx.pid]: { ws: 0, priv: 0 }, [terms.pid]: { ws: 0, priv: 0 } }
  const take = (label) => {
    const s = sample(pids)
    for (const p of pids) if (s[p]) { peak[p].ws = Math.max(peak[p].ws, s[p].ws); peak[p].priv = Math.max(peak[p].priv, s[p].priv) }
    if (label) console.log(`${label.padEnd(22)} transcribe ws ${s[tx.pid]?.ws}MB priv ${s[tx.pid]?.priv}MB | terms ws ${s[terms.pid]?.ws}MB priv ${s[terms.pid]?.priv}MB`)
  }
  take('idle')
  let t = Date.now(); await tx.call('preloadWhisper'); console.log(`whisper loaded in ${Date.now() - t}ms`); take('whisper loaded')
  t = Date.now(); await terms.call('preloadTermDetection'); console.log(`term model loaded in ${Date.now() - t}ms`); take('both loaded')

  let segments = 0
  tx.onEvent(m => { if (m.event === 'transcript') segments++ })
  await tx.call('startSession')
  const sampler = setInterval(() => take(), 2000)
  const audio = speechy(SECONDS)
  const batch = Math.round(SR * 0.1)
  const start = Date.now()
  let detections = 0, detectMs = 0
  // Detection loop runs alongside the real-time feed, like a lecture.
  const detecting = (async () => {
    let i = 0
    while (Date.now() - start < SECONDS * 1000) {
      const t0 = Date.now()
      await terms.call('detectTerms', EXCERPTS[i++ % EXCERPTS.length], '', 'Biology', 2, [])
      detections++; detectMs += Date.now() - t0
    }
  })()
  for (let i = 0; i < audio.length; i += batch) {
    tx.feed(audio.subarray(i, i + batch))
    const due = start + ((i + batch) / SR) * 1000
    const wait = due - Date.now(); if (wait > 0) await sleep(wait)
  }
  await detecting
  take('end of lecture')
  clearInterval(sampler)
  await tx.call('stopSession').catch(() => {})
  console.log(`segments ${segments}, detections ${detections}, avg detect ${detections ? Math.round(detectMs / detections) : '-'}ms`)
  const sum = (k) => peak[tx.pid][k] + peak[terms.pid][k]
  console.log(`PEAK transcribe ws ${peak[tx.pid].ws}MB priv ${peak[tx.pid].priv}MB | terms ws ${peak[terms.pid].ws}MB priv ${peak[terms.pid].priv}MB | total ws ${sum('ws')}MB priv ${sum('priv')}MB`)
  tx.kill(); terms.kill()
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })

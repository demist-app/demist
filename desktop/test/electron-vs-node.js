// Same worker, same model, same machine - run once under plain Node and once
// inside Electron's main process, and compare.
//
// This is the last variable left. Whisper alone is fast (21.6s of audio in
// ~3.4s), three-way model contention costs almost nothing (1.1x, worst timer
// drift 17ms), audio length/quality/idle time are all flat, and memory
// pressure down to 0.6GB free costs ~25%. Yet the shipped app measured the
// SAME 21.6s coalesced batch at 11287 ms and a 1.8s preview at 26154 ms.
// Everything that differs between those two numbers is Electron.
//
// A likely culprit is Windows 11 QoS: Chromium marks non-critical threads as
// background/EcoQoS, which parks them on efficiency cores at reduced clock.
// A worker_thread spawned inside the Electron main process can inherit that,
// and an ONNX inference pinned to E-cores is exactly the kind of several-fold
// slowdown seen here.
//
//   node test/electron-vs-node.js          # runs BOTH and prints a comparison
//   node test/electron-vs-node.js --child  # internal: the measurement itself
const path = require('path')
const os = require('os')

const SR = 16000
const AUDIO_SECS = 21.6

async function measure() {
  const { Worker } = require('worker_threads')
  const w = new Worker(path.join(__dirname, '..', 'native', 'worker.js'))
  let nextId = 1
  const pending = new Map()
  let onTranscript = null
  w.on('message', (m) => {
    if (m.event === 'transcript') { onTranscript?.(); return }
    if (m.event) return
    const e = pending.get(m.id); if (!e) return
    pending.delete(m.id); m.error ? e.reject(new Error(m.error)) : e.resolve(m.result)
  })
  const call = (type, ...args) => new Promise((res, rej) => {
    const id = nextId++; pending.set(id, { resolve: res, reject: rej })
    w.postMessage({ id, type, args })
  })
  const feed = (a) => { const c = new Float32Array(a); w.postMessage({ type: 'pcm', buffer: c.buffer }, [c.buffer]) }

  const audio = Float32Array.from({ length: Math.round(AUDIO_SECS * SR) }, (_, i) => {
    const t = i / SR
    return 0.25 * (Math.sin(2 * Math.PI * (140 + 40 * Math.sin(2 * Math.PI * 3 * t)) * t)
      + 0.5 * Math.sin(2 * Math.PI * 700 * t) * Math.sin(2 * Math.PI * 2.5 * t))
  })

  await call('preloadWhisper')
  const runs = []
  for (let r = 0; r < 2; r++) {
    const finished = new Promise(res => { onTranscript = res })
    await call('startSession')
    const t0 = Date.now()
    const batch = Math.round(SR * 0.1)
    for (let i = 0; i < audio.length; i += batch) feed(audio.subarray(i, i + batch))
    for (let i = 0; i < 20; i++) feed(new Float32Array(batch))
    await Promise.race([finished, new Promise(res => setTimeout(res, 120_000))])
    runs.push(Date.now() - t0)
    await call('stopSession')
  }
  await w.terminate()
  return Math.min(...runs)
}

if (process.argv.includes('--child')) {
  // Inside Electron, `app` exists and the process must be told to quit.
  let electronApp = null
  try { electronApp = require('electron').app } catch { /* plain node */ }
  const run = async () => {
    const ms = await measure()
    console.log(`RESULT ${ms}`)
    if (electronApp) electronApp.exit(0); else process.exit(0)
  }
  if (electronApp) electronApp.whenReady().then(run); else run()
} else {
  const { spawnSync } = require('child_process')
  const self = __filename
  const parse = (out) => {
    const m = /RESULT (\d+)/.exec(out || '')
    return m ? Number(m[1]) : null
  }
  console.log(`machine: ${os.cpus().length} cpus, ${os.cpus()[0].model}\n`)

  console.log('measuring under plain Node...')
  const nodeRun = spawnSync(process.execPath, [self, '--child'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const nodeMs = parse(nodeRun.stdout)

  console.log('measuring inside Electron...')
  const electronPath = require('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE // must boot as Electron, not as node
  const elRun = spawnSync(electronPath, [self, '--child'], { encoding: 'utf8', env, maxBuffer: 1 << 26 })
  const elMs = parse(elRun.stdout)

  console.log(`\n${AUDIO_SECS}s of audio, best of 2 runs each:`)
  console.log(`  plain Node : ${nodeMs === null ? 'FAILED' : nodeMs + ' ms'}`)
  console.log(`  Electron   : ${elMs === null ? 'FAILED' : elMs + ' ms'}`)
  if (nodeMs && elMs) {
    console.log(`\n  Electron is ${(elMs / nodeMs).toFixed(1)}x ${elMs > nodeMs ? 'SLOWER' : 'faster'}`)
  } else {
    console.log('\n  (a run failed; stderr below)')
    if (!nodeMs) console.log('node stderr:', (nodeRun.stderr || '').slice(0, 1500))
    if (!elMs) console.log('electron stderr:', (elRun.stderr || '').slice(0, 1500))
  }
  process.exit(0)
}

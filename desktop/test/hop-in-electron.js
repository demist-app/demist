// main.js -> worker thread is the only span left unaccounted for. In a real
// session the renderer delivers ~10 PCM batches/sec to main and the worker
// reports receiving 0.9/sec. Replicating that hop byte-for-byte under plain
// Node shows no loss at all (posted 9.0/sec, worker received 9.5/sec), so the
// difference is Electron.
//
// This runs the identical hop under both, and reports what the worker's own
// edge counter saw.
//
//   node test/hop-in-electron.js            # runs both, compares
//   node test/hop-in-electron.js --child    # internal
const path = require('path')
const SR = 16000
const SECONDS = 15

async function measure() {
  const { Worker } = require('worker_threads')
  const w = new Worker(path.join(__dirname, '..', 'native', 'worker.js'))
  let nextId = 1
  const pending = new Map()
  const rates = []
  w.on('message', (m) => {
    if (m.event === 'diag') {
      const hit = /worker received ([\d.]+) pcm msgs\/sec/.exec(m.payload.message)
      if (hit) rates.push(Number(hit[1]))
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
  const sleep = ms => new Promise(r => setTimeout(r, ms))

  await call('preloadWhisper')
  await call('startSession')

  // Byte-for-byte what ipcMain.on('demist:pcm') does.
  const frame = Math.round(SR * 0.1)
  let posted = 0
  const t0 = Date.now()
  while (Date.now() - t0 < SECONDS * 1000) {
    const f32 = new Float32Array(frame)
    const asBytes = new Uint8Array(f32.buffer)
    const copy = new Uint8Array(asBytes.length)
    copy.set(asBytes)
    w.postMessage({ type: 'pcm', buffer: copy.buffer }, [copy.buffer])
    posted++
    await sleep(100)
  }
  await sleep(600)
  await call('stopSession')
  await w.terminate()
  const postedRate = posted / ((Date.now() - t0) / 1000)
  const workerRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 0
  return { postedRate, workerRate }
}

if (process.argv.includes('--child')) {
  let electronApp = null
  try { electronApp = require('electron').app } catch { /* plain node */ }
  const run = async () => {
    const r = await measure()
    console.log(`RESULT posted=${r.postedRate.toFixed(1)} worker=${r.workerRate.toFixed(1)}`)
    if (electronApp) electronApp.exit(0); else process.exit(0)
  }
  if (electronApp) electronApp.whenReady().then(run); else run()
} else {
  const { spawnSync } = require('child_process')
  const parse = (out) => {
    const m = /RESULT posted=([\d.]+) worker=([\d.]+)/.exec(out || '')
    return m ? { posted: Number(m[1]), worker: Number(m[2]) } : null
  }
  console.log('posting 10 PCM msgs/sec, measuring what the worker actually receives\n')

  const nodeRun = spawnSync(process.execPath, [__filename, '--child'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const n = parse(nodeRun.stdout)
  const electronPath = require('electron')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const elRun = spawnSync(electronPath, [__filename, '--child'], { encoding: 'utf8', env, maxBuffer: 1 << 26 })
  const e = parse(elRun.stdout)

  console.log('host        posted/sec   worker received/sec')
  if (n) console.log(`plain Node  ${n.posted.toFixed(1).padStart(10)}   ${n.worker.toFixed(1).padStart(19)}`)
  else { console.log('plain Node  FAILED'); console.log((nodeRun.stderr || '').slice(0, 1000)) }
  if (e) console.log(`Electron    ${e.posted.toFixed(1).padStart(10)}   ${e.worker.toFixed(1).padStart(19)}`)
  else { console.log('Electron    FAILED'); console.log((elRun.stderr || '').slice(0, 1000)) }
  if (n && e) {
    const bad = e.worker < e.posted * 0.5
    console.log(`\n${bad ? 'REPRODUCED: Electron loses the messages on this hop' : 'not reproduced: the hop is healthy under Electron too'}`)
    process.exit(bad ? 1 : 0)
  }
  process.exit(2)
}

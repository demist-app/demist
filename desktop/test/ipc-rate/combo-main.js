// The exact real topology, which no earlier harness had: a BrowserWindow
// renderer sending at 10/sec, AND the real native/worker.js with the whisper
// model actually loaded, AND main forwarding from inside the ipcMain callback.
//
// hop-in-electron.js had the model but no window and passed (9.5/sec).
// forward-main.js had a window but a trivial worker and passed (150/150).
// The real app has both and delivers ~1/sec, with even the 5s keep-alive ping
// failing to arrive - so it is every message to that worker, not just PCM.
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { Worker } = require('worker_threads')

const worker = new Worker(path.join(__dirname, '..', '..', 'native', 'worker.js'))
let nextId = 1
const pending = new Map()
worker.on('message', (m) => {
  if (m.event === 'diag') { console.log('   [worker] ' + m.payload.message); return }
  if (m.event) return
  const e = pending.get(m.id); if (!e) return
  pending.delete(m.id); m.error ? e.reject(new Error(m.error)) : e.resolve(m.result)
})
const call = (type, ...args) => new Promise((res, rej) => {
  const id = nextId++; pending.set(id, { resolve: res, reject: rej }); worker.postMessage({ id, type, args })
})

let forwarded = 0
const COALESCE = process.argv.includes('--coalesce')
const INLINE = !process.argv.includes('--timer') && !COALESCE
// Coalescing: keep the SLOW inline-ish path but merge everything queued into
// ONE message per tick. If the worker's drain rate is a fixed messages/sec
// regardless of payload size, this delivers all the audio anyway.
let coalesceQueue = []
if (COALESCE) {
  setInterval(() => {
    if (!coalesceQueue.length) return
    let total = 0
    for (const c of coalesceQueue) total += c.length
    const merged = new Uint8Array(total)
    let o = 0
    for (const c of coalesceQueue) { merged.set(c, o); o += c.length }
    coalesceQueue = []
    worker.postMessage({ type: 'pcm', buffer: merged.buffer, mseq: ++forwarded }, [merged.buffer])
  }, 500)
}
let pending2 = []
ipcMain.on('rate:send', (_e, msg) => {
  if (COALESCE) {
    coalesceQueue.push(new Uint8Array(new Uint8Array(msg.buffer).length))
    return
  }
  if (INLINE) {
    const copy = new Uint8Array(new Uint8Array(msg.buffer).length)
    worker.postMessage({ type: 'pcm', buffer: copy.buffer, mseq: ++forwarded }, [copy.buffer])
  } else {
    pending2.push(new Uint8Array(new Uint8Array(msg.buffer).length))
  }
})
// Flush from a libuv timer instead of from inside Chromium's IPC dispatch.
let lateTimer = null
const flushTimer = setInterval(() => {
  if (INLINE || !pending2.length) return
  for (const copy of pending2) {
    worker.postMessage({ type: 'pcm', buffer: copy.buffer, mseq: ++forwarded }, [copy.buffer])
  }
  pending2 = []
}, 100)
if (process.argv.includes('--create-late')) {
  // What main.js should do: no timer at all until a session starts, then a
  // FRESH ref'd interval, cleared when the session ends.
  flushTimer.unref?.(); clearInterval(flushTimer)
  setTimeout(() => {
    console.log('   (creating a fresh ref-ed flush timer now)')
    lateTimer = setInterval(() => {
      if (INLINE || !pending2.length) return
      for (const copy of pending2) {
        worker.postMessage({ type: 'pcm', buffer: copy.buffer, mseq: ++forwarded }, [copy.buffer])
      }
      pending2 = []
    }, 100)
  }, 1000)
} else if (process.argv.includes('--unref-then-ref')) {
  // What main.js now does: idle-unref'd, then ref'd when a session starts.
  flushTimer.unref?.()
  setTimeout(() => { console.log('   (ref-ing the flush timer now)'); flushTimer.ref?.() }, 1000)
} else if (process.argv.includes('--unref')) {
  // The real app had .unref?.() here. An unref'd timer does not hold the loop
  // open, and Electron's main process pumps libuv from Chromium's message
  // pump - so it may be serviced far less often than its interval implies.
  flushTimer.unref?.()
}
// the same 5s keep-alive ping the app sends
setInterval(() => worker.postMessage({ id: nextId++, type: 'ping' }), 5000).unref?.()

ipcMain.on('rate:phase', () => {
  console.log(`\nmain forwarded ${forwarded} PCM messages; see the worker lines above for what arrived`)
  app.exit(0)
})

// The real app runs THREE workers with models loaded, not one. Every harness
// so far had only the transcribe worker.
const extraWorkers = []
function spawnExtra(type, arg) {
  const w = new Worker(path.join(__dirname, '..', '..', 'native', 'worker.js'))
  extraWorkers.push(w)
  w.on('message', () => {})
  w.postMessage({ id: 1, type, args: arg ? [arg] : [] })
  return w
}

app.whenReady().then(async () => {
  if (process.argv.includes('--three-workers')) {
    console.log('spawning terms + translate workers with their models, as the app does...')
    spawnExtra('preloadTermDetection')
    spawnExtra('preloadTranslation', 'hi')
  }
  console.log('loading whisper into the real worker (as the app does)...')
  await call('preloadWhisper')
  await call('startSession')
  console.log('model loaded, session started; renderer now sends 10/sec\n')
  const win = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } })
  win.loadFile(path.join(__dirname, 'combo.html'))
})

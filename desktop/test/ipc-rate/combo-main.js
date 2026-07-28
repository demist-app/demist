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
const INLINE = !process.argv.includes('--timer')
let pending2 = []
ipcMain.on('rate:send', (_e, msg) => {
  if (INLINE) {
    const copy = new Uint8Array(new Uint8Array(msg.buffer).length)
    worker.postMessage({ type: 'pcm', buffer: copy.buffer, mseq: ++forwarded }, [copy.buffer])
  } else {
    pending2.push(new Uint8Array(new Uint8Array(msg.buffer).length))
  }
})
// Flush from a libuv timer instead of from inside Chromium's IPC dispatch.
setInterval(() => {
  if (INLINE || !pending2.length) return
  for (const copy of pending2) {
    worker.postMessage({ type: 'pcm', buffer: copy.buffer, mseq: ++forwarded }, [copy.buffer])
  }
  pending2 = []
}, 100)
// the same 5s keep-alive ping the app sends
setInterval(() => worker.postMessage({ id: nextId++, type: 'ping' }), 5000).unref?.()

ipcMain.on('rate:phase', () => {
  console.log(`\nmain forwarded ${forwarded} PCM messages; see the worker lines above for what arrived`)
  app.exit(0)
})

app.whenReady().then(async () => {
  console.log('loading whisper into the real worker (as the app does)...')
  await call('preloadWhisper')
  await call('startSession')
  console.log('model loaded, session started; renderer now sends 10/sec\n')
  const win = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } })
  win.loadFile(path.join(__dirname, 'combo.html'))
})

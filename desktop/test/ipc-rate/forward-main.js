// Reproduces the REAL topology: a BrowserWindow renderer sending PCM-sized IPC
// at 10/sec, and main forwarding each one to a worker thread FROM INSIDE the
// ipcMain callback - which is what the app does and what no earlier harness
// did. Compares that against forwarding the same messages from a libuv timer.
//
// The suspicion: worker.postMessage called from within Chromium's IPC dispatch
// does not get its uv_async signalled promptly, so the worker's port drains at
// roughly 1/sec while the thread sits idle.
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { Worker } = require('worker_threads')

const worker = new Worker(path.join(__dirname, 'echo-worker.js'))
let received = 0
worker.on('message', (m) => { if (m.got) received = m.got })

let forwardedInline = 0
let queued = []
let mode = 'inline'

ipcMain.on('rate:send', (_e, msg) => {
  if (mode === 'inline') {
    // exactly what main.js does today
    const copy = new Uint8Array(new Uint8Array(msg.buffer).length)
    worker.postMessage({ type: 'pcm', buffer: copy.buffer }, [copy.buffer])
    forwardedInline++
  } else {
    queued.push(msg)
  }
})

// Timer-driven flush, in the libuv phase rather than Chromium's IPC dispatch.
setInterval(() => {
  if (mode !== 'timer' || !queued.length) return
  for (const msg of queued) {
    const copy = new Uint8Array(new Uint8Array(msg.buffer).length)
    worker.postMessage({ type: 'pcm', buffer: copy.buffer }, [copy.buffer])
  }
  queued = []
}, 100)

ipcMain.on('rate:phase', async (_e, phase) => {
  if (phase === 'inline-done') {
    console.log(`\nA) forwarded INLINE from the ipcMain callback (what the app does):`)
    console.log(`   main forwarded ${forwardedInline}, worker received ${received}`)
    mode = 'timer'; received = 0
    worker.postMessage({ type: 'reset' })
  } else {
    console.log(`\nB) forwarded from a libuv TIMER:`)
    console.log(`   main forwarded ${queued.length + (forwardedInline ? 0 : 0)}, worker received ${received}`)
    app.exit(0)
  }
})

app.whenReady().then(() => {
  const win = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } })
  win.loadFile(path.join(__dirname, 'forward.html'))
})

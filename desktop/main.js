// desktop/main.js: FULL REPLACEMENT
// Everything from the previous version is preserved verbatim in behavior:
// thin shell loading the deployed web app, lazy worker with crash recovery,
// wake lock via powerSaveBlocker, media permission handlers scoped to our
// origin, www-aware origin comparison. Additions: live-session IPC
// (start/stop/PCM feed) and forwarding of worker push events (transcript
// segments, model download progress) to the renderer.

const { app, BrowserWindow, ipcMain, session, powerSaveBlocker } = require('electron')
const path = require('path')
const { Worker } = require('worker_threads')

const APP_URL = process.env.DEMIST_DESKTOP_URL || 'https://www.demist.app'

function sameSite(urlA, urlB) {
  const strip = (h) => h.replace(/^www\./, '')
  return strip(new URL(urlA).hostname) === strip(new URL(urlB).hostname)
}

let mainWindow = null
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, '..', 'web', 'public', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.loadURL(APP_URL)
  mainWindow.on('closed', () => { mainWindow = null })
}

// ── Worker plumbing (lazy spawn per role, crash recovery, request/response + events) ─
// Three separate worker threads, not one shared thread, all running the same
// native/worker.js source. Each lazily requires only the module(s) main.js
// actually routes to it (whisper.js / llm.js / translate.js are all
// `x ??= require(...)`'d in worker.js), so this doesn't load anything extra.
// The reason for splitting: node-llama-cpp's session.prompt() and
// onnxruntime-node's pipeline() calls block the calling thread's event loop
// for the duration of inference, confirmed by real testing to make
// EVERYTHING feel delayed when all three shared one thread, a multi-second
// term-detection generation didn't just delay term cards, it also stalled
// transcription segments and even simple startSession/stopSession control
// messages, since they were all queued behind it on the same JS thread.
// Independent threads mean a slow Llama generation no longer blocks Whisper
// or translation (or vice versa); genuine CPU contention between them on
// weaker hardware is a separate, real hardware limit this doesn't remove.
const CALL_ROLE = {
  startSession: 'transcribe',
  stopSession: 'transcribe',
  preloadWhisper: 'transcribe',
  getTranscribeTier: 'transcribe',
  setTranscribeTier: 'transcribe',

  preloadTermDetection: 'terms',
  detectTerms: 'terms',
  getModelTier: 'terms',
  setModelTier: 'terms',

  preloadTranslation: 'translate',
  translate: 'translate',
}

const workerStates = {} // role -> { worker, pending: Map }
let nextRequestId = 1

function getWorkerState(role) {
  if (workerStates[role]) return workerStates[role]
  const worker = new Worker(path.join(__dirname, 'native', 'worker.js'))
  const state = { worker, pending: new Map() }
  worker.on('message', (msg) => {
    // Push events from the worker (transcript segments, model progress):
    // forward straight to the renderer on one channel, same as before, so
    // the renderer doesn't need to know or care that there are now three
    // workers instead of one.
    if (msg.event) {
      mainWindow?.webContents.send('demist:event', msg)
      return
    }
    const entry = state.pending.get(msg.id)
    if (!entry) return
    state.pending.delete(msg.id)
    if (msg.error) entry.reject(new Error(msg.error))
    else entry.resolve(msg.result)
  })
  worker.on('error', (err) => {
    for (const entry of state.pending.values()) entry.reject(err)
    state.pending.clear()
    workerStates[role] = null
  })
  // A native crash can kill the thread without 'error' firing (confirmed in
  // real testing previously): reset so the next call respawns fresh instead
  // of every future call hanging against a dead worker forever. Scoped to
  // this role only, so e.g. a term-detection crash doesn't touch an
  // in-progress transcription session on the 'transcribe' worker.
  worker.on('exit', () => {
    for (const entry of state.pending.values()) entry.reject(new Error('Native worker exited unexpectedly'))
    state.pending.clear()
    workerStates[role] = null
  })
  workerStates[role] = state
  return state
}

function callWorker(type, ...args) {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    const state = getWorkerState(CALL_ROLE[type])
    state.pending.set(id, { resolve, reject })
    state.worker.postMessage({ id, type, args })
  })
}

// ── Request/response bridge ────────────────────────────────────────────────
ipcMain.handle('demist:startSession', () => callWorker('startSession'))
ipcMain.handle('demist:stopSession', () => callWorker('stopSession'))
ipcMain.handle('demist:preloadWhisper', () => callWorker('preloadWhisper'))
ipcMain.handle('demist:preloadTermDetection', () => callWorker('preloadTermDetection'))
ipcMain.handle('demist:preloadTranslation', (_event, lang) => callWorker('preloadTranslation', lang))
ipcMain.handle('demist:translate', (_event, text, targetLang) => callWorker('translate', text, targetLang))
ipcMain.handle('demist:detectTerms', (_event, transcript, context, subject, year) =>
  callWorker('detectTerms', transcript, context, subject, year))
ipcMain.handle('demist:getModelTier', () => callWorker('getModelTier'))
ipcMain.handle('demist:setModelTier', (_event, tier) => callWorker('setModelTier', tier))
ipcMain.handle('demist:getTranscribeTier', () => callWorker('getTranscribeTier'))
ipcMain.handle('demist:setTranscribeTier', (_event, tier) => callWorker('setTranscribeTier', tier))

// ── PCM stream: high-frequency, fire-and-forget ─────────────────────────────
// The renderer->main hop is a structured-clone copy (see preload.js: Electron's
// ipcRenderer.postMessage can't transfer a raw ArrayBuffer). This hop, main
// process -> worker thread, is real zero-copy transfer: worker_threads'
// postMessage is Node's own implementation and does support it.
ipcMain.on('demist:pcm', (_event, message) => {
  const buffer = message.buffer
  getWorkerState('transcribe').worker.postMessage({ type: 'pcm', buffer }, [buffer])
})

// ── Wake lock (powerSaveBlocker; navigator.wakeLock never grants in Electron,
//    confirmed previously against Electron's own permission type definitions) ─
let wakeLockId = null
ipcMain.handle('demist:wakeLockStart', () => {
  if (wakeLockId === null || !powerSaveBlocker.isStarted(wakeLockId)) {
    wakeLockId = powerSaveBlocker.start('prevent-display-sleep')
  }
})
ipcMain.handle('demist:wakeLockStop', () => {
  if (wakeLockId !== null && powerSaveBlocker.isStarted(wakeLockId)) {
    powerSaveBlocker.stop(wakeLockId)
  }
  wakeLockId = null
})

app.whenReady().then(() => {
  // session.defaultSession only exists once the app is ready (confirmed
  // previously: top-level access threw). 'media' covers mic/camera/screen,
  // 'unknown' is Electron's catch-all; both request AND check handlers are
  // needed or the check step silently blocks before request ever runs.
  // Scoped to our own origin.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = permission === 'media' || permission === 'unknown'
    callback(allowed && sameSite(webContents.getURL(), APP_URL))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const allowed = permission === 'media' || permission === 'unknown'
    return allowed && sameSite(requestingOrigin || webContents?.getURL() || APP_URL, APP_URL)
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

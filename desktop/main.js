// Electron shell for Demist. Deliberately thin: the window loads the same
// web app you already deploy to Vercel (so UI changes ship the normal way,
// no separate desktop release needed for them): the only new thing this
// process adds is native, on-device transcription/translation/term
// detection, exposed to that web page through the preload bridge below.
// Nothing audio- or text-related that touches these handlers ever leaves
// the machine.

const { app, BrowserWindow, ipcMain, session, powerSaveBlocker } = require('electron')
const path = require('path')
const { Worker } = require('worker_threads')

// Point at your own deployment in production; override for local dev against
// `npm run dev` in web/, e.g. DEMIST_DESKTOP_URL=http://localhost:3000
//
// www, not the apex domain: demist.app redirects to www.demist.app in
// production (confirmed: DevTools showed www.demist.app as the actually-
// served origin). Starting at the apex meant the permission check below
// compared against the pre-redirect origin and silently failed after the
// browser followed it, denying microphone access with no visible error
// beyond the app's own "Microphone access is needed" alert.
const APP_URL = process.env.DEMIST_DESKTOP_URL || 'https://www.demist.app'

// Compares hostnames with any leading "www." stripped from both sides, so
// this stays correct regardless of which direction a redirect goes (or
// whether one happens at all) rather than requiring an exact string match
// against whatever APP_URL happens to be.
function sameSite(urlA, urlB) {
  const strip = (h) => h.replace(/^www\./, '')
  return strip(new URL(urlA).hostname) === strip(new URL(urlB).hostname)
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, '..', 'web', 'public', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadURL(APP_URL)
}

// Spawned lazily, on first actual use: whisper/llama.cpp bindings are heavy
// to load and most sessions won't touch all three. Runs on its own thread
// (see native/worker.js for why) rather than in this process directly.
let worker = null
let nextRequestId = 1
const pending = new Map()

function getWorker() {
  if (worker) return worker
  worker = new Worker(path.join(__dirname, 'native', 'worker.js'))
  worker.on('message', ({ id, result, error }) => {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    if (error) entry.reject(new Error(error))
    else entry.resolve(result)
  })
  worker.on('error', (err) => {
    for (const entry of pending.values()) entry.reject(err)
    pending.clear()
    worker = null // next call respawns a fresh worker
  })
  // A native crash (e.g. the LLM's own process running out of memory) can
  // kill the thread outright without ever emitting 'error': confirmed by
  // real testing that a second recording session went completely dead with
  // no console output at all, which matches postMessage silently going to a
  // dead worker forever rather than throwing. Without this, `worker` stayed
  // set to the dead instance and every future call hung with no response.
  worker.on('exit', () => {
    for (const entry of pending.values()) entry.reject(new Error('Native worker exited unexpectedly'))
    pending.clear()
    worker = null
  })
  return worker
}

function callWorker(type, ...args) {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    pending.set(id, { resolve, reject })
    getWorker().postMessage({ id, type, args })
  })
}

ipcMain.handle('demist:transcribe', (_event, audioBuffer, mimeType) => callWorker('transcribe', audioBuffer, mimeType))
ipcMain.handle('demist:translate', (_event, text, targetLang) => callWorker('translate', text, targetLang))
ipcMain.handle('demist:detectTerms', (_event, transcript, context) => callWorker('detectTerms', transcript, context))
ipcMain.handle('demist:getModelTier', () => callWorker('getModelTier'))
ipcMain.handle('demist:setModelTier', (_event, tier) => callWorker('setModelTier', tier))

// Screen Wake Lock via the web navigator.wakeLock API never actually grants
// inside Electron: confirmed by real testing that the request still fails
// with NotAllowedError even with both setPermissionRequestHandler and
// setPermissionCheckHandler allowing it below — Electron's permission
// checker doesn't include a 'wake-lock' or matching 'unknown' case in the
// check step at all (confirmed from Electron's own type definitions: the
// permission union setPermissionCheckHandler accepts has no such entry).
// powerSaveBlocker is Electron's own, actually-working equivalent, so the
// web app calls this bridge instead when running inside the desktop app.
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
  // session.defaultSession doesn't exist until the app is ready: this has
  // to run in here, not at module top-level (confirmed by real testing:
  // that threw "Session can only be received when app is ready").
  //
  // Explicit, not relying on Electron's default: 'media' covers mic/camera/
  // screen-recording as one permission. 'unknown' is Electron's catch-all
  // for permission types it has no specific name for. Both the request and
  // check handlers need this (most web permission APIs check, then request
  // only if the check was denied) or the check step silently blocks things
  // before the request handler ever runs. Scoped to our own origin so a
  // stray iframe or redirect can't silently piggyback either.
  //
  // Screen Wake Lock does NOT go through here despite living in the same
  // permission-plumbing family: see the powerSaveBlocker bridge above for
  // why and what actually handles it instead.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = permission === 'media' || permission === 'unknown'
    callback(allowed && sameSite(webContents.getURL(), APP_URL))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const allowed = permission === 'media' || permission === 'unknown'
    return allowed && sameSite(requestingOrigin, APP_URL)
  })
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

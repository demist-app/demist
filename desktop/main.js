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
  summarize: 'terms',
  getModelTier: 'terms',
  setModelTier: 'terms',

  preloadTranslation: 'translate',
  translate: 'translate',
}

const workerStates = {} // role -> { worker, pending: Map }
let nextRequestId = 1
// Whether a live transcription session is meant to be running on the
// 'transcribe' worker, so its death can be reported rather than swallowed.
let transcribeSessionActive = false

function getWorkerState(role) {
  if (workerStates[role]) return workerStates[role]
  const worker = new Worker(path.join(__dirname, 'native', 'worker.js'))
  // lastMessageAt is the liveness signal used by the call timeout below. Model
  // loading emits a steady stream of progress events, so a worker that is
  // merely blocked in a long synchronous native call still looks alive here,
  // while one that died without firing 'error'/'exit' goes quiet entirely.
  const state = { worker, pending: new Map(), lastMessageAt: Date.now() }
  worker.on('message', (msg) => {
    state.lastMessageAt = Date.now()
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
  worker.on('exit', (code) => {
    console.error(`[demist] the ${role} worker exited (code ${code}); every model it had loaded is gone and must be reloaded`)
    for (const entry of state.pending.values()) entry.reject(new Error('Native worker exited unexpectedly'))
    state.pending.clear()
    workerStates[role] = null
    // Tell the renderer unconditionally, not just mid-session. A worker that
    // dies while IDLE used to be completely silent: the preload that warmed it
    // had already resolved, so the record button stayed unlocked and claimed
    // the models were ready, while the replacement worker spawned on the next
    // call had nothing loaded at all. The model then reloaded inside
    // startSession - measured at 50s in a real session, against a UI insisting
    // everything was prepared. The renderer relocks and re-preloads on this.
    mainWindow?.webContents.send('demist:event', {
      event: 'modelsUnloaded',
      payload: { role },
    })
    // A replacement transcribe worker starts with no session (activeSession
    // lives in that thread's module state), so feedPcm on it silently
    // discards every frame. Recording would carry on looking healthy while
    // transcribing nothing at all, for the rest of the lecture. Tell the
    // renderer instead of letting it find out never.
    if (role === 'transcribe' && transcribeSessionActive) {
      transcribeSessionActive = false
      mainWindow?.webContents.send('demist:event', {
        event: 'sessionLost',
        payload: { message: 'On-device transcription stopped unexpectedly. Stop and restart the recording to resume.' },
      })
    }
  })
  workerStates[role] = state
  return state
}

// Control messages that must be near-instant once their model is loaded, and
// the ceiling we give each before declaring the worker unhealthy. Deliberately
// NOT applied to preloads or inference (detectTerms/summarize/translate): a
// first-run model download legitimately takes minutes and a llama.cpp
// generation many seconds, so a timeout there would break working features.
//
// This exists because a worker thread can die from a native crash without
// ever firing 'error' or 'exit' (see the exit handler above - that was
// confirmed in real testing). When that happened there was nothing to settle
// the pending promise, so ipcRenderer.invoke('demist:startSession') hung
// forever: the renderer sat at `await native.startSession()`, never reached
// the point where it attaches the AudioWorklet, and recording appeared to be
// running while capturing precisely nothing, with no error anywhere. Confirmed
// against a real session - the renderer log stopped dead at
// "startNativeSession: starting" with neither a success nor a failure line.
// Generous, because "no reply yet" does NOT mean "broken". onnxruntime's
// model load and session build are synchronous native calls that block the
// worker's whole event loop, so a startSession posted while the transcribe
// worker is still loading whisper sits unprocessed until that finishes. A
// tighter 30s ceiling was confirmed in real testing to fire against a
// perfectly healthy worker mid-load and throw away the model it had just
// spent that time loading, which is worse than the hang it was added for.
const CALL_TIMEOUT_MS = {
  startSession: 120_000,
  stopSession: 120_000,
  getTranscribeTier: 60_000,
  setTranscribeTier: 60_000,
  getModelTier: 60_000,
  setModelTier: 60_000,
}
// How long a worker must be COMPLETELY silent - no progress events, no
// replies - before a timeout is treated as death rather than slowness.
const WORKER_SILENT_MS = 60_000

function callWorker(type, ...args) {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    const role = CALL_ROLE[type]
    const state = getWorkerState(role)
    const timeoutMs = CALL_TIMEOUT_MS[type]
    let timer = null
    if (timeoutMs) {
      timer = setTimeout(() => {
        if (!state.pending.has(id)) return
        state.pending.delete(id)
        // Only tear the worker down if it has gone genuinely silent. A worker
        // blocked in a synchronous native call is still emitting progress
        // events right up to the moment it blocks, so recent traffic means
        // "busy", not "dead", and terminating it would discard a model load
        // in progress and guarantee the next attempt starts from scratch.
        // Killing a healthy-but-slow worker is the more damaging mistake.
        const quietFor = Date.now() - state.lastMessageAt
        if (quietFor >= WORKER_SILENT_MS) {
          console.error(`[demist] '${type}' got no reply from the ${role} worker in ${timeoutMs}ms and it has been silent for ${quietFor}ms; restarting it`)
          try { state.worker.terminate() } catch { /* already gone */ }
          if (workerStates[role] === state) workerStates[role] = null
          reject(new Error(`On-device ${role} engine stopped responding. Try starting the recording again.`))
        } else {
          console.error(`[demist] '${type}' got no reply from the ${role} worker in ${timeoutMs}ms, but it was active ${quietFor}ms ago - leaving it alone (still busy)`)
          reject(new Error(`The on-device ${role} engine is still busy loading. Try starting the recording again in a moment.`))
        }
      }, timeoutMs)
    }
    state.pending.set(id, {
      resolve: (v) => { if (timer) clearTimeout(timer); resolve(v) },
      reject: (e) => { if (timer) clearTimeout(timer); reject(e) },
    })
    state.worker.postMessage({ id, type, args })
  })
}

// ── Request/response bridge ────────────────────────────────────────────────
ipcMain.handle('demist:startSession', async () => {
  const result = await callWorker('startSession')
  transcribeSessionActive = true
  return result
})
ipcMain.handle('demist:stopSession', async () => {
  transcribeSessionActive = false
  return callWorker('stopSession')
})
ipcMain.handle('demist:preloadWhisper', () => callWorker('preloadWhisper'))
ipcMain.handle('demist:preloadTermDetection', () => callWorker('preloadTermDetection'))
ipcMain.handle('demist:preloadTranslation', (_event, lang) => callWorker('preloadTranslation', lang))
ipcMain.handle('demist:translate', (_event, text, targetLang) => callWorker('translate', text, targetLang))
ipcMain.handle('demist:detectTerms', (_event, transcript, context, subject, year) =>
  callWorker('detectTerms', transcript, context, subject, year))
ipcMain.handle('demist:summarize', (_event, termRows, subject) => callWorker('summarize', termRows, subject))
ipcMain.handle('demist:getModelTier', () => callWorker('getModelTier'))
ipcMain.handle('demist:setModelTier', (_event, tier) => callWorker('setModelTier', tier))
ipcMain.handle('demist:getTranscribeTier', () => callWorker('getTranscribeTier'))
ipcMain.handle('demist:setTranscribeTier', (_event, tier) => callWorker('setTranscribeTier', tier))

// ── PCM stream: high-frequency, fire-and-forget ─────────────────────────────
// The renderer->main hop is a structured-clone copy (see preload.js: Electron's
// ipcRenderer.postMessage can't transfer a raw ArrayBuffer). This hop, main
// process -> worker thread, is meant to be a real zero-copy transfer: worker_threads'
// postMessage is Node's own implementation and does support it.
//
// message.buffer as it arrives here is reconstructed by Electron's own IPC
// internals, not Node's - confirmed by real testing that passing it straight
// into worker.postMessage's transferList crashes the main process outright
// with "DataCloneError: Found invalid value in transferList" on every single
// PCM frame (Node's worker_threads transfer check doesn't recognize it as a
// genuine transferable ArrayBuffer, even though it behaves like one). That
// crash silently killed transcription entirely, on every capture mode,
// regardless of what audio was actually said. Copying the bytes into a
// freshly-allocated, genuinely Node-native ArrayBuffer before transferring
// fixes it; the copy cost is negligible for a PCM frame this small.
// Counted so the renderer -> main and main -> worker hops can be told apart.
// A real session had the worklet producing a full 375 frames/sec while the
// worker received only ~0.36 PCM messages/sec, so ~96% of the audio was being
// lost somewhere in this path, and nothing on either side could say where.
let pcmReceived = 0
let pcmForwarded = 0
let pcmBytes = 0
let pcmDropped = 0
let lastPcmReport = Date.now()

ipcMain.on('demist:pcm', (_event, message) => {
  pcmReceived++
  try {
    const src = new Uint8Array(message.buffer)
    const copy = new Uint8Array(src.length)
    copy.set(src)
    getWorkerState('transcribe').worker.postMessage({ type: 'pcm', buffer: copy.buffer }, [copy.buffer])
    pcmForwarded++
    pcmBytes += copy.length
  } catch (err) {
    // Previously unguarded, and this runs per PCM message: a throw here was
    // silent and simply lost that audio.
    pcmDropped++
    if (pcmDropped <= 3) console.error('[demist] failed to forward a PCM message to the transcribe worker:', err)
  }
  const now = Date.now()
  if (now - lastPcmReport >= 5000) {
    const secs = (now - lastPcmReport) / 1000
    console.log(
      `[demist] pcm bridge: main received ${(pcmReceived / secs).toFixed(1)}/sec, ` +
      `forwarded ${(pcmForwarded / secs).toFixed(1)}/sec ` +
      `(${(pcmBytes / 4 / 16000).toFixed(1)}s of audio), ${pcmDropped} dropped`,
    )
    pcmReceived = 0; pcmForwarded = 0; pcmBytes = 0; pcmDropped = 0
    lastPcmReport = now
  }
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
  // "Tab capture" (lib/tabCapture.ts) getDisplayMedia() calls reject in
  // Electron with no handler registered at all: that's why this was
  // disabled here previously. Electron has no concept of tabs (unlike real
  // Chrome, which mixes each tab's audio independently), so the closest
  // available primitive is Windows' system-audio loopback device, which
  // captures everything currently playing on the machine, not one isolated
  // source. 'loopback' is documented by Electron as Windows-only, so this is
  // deliberately not registered on other platforms: without a handler,
  // getDisplayMedia() just rejects there instead of misbehaving.
  if (process.platform === 'win32') {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      callback({ audio: 'loopback' })
    })
  }
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

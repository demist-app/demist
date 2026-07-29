// desktop/main.js: FULL REPLACEMENT
// Everything from the previous version is preserved verbatim in behavior:
// thin shell loading the deployed web app, lazy worker with crash recovery,
// wake lock via powerSaveBlocker, media permission handlers scoped to our
// origin, www-aware origin comparison. Additions: live-session IPC
// (start/stop/PCM feed) and forwarding of worker push events (transcript
// segments, model download progress) to the renderer.

const { app, BrowserWindow, ipcMain, session, powerSaveBlocker } = require('electron')
const path = require('path')
const { fork } = require('child_process')

// native/worker.js is asarUnpack'd (see electron-builder.yml), because a child
// process cannot execute a script from inside an asar archive. In a packaged
// build __dirname points at app.asar, so the unpacked twin has to be named
// explicitly; in development the replace is a no-op.
const NATIVE_DIR = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'native')

const APP_URL = process.env.DEMIST_DESKTOP_URL || 'https://www.demist.app'

// A fingerprint of THIS file, computed from its own bytes at startup. Reported
// with every session so a log can never again be ambiguous about which build
// produced it - "did the app get restarted with the fix" has cost a full round
// of debugging at least once, because nothing in the output identified the
// desktop-side code. Changes automatically whenever main.js changes; there is
// no version constant to forget to bump.
const MAIN_BUILD = (() => {
  try {
    return require('crypto').createHash('sha1')
      .update(require('fs').readFileSync(__filename)).digest('hex').slice(0, 8)
  } catch { return 'unknown' }
})()

// Verbose tracing, off unless DEMIST_DEBUG=1. These lines were invaluable
// while diagnosing a session that would not start, but they are per-recording
// or per-5-seconds noise in a shipping build, and they bury the errors that
// actually matter. Errors and warnings are never routed through this.
const DEBUG = process.env.DEMIST_DEBUG === '1'
const dlog = (...args) => { if (DEBUG) console.log(...args) }

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
// Three separate worker PROCESSES, not worker threads, all running the same
// native/worker.js source. Each lazily requires only the module(s) main.js
// actually routes to it (whisper.js / llm.js / translate.js are all
// `x ??= require(...)`'d in worker.js), so this doesn't load anything extra.
//
// They were worker threads until transcription was measured landing 45-50
// seconds behind the speaker. A worker thread inside Electron's main process
// running onnxruntime does not get scheduled: measured on the shipping
// topology with real speech at real time (test/realtime-in-electron.js), one
// core spins for 20-30 seconds after the model loads while the transcribe
// thread's own event loop ticks 0 times out of an expected 60 per five
// seconds, a no-op 'ping' takes 20s to come back, and PCM sits undelivered in
// its port queue for 15+ seconds before arriving in a flood. It is not a
// message-bridge problem - the messages are posted on time and nothing is
// lost - the thread simply is not running, which is why several rounds of
// fixes aimed at the bridge (coalescing, flush timers, ref/unref) all failed
// to move it.
//
// The identical code in a plain Node process does not do this. Measured side
// by side on the same machine, same speech, same models
// (test/child-process-host.js):
//
//   worker thread in Electron main : first text 38s in, 10.6s behind and
//                                    growing, 8 segments backlogged,
//                                    inferences 3.3-11.3s
//   forked Node child process      : first text 10.7s in, then steady at
//                                    1.8-2.3s behind, no backlog at all,
//                                    inferences 1.7-2.2s
//
// fork() with ELECTRON_RUN_AS_NODE runs the Electron binary as plain Node, so
// this is the same runtime and the same native modules, just not sharing a
// process with Chromium. It also means a native crash in llama.cpp or
// onnxruntime can no longer take the whole app down with it.
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
  keepWhisperWarm: 'transcribe',
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

// 'ping' is deliberately absent from CALL_ROLE: it is posted directly to every
// existing worker by keepWorkersWarm below, never routed to one role.

const workerStates = {} // role -> { worker, pending: Map }
const workerSpawns = {} // role -> how many times a worker has been created
let nextRequestId = 1
// Whether a live transcription session is meant to be running on the
// 'transcribe' worker, so its death can be reported rather than swallowed.
let transcribeSessionActive = false

function getWorkerState(role) {
  if (workerStates[role]) return workerStates[role]
  workerSpawns[role] = (workerSpawns[role] || 0) + 1
  const worker = fork(path.join(NATIVE_DIR, 'worker.js'), [], {
    // Runs the Electron binary as plain Node: same runtime, same prebuilt
    // native modules, none of Chromium's process.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    // Structured clone rather than JSON. PCM is an ArrayBuffer, and the
    // default 'json' serializer would turn a 12000-sample Float32Array into a
    // JSON object of 12000 numbered keys - many times the bytes, and it does
    // not survive the round trip as a buffer at all.
    serialization: 'advanced',
    // The child's stdout/stderr join the main process's, so everything
    // native/*.js logs still reaches a terminal exactly as it did from a
    // thread. 'ipc' is required for send()/on('message').
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  })
  console.warn(`[demist] spawned ${role} worker #${workerSpawns[role]} (pid ${worker.pid}); a respawn means every model it had is gone`)
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

// Heartbeat while any worker call is outstanding. A startSession that never
// resolves has now been seen twice with no output from either side, leaving
// no way to tell "the main process is blocked and never posted the message"
// apart from "the worker has it and is not answering". This prints from the
// main process's own timer, so it stops if the main process itself is stuck.
setInterval(() => {
  const waiting = []
  for (const [role, state] of Object.entries(workerStates)) {
    if (state && state.pending.size > 0) {
      waiting.push(`${role}: ${state.pending.size} pending, last heard from ${Date.now() - state.lastMessageAt}ms ago`)
    }
  }
  if (waiting.length) dlog(`[demist] worker calls outstanding -> ${waiting.join(' | ')}`)
}, 5000).unref?.()

// Keep idle workers from being paged out from under us.
//
// Measured on a real session: the Electron process sat at 7458MB committed
// against 4471MB resident (peak 7278MB) on a 15.9GB machine with 2.8GB free -
// Windows had trimmed ~3GB of it to disk. The transcribe worker then went 63
// SECONDS without answering a startSession, and answered it in 1ms once it
// did, because nothing was computing: the thread's own stack and heap had to
// be faulted back off disk before it could read a single message. From the
// renderer that is indistinguishable from a hung engine, and it is exactly
// what "the on-device transcription engine hasn't responded in Ns" was
// reporting.
//
// A no-op message every few seconds keeps each worker's stack and heap in the
// working set and the thread recently scheduled, which is what the paging
// heuristics key on. This is cheap on purpose - the handler does literally
// nothing, so the cost is one message round trip per worker per interval, not
// inference - and it is not a substitute for the process simply being smaller
// (see the q8 changes in native/translate.js and the KV cache cap in
// native/llm.js). It also does NOT keep the model WEIGHTS resident: those
// pages are only touched during inference, which is a separate and slower
// symptom (one segment measured 103199 ms for 2.7s of audio, against 2-4s for
// its neighbours, on the first inference after a trim).
//
// Only pings workers that already exist - it must never be the thing that
// spawns one, or it would load models nobody asked for.
const KEEP_WARM_MS = 5000
setInterval(() => {
  for (const [role, state] of Object.entries(workerStates)) {
    if (!state) continue
    const id = nextRequestId++
    // No pending entry and no timeout: the reply is only wanted for its side
    // effect of updating lastMessageAt, and an unmatched id is already
    // ignored by the message handler above.
    try { state.worker.send({ id, type: 'ping' }) } catch { /* worker is going away; its exit handler will clean up */ }
  }
}, KEEP_WARM_MS).unref?.()

// The ping above keeps the transcribe worker's stack and heap resident, but
// the model's WEIGHTS are only touched during inference and get trimmed
// separately. The cost of that lands entirely on the user: in a real session
// the FIRST preview of a recording took 17191 ms while every later one took
// 2787 and 3150 ms - same model, same 1.8s of audio - so the one inference a
// user is actually waiting on, to see their first words appear, was the one
// paying to fault the weights back off disk.
//
// A short throwaway inference every 30s while IDLE keeps them resident. It is
// skipped outright during a recording (whisper.js's keepWarm refuses when a
// session is active) and never triggers a model load, so on a machine where
// transcription has not been used it costs nothing at all.
//
// 30s, not the 60s this used to be, because startSession now SKIPS its own
// warm-up when an inference has touched the weights inside whisper.js's
// WARM_VALID_MS (45s) - and that is what takes starting a recording from 14
// seconds down to under one. This interval has to stay comfortably under that
// window or the skip never applies and every session pays the cold-start cost
// again. If either number changes, change both.
//
// The cost is ~1.7s of CPU per 30s on one already-loaded model, and
// keepWarm's own timing is logged when it looks like the weights were trimmed
// anyway, which is the signal that even this cadence is too slow here.
const WEIGHT_WARM_MS = 30_000
setInterval(() => {
  if (transcribeSessionActive || !workerStates.transcribe) return
  callWorker('keepWhisperWarm').catch(() => { /* idle upkeep; a failure here is not worth reporting */ })
}, WEIGHT_WARM_MS).unref?.()

function callWorker(type, ...args) {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++
    const role = CALL_ROLE[type]
    const state = getWorkerState(role)
    if (type === 'startSession' || type === 'stopSession') {
      dlog(`[demist] -> posting '${type}' (id ${id}) to the ${role} worker`)
    }
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
          try { state.worker.kill() } catch { /* already gone */ }
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
    state.worker.send({ id, type, args })
  })
}

// ── Request/response bridge ────────────────────────────────────────────────
ipcMain.handle('demist:startSession', async () => {
  dlog('[demist] renderer asked for a transcription session')
  const t = Date.now()
  try {
    const result = await callWorker('startSession')
    transcribeSessionActive = true
    startPcmFlushing()
    // Says outright which desktop build is running and that the per-session
    // PCM flush timer has been created (the fix for the ~1/sec drain).
    mainWindow?.webContents.send('demist:event', {
      event: 'diag',
      payload: { message: `main.js build ${MAIN_BUILD} | PCM flush timer created (${PCM_FLUSH_MS}ms, coalescing into one message per tick)` },
    })
    // Reset the PCM window. lastPcmReport was initialised at module load, so
    // the first report after a session started divided by the time since APP
    // LAUNCH - it reported "0.1/sec" for a bridge that was actually carrying
    // ~10/sec, and sent a whole investigation after a hop that was fine.
    pcmReceived = 0; pcmForwarded = 0; pcmBytes = 0; pcmDropped = 0
    pcmMaxSeq = 0; pcmSeqBase = 0
    lastPcmReport = Date.now()
    // Only worth a line when it was slow enough for a user to notice.
    if (Date.now() - t > 3000) console.warn(`[demist] transcription session took ${Date.now() - t} ms to start`)
    else dlog(`[demist] transcription session started in ${Date.now() - t} ms`)
    return result
  } catch (err) {
    console.error(`[demist] starting the transcription session FAILED after ${Date.now() - t} ms:`, err?.message ?? err)
    throw err
  }
})
ipcMain.handle('demist:stopSession', async () => {
  transcribeSessionActive = false
  stopPcmFlushing()
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
// ipcRenderer.postMessage can't transfer a raw ArrayBuffer). This hop,
// main process -> worker process, is a structured-clone copy too, over the
// fork() IPC channel with serialization: 'advanced'. There is no transferList
// any more, and nothing to get wrong about one: transferring was only ever an
// optimisation, it needed a defensive re-copy to avoid crashing the main
// process outright with "DataCloneError: Found invalid value in transferList"
// (Electron reconstructs the incoming ArrayBuffer with its own IPC internals,
// and Node's transfer check refuses it), and a PCM frame is a few kilobytes.
// Counted so the renderer -> main and main -> worker hops can be told apart.
// A real session had the worklet producing a full 375 frames/sec while the
// worker received only ~0.36 PCM messages/sec, so ~96% of the audio was being
// lost somewhere in this path, and nothing on either side could say where.
let pcmReceived = 0
let pcmMaxSeq = 0
// main's own monotonic stamp, so the worker can report WHICH messages it saw.
// Counts alone give the size of the loss; the pattern gives its shape - every
// Nth message means throttling, a clean cut at message K means the receiver
// changed underneath us.
let pcmMainSeq = 0
// PCM waiting to be handed to the worker, drained by the flush timer below.
const pcmQueue = []
// ~20 seconds of audio at 10 frames/sec. A bound is needed because this grows
// if the worker ever stops consuming; past it the OLDEST frame goes, since the
// recent speech is the salvageable part.
const PCM_QUEUE_MAX = 200
// One coalesced message per tick, so this is also the message rate offered to
// the transcribe worker. It was 750ms to stay under a drain rate the old
// worker THREAD could sustain (~1/sec); the worker is a process now and keeps
// up with everything main can send, so this is back to being purely about
// batching. It is straight latency - audio sits here for up to this long
// before the segmenter ever sees it - so it wants to be small, and 250ms is
// small against a ~2s end-to-end lag while still batching two or three
// renderer frames into each hop.
const PCM_FLUSH_MS = 250

// Deliberately NOT unref'd while a session is running. An unref'd timer does
// not hold the event loop open, and Electron's main process pumps libuv from
// Chromium's message pump - so an unref'd 50ms timer is serviced roughly once
// a SECOND rather than twenty times. Measured on the real topology, changing
// nothing but this:
//
//   flush timer ref'd:  worker got 9.5/sec, audio in 18.5s over 20.0s
//   flush timer unref'd: worker got 1.7/sec, audio in  4.9s over 21.3s
//
// Never unref'd, and never re-ref'd after an unref, because ref() does NOT
// undo an unref() here - that was measured directly. It is created fresh when
// a session starts and cleared when it ends, so an idle app is not holding the
// loop hot for a queue that is always empty.
let pcmFlushTimer = null

function startPcmFlushing() {
  if (pcmFlushTimer) return
  pcmFlushTimer = setInterval(() => {
    if (!pcmQueue.length) return
    // COALESCE everything queued into ONE message: one IPC hop per tick
    // instead of one per renderer frame, for identical audio.
    let total = 0
    for (const c of pcmQueue) total += c.length
    const merged = new Uint8Array(total)
    let offset = 0
    for (const c of pcmQueue) { merged.set(c, offset); offset += c.length }
    pcmQueue.length = 0
    try {
      // postedAt lets the worker report how LATE each message was, not just
      // how many arrived. Those two look identical in a rate and have opposite
      // causes (main never posted vs. the worker never read), and confusing
      // them is what sent this investigation after the wrong component twice.
      getWorkerState('transcribe').worker.send(
        { type: 'pcm', buffer: merged.buffer, mseq: ++pcmMainSeq, postedAt: Date.now() })
      pcmForwarded++
      pcmBytes += total
    } catch (err) {
      pcmDropped++
      if (pcmDropped <= 3) console.error('[demist] failed to forward PCM to the transcribe worker:', err)
    }
  }, PCM_FLUSH_MS)
}

function stopPcmFlushing() {
  if (!pcmFlushTimer) return
  clearInterval(pcmFlushTimer)
  pcmFlushTimer = null
  pcmQueue.length = 0
}
let pcmSeqBase = 0
let pcmForwarded = 0
let pcmBytes = 0
let pcmDropped = 0
let lastPcmReport = Date.now()

// Event-loop lag for the MAIN process. If main is stalled it cannot dispatch
// ipcMain.on('demist:pcm') at 10/sec no matter how fast the renderer sends,
// and that is indistinguishable, from either end, from the renderer not
// sending or the worker not reading.
let mainLoopWorst = 0
let mainLoopLast = Date.now()
setInterval(() => {
  const now = Date.now()
  const late = now - mainLoopLast - 100
  if (late > mainLoopWorst) mainLoopWorst = late
  mainLoopLast = now
}, 100).unref?.()

// The report below only runs when a PCM message ARRIVES, so the worse the
// problem the less often it is reported: at 0.1 messages/sec it printed about
// once a minute. A timer reports regardless, which is what a near-zero rate
// needs, and says explicitly when nothing at all arrived.
setInterval(() => {
  if (!transcribeSessionActive) return
  const secs = (Date.now() - lastPcmReport) / 1000
  if (secs < 5) return
  // Emitted UNCONDITIONALLY while a session is live, not only when it looks
  // bad. Reporting only on failure meant that whenever this line was missing
  // from a bug report it was impossible to tell "main is healthy" from "the
  // line was not pasted" - and main's number is exactly what separates a
  // renderer problem from a worker problem.
  const recvRate = pcmReceived / secs
  const message =
    `main[${MAIN_BUILD}] bridge: received ${recvRate.toFixed(1)}/sec, forwarded ${(pcmForwarded / secs).toFixed(1)}/sec ` +
    `(${(pcmBytes / 4 / 16000).toFixed(1)}s of audio), ${pcmDropped} dropped, over ${secs.toFixed(0)}s [expect ~10/sec]` +
    ` | renderer stamped up to seq ${pcmMaxSeq}, main saw ${pcmReceived} of the ${pcmMaxSeq - pcmSeqBase} it sent in this window` +
    `${pcmMaxSeq - pcmSeqBase > pcmReceived + 2 ? " <- MESSAGES LOST IN TRANSIT between renderer and main" : ''}` +
    ` | main stamped up to mseq ${pcmMainSeq}, posting to transcribe worker pid ${workerStates.transcribe ? workerStates.transcribe.worker.pid : 'NONE'}` +
    ` (spawned ${workerSpawns.transcribe || 0} time(s) this run)` +
    ` | main event-loop worst stall ${mainLoopWorst}ms` +
    `${mainLoopWorst > 1000 ? " <- MAIN WAS BLOCKED, so it could not dispatch the renderer messages" : ''}`
  if (recvRate < 5) console.warn(`[demist] ${message}`); else dlog(`[demist] ${message}`)
  mainWindow?.webContents.send('demist:event', { event: 'diag', payload: { message } })
  pcmReceived = 0; pcmForwarded = 0; pcmBytes = 0; pcmDropped = 0
  pcmSeqBase = pcmMaxSeq
  mainLoopWorst = 0
  lastPcmReport = Date.now()
}, 5000).unref?.()

ipcMain.on('demist:pcm', (_event, message) => {
  pcmReceived++
  // Gap detection. The renderer stamps a monotonic seq on every message, so
  // the highest seq seen minus how many actually arrived is exactly how many
  // were lost in transit - which separates "the renderer never sent them"
  // from "they were sent and dropped between the two processes".
  if (typeof message.seq === 'number') pcmMaxSeq = Math.max(pcmMaxSeq, message.seq)
  try {
    const src = new Uint8Array(message.buffer)
    const copy = new Uint8Array(src.length)
    copy.set(src)
    // QUEUE it; the flush timer owns the hop to the worker. Forwarding from
    // inside this callback was measured delivering 2.0/sec against a timer's
    // 9.5/sec back when the worker was a thread in this process, and while the
    // worker being a separate process is what actually fixed the starvation,
    // there is no reason to hand Chromium's IPC dispatch extra work per frame.
    pcmQueue.push(copy)
    if (pcmQueue.length > PCM_QUEUE_MAX) { pcmQueue.shift(); pcmDropped++ }
  } catch (err) {
    // Previously unguarded, and this runs per PCM message: a throw here was
    // silent and simply lost that audio.
    pcmDropped++
    if (pcmDropped <= 3) console.error('[demist] failed to forward a PCM message to the transcribe worker:', err)
  }
  // This handler ONLY counts. The timer above owns the counters and the
  // window. It used to also report and reset here, and because a reset ran on
  // every message the timer's window never reached its 5s threshold - so main's
  // number, the one measurement the whole investigation had narrowed down to,
  // was never emitted at all. Third time a counter window has hidden the
  // answer; there is now exactly one writer.
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

  // Start loading the models NOW, not when the renderer gets around to asking.
  // The renderer's preload (runNativePreload in web/lib/recordingSession.tsx)
  // cannot run until the remote app URL has been fetched over the network,
  // parsed, hydrated, and the provider mounted - seconds of dead time during
  // which these worker threads sit idle with nothing loaded, and after which
  // the user still waits out the whole load. Kicking it off here overlaps the
  // load with window creation and page load instead of queueing behind them.
  //
  // This is not a duplicate load. getTranscriber/getTranslator/llm's loader
  // each cache by tier and hand back the SAME in-flight promise, so the
  // renderer's call resolves when this one does. Failures are swallowed: the
  // renderer's own preload is the one that reports to the user and retries,
  // and an unhandled rejection here would be noise at best.
  //
  // Deliberately not preloading translation: it needs the user's language
  // from their profile, which only the renderer knows.
  for (const call of ['preloadWhisper', 'preloadTermDetection']) {
    callWorker(call).catch((err) => {
      console.error(`[demist] eager ${call} at startup failed (the renderer will retry):`, err?.message ?? err)
    })
  }

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Worker threads died with this process; child processes do not. Each holds
// hundreds of megabytes to a couple of gigabytes of model weights, so an
// orphan per launch is not a small leak. worker.js also exits on its own when
// the IPC channel closes, which covers this process being killed outright
// rather than quitting; this is the tidy path.
app.on('before-quit', () => {
  for (const state of Object.values(workerStates)) {
    if (!state) continue
    try { state.worker.kill() } catch { /* already gone */ }
  }
})

// desktop/native/worker.js: FULL REPLACEMENT
// Same role as before (heavy native work off Electron's main thread), with
// two additions: an event channel for push-style messages (live transcript
// segments, model download progress) alongside the existing request/response
// calls, and zero-copy PCM feeding via transferList.

const { parentPort, threadId } = require('worker_threads')

// This file runs in one of two hosts, and the only difference between them is
// how it talks to its parent:
//
//   - a worker THREAD (parentPort), which is how it has always run, and
//   - a forked Node CHILD PROCESS (process.send / process.on('message')).
//
// The second exists because inside Electron's main process a worker thread
// running onnxruntime is starved: measured on the shipping topology, one core
// spins for 20-30 seconds after the model loads, this thread's event loop
// ticks 0 times out of an expected 60 in a five-second window, a no-op control
// message takes 20s to answer, and PCM sits undelivered in the port queue for
// 15+ seconds. The identical code in a plain Node process transcribes steadily
// at 2.3s per 6s segment and never starves. See test/child-process-host.js.
const asChildProcess = !parentPort
const port = parentPort ?? {
  postMessage: (msg) => { try { process.send(msg) } catch { /* parent is gone */ } },
  on: (event, handler) => process.on(event, handler),
}
// Only meaningful in thread mode; the process id is the equivalent identity
// when forked, and every log line that names it is there to tell two live
// workers apart.
const workerId = asChildProcess ? `pid ${process.pid}` : threadId

function emitEvent(event, payload) {
  port.postMessage({ event, payload })
}
const emitProgress = (label, pct, file) => emitEvent('modelProgress', { label, pct, file })

let whisper, translate, llm
const handlers = {
  // Keep-alive (see the keepWorkersWarm comment in main.js). Deliberately
  // does nothing at all: touching this thread's stack and heap on a timer is
  // the entire point, so it must not read a file, allocate, or run inference.
  ping: () => true,

  // Live transcription session (new)
  startSession: () => (whisper ??= require('./whisper')).startSession(
    (t) => emitEvent('transcript', t),
    emitProgress,
    (t) => emitEvent('interimTranscript', t),
    // Native-side timing, forwarded to the renderer's console. Everything
    // this file logs normally goes to the main process's stdout, invisible
    // unless the app was launched from a terminal, which is why the cause of
    // a slow startSession has been so hard to pin down from a screenshot.
    (message, verbose) => emitEvent('diag', { message, verbose: verbose === true }),
  ),
  stopSession: () => (whisper ??= require('./whisper')).stopSession(),
  // Deliberately does NOT require('./whisper'): if this worker has never
  // loaded the transcriber there is nothing to keep warm, and loading one
  // from a background timer would be a surprise multi-hundred-MB load.
  keepWhisperWarm: () => whisper ? whisper.keepWarm() : false,
  preloadWhisper: () => (whisper ??= require('./whisper')).preload(emitProgress),
  preloadTermDetection: () => (llm ??= require('./llm')).preload(emitProgress),
  preloadTranslation: (lang) => (translate ??= require('./translate')).preload(lang, emitProgress),

  // Existing request/response surface
  translate: (text, targetLang) => (translate ??= require('./translate')).translate(text, targetLang, emitProgress),
  detectTerms: (transcript, context, subject, year) =>
    (llm ??= require('./llm')).detectTerms(transcript, context, subject, year, emitProgress),
  summarize: (termRows, subject) => (llm ??= require('./llm')).summarize(termRows, subject),
  getModelTier: () => (llm ??= require('./llm')).getTier(),
  setModelTier: (tier) => (llm ??= require('./llm')).setTier(tier),
  getTranscribeTier: () => (whisper ??= require('./whisper')).getTier(),
  setTranscribeTier: (tier) => (whisper ??= require('./whisper')).setTier(tier),
}

// Counted at the very edge of the worker, before anything can discard them.
// Every other counter in the chain sits further in, so a message that reached
// this thread and was then dropped looked identical to one that never arrived.
// Event-loop lag for THIS thread. "the worker is too busy to drain its queue"
// has been the working hypothesis for several rounds and has never once been
// measured in the real app - only inferred from a low receive rate, which is
// also what a hop that never delivered would look like. A 100ms timer that
// fires 20 seconds late says outright that this thread was blocked for 20
// seconds, and by how much, with no inference required.
// COUNT the firings as well as their lateness. "worst stall 0ms" was
// ambiguous in the worst possible way: it reads as "this thread was healthy",
// but it is also what a thread that never ran this callback AT ALL reports,
// because only the callback can raise the number. That ambiguity sent this
// investigation after the message bridge twice while the real answer was that
// this thread was not running. A tick count has no such failure mode - 10 per
// second is healthy, 2 in a five-second window is not, and zero is damning.
let loopWorst = 0
let loopTicks = 0
let loopLast = Date.now()
setInterval(() => {
  const now = Date.now()
  const late = now - loopLast - 100
  if (late > loopWorst) loopWorst = late
  loopLast = now
  loopTicks++
}, 100).unref?.()

// Announce this worker the moment it exists. If PCM is going to one worker
// while a session lives on another, the give-away is a second "started" line
// appearing mid-recording.
emitEvent('diag', { message: `worker[${workerId}] started` })

// A worker THREAD dies with the process that owns it; a child PROCESS does
// not. Without this, quitting the app (or crashing it) would leave three
// orphaned Node processes behind holding several gigabytes of model weights,
// and they would accumulate one set per launch. 'disconnect' fires when the
// IPC channel to the parent closes, which covers a clean quit and a killed
// parent alike.
if (asChildProcess) {
  process.on('disconnect', () => process.exit(0))
}

let pcmMessages = 0
let pcmSamples = 0
let lastPcmLog = Date.now()
// Which of main's messages this thread actually saw. main stamps a monotonic
// mseq on every PCM message it posts, so the SHAPE of the loss is visible:
// contiguous numbers with a gap at the end means the receiver changed, every
// Nth number means something is throttling, and a full run means no loss.
let firstMseq = null
let lastMseq = null
// How long each message spent BETWEEN main's postMessage and this thread's
// handler. Every counter to date measured how MANY messages arrived; none
// measured how LATE. Those look identical in a rate, and they have completely
// different causes: a low rate with ~0ms delivery means main never posted,
// while a low rate with multi-second delivery means the messages were posted
// on time and sat in this port's queue - which is the only evidence that
// distinguishes "the bridge is broken" from "this thread was not scheduled".
let deliveryWorst = 0
let deliveryTotal = 0
let deliveryCount = 0

// Every message arriving at this thread, counted BEFORE any branch or any
// parsing. The previous counter sat inside `if (msg.type === 'pcm')` and after
// `new Float32Array(msg.buffer)`, which meant two failure modes were counted
// as "never arrived", and both are silent:
//
//   1. msg.type is not 'pcm' -> falls to the handler branch, handlers[undefined]
//      throws, and the reply carries id undefined, which main's
//      pending.get(undefined) discards without a word.
//   2. new Float32Array(msg.buffer) throws (e.g. a byteLength that is not a
//      multiple of 4) -> this handler is async, so it becomes an unhandled
//      rejection and the counter below is never reached.
//
// main reports posting 9.8/sec to this exact threadId with nothing thrown and
// this thread reports 0.6/sec while idle. Those cannot both be true of the
// same messages, so the count has to happen before anything can swallow one.
let rawMessages = 0
let pcmTyped = 0
let badFrames = 0
let lastBadReason = ''
const typeTally = new Map()

port.on('message', async (msg) => {
  rawMessages++
  const t = msg && typeof msg === 'object' ? String(msg.type) : `NOT-AN-OBJECT(${typeof msg})`
  typeTally.set(t, (typeTally.get(t) || 0) + 1)
  // PCM frames are fire-and-forget and high-frequency: no id, no reply.
  if (msg.type === 'pcm') {
    pcmTyped++
    let frame
    try {
      frame = new Float32Array(msg.buffer)
    } catch (err) {
      // Silent until now: an async handler that throws here produces an
      // unhandled rejection and the frame simply vanishes.
      badFrames++
      lastBadReason = `${err?.message ?? err} (byteLength ${msg.buffer && msg.buffer.byteLength})`
      return
    }
    // Start the window at the FIRST frame, not at module load. Initialising it
    // at load meant the first report divided by however long the app had been
    // idle - the same mistake main.js's bridge counter made, where it reported
    // 0.1/sec for a hop genuinely carrying 10/sec and sent the investigation
    // after the wrong component entirely.
    if (pcmMessages === 0) { lastPcmLog = Date.now(); firstMseq = msg.mseq ?? null }
    lastMseq = msg.mseq ?? null
    pcmMessages++
    pcmSamples += frame.length
    const now = Date.now()
    if (typeof msg.postedAt === 'number') {
      const late = now - msg.postedAt
      deliveryTotal += late; deliveryCount++
      if (late > deliveryWorst) deliveryWorst = late
    }
    if (now - lastPcmLog >= 5000) {
      const secs = (now - lastPcmLog) / 1000
      emitEvent('diag', {
        // Trace, not lifecycle: one of these every five seconds for a whole
        // lecture. Shown only with localStorage demist_debug set.
        verbose: true,
        message: `worker[${workerId}] received ${(pcmMessages / secs).toFixed(1)} pcm msgs/sec `
          + `(${(pcmSamples / 16000).toFixed(1)}s of audio) over the last ${secs.toFixed(0)}s`
          + ` | saw main's mseq ${firstMseq}..${lastMseq}`
          + `${firstMseq != null && lastMseq != null
              ? ` = ${pcmMessages} of the ${lastMseq - firstMseq + 1} main posted in that range`
                + (lastMseq - firstMseq + 1 > pcmMessages + 2 ? ' <- GAPS: main posted more than this thread received' : ' <- no gaps: this thread got everything main sent it')
              : ''}`
          + ` | this thread saw ${rawMessages} messages of ALL types in that window `
          + `(${[...typeTally].map(([k, v]) => `${k}:${v}`).join(', ')})`
          + `${badFrames ? ` | ${badFrames} PCM frames FAILED to parse [${lastBadReason}]` : ''}`
          + `${deliveryCount ? ` | delivery main->here: mean ${(deliveryTotal / deliveryCount).toFixed(0)}ms, worst ${deliveryWorst}ms` : ''}`
          + ` | worker event loop ticked ${loopTicks}/${Math.round(secs * 10)} times, worst stall ${loopWorst}ms`
          // A low tick count is only a PROBLEM when the audio is also arriving
          // late. During a healthy recording this thread is inside an inference
          // for roughly 1.8s out of every 3s, so it legitimately misses well
          // over half its ticks while the transcript stays ~2s behind the
          // speaker and nothing queues. Warning on the tick count alone fired
          // on every healthy session, which is how a diagnostic teaches you to
          // ignore it. Delivery latency is the thing that actually hurts.
          + `${loopTicks < secs * 5 && deliveryWorst > 3000
              ? ' <- THIS THREAD WAS NOT RUNNING, which is why it did not drain its queue'
              : ''}`,
      })
      pcmMessages = 0; pcmSamples = 0; lastPcmLog = now; loopWorst = 0; loopTicks = 0; firstMseq = null; lastMseq = null
      deliveryWorst = 0; deliveryTotal = 0; deliveryCount = 0
      rawMessages = 0; pcmTyped = 0; badFrames = 0; typeTally.clear()
    }
    ;(whisper ??= require('./whisper')).feedPcm(frame)
    return
  }
  const { id, type, args } = msg
  if (typeof handlers[type] !== 'function') {
    // Previously this called handlers[undefined](), threw, and replied with an
    // id of undefined - which main's pending map drops on the floor. A message
    // that arrived and was thrown away looked exactly like one that was never
    // sent, which is the ambiguity this whole investigation kept running into.
    emitEvent('diag', {
      message: `worker[${workerId}] got an UNROUTABLE message: type=${JSON.stringify(type)} `
        + `keys=${JSON.stringify(Object.keys(msg))} - it has been discarded`,
    })
    return
  }
  try {
    const result = await handlers[type](...(args ?? []))
    port.postMessage({ id, result })
  } catch (err) {
    port.postMessage({ id, error: err?.message ?? String(err) })
  }
})

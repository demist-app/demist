// Listen back (2026-11-18): the lecture's audio, kept on this computer only.
//
// Runs in the MAIN process (required by main.js), not a worker: it is file
// I/O, nothing here touches a model.
//
// Nothing in this file uploads anything. The renderer records the lecture
// with MediaRecorder (Opus in WebM, ~24 kbps, about 11 MB an hour) and hands
// each chunk here; it lands in
//
//   <userData>/recordings/<userId>/.partial/<recordingId>.webm   while recording
//   <userData>/recordings/<userId>/<sessionId>/audio.webm        once kept
//   <userData>/recordings/<userId>/<sessionId>/meta.json         { durationMs, timeline }
//
// `timeline` is [audioMs, transcriptOffset] pairs: where each piece of
// transcript starts in the audio. Numbers only, the same shape as
// session_marks, so the text itself is never duplicated here.
//
// Whether a recording is KEPT is decided by the renderer at the end of the
// lecture, by the same rule that decides whether the transcript is kept
// (lecturer consent for the module, or a declared support need) plus Pro. A
// recording that does not qualify is discarded, and a partial left behind by
// a crash is deleted on the next start.

const fs = require('fs')
const fsp = fs.promises
const path = require('path')

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PARTIAL_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000

let root = null
// One append chain per recording, so chunks land in the order they were sent
// even though each append is async.
const chains = new Map()

function init(userDataDir) {
  root = path.join(userDataDir, 'recordings')
  sweepPartials().catch(() => {})
}

// Every path is built from validated ids only, so nothing the page sends can
// reach outside the recordings folder.
function check(...ids) {
  for (const id of ids) if (typeof id !== 'string' || !ID.test(id)) throw new Error('bad id')
  if (!root) throw new Error('lecture audio not initialised')
}
const userDir = (userId) => path.join(root, userId)
const partialPath = (userId, recId) => path.join(userDir(userId), '.partial', `${recId}.webm`)
const keptDir = (userId, sessionId) => path.join(userDir(userId), sessionId)

async function begin(userId, recId) {
  check(userId, recId)
  await fsp.mkdir(path.dirname(partialPath(userId, recId)), { recursive: true })
  await fsp.writeFile(partialPath(userId, recId), Buffer.alloc(0))
  chains.set(recId, Promise.resolve())
  return true
}

function append(userId, recId, arrayBuffer) {
  check(userId, recId)
  const prev = chains.get(recId) ?? Promise.resolve()
  const next = prev.then(() => fsp.appendFile(partialPath(userId, recId), Buffer.from(arrayBuffer)))
  // A failed append must not stop later ones being attempted; the error
  // still reaches this call's caller.
  chains.set(recId, next.catch(() => {}))
  return next.then(() => true)
}

async function finish(userId, recId, sessionId, meta) {
  check(userId, recId, sessionId)
  await (chains.get(recId) ?? Promise.resolve())
  chains.delete(recId)
  const src = partialPath(userId, recId)
  const { size } = await fsp.stat(src)
  if (!size) { await fsp.rm(src, { force: true }); return { kept: false } }
  const dir = keptDir(userId, sessionId)
  await fsp.mkdir(dir, { recursive: true })
  await fsp.rename(src, path.join(dir, 'audio.webm'))
  const timeline = Array.isArray(meta?.timeline)
    ? meta.timeline.filter(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isFinite(n) && n >= 0))
    : []
  const durationMs = Number.isFinite(meta?.durationMs) ? meta.durationMs : null
  await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ durationMs, timeline, savedAt: new Date().toISOString() }))
  return { kept: true, bytes: size }
}

async function discard(userId, recId) {
  check(userId, recId)
  await (chains.get(recId) ?? Promise.resolve())
  chains.delete(recId)
  await fsp.rm(partialPath(userId, recId), { force: true })
  return true
}

async function readMeta(dir) {
  try { return JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8')) } catch { return { durationMs: null, timeline: [] } }
}

// Which of these lectures have audio on this computer: { [sessionId]: { bytes, durationMs } }
async function list(userId, sessionIds) {
  check(userId)
  const out = {}
  for (const sid of Array.isArray(sessionIds) ? sessionIds.slice(0, 500) : []) {
    if (typeof sid !== 'string' || !ID.test(sid)) continue
    try {
      const dir = keptDir(userId, sid)
      const { size } = await fsp.stat(path.join(dir, 'audio.webm'))
      out[sid] = { bytes: size, durationMs: (await readMeta(dir)).durationMs }
    } catch { /* no audio for this lecture */ }
  }
  return out
}

async function read(userId, sessionId) {
  check(userId, sessionId)
  const dir = keptDir(userId, sessionId)
  try {
    const buf = await fsp.readFile(path.join(dir, 'audio.webm'))
    const meta = await readMeta(dir)
    // A plain ArrayBuffer of exactly this file (Buffer may sit in a shared pool).
    return { audio: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), ...meta }
  } catch {
    return null
  }
}

async function remove(userId, sessionId) {
  check(userId, sessionId)
  await fsp.rm(keptDir(userId, sessionId), { recursive: true, force: true })
  return true
}

// Total kept on disk for this account, for the Profile storage line.
async function usage(userId) {
  check(userId)
  let bytes = 0, count = 0
  let entries = []
  try { entries = await fsp.readdir(userDir(userId), { withFileTypes: true }) } catch { return { bytes, count } }
  for (const e of entries) {
    if (!e.isDirectory() || !ID.test(e.name)) continue
    try { bytes += (await fsp.stat(path.join(userDir(userId), e.name, 'audio.webm'))).size; count++ } catch { /* empty folder */ }
  }
  return { bytes, count }
}

async function removeAll(userId) {
  check(userId)
  await fsp.rm(userDir(userId), { recursive: true, force: true })
  return true
}

async function sweepPartials() {
  let users = []
  try { users = await fsp.readdir(root, { withFileTypes: true }) } catch { return }
  for (const u of users) {
    if (!u.isDirectory()) continue
    const dir = path.join(root, u.name, '.partial')
    let files = []
    try { files = await fsp.readdir(dir) } catch { continue }
    for (const f of files) {
      const p = path.join(dir, f)
      try { if (Date.now() - (await fsp.stat(p)).mtimeMs > PARTIAL_MAX_AGE_MS) await fsp.rm(p, { force: true }) } catch { /* gone */ }
    }
  }
}

module.exports = { init, begin, append, finish, discard, list, read, remove, usage, removeAll }

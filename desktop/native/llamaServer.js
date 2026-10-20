// Runs llama.cpp's official llama-server for term detection, on this machine
// only. See scripts/fetch-llama-server.mjs for why: node-llama-cpp in-process
// measured 10x slower than llama.cpp's own build on the same CPU, which made
// term cards on laptops without a graphics card arrive a minute late or never.
//
// Privacy: listens on 127.0.0.1 (loopback, unreachable from the network), with
// a random API key per launch so other programs on the machine cannot use it
// either. Nothing is downloaded or sent anywhere by this file.
//
// Lifecycle: started by llm.js when a model is loaded, stopped when the model
// is switched and when this worker process exits. A pid file catches the one
// case exit handlers cannot: a worker that died hard leaves its server running
// (Windows does not kill child processes with their parent), holding about a
// gigabyte. The next start kills it.
const { spawn, execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

// __dirname is app.asar.unpacked/native in a packaged build; llama-server/ is
// asarUnpack'd next to it (an exe cannot run from inside an asar archive).
const DIR = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), '..', 'llama-server')
const EXE = path.join(DIR, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server')
const PID_FILE = path.join(os.homedir(), '.demist', 'llama-server.pid')
const READY_TIMEOUT_MS = 120_000
const REQUEST_TIMEOUT_MS = 120_000

let server = null   // { child, port, key, modelPath, ready: Promise, log: string[] }

function available() {
  return process.env.DEMIST_LLM_ENGINE !== 'inproc' && fs.existsSync(EXE)
}

// Physical cores minus one, so transcription (onnxruntime, also on the CPU)
// and the audio thread are never starved by term detection. os.cpus() counts
// logical cores; on the SMT CPUs students' laptops have, half is physical.
function threadCount() {
  const logical = os.cpus().length
  const physical = logical >= 4 ? Math.floor(logical / 2) : logical
  return Math.max(2, physical - 1)
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer()
    s.unref()
    s.on('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

// Windows reuses process ids, so the recorded pid is only killed if it is
// still a llama-server: never a stranger that happened to get the same number.
function isLlamaServer(pid) {
  if (process.platform !== 'win32') return false
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
    return /"llama-server\.exe"/i.test(out)
  } catch {
    return false
  }
}

function killStale() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8'))
    if (pid && pid !== server?.child?.pid && isLlamaServer(pid)) {
      process.kill(pid)
      console.warn(`[demist] stopped a llama-server left running by an earlier session (pid ${pid})`)
    }
  } catch { /* no pid file, or that process is already gone */ }
  try { fs.unlinkSync(PID_FILE) } catch { /* nothing to remove */ }
}

async function start(modelPath, { contextSize = 2048 } = {}) {
  if (server && server.modelPath === modelPath && !server.child.killed && server.child.exitCode === null) return server.ready
  stop()
  killStale()
  const port = await freePort()
  const key = crypto.randomBytes(24).toString('hex')
  const args = [
    '-m', modelPath,
    '-t', String(threadCount()),
    '-c', String(contextSize),
    '--host', '127.0.0.1',
    '--port', String(port),
    '--api-key', key,
    '-np', '1',
    '--no-webui',
  ]
  const child = spawn(EXE, args, { cwd: DIR, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const log = []
  const keep = (buf) => {
    for (const line of String(buf).split(/\r?\n/)) if (line.trim()) log.push(line)
    if (log.length > 40) log.splice(0, log.length - 40)
  }
  child.stdout.on('data', keep)
  child.stderr.on('data', keep)
  try { fs.mkdirSync(path.dirname(PID_FILE), { recursive: true }); fs.writeFileSync(PID_FILE, String(child.pid)) } catch { /* best effort */ }

  const entry = { child, port, key, modelPath, log, ready: null }
  entry.ready = new Promise((resolve, reject) => {
    let settled = false
    const fail = (why) => { if (!settled) { settled = true; reject(new Error(`${why}${log.length ? `: ${log.slice(-3).join(' | ')}` : ''}`)) } }
    child.on('error', (e) => fail(`llama-server could not start (${e.message})`))
    child.on('exit', (code) => {
      fail(`llama-server exited (code ${code}) before it was ready`)
      if (server === entry) server = null
      try { if (Number(fs.readFileSync(PID_FILE, 'utf8')) === child.pid) fs.unlinkSync(PID_FILE) } catch { /* ignore */ }
    })
    const deadline = Date.now() + READY_TIMEOUT_MS
    const poll = async () => {
      if (settled) return
      if (Date.now() > deadline) { fail('llama-server did not become ready in time'); stop(); return }
      try {
        const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${key}` } })
        if (r.ok) { settled = true; resolve(entry); return }
      } catch { /* not listening yet */ }
      setTimeout(poll, 250)
    }
    poll()
  })
  server = entry
  return entry.ready
}

function stop() {
  if (!server) return
  try { server.child.kill() } catch { /* already gone */ }
  server = null
}

// One chat completion. With a JSON schema the reply is constrained to it, the
// same guarantee node-llama-cpp's grammars gave. cache_prompt lets the server
// reuse the already-read opening of consecutive prompts (llm.js puts the fixed
// instructions first for exactly this).
async function complete(prompt, { schema, maxTokens = 256 } = {}) {
  if (!server) throw new Error('llama-server is not running')
  const { port, key } = await server.ready
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: maxTokens,
        cache_prompt: true,
        ...(schema ? { response_format: { type: 'json_schema', json_schema: { schema } } } : {}),
      }),
    })
    if (!res.ok) throw new Error(`llama-server HTTP ${res.status}`)
    const body = await res.json()
    return body.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

// A worker exiting normally (including on IPC disconnect when the app quits)
// takes its server with it.
process.on('exit', stop)

module.exports = { available, start, stop, complete, threadCount, EXE }

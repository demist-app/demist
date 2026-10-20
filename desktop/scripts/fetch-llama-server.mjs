// Downloads llama.cpp's official Windows CPU build of llama-server INTO the
// build (desktop/llama-server/), pinned by version and SHA-256.
//
// WHY (2026-10-20). Term detection used node-llama-cpp in-process. On an idle
// Ryzen 5 5600X, the same llama.cpp build (b9842) and the same model measured
//
//                         official llama-bench    node-llama-cpp in-process
//   reading the prompt         189 tok/s                 16 tok/s
//   writing                     27 tok/s                  6.5 tok/s
//
// llama.cpp's own perf counters confirmed the slow numbers inside the node
// process, and no node-llama-cpp option (threads, maxThreads, batch, flash
// attention, mmap) changed them. On a laptop with no graphics card that made
// term cards arrive a minute late or never: two 8GB laptops logged ~240
// failed detections per lecture. Through llama-server the candidates-first
// pipeline measured 3.8s median per window with 0/7 false positives, 0/5
// misses and 0/3 mis-hearings kept (test/define-precision-server.mjs).
//
// The server listens on 127.0.0.1 only, with a random API key per launch, and
// is started and stopped by native/llamaServer.js. Nothing leaves the machine.
//
//   node scripts/fetch-llama-server.mjs   (run before npm run dist, like fetch-models.mjs)
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const RELEASE = 'b9842'
const URL = `https://github.com/ggml-org/llama.cpp/releases/download/${RELEASE}/llama-${RELEASE}-bin-win-cpu-x64.zip`
const SHA256 = '006a3dca8f00d8e250573f193eacd8d13be870d5757e7539329897727f449178'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'llama-server')

// Only what llama-server.exe loads. The zip also carries ~40 other tools.
const KEEP = (name) =>
  /^llama-server(-impl)?\.(exe|dll)$/i.test(name) ||
  /^(llama|llama-common|mtmd|ggml|ggml-base)\.dll$/i.test(name) ||
  /^ggml-cpu-[a-z0-9]+\.dll$/i.test(name) ||
  /^libomp140\.x86_64\.dll$/i.test(name)

const marker = path.join(OUT, 'RELEASE')
if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === RELEASE) {
  console.log(`llama-server ${RELEASE} already present in ${OUT}`)
  process.exit(0)
}

console.log(`downloading ${URL}`)
const res = await fetch(URL)
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
const zip = Buffer.from(await res.arrayBuffer())
const sha = createHash('sha256').update(zip).digest('hex')
if (sha !== SHA256) throw new Error(`checksum mismatch for ${URL}: got ${sha}, expected ${SHA256}. Refusing to ship an unverified binary.`)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llama-server-'))
const zipPath = path.join(tmp, 'release.zip')
fs.writeFileSync(zipPath, zip)
// Windows' own bsdtar (10 1803+) extracts zip files. Named by full path: Git's
// GNU tar comes first on PATH in a Git Bash shell and cannot read C:\ paths.
const TAR = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
execFileSync(TAR, ['-xf', zipPath, '-C', tmp])

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
let kept = 0
for (const name of fs.readdirSync(tmp)) {
  if (!KEEP(name)) continue
  fs.copyFileSync(path.join(tmp, name), path.join(OUT, name))
  kept++
}
fs.rmSync(tmp, { recursive: true, force: true })
if (!fs.existsSync(path.join(OUT, 'llama-server.exe'))) throw new Error('llama-server.exe missing from the release zip')
fs.writeFileSync(marker, RELEASE + '\n')
console.log(`llama-server ${RELEASE}: ${kept} files in ${OUT}`)

// Run against the BUILT app before every Store submission:
//   npm run dist
//   dist\win-unpacked\Demist.exe is then used as Node:
//   set ELECTRON_RUN_AS_NODE=1 && dist\win-unpacked\Demist.exe test\packaged-layout.js
// (from Git Bash: ELECTRON_RUN_AS_NODE=1 dist/win-unpacked/Demist.exe test/packaged-layout.js)
//
// Checks what only the packaged layout can show: that the workers, running
// from resources/app.asar.unpacked/native, find the bundled transcription
// models and the bundled llama-server, and that term detection really runs
// on the server rather than silently falling back.
//
// WHY: until 2026-10-21 the bundled models resolved to
// app.asar.unpacked.unpacked/models in every packaged build (a doubled path
// replace), so transcription fetched them from Hugging Face instead and broke
// on networks that block it. Every development-tree test passed throughout.
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar.unpacked')
const NATIVE = path.join(ROOT, 'native')
let failed = 0
const check = (ok, label, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`) }

;(async () => {
  check(fs.existsSync(NATIVE), 'packaged native/ exists', NATIVE)

  const { env } = require(path.join(ROOT, 'node_modules', '@huggingface', 'transformers'))
  require(path.join(NATIVE, 'whisper.js'))
  const models = env.localModelPath
  check(fs.existsSync(models) && !models.includes('unpacked.unpacked'), 'transcription models found in the package', models)
  for (const m of ['whisper-base.en', 'whisper-small.en']) {
    const onnx = path.join(models, 'Xenova', m, 'onnx')
    check(fs.existsSync(onnx) && fs.readdirSync(onnx).some(f => f.endsWith('.onnx')), `bundled ${m}`, onnx)
  }

  const srv = require(path.join(NATIVE, 'llamaServer.js'))
  check(srv.available() && !srv.EXE.includes('unpacked.unpacked'), 'llama-server found in the package', srv.EXE)
  for (const dll of ['vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll']) {
    check(fs.existsSync(path.join(path.dirname(srv.EXE), dll)), `${dll} beside llama-server.exe`)
  }

  for (const gpu of ['win-x64-cuda', 'win-x64-cuda-ext', 'win-x64-vulkan', 'win-arm64']) {
    check(!fs.existsSync(path.join(ROOT, 'node_modules', '@node-llama-cpp', gpu)), `${gpu} not shipped`)
  }
  check(fs.existsSync(path.join(ROOT, 'models', 'llm', 'hf_bartowski_Qwen2.5-1.5B-Instruct.Q4_K_M.gguf')), 'default term model bundled')

  // A brand-new machine: an empty home directory, so no cached model, no
  // saved tier and no tier override. Term detection must come up from the
  // bundled model alone, with nothing downloaded.
  const os = require('os')
  const freshHome = fs.mkdtempSync(path.join(os.tmpdir(), 'demist-fresh-'))
  process.env.USERPROFILE = freshHome
  process.env.HOME = freshHome
  delete process.env.DEMIST_LLM_TIER
  const llm = require(path.join(NATIVE, 'llm.js'))
  check(llm.getTier() === 'tiny', 'fresh machine defaults to the bundled tier', llm.getTier())
  await llm.preload(() => {})
  const out = await llm.defineCandidates([{ term: 'loss function', sentence: 'We minimise the loss function with gradient descent.' }], 'Machine Learning', 2, () => {}, [])
  check(out.length === 1, 'defineCandidates returns a term', JSON.stringify(out.map(t => t.term)))
  check(llm.engineInUse?.() === 'server', 'term detection running on llama-server', llm.engineInUse?.())
  const downloaded = fs.existsSync(path.join(freshHome, '.demist', 'llm-models')) ? fs.readdirSync(path.join(freshHome, '.demist', 'llm-models')).filter(f => f.endsWith('.gguf')) : []
  check(downloaded.length === 0, 'nothing downloaded on a fresh machine', downloaded.join(', '))

  console.log(failed ? `\n${failed} FAILED - do not submit this build` : '\nall packaged-layout checks passed')
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error('FAILED', e); process.exit(1) })

// Runs the real on-device pipeline (transcription, term-detection LLM,
// translation) against the actual cached/downloaded models, specifically on
// the macOS Apple Silicon CI runner - the closest thing to real hardware
// available while nobody on this project owns a physical Mac.
//
// This does NOT replace the checklist in desktop/MACOS_BUILD_PLAN.md section
// 7: it cannot click through Gatekeeper, grant a mic permission dialog, or
// launch the packaged .app from Finder. What it CAN prove, for real, is the
// part underneath all of that - that transcription produces actual text on
// arm64 macOS, that the term-detection LLM answers, that translation
// answers, and which backend node-llama-cpp actually picked (Metal vs CPU
// fallback), none of which a green `electron-builder` exit code confirms on
// its own (see electron-builder.mac.yml's own comment on this exact class of
// silent failure).
//
// Emits ::notice::/::error:: GitHub Actions workflow commands (not just
// console.log) so the pass/fail detail shows up as check-run annotations,
// readable through the API without downloading the full job log.
//
//   node test/mac-hardware-verify.js
const fs = require('fs')
const path = require('path')
const { SAMPLE_RATE } = require('../native/pcm-segmenter')

let failures = 0
function annotate(kind, msg) {
  // GitHub Actions workflow command syntax. No-op (falls through to
  // console.log) when not running in Actions, e.g. a local Mac someone
  // eventually tests this on by hand.
  if (process.env.GITHUB_ACTIONS) console.log(`::${kind}::${msg.replace(/\n/g, ' ')}`)
}
function check(name, ok, detail = '') {
  const line = `${name}${detail ? `  ${detail}` : ''}`
  if (ok) { console.log(`  ok   ${line}`); annotate('notice', `ok: ${line}`) }
  else { failures++; console.log(`  FAIL ${line}`); annotate('error', `FAIL: ${line}`) }
}

function loadFixture() {
  const b = fs.readFileSync(path.join(__dirname, 'fixtures', 'speech.wav'))
  let off = 12
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    if (id === 'data') {
      const n = size / 2
      const audio = new Float32Array(n)
      for (let i = 0; i < n; i++) audio[i] = b.readInt16LE(off + 8 + i * 2) / 32768
      return audio
    }
    off += 8 + size + (size % 2)
  }
  throw new Error('no data chunk')
}

;(async () => {
  console.log(`platform: ${process.platform} ${process.arch}, node ${process.version}\n`)

  // ── transcription: does Whisper actually produce text on this hardware ──
  console.log('transcription (native/whisper.js, real onnxruntime-node darwin/arm64 binary):')
  const whisper = require('../native/whisper')
  const audio = loadFixture()
  const t0 = Date.now()
  const text = await whisper.transcribeBuffer(audio, () => {})
  check('transcribes the fixture to real text', text.length > 40, `${Date.now() - t0}ms -> ${JSON.stringify(text.slice(0, 90))}`)

  // ── term detection LLM: does node-llama-cpp load and answer, and on what backend ──
  console.log('\nterm-detection LLM (native/llm.js, node-llama-cpp mac-arm64-metal binary):')
  // node-llama-cpp is ESM with top-level await in its module graph, so
  // require() throws ERR_REQUIRE_ASYNC_MODULE under Node 20's CJS-requires-ESM
  // support (confirmed by an actual failed CI run) - native/llm.js already
  // knows this and uses a dynamic import() for exactly this reason.
  const { getLlama } = await import('node-llama-cpp')
  const llamaProbe = await getLlama({ gpu: 'auto' })
  // llama.gpu is falsy when node-llama-cpp fell back to CPU-only, or the
  // backend name ('metal' on Apple Silicon) when GPU offload is actually
  // active. This is the exact distinction MACOS_BUILD_PLAN.md section 7
  // asks to confirm instead of trusting "it produced output eventually".
  annotate('notice', `node-llama-cpp GPU backend: ${JSON.stringify(llamaProbe.gpu)}`)
  console.log(`  GPU backend selected by node-llama-cpp: ${JSON.stringify(llamaProbe.gpu)}`)
  if (llamaProbe.gpu !== 'metal') {
    console.log('  NOTE: not "metal" - either this runner has no GPU passthrough (plausible for a')
    console.log('  virtualized CI runner even on real Apple Silicon host hardware) or the Metal')
    console.log('  backend failed to init. Not necessarily a bug: confirm separately on a real')
    console.log('  physical Mac before concluding term detection is CPU-bound there too.')
  }

  const llm = require('../native/llm')
  const CASES = [['chemiosmosis', 'Biology'], ['packet switching', 'Computer Science']]
  for (const [term, subject] of CASES) {
    const t = Date.now()
    const def = await llm.explain(term, subject, 1)
    const ms = Date.now() - t
    const ok = !!def && def.length > 25 && def.toLowerCase() !== term.toLowerCase()
    check(`explains ${JSON.stringify(term)}`, ok, `${ms}ms -> ${JSON.stringify((def ?? '').slice(0, 90))}`)
  }

  // ── translation: does the OPUS-MT pipeline actually answer ──
  console.log('\ntranslation (native/translate.js, OPUS-MT via @huggingface/transformers):')
  const translate = require('../native/translate')
  for (const lang of ['es', 'fr']) {
    const t = Date.now()
    const out = await translate.translate('The mitochondria is the powerhouse of the cell.', lang, () => {})
    const ms = Date.now() - t
    check(`translates to ${lang}`, out.length > 5 && out.toLowerCase() !== 'the mitochondria is the powerhouse of the cell.',
      `${ms}ms -> ${JSON.stringify(out)}`)
  }

  console.log(failures
    ? `\n${failures} FAILED - the packaged Mac build's native pipeline is not actually working`
    : '\nall passed - transcription, term detection and translation all produce real output on this arm64 macOS runner')
  process.exit(failures ? 1 : 0)
})().catch((err) => {
  console.error(err)
  annotate('error', `mac-hardware-verify crashed: ${err?.stack || err}`)
  process.exit(1)
})

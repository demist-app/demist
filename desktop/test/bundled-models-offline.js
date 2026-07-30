// Proves transcription works with the network DENIED, which is the whole point
// of bundling the models. Store certification failed 10.1.2.10 because the app
// could not load its transcription model on a machine that had a working
// connection; if this test passes, there is nothing left to fail.
//
//   node test/bundled-models-offline.js
const path = require('path')
const fs = require('fs')
const { env } = require('@huggingface/transformers')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`)
  else { failures++; console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`) }
}

;(async () => {
  // Requiring whisper.js is what sets localModelPath, so read it back rather
  // than recomputing it here - the test should fail if that wiring is wrong.
  const whisper = require('../native/whisper')
  console.log(`localModelPath -> ${env.localModelPath}\n`)
  check('bundled model directory exists', fs.existsSync(env.localModelPath), env.localModelPath)

  for (const tier of ['whisper-base.en', 'whisper-small.en']) {
    const dir = path.join(env.localModelPath, 'Xenova', tier)
    const need = ['config.json', 'tokenizer.json', 'preprocessor_config.json',
      path.join('onnx', 'encoder_model_quantized.onnx'),
      path.join('onnx', 'decoder_model_merged_quantized.onnx')]
    const missing = need.filter(f => !fs.existsSync(path.join(dir, f)))
    check(`${tier} is fully bundled`, missing.length === 0,
      missing.length ? `missing ${JSON.stringify(missing)}` : '')
  }

  // The real test. With remote loading refused, a successful load can only
  // have come from the bundled tree - and any accidental network dependency
  // becomes a hard failure here instead of a Store certification report.
  env.allowRemoteModels = false
  // Point the HTTP cache somewhere empty too, so a previously downloaded copy
  // in ~/.demist cannot quietly satisfy the load and fake a pass.
  env.cacheDir = path.join(require('os').tmpdir(), 'demist-empty-cache-' + Date.now())

  try {
    const tier = await whisper.preload(() => {})
    check('preload succeeds with remote models DENIED', true, `tier=${tier}`)
  } catch (err) {
    check('preload succeeds with remote models DENIED', false, `-> ${err?.message ?? err}`)
    console.log('\nThe bundled models are not being found. localModelPath or asarUnpack is wrong.')
    process.exit(1)
  }

  // And it must actually transcribe, not merely load.
  const SR = 16000
  const b = fs.readFileSync(path.join(__dirname, 'fixtures', 'speech.wav'))
  let off = 12, audio = null
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4)
    if (id === 'data') {
      const n = Math.min(size / 2, 6 * SR)
      audio = new Float32Array(n)
      for (let i = 0; i < n; i++) audio[i] = b.readInt16LE(off + 8 + i * 2) / 32768
      break
    }
    off += 8 + size + (size % 2)
  }
  const got = []
  await whisper.startSession(t => got.push(t.text), () => {}, null, () => {})
  const batch = Math.round(SR * 0.1)
  for (let i = 0; i < audio.length; i += batch) whisper.feedPcm(audio.subarray(i, i + batch))
  const silence = new Float32Array(Math.round(SR * 1.5))
  for (let i = 0; i < silence.length; i += batch) whisper.feedPcm(silence.subarray(i, i + batch))
  await whisper.stopSession()
  check('transcribes real speech offline', got.length > 0 && got[0].length > 10,
    got.length ? JSON.stringify(got[0].slice(0, 60)) : '(nothing)')

  console.log(failures ? `\n${failures} FAILED` : '\ntranscription works with no network at all')
  process.exit(failures ? 1 : 0)
})()

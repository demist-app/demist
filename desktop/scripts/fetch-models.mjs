// Downloads the transcription models INTO the build, so the shipped app never
// has to reach Hugging Face to transcribe.
//
// Store certification failed 10.1.2.10 with "Product fails to load on-device
// model" on a machine that had a working internet connection. Transcription is
// the app's primary functionality and it could not start without a
// multi-gigabyte first-run download from a third party - on a restricted or
// slow network that fails, and the app is useless.
//
// The download is not actually large. Those 2332MB / 1027MB figures elsewhere
// in this codebase are RESIDENT MEMORY after loading, not file size:
//
//   whisper-small.en q8 (Accurate)  240 MB on disk
//   whisper-base.en  q8 (Fast)       75 MB on disk
//
// ~315MB for both, against a 683MB package. The user downloads roughly the
// same total bytes either way - this just moves them from Hugging Face
// (invisible, unreliable, fails silently mid-lecture) to the Microsoft Store
// (resumable, with a progress UI people already understand).
//
// The term-detection LLM is deliberately NOT bundled: it is 2GB on its own and
// it is a secondary feature. If it fails to download, transcription still
// works, which is the difference between degraded and broken.
//
//   node scripts/fetch-models.mjs        (run before npm run dist)
import { pipeline, env } from '@huggingface/transformers'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = path.join(HERE, '..', 'models')

// cacheDir's on-disk layout is <dir>/<org>/<model>/..., which is exactly what
// env.localModelPath expects to read back. So downloading here with cacheDir
// produces a tree the packaged app can load directly, with no rearranging.
env.cacheDir = MODELS_DIR
env.allowLocalModels = true

// Must match MODEL_BY_TIER and DTYPE in native/whisper.js. Both tiers are
// bundled because 'fast' is the default under 10GB of RAM, and a machine that
// gets 'fast' is exactly the one least able to survive a big download.
const TIERS = ['Xenova/whisper-base.en', 'Xenova/whisper-small.en']
const DTYPE = 'q8'

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`
function dirSize(dir) {
  let total = 0
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    total += e.isDirectory() ? dirSize(p) : fs.statSync(p).size
  }
  return total
}

fs.mkdirSync(MODELS_DIR, { recursive: true })
console.log(`fetching transcription models into ${MODELS_DIR}\n`)

for (const model of TIERS) {
  process.stdout.write(`  ${model} (${DTYPE}) ... `)
  // Instantiating the pipeline is what pulls every file the runtime actually
  // needs - config, tokenizer, preprocessor AND both onnx graphs. Listing
  // filenames by hand here would rot the moment transformers.js changes what
  // it asks for.
  await pipeline('automatic-speech-recognition', model, { dtype: DTYPE })
  console.log('done')
}

console.log(`\nbundled model tree: ${mb(dirSize(MODELS_DIR))}`)
for (const org of fs.readdirSync(MODELS_DIR)) {
  const orgDir = path.join(MODELS_DIR, org)
  if (!fs.statSync(orgDir).isDirectory()) continue
  for (const m of fs.readdirSync(orgDir)) {
    console.log(`  ${org}/${m}`.padEnd(38) + mb(dirSize(path.join(orgDir, m))))
  }
}

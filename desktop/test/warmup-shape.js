// Every recording's FIRST inference is catastrophically slow (13289, 17191,
// 26154, 27887 ms across four sessions) while every later one is ~2-3s. That
// is a cold cost paid once per session, not a machine that is slow.
//
// getTranscriber's warm-up runs one second of pure digital SILENCE, which
// decodes to about two tokens. Whisper's decoder is autoregressive with a
// growing KV cache, so a two-token run never exercises the shapes a real
// utterance needs - onnxruntime then allocates and optimises those on the
// first real call, which is the one the user is waiting on.
//
// Each variant runs in a FRESH process, because the whole point is the very
// first inference; measuring twice in one process would hide it.
//
//   node test/warmup-shape.js                  # runs every variant
//   node test/warmup-shape.js --child <kind>   # internal
const path = require('path')
const os = require('os')
const fs = require('fs')

const SR = 16000
const KINDS = ['none', 'silence', 'speech']

function readWav(file) {
  const b = fs.readFileSync(file); let off = 12
  while (off < b.length) {
    const id = b.toString('ascii', off, off + 4), size = b.readUInt32LE(off + 4)
    if (id === 'data') {
      const n = size / 2, out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(off + 8 + i * 2) / 32768
      return out
    }
    off += 8 + size + (size % 2)
  }
  throw new Error('no data chunk')
}

const caps = (n) => ({ max_new_tokens: Math.min(448, Math.ceil((n / SR) * 15) + 16), no_repeat_ngram_size: 6 })

async function child(kind) {
  const { pipeline, env } = require('@huggingface/transformers')
  env.cacheDir = path.join(os.homedir(), '.demist', 'model-cache')
  const clip = readWav(path.join(__dirname, 'fixtures', 'speech.wav'))
  const real = clip.subarray(0, Math.round(1.8 * SR)) // the size of the stalled preview

  const t = await pipeline('automatic-speech-recognition', 'Xenova/whisper-small.en', { dtype: 'q8' })

  let warmMs = 0
  if (kind === 'silence') {
    const s = Date.now()
    await t(new Float32Array(SR), caps(SR))
    warmMs = Date.now() - s
  } else if (kind === 'speech') {
    // Real speech of a realistic length: exercises the encoder AND a decode
    // long enough to build the shapes an actual utterance will need.
    const s = Date.now()
    await t(clip.subarray(0, Math.round(4 * SR)), caps(Math.round(4 * SR)))
    warmMs = Date.now() - s
  }

  const s = Date.now()
  await t(real, caps(real.length))
  console.log(`RESULT ${kind} warm=${warmMs} first=${Date.now() - s}`)
  process.exit(0)
}

const kindArg = process.argv[process.argv.indexOf('--child') + 1]
if (process.argv.includes('--child')) {
  child(kindArg)
} else {
  const { spawnSync } = require('child_process')
  console.log('warm-up variant   warm-up cost   FIRST real inference (1.8s of speech)')
  const rows = []
  for (const kind of KINDS) {
    const r = spawnSync(process.execPath, [__filename, '--child', kind], { encoding: 'utf8', maxBuffer: 1 << 26 })
    const m = /RESULT (\S+) warm=(\d+) first=(\d+)/.exec(r.stdout || '')
    if (!m) { console.log(`${kind.padEnd(17)} FAILED`); console.log((r.stderr || '').slice(0, 800)); continue }
    const [, , warm, first] = m
    rows.push({ kind, warm: Number(warm), first: Number(first) })
    console.log(`${kind.padEnd(17)} ${String(warm).padStart(9)} ms   ${String(first).padStart(10)} ms`)
  }
  const none = rows.find(r => r.kind === 'none')
  const speech = rows.find(r => r.kind === 'speech')
  if (none && speech) {
    console.log(`\nspeech warm-up cuts the first real inference by ${(none.first - speech.first)} ms (${(none.first / speech.first).toFixed(1)}x)`)
  }
  process.exit(0)
}

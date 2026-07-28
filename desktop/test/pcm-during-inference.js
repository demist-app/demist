// The one difference every earlier harness missed.
//
// In all of them, PCM had stopped arriving by the time inference ran. In a
// real recording it never stops: the renderer posts a frame every 100ms for
// the whole duration of the inference. transformers.js decodes one token per
// await, and every await hands the event loop back - so each of those pending
// PCM messages gets processed BETWEEN tokens, running the segmenter's
// per-frame RMS maths inside the decode loop.
//
// Measures the same inference with the PCM stream running and stopped.
//
//   node test/pcm-during-inference.js
const path = require('path')
const fs = require('fs')
const { Worker } = require('worker_threads')

const SR = 16000

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

function spawn() {
  const w = new Worker(path.join(__dirname, '..', 'native', 'worker.js'))
  let nextId = 1
  const pending = new Map()
  const diags = []
  w.on('message', (m) => {
    if (m.event === 'diag') { diags.push(m.payload.message); return }
    if (m.event) return
    const e = pending.get(m.id); if (!e) return
    pending.delete(m.id); m.error ? e.reject(new Error(m.error)) : e.resolve(m.result)
  })
  return {
    call: (type, ...args) => new Promise((res, rej) => {
      const id = nextId++; pending.set(id, { resolve: res, reject: rej })
      w.postMessage({ id, type, args })
    }),
    feed: (a) => { const c = new Float32Array(a); w.postMessage({ type: 'pcm', buffer: c.buffer }, [c.buffer]) },
    diags,
    terminate: () => w.terminate(),
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const tone = (secs) => Float32Array.from({ length: Math.round(secs * SR) }, () => (Math.random() - 0.5) * 0.003)

;(async () => {
  const clip = readWav(path.join(__dirname, 'fixtures', 'speech.wav'))
  const speech = clip.subarray(0, Math.round(6 * SR))
  const batch = Math.round(SR * 0.1)

  for (const streaming of [false, true]) {
    const w = spawn()
    await w.call('preloadWhisper')
    await w.call('startSession')

    // Feed 6s of speech then silence, so exactly one segment closes.
    for (let i = 0; i < speech.length; i += batch) w.feed(speech.subarray(i, i + batch))
    const silence = tone(1.2)
    for (let i = 0; i < silence.length; i += batch) w.feed(silence.subarray(i, i + batch))

    // While the segment transcribes, either keep the PCM stream running at the
    // real 10 frames/sec (as the renderer does) or stay quiet.
    let pumping = streaming
    const pump = (async () => {
      while (pumping) { w.feed(tone(0.1)); await sleep(100) }
    })()

    const t0 = Date.now()
    await w.call('stopSession') // drains the queue, so this covers the inference
    const ms = Date.now() - t0
    pumping = false
    await pump

    const line = w.diags.find(d => d.includes('transcribed in')) || '(none)'
    console.log(`PCM streaming during inference: ${String(streaming).padEnd(5)}  stopSession drain ${String(ms).padStart(6)} ms   ${line}`)
    await w.terminate()
  }
  process.exit(0)
})()

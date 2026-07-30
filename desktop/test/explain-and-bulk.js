// The two calls added so the desktop app stops sending lecture-derived text to
// OpenAI: llm.explain (the "what does this selection mean?" popups) and
// whisper.transcribeBuffer (importing a recorded file).
//
// Run against the REAL cached models, repeatedly, because reading this code
// cannot tell you whether a small quantized model actually answers the prompt -
// three separate diagnoses in this project's history were wrong for exactly
// that reason.
//
//   node test/explain-and-bulk.js
const fs = require('fs')
const path = require('path')
const { SAMPLE_RATE } = require('../native/pcm-segmenter')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`)
  else { failures++; console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`) }
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
  // ── transcribeBuffer: the import path ────────────────────────────────────
  console.log('bulk transcription (import):')
  const whisper = require('../native/whisper')
  const audio = loadFixture()
  console.log(`  fixture is ${(audio.length / SAMPLE_RATE).toFixed(1)}s`)

  const t0 = Date.now()
  const text = await whisper.transcribeBuffer(audio, () => {})
  const took = Date.now() - t0
  check('transcribes a whole file in one call', text.length > 40, `${took}ms -> ${JSON.stringify(text.slice(0, 90))}`)
  // The entire point of not using the live path: a file must not take as long
  // as the lecture did.
  check('faster than real time', took < (audio.length / SAMPLE_RATE) * 1000,
    `${took}ms for ${(audio.length / SAMPLE_RATE).toFixed(1)}s of audio`)

  const silence = new Float32Array(SAMPLE_RATE * 3)
  const silent = await whisper.transcribeBuffer(silence, () => {})
  check('silence transcribes to nothing, not a hallucination', silent === '', JSON.stringify(silent))

  // ── explain: the selection popups ────────────────────────────────────────
  console.log('\non-device explain (selection popups):')
  const llm = require('../native/llm')
  const CASES = [
    ['chemiosmosis', 'Biology'],
    ['ridge regularization', 'Machine Learning'],
    ['packet switching', 'Computer Science'],
    // Deliberately ordinary: unlike detectTerms, explain must still answer.
    // The user selected it and asked.
    ['opportunity cost', 'Economics'],
  ]
  for (const [term, subject] of CASES) {
    const t = Date.now()
    const def = await llm.explain(term, subject, 1)
    const ms = Date.now() - t
    const ok = !!def && def.length > 25 && def.toLowerCase() !== term.toLowerCase()
    check(`explains ${JSON.stringify(term)}`, ok, `${ms}ms -> ${JSON.stringify((def ?? '').slice(0, 100))}`)
  }

  // Called twice in a row on the same session sequence: the popups fire
  // whenever a user selects text, so back-to-back calls are the normal case,
  // and this shares one LlamaChatSession with detectTerms and summarize.
  const [a, b] = await Promise.all([llm.explain('enthalpy', 'Chemistry', 1), llm.explain('entropy', 'Chemistry', 1)])
  check('two concurrent explains both answer', !!a && !!b && a !== b,
    `${JSON.stringify((a ?? '').slice(0, 45))} / ${JSON.stringify((b ?? '').slice(0, 45))}`)

  console.log(failures ? `\n${failures} FAILED` : '\nboth new native calls work against the real models')
  process.exit(failures ? 1 : 0)
})()

// npm test - the fast, deterministic checks. Each of these encodes a bug that
// actually shipped, so a failure here means that bug is back.
//
// The slow measurement harnesses are NOT run from here, because they load
// multi-GB models and take minutes. Run them by hand when investigating a
// performance report:
//   npm run test:terms      term-detection precision (needs the LLM)
//   npm run test:decode     inference cost vs audio length and quality
//   npm run test:pressure   inference latency as free memory falls
//   npm run test:idle       first-inference latency after idle gaps
const assert = require('assert')
const { isEverydayWord } = require('../native/common-words')
const { PcmSegmenter, SAMPLE_RATE } = require('../native/pcm-segmenter')

let failures = 0
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`) }
  catch (err) { failures++; console.log(`  FAIL ${name}\n       ${err.message}`) }
}

console.log('everyday-word filter (term detection precision)')
// Real false positives from a live session.
for (const w of ['raspberry', 'Bye', 'cold', 'jacket', 'broken', 'prepared', 'ones', 'jackets', 'berries']) {
  check(`drops everyday word: ${w}`, () => assert.strictEqual(isEverydayWord(w), true))
}
// One-word jargon must survive, or term detection silently dies.
for (const w of ['chemiosmosis', 'datagram', 'enthalpy', 'calorimetry', 'overfitting']) {
  check(`keeps one-word jargon: ${w}`, () => assert.strictEqual(isEverydayWord(w), false))
}
// Words that are everyday English AND real technical terms must survive: a
// physics lecture says "current" and "work", a maths lecture says "ring".
for (const w of ['current', 'work', 'field', 'power', 'force', 'energy', 'ring', 'group', 'matrix', 'function']) {
  check(`keeps ambiguous technical word: ${w}`, () => assert.strictEqual(isEverydayWord(w), false))
}
// Multi-word terms are never filtered.
for (const w of ['proton motive force', 'Giffen good', 'loss function', 'packet switching']) {
  check(`keeps multi-word term: ${w}`, () => assert.strictEqual(isEverydayWord(w), false))
}

console.log('\nsegmenter energy gate (room tone must not reach transcription)')
const SILENT_SEGMENT_RMS = 0.006
function segmentsFor(audio) {
  const out = []
  const seg = new PcmSegmenter((s, meanRms) => out.push({ secs: s.length / SAMPLE_RATE, meanRms }), null)
  const batch = Math.round(SAMPLE_RATE * 0.1)
  for (let o = 0; o < audio.length; o += batch) seg.feed(audio.subarray(o, o + batch))
  seg.flush()
  return out
}
const tone = (secs, level) => Float32Array.from({ length: Math.round(secs * SAMPLE_RATE) }, () => (Math.random() - 0.5) * level)
const speechAt = (secs, rms) => Float32Array.from({ length: Math.round(secs * SAMPLE_RATE) }, (_, i) => {
  const t = i / SAMPLE_RATE
  return rms * 3 * (Math.sin(2 * Math.PI * 180 * t) + 0.6 * Math.sin(2 * Math.PI * 750 * t) * Math.sin(2 * Math.PI * 2 * t))
})
const join = (...a) => { const o = new Float32Array(a.reduce((n, x) => n + x.length, 0)); let k = 0; for (const x of a) { o.set(x, k); k += x.length } return o }

check('pure room tone produces no segments at all', () => {
  assert.strictEqual(segmentsFor(tone(12, 0.003)).length, 0)
})
check('normal speech survives the energy gate', () => {
  const segs = segmentsFor(join(tone(1, 0.002), speechAt(5, 0.03), tone(1.5, 0.002)))
  assert.ok(segs.length > 0, 'no segments closed at all')
  assert.ok(segs.some(s => s.meanRms >= SILENT_SEGMENT_RMS), `all below gate: ${JSON.stringify(segs)}`)
})
check('quiet speech still survives the energy gate', () => {
  const segs = segmentsFor(join(tone(1, 0.002), speechAt(5, 0.010), tone(2, 0.002)))
  assert.ok(segs.length > 0, 'no segments closed at all')
  assert.ok(segs.some(s => s.meanRms >= SILENT_SEGMENT_RMS), `all below gate: ${JSON.stringify(segs)}`)
})

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)

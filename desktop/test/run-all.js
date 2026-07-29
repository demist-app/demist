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
const {
  PcmSegmenter, SAMPLE_RATE,
  MAX_SEGMENT_CEILING_MS, MIN_MAX_SEGMENT_MS, INITIAL_MAX_SEGMENT_MS,
} = require('../native/pcm-segmenter')

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
// Multi-word terms survive as long as ANY word in them is technical.
for (const w of ['proton motive force', 'Giffen good', 'loss function', 'packet switching']) {
  check(`keeps multi-word term: ${w}`, () => assert.strictEqual(isEverydayWord(w), false))
}
// ...but a phrase made entirely of everyday words is not a term card. These
// used to be structurally unfilterable: the filter bailed out on any term
// containing a space, so the word list it was built from was never consulted.
// ('the reading' and friends are course ADMIN rather than everyday English;
// llm.js's isAdmin handles those, phrase-aware for the same reason.)
for (const w of ['next week', 'good question', 'office hours', 'this week', 'a lot of things']) {
  check(`drops everyday phrase: ${w}`, () => assert.strictEqual(isEverydayWord(w), true))
}

console.log('\nsegmenter energy gate (room tone must not reach transcription)')
const SILENT_SEGMENT_RMS = 0.006
function segmentsFor(audio, configure) {
  const out = []
  const seg = new PcmSegmenter(
    (s, meanRms, contiguous) => out.push({ secs: s.length / SAMPLE_RATE, meanRms, contiguous }),
    null,
  )
  configure?.(seg)
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

console.log('')
console.log('term-line parser (the model does not always keep the labels)')
const { matchTermLine } = require('../native/llm')
// Verbatim from Llama-3.2-3B on a real lecture. The strict regex rejected
// this, so the session produced no term cards at all while the model was in
// fact answering correctly.
check('parses the labelless shape the model really emits', () => {
  const m = matchTermLine('arithmetic logic unit: A hardware component within a CPU that performs mathematical and logical operations. | CONTEXT: different CPU registers, such as the arithmetic logic unit.')
  assert.ok(m, 'did not match at all')
  assert.strictEqual(m[1], 'arithmetic logic unit')
  assert.ok(m[2].startsWith('A hardware component'), m[2])
})
check('still parses the canonical shape the prompt asks for', () => {
  const m = matchTermLine('TERM: chemiosmosis | DEFINITION: Movement of ions across a membrane. | CONTEXT: chemiosmosis drives ATP synthase.')
  assert.ok(m, 'did not match at all')
  assert.strictEqual(m[1], 'chemiosmosis')
  assert.strictEqual(m[2], 'Movement of ions across a membrane.')
})
check('tolerates a leading bullet', () => {
  assert.ok(matchTermLine('- TERM: datagram | DEFINITION: A packet. | CONTEXT: each datagram is routed.'))
})
// The loosened parser must NOT start matching ordinary prose. '| CONTEXT:' is
// the anchor that keeps it honest.
for (const junk of [
  'NONE',
  'Here are the terms I found:',
  'The lecture covered several topics: programming, testing and deployment.',
  'I hope this helps! Let me know if you need anything else.',
  '',
]) {
  check('rejects non-term line: ' + JSON.stringify(junk.slice(0, 40)), () => {
    assert.strictEqual(matchTermLine(junk), null)
  })
}

console.log('\nforced cut (end-to-end latency floor: audio cannot start transcribing until its segment closes)')

check('a session starts at the short initial cut, not the ceiling', () => {
  // 20s of unbroken speech: nothing but the forced cut can close a segment.
  const segs = segmentsFor(speechAt(20, 0.05))
  assert.ok(segs.length >= 5, `expected repeated forced cuts, got ${segs.length} segments`)
  const first = segs[0].secs
  assert.ok(
    Math.abs(first - INITIAL_MAX_SEGMENT_MS / 1000) < 0.3,
    `first forced cut was ${first}s, expected ~${INITIAL_MAX_SEGMENT_MS / 1000}s`,
  )
})

check('setMaxSegmentMs retunes the cut and clamps to the measured-safe range', () => {
  const seg = new PcmSegmenter(() => {}, null)
  assert.strictEqual(seg.setMaxSegmentMs(4000), 4000)
  // A machine so fast it would cut every 200ms still cannot: at zero backlog
  // every cut is one inference, and Whisper's cost does not shrink with it.
  assert.strictEqual(seg.setMaxSegmentMs(200), MIN_MAX_SEGMENT_MS)
  // And a machine so slow it would cut every minute still cannot: that is
  // pure latency with nothing bought for it.
  assert.strictEqual(seg.setMaxSegmentMs(60000), MAX_SEGMENT_CEILING_MS)
})

check('speech cut mid-sentence is reported contiguous, so it is re-joined without a fake pause', () => {
  const segs = segmentsFor(speechAt(20, 0.05))
  assert.strictEqual(segs[0].contiguous, false, 'the first segment continues nothing')
  // Only the segments that closed at the forced cut are checked. A synthetic
  // constant-amplitude tone eventually drags the adaptive noise floor up to
  // its own level and the VAD stops hearing it, closing a short segment on
  // the hangover instead - correct behaviour on an input real speech never
  // produces, and not what this test is about.
  const cutLength = INITIAL_MAX_SEGMENT_MS / 1000
  const forced = segs.filter(s => Math.abs(s.secs - cutLength) < 0.05)
  assert.ok(forced.length >= 3, `expected several forced cuts, got ${JSON.stringify(segs.map(s => s.secs))}`)
  assert.ok(
    forced.slice(1).every(s => s.contiguous === true),
    `forced cuts through unbroken speech must all be contiguous: ${JSON.stringify(segs)}`,
  )
})

check('speech after a real pause is NOT contiguous, so the pause is preserved when merged', () => {
  const segs = segmentsFor(join(speechAt(2, 0.05), tone(2, 0.002), speechAt(2, 0.05)))
  assert.strictEqual(segs.length, 2, `expected two segments either side of the pause, got ${segs.length}`)
  assert.strictEqual(segs[1].contiguous, false, 'a segment after 2s of silence must not claim to continue the previous one')
})

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)

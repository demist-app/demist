// The app must SAY when it is receiving audio it cannot transcribe.
//
// A user recorded for 54 seconds with their microphone muted and saw a running
// timer, a moving level meter and an empty transcript, with nothing anywhere
// explaining why. Dropping room tone is correct - it stops Whisper
// hallucinating over silence - but doing it silently is not, and a
// certification tester on a laptop with a muted mic would file exactly what
// that user did: "transcription does not work".
//
// Two distinct shapes, and only one of them is a dropped segment:
//   - QUIET: loud enough to open a segment, too quiet to keep it, so segments
//     arrive and are discarded.
//   - MUTED: never crosses the VAD threshold at all, so no segment is ever
//     opened and there is nothing to count.
//
//   node test/quiet-audio.js
const { SAMPLE_RATE } = require('../native/pcm-segmenter')
const whisper = require('../native/whisper')

let failures = 0
const check = (n, ok, d = '') => { if (ok) console.log(`  ok   ${n}${d ? '  ' + d : ''}`); else { failures++; console.log(`  FAIL ${n}${d ? '  ' + d : ''}`) } }

// Feed in realistic 100ms batches, as the renderer does.
function feed(seconds, sampleAt) {
  const batch = Math.round(SAMPLE_RATE * 0.1)
  const total = Math.round(SAMPLE_RATE * seconds)
  for (let i = 0; i < total; i += batch) {
    const n = Math.min(batch, total - i)
    const buf = new Float32Array(n)
    for (let j = 0; j < n; j++) buf[j] = sampleAt(i + j)
    whisper.feedPcm(buf)
  }
}

const silence = () => (Math.random() - 0.5) * 0.0006          // a muted input's noise floor
const speech = (i) => {                                        // loud, clearly over threshold
  const t = i / SAMPLE_RATE
  return 0.12 * (Math.sin(2 * Math.PI * 130 * t) + 0.5 * Math.sin(2 * Math.PI * 700 * t))
}

;(async () => {
  // ── MUTED: no segment is ever opened ──────────────────────────────────────
  console.log('a muted microphone (never crosses the speech threshold):')
  let notices = []
  await whisper.startSession(() => {}, () => {}, null, () => {}, m => notices.push(m))
  feed(20, silence)
  const warned = notices.filter(Boolean)
  check('the user is told, rather than left with an empty transcript',
    warned.length === 1, warned[0] ? JSON.stringify(warned[0].slice(0, 70)) : '(said nothing)')
  check('it is said once, not once per batch', warned.length <= 1, `${warned.length} notices`)

  // Unmuting mid-session must retract it.
  notices = []
  feed(6, speech)
  await whisper.stopSession()
  check('the notice is retracted once real speech arrives',
    notices.includes(''), JSON.stringify(notices))

  // ── QUIET: segments open, then get dropped ────────────────────────────────
  console.log('\na microphone turned right down (opens segments, all discarded):')
  notices = []
  await whisper.startSession(() => {}, () => {}, null, () => {}, m => notices.push(m))
  // Just over the VAD's 0.006 open threshold in bursts, but averaging under the
  // 0.006 the segment as a whole must clear to be kept.
  let n = 0
  feed(30, (i) => {
    const burst = Math.floor(i / (SAMPLE_RATE * 0.5)) % 6 === 0
    n++
    return burst ? speech(i) * 0.075 : silence()
  })
  await whisper.stopSession()
  check('the user is told here too', notices.filter(Boolean).length >= 1,
    notices.filter(Boolean)[0] ? JSON.stringify(notices.filter(Boolean)[0].slice(0, 70)) : '(said nothing)')

  // ── Normal speech must stay silent ────────────────────────────────────────
  console.log('\na working microphone:')
  notices = []
  await whisper.startSession(() => {}, () => {}, null, () => {}, m => notices.push(m))
  feed(12, speech)
  await whisper.stopSession()
  check('says nothing when the audio is fine', notices.filter(Boolean).length === 0,
    JSON.stringify(notices.filter(Boolean)))

  console.log(failures ? `\n${failures} FAILED` : '\nquiet and muted input are both reported')
  process.exit(failures ? 1 : 0)
})()

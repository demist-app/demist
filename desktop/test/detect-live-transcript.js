// Runs the REAL detectTerms against a transcript that produced no term cards
// in a real session, in the same shape the app feeds it: the renderer batches
// roughly 4 seconds of speech per call (see accumulateAndMaybeDetect in
// web/lib/recordingSession.tsx), NOT the whole lecture at once.
//
// That distinction is the point of this harness. Handing the model the entire
// passage is a different, easier task than handing it two short fragments and
// asking what a student would not know.
//
//   node test/detect-live-transcript.js
const llm = require('../native/llm')

// Verbatim from a session that produced nothing, split the way the segmenter
// actually cut it.
const LINES = [
  'Okay, so today we are going to talk about programming and software engineering.',
  'Software engineering and programming go hand in hand because they are basically',
  'the same job in many aspects.',
  'So...',
  'They do share some differences.',
  'For example, programming does not necessarily include',
  'cloud hosting',
  'and other DevOps responsibilities.',
  'However...',
  'A lot of software engineering.',
  'can come under the umbrella of programming.',
  'programming comes in several different ways.',
  'for example, procedural programming.',
  'which is a method of programming.',
  'in one singular function.',
  'or file.',
  'the alternative to this',
  'is object-oriented programming.',
  'Which is a vital',
  'approach that all software engineers',
  'should be aware of.',
  'when programming.',
  'Object Oriented Programming',
  'Structures cold, a lot cleaner.',
  'and increases the readability.',
  'of a code base.',
  'We are also going to be talking about',
  'different CPU registers.',
  'such as the arithmetic logic unit.',
  'the current instruction register.',
]

// What a reasonable person would expect to be offered from the above.
const EXPECTED = [
  'devops', 'procedural programming', 'object-oriented programming',
  'object oriented programming', 'arithmetic logic unit',
  'current instruction register', 'cpu register', 'registers', 'cloud hosting',
]

const SUBJECT = 'Computer Science'
const YEAR = 2

;(async () => {
  console.log(`tier: ${llm.getTier()}\n`)
  await llm.preload(() => {})

  // 1. The whole passage at once - the easy case, to prove the model can see
  //    anything here at all.
  const whole = await llm.detectTerms(LINES.join(' '), '', SUBJECT, YEAR)
  console.log('WHOLE PASSAGE AT ONCE')
  console.log(`  -> ${JSON.stringify(whole.map(t => t.term))}\n`)

  // 2. The real shape: ~4s batches with rolling context, as the app sends it.
  console.log('AS THE APP ACTUALLY SENDS IT (batched, with rolling context)')
  const found = []
  let context = ''
  const BATCH = 4
  for (let i = 0; i < LINES.length; i += BATCH) {
    const chunk = LINES.slice(i, i + BATCH).join(' ')
    const terms = await llm.detectTerms(chunk, context, SUBJECT, YEAR)
    context = (context + ' ' + chunk).trim().slice(-300)
    if (terms.length) found.push(...terms.map(t => t.term))
    console.log(`  batch ${String(i / BATCH + 1).padStart(2)}: ${terms.length ? JSON.stringify(terms.map(t => t.term)) : '(none)'}`)
  }

  const lower = found.map(t => t.toLowerCase())
  const hits = EXPECTED.filter(e => lower.some(f => f.includes(e) || e.includes(f)))
  console.log(`\ntotal terms from the batched run: ${found.length}`)
  console.log(`  ${JSON.stringify(found)}`)
  console.log(`\nof the obvious ones, it found ${hits.length}/${EXPECTED.length}: ${JSON.stringify(hits)}`)
  console.log(found.length === 0
    ? '\nNOTHING AT ALL - this reproduces the bug.'
    : '\nTerms were produced, so the model is not the problem - look at the renderer path.')
  process.exit(0)
})()

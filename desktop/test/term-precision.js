// Term detection should fire on subject jargon and stay silent on ordinary
// speech. Reported failures: it produced cards for "raspberry" (from "did you
// put the raspberry ones in the bag") and "bye" (from a goodbye), which are
// ordinary English words, not lecture vocabulary.
//
// MUNDANE excerpts must yield nothing. TECHNICAL excerpts must yield at least
// one term, so a fix for the false positives cannot quietly be "return
// nothing, ever" - which is the exact regression the file header warns about
// (grammar-constrained decoding once made this emit an empty array for
// essentially every input).
//
//   node test/term-precision.js
const llm = require('../native/llm')

const { MUNDANE, TECHNICAL, GARBLED } = require('./fixtures/precision-sets')

;(async () => {
  // Pin the tier, so the two can be compared directly rather than whichever
  // one this machine's memory happens to choose today:
  //   node test/term-precision.js tiny
  //   node test/term-precision.js small
  // Via the env override, NOT setTier: setTier writes ~/.demist/llm-models/
  // tier.json, which is the live config a running app re-reads on every call.
  // Running this in the background while the desktop app was open flipped a
  // real recording session from 'small' to 'tiny' mid-lecture, and the app
  // dutifully loaded the second model. A test must never mutate user state.
  const wanted = process.argv[2]
  if (wanted) process.env.DEMIST_LLM_TIER = wanted
  console.log(`tier: ${llm.getTier()}\n`)
  await llm.preload(() => {})

  let falsePositives = 0, missed = 0
  console.log('MUNDANE (expect no terms)')
  for (const [name, text] of MUNDANE) {
    const terms = await llm.detectTerms(text, '', null, null)
    const got = terms.map(t => t.term)
    if (got.length) { falsePositives++; console.log(`  FAIL ${name.padEnd(12)} -> ${JSON.stringify(got)}`) }
    else console.log(`  ok   ${name.padEnd(12)} -> (none)`)
  }

  console.log('\nTECHNICAL (expect at least one term)')
  for (const [name, text, subject] of TECHNICAL) {
    const terms = await llm.detectTerms(text, '', subject, 2)
    const got = terms.map(t => t.term)
    if (!got.length) { missed++; console.log(`  FAIL ${name.padEnd(12)} -> (none)`) }
    else console.log(`  ok   ${name.padEnd(12)} -> ${JSON.stringify(got)}`)
  }

  let garbledKept = 0
  console.log('\nGARBLED (the mis-heard term must not come back)')
  for (const [name, text, subject, bad] of GARBLED) {
    const terms = await llm.detectTerms(text, '', subject, 2)
    const got = terms.map(t => t.term)
    if (got.some(t => t.toLowerCase().includes(bad))) { garbledKept++; console.log(`  FAIL ${name.padEnd(12)} -> ${JSON.stringify(got)}`) }
    else console.log(`  ok   ${name.padEnd(12)} -> ${got.length ? JSON.stringify(got) : '(none)'}`)
  }

  console.log(`\nfalse positives on mundane speech: ${falsePositives}/${MUNDANE.length}`)
  console.log(`missed technical excerpts:          ${missed}/${TECHNICAL.length}`)
  console.log(`mis-heard terms that got through:   ${garbledKept}/${GARBLED.length}`)
  process.exit(falsePositives === 0 && missed === 0 && garbledKept === 0 ? 0 : 1)
})()

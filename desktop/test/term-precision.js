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

const MUNDANE = [
  ['raspberry', 'Oh, did you put the raspberry ones in the bag and said they were normal ones?'],
  ['goodbye', 'Yeah. Bye. See you later, take care.'],
  ['admin', 'The reading is chapter four and the tutorial is on Thursday, so please come prepared.'],
  ['smalltalk', 'I am going to use this one because the other one was a bit broken yesterday.'],
  ['weather', 'It is really cold outside today and I forgot my jacket again, which was silly of me.'],
]

// Two sentences each, which is the shape of a real detection chunk. A single
// terse sentence is NOT representative: the same ML excerpt cut to one line
// returned nothing while the two-line version returned "Prior" and "Loss
// function", so short fixtures test the model's tolerance for fragments
// rather than the behaviour this suite is meant to pin down.
const TECHNICAL = [
  ['biology', 'Chemiosmosis drives ATP synthase using the proton motive force across the inner mitochondrial membrane. This gradient is what actually couples respiration to ATP production.', 'Biology'],
  ['ml', 'Today we look at Bayesian ridge regularization. The prior acts as a penalty term in the loss function, which shrinks the coefficients toward zero and controls overfitting.', 'Machine Learning'],
  ['networks', 'Packet switching means each datagram is routed independently. Because of that the network adapter may receive them out of order, and the transport layer has to reassemble them.', 'Computer Science'],
  ['econ', 'A Giffen good violates the law of demand. That happens because the income effect outweighs the substitution effect, so demand rises as the price rises.', 'Economics'],
  ['chem', 'The enthalpy change of the reaction is measured by calorimetry. The activation energy determines the reaction rate, which is why a catalyst speeds things up.', 'Chemistry'],
]

;(async () => {
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

  console.log(`\nfalse positives on mundane speech: ${falsePositives}/${MUNDANE.length}`)
  console.log(`missed technical excerpts:          ${missed}/${TECHNICAL.length}`)
  process.exit(falsePositives === 0 && missed === 0 ? 0 : 1)
})()

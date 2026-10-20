// Per-call cost of on-device term detection on CPU only (no GPU), the case
// for every laptop without a dedicated graphics card. Runs the tier alone,
// so this is the floor; a live lecture adds transcription on the same cores.
//   DEMIST_LLM_GPU=off node test/detect-cpu-timing.js tiny
const tier = process.argv[2] || 'tiny'
process.env.DEMIST_LLM_TIER = tier
const llm = require('../native/llm')
const EX = [
  ['Biology', 'Chemiosmosis drives ATP synthase using the proton motive force across the inner mitochondrial membrane. This gradient is what couples respiration to ATP production.'],
  ['Economics', 'A Giffen good violates the law of demand. That happens because the income effect outweighs the substitution effect, so demand rises as the price rises.'],
  ['Chemistry', 'The enthalpy change of the reaction is measured by calorimetry. The activation energy determines the reaction rate, which is why a catalyst speeds things up.'],
  ['General', 'Okay so if everyone could just sit down, we will get started in a minute. Remember the reading for Thursday is chapter four.'],
]
;(async () => {
  let t = Date.now(); await llm.preload(() => {}); console.log(`load ${Date.now() - t}ms`)
  for (const [subject, text] of EX) {
    t = Date.now()
    const terms = await llm.detectTerms(text, '', subject, 2, () => {}, [])
    console.log(`${subject.padEnd(10)} ${String(Date.now() - t).padStart(6)}ms -> ${JSON.stringify(terms.map(x => x.term))}`)
  }
  process.exit(0)
})()

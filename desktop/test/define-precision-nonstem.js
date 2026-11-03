// Candidates-first detection on courses outside science (fixtures/precision-nonstem.json).
//   DEMIST_LLM_GPU=off node test/define-precision-nonstem.js tiny
// Tier pinned via DEMIST_LLM_TIER, never setTier (tests must not touch user state).
// Each fixture is one window with a single candidate: a real term must come back
// defined, an everyday word must not. Exit 1 below the bar measured on 2026-11-03.
const wanted = process.argv[2]
if (wanted) process.env.DEMIST_LLM_TIER = wanted
const llm = require('../native/llm')
const sets = require('./fixtures/precision-nonstem.json')

;(async () => {
  let kept = 0, leaked = 0
  for (const [name, rows] of [['NONSTEM_TECH', sets.NONSTEM_TECH], ['NONSTEM_MUNDANE', sets.NONSTEM_MUNDANE]]) {
    console.log(`\n${name}`)
    for (const r of rows) {
      const got = await llm.defineCandidates([{ term: r.term, sentence: r.sentence }], r.subject, null, () => {}, [])
      const hit = got.length > 0
      if (name === 'NONSTEM_TECH' && hit) kept++
      if (name === 'NONSTEM_MUNDANE' && hit) leaked++
      console.log(`  ${hit ? 'card' : '  - '} ${r.term.padEnd(24)} ${hit ? got[0].definition.slice(0, 90) : ''}`)
    }
  }
  console.log(`\nreal terms carded: ${kept}/${sets.NONSTEM_TECH.length}, everyday words carded: ${leaked}/${sets.NONSTEM_MUNDANE.length}`)
  // Measured 2026-11-03: 7/12 and 0/12 with the old check, 8/12 and 0/12 with
  // the current one. Still missed: Alzheimer, PSW, WSIB, cognitive impairment.
  // On seven real lectures the same change took real terms from 19/59 to 34/59.
  process.exit(kept >= 8 && leaked <= 1 ? 0 : 1)
})()

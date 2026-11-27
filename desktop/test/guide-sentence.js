// The read-aloud sentences in web/components/FirstRecordingGuide.tsx must give
// a new user at least one explanation on the on-device model, or their first
// test shows nothing. Candidates are what the renderer's extractor produces
// for each sentence (see web/scripts/test-term-candidates-live.ts guide).
//
//   node test/guide-sentence.js [tier]
// Tier pinned via DEMIST_LLM_TIER, never setTier (tests must not touch user state).
const wanted = process.argv[2]
if (wanted) process.env.DEMIST_LLM_TIER = wanted
const llm = require('../native/llm')

const S1 = 'Mitochondria make ATP through oxidative phosphorylation, which is part of cellular respiration.'
const S2 = 'The proton motive force drives ATP synthase across the inner mitochondrial membrane.'
const ROWS = [
  { name: 'mitochondria', candidates: ['ATP', 'Mitochondria', 'oxidative', 'phosphorylation', 'respiration'].map(term => ({ term, sentence: S1 })) },
  { name: 'proton motive', candidates: ['ATP synthase', 'proton motive force', 'inner mitochondrial membrane'].map(term => ({ term, sentence: S2 })) },
]

;(async () => {
  console.log(`tier: ${llm.getTier()}`)
  const t0 = Date.now()
  await llm.preload(() => {})
  console.log(`preload ${Date.now() - t0} ms`)
  let ok = true
  // Twice each: the first call after load and a warm one, as a user would see.
  for (const pass of [1, 2]) {
    for (const row of ROWS) {
      const t = Date.now()
      const terms = await llm.defineCandidates(row.candidates, '', 2, () => {}, [])
      const names = (terms || []).map(x => x.term)
      console.log(`pass ${pass} ${row.name}: ${names.length} terms in ${Date.now() - t} ms -> ${names.join(', ')}`)
      if (!names.length) ok = false
    }
  }
  console.log(ok ? 'PASS' : 'FAIL')
  process.exit(ok ? 0 : 1)
})().catch(e => { console.error(e); process.exit(1) })

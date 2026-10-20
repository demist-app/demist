// term-precision.js for the candidates-first path (llm.defineCandidates):
// the same excerpts, fed the candidates the renderer's extractor produces for
// them (fixtures/precision-candidates.json, regenerate with
// web/scripts/make-desktop-candidates.ts), graded the same way:
//   mundane   -> no terms
//   technical -> at least one term
//   garbled   -> the mis-heard term never comes back
// plus the time each window takes, which is the point of this path.
//
//   DEMIST_LLM_GPU=off node test/define-precision.js tiny
// Tier pinned via DEMIST_LLM_TIER, never setTier (tests must not touch user state).
const wanted = process.argv[2]
if (wanted) process.env.DEMIST_LLM_TIER = wanted
const llm = require('../native/llm')
const sets = require('./fixtures/precision-candidates.json')

;(async () => {
  console.log(`tier: ${llm.getTier()}  gpu: ${process.env.DEMIST_LLM_GPU === 'off' ? 'off' : 'auto'}\n`)
  await llm.preload(() => {})
  const times = []
  let falsePositives = 0, missed = 0, garbledKept = 0

  const run = async (row) => {
    const t = Date.now()
    const terms = await llm.defineCandidates(row.candidates, row.subject, 2, () => {}, [])
    const ms = Date.now() - t
    if (row.candidates.length) times.push(ms)
    return { terms, ms }
  }

  console.log('MUNDANE (expect no terms)')
  for (const row of sets.MUNDANE) {
    const { terms, ms } = await run(row)
    const got = terms.map(t => t.term)
    if (got.length) falsePositives++
    console.log(`  ${got.length ? 'FAIL' : 'ok  '} ${row.label.padEnd(11)} ${String(ms).padStart(6)}ms -> ${got.length ? JSON.stringify(got) : '(none)'}`)
  }
  console.log('\nTECHNICAL (expect at least one term)')
  for (const row of sets.TECHNICAL) {
    const { terms, ms } = await run(row)
    if (!terms.length) missed++
    console.log(`  ${terms.length ? 'ok  ' : 'FAIL'} ${row.label.padEnd(11)} ${String(ms).padStart(6)}ms -> ${terms.map(t => t.term).join(' | ') || '(none)'}`)
    for (const t of terms) console.log(`         ${t.term}: ${t.definition.slice(0, 110)}`)
  }
  console.log('\nGARBLED (the mis-heard term must not come back)')
  for (const row of sets.GARBLED) {
    const { terms, ms } = await run(row)
    const got = terms.map(t => t.term)
    const bad = got.some(t => t.toLowerCase().includes(row.bad))
    if (bad) garbledKept++
    console.log(`  ${bad ? 'FAIL' : 'ok  '} ${row.label.padEnd(11)} ${String(ms).padStart(6)}ms -> ${got.length ? JSON.stringify(got) : '(none)'}`)
  }

  times.sort((a, b) => a - b)
  const median = times.length ? times[Math.floor(times.length / 2)] : 0
  console.log(`\nfalse positives on mundane speech: ${falsePositives}/${sets.MUNDANE.length}`)
  console.log(`missed technical excerpts:          ${missed}/${sets.TECHNICAL.length}`)
  console.log(`mis-heard terms that got through:   ${garbledKept}/${sets.GARBLED.length}`)
  console.log(`time per window with candidates:    median ${median}ms, worst ${times[times.length - 1] ?? 0}ms (windows with none skip the model)`)
  process.exit(falsePositives === 0 && missed === 0 && garbledKept === 0 ? 0 : 1)
})()

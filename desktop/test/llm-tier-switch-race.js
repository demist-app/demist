// Verifies the ensureLoaded() fix in native/llm.js: a tier switch requested
// while a generation is still in flight must wait for it to finish instead
// of disposing the model/context it's actively using. Before the fix, this
// reproduced a use-after-dispose crash in llama.cpp's native binding.
//
// Does not await the first call before starting the tier switch + second
// call - the whole point is to create the overlap. session.prompt() is
// mostly native/off-thread work, so the JS event loop is free to run the
// tier switch while the first prompt is still generating.
//
//   node test/llm-tier-switch-race.js
const fs = require('fs')
const path = require('path')
const os = require('os')

const TIER_FILE = path.join(os.homedir(), '.demist', 'llm-models', 'tier.json')
const hadTierFile = fs.existsSync(TIER_FILE)
const originalTierFile = hadTierFile ? fs.readFileSync(TIER_FILE, 'utf8') : null

const llm = require('../native/llm')

;(async () => {
  try {
    console.log('setting tier to tiny, warming up...')
    llm.setTier('tiny')
    await llm.preload()
    console.log('tiny loaded. Firing a detectTerms() call, then switching tier mid-flight...')

    const longTranscript = 'Chemiosmosis drives ATP synthase using the proton motive force across the inner mitochondrial membrane. '.repeat(4)

    const callA = llm.detectTerms(longTranscript, '', 'Biology', 2, undefined, [])
      .then(r => ({ ok: true, terms: r }))
      .catch(e => ({ ok: false, error: e?.message ?? String(e) }))

    // Fired immediately, NOT after callA settles - this is the race window.
    llm.setTier('small')
    const callB = llm.explain('mitochondrial matrix', 'Biology', 2)
      .then(r => ({ ok: true, definition: r }))
      .catch(e => ({ ok: false, error: e?.message ?? String(e) }))

    const [resultA, resultB] = await Promise.all([callA, callB])
    console.log('call A (detectTerms, started on tiny):', JSON.stringify(resultA))
    console.log('call B (explain, started right after switching to small):', JSON.stringify(resultB))

    const finalTier = llm.getTier()
    console.log('final tier:', finalTier)

    if (!resultA.ok || !resultB.ok) {
      console.error('\nFAIL: at least one call threw instead of completing cleanly.')
      process.exitCode = 1
    } else if (finalTier !== 'small') {
      console.error('\nFAIL: expected final tier to be small, got', finalTier)
      process.exitCode = 1
    } else {
      console.log('\nPASS: both calls completed, no crash, tier switch landed correctly.')
    }

    // One more call on the new tier, to prove the model left in place after
    // the switch is actually usable and not left in some half-disposed state.
    const sanity = await llm.explain('proton motive force', 'Biology', 2).catch(e => null)
    console.log('post-switch sanity call result:', sanity ? '(got a definition)' : '(FAILED - null/threw)')
    if (!sanity) process.exitCode = 1
  } finally {
    // Restore whatever tier.json looked like before this test ran - this is
    // real shared user state (~/.demist), not a test fixture.
    if (hadTierFile) fs.writeFileSync(TIER_FILE, originalTierFile)
    else { try { fs.unlinkSync(TIER_FILE) } catch { /* already gone */ } }
    process.exit(process.exitCode ?? 0)
  }
})()

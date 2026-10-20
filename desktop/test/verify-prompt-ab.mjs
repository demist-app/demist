// A/B of the yes/no term check (llm.js verifyTerm) on the tiny model, CPU only.
// Asks every candidate from the technical and garbled fixtures under:
//   orig-fresh  the 2026-10-18 wording, context cleared before each check
//   orig-reuse  the same wording, prompts back to back (llama.cpp reuses the
//               shared start of the prompt)
//   new-reuse   instructions first, candidate last, question repeated after
// so a change in recall can be pinned on the wording or on the reuse.
//   node test/verify-prompt-ab.mjs
import { getLlama, LlamaChatSession } from 'node-llama-cpp'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
const require = createRequire(import.meta.url)
const sets = require('./fixtures/precision-candidates.json')

const llama = await getLlama({ gpu: false })
const model = await llama.loadModel({ modelPath: path.join(os.homedir(), '.demist', 'llm-models', 'hf_bartowski_Qwen2.5-1.5B-Instruct.Q4_K_M.gguf') })
const grammar = await llama.createGrammarForJsonSchema({ type: 'object', properties: { technical: { type: 'boolean' } }, required: ['technical'] })

const EX_YES = 'Yes, true: genuine terms, including well-known ones. Examples: "ATP synthase", "catalyst", "datagram", "income effect", "activation energy", "loss function".'
const EX_NO = 'No, false: everyday words or phrases ("take care", "jacket", "five or six seconds"), and words speech recognition mis-heard, which sound technical but are not real terms. Examples: "Patriarchs fibres" (really "Purkinje fibres"), "S-mode" (really "SA node"), "dechloridation" (really "depolarisation").'
const PROMPTS = {
  orig: (term, sentence, who) => `Answer with JSON only: {"technical": true} or {"technical": false}.

Sentence from a lecture (written by speech recognition): "${sentence}"
Candidate: "${term}"

Is the candidate a recognised technical or academic term ${who}?

${EX_YES}
${EX_NO}`,
  new: (term, sentence, who) => `Answer with JSON only: {"technical": true} or {"technical": false}.

You will be asked whether a candidate is a recognised technical or academic term ${who}.

${EX_YES}
${EX_NO}

Sentence from a lecture (written by speech recognition): "${sentence}"
Candidate: "${term}"

Is "${term}" a recognised technical or academic term ${who}?`,
}

async function runMode(name, wording, fresh) {
  let context = await model.createContext({ contextSize: 2048 })
  let session = new LlamaChatSession({ contextSequence: context.getSequence() })
  const t0 = Date.now()
  const lines = []
  for (const row of [...sets.TECHNICAL, ...sets.GARBLED]) {
    const who = `in ${row.subject}`
    const verdicts = []
    for (const c of row.candidates) {
      if (fresh) { await context.dispose(); context = await model.createContext({ contextSize: 2048 }); session = new LlamaChatSession({ contextSequence: context.getSequence() }) }
      session.resetChatHistory()
      const r = await session.prompt(PROMPTS[wording](c.term, c.sentence, who), { grammar })
      verdicts.push(`${grammar.parse(r).technical ? '+' : '-'}${c.term}`)
    }
    lines.push(`  ${row.label.padEnd(9)} ${verdicts.join('  ')}`)
  }
  await context.dispose()
  console.log(`== ${name} (${Math.round((Date.now() - t0) / 1000)}s)\n${lines.join('\n')}`)
}

await runMode('orig-fresh', 'orig', true)
await runMode('orig-reuse', 'orig', false)
await runMode('new-reuse', 'new', false)
process.exit(0)

// Prototype for live on-device terms on laptops with no graphics card
// (2026-10-20). Compares, on CPU only:
//
//   current  llm.detectTerms: the model reads the excerpt, writes up to two
//            TERM|DEFINITION|CONTEXT lines, then one verification generation
//            per term. Measured 20-56s per call on CPU.
//   define   candidates picked by the web's rule-based extractor (instant,
//            fixtures/candidate-excerpts.json), and the model only judges
//            and defines those, in ONE grammar-constrained call per window.
//            A window with no candidates never reaches the model.
//
//   DEMIST_LLM_GPU=off node test/define-candidates-bench.mjs tiny
import { getLlama, LlamaChatSession } from 'node-llama-cpp'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
const require = createRequire(import.meta.url)

const tier = process.argv[2] || 'tiny'
process.env.DEMIST_LLM_TIER = tier
const FILE = { tiny: 'hf_bartowski_Qwen2.5-1.5B-Instruct.Q4_K_M.gguf', small: 'hf_bartowski_Llama-3.2-3B-Instruct.Q4_K_M.gguf' }[tier]
const EXCERPTS = require('./fixtures/candidate-excerpts.json')

// ── define: one constrained call per window ──
const llama = await getLlama({ gpu: false })
const model = await llama.loadModel({ modelPath: path.join(os.homedir(), '.demist', 'llm-models', FILE) })
const context = await model.createContext({ contextSize: 2048 })
const session = new LlamaChatSession({ contextSequence: context.getSequence() })

function schemaFor(n) {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array', minItems: n, maxItems: n,
        items: { type: 'object', properties: { technical: { type: 'boolean' }, definition: { type: 'string' } } },
      },
    },
  }
}

async function defineWindow(subject, candidates) {
  if (!candidates.length) return []
  const grammar = await llama.createGrammarForJsonSchema(schemaFor(candidates.length))
  const prompt = `You help a Year 2 ${subject} student follow a lecture. For each numbered candidate, in order, say whether it is a recognised technical or academic term in ${subject} ("technical": true) or an everyday word, phrase or speech-recognition mistake ("technical": false). For technical ones, write a one-sentence plain-English "definition" of how it is used in its sentence; otherwise leave "definition" empty.

${candidates.map((c, i) => `${i + 1}. "${c.term}" in: ${c.sentence}`).join('\n')}`
  session.resetChatHistory()
  const response = await session.prompt(prompt, { grammar, maxTokens: 70 * candidates.length })
  const parsed = grammar.parse(response)
  return candidates.map((c, i) => ({ term: c.term, ...parsed.items[i] })).filter(x => x.technical && x.definition)
}

// warm
session.resetChatHistory(); await session.prompt('Say OK.', { maxTokens: 3 })
console.log(`== define (${tier}, CPU)`)
for (const ex of EXCERPTS) {
  const t = Date.now()
  const out = await defineWindow(ex.subject, ex.candidates)
  console.log(`${ex.subject.padEnd(10)} ${String(Date.now() - t).padStart(6)}ms  ${ex.candidates.length} cands -> ${JSON.stringify(out.map(x => x.term))}`)
}
for (const ex of EXCERPTS) {
  const out = await defineWindow(ex.subject, ex.candidates)
  for (const x of out.slice(0, 2)) console.log(`   ${x.term}: ${String(x.definition).slice(0, 100)}`)
}
await context.dispose(); await model.dispose()

// ── current pipeline, same process conditions ──
const llm = require('../native/llm')
await llm.preload(() => {})
console.log(`== current (${tier}, CPU)`)
for (const ex of EXCERPTS) {
  const t = Date.now()
  const terms = await llm.detectTerms(ex.text, '', ex.subject, 2, () => {}, [])
  console.log(`${ex.subject.padEnd(10)} ${String(Date.now() - t).padStart(6)}ms  -> ${JSON.stringify(terms.map(x => x.term))}`)
}
process.exit(0)

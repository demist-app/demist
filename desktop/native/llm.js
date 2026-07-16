// On-device term detection via a local LLM (node-llama-cpp / llama.cpp).
// Replaces the OpenAI detect-terms edge function for desktop app users.
//
// Two model tiers, matching the Profile setting the web app exposes:
//   small — bundled/auto-downloaded by default, runs on almost any laptop
//   large — meaningfully more accurate, needs ~8GB+ RAM, opt-in download
//
// Grammar-constrained decoding (createGrammarForJsonSchema) guarantees the
// output is always valid JSON matching the schema below — it does NOT
// guarantee the *content* is as accurate as GPT-4o-mini; the small model in
// particular will miss terms or flag common words more often. That's the
// real, known tradeoff of this tier, not a bug to fix here.

const path = require('path')
const os = require('os')
const fs = require('fs')

const MODEL_DIR = path.join(os.homedir(), '.demist', 'llm-models')
const MODEL_URI = {
  small: 'hf:bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M',
  large: 'hf:bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M',
}
const TIER_FILE = path.join(MODEL_DIR, 'tier.json')

const TERMS_SCHEMA = {
  type: 'object',
  properties: {
    terms: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          term: { type: 'string' },
          definition: { type: 'string' },
          context: { type: 'string' },
        },
      },
    },
  },
}

let llama, model, context, session, grammar, loadedTier

function getTier() {
  try {
    return JSON.parse(fs.readFileSync(TIER_FILE, 'utf8')).tier
  } catch {
    return 'small'
  }
}

function setTier(tier) {
  if (tier !== 'small' && tier !== 'large') throw new Error(`Unknown model tier "${tier}"`)
  fs.mkdirSync(MODEL_DIR, { recursive: true })
  fs.writeFileSync(TIER_FILE, JSON.stringify({ tier }))
  // Next detectTerms() call reloads with the new tier — don't reload eagerly
  // here, since "large" may not be downloaded yet and this call should
  // return immediately rather than block on a multi-GB download.
  session = null
  return tier
}

async function ensureLoaded() {
  const tier = getTier()
  if (session && loadedTier === tier) return

  const { getLlama, LlamaChatSession, resolveModelFile } = await import('node-llama-cpp')
  llama ??= await getLlama()

  const modelPath = await resolveModelFile(MODEL_URI[tier], MODEL_DIR)
  model = await llama.loadModel({ modelPath })
  context = await model.createContext()
  session = new LlamaChatSession({ contextSequence: context.getSequence() })
  grammar = await llama.createGrammarForJsonSchema(TERMS_SCHEMA)
  loadedTier = tier
}

async function detectTerms(transcript, recentContext) {
  if (!transcript?.trim()) return []
  await ensureLoaded()

  const prompt = `You are a study assistant. From the lecture excerpt below, identify at most 2 subject-specific technical terms a university student is unlikely to know and would need explained to follow the lecture. Ignore common English words and anything already understood from context.

${recentContext ? `Recent context: ${recentContext}\n\n` : ''}Lecture excerpt:
${transcript}

For each term, return a one-sentence plain-English definition specific to how it was used above, and the exact sentence it appeared in as "context", taken verbatim from the excerpt. Return zero terms if nothing qualifies.`

  const response = await session.prompt(prompt, { grammar })
  const parsed = grammar.parse(response)
  return parsed.terms ?? []
}

module.exports = { detectTerms, getTier, setTier }

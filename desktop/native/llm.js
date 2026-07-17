// On-device term detection via a local LLM (node-llama-cpp / llama.cpp).
// Replaces the OpenAI detect-terms edge function for desktop app users.
//
// Two model tiers, matching the Profile setting the web app exposes:
//   small: bundled/auto-downloaded by default, runs on almost any laptop
//   large: meaningfully more accurate, needs ~8GB+ RAM, opt-in download
//
// Grammar-constrained decoding (createGrammarForJsonSchema) guarantees the
// output is always valid JSON matching the schema below: it does NOT
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

let llama, model, context, session, grammar, loadedTier, loadingPromise

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
  // Next detectTerms() call reloads with the new tier: don't reload eagerly
  // here, since "large" may not be downloaded yet and this call should
  // return immediately rather than block on a multi-GB download.
  session = null
  return tier
}

async function ensureLoaded() {
  const tier = getTier()
  if (session && loadedTier === tier) return
  // Without this, overlapping detectTerms() calls (e.g. several buffered
  // audio chunks resolving in a burst right after startup, before the first
  // load finishes) each saw `session` still unset and started their own
  // full model load in parallel: confirmed by real testing, three
  // concurrent loads each trying to allocate their own multi-GB KV cache
  // buffer, exhausting RAM and forcing repeated shrink-and-retry. Callers
  // that arrive mid-load now just await the same in-flight load instead.
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    const { getLlama, LlamaChatSession, resolveModelFile } = await import('node-llama-cpp')
    // gpu: false forces CPU-only execution. Left on 'auto', node-llama-cpp
    // tries to offload layers to GPU VRAM and picks a configuration based on
    // what it detects: confirmed by real testing to fail outright on a
    // machine without much dedicated VRAM ("context size ... too large for
    // the available VRAM"). CPU is slower but universally reliable, which
    // matters more than speed given the small tier's whole point is running
    // on whatever laptop a student actually has.
    llama ??= await getLlama({ gpu: false })

    // This step was previously silent, so a multi-GB first-run download and
    // an actual stall looked identical from the outside: no console output
    // either way. Logging at 10% steps makes that distinction visible.
    console.log(`[demist] loading term-detection model (${tier} tier): ${MODEL_URI[tier]}`)
    let lastLoggedPct = -1
    const modelPath = await resolveModelFile(MODEL_URI[tier], {
      directory: MODEL_DIR,
      onProgress: ({ totalSize, downloadedSize }) => {
        const pct = totalSize ? Math.floor((downloadedSize / totalSize) * 100) : 0
        if (pct >= lastLoggedPct + 10) {
          lastLoggedPct = pct
          console.log(`[demist] term-detection model download: ${pct}%`)
        }
      },
    })
    console.log('[demist] term-detection model downloaded, loading into memory...')
    model = await llama.loadModel({ modelPath })
    context = await model.createContext()
    session = new LlamaChatSession({ contextSequence: context.getSequence() })
    grammar = await llama.createGrammarForJsonSchema(TERMS_SCHEMA)
    loadedTier = tier
    console.log('[demist] term-detection model ready')
  })()

  try {
    await loadingPromise
  } finally {
    loadingPromise = null
  }
}

// Serializes detectTerms calls: a single LlamaChatSession carries its
// conversation state in one context sequence, so two overlapping
// session.prompt() calls would interleave into the same sequence rather
// than running as independent requests (confirmed the overlap itself
// happens in practice, see ensureLoaded above). Chaining onto this promise
// queues each call behind whichever is already running instead of racing it.
let queue = Promise.resolve()

async function detectTerms(transcript, recentContext, subject, year) {
  if (!transcript?.trim()) return []
  await ensureLoaded()

  const who = subject ? `a ${year ? `Year ${year} ` : ''}${subject} student` : 'a university student'
  const prompt = `You are a study assistant. From the lecture excerpt below, identify at most 2 subject-specific technical terms ${who} is unlikely to know and would need explained to follow the lecture. Ignore common English words and anything already understood from context.

${recentContext ? `Recent context: ${recentContext}\n\n` : ''}Lecture excerpt:
${transcript}

For each term, return a one-sentence plain-English definition specific to how it was used above, and the exact sentence it appeared in as "context", taken verbatim from the excerpt. Return zero terms if nothing qualifies.`

  const run = queue.then(async () => {
    const response = await session.prompt(prompt, { grammar })
    const parsed = grammar.parse(response)
    return parsed.terms ?? []
  })
  // Swallow so one failed call doesn't poison the queue for calls behind it.
  queue = run.catch(() => {})
  return run
}

module.exports = { detectTerms, getTier, setTier }

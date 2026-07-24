// On-device term detection via a local LLM (node-llama-cpp / llama.cpp).
// Replaces the OpenAI detect-terms edge function for desktop app users.
//
// Two model tiers, matching the Profile setting the web app exposes:
//   small: bundled/auto-downloaded by default, runs on almost any laptop
//   large: meaningfully more accurate, needs ~8GB+ RAM, opt-in download
//
// Term detection deliberately does NOT use grammar-constrained JSON decoding
// (unlike summarize() below). Confirmed by direct testing: with a
// {"terms": [...]} schema, the small tier emitted an empty array for
// essentially every input, including excerpts stuffed with obvious jargon
// ("Bayesian ridge regularization", "chemiosmosis", etc). Forcing
// minItems:1 on that same schema made it produce good terms every time,
// proving the model itself is capable; the grammar's empty array is simply
// the shortest, always-legal completion, and small quantized models under
// constrained decoding gravitate hard toward whatever's shortest, regardless
// of content. minItems:1 isn't a fix either: it would force a hallucinated
// term on genuinely mundane excerpts. The free-form "TERM: x | DEFINITION: y
// | CONTEXT: z" / "NONE" format below has no such trivial escape hatch (NONE
// is just as short as a real answer), and direct testing confirmed it
// correctly returns real terms for termful excerpts and NONE for mundane
// ones. This is a real fix for a real bug: it doesn't remove the small
// tier's separate, genuine accuracy tradeoff against GPT-4o-mini (missing
// or misjudging some terms), it removes a failure mode that was producing
// close to zero terms ever, on any input.

const path = require('path')
const os = require('os')
const fs = require('fs')
const { makeProgressLogger } = require('./progressLog')

const MODEL_DIR = path.join(os.homedir(), '.demist', 'llm-models')
const MODEL_URI = {
  small: 'hf:bartowski/Llama-3.2-3B-Instruct-GGUF:Q4_K_M',
  large: 'hf:bartowski/Meta-Llama-3.1-8B-Instruct-GGUF:Q4_K_M',
}
const TIER_FILE = path.join(MODEL_DIR, 'tier.json')

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    synopsis: { type: 'string' },
  },
  required: ['synopsis'],
}

let llama, model, context, session, summaryGrammar, loadedTier, loadingPromise

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

async function ensureLoaded(emitProgress) {
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
    // either way. Logging at 10% steps makes that distinction visible; the
    // shared logger also pushes to the renderer when a preload caller wants
    // visible progress (see preload() below).
    const label = `term-detection model (${tier})`
    const logger = makeProgressLogger(label, emitProgress)
    logger({ status: 'initiate', file: MODEL_URI[tier] })
    const modelPath = await resolveModelFile(MODEL_URI[tier], {
      directory: MODEL_DIR,
      onProgress: ({ totalSize, downloadedSize }) => {
        const progress = totalSize ? (downloadedSize / totalSize) * 100 : 0
        logger({ status: 'progress', file: MODEL_URI[tier], progress })
      },
    })
    console.log('[demist] term-detection model downloaded, loading into memory...')
    model = await llama.loadModel({ modelPath })
    context = await model.createContext()
    session = new LlamaChatSession({ contextSequence: context.getSequence() })
    summaryGrammar = await llama.createGrammarForJsonSchema(SUMMARY_SCHEMA)
    loadedTier = tier
    logger({ status: 'ready' })
  })()

  try {
    await loadingPromise
  } finally {
    loadingPromise = null
  }
}

// Loads the model outside of (ahead of) an actual detectTerms() call, used
// to warm this up as soon as the app opens rather than mid-lecture, the same
// role native/whisper.js's preload() plays for transcription.
async function preload(emitProgress) {
  await ensureLoaded(emitProgress)
  return getTier()
}

// Serializes detectTerms calls: a single LlamaChatSession carries its
// conversation state in one context sequence, so two overlapping
// session.prompt() calls would interleave into the same sequence rather
// than running as independent requests (confirmed the overlap itself
// happens in practice, see ensureLoaded above). Chaining onto this promise
// queues each call behind whichever is already running instead of racing it.
let queue = Promise.resolve()

// Matches "TERM: x | DEFINITION: y | CONTEXT: z" lines from detectTerms'
// free-form prompt below. Anything that doesn't match (stray commentary,
// blank lines, "NONE") is silently skipped rather than treated as an error:
// the model occasionally adds a line of preamble even when told not to, and
// that's fine as long as the real lines still match.
const TERM_LINE_RE = /^\s*TERM:\s*(.+?)\s*\|\s*DEFINITION:\s*(.+?)\s*\|\s*CONTEXT:\s*(.+?)\s*$/i

function parseTermLines(response) {
  const out = []
  for (const line of response.split('\n')) {
    const m = line.match(TERM_LINE_RE)
    if (m) out.push({ term: m[1], definition: m[2], context: m[3] })
    if (out.length >= 2) break
  }
  return out
}

async function detectTerms(transcript, recentContext, subject, year, emitProgress) {
  if (!transcript?.trim()) return []
  await ensureLoaded(emitProgress)

  const who = subject ? `a ${year ? `Year ${year} ` : ''}${subject} student` : 'a university student'
  const prompt = `You are a study assistant. From the lecture excerpt below, identify at most 2 subject-specific technical terms ${who} is unlikely to know and would need explained to follow the lecture. Ignore common English words and anything already understood from context.

${recentContext ? `Recent context: ${recentContext}\n\n` : ''}Lecture excerpt:
${transcript}

Respond with each term on its own line in exactly this format:
TERM: <term> | DEFINITION: <one-sentence plain-English definition, specific to how it was used above> | CONTEXT: <the exact sentence it appeared in, verbatim>

If nothing in the excerpt qualifies, respond with exactly: NONE`

  const run = queue.then(async () => {
    // Each call is independent: recentContext/transcript above already
    // carry everything the prompt needs. LlamaChatSession accumulates
    // conversation history by design (it's built for multi-turn chat), so
    // without this reset every call over a session left the previous
    // exchange in context: the window grew every single call, made each
    // one slower than the last, and eventually overflowed the context
    // entirely, which is consistent with "gets slow over time" and "term
    // detection stops working" both being the same underlying bug.
    session.resetChatHistory()
    const response = await session.prompt(prompt)
    return parseTermLines(response)
  })
  // Swallow so one failed call doesn't poison the queue for calls behind it.
  queue = run.catch(() => {})
  return run
}

// On-device replacement for the summarize-session edge function's OpenAI
// call, so the "nothing leaves the device" guarantee (see file header)
// extends to end-of-lecture summaries too, not just live term detection.
// Shares the same LlamaChatSession/queue as detectTerms above, for the same
// reason: one context sequence, one call at a time.
async function summarize(termRows, subject) {
  if (!termRows?.length) return null
  await ensureLoaded()

  const context = subject ? `for a lecture on "${subject}"` : 'from a lecture'
  const termList = termRows.map((t) => `- ${t.term}: ${t.definition}`).join('\n')
  const prompt = `These terms were extracted ${context}:

${termList}

Write a 1-2 sentence summary of what this lecture covered, based only on the terms above. Be specific. Return JSON with a single field "synopsis".`

  const run = queue.then(async () => {
    session.resetChatHistory()
    const response = await session.prompt(prompt, { grammar: summaryGrammar })
    const parsed = summaryGrammar.parse(response)
    return parsed.synopsis?.trim() || null
  })
  queue = run.catch(() => {})
  return run
}

module.exports = { detectTerms, summarize, preload, getTier, setTier }

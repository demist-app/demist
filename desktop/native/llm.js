// On-device term detection via a local LLM (node-llama-cpp / llama.cpp).
// Replaces the OpenAI detect-terms edge function for desktop app users.
//
// Three model tiers, matching the Profile setting the web app exposes:
//   tiny:  Qwen2.5-1.5B, the default under 10GB of RAM. Matches the small
//          tier's term recall in testing at ~1.1GB less memory.
//   small: Llama-3.2-3B, the default on larger machines
//   large: meaningfully more accurate, needs ~8GB+ free RAM, opt-in download
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
const { isEverydayWord } = require('./common-words')

const MODEL_DIR = path.join(os.homedir(), '.demist', 'llm-models')
const MODEL_URI = {
  tiny: 'hf:bartowski/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M',
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

// "What does this mean?" for a phrase the user has SELECTED, rather than a
// term the model went looking for. Deliberately a separate schema and a
// separate prompt from detectTerms: that path exists to decide whether
// something is worth flagging at all, and every filter on it (everyday words,
// course-admin words, the not-in-the-transcript check) is there to keep
// unasked-for cards out. Applied to a phrase someone has highlighted and
// tapped, those same filters produce "no explanation available" for perfectly
// reasonable requests - the user has already made the judgement the filters
// exist to make.
//
// A grammar is safe here in a way it was not for term extraction: the failure
// mode there was that an empty array is the shortest always-legal completion
// under a list schema, so the model took it every time. A single required
// string has no such shortcut, and summarize() below has run on the same
// schema shape and the same models without it.
const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    definition: { type: 'string' },
  },
  required: ['definition'],
}

// A second, deliberately trivial question asked about each candidate term
// before it becomes a card. See verifyTerm below for why this exists and what
// it measured.
const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    technical: { type: 'boolean' },
  },
  required: ['technical'],
}

// Cap the LLM context window, sized against the machine. Left unset,
// node-llama-cpp allocates the model's FULL trained context - Llama 3.2 is
// trained at 131072 tokens - and that KV cache measured at +4222MB on top of
// the model weights, i.e. ~7GB resident for term detection alone. On a 16GB
// machine with Whisper and the translation model also loaded, that pushed
// the Electron process to 16.6GB committed against only 4.4GB resident: the
// models were largely paged out, so merely touching the transcribe worker to
// start a session faulted ~1GB of Whisper weights back in from disk. That is
// what made startSession take 50-70s in real sessions while the worker itself
// reported doing its work in 1ms.
//
// Measured cost of the KV cache alone: 2048 -> +212MB, 4096 -> +436MB,
// 8192 -> +885MB, default (131072) -> +4222MB. Even 2048 is several times
// more than anything this app sends: detectTerms gets one transcript chunk
// plus ~300 chars of context, summarize gets at most SUMMARY_MAX_TERMS
// entries, and resetChatHistory() runs before every prompt so nothing
// accumulates across calls.
const CONTEXT_SIZE = os.totalmem() / (1024 ** 3) < 10 ? 2048 : 4096
// Bounds the largest prompt so it cannot outgrow CONTEXT_SIZE on a long
// lecture; termRows was previously passed through unbounded.
const SUMMARY_MAX_TERMS = 60

let llama, model, context, session, summaryGrammar, verdictGrammar, explainGrammar, loadedTier, loadingPromise

// Which term-detection model a machine gets by default, decided by its RAM.
// Measured through the real detectTerms path on the same five excerpts
// (four jargon-heavy, one deliberately mundane):
//
//   tiny  Qwen2.5-1.5B   1413MB   710ms/call   relevant terms on 4/4
//   small Llama-3.2-3B   2502MB   867ms/call   relevant terms on 4/4
//
// Qwen2.5-1.5B matches the 3B's recall for ~1.1GB less, which is what makes
// term detection viable at all on an 8GB laptop: with the 3B, Whisper plus
// the LLM plus translation come to ~4.5GB and the machine pages. It is
// slightly looser about mundane text (it flagged "chapter" and "tutorial"
// where the 3B returned nothing), which ADMIN_WORDS above exists to catch.
//
// Llama-3.2-1B was tested first and rejected on measurement, not instinct:
// same harness, it found relevant terms on only 1/4 excerpts, returning
// nothing at all for the clearest biology, ML and economics jargon. Model
// size matters enormously for this task, so do not swap this for something
// smaller without re-running that comparison.
// Decided on what the machine can actually SPARE, not just what it has. A
// 16GB machine with a browser and an editor open has repeatedly been measured
// with under 3GB free, and total RAM cannot see that: this app was observed at
// 7458MB committed against 4471MB resident, i.e. Windows had paged ~3GB of it
// out, which is what turns a 1ms startSession into a 60s one and a 2s
// inference into a 23s one.
//
// The 3B is only worth its extra 1.1GB when that 1.1GB is genuinely spare.
// Per the measurements above it matches the 1.5B on recall and is merely
// tighter about mundane text, so trading it away under memory pressure costs
// very little and buys back the headroom that keeps transcription - the thing
// a lecture actually depends on - running at real time.
//
// freemem() is a snapshot and will fluctuate; that is fine, because this only
// picks a DEFAULT at load time and an explicit choice in Settings still wins.
// The threshold is deliberately generous: 'small' needs ~2.5GB resident for
// itself, on top of Whisper's ~2.3GB and translation's ~0.4GB.
// Which tiers are already on disk. node-llama-cpp names its downloads after
// the model URI, so an existing file means that tier costs nothing to select.
function downloadedTiers() {
  let files
  try { files = fs.readdirSync(MODEL_DIR) } catch { return new Set() }
  const found = new Set()
  for (const [tier, uri] of Object.entries(MODEL_URI)) {
    const stem = uri.split(':')[1]?.split('/').pop()?.replace(/-GGUF$/, '')
    if (stem && files.some(f => f.includes(stem) && f.endsWith('.gguf'))) found.add(tier)
  }
  return found
}

// Resolved ONCE per process. freemem() moves constantly, so re-deriving the
// default on every getTier() call let a single run answer 'small' at preload
// and 'tiny' minutes later - and each answer loads its own multi-GB model, so
// the process ended up holding BOTH (3.0GB of models where one was wanted).
// Observed directly in a test run: "term-detection model (small): model ready"
// followed moments later by "term-detection model (tiny): downloading".
let resolvedDefaultTier = null

function defaultTier() {
  if (resolvedDefaultTier) return resolvedDefaultTier
  resolvedDefaultTier = pickDefaultTier()
  return resolvedDefaultTier
}

// The 'tiny' tier is no longer a default for anyone with a usable amount of
// RAM, and this is the floor below which it is still the only option.
//
// It used to be the default for every machine under 10GB, and separately for
// any machine whose freemem() dipped at the wrong moment. Measured with the
// current filters on the suite in test/term-precision.js:
//
//   tiny  (Qwen2.5-1.5B)  2 of 7 mundane excerpts produced cards, 0 missed
//   small (Llama-3.2-3B)  0 of 7 mundane excerpts produced cards, 0 missed
//
// The tiny tier's failures were "Take care" from a goodbye and "settle" from
// "give it five or six seconds and it should settle down" - i.e. it puts
// ordinary conversation into the user's flashcard deck, which is worse than
// having no term detection at all. No word list fixes that in general; the
// two above are simply the ones this suite happens to catch.
//
// And it was not even buying what it claimed. Whisper ALREADY drops from its
// 2332MB tier to its 1027MB one below 10GB of RAM (see whisper.js), so a
// small machine has 1.3GB more headroom than a large one right where it
// matters - more than the 1.1GB the bigger LLM costs. Totals with the 3B:
// 3.9GB of models on an 8GB machine against 5.2GB on a 16GB one. The small
// machine was being given the worse model to save memory it had already saved
// somewhere else.
//
// Below 8GB the sum genuinely does not fit, so 'tiny' remains the default
// there, and it remains selectable in Settings on any machine.
const SMALL_TIER_MIN_TOTAL_GB = 8

function pickDefaultTier() {
  const totalGB = os.totalmem() / (1024 ** 3)
  // Deliberately NOT freemem(). This runs during startup, while the app itself
  // is loading Whisper and translation and Chromium is spinning up, so the
  // app's own consumption is what pushed free memory under the old bar - a
  // 15.9GB machine defaulted to 'tiny' with ample room for the 3B the whole
  // time, which is the reported "term cards for plain English words". Total
  // RAM is a fixed property of the machine and cannot flap.
  const wanted = totalGB >= SMALL_TIER_MIN_TOTAL_GB ? 'small' : 'tiny'
  const have = downloadedTiers()
  if (have.has(wanted)) return wanted
  // An already-downloaded BETTER tier beats downloading anything.
  if (have.has('large')) return 'large'
  // Otherwise download what this machine should have.
  //
  // This deliberately no longer falls back to "whatever is already on disk".
  // That rule existed to stop the tier FLAPPING, back when the choice came
  // from freemem() and could give a different answer minute to minute. The
  // choice is now derived from total RAM alone, so it is fixed for a given
  // machine and there is nothing left to flap - while the old rule, kept as
  // is, would have permanently pinned every existing user to the 'tiny' model
  // already sitting in their cache, which is the precise outcome this whole
  // change exists to end. The download runs at app start behind the visible
  // progress bar that already gates the record button, not mid-lecture.
  return wanted
}

// Says WHERE the answer came from, once per distinct answer. A real run
// loaded 'small' and then loaded 'tiny' as well, and nothing anywhere
// recorded which of the two possible sources - an explicit choice saved in
// tier.json, or the memory-derived default - had produced either one, so the
// flip could not be explained from the log at all.
let lastReportedTier = null
function reportTier(tier, why) {
  if (tier !== lastReportedTier) {
    lastReportedTier = tier
    console.log(`[demist] term-detection tier resolved to '${tier}' (${why})`)
  }
  return tier
}

function getTier() {
  // Test-only override, so a harness can pin a tier WITHOUT writing the shared
  // tier.json. It used to call setTier() for this, and that file is read live
  // by whatever app happens to be running: a background precision run flipped
  // a real session from 'small' to 'tiny' mid-lecture, which is what produced
  // the "why did this use both?" log. A test must never mutate user state.
  const override = process.env.DEMIST_LLM_TIER
  if (override && MODEL_URI[override]) return reportTier(override, 'DEMIST_LLM_TIER override (testing)')
  try {
    const tier = JSON.parse(fs.readFileSync(TIER_FILE, 'utf8')).tier
    if (MODEL_URI[tier]) return reportTier(tier, `explicitly chosen in Settings, saved in ${TIER_FILE}`)
    return reportTier(defaultTier(), `${TIER_FILE} held an unknown tier ${JSON.stringify(tier)}`)
  } catch {
    return reportTier(defaultTier(), `no saved choice; ${(os.totalmem() / 1024 ** 3).toFixed(1)}GB total RAM`)
  }
}

function setTier(tier) {
  if (!MODEL_URI[tier]) throw new Error(`Unknown model tier "${tier}"`)
  fs.mkdirSync(MODEL_DIR, { recursive: true })
  fs.writeFileSync(TIER_FILE, JSON.stringify({ tier }))
  // Next detectTerms() call reloads with the new tier: don't reload eagerly
  // here, since "large" may not be downloaded yet and this call should
  // return immediately rather than block on a multi-GB download.
  session = null
  return tier
}

async function ensureLoaded(emitProgress, calledBy = 'unknown') {
  const tier = getTier()
  if (session && loadedTier === tier) return
  // Names the operation that triggered a load. A real run loaded 'small' and
  // then loaded 'tiny' as well with nothing in the log to say what asked for
  // the second one, which left the cause unidentifiable after the fact.
  console.log(`[demist] term-detection: loading tier '${tier}' because ${calledBy} asked for it`
    + `${loadedTier ? ` (previously loaded: '${loadedTier}')` : ''}`)
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

    // Try GPU first: direct testing measured ~4x faster inference on a
    // dedicated GPU (12s vs 40-60s per detectTerms call on the same
    // prompt), which matters a lot given detectTerms is the slow step users
    // actually notice as "term detection is delayed". This used to be
    // hard-disabled (gpu: false) for everyone, because GPU offload had
    // previously failed outright on a machine without much dedicated VRAM
    // ("context size ... too large for the available VRAM") - but that
    // traded away a large speed win for every user with a real GPU, just to
    // protect users without one. Falling back to CPU on any failure here
    // covers both instead of picking one at the cost of the other.
    if (!llama) {
      try {
        llama = await getLlama({ gpu: 'auto' })
        model = await llama.loadModel({ modelPath })
        context = await model.createContext({ contextSize: CONTEXT_SIZE })
      } catch (e) {
        console.warn('[demist] GPU load for term-detection model failed, falling back to CPU:', e?.message ?? e)
        try { await context?.dispose() } catch { /* best-effort cleanup */ }
        try { await model?.dispose() } catch { /* best-effort cleanup */ }
        llama = await getLlama({ gpu: false })
        model = await llama.loadModel({ modelPath })
        context = await model.createContext({ contextSize: CONTEXT_SIZE })
      }
    } else {
      // Reused across tier switches: whichever GPU/CPU mode succeeded the
      // first time is kept, rather than re-attempting GPU (and possibly
      // re-failing) on every switch between "small" and "large".
      //
      // The OLD model has to go first. Reassigning `model` and `context` only
      // drops this file's JS references - llama.cpp is holding the weights
      // natively and frees them when the handle is disposed, not when a
      // variable stops pointing at it. So every tier switch left the previous
      // model fully resident and loaded the next one alongside it: a switch
      // from 'small' to 'tiny' meant 2502MB + 1413MB of term-detection models
      // in a process that was switching precisely because memory was tight.
      // Reported from a real run - both "(small): model ready" and "(tiny):
      // model ready" in one session, hence "why did this use both?".
      try { await context?.dispose() } catch { /* best-effort */ }
      try { await model?.dispose() } catch { /* best-effort */ }
      session = null
      context = null
      model = null
      model = await llama.loadModel({ modelPath })
      context = await model.createContext({ contextSize: CONTEXT_SIZE })
    }
    session = new LlamaChatSession({ contextSequence: context.getSequence() })
    summaryGrammar = await llama.createGrammarForJsonSchema(SUMMARY_SCHEMA)
    verdictGrammar = await llama.createGrammarForJsonSchema(VERDICT_SCHEMA)
    explainGrammar = await llama.createGrammarForJsonSchema(EXPLAIN_SCHEMA)

    // Pays a large one-time cost here, during preload (while the app shows
    // "loading models..." before the user ever starts recording), instead
    // of during the first real detectTerms()/summarize() call mid-lecture.
    // Confirmed by direct, repeated testing: on CPU, the first real
    // generation call in a session consistently took 30-40s longer than
    // every subsequent call in that same session (which settled to ~4-5s).
    // Same class of cost already fixed for native/whisper.js's ONNX
    // pipeline; this was the missing equivalent for the LLM. Also confirmed
    // by testing: a short generic warm-up prompt only partly pays this down
    // (the first *real* call afterwards was still ~15-17s); using the same
    // template detectTerms actually sends, just with placeholder content,
    // brought the first real call down to the normal ~4-10s range instead.
    try {
      await session.prompt(
        buildDetectPrompt('This is placeholder text used only to warm up the model.', '', null, null),
        { maxTokens: 20 },
      )
    } catch (e) {
      console.warn('[demist] term-detection model warm-up call failed (non-fatal):', e?.message ?? e)
    }
    session.resetChatHistory()

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
  await ensureLoaded(emitProgress, 'preload')
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
// Two accepted shapes, because the model reliably produces both and only one
// of them was ever parsed. Observed verbatim from Llama-3.2-3B on a real
// lecture, with DEMIST_LLM_DEBUG=1:
//
//   arithmetic logic unit: A hardware component within a CPU that performs
//   mathematical and logical operations. | CONTEXT: different CPU registers...
//
// The term and the definition are both correct and useful. It simply dropped
// the "TERM:" label and used a colon where the template said "| DEFINITION:".
// The strict regex threw that away, so a lecture full of obvious jargon
// produced no cards at all and looked like the model had found nothing.
//
// CANONICAL is the format the prompt asks for. LABELLESS accepts the drift,
// still anchored on "| CONTEXT:" so it cannot match ordinary prose - a line
// only qualifies if it carries the context marker the template demands.
const TERM_LINE_CANONICAL = /^\s*(?:[-*]\s*)?TERM:\s*(.+?)\s*\|\s*DEFINITION:\s*(.+?)\s*\|\s*CONTEXT:\s*(.+?)\s*$/i
const TERM_LINE_LABELLESS = /^\s*(?:[-*]\s*)?(?:TERM:\s*)?([^|:]{2,60}?)\s*[:|]\s*(.+?)\s*\|\s*CONTEXT:\s*(.+?)\s*$/i

function matchTermLine(line) {
  return line.match(TERM_LINE_CANONICAL) || line.match(TERM_LINE_LABELLESS)
}

function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Edit distance, abandoned as soon as it provably exceeds `max`. Bounded
// because it runs per candidate term against every same-length window of the
// transcript, and an unbounded O(nm) there would be doing real work to answer a
// question that is almost always "no, not remotely close".
function editDistanceWithin(a, b, max) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = new Array(b.length + 1)
  let cur = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let best = cur[0]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    const t = prev; prev = cur; cur = t
  }
  return prev[b.length]
}

// How far off a transcript's spelling of a term is allowed to be. Whisper
// mis-hears technical vocabulary constantly - measured on this app's own test
// fixture, "chemiosmosis" came back as "chemisimosis" and "chemisomosis" in the
// same recording - and roughly a fifth of the characters is the scale of that
// error, while being far too tight to let one real term match a different one.
const spellingSlack = (term) => Math.min(3, Math.max(1, Math.round(term.length * 0.2)))

// Below this length, only an EXACT match counts.
//
// Edit distance is meaningless on short strings: at three characters a slack of
// one lets "Rit" match "Ritz", "writ", "rich" or "it", so a fragment the model
// invented finds a partner in almost any transcript. That is not hypothetical -
// a real session produced a card reading "Rit — Not a recognized term in the
// context of the provided excerpt", i.e. the model said outright that it had
// nothing, and the fuzzy check waved it through anyway.
//
// Six characters is where a one-or-two character difference stops being most of
// the word. Everything the fuzzy path exists for - chemiosmosis, regularisation,
// mitochondrial - is far longer than this, so nothing it was built for is lost.
const MIN_FUZZY_LENGTH = 6

// Did the lecturer actually say this, allowing for the transcriber getting the
// spelling wrong?
//
// The exact-substring version of this check was a real anti-hallucination win
// and a real bug at the same time. The model, which knows the subject, spells
// the term CORRECTLY; the transcript, which only heard it, often does not. So
// the check dropped precisely the terms most worth having - the unfamiliar,
// hard-to-spell ones the whole feature exists for - and was measured doing it
// four times in a single 11-second test recording, while the mis-spelled
// version of the same word sailed through on a later call and became the
// flashcard. Exact match is still tried first and is still what passes almost
// always; this only decides what happens when it fails.
function saidInTranscript(haystack, term) {
  const needle = normalize(term)
  if (!needle) return false
  if (haystack.includes(needle)) return true
  // Short terms get no slack at all - see MIN_FUZZY_LENGTH.
  if (needle.replace(/\s/g, '').length < MIN_FUZZY_LENGTH) return false
  const words = haystack.split(' ').filter(Boolean)
  const span = needle.split(' ').length
  const max = spellingSlack(needle)
  for (let i = 0; i + span <= words.length; i++) {
    if (editDistanceWithin(words.slice(i, i + span).join(' '), needle, max) <= max) return true
  }
  return false
}

// Course-admin vocabulary is not lecture jargon. Smaller models are much
// looser about this: measured on a deliberately mundane excerpt ("the reading
// is chapter four and the tutorial is on Thursday"), Llama 3.2 3B correctly
// returned nothing while Qwen2.5 1.5B flagged "chapter" and "tutorial". Since
// the tiny tier exists precisely so low-memory machines still get term
// detection, filter the handful of words that show up in every lecture's
// housekeeping rather than accept a stream of useless cards.
const ADMIN_WORDS = new Set([
  'chapter', 'tutorial', 'lecture', 'seminar', 'lab', 'workshop', 'module',
  'homework', 'assignment', 'coursework', 'essay', 'exam', 'quiz', 'test',
  'reading', 'textbook', 'handout', 'slides', 'notes', 'syllabus',
  'semester', 'term', 'deadline', 'submission', 'revision', 'office hours',
  'question', 'answer', 'example', 'problem', 'exercise', 'chapter four',
])

// A definition that says, in words, that there is nothing to define.
//
// Asked for terms when an excerpt has none, the model sometimes complies with
// the FORMAT while refusing the substance: a real session produced
// "Rit — Not a recognized term in the context of the provided excerpt", which
// parsed perfectly and became a flashcard. The model is answering "no" and the
// parser was reading it as "yes". Cheaper and far more reliable than trying to
// stop it happening through prompt wording.
const NON_DEFINITION = /^\s*(not (a|an)\b|no\b|n\/a\b|unknown\b|unclear\b|cannot\b|can't\b|this (is not|isn't)\b|there is no\b|does not (appear|refer)\b|undefined\b)/i

function parseTermLines(response, transcript, recentContext) {
  // Checked against transcript AND recentContext together, not just
  // transcript: the prompt itself explicitly hands the model both (see
  // buildDetectPrompt below) and allows it to draw on recent context, so a
  // term said right at the boundary of the previous detection window (now
  // sitting in recentContext, not this call's transcript) is legitimate, not
  // hallucinated. Confirmed by real usage: "packet switching" and "network
  // adapter" were both genuinely said but dropped here before this fix,
  // because they'd landed in recentContext rather than the current chunk.
  const normalizedHaystack = normalize(`${recentContext ?? ''} ${transcript}`)
  // Course-admin housekeeping, phrase-aware for the same reason
  // isEverydayWord is (see common-words.js): an exact-match set could only
  // ever catch a bare "reading", never "the reading" or "this week's reading",
  // which is the form the model actually emits most of the time.
  const isAdmin = (t) => {
    const term = t.trim().toLowerCase()
    if (ADMIN_WORDS.has(term)) return true
    const words = term.split(/[\s-]+/).filter(Boolean)
    // Every word ordinary or administrative, and at least one of them
    // administrative - otherwise this would just duplicate isEverydayWord.
    return words.length > 1
      && words.some(w => ADMIN_WORDS.has(w))
      && words.every(w => ADMIN_WORDS.has(w) || isEverydayWord(w))
  }
  const out = []
  for (const line of response.split('\n')) {
    const m = matchTermLine(line)
    if (!m) continue
    // The model is asked to only extract terms actually said, verbatim, but
    // isn't grammar-constrained to guarantee that (see file header): direct
    // testing surfaced it inventing a plausible-sounding but never-actually-
    // said term ("Algorithm") once nearby context was full of related
    // jargon, and separately producing a real term with "context": "None",
    // i.e. admitting it had no real anchor for it. Requiring the term
    // itself to actually appear in what was said (this chunk or recent
    // context) is a cheap, direct check against both.
    if (NON_DEFINITION.test(m[2])) {
      console.warn(`[demist] dropped "${m[1]}": the model's own definition says it is not a term (${JSON.stringify(m[2].slice(0, 60))})`)
      continue
    }
    if (!saidInTranscript(normalizedHaystack, m[1])) {
      console.warn('[demist] dropped likely-hallucinated term (not found in transcript or recent context, even allowing for misspelling):', m[1])
      continue
    }
    if (isAdmin(m[1])) {
      console.warn('[demist] dropped course-admin word, not lecture jargon:', m[1])
      continue
    }
    // The small models find jargon reliably but are poor at DECLINING
    // ordinary speech: measured 5/5 mundane excerpts producing cards,
    // including "raspberry" from "did you put the raspberry ones in the bag"
    // and "bye" from a goodbye. Prompt wording alone did not fix it. Applies
    // to single everyday words only, so multi-word jargon and genuine
    // one-word jargon (chemiosmosis, datagram, enthalpy) are untouched - see
    // common-words.js for why frequency-ranked lists are the wrong tool here.
    if (isEverydayWord(m[1])) {
      console.warn('[demist] dropped everyday word, not lecture jargon:', m[1])
      continue
    }
    // The same term twice in one response is not two cards. Measured on the
    // tiny tier: a single mundane excerpt returned ["settle", "settle"], which
    // would have produced two identical flashcards from one sentence.
    if (out.some(o => normalize(o.term) === normalize(m[1]))) continue
    out.push({ term: m[1], definition: m[2], context: m[3] })
    if (out.length >= 2) break
  }
  return out
}

function buildDetectPrompt(transcript, recentContext, subject, year, knownTerms) {
  const who = subject ? `a ${year ? `Year ${year} ` : ''}${subject} student` : 'a university student'
  // What has already been carded this session. Detection windows overlap by
  // design (recentContext is deliberately fed back in), so without this the
  // model re-finds the same concept and phrases it slightly differently each
  // time - measured on one 11-second recording producing BOTH "proton motive"
  // and "proton motive force" as separate cards with near-identical
  // definitions. The cloud detect-terms function has always taken a
  // known_terms list for exactly this reason; the on-device path simply never
  // had one, and the renderer's exact-string dedupe cannot catch a rephrasing.
  const already = (knownTerms ?? []).slice(-40).filter(Boolean)
  const exclusions = already.length
    ? `\nThese have already been explained to this student. Do not return them again, and do not return a longer or shorter wording of the same thing:\n${already.map(t => `- ${t}`).join('\n')}\n`
    : ''
  return `You are a study assistant. From the lecture excerpt below, identify at most 2 subject-specific technical terms ${who} is unlikely to know and would need explained to follow the lecture. Ignore common English words and anything already understood from context.
${exclusions}
${recentContext ? `Recent context: ${recentContext}\n\n` : ''}Lecture excerpt:
${transcript}

Respond with each term on its own line in exactly this format, keeping every label:
TERM: <term> | DEFINITION: <one-sentence plain-English definition, specific to how it was used above> | CONTEXT: <the exact sentence it appeared in, verbatim>

Example of a correctly formatted line:
TERM: mitochondrial matrix | DEFINITION: The fluid-filled space inside the inner membrane of a mitochondrion, where the Krebs cycle takes place. | CONTEXT: the reactions occur in the mitochondrial matrix.

If nothing in the excerpt qualifies, respond with exactly: NONE`
}

// Which tiers have to double-check themselves. Measured on
// test/term-precision.js, false positives on 7 mundane excerpts:
//
//   tiny  without verification  2/7      with verification  0/7
//   small without verification  0/7
//
// So this runs only where it is needed. It is not free - it costs one extra
// (very short) generation per candidate, and on the chemistry excerpt it
// talked itself out of "catalyst", a real term, though that excerpt still
// produced "enthalpy change" so nothing was missed outright. Paying a little
// recall to stop ordinary conversation reaching a flashcard deck is the right
// trade on the weak model and the wrong one on a model that does not need it.
const NEEDS_VERIFICATION = new Set(['tiny'])

// Ask the model whether a candidate is really jargon, one term at a time,
// with the answer constrained to a single boolean.
//
// This exists so that how good a machine is stops deciding how good the term
// cards are. Extraction is an open-ended generative task and small models
// over-produce at it - asked to find terms, they find something, which is why
// the 1.5B put "Take care" and "settle" into a flashcard deck. Judging one
// candidate is a closed binary question, which is a far easier task for the
// same weights, and the grammar removes the model's ability to waffle instead
// of answering.
//
// Deliberately NOT given the definition the model just wrote: that definition
// is the model's own justification for the term, and including it just invites
// it to agree with itself. It gets the term and the sentence it was said in,
// and nothing else.
async function verifyTerm(term, sentence, subject) {
  const who = subject ? `the subject ${subject}` : 'an academic subject'
  const prompt = `Answer with JSON only.

Sentence from a lecture: "${sentence}"

Is "${term}" a specialist technical term from ${who} that a student would need defined to follow the lecture?

Ordinary English words and everyday phrases are NOT technical terms, even when a lecturer says them. Answer {"technical": false} for those.`
  try {
    session.resetChatHistory()
    const response = await session.prompt(prompt, { grammar: verdictGrammar })
    return verdictGrammar.parse(response)?.technical === true
  } catch (e) {
    // A failed verification must not silently delete a real term: fall back to
    // keeping the candidate, which is exactly the behaviour before this pass
    // existed.
    console.error('[demist] term verification failed, keeping the candidate:', e?.message ?? e)
    return true
  }
}

async function runDetectOnce(transcript, recentContext, subject, year, knownTerms) {
  const prompt = buildDetectPrompt(transcript, recentContext, subject, year, knownTerms)
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
    // The raw model output, before any parsing or filtering. Without this,
    // "no term cards appeared" is unattributable: the model returning NONE,
    // the model returning something matchTermLine cannot parse, and every
    // candidate being filtered out all look identical from outside.
    if (process.env.DEMIST_LLM_DEBUG === '1') {
      console.log(`[demist] --- raw model output (${loadedTier}) ---
${response}
--- end ---`)
    }
    const candidates = parseTermLines(response, transcript, recentContext)
    if (!candidates.length || !NEEDS_VERIFICATION.has(loadedTier)) return candidates
    // Inside the queue on purpose: verifyTerm drives the same
    // LlamaChatSession, so it cannot run concurrently with anything else.
    const kept = []
    for (const c of candidates) {
      if (await verifyTerm(c.term, c.context || transcript, subject)) kept.push(c)
      else console.warn(`[demist] dropped "${c.term}": the model itself judged it not a technical term`)
    }
    return kept
  })
  // Swallow so one failed call doesn't poison the queue for calls behind it.
  queue = run.catch(() => {})
  try {
    return await run
  } catch (e) {
    console.error('[demist] detectTerms generation failed:', e?.message ?? e)
    return []
  }
}

// Direct testing measured ~40-60s per call on this tier/hardware (CPU-only,
// see gpu:false above), regardless of output length (capping maxTokens
// didn't meaningfully speed it up: the model is just slow here, not
// rambling). The desktop app batches new speech into a detectTerms() call
// every 4s (see recordingSession.tsx's detectionIntervalMs), so strictly
// queuing every call in arrival order meant each one waited behind roughly
// ten others by the time it ran: term cards showing up a minute or more
// after they were actually said, and summarize() (below, sharing this same
// queue) stuck behind however large that backlog had grown by session end.
// Instead of queuing unboundedly, only one call actually runs at a time;
// anything that arrives while it's running gets merged into a single
// pending batch (transcripts concatenated) rather than queued separately,
// and that merged batch runs once as soon as the model is free. This bounds
// the worst case to "whatever's currently running, plus one merged batch"
// instead of unbounded growth, at the cost of not getting a separate pass
// over every single 4s window when the model can't keep up with that cadence.
let detectBusy = false
let pendingBatch = null
let pendingWaiters = []

async function detectTerms(transcript, recentContext, subject, year, emitProgress, knownTerms) {
  if (!transcript?.trim()) return []
  await ensureLoaded(emitProgress, 'detectTerms')

  if (detectBusy) {
    if (pendingBatch) {
      pendingBatch.transcript += ' ' + transcript
      if (recentContext) pendingBatch.context = recentContext
    } else {
      pendingBatch = { transcript, context: recentContext, subject, year, knownTerms }
    }
    return new Promise(resolve => pendingWaiters.push(resolve))
  }

  detectBusy = true
  const result = await runDetectOnce(transcript, recentContext, subject, year, knownTerms)
  // Drain whatever piled up while the call above was running. A loop, not a
  // single pass: more callers can arrive (and merge into a fresh
  // pendingBatch) while THIS drain call is itself running.
  while (pendingBatch) {
    const batch = pendingBatch
    pendingBatch = null
    const waiters = pendingWaiters
    pendingWaiters = []
    const batchResult = await runDetectOnce(batch.transcript, batch.context, batch.subject, batch.year, batch.knownTerms)
    waiters.forEach(resolve => resolve(batchResult))
  }
  detectBusy = false
  return result
}

// On-device replacement for the detect-terms edge function's `explain_mode`,
// which is what the "select a phrase and ask what it means" popups in the
// transcript, the summary and the flashcard reader call.
//
// Those three popups were the last place the desktop app sent text a user had
// derived from their own lecture to OpenAI, which contradicted the app's own
// privacy policy outright. Everything they need is already resident in this
// worker, so routing them here costs no extra memory and no extra model - only
// the same few seconds of local generation every other call here takes.
//
// Unlike detectTerms this NEVER returns nothing on a judgement call. The user
// selected the phrase and asked; refusing to answer because the phrase looks
// ordinary would be answering a different question than the one asked.
async function explain(text, subject, year) {
  const phrase = text?.trim()
  if (!phrase) return null
  await ensureLoaded(undefined, 'explain')

  const who = subject
    ? `a ${year ? `Year ${year} ` : ''}${subject} student`
    : 'a university student'
  const prompt = `Explain what "${phrase}" means, for ${who} who has just met it in a lecture and does not know it.

Write one or two plain-English sentences. Be specific and concrete: say what it actually is or does, not that it is "a term used in this field". Do not repeat the phrase back as its own definition.

Return JSON with a single field "definition".`

  // Same queue as detectTerms/summarize: one LlamaChatSession, one context
  // sequence, so these cannot overlap.
  const run = queue.then(async () => {
    session.resetChatHistory()
    const response = await session.prompt(prompt, { grammar: explainGrammar })
    return explainGrammar.parse(response)?.definition?.trim() || null
  })
  queue = run.catch(() => {})
  try {
    return await run
  } catch (e) {
    console.error('[demist] explain generation failed:', e?.message ?? e)
    return null
  }
}

// On-device replacement for the summarize-session edge function's OpenAI
// call, so the "nothing leaves the device" guarantee (see file header)
// extends to end-of-lecture summaries too, not just live term detection.
// Shares the same LlamaChatSession/queue as detectTerms above, for the same
// reason: one context sequence, one call at a time.
async function summarize(termRows, subject) {
  if (!termRows?.length) return null
  await ensureLoaded(undefined, 'summarize')

  const context = subject ? `for a lecture on "${subject}"` : 'from a lecture'
  const termList = termRows.slice(0, SUMMARY_MAX_TERMS).map((t) => `- ${t.term}: ${t.definition}`).join('\n')
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

// matchTermLine is exported for test/run-all.js: a parser that silently
// rejected the model's real output cost a whole lecture's term cards, and that
// is checkable in milliseconds without loading a 2GB model.
// matchTermLine and saidInTranscript are exported for test/run-all.js: a parser
// that silently rejected the model's real output cost a whole lecture's term
// cards, and a transcript check that silently rejected correctly-spelled terms
// cost the best ones. Both are checkable in milliseconds without loading a 2GB
// model, which is the only reason either bug survived as long as it did.
module.exports = { detectTerms, explain, summarize, preload, getTier, setTier, matchTermLine, saidInTranscript, normalize }

// Which transcription model a machine uses, as a tiny module with no heavy
// imports, so the MAIN process can answer Settings directly.
//
// WHY (2026-10-20). Settings asked the transcribe worker for its tier, and that
// worker is often mid-way through a synchronous model load, so the request sat
// in its queue until the 60s call timeout and Settings showed "Transcription is
// still busy loading" (5 such errors in PostHog in a month). Reading one small
// JSON file never needed the worker at all. whisper.js requires
// @huggingface/transformers at import, so main.js cannot simply require it.
//
// The worker re-reads TIER_FILE on every transcriber lookup, so a tier written
// here is picked up there on the next call, exactly as before.
const fs = require('fs')
const os = require('os')
const path = require('path')

const MODEL_BY_TIER = {
  fast: 'Xenova/whisper-base.en',
  accurate: 'Xenova/whisper-small.en',
}
const TIER_FILE = path.join(os.homedir(), '.demist', 'whisper-tier.json')
const TOTAL_RAM_GB = os.totalmem() / (1024 ** 3)

// Which model a machine gets by default, on the machine's own terms. With the
// accurate tier, Whisper + the term-detection LLM + translation come to
// roughly 5.8GB resident; on a 16GB machine that already forced the OS to page
// models out, and on an 8GB laptop it would be unusable.
//
// The fast tier (whisper-base.en q8) is 1027MB instead of 2332MB and runs
// twice as fast, but measured 26.1% WER against 8.7%, so it is a fallback for
// machines that cannot afford the accurate one, never the default for
// machines that can. An explicit choice in Settings overrides this either way.
function defaultTier() {
  return TOTAL_RAM_GB < 10 ? 'fast' : 'accurate'
}

function getTier() {
  // Pins the tier for test harnesses WITHOUT writing TIER_FILE (a test must
  // never change the tier of a live session; see DEMIST_LLM_TIER in llm.js).
  const override = process.env.DEMIST_TRANSCRIBE_TIER
  if (override && MODEL_BY_TIER[override]) return override
  try {
    const tier = JSON.parse(fs.readFileSync(TIER_FILE, 'utf8')).tier
    return MODEL_BY_TIER[tier] ? tier : defaultTier()
  } catch {
    return defaultTier()
  }
}

function setTier(tier) {
  if (!MODEL_BY_TIER[tier]) throw new Error(`Unknown transcription tier "${tier}"`)
  fs.mkdirSync(path.dirname(TIER_FILE), { recursive: true })
  fs.writeFileSync(TIER_FILE, JSON.stringify({ tier }))
  return tier
}

module.exports = { MODEL_BY_TIER, TIER_FILE, TOTAL_RAM_GB, defaultTier, getTier, setTier }

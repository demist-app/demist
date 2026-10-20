// define-precision.js, but driving the official llama.cpp server
// (llama-server.exe, localhost only) instead of node-llama-cpp in-process.
//
// WHY (2026-10-20): on an idle Ryzen 5 5600X, the same llama.cpp build (b9842)
// and model measured 189 tok/s reading / 27 tok/s writing in llama.cpp's own
// tools against 16 / 6.5 through node-llama-cpp, with llama.cpp's own perf
// counters confirming the slow numbers inside the node process. This checks
// whether the candidates-first pipeline is live-fast on the official runtime,
// with identical prompts and grading.
//
//   start: llama-server.exe -m <tiny gguf> -t 6 -c 4096 --host 127.0.0.1 --port 8077 -np 1 --no-webui
//   then:  node test/define-precision-server.mjs
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const sets = require('./fixtures/precision-candidates.json')
const URL = process.env.LLAMA_SERVER || 'http://127.0.0.1:8077'

const EX_YES = 'Yes, true: genuine terms, including well-known ones. Examples: "ATP synthase", "catalyst", "datagram", "income effect", "activation energy", "loss function".'
const EX_NO = 'No, false: everyday words or phrases ("take care", "jacket", "five or six seconds"), and words speech recognition mis-heard, which sound technical but are not real terms. Examples: "Patriarchs fibres" (really "Purkinje fibres"), "S-mode" (really "SA node"), "dechloridation" (really "depolarisation").'
const verifyPrompt = (term, sentence, who) => `Answer with JSON only: {"technical": true} or {"technical": false}.

You will be asked whether a candidate is a recognised technical or academic term ${who}.

${EX_YES}
${EX_NO}

Sentence from a lecture (written by speech recognition): "${sentence}"
Candidate: "${term}"

Is "${term}" a recognised technical or academic term ${who}?`
const definePrompt = (term, sentence, who) => `Return JSON with a single field "definition": ONE short plain-English sentence, at most 25 words, explaining what the term below means as it is used in its sentence, for ${who} who has not met it before. Say what it actually is or does. Do not use the term itself as its own explanation.

Sentence from a lecture: "${sentence}"
Term: "${term}"`

async function ask(prompt, schema, maxTokens) {
  const res = await fetch(`${URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: maxTokens,
      cache_prompt: true,
      response_format: { type: 'json_schema', json_schema: { schema } },
    }),
  })
  const body = await res.json()
  return body.choices?.[0]?.message?.content ?? ''
}

async function defineWindow(candidates, subject) {
  const who = subject ? `in ${subject}` : 'in an academic subject'
  const whoStudent = subject ? `a Year 2 ${subject} student` : 'a university student'
  const accepted = []
  for (const c of candidates) {
    if (accepted.length >= 2) break
    const r = await ask(verifyPrompt(c.term, c.sentence, who), { type: 'object', properties: { technical: { type: 'boolean' } }, required: ['technical'] }, 12)
    try { if (JSON.parse(r).technical === true) accepted.push(c) } catch { /* treat as no */ }
  }
  const kept = []
  for (const c of accepted) {
    const r = await ask(definePrompt(c.term, c.sentence, whoStudent), { type: 'object', properties: { definition: { type: 'string' } }, required: ['definition'] }, 64)
    try { const d = JSON.parse(r).definition?.trim(); if (d) kept.push({ term: c.term, definition: d }) } catch { /* cut off */ }
  }
  return kept
}

const times = []
let fp = 0, missed = 0, garbled = 0
for (const [name, rows] of Object.entries(sets)) {
  console.log(`\n${name}`)
  for (const row of rows) {
    const t = Date.now()
    const terms = row.candidates.length ? await defineWindow(row.candidates, row.subject) : []
    const ms = Date.now() - t
    if (row.candidates.length) times.push(ms)
    const got = terms.map(x => x.term)
    let ok = true
    if (name === 'MUNDANE' && got.length) { fp++; ok = false }
    if (name === 'TECHNICAL' && !got.length) { missed++; ok = false }
    if (name === 'GARBLED' && got.some(x => x.toLowerCase().includes(row.bad))) { garbled++; ok = false }
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${row.label.padEnd(11)} ${String(ms).padStart(6)}ms -> ${got.join(' | ') || '(none)'}`)
    for (const x of terms) console.log(`         ${x.term}: ${x.definition.slice(0, 100)}`)
  }
}
times.sort((a, b) => a - b)
console.log(`\nfalse positives ${fp}/${sets.MUNDANE.length}, missed ${missed}/${sets.TECHNICAL.length}, garbled kept ${garbled}/${sets.GARBLED.length}`)
console.log(`time per window with candidates: median ${times[Math.floor(times.length / 2)]}ms, worst ${times[times.length - 1]}ms`)

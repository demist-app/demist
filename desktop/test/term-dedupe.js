// The two term-quality rules, checked against the exact strings a real
// recording produced, with no model loaded.
//
// Both bugs these cover were found by running the shipping app against
// test/fixtures/speech.wav and reading what actually reached the glossary:
//
//   - "chemiosmosis" was dropped four times as a hallucination because the
//     transcriber had written "chemisimosis", while that misspelling became a
//     flashcard from a later window.
//   - "proton motive" and "proton motive force" both became cards, with
//     near-identical definitions, from one 11-second recording.
//
//   node test/term-dedupe.js
const { saidInTranscript, normalize } = require('../native/llm')

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`)
  else { failures++; console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`) }
}

// ── The transcript check, against what Whisper really wrote ─────────────────
const HAY = normalize(
  'Today we will cover chemisimosis and the proton motive for across the inner '
  + 'mitochondrial membrane, and then move on to Basie and Rich Regularization',
)

console.log('transcript match (the transcriber\'s spelling vs the model\'s):')
for (const [term, want, why] of [
  ['chemiosmosis', true, 'the correctly-spelled term the transcript got wrong'],
  ['proton motive', true, 'exact'],
  ['mitochondrial membrane', true, 'exact, multi-word'],
  ['photosynthesis', false, 'never said'],
  ['quantum entanglement', false, 'never said, multi-word'],
  ['Bayesian ridge regularization', false, 'plausible from context but not what was written'],
  // Short terms get NO spelling slack. At three characters a slack of one lets
  // an invented fragment match almost anything - this exact string reached a
  // real user's screen as a flashcard reading "Rit - Not a recognized term in
  // the context of the provided excerpt".
  ['Rit', false, 'too short for fuzzy matching to mean anything'],
  ['ATP', false, 'short, and genuinely not in this transcript'],
  ['proton', true, 'short-ish but literally present, so exact match carries it'],
]) {
  const got = saidInTranscript(HAY, term)
  check(`${JSON.stringify(term)} -> ${got}`, got === want, why)
}

// ── The near-duplicate rule, as the renderer applies it ─────────────────────
// A port of lib/termSimilarity.ts. It cannot be imported here (TypeScript, and
// a different process), so this is the second copy the file's own comment warns
// about - it exists so a change to one that is not made to the other fails
// loudly instead of quietly diverging.
function editDistanceWithin(a, b, max) {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  let cur = new Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    let best = cur[0]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    const t = prev; prev = cur; cur = t
  }
  return prev[b.length]
}
const slack = t => Math.min(3, Math.max(1, Math.round(t.length * 0.2)))
function isTruncationOf(s, l) {
  if (s === l) return true
  if (!(l.startsWith(s + ' ') || l.endsWith(' ' + s) || l.includes(' ' + s + ' '))) return false
  const sw = s.split(' ').length, lw = l.split(' ').length
  return sw >= 2 && lw - sw <= 1
}
function isSameConcept(a, b) {
  const x = normalize(a), y = normalize(b)
  if (!x || !y) return false
  if (x === y) return true
  if (x.length < y.length ? isTruncationOf(x, y) : isTruncationOf(y, x)) return true
  if (Math.min(x.length, y.length) < 5) return false
  const max = slack(x.length < y.length ? x : y)
  return editDistanceWithin(x, y, max) <= max
}

console.log('\nnear-duplicate detection:')
for (const [a, b, want, why] of [
  ['proton motive', 'proton motive force', true, 'the pair one real recording produced'],
  ['chemiosmosis', 'chemisomosis', true, 'one mis-heard spelling of the other'],
  ['mitochondrial matrix', 'mitochondrial membrane', false, 'genuinely different structures'],
  ['cell', 'cellular respiration', false, 'substring, but not a word boundary'],
  ['ATP synthase', 'ATP', false, 'a molecule and an enzyme: a student needs both cards'],
  ['regularization', 'ridge regularization', false, 'the longer one is a specific kind, not a fuller name'],
  ['inner mitochondrial membrane', 'mitochondrial membrane', true, 'the same structure, one word of precision apart'],
  ['enthalpy', 'entropy', false, 'similar-looking, completely different quantities'],
  ['packet switching', 'Packet Switching', true, 'case only'],
]) {
  const got = isSameConcept(a, b)
  check(`${JSON.stringify(a)} vs ${JSON.stringify(b)} -> ${got}`, got === want, why)
}

// ── A definition that refuses to define ─────────────────────────────────────
// The model sometimes honours the FORMAT while declining the substance, and the
// parser read that as a real answer. Same source as the "Rit" case above: the
// card's own text said it was not a term.
const { matchTermLine } = require('../native/llm')
const NON_DEFINITION = /^\s*(not (a|an)\b|no\b|n\/a\b|unknown\b|unclear\b|cannot\b|can't\b|this (is not|isn't)\b|there is no\b|does not (appear|refer)\b|undefined\b)/i

console.log('\nself-negating definitions:')
for (const [line, shouldDrop] of [
  ['TERM: Rit | DEFINITION: Not a recognized term in the context of the provided excerpt. | CONTEXT: and rich regularization', true],
  ['TERM: Foo | DEFINITION: Unknown. | CONTEXT: something', true],
  ['TERM: chemiosmosis | DEFINITION: The movement of ions across a membrane to drive ATP synthesis. | CONTEXT: we will cover chemiosmosis', false],
  ['TERM: entropy | DEFINITION: A measure of disorder in a system. | CONTEXT: entropy increases', false],
]) {
  const m = matchTermLine(line)
  const dropped = !!m && NON_DEFINITION.test(m[2])
  check(`${JSON.stringify((m ? m[2] : line).slice(0, 44))} -> ${dropped ? 'dropped' : 'kept'}`,
    dropped === shouldDrop)
}

console.log(failures ? `\n${failures} FAILED` : '\nall term-quality rules behave')
process.exit(failures ? 1 : 0)

'use client'

// Is this term the same concept as one already on screen?
//
// The dedupe this replaces was an exact lowercase string match, which is only
// as good as the model's consistency in wording — and it is not consistent. A
// single 11-second test recording produced "proton motive" and "proton motive
// force" as two separate cards with near-identical definitions, plus
// "chemisomosis" alongside a correctly-spelled "chemiosmosis", because none of
// those pairs are equal as strings.
//
// Two things get caught here, and they are different failures:
//
//   - one term is a sub-phrase of another ("proton motive" in "proton motive
//     force"): the model found the same concept twice and trimmed or extended
//     the name. Whole-word only, so "cell" does not swallow "cellular
//     respiration" — a substring that breaks a word boundary is usually a
//     different word, not a shorter name for the same one.
//   - one is a misspelling of the other ("chemisomosis" / "chemiosmosis"):
//     the transcriber heard an unfamiliar word and guessed, and the two
//     spellings came from different detection windows.
//
// desktop/native/llm.js carries the same rules for its own transcript check.
// They cannot share code across the process boundary, so if one changes, check
// the other.

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

// Bounded edit distance: gives up the moment it provably exceeds `max`, since
// the answer for almost every pair is "nowhere close" and computing exactly how
// far is wasted work.
function editDistanceWithin(a: string, b: string, max: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = new Array<number>(b.length + 1)
  let cur = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
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

// Roughly a fifth of the characters, which is the scale of a plausible
// mis-hearing, and far too tight for one real term to be mistaken for another.
// Short terms get a floor of 1 so "gene"/"genes" still pairs; long ones a
// ceiling of 3 so a 30-character phrase cannot drift into a different one.
const spellingSlack = (term: string) => Math.min(3, Math.max(1, Math.round(term.length * 0.2)))

// A sub-phrase is only the SAME CONCEPT when the shorter reads as a truncation
// of the longer, not when it is a shorter term that the longer one is built
// from. "proton motive" is not a thing on its own — it is "proton motive force"
// with the last word missing — whereas "ATP" and "ATP synthase" are a molecule
// and an enzyme, and a student needs both cards.
//
// Two words minimum, and at most one word added. A single-word term is almost
// always a real term rather than a truncation (ATP, entropy, mitochondrion),
// and a longer term that adds two or more words has usually become something
// else ("regularization" -> "Bayesian ridge regularization").
function isTruncationOf(shorter: string, longer: string): boolean {
  if (shorter === longer) return true
  const inside = longer.startsWith(shorter + ' ')
    || longer.endsWith(' ' + shorter)
    || longer.includes(' ' + shorter + ' ')
  if (!inside) return false
  const shortWords = shorter.split(' ').length
  const longWords = longer.split(' ').length
  return shortWords >= 2 && longWords - shortWords <= 1
}

export function isSameConcept(a: string, b: string): boolean {
  const x = normalize(a)
  const y = normalize(b)
  if (!x || !y) return false
  if (x === y) return true
  if (x.length < y.length ? isTruncationOf(x, y) : isTruncationOf(y, x)) return true
  // Only worth the distance check for terms of comparable length; a
  // three-character difference means nothing between "ion" and "iron" but
  // everything between two forty-character phrases, and the length guard inside
  // editDistanceWithin already rejects the mismatched ones cheaply.
  if (Math.min(x.length, y.length) < 5) return false
  const max = spellingSlack(x.length < y.length ? x : y)
  return editDistanceWithin(x, y, max) <= max
}

// The first match wins, so callers keep whichever wording they saw first
// rather than flickering a card as a rephrasing arrives. Returns the term it
// collided with, for logging — "why did my term vanish" is otherwise
// unanswerable from the outside.
export function collidesWith(term: string, seen: Iterable<string>): string | null {
  for (const s of seen) if (isSameConcept(term, s)) return s
  return null
}

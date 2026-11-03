// Vocabulary cards for people who told us English isn't their first language.
//
// WHY (2026-11-03). The first paying customer recorded about four hours of a
// healthcare careers course on the desktop app and got no cards at all, so no
// summaries either. The desktop's on-device model only says yes to
// recognised technical terms, and in a course like that almost nothing
// qualifies: measured on her own transcript it rejected all 981 candidates.
// Her profile says English isn't her first language, and for her the useful
// cards were never "technical terms" anyway but the less common words a
// lecture leans on: facilitator, proactive, empathetic, frontline, dementia.
//
// So for those users only, a window where the model kept nothing falls back
// to the least common real dictionary word among its candidates, explained by
// the same on-device explain() the transcript's "what does this mean?" popup
// uses. Commonness comes from SCOWL (public/vocab-levels.json, built by
// scripts/build-vocab-levels.mjs): no model judgement, so it cannot have the
// model's blind spot. It never picks names, abbreviations, or anything the
// dictionary does not know, which is where mis-hearings and invented
// expansions of abbreviations would come from.

// SCOWL levels: 10 and 20 are words any learner meets early. 35 and up are
// where the vocabulary a lecture assumes begins ("dementia", "impairment").
export const LEARNER_MIN_LEVEL = 35

export type VocabLevels = Map<string, number>

let loading: Promise<VocabLevels | null> | null = null

// Fetched once per page, and only by desktop sessions (~240KB gzipped).
export function loadVocabLevels(): Promise<VocabLevels | null> {
  loading ??= fetch('/vocab-levels.json')
    .then(r => (r.ok ? r.json() : null))
    .then((data: Record<string, string> | null) => {
      if (!data) return null
      const map: VocabLevels = new Map()
      for (const [level, words] of Object.entries(data)) for (const w of words.split(' ')) map.set(w, Number(level))
      return map
    })
    .catch(() => {
      loading = null // let a later window try again
      return null
    })
  return loading
}

function wordLevel(word: string, levels: VocabLevels): number | undefined {
  const w = word.toLowerCase().replace(/['’]s$/, '')
  return levels.get(w)
    ?? (w.endsWith('ies') ? levels.get(w.slice(0, -3) + 'y') : undefined)
    ?? (w.endsWith('es') ? levels.get(w.slice(0, -2)) : undefined)
    ?? (w.endsWith('s') ? levels.get(w.slice(0, -1)) : undefined)
}

// A name rather than a word: every word capitalised in a phrase ("Jane Moll",
// "Google Chrome"), or a single capitalised word that is not where a sentence
// starts.
function looksLikeName(term: string, sentence: string): boolean {
  const words = term.split(/\s+/)
  if (!words.some(w => /^[A-Z]/.test(w))) return false
  if (words.length > 1) return words.every(w => /^[A-Z]/.test(w))
  const at = sentence.indexOf(term)
  return at > 0 || at === -1
}

// Desktop only, before the on-device model sees anything: drops single words
// among the ~4,000 commonest in English (SCOWL level 10: "information",
// "program", "function") and multi-word names ("Jim Thorpe", "Haskell
// Institute"). The model's check is lenient since 2026-11-03 (see verifyTerm
// in desktop/native/llm.js) and those were most of what slipped through it.
// Abbreviations are kept; the model judges those.
export function dropCommonAndNames<T extends { term: string }>(candidates: T[], levels: VocabLevels): T[] {
  return candidates.filter(c => {
    const words = c.term.trim().split(/\s+/)
    if (words.length > 1) return !words.every(w => /^[A-Z]/.test(w))
    if (/^[A-Z]{2,6}s?$/.test(c.term)) return true
    const level = wordLevel(c.term, levels)
    return level === undefined || level > 10
  })
}

// The least common real word among this window's candidates, or null when
// none is uncommon enough to be worth a card.
export function pickLearnerWord<T extends { term: string; sentence: string }>(
  candidates: T[],
  levels: VocabLevels,
): T | null {
  let best: T | null = null
  let bestLevel = 0
  for (const c of candidates) {
    const term = c.term.trim()
    if (!term || /[0-9]/.test(term) || /^[A-Z]{2,}s?$/.test(term)) continue
    if (looksLikeName(term, c.sentence)) continue
    const parts = term.split(/[\s-]+/).filter(Boolean)
    const found = parts.map(p => wordLevel(p, levels))
    if (found.some(l => l === undefined)) continue
    const level = Math.max(...(found as number[]))
    if (level < LEARNER_MIN_LEVEL) continue
    if (level > bestLevel || (level === bestLevel && best && term.length > best.term.length)) {
      best = c
      bestLevel = level
    }
  }
  return best
}

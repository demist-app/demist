// Client-side candidate spotting so detect-terms receives isolated terms plus one
// sentence each, never transcript windows.
//
// This was written recall-tuned, on the stated assumption that "false positives
// are fine, the LLM filters". That assumption turned out to be wrong: an audit
// of all 692 production terms on 2026-09-20 found gpt-4o-mini defining
// "toothpaste", "surveillance" and "presentation" rather than dropping them,
// because a list the client has already labelled "possible technical terms"
// reads to the model as an instruction to define. So the client now applies the
// same precision gate the results are judged by (termQuality.ts), which both
// raises precision and cuts the payload and per-call cost.

const COMMON = new Set([
  // ~350 highest-frequency English words. Enough to reject filler; the affix and
  // length rules do the real work. Extend freely, never remove the affix rules.
  'the','be','to','of','and','a','in','that','have','i','it','for','not','on','with','he','as','you','do','at',
  'this','but','his','by','from','they','we','say','her','she','or','an','will','my','one','all','would','there',
  'their','what','so','up','out','if','about','who','get','which','go','me','when','make','can','like','time','no',
  'just','him','know','take','people','into','year','your','good','some','could','them','see','other','than','then',
  'now','look','only','come','its','over','think','also','back','after','use','two','how','our','work','first','well',
  'way','even','new','want','because','any','these','give','day','most','us','is','was','are','been','has','had',
  'were','said','did','having','may','should','very','through','where','much','before','right','too','means','same',
  'tell','does','set','three','while','might','still','own','last','never','under','read','left','find','thing',
  'lecture','lectures','today','going','okay','yeah','really','actually','basically','something','things','little',
  'again','always','around','between','both','came','come','course','different','down','each','end','every','example',
  'far','few','found','great','group','hand','help','here','high','home','important','keep','kind','large','later',
  'learn','life','line','long','made','many','mean','more','need','next','number','often','old','once','open','part',
  'place','point','put','question','quite','rather','real','run','saw','second','seem','show','side','since','small',
  'sound','start','state','story','study','such','sure','system','talk','term','terms','those','thought','together',
  'top','turn','understand','until','used','using','usually','water','week','went','why','without','word','words',
  'world','write','yes','young',
])

const TECHNICAL_AFFIXES = /(?:osis|itis|aemia|emia|ology|olysis|otomy|ectomy|opathy|plasia|trophy|genesis|kinesis|philia|phobia|centesis|scopy|graphy|gram$|ase$|ide$|ate$|yl$|oid$|eous$|ferous$|ism$|tion$|sion$|ance$|ence$|ivity$|isation$|ization$|^hyper|^hypo|^intra|^inter|^peri|^endo|^exo|^anti|^poly|^macro|^micro|^neuro|^cardio|^hepato|^nephro|^gastro|^haema|^hema|^osteo|^myo|^derm|^pseudo|^meta|^iso|^electro|^thermo|^photo|^juris|^tort)/i

import { isLikelyJargon } from '@/lib/termQuality'
import { isFunctionWord, type LectureLanguage } from '@/lib/lectureLanguage'

// Nouns that end established multi-word terms across subjects. A phrase is
// proposed when one of these follows one or two describing words:
// "tricuspid valve", "income effect", "loss function", "proton motive force".
//
// WHY (2026-10-20). Until now the only phrases ever proposed were Capitalised
// Ones, so a lowercase multi-word term could only reach a student as one of
// its words. Measured: 27% of desktop's terms are lowercase phrases (its model
// reads the whole sentence) against 0 of 560 on the web.
// This list does not have to be complete or precise. It only decides what is
// ASKED about; the detect-terms "is this a real term" verdict and
// termQuality.ts still decide what becomes a card.
const PHRASE_HEADS = new Set([
  'effect', 'function', 'cycle', 'energy', 'force', 'potential', 'valve', 'cell', 'nerve', 'tissue', 'fluid',
  'matrix', 'membrane', 'theory', 'law', 'principle', 'equation', 'curve', 'rate', 'ratio', 'constant',
  'gradient', 'pathway', 'receptor', 'hormone', 'enzyme', 'reaction', 'bond', 'syndrome', 'disorder',
  'disease', 'node', 'layer', 'acid', 'artery', 'vein', 'muscle', 'gland', 'duct', 'cortex', 'lobe', 'gene',
  'protein', 'distribution', 'coefficient', 'regression', 'algorithm', 'elasticity', 'equilibrium', 'surplus',
  'deficit', 'fallacy', 'doctrine', 'clause', 'liability', 'mechanism', 'bias', 'hypothesis', 'transport',
  'pressure', 'capacity', 'resistance', 'frequency', 'spectrum', 'orbital', 'isomer', 'compound', 'inhibitor',
  'agonist', 'antagonist', 'channel', 'pump', 'junction', 'fibre', 'fiber', 'vessel', 'cavity', 'ligament',
  'tendon', 'tract', 'reflex', 'threshold', 'system', 'complex', 'variable', 'test', 'error', 'structure',
  'transfer', 'cascade', 'loop', 'circuit', 'quotient', 'index', 'paradox', 'tort', 'estoppel', 'reticulum',
])
// Words that describe size, order or emphasis, which turn any noun into an
// ordinary phrase ("big effect", "main function", "same rate").
const PHRASE_STOP = new Set([
  'big', 'small', 'main', 'whole', 'same', 'other', 'next', 'last', 'good', 'bad', 'new', 'old', 'high', 'low',
  'total', 'overall', 'general', 'basic', 'simple', 'key', 'major', 'minor', 'real', 'actual', 'certain',
  'specific', 'particular', 'different', 'first', 'second', 'third', 'important', 'huge', 'massive', 'tiny',
  'entire', 'nice', 'great', 'whatever', 'another', 'every', 'each', 'such', 'own', 'full', 'half', 'net',
  'positive', 'negative', 'normal', 'usual', 'common', 'typical', 'previous', 'following', 'final', 'initial',
  'current', 'early', 'late', 'quick', 'slow', 'fast', 'easy', 'hard', 'strong', 'weak', 'little', 'long',
  'short', 'better', 'best', 'worse', 'worst', 'more', 'less', 'most', 'least', 'very', 'really', 'quite',
  'just', 'only', 'also', 'any', 'some', 'many', 'much', 'few', 'several', 'various', 'possible', 'side',
  'its', 'their', 'our', 'your', 'his', 'her', 'this', 'that', 'these', 'those', 'what', 'which',
])

// Letters, including the accented ones French, Dutch, German and Spanish
// lectures are full of. [A-Za-z] alone cut "précontractuelle" into "pr" and
// "contractuelle".
const LETTERS = 'A-Za-zÀ-ÖØ-öø-ÿŒœ'
const NOT_WORD = new RegExp(`[^${LETTERS}\\-]+`)
const WORD = new RegExp(`^[${LETTERS}][${LETTERS}\\-]+$`)
const ENDS_CLAUSE = /[.,;:!?)"]$/

function singular(w: string): string {
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (/(?:sses|xes|ches|shes)$/.test(w)) return w.slice(0, -2)
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1)
  return w
}

function isCommon(word: string, lang: LectureLanguage): boolean {
  return lang === 'en' ? COMMON.has(word) : isFunctionWord(word, lang)
}

function usableModifier(raw: string): boolean {
  const w = raw.toLowerCase()
  // Past tenses are verbs here, not descriptions: "created systems",
  // "considered supreme laws" (seen replaying real lectures, 2026-10-20).
  return WORD.test(raw) && w.length >= 3 && !COMMON.has(w) && !PHRASE_STOP.has(w) && !/[a-z]ed$/.test(w)
}

/**
 * Lowercase multi-word terms ending in a PHRASE_HEADS noun. English only:
 * French and Dutch put the describing word after the noun ("potentiel de
 * membrane"), and for those the detect-terms prompt widens a single-word
 * candidate to its full term instead.
 */
function headPhrases(sentence: string): string[] {
  const tokens = sentence.split(/\s+/)
  const found: string[] = []
  for (let i = 1; i < tokens.length; i++) {
    const head = tokens[i].replace(/[^A-Za-z\-]+$/, '')
    if (!PHRASE_HEADS.has(singular(head.toLowerCase()))) continue
    // A phrase never spans punctuation.
    const prev = tokens[i - 1]
    if (ENDS_CLAUSE.test(prev) || !usableModifier(prev)) continue
    const before = i >= 2 ? tokens[i - 2] : ''
    const three = before && !ENDS_CLAUSE.test(before) && usableModifier(before)
    found.push(three ? `${before} ${prev} ${head}` : `${prev} ${head}`)
  }
  // "resting membrane potential" also matches "resting membrane" (membrane is
  // a head too): keep only the longest.
  return found.filter(p => !found.some(q => q !== p && q.toLowerCase().includes(p.toLowerCase())))
}

export interface Candidate { term: string; sentence: string }

export function extractCandidates(
  sentence: string,
  knownTerms: Set<string>,        // lowercased terms already in the user's glossary
  alreadySent: Set<string>,       // lowercased terms sent this session (caller owns, LRU-trim at ~500)
  lang: LectureLanguage = 'en',   // the lecture's language, see lectureLanguage.ts
): Candidate[] {
  const out: Candidate[] = []
  const clean = sentence.trim()
  if (clean.length < 12) return out
  // Words already asked about inside a phrase from this sentence, so
  // "tricuspid valve" is not followed by a separate card for "tricuspid".
  const inPhrase = new Set<string>()
  const take = (term: string): boolean => {
    const key = term.toLowerCase()
    if (knownTerms.has(key) || alreadySent.has(key)) return false
    out.push({ term, sentence: clean })
    alreadySent.add(key)
    return true
  }

  // Multi-word capitalised phrases mid-sentence ("Krebs cycle", "Donoghue v Stevenson")
  const phraseRe = /(?<!^)(?<![.!?]\s)([A-Z][a-z]+(?:\s+(?:v\.?|of|the|[A-Z][a-z]+)){1,4})/g
  for (const m of clean.matchAll(phraseRe)) {
    const t = m[1].trim()
    if (t.split(/\s+/).length >= 2 && isLikelyJargon(t) && take(t)) {
      t.toLowerCase().split(/\s+/).forEach(w => inPhrase.add(w))
    }
  }

  // An abbreviation followed by a technical word is usually one term ("ATP
  // synthase", "DNA polymerase", "CNS stimulation"); asked about alone, the
  // word came back defined without its subject (live, 2026-10-20: "synthase").
  for (const m of clean.matchAll(/\b([A-Z][A-Z0-9]{1,4})\s+([a-z][a-z\-]{3,})\b/g)) {
    const word = m[2]
    const technical = TECHNICAL_AFFIXES.test(word) || word.length >= 8 || PHRASE_HEADS.has(singular(word))
    if (!technical || isCommon(word, lang) || !isLikelyJargon(word)) continue
    if (take(`${m[1]} ${word}`)) inPhrase.add(word)
  }

  if (lang === 'en') {
    let phrases = 0
    for (const p of headPhrases(clean)) {
      if (phrases >= 2) break
      if (!isLikelyJargon(p)) continue
      if (take(p)) { phrases++; p.toLowerCase().split(/\s+/).forEach(w => inPhrase.add(w)) }
    }
  }

  for (const raw of clean.split(NOT_WORD)) {
    if (out.length >= 6) break   // per-sentence cap, keeps payloads tiny
    const w = raw.replace(/^-+|-+$/g, '')
    if (w.length < 5) continue
    const key = w.toLowerCase()
    if (inPhrase.has(key) || isCommon(key, lang)) continue
    // Length alone was the single worst signal here: >=9 characters admitted
    // toothpaste, surveillance, presentation, transformation, preferences and
    // structured, all of which became real flashcards. It is kept only as one
    // of three ways to look technical, and every route now has to clear the
    // shared jargon gate as well.
    const technical = TECHNICAL_AFFIXES.test(w) || w.includes('-') || w.length >= 9
    if (!technical) continue
    if (!isLikelyJargon(w)) continue
    take(w)
  }
  return out
}

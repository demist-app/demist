// GENERATED from web/lib/lectureLanguage.ts by scripts/sync-shared.mjs. Do not edit here.
// Which language a lecture is in, from its own transcript.
//
// WHY (2026-10-20). Roughly one in eight recent students lectures in French or
// Dutch (law and physiology in French, pharmacy in Dutch). Speech recognition
// already writes their lectures in the right language, but everything after it
// assumed English: the definitions came back in English, and the everyday-word
// filters only know English, so ordinary words became flashcards
// ("veroorzaakt", caused; "personnes", people).
//
// Function words are the most reliable cheap signal: every sentence of a
// language uses them, and the sets barely overlap. No network, no model, and it
// runs in the browser and on the phone alike (copied to mobile by sync-shared).
//
// Pure: no imports, no DOM.

export type LectureLanguage = 'en' | 'fr' | 'nl' | 'de' | 'es' | 'it' | 'pt'

export const LANGUAGE_NAME: Record<LectureLanguage, string> = {
  en: 'English', fr: 'French', nl: 'Dutch', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese',
}

// About 30 frequent function words per language, with every word that is
// common in two of these languages left out of both ("is" is English and
// Dutch, "que" is French, Spanish and Portuguese, "was" is English and
// German), so a shared word can never tip the result.
const MARKERS: Record<LectureLanguage, Set<string>> = {
  en: new Set(['the', 'and', 'of', 'to', 'that', 'it', 'this', 'with', 'for', 'are', 'you', 'they', 'have', 'which', 'what', 'but', 'not', 'be', 'can', 'there', 'from', 'about', 'will', 'would', 'if', 'or', 'because', 'when', 'these', 'those']),
  fr: new Set(['le', 'la', 'les', 'des', 'est', 'et', 'une', 'du', 'qui', 'dans', 'pour', 'pas', 'sur', 'avec', 'ce', 'cette', 'nous', 'vous', 'elle', 'ils', 'sont', 'donc', 'aussi', 'très', 'fait', 'être', 'avoir', 'au', 'aux', "c'est", "qu'on", 'ça', "d'un", "d'une", "l'on"]),
  nl: new Set(['het', 'een', 'van', 'dat', 'niet', 'met', 'zijn', 'voor', 'op', 'ook', 'maar', 'wat', 'dus', 'bij', 'nog', 'wordt', 'worden', 'heeft', 'hebben', 'naar', 'moet', 'deze', 'dit', 'aan', 'om', 'zo', 'jullie', 'hier', 'daar', 'geen', 'welke', 'waar']),
  de: new Set(['der', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'mit', 'auf', 'für', 'sich', 'dem', 'auch', 'wir', 'ich', 'aber', 'wie', 'oder', 'wird', 'werden', 'kann', 'noch', 'nur', 'sind', 'bei', 'vom', 'zum', 'zur', 'dass', 'haben', 'diese', 'dieser']),
  es: new Set(['el', 'los', 'las', 'y', 'es', 'que', 'pero', 'sus', 'este', 'esta', 'muy', 'también', 'hay', 'cuando', 'entonces', 'pues', 'están', 'usted', 'ustedes', 'nosotros', 'ellos', 'estos', 'estas', 'aquí', 'puede', 'tiene', 'hace']),
  it: new Set(['gli', 'della', 'delle', 'che', 'è', 'non', 'per', 'sono', 'anche', 'più', 'questo', 'questa', 'nel', 'nella', 'dei', 'degli', 'alla', 'allo', 'quindi', 'perché', 'molto', 'cosa', 'essere', 'tutti', 'anche', 'quando', 'abbiamo', 'questi']),
  pt: new Set(['os', 'as', 'é', 'não', 'um', 'uma', 'com', 'em', 'do', 'da', 'dos', 'das', 'na', 'mas', 'isso', 'isto', 'você', 'vocês', 'são', 'também', 'então', 'muito', 'nós', 'eles', 'aqui', 'pode', 'tem', 'faz']),
}

/**
 * The language of a stretch of transcript, or null when there is too little
 * text to tell. Needs a clear winner: a lecture that quotes another language
 * now and then stays in its own.
 */
export function detectLectureLanguage(text: string): LectureLanguage | null {
  const words = text.toLowerCase().replace(/[’]/g, "'").split(/[^a-zà-ÿœæ'']+/).filter(Boolean)
  if (words.length < 25) return null
  const score: Record<string, number> = {}
  for (const lang of Object.keys(MARKERS) as LectureLanguage[]) {
    const set = MARKERS[lang]
    score[lang] = words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0)
  }
  const ranked = (Object.keys(score) as LectureLanguage[]).sort((a, b) => score[b] - score[a])
  const [best, second] = ranked
  // Function words are 30-50% of running text in every one of these
  // languages; under 12% means this is not ordinary speech in any of them.
  if (score[best] < words.length * 0.12) return null
  if (score[best] < score[second] * 1.5) return null
  return best
}

/** Whether a lowercased word is one of a language's function words. */
export function isFunctionWord(word: string, lang: LectureLanguage): boolean {
  return MARKERS[lang].has(word)
}

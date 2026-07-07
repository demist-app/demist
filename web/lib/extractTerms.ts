// Client-side candidate spotting so detect-terms receives isolated terms plus one
// sentence each, never transcript windows. Recall-tuned: false positives are fine,
// the LLM filters. False negatives are the only real failure.

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

export interface Candidate { term: string; sentence: string }

export function extractCandidates(
  sentence: string,
  knownTerms: Set<string>,        // lowercased terms already in the user's glossary
  alreadySent: Set<string>,       // lowercased terms sent this session (caller owns, LRU-trim at ~500)
): Candidate[] {
  const out: Candidate[] = []
  const clean = sentence.trim()
  if (clean.length < 12) return out

  // Multi-word capitalised phrases mid-sentence ("Krebs cycle", "Donoghue v Stevenson")
  const phraseRe = /(?<!^)(?<![.!?]\s)([A-Z][a-z]+(?:\s+(?:v\.?|of|the|[A-Z][a-z]+)){1,4})/g
  for (const m of clean.matchAll(phraseRe)) {
    const t = m[1].trim()
    const key = t.toLowerCase()
    if (t.split(/\s+/).length >= 2 && !knownTerms.has(key) && !alreadySent.has(key)) {
      out.push({ term: t, sentence: clean }); alreadySent.add(key)
    }
  }

  for (const raw of clean.split(/[^A-Za-z\-]+/)) {
    const w = raw.trim()
    if (w.length < 5) continue
    const key = w.toLowerCase()
    if (COMMON.has(key) || knownTerms.has(key) || alreadySent.has(key)) continue
    const technical = TECHNICAL_AFFIXES.test(w) || w.includes('-') || w.length >= 9
    if (!technical) continue
    out.push({ term: w, sentence: clean })
    alreadySent.add(key)
    if (out.length >= 6) break   // per-sentence cap, keeps payloads tiny
  }
  return out
}

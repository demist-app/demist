// Offline checks for the candidate extractor and lecture-language detection.
//   cd web && node_modules/.bin/jiti scripts/test-term-candidates.ts
// Exit 1 on any failure. The live half (what the server keeps) is
// scripts/test-term-candidates-live.ts.
import { extractCandidates } from '../lib/extractTerms'
import { detectLectureLanguage } from '../lib/lectureLanguage'

let fail = 0
const check = (ok: boolean, label: string, detail: unknown) => {
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(44)} ${JSON.stringify(detail)}`)
}
const cands = (s: string, lang: Parameters<typeof extractCandidates>[3] = 'en') =>
  extractCandidates(s, new Set(), new Set(), lang).map(c => c.term)

// Must propose the phrase (lowercase multi-word terms the web never asked about)
const MUST: [string, string][] = [
  ['The proton motive force drives ATP synthase across the membrane.', 'proton motive force'],
  ['A Giffen good exists because the income effect outweighs the substitution effect.', 'income effect'],
  ['We minimise the loss function with gradient descent on each batch.', 'loss function'],
  ['Blood flows back through the tricuspid valve into the right ventricle.', 'tricuspid valve'],
  ['Mast cells release histamine during the late phase reaction.', 'phase reaction'],
  ['The activation energy determines the reaction rate in this experiment.', 'activation energy'],
  ['Calcium is stored in the sarcoplasmic reticulum of each muscle fibre.', 'sarcoplasmic reticulum'],
  ['The resting membrane potential sits at about minus seventy millivolts.', 'resting membrane potential'],
  ['Chemiosmosis drives ATP synthase across the inner membrane.', 'atp synthase'],
  ['Replication starts when DNA polymerase binds to the primer.', 'dna polymerase'],
]
for (const [s, want] of MUST) {
  const got = cands(s)
  check(got.some(t => t.toLowerCase().includes(want)), `phrase "${want}"`, got)
}

// Ordinary speech must not produce phrase candidates
const MUNDANE = [
  'It had a big effect on everyone in the room, honestly.',
  'The main function of today is to go over the reading for Thursday.',
  'Remember the test is next week, so the same rate of revision applies.',
  'Did you put the raspberry ones in the bag and said they were normal ones?',
  'Just give it five or six seconds and then it should settle down on its own.',
]
for (const s of MUNDANE) {
  const got = cands(s).filter(t => t.includes(' '))
  check(got.length === 0, `no phrase: "${s.slice(0, 36)}..."`, got)
}

// iPhone dictation (2026-10-30): run-on sentences, utterance-start capitals
const run = cands("Is gonna please tell me the flags up Give me a complicated word ribosome A contra PLAYR It didn't even know what that word a contra Okay Cuban AWS Kubernetes Okay, it's not flagging up any words")
check(run.includes('ribosome') && run.includes('AWS') && run.includes('Kubernetes'), 'run-on: ribosome, AWS, Kubernetes', run)
check(!run.includes('please') && !run.some(t => /okay/i.test(t)), 'run-on: no "please", no "Okay X"', run)
check(cands('The lysosome and the chromosome sit inside the cytoplasm of every leukocyte.').length >= 3, 'short biology words', cands('The lysosome and the chromosome sit inside the cytoplasm of every leukocyte.'))
check(cands('That was an awesome and troublesome week, please increase the volume.').length === 0, 'no affix false positives', cands('That was an awesome and troublesome week, please increase the volume.'))
check(!cands('We moved to the USA and watched the BBC on TV.').length, 'plain abbreviations skipped', cands('We moved to the USA and watched the BBC on TV.'))

// French and Dutch: accented words stay whole, function words are not asked about
const fr = cands("Mais précontractuelle, ce qu'on entend par précontractuelle, c'est la période des pourparlers avant la signature.", 'fr')
check(fr.includes('précontractuelle') && !fr.some(t => t === 'pr' || t === 'contractuelle'), 'French accents kept whole', fr)
const nl = cands('Je moet de dosering aanpassen aan het lichaamsgewicht van de patiënt voordat het geneesmiddel wordt afgeleverd.', 'nl')
check(nl.includes('lichaamsgewicht') && !nl.includes('voordat'), 'Dutch candidates', nl)

// Language detection
check(detectLectureLanguage("elle peut se situer entre les deux. Mais précontractuelle, ce qu'on entend par précontractuelle, contrat, ça va être fixé tout le processus pour signer le contrat. Donc il faut que vous compreniez bien la différence entre les deux périodes, parce que c'est très important.") === 'fr', 'detects French', null)
check(detectLectureLanguage('Okay so today we are carrying on with cellular respiration. Last week we finished glycolysis, which happens in the cytoplasm, and now the pyruvate moves into the mitochondrial matrix where it enters the Krebs cycle for the rest of the lecture.') === 'en', 'detects English', null)

console.log(fail ? `\n${fail} failed` : '\nall passed')
process.exit(fail ? 1 : 0)

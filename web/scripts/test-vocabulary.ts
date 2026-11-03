// Offline checks for the English-learner vocabulary picker (lib/vocabulary.ts).
//   cd web && node_modules/.bin/jiti scripts/test-vocabulary.ts
// Exit 1 on any failure. Needs public/vocab-levels.json
// (node scripts/build-vocab-levels.mjs).
import { readFileSync } from 'node:fs'
import { pickLearnerWord, type VocabLevels } from '../lib/vocabulary'

const data = JSON.parse(readFileSync('public/vocab-levels.json', 'utf8')) as Record<string, string>
const levels: VocabLevels = new Map()
for (const [l, ws] of Object.entries(data)) for (const w of ws.split(' ')) levels.set(w, Number(l))

let fail = 0
const pick = (sentence: string, terms: string[]) =>
  pickLearnerWord(terms.map(term => ({ term, sentence })), levels)?.term ?? null
const check = (label: string, got: string | null, want: string | null) => {
  const ok = got === want
  if (!ok) fail++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(40)} got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
}

// The less common word wins over everyday ones.
check('uncommon over everyday', pick('Our facilitator will help with everything and every interview.', ['facilitator', 'everything', 'interview']), 'facilitator')
check('only everyday words: no card', pick('There are lots of opportunities once you start.', ['opportunities', 'experience']), null)
check('plural of a listed word', pick('Residents with impairments need more support.', ['impairments']), 'impairments')
check('phrase of real words', pick('Mild cognitive impairment is common.', ['cognitive impairment']), 'cognitive impairment')
// Never names, abbreviations or words the dictionary does not know: those are
// where mis-hearings and invented abbreviation expansions come from.
check('product name', pick('Open the slides in Google Chrome first.', ['Google Chrome']), null)
check('person name', pick('Thank you to Jane Moll for joining today.', ['Jane Moll']), null)
check('mid-sentence capitalised word', pick('We partner with Sollars on placements.', ['Sollars']), null)
check('abbreviation', pick('Report every injury to the WSIB within three days.', ['WSIB', 'PSW']), null)
check('not in the dictionary (mis-hearing)', pick('Then dechloridation spreads across the cell.', ['dechloridation']), null)
check('number', pick('Form 1099 goes to the office.', ['1099']), null)
// Sentence-initial capital is not a name.
check('capital at sentence start', pick('Adaptability matters in this job.', ['Adaptability']), 'Adaptability')

if (fail) { console.log(`\n${fail} failed`); process.exit(1) }
console.log('\nall passed')

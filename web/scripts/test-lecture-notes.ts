// node --import tsx scripts/test-lecture-notes.ts  (or: npx tsx ...)
// The parts of lecture notes that must never be wrong: nothing the lecturer
// did not say gets through, and nothing they said is skipped.
import assert from 'node:assert/strict'
import { splitForNotes, numbersIn, makeGrounder, reminders, parseNotes, groundedNotes, sentencesOf } from '../lib/lectureNotes'

const T = `Okay so the essay is due on the twelfth of December at noon, it's two thousand words, and it goes through Turnitin. And the seminar on Thursday has moved to room G14. So Atkinson and Shiffrin in nineteen sixty eight had this multi store model. Patient K F was studied by Shallice and Warrington in nineteen seventy. Then in two thousand Baddeley added the episodic buffer, which holds about four chunks. Eslinger and Damasio studied a patient called E V R. It worked for two hundred and five people. For next week please read chapter four of Eysenck. Right, so the phonological store holds sounds for about 2 seconds.`

// Numbers said as words are found as digits.
for (const n of ['12', '2000', '1968', '1970', '4', '205', '14', '2']) assert(numbersIn(T).has(n), `missing ${n}`)
for (const n of ['5', '7', '1974', '1986']) assert(!numbersIn(T).has(n), `should not have ${n}`)

const ok = makeGrounder(T)
assert(ok('Atkinson and Shiffrin (1968) proposed the multi-store model.'))
assert(ok('The episodic buffer was added by Baddeley in 2000 and holds 4 chunks.'))
assert(ok('The essay is 2,000 words and due on 12 December.'))
assert(!ok('The phonological loop has a capacity of about 5-7 items.'), 'invented number kept')
assert(!ok('This was shown by Baddeley and Hitch in their experiment.'), 'invented name kept')
assert(!ok('The model was proposed in 1974.'), 'invented year kept')
assert(!ok('Executive function is a complex set of cognitive processes that includes planning, organizing, and controlling behavior.'), 'textbook padding kept')
assert(ok('The Episodic Buffer holds about four chunks of sound.'), 'title-case words that were said are fine')
assert(ok('Shallice and Warington studied the patient.'), 'one-letter misspelling of a said name is fine')

// German: capitals are nouns, not names.
const de = makeGrounder('Heute sprechen wir über die Photosynthese und den Aufbau der Zelle. Die Pflanze nutzt das Licht der Sonne, und der Zucker wird in der Wurzel gespeichert.')
assert(de('Die Pflanze nutzt Sonnenlicht als Energiequelle.'))

const r = reminders(T)
assert(r.some(x => x.includes('twelfth of December')), 'deadline missing')
assert(r.some(x => x.includes('chapter four')), 'reading missing')
assert(r.some(x => x.includes('room G14')), 'room missing')
assert(!r.some(x => x.includes('Atkinson')), 'content is not a reminder')
assert(r.every(x => T.toLowerCase().includes(x.toLowerCase())), 'reminders must be verbatim')

// Splitting loses nothing, and every piece fits.
const long = Array.from({ length: 300 }, (_, i) => `This is sentence number ${i} about the topic.`).join(' ')
const parts = splitForNotes(long)
assert(parts.every(p => p.length <= 1450))
assert.equal(parts.join(' ').replace(/\s+/g, ' '), long)
const none = 'word '.repeat(3000).trim()
assert.equal(splitForNotes(none).join(' ').split(' ').length, 3000)
assert.deepEqual(splitForNotes(''), [])
assert.equal(sentencesOf('One. Two? Three!').length, 3)

assert.equal(parseNotes('not json'), null)
assert.equal(parseNotes('{"v":1,"sections":[]}'), null)
const n = parseNotes(JSON.stringify({ v: 1, by: 'device', sections: [{ heading: 'A', points: ['- The essay is two thousand words long.', 'There were 99 people involved here.'] }, { heading: 'a', points: ['Patient K F was studied by Shallice.'] }] }))!
const g = groundedNotes(n, T)
assert.equal(g.length, 1, 'same heading in a row is joined')
assert.equal(g[0].points.length, 2, 'ungrounded point dropped')
console.log('lecture notes: all checks passed')

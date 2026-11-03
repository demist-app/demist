// Builds public/vocab-levels.json, the word-commonness table behind the
// vocabulary cards for people who said English isn't their first language
// (lib/vocabulary.ts).
//   cd web && node scripts/build-vocab-levels.mjs
//
// Source: SCOWL via the wordlist-english package. SCOWL sorts words into
// levels by how commonly English speakers use them: 10 is the most common,
// 70 the most obscure. Level 70 is left out (mostly archaic or bizarre
// spellings that a mis-hearing could land on), as are capitalised entries
// (names) and anything with characters other than letters, hyphens and
// apostrophes. A word's level is the lowest one it appears at in any
// dialect, so "colour" and "color" both count as common.
//
// The SCOWL licence requires its copyright notice to travel with the data:
// public/vocab-levels-LICENSE.txt is copied from the package's Copyright file.
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pkg = dirname(require.resolve('wordlist-english/package.json'))
const LEVELS = [10, 20, 35, 40, 50, 55, 60]
const DIALECTS = ['english', 'american', 'british', 'canadian']

const level = new Map()
for (const l of LEVELS) for (const d of DIALECTS) {
  for (const w of JSON.parse(readFileSync(join(pkg, `${d}-words-${l}.json`), 'utf8'))) {
    if (/[^a-z'-]/i.test(w) || /^[A-Z]/.test(w)) continue
    const k = w.toLowerCase()
    if (!level.has(k)) level.set(k, l)
  }
}
const byLevel = {}
for (const [w, l] of level) (byLevel[l] ??= []).push(w)
// One space-separated string per level: about a third the size of a word->level map.
const out = Object.fromEntries(LEVELS.map(l => [l, byLevel[l].sort().join(' ')]))
writeFileSync('public/vocab-levels.json', JSON.stringify(out))
copyFileSync(join(pkg, 'Copyright'), 'public/vocab-levels-LICENSE.txt')
console.log(LEVELS.map(l => `${l}:${byLevel[l].length}`).join(' '), `total ${level.size}`)

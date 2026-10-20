// Runs the desktop precision excerpts through the web's candidate extractor and
// writes what it proposes to desktop/test/fixtures/precision-candidates.json,
// so the desktop's candidates-first path (llm.defineCandidates) is tested on
// exactly what the renderer will send it. Re-run after changing extractTerms.
//   cd web && JITI_ALIAS='{"@/": "<abs web path>/"}' node_modules/.bin/jiti scripts/make-desktop-candidates.ts
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extractCandidates } from '../lib/extractTerms'
const require = createRequire(import.meta.url)
const sets = require('../../desktop/test/fixtures/precision-sets.js') as Record<string, string[][]>
const split = (t: string) => t.split(/(?<=[.!?])\s+/).filter(s => s.trim())
const out: Record<string, unknown[]> = {}
for (const [name, rows] of Object.entries(sets)) {
  out[name] = rows.map(([label, text, subject, bad]) => {
    const sent = new Set<string>()
    return { label, text, subject: subject ?? null, bad: bad ?? null, candidates: split(text).flatMap(s => extractCandidates(s, new Set(), sent)) }
  })
}
writeFileSync('../desktop/test/fixtures/precision-candidates.json', JSON.stringify(out, null, 1) + '\n')
for (const [name, rows] of Object.entries(out)) for (const r of rows as { label: string; candidates: { term: string }[] }[]) console.log(name.padEnd(9), r.label.padEnd(11), JSON.stringify(r.candidates.map(c => c.term)))

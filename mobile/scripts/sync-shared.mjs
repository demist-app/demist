// Copies the web app's pure term and account rules into lib/shared, so the
// phone filters terms, dedupes them and decides Pro exactly as the web does.
// Two hand-kept copies of a rule have drifted apart twice in this codebase
// already (see web/lib/entitlementRules.ts), so these are generated, never
// edited here.
//
//   npm run sync-shared          rewrite lib/shared from web/lib
//   npm run sync-shared -- --check   exit 1 if lib/shared is out of date
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const webLib = join(here, '..', '..', 'web', 'lib')
const out = join(here, '..', 'lib', 'shared')

// Only modules with no React, no DOM and no imports outside this list.
const FILES = ['termQuality.ts', 'termSimilarity.ts', 'extractTerms.ts', 'entitlementRules.ts', 'age.ts']

const check = process.argv.includes('--check')
let stale = 0
mkdirSync(out, { recursive: true })
for (const f of FILES) {
  const src = readFileSync(join(webLib, f), 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/^'use client'\r?\n/m, '')
    .replace(/from '@\/lib\/([\w-]+)'/g, "from './$1'")
  const body = `// GENERATED from web/lib/${f} by scripts/sync-shared.mjs. Do not edit here.\n${src}`
  const dest = join(out, f)
  const current = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
  if (current === body) continue
  stale++
  if (check) console.error(`out of date: lib/shared/${f}`)
  else { writeFileSync(dest, body); console.log(`synced lib/shared/${f}`) }
}
if (check && stale) process.exit(1)
if (!stale) console.log('lib/shared is up to date')

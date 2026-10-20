// Live check: candidates from the extractor -> the deployed detect-terms ->
// the client's own quality gates, as the store demo account (internal, so it
// stays out of analytics). Costs a fraction of a cent per run.
//   cd web && JITI_ALIAS='{"@/": "<abs path to web>/"}' node_modules/.bin/jiti scripts/test-term-candidates-live.ts [lang]
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { extractCandidates } from '../lib/extractTerms'
import { isLikelyJargon, isConfidentDefinition } from '../lib/termQuality'
import type { LectureLanguage } from '../lib/lectureLanguage'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]))
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const anon = createClient(URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })

const SETS: Record<string, { subject: string; lang: LectureLanguage; text: string[] }[]> = {
  en: [
    { subject: 'Biology', lang: 'en', text: ['The proton motive force drives ATP synthase across the inner membrane.', 'Calcium is stored in the sarcoplasmic reticulum of each muscle fibre.', 'Blood flows back through the tricuspid valve into the right ventricle.'] },
    { subject: 'Economics', lang: 'en', text: ['A Giffen good exists because the income effect outweighs the substitution effect.'] },
    { subject: 'Law', lang: 'en', text: ['Congress used the commerce clause to pass laws regulating trade between states.', 'The reservation system was enforced by federal indian law for decades.'] },
    { subject: 'Biology', lang: 'en', text: ['It had a big effect on everyone in the room, honestly.', 'Remember the test is next week, so revise the whole thing.'] },
  ],
  fr: [
    { subject: 'cours de droit', lang: 'fr', text: ["Mais précontractuelle, ce qu'on entend par précontractuelle, c'est la période des pourparlers avant la signature du contrat.", "Les personnes concernées doivent respecter l'obligation d'information pendant les négociations."] },
  ],
  nl: [
    { subject: 'farmaceutische zorg', lang: 'nl', text: ['Je moet de dosering aanpassen aan het lichaamsgewicht van de patiënt voordat het geneesmiddel wordt afgeleverd.', 'Dat wordt veroorzaakt door de farmacokinetiek van het middel.'] },
  ],
}

const which = process.argv[2] ?? 'en'
const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: 'store-demo@demist.app' })
if (!link?.properties) throw new Error("could not mint a demo session")
const { data: auth, error } = await anon.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'magiclink' })
if (error || !auth.session) throw error
for (const set of SETS[which]) {
  const sent = new Set<string>()
  const candidates = set.text.flatMap(s => extractCandidates(s, new Set(), sent, set.lang))
  const res = await fetch(`${URL}/functions/v1/detect-terms`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth.session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidates, context: '', subject: set.subject, year: 2, known_terms: [], lecture_language: set.lang }),
  })
  const body = await res.json()
  const src = set.text.join(' ')
  const kept = (body.terms ?? []).filter((t: { term: string; definition: string }) => isLikelyJargon(t.term) && isConfidentDefinition(t.term, t.definition, src))
  console.log(`\n[${set.subject}] sent: ${JSON.stringify(candidates.map(c => c.term))}`)
  for (const t of kept) console.log(`   KEPT ${t.term}: ${String(t.definition).slice(0, 90)}`)
}
await anon.auth.signOut()

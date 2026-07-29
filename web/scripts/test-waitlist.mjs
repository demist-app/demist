// Verifies the Pro waitlist can be joined by someone with NO account, and -
// just as important - that the same public grant cannot be used to read the
// list back out or to write a row attributed to somebody else.
//
// Inserts ONE row using a reserved .invalid address so it can never collide
// with a real signup and is obvious in the table. anon has no DELETE by
// design, so that row has to be removed by hand; the script prints the SQL.
//
//   node scripts/test-waitlist.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

// A DIFFERENT client per identity: the logged-out one must never be given a
// session, or it stops testing the anon role.
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`)
  else { failures++; console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`) }
}

const stamp = Date.now()
const testEmail = `demist-selftest+${stamp}@example.invalid`

console.log('logged out (anon role) — the landing page case\n')

// 1. The thing the button does.
const { error: insErr } = await anon.from('pro_waitlist').insert({ email: testEmail, source: 'landing' })
check('a logged-out visitor can join', !insErr, insErr ? `-> ${insErr.code} ${insErr.message}` : '')

// 2. Same email again must be rejected, and the UI treats that as success.
const { error: dupErr } = await anon.from('pro_waitlist').insert({ email: testEmail, source: 'landing' })
check('a duplicate is rejected as unique_violation', dupErr?.code === '23505',
  `-> ${dupErr?.code ?? 'no error at all'}`)

// 3. Case-insensitive, because Foo@x and foo@x are one person.
const { error: caseErr } = await anon.from('pro_waitlist').insert({ email: testEmail.toUpperCase(), source: 'landing' })
check('dedupe is case-insensitive', caseErr?.code === '23505', `-> ${caseErr?.code ?? 'inserted a second row'}`)

// 4. The list must NOT be readable with the public key. This is the property
//    that stops a public INSERT grant from being an email harvester.
const { data: rows, error: selErr } = await anon.from('pro_waitlist').select('email')
check('the list cannot be read back out', (rows ?? []).length === 0,
  selErr ? `-> blocked (${selErr.code})` : `-> returned ${(rows ?? []).length} row(s)`)

// 5. The public policy must not let anyone attribute a row to another account.
const { error: forgeErr } = await anon.from('pro_waitlist')
  .insert({ email: `forge+${stamp}@example.invalid`, user_id: '00000000-0000-0000-0000-000000000001' })
check('cannot write a row attributed to someone else', !!forgeErr,
  forgeErr ? `-> blocked (${forgeErr.code})` : '-> IT WAS ALLOWED')

// 6. A signed-in user must still be able to manage their own row, which is
//    what PaywallModal relies on ("you're already on the list").
console.log('\nsigned in — the PaywallModal case')
const authed = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const { data: auth } = await authed.auth.signInAnonymously()
const uid = auth?.user?.id
const { error: ownErr } = await authed.from('pro_waitlist')
  .insert({ email: `member+${stamp}@example.invalid`, source: 'test', user_id: uid })
check('a signed-in user can join with their own user_id', !ownErr, ownErr ? `-> ${ownErr.code} ${ownErr.message}` : '')
const { data: own } = await authed.from('pro_waitlist').select('id').maybeSingle()
check('and can read their own row back', !!own, own ? '' : '-> PaywallModal could not show "already joined"')
// This one cleans itself up: the row is owned, so the FOR ALL policy covers it.
await authed.from('pro_waitlist').delete().eq('user_id', uid)
await authed.rpc('delete_user_data')

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
console.log(`\nOne test row remains (anon has no DELETE, by design). Remove it with:`)
console.log(`  delete from pro_waitlist where email like 'demist-selftest+%@example.invalid';`)
process.exit(failures ? 1 : 0)

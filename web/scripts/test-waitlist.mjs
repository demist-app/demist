// Verifies the Pro waitlist's double opt-in at the database layer: that the
// public key can no longer write to the list at all, that neither of the new
// RPCs is reachable without the service role, and that the confirm flow does
// the right thing when a link is replayed, expired, or forged.
//
// Deliberately does NOT send email - it calls waitlist_join/waitlist_verify
// directly with the service role, the way /api/waitlist/join does, and hashes
// its own tokens the same way. So it can be run against production without
// mailing anybody. What it cannot cover is Resend itself; the first real send
// is the test for that.
//
// Run this straight after applying migration 026 and before the backfill.
//
//   node scripts/test-waitlist.mjs
//
// Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY in web/.env.local.
import { readFileSync } from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!env[k]) { console.error(`missing ${k} in web/.env.local`); process.exit(1) }
}

// A different client per identity. The public one must never be handed a
// session or it stops testing the anon role.
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`)
  else { failures++; console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`) }
}

const hash = t => createHash('sha256').update(t).digest('hex')
const mkToken = () => randomBytes(32).toString('base64url')
const stamp = Date.now()
// .invalid is reserved by RFC 2606: these can never collide with a real signup
// and can never accidentally be delivered to anyone.
const email = `demist-selftest+${stamp}@example.invalid`
const expires = new Date(Date.now() + 7 * 86400_000).toISOString()

console.log('the public key must have no way in\n')

// 1. The old landing-page write. Migration 026 revoked this grant; if it still
//    works, rows can be created that no email was ever sent for and that can
//    therefore never be confirmed.
const { error: insErr } = await anon.from('pro_waitlist').insert({ email: `anon+${stamp}@example.invalid`, source: 'test' })
check('anon can no longer INSERT directly', !!insErr, insErr ? `-> blocked (${insErr.code})` : '-> IT WAS ALLOWED')

// 2. Still not an email harvester.
const { data: rows } = await anon.from('pro_waitlist').select('email')
check('anon cannot read the list', (rows ?? []).length === 0, `-> returned ${(rows ?? []).length} row(s)`)

// 3. The RPCs are the write path now, so they are the thing that has to be
//    shut to the public - a callable waitlist_verify would let anyone confirm
//    by brute force, and a callable waitlist_join is a free mail cannon.
const { error: joinRpcErr } = await anon.rpc('waitlist_join', {
  p_email: `rpc+${stamp}@example.invalid`, p_source: 'test', p_token_hash: hash('x'), p_expires_at: expires,
})
check('anon cannot call waitlist_join', !!joinRpcErr, joinRpcErr ? `-> blocked (${joinRpcErr.code})` : '-> IT WAS ALLOWED')

const { error: verifyRpcErr } = await anon.rpc('waitlist_verify', { p_token_hash: hash('x') })
check('anon cannot call waitlist_verify', !!verifyRpcErr, verifyRpcErr ? `-> blocked (${verifyRpcErr.code})` : '-> IT WAS ALLOWED')

console.log('\njoining (service role, as the endpoint does)')

// 4. A new address gets a token issued.
const token = mkToken()
const { data: first, error: e1 } = await admin.rpc('waitlist_join', {
  p_email: email, p_source: 'test', p_token_hash: hash(token), p_expires_at: expires,
})
check('a new address is accepted', first === 'send', e1 ? `-> ${e1.message}` : `-> ${first}`)

// 5. The cooldown. Without this the endpoint delivers one email per request to
//    any address anyone types, as fast as they can type it.
const { data: second } = await admin.rpc('waitlist_join', {
  p_email: email, p_source: 'test', p_token_hash: hash(mkToken()), p_expires_at: expires,
})
check('an immediate second request is throttled', second === 'throttled', `-> ${second}`)

// 6. Same person, different capitalisation.
const { data: cased } = await admin.rpc('waitlist_join', {
  p_email: email.toUpperCase(), p_source: 'test', p_token_hash: hash(mkToken()), p_expires_at: expires,
})
check('dedupe is case-insensitive', cased === 'throttled', `-> ${cased}`)

console.log('\nconfirming')

// 7. A guessed token confirms nothing.
const { data: bogus } = await admin.rpc('waitlist_verify', { p_token_hash: hash(mkToken()) })
check('an unknown token is invalid', bogus?.[0]?.status === 'invalid', `-> ${bogus?.[0]?.status}`)

// 8. The stored value is the HASH. Presenting it as though it were the token
//    must not work, or a read of the table becomes the ability to confirm as
//    anyone in it.
const { data: rehashed } = await admin.rpc('waitlist_verify', { p_token_hash: hash(hash(token)) })
check('the stored hash is not itself a usable token', rehashed?.[0]?.status === 'invalid', `-> ${rehashed?.[0]?.status}`)

// 9. The real thing.
const { data: ok } = await admin.rpc('waitlist_verify', { p_token_hash: hash(token) })
check('the real token verifies', ok?.[0]?.status === 'verified', `-> ${ok?.[0]?.status}`)
check('and claims the welcome email', ok?.[0]?.should_welcome === true, `-> should_welcome ${ok?.[0]?.should_welcome}`)

// 10. The one that matters most. Mail scanners fetch every link before the
//     human clicks it, so this runs twice for a large share of recipients -
//     and must not produce two welcome emails.
const { data: again } = await admin.rpc('waitlist_verify', { p_token_hash: hash(token) })
check('a replayed link does not re-send the welcome', again?.[0]?.should_welcome === false,
  `-> status ${again?.[0]?.status}, should_welcome ${again?.[0]?.should_welcome}`)

// 11. Confirmed people must not be asked to confirm again.
const { data: post } = await admin.rpc('waitlist_join', {
  p_email: email, p_source: 'test', p_token_hash: hash(mkToken()), p_expires_at: expires,
})
check('a verified address is not re-mailed', post === 'already_verified', `-> ${post}`)

// 12. Failed welcome sends release their claim so a later click retries.
await admin.rpc('waitlist_unclaim_welcome', { p_email: email })
const { data: retry } = await admin.rpc('waitlist_verify', { p_token_hash: hash(token) })
check('an unclaimed welcome is retried on the next click', retry?.[0]?.should_welcome === true,
  `-> should_welcome ${retry?.[0]?.should_welcome}`)

console.log('\nexpiry')

// 13. An expired link is expired - and says so, rather than silently failing
//     as "invalid", which would send someone hunting for a broken link.
const oldEmail = `demist-selftest-old+${stamp}@example.invalid`
const oldToken = mkToken()
await admin.rpc('waitlist_join', {
  p_email: oldEmail, p_source: 'test', p_token_hash: hash(oldToken),
  p_expires_at: new Date(Date.now() - 60_000).toISOString(),
})
const { data: exp } = await admin.rpc('waitlist_verify', { p_token_hash: hash(oldToken) })
check('an expired token reports as expired', exp?.[0]?.status === 'expired', `-> ${exp?.[0]?.status}`)

// Service role owns these rows, so this cleans up after itself completely.
await admin.from('pro_waitlist').delete().like('email', 'demist-selftest%@example.invalid')

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)

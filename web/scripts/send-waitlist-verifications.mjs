// Sends the confirmation email to everyone who joined the Pro waitlist before
// double opt-in existed.
//
// Those rows were created by a direct client-side INSERT: someone typed an
// address into the landing page and nothing ever checked that it was theirs.
// So they are treated as unconfirmed and asked to confirm, rather than being
// marked verified and mailed as if they had. Anyone who ignores this drops off
// the list, which is the correct outcome - the alternative is broadcasting to
// addresses that were never proven, from a domain with no sending history, and
// finding out about the typos and the honeypots by way of a spam reputation
// that cannot be undone.
//
// It does NOT talk to Resend directly. It posts to the live /api/waitlist/join
// endpoint with the admin key, so every address goes through the identical
// path a real visitor gets - same token, same template, same RPC. There is no
// second implementation here to fall out of sync.
//
//   node scripts/send-waitlist-verifications.mjs             # dry run
//   node scripts/send-waitlist-verifications.mjs --send      # actually send
//   node scripts/send-waitlist-verifications.mjs --send --resend
//         also re-mails people who were sent a link before and never clicked
//
// Safe to re-run. By default it only picks up rows that have never been sent
// anything, so an interrupted run resumes exactly where it stopped.
//
// Needs in web/.env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WAITLIST_ADMIN_KEY
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const args = new Set(process.argv.slice(2))
const SEND = args.has('--send')
const RESEND_UNCLICKED = args.has('--resend')
const TARGET = env.NEXT_PUBLIC_APP_URL || 'https://demist.app'

// Resend's free tier allows 2 requests/second. One send per 700ms leaves room
// and finishes a list of a few hundred in a couple of minutes, which is not
// worth optimising.
const GAP_MS = 700

for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'WAITLIST_ADMIN_KEY']) {
  if (!env[k]) { console.error(`missing ${k} in web/.env.local`); process.exit(1) }
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

let q = sb
  .from('pro_waitlist')
  .select('id, email, source, created_at, token_sent_at, verify_sends')
  .is('verified_at', null)
  .order('created_at', { ascending: true })

// The default is the resumable one: never-sent only. --resend widens it to
// everyone still unconfirmed, which is a reminder, and should be a decision
// somebody makes on purpose rather than a side effect of running this twice.
if (!RESEND_UNCLICKED) q = q.is('token_sent_at', null)

const { data: allRows, error } = await q
if (error) {
  console.error('could not read the waitlist:', error.message)
  if (error.message.includes('permission denied')) {
    console.error('-> service_role has no SELECT on pro_waitlist. Run migration 027.')
  }
  process.exit(1)
}

// RFC 2606/6761 reserve these; they can never receive mail, so every send is a
// guaranteed hard bounce. Test rows have reached production once already (the
// first test-waitlist.mjs run could not delete its own), and a bounce rate on a
// domain with no sending history is worth more care than this check costs.
const RESERVED = /@([^@]*\.)?(invalid|test|example|localhost)$/i
const rows = allRows.filter(r => !RESERVED.test(r.email))
const excluded = allRows.length - rows.length
if (excluded) console.log(`excluded      ${excluded} reserved/test address(es) that could only bounce\n`)

console.log(`target        ${TARGET}`)
console.log(`unconfirmed   ${rows.length} row(s)${RESEND_UNCLICKED ? ' (including previously-mailed)' : ' never mailed'}`)
console.log(`mode          ${SEND ? 'SENDING' : 'dry run - nothing will be sent'}\n`)

if (!rows.length) { console.log('nothing to do.'); process.exit(0) }

if (!SEND) {
  for (const r of rows.slice(0, 20)) {
    console.log(`  would send  ${r.email}  (joined ${r.created_at.slice(0, 10)}, ${r.verify_sends ?? 0} prior send(s))`)
  }
  if (rows.length > 20) console.log(`  ...and ${rows.length - 20} more`)
  console.log('\nre-run with --send to actually send.')
  process.exit(0)
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
let sent = 0, skipped = 0, failed = 0

for (const [i, row] of rows.entries()) {
  const label = `[${i + 1}/${rows.length}] ${row.email}`
  try {
    const res = await fetch(`${TARGET}/api/waitlist/join`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-waitlist-admin-key': env.WAITLIST_ADMIN_KEY,
      },
      body: JSON.stringify({ email: row.email, source: row.source || 'backfill' }),
    })
    const body = await res.json().catch(() => ({}))

    if (res.ok && body.status === 'sent') { sent++; console.log(`  ok      ${label}`) }
    else if (res.ok) { skipped++; console.log(`  skip    ${label}  -> ${body.status}`) }
    else if (res.status === 400) {
      // An address that cannot be valid was typed in by hand and never checked.
      // Nothing to do about it here; it is listed so it can be deleted.
      failed++; console.log(`  BAD     ${label}  -> rejected as invalid, delete this row`)
    }
    else { failed++; console.log(`  FAIL    ${label}  -> ${res.status} ${body.error ?? ''}`) }
  } catch (e) {
    failed++
    console.log(`  FAIL    ${label}  -> ${e.message}`)
  }
  if (i < rows.length - 1) await sleep(GAP_MS)
}

console.log(`\nsent ${sent}   skipped ${skipped}   failed ${failed}`)
if (failed) console.log('re-run the same command to retry only what did not go out.')
process.exit(failed ? 1 : 0)

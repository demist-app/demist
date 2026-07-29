// Does an account with no email actually work end to end against the real
// project? This is the question the desktop app's "Start without an account"
// button depends on, and it has three parts that can each fail separately:
//
//   1. anonymous sign-ins enabled for the project (a dashboard setting)
//   2. the on_auth_user_created trigger giving that user a profiles row
//   3. RLS letting that user read and write its OWN rows via auth.uid()
//
// Reads the anon key from web/.env.local. Creates one throwaway anonymous
// user and deletes its data again through the app's own delete_user_data RPC,
// so it leaves nothing behind but an empty auth row.
//
//   node scripts/test-anon-auth.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`)
  else { failures++; console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`) }
}

console.log(`project: ${env.NEXT_PUBLIC_SUPABASE_URL}\n`)

// 1. Anonymous sign-in
const { data: auth, error: authErr } = await supabase.auth.signInAnonymously()
check('signInAnonymously succeeds', !authErr && !!auth?.session, authErr ? `-> ${authErr.message}` : '')
if (authErr || !auth?.session) {
  console.log('\nAnonymous sign-ins are almost certainly still disabled for this project.')
  console.log('Supabase dashboard -> Authentication -> Sign In / Providers -> Allow anonymous sign-ins.')
  process.exit(1)
}
const user = auth.user
check('user has no email', !user.email, `id ${user.id.slice(0, 8)}…`)
check('user is flagged is_anonymous', user.is_anonymous === true,
  `is_anonymous=${user.is_anonymous} (the Settings "back up your account" prompt keys off this)`)

// 2. The trigger gave it a profiles row
const { data: prof, error: profErr } = await supabase
  .from('profiles').select('id').eq('id', user.id).maybeSingle()
check('on_auth_user_created created a profiles row', !profErr && prof?.id === user.id,
  profErr ? `-> ${profErr.message}` : '')

// 3. RLS: it can write and read its own rows, exactly as /onboarding does
const { error: upsertErr } = await supabase.from('profiles')
  .upsert({ id: user.id, course: 'Test Course', year_of_study: 2, ai_disclaimer_ack_at: new Date().toISOString() })
check('can save its profile (what /onboarding does)', !upsertErr, upsertErr ? `-> ${upsertErr.message}` : '')

const { data: sess, error: sessErr } = await supabase.from('sessions')
  .insert({ user_id: user.id, started_at: new Date().toISOString() }).select().maybeSingle()
check('can create a session row', !sessErr && !!sess, sessErr ? `-> ${sessErr.message}` : '')

if (sess) {
  const { error: termErr } = await supabase.from('terms').insert({
    user_id: user.id, session_id: sess.id, term: 'chemiosmosis',
    definition: 'A test row written by scripts/test-anon-auth.mjs.',
  })
  check('can create a term row (flashcards/glossary depend on this)', !termErr,
    termErr ? `-> ${termErr.message}` : '')
}

// 4. It must NOT be able to see anyone else's rows.
const { data: others } = await supabase.from('profiles').select('id').neq('id', user.id).limit(1)
check('RLS still hides other users\' profiles', (others ?? []).length === 0,
  `saw ${(others ?? []).length} foreign row(s)`)

// Clean up through the app's own path.
const { error: delErr } = await supabase.rpc('delete_user_data')
check('delete_user_data works for an anonymous user', !delErr, delErr ? `-> ${delErr.message}` : '')

console.log(failures ? `\n${failures} FAILED` : '\nall passed - a no-email account works end to end')
process.exit(failures ? 1 : 0)

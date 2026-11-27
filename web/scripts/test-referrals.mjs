// End-to-end check of referrals (migration 045) on the live database, with two
// throwaway internal accounts that are deleted afterwards. No emails are sent.
//   cd web && node scripts/test-referrals.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]))
const URL = env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const DAY = 86_400_000
let failures = 0
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) failures++ }

async function makeUser(tag) {
  const email = `referral-test-${tag}-${randomUUID().slice(0, 8)}@demist.app`
  const password = randomUUID()
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  await admin.from('profiles').update({ is_internal: true }).eq('id', data.user.id)
  const client = createClient(URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error: e2 } = await client.auth.signInWithPassword({ email, password })
  if (e2) throw e2
  return { id: data.user.id, created: new Date(data.user.created_at), client }
}
const sub = async (id) => (await admin.from('subscriptions').select('plan, current_period_end, stripe_subscription_id').eq('user_id', id).single()).data

const users = []
try {
  const a = await makeUser('a'); users.push(a)
  const b = await makeUser('b'); users.push(b)

  const { data: code, error: codeErr } = await a.client.rpc('my_referral_code')
  check(!codeErr && /^[a-z0-9]{8}$/.test(code), `inviter gets a code (${code ?? codeErr?.message})`)
  const { data: again } = await a.client.rpc('my_referral_code')
  check(again === code, 'asking again returns the same code')

  check((await a.client.rpc('claim_referral', { p_code: code })).data === 'own_code', 'own code is refused')
  check((await b.client.rpc('claim_referral', { p_code: 'zzzzzzzz' })).data === 'unknown_code', 'unknown code is refused')

  const claim = await b.client.rpc('claim_referral', { p_code: code })
  check(claim.data === 'ok', `friend claims (${claim.data ?? claim.error?.message})`)
  const bSub = await sub(b.id)
  const bDays = (new Date(bSub.current_period_end) - b.created) / DAY
  check(bSub.plan === 'pro' && bDays > 29.9 && bDays < 30.1, `friend has Pro for 30 days (${bDays.toFixed(2)})`)
  check((await b.client.rpc('claim_referral', { p_code: code })).data === 'already', 'second claim is refused')

  const { data: before } = await a.client.from('referrals').select('rewarded_at')
  check(before?.length === 1 && !before[0].rewarded_at, 'inviter sees 1 friend, not yet rewarded')

  // A 5-minute session must not reward; an 11-minute one must.
  const short = await admin.from('sessions').insert({ user_id: b.id, started_at: new Date(Date.now() - 5 * 60_000).toISOString() }).select('id').single()
  await admin.from('sessions').update({ ended_at: new Date().toISOString() }).eq('id', short.data.id)
  check(!(await admin.from('referrals').select('rewarded_at').eq('referred_id', b.id).single()).data.rewarded_at, 'a 5-minute lecture does not reward')

  const long = await admin.from('sessions').insert({ user_id: b.id, started_at: new Date(Date.now() - 11 * 60_000).toISOString() }).select('id').single()
  await admin.from('sessions').update({ ended_at: new Date().toISOString() }).eq('id', long.data.id)
  const aSub = await sub(a.id)
  const aDays = (new Date(aSub.current_period_end) - Date.now()) / DAY
  // Inviter is a new account: 14-day trial left, plus the 30-day reward.
  check(aSub.plan === 'pro' && aDays > 43.5 && aDays < 44.1, `inviter gets 30 days on top of their trial (${aDays.toFixed(2)} days left)`)
  const { data: after } = await a.client.from('referrals').select('rewarded_at, reward_note')
  check(after?.[0]?.rewarded_at && !after[0].reward_note, 'reward recorded once')

  const third = await admin.from('sessions').insert({ user_id: b.id, started_at: new Date(Date.now() - 20 * 60_000).toISOString() }).select('id').single()
  await admin.from('sessions').update({ ended_at: new Date().toISOString() }).eq('id', third.data.id)
  const aSub2 = await sub(a.id)
  check(aSub2.current_period_end === aSub.current_period_end, 'a second long lecture does not reward again')

  const { data: others } = await b.client.from('referrals').select('referrer_id')
  check((others?.length ?? 0) === 0, 'the friend cannot read the inviter\'s referral rows')
} catch (e) {
  console.error('ERROR', e.message ?? e); failures++
} finally {
  for (const u of users) {
    await admin.from('sessions').delete().eq('user_id', u.id)
    await admin.auth.admin.deleteUser(u.id)
  }
  console.log(`cleaned up ${users.length} test accounts`)
}
console.log(failures ? `${failures} FAILED` : 'ALL PASSED')
process.exit(failures ? 1 : 0)

// Gives the store demo account (store-demo@demist.app) a password, for Apple
// App Review. Reviewers cannot receive the emailed sign-in code, so the iOS
// login screen switches to a password field for this one address only
// (mobile/app/login.tsx, REVIEW_EMAIL). Put the same password in App Store
// Connect > App Review Information > Sign-in required.
//
//   cd web && node scripts/set-review-password.mjs "a-long-random-password"
//
// Run seed-store-demo.mjs first if the account does not exist yet. Safe to
// run again to change the password.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const EMAIL = 'store-demo@demist.app'
const password = process.argv[2]
if (!password || password.length < 12) {
  console.error('Pass a password of at least 12 characters: node scripts/set-review-password.mjs "<password>"')
  process.exit(1)
}

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]))
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
if (listErr) throw listErr
const user = list.users.find(u => u.email === EMAIL)
if (!user) { console.error(`${EMAIL} does not exist. Run scripts/seed-store-demo.mjs first.`); process.exit(1) }

const { error } = await admin.auth.admin.updateUserById(user.id, { password })
if (error) throw error

// The iOS app asks for a date of birth (16+) before anything else. Give the
// demo account one so the reviewer lands straight on the app.
const { error: profErr } = await admin.from('profiles').update({ date_of_birth: '2004-03-14' }).eq('id', user.id).is('date_of_birth', null)
if (profErr) console.warn('could not set the demo date of birth:', profErr.message)

// Check it actually works, the way the app will sign in.
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const { error: signErr } = await anon.auth.signInWithPassword({ email: EMAIL, password })
if (signErr) { console.error('Password set, but signing in with it failed:', signErr.message); process.exit(1) }
await anon.auth.signOut()
console.log(`Done. ${EMAIL} can sign in with that password. Add it to App Store Connect > App Review Information.`)

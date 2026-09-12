// One-time send: "Demist Pro is here", to everyone who was promised this
// exact email (the verified Pro waitlist - see welcomeEmail() in lib/email.ts,
// "we'll email you once, when Pro is ready") plus everyone with a Demist
// account, since a launch of a feature inside the app people already use is
// closer to a product update than to marketing.
//
// Does not import lib/email.ts's proLaunchedEmail() directly - that file is
// TypeScript with no build step in front of this plain script, so the HTML
// below is a deliberate, one-time duplicate of that template rather than
// wiring up a transpiler for a script that runs exactly once. If this ever
// needs to run again, keep both in sync by hand or migrate this to a route.
//
//   node scripts/send-pro-launch.mjs             # dry run
//   node scripts/send-pro-launch.mjs --send      # actually send
//
// Needs in web/.env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// RESEND_API_KEY is read from the environment instead (not committed to
// .env.local), since this script is meant to be run once and thrown away:
//   RESEND_API_KEY=re_... node scripts/send-pro-launch.mjs --send
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const SEND = process.argv.includes('--send')
const APP_URL = env.NEXT_PUBLIC_APP_URL || 'https://demist.app'
const RESEND_KEY = process.env.RESEND_API_KEY
const GAP_MS = 700 // Resend free tier: 2 req/s

for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!env[k]) { console.error(`missing ${k} in web/.env.local`); process.exit(1) }
}
if (SEND && !RESEND_KEY) { console.error('missing RESEND_API_KEY in the environment'); process.exit(1) }

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Same reservation as send-waitlist-verifications.mjs: these can never
// receive mail, every send is a guaranteed hard bounce.
const RESERVED = /@([^@]*\.)?(invalid|test|example|localhost)$/i

const [{ data: waitlistRows, error: wErr }, { data: userRows, error: uErr }] = await Promise.all([
  sb.from('pro_waitlist').select('email').not('verified_at', 'is', null),
  sb.auth.admin.listUsers({ perPage: 1000 }),
])
if (wErr) { console.error('could not read pro_waitlist:', wErr.message); process.exit(1) }
if (uErr) { console.error('could not list users:', uErr.message); process.exit(1) }

const waitlistEmails = new Set((waitlistRows ?? []).map(r => r.email.toLowerCase()))
const userEmails = new Set(
  userRows.users
    .filter(u => !u.is_anonymous && u.email)
    .map(u => u.email.toLowerCase()),
)

const recipients = new Map() // email -> { onWaitlist }
for (const email of waitlistEmails) recipients.set(email, { onWaitlist: true })
for (const email of userEmails) if (!recipients.has(email)) recipients.set(email, { onWaitlist: false })

const skipped = []
for (const email of [...recipients.keys()]) {
  if (RESERVED.test(email)) { skipped.push(email); recipients.delete(email) }
}

// Real price, not a hardcoded figure - this function is public, no auth
// needed, same as the modal's own fetch.
let priceText = null
try {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/stripe-prices`, {
    headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` },
  })
  const data = await res.json()
  if (data?.month?.unitAmount) {
    priceText = new Intl.NumberFormat('en-US', { style: 'currency', currency: data.month.currency, minimumFractionDigits: 2 })
      .format(data.month.unitAmount / 100)
  }
} catch { /* email still works without the price line */ }

console.log(`${SEND ? 'SENDING' : 'DRY RUN'} - ${recipients.size} recipients (${[...recipients.values()].filter(r => r.onWaitlist).length} waitlist, ${[...recipients.values()].filter(r => !r.onWaitlist).length} other users), ${skipped.length} skipped (reserved domain)`)
if (skipped.length) console.log('skipped:', skipped.join(', '))
console.log(`price line: ${priceText ? `${priceText}/month` : '(none - stripe-prices unreachable)'}`)
console.log('')

const ACCENT = '#A16207', INK = '#0F0F14', MUTED = '#5B5B63', FAINT = '#8A8A92', PAGE_BG = '#EDEAE3', CARD_BG = '#FAF9F6', BORDER = '#DCD8CF'

function buildEmail(onWaitlist) {
  const priceLine = priceText ? ` Plans start at ${priceText}/month.` : ''
  const bodyHtml = onWaitlist
    ? 'You were on the waitlist, so your free month of Pro is already active on your account &mdash; nothing to do, nothing to pay yet.'
    : `Unlimited session history, unlimited AI summaries, and Anki export.${priceLine} Everything you already use stays free, same as always.`
  const bodyText = onWaitlist
    ? 'You were on the waitlist, so your free month of Pro is already active on your account - nothing to do, nothing to pay yet.'
    : `Unlimited session history, unlimited AI summaries, and Anki export.${priceLine} Everything you already use stays free, same as always.`
  const cta = onWaitlist ? 'See your Pro account' : 'Upgrade to Pro'
  const preheader = onWaitlist ? 'Your free month is already active.' : 'Unlimited history, summaries, and Anki export.'

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Demist</title></head>
<body style="margin:0;padding:0;background:${PAGE_BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:${CARD_BG};border:1px solid ${BORDER};border-radius:16px;">
<tr><td style="padding:32px 32px 36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<p style="margin:0 0 28px 0;font-size:12px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${ACCENT};">Demist</p>
<h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:700;color:${INK};">Demist Pro is live</h1>
<p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:${MUTED};">${bodyHtml}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
<tr><td style="border-radius:12px;background:${ACCENT};">
<a href="${APP_URL}/profile" style="display:inline-block;padding:13px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${cta}</a>
</td></tr></table>
<p style="margin:0;font-size:13px;line-height:1.65;color:${FAINT};">This is the one email we said we&rsquo;d send. No newsletter, no drip campaign.</p>
</td></tr></table>
<p style="max-width:480px;margin:20px auto 0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${FAINT};text-align:center;">
<a href="${APP_URL}" style="color:${FAINT};text-decoration:underline;">demist.app</a>
</p>
</td></tr></table>
</body></html>`

  const text = ['Demist Pro is live', '', bodyText, '', `${APP_URL}/profile`, '', 'This is the one email we said we’d send. No newsletter, no drip campaign.'].join('\n')
  return { subject: 'Demist Pro is here', html, text }
}

let sent = 0, failed = 0
for (const [email, { onWaitlist }] of recipients) {
  const { subject, html, text } = buildEmail(onWaitlist)
  if (!SEND) {
    console.log(`[dry run] would send to ${email} (${onWaitlist ? 'waitlist' : 'user'})`)
    continue
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.WAITLIST_FROM || 'Demist <hello@demist.app>',
        to: [email],
        subject,
        html,
        text,
        tags: [{ name: 'kind', value: 'pro-launch' }],
      }),
    })
    if (!res.ok) {
      failed++
      console.error(`FAILED ${email}: ${res.status} ${(await res.text()).slice(0, 200)}`)
    } else {
      sent++
      console.log(`sent -> ${email} (${onWaitlist ? 'waitlist' : 'user'})`)
    }
  } catch (e) {
    failed++
    console.error(`FAILED ${email}: ${e.message}`)
  }
  await new Promise(r => setTimeout(r, GAP_MS))
}

if (SEND) console.log(`\ndone: ${sent} sent, ${failed} failed`)
else console.log(`\n${recipients.size} would be sent. Re-run with --send to actually send.`)

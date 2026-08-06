// Transactional email, via Resend's REST API.
//
// Deliberately fetch() and not the `resend` npm package: the payload is one
// JSON POST, and adding a dependency to save six lines would mean an install
// step between "pull this branch" and "it deploys". Nothing here needs the SDK.
//
// Everything in this file is server-only - RESEND_API_KEY has no NEXT_PUBLIC_
// prefix, so importing it from a client component fails the build rather than
// leaking the key, which is the outcome we want.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://demist.app'
// Kept in step with MS_STORE_URL in app/landing-client.tsx.
const MS_STORE_URL = 'https://apps.microsoft.com/detail/9N4TZSCFHZN8'
// Must be an address on a domain verified in Resend, or every send 403s.
const FROM = process.env.WAITLIST_FROM ?? 'Demist <hello@demist.app>'
const REPLY_TO = process.env.WAITLIST_REPLY_TO ?? undefined

type SendResult = { ok: true; id: string | null } | { ok: false; error: string }

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  text: string
  /** Tags Resend groups delivery stats by. Cheap, and worth having later. */
  tag?: string
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { ok: false, error: 'RESEND_API_KEY is not set' }

  let res: Response
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        ...(REPLY_TO ? { reply_to: REPLY_TO } : {}),
        ...(opts.tag ? { tags: [{ name: 'kind', value: opts.tag }] } : {}),
      }),
    })
  } catch (e) {
    // Network failure, not a rejection. The caller has to be able to tell the
    // difference: this one is worth retrying, a 422 is not.
    return { ok: false, error: `network: ${(e as Error).message}` }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, error: `resend ${res.status}: ${body.slice(0, 300)}` }
  }

  const json = (await res.json().catch(() => null)) as { id?: string } | null
  return { ok: true, id: json?.id ?? null }
}

// ── templates ───────────────────────────────────────────────────────────────
// Inline styles and a table shell, because that is what mail clients render.
// No CSS custom properties, no flexbox, no <style> block - Outlook drops all
// three. The palette is the app's, hardcoded: --accent #A16207 on the warm
// greys from globals.css.

const ACCENT = '#A16207'
const INK = '#0F0F14'
const MUTED = '#5B5B63'
const FAINT = '#8A8A92'
const PAGE_BG = '#EDEAE3'
const CARD_BG = '#FAF9F6'
const BORDER = '#DCD8CF'

function shell(inner: string, preheader: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Demist</title>
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};">
<!-- Preheader: the grey line clients show next to the subject. Hidden in the
     body itself, otherwise it appears twice. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE_BG};padding:32px 16px;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:${CARD_BG};border:1px solid ${BORDER};border-radius:16px;">
        <tr>
          <td style="padding:32px 32px 36px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
            <p style="margin:0 0 28px 0;font-size:12px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:${ACCENT};">Demist</p>
            ${inner}
          </td>
        </tr>
      </table>
      <p style="max-width:480px;margin:20px auto 0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${FAINT};text-align:center;">
        <a href="${APP_URL}" style="color:${FAINT};text-decoration:underline;">demist.app</a>
      </p>
    </td>
  </tr>
</table>
</body>
</html>`
}

function button(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
  <tr><td style="border-radius:12px;background:${ACCENT};">
    <a href="${href}" style="display:inline-block;padding:13px 26px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">${label}</a>
  </td></tr>
</table>`
}

const H = (t: string) =>
  `<h1 style="margin:0 0 12px 0;font-size:22px;line-height:1.3;font-weight:700;color:${INK};">${t}</h1>`
const P = (t: string, extra = '') =>
  `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:${MUTED};${extra}">${t}</p>`

export function verificationEmail(confirmUrl: string) {
  return {
    subject: 'Confirm your place on the Demist Pro waitlist',
    html: shell(
      H('One click and you&rsquo;re on the list') +
        P('Someone entered this address for the Demist Pro waitlist. Confirm it was you and your place is saved.') +
        button(confirmUrl, 'Confirm my email') +
        P(
          `This link works for 7 days. If you didn&rsquo;t ask for this, ignore it &mdash; nothing has been added and we won&rsquo;t email you again.`,
          `font-size:13px;color:${FAINT};`,
        ) +
        P(
          `Button not working? Paste this into your browser:<br><a href="${confirmUrl}" style="color:${ACCENT};word-break:break-all;">${confirmUrl}</a>`,
          `font-size:12px;color:${FAINT};margin-bottom:0;`,
        ),
      'Confirm your email to save your place on the Demist Pro waitlist.',
    ),
    text: [
      'One click and you’re on the list',
      '',
      'Someone entered this address for the Demist Pro waitlist. Confirm it was you and your place is saved:',
      '',
      confirmUrl,
      '',
      'This link works for 7 days. If you didn’t ask for this, ignore it — nothing has been added and we won’t email you again.',
      '',
      APP_URL,
    ].join('\n'),
  }
}

export function welcomeEmail() {
  return {
    subject: 'You’re on the Demist Pro waitlist',
    html: shell(
      H('You&rsquo;re in') +
        P('Your email is confirmed and your place on the Demist Pro waitlist is saved. We&rsquo;ll email you once &mdash; when Pro is ready. No newsletter, no drip campaign.') +
        P('<strong style="color:' + INK + ';">What Pro adds:</strong> longer lectures, unlimited flashcard exports, and priority on new features.') +
        P(`In the meantime, Demist is free and works today &mdash; in your browser, or as a <a href="${MS_STORE_URL}" style="color:${ACCENT};">Windows app on the Microsoft Store</a>.`) +
        button(APP_URL, 'Open Demist') +
        P(
          'Changed your mind? Reply to this email and we&rsquo;ll take you off the list.',
          `font-size:13px;color:${FAINT};margin-bottom:0;`,
        ),
      'Your place is saved. We’ll email you once, when Pro is ready.',
    ),
    text: [
      'You’re in',
      '',
      'Your email is confirmed and your place on the Demist Pro waitlist is saved. We’ll email you once — when Pro is ready. No newsletter, no drip campaign.',
      '',
      'What Pro adds: longer lectures, unlimited flashcard exports, and priority on new features.',
      '',
      'In the meantime, Demist is free and works today. In your browser:',
      APP_URL,
      '',
      'Or as a Windows app on the Microsoft Store:',
      MS_STORE_URL,
      '',
      'Changed your mind? Reply to this email and we’ll take you off the list.',
    ].join('\n'),
  }
}

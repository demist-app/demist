// Turns off Demist's study emails from the link in the email itself, or from
// a mail client's one-click unsubscribe button (POST, RFC 8058). Signed per
// user (lib/emailPrefs.ts), so nobody can switch off someone else's.

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { validUnsubscribe } from '@/lib/emailPrefs'

export const dynamic = 'force-dynamic'

async function turnOff(req: Request): Promise<boolean> {
  const url = new URL(req.url)
  const userId = url.searchParams.get('u')
  if (!validUnsubscribe(userId, url.searchParams.get('t'))) return false
  const sb = createAdminClient()
  const { data, error } = await sb.auth.admin.getUserById(userId!)
  if (error || !data.user) return false
  const { error: upErr } = await sb.auth.admin.updateUserById(userId!, {
    user_metadata: { ...(data.user.user_metadata ?? {}), study_emails: false },
  })
  return !upErr
}

const page = (title: string, body: string) => new NextResponse(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;background:#F6F4FA;color:#1E1433;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px">
<main style="max-width:420px;background:#fff;border:1px solid rgba(30,20,51,.1);border-radius:16px;padding:28px">
<h1 style="font-size:20px;margin:0 0 10px">${title}</h1><p style="line-height:1.6;color:#4a4060;margin:0">${body}</p></main></body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
)

export async function GET(req: Request) {
  return (await turnOff(req))
    ? page('You won’t get these emails any more', 'Demist will not send you study reminders or news. You can turn reminders back on at any time in Profile.')
    : page('That link did not work', 'Open Demist, go to Profile and switch off study reminders there. Or reply to any of our emails and we will do it for you.')
}

export async function POST(req: Request) {
  return (await turnOff(req)) ? new NextResponse(null, { status: 200 }) : new NextResponse(null, { status: 400 })
}

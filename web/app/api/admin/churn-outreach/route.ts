import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { sendEmail } from '@/lib/email'

// One-off, single-purpose route: sends a short personal outreach email to a
// hardcoded list of real users who tried Demist once and never came back
// (identified via PostHog + cross-referenced against Supabase for a real,
// non-anonymous email - see the churn analysis this route exists to act on).
//
// Deliberately NOT a general "send email" endpoint - the recipient list and
// content are fixed in code, not accepted from the request body, so this has
// no email-injection surface even though it is reachable with a shared admin
// key. Delete this file once it has been triggered once; it has no ongoing
// purpose and a live "send email" endpoint is attack surface not worth
// leaving around after its one job is done.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RECIPIENTS = [
  'almav3lig@gmail.com',
  'oliviagonsoulin2007@gmail.com',
  'amitkumarji221701@gmail.com',
  'pauloh_103@outlook.com',
]

const SUBJECT = 'Quick question'
const TEXT = [
  'Hey,',
  '',
  "Noticed you tried Demist a few weeks back but haven't been on since. I'm one of the founders, and I'd love to know what stopped you, even just a quick line back.",
  '',
  'Thanks,',
  'Shivam',
  'Demist',
].join('\n')
// Plain text wrapped in minimal HTML - no logo, no branded shell. This is
// meant to read as a real person's email, not a marketing template; the
// styled shell used for the waitlist emails would work against that here.
const HTML = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#0F0F14;">
${TEXT.split('\n').map(line => line ? `<p style="margin:0 0 14px 0;">${line}</p>` : '').join('\n')}
</div>`

function isAdmin(req: NextRequest) {
  const expected = process.env.WAITLIST_ADMIN_KEY
  const got = req.headers.get('x-waitlist-admin-key')
  if (!expected || !got) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(got)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const results: { to: string; ok: boolean; error?: string }[] = []
  for (const to of RECIPIENTS) {
    const sent = await sendEmail({ to, subject: SUBJECT, html: HTML, text: TEXT, tag: 'churn-outreach' })
    results.push(sent.ok ? { to, ok: true } : { to, ok: false, error: sent.error })
  }
  return NextResponse.json({ results })
}

import { NextResponse, type NextRequest } from 'next/server'
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail, verificationEmail } from '@/lib/email'

// node:crypto and the service-role key both need the Node runtime.
export const runtime = 'nodejs'
// Nothing here is cacheable, and a cached POST would be a bug with an audience.
export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://demist.app'
const TOKEN_TTL_DAYS = 7

// Same shape the landing page validated with before this moved server-side.
// Kept loose on purpose: real addresses break every clever regex, and the
// confirmation step is what actually proves an address works.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

// Best-effort per-IP throttle. Serverless instances are recycled and requests
// fan out across them, so this window is porous by construction - it exists to
// blunt a naive loop from one machine, nothing more. The limit that actually
// holds is the per-address cooldown inside waitlist_join(), which lives in the
// database where every instance can see it.
const IP_WINDOW_MS = 10 * 60 * 1000
const IP_MAX = 6
const ipHits = new Map<string, number[]>()

// The backfill script (scripts/send-waitlist-verifications.mjs) posts here for
// every unconfirmed address on the list, which is exactly the pattern the IP
// limit exists to stop. Giving it a key to skip that check keeps the backfill
// on the identical code path real visitors take - same token generation, same
// template, same RPC - instead of a second implementation that can drift from
// this one. Absent the env var there is no bypass at all.
function isAdmin(req: NextRequest) {
  const expected = process.env.WAITLIST_ADMIN_KEY
  const got = req.headers.get('x-waitlist-admin-key')
  if (!expected || !got) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(got)
  return a.length === b.length && timingSafeEqual(a, b)
}

function ipRateLimited(ip: string) {
  const now = Date.now()
  const hits = (ipHits.get(ip) ?? []).filter(t => now - t < IP_WINDOW_MS)
  hits.push(now)
  ipHits.set(ip, hits)
  // Unbounded growth is the only way this map hurts anything.
  if (ipHits.size > 5000) {
    for (const [k, v] of ipHits) if (v.every(t => now - t >= IP_WINDOW_MS)) ipHits.delete(k)
  }
  return hits.length > IP_MAX
}

export async function POST(req: NextRequest) {
  let body: { email?: unknown; source?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const source = typeof body.source === 'string' ? body.source.slice(0, 64) : 'landing'

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }

  const admin = isAdmin(req)
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  if (!admin && ipRateLimited(ip)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }

  // The raw token goes in the email and nowhere else; only its hash is stored,
  // so read access to pro_waitlist never confers the ability to confirm on
  // somebody else's behalf.
  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400_000).toISOString()

  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch (e) {
    console.error('waitlist join: misconfigured —', (e as Error).message)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  const { data: outcome, error } = await supabase.rpc('waitlist_join', {
    p_email: email,
    p_source: source,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
  })

  if (error) {
    console.error('waitlist join: rpc failed —', error.message)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  // Telling someone "you're already confirmed" does reveal that this address
  // is on the list. That is a real disclosure and it is being accepted
  // knowingly: this is a marketing waitlist, not an account, and the
  // alternative - "check your inbox" for a mail we deliberately did not send -
  // sends people hunting through spam folders for nothing.
  if (outcome === 'already_verified') {
    return NextResponse.json({ status: 'already_verified' })
  }

  // A confirmation went out moments ago. Say the same thing as a fresh send:
  // from where they are standing it is true, and it is what they need to do.
  if (outcome === 'throttled') {
    return NextResponse.json({ status: 'sent' })
  }

  const confirmUrl = `${APP_URL}/api/waitlist/verify?token=${encodeURIComponent(token)}`
  const { subject, html, text } = verificationEmail(confirmUrl)
  const sent = await sendEmail({ to: email, subject, html, text, tag: 'waitlist-verify' })

  if (!sent.ok) {
    // The row exists with a token that was never delivered. Left alone: the
    // 90-second cooldown lapses on its own and their next attempt issues a
    // fresh token, which is the right recovery and needs no cleanup.
    console.error('waitlist join: send failed —', sent.error)
    return NextResponse.json({ error: 'send_failed' }, { status: 502 })
  }

  return NextResponse.json({ status: 'sent' })
}

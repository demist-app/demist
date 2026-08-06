import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabaseAdmin'
import { sendEmail, welcomeEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://demist.app'

type VerifyRow = { status: string; email: string | null; should_welcome: boolean }

// GET, because this is opened by clicking a link in an email - there is no
// other verb available there.
//
// The cost of that is link prefetching: Outlook Safe Links, Gmail's scanner and
// most corporate mail filters fetch every URL in a message before the human
// sees it, which confirms the address on their behalf. That is tolerable for a
// waitlist (the worst case is someone ends up subscribed who would have
// ignored the mail) and the alternative - a landing page with a "yes really"
// button - loses a real fraction of genuine confirmations to the extra click.
// What it must not do is send the welcome email twice, and that is handled in
// waitlist_verify(): the claim on welcomed_at happens in the same statement
// that sets verified_at, so a prefetch and a click cannot both win it.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const to = (status: string) => NextResponse.redirect(`${APP_URL}/waitlist/confirmed?status=${status}`)

  if (!token) return to('invalid')

  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch (e) {
    console.error('waitlist verify: misconfigured —', (e as Error).message)
    return to('error')
  }

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const { data, error } = await supabase.rpc('waitlist_verify', { p_token_hash: tokenHash })

  if (error) {
    console.error('waitlist verify: rpc failed —', error.message)
    return to('error')
  }

  // RETURNS TABLE arrives as an array even though it is always one row.
  const row = (Array.isArray(data) ? data[0] : data) as VerifyRow | undefined
  if (!row) return to('invalid')

  if (row.should_welcome && row.email) {
    const { subject, html, text } = welcomeEmail()
    const sent = await sendEmail({ to: row.email, subject, html, text, tag: 'waitlist-welcome' })
    if (!sent.ok) {
      // They ARE verified - that part committed and stays committed. Only the
      // welcome failed, so release its claim and let a later click retry it.
      console.error('waitlist verify: welcome send failed —', sent.error)
      await supabase.rpc('waitlist_unclaim_welcome', { p_email: row.email })
    }
  }

  // 'already' and 'verified' land on the same page: from the visitor's side
  // both mean "you're on the list", and drawing a distinction only invites the
  // question of whether something went wrong.
  return to(row.status === 'already' ? 'verified' : row.status)
}

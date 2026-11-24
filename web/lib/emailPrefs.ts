// Whether a student wants Demist's study emails (reminders and the one-off
// "what's new" note), and the signed link that turns them off.
//
// Kept in the auth user's metadata (study_emails: false = off), not a table:
// it needs no migration, the student can change it from the app with
// auth.updateUser, and the admin API can read it alongside the email address
// the cron jobs already fetch. Server-only: the HMAC key is the service role
// key, which never reaches a browser.

import { createHmac, timingSafeEqual } from 'node:crypto'

// Straight to www: demist.app answers with a redirect, and mail clients do not
// reliably follow one for the one-click unsubscribe POST.
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.demist.app').replace('://demist.app', '://www.demist.app')

function sign(userId: string): string {
  return createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY ?? '')
    .update(`demist-study-emails-off:${userId}`)
    .digest('base64url')
    .slice(0, 32)
}

export function unsubscribeUrl(userId: string): string {
  return `${APP_URL}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${sign(userId)}`
}

export function validUnsubscribe(userId: string | null, token: string | null): boolean {
  if (!userId || !token || !process.env.SUPABASE_SERVICE_ROLE_KEY) return false
  const want = Buffer.from(sign(userId))
  const got = Buffer.from(token)
  return want.length === got.length && timingSafeEqual(want, got)
}

export function studyEmailsOn(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.study_emails !== false
}

// Mail clients' one-click unsubscribe (RFC 8058): Gmail and Apple Mail show
// an "Unsubscribe" button for these headers, which is easier than the link.
export function unsubscribeHeaders(userId: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${unsubscribeUrl(userId)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

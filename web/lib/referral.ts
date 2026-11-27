'use client'

// Referrals (migration 045): demist.app/r/<code>. The page remembers the code
// here and the claim runs once the friend has an account, like university
// offers (lib/uniOffer.ts). All the rules (new accounts only, the 30 days, the
// inviter's reward) live in the database functions, never in the client.
import { createClient } from '@/lib/supabase'
import { capture } from '@/lib/analytics'

const KEY = 'demist_ref_code'

export function rememberReferral(code: string) {
  try { localStorage.setItem(KEY, code) } catch {}
}

export function hasPendingReferral(): boolean {
  try { return !!localStorage.getItem(KEY) } catch { return false }
}

/** 'ok' | 'already' | 'too_old' | 'own_code' | 'unknown_code' | 'signed_out' | 'error' */
export async function claimReferral(code: string): Promise<string> {
  const { data, error } = await createClient().rpc('claim_referral', { p_code: code })
  const status = error ? 'error' : String(data)
  // Keep the code only while signed out; any answer from the database is final.
  if (status !== 'signed_out' && status !== 'error') {
    try { localStorage.removeItem(KEY) } catch {}
  }
  capture('referral_claim', { status })
  return status
}

export async function claimPendingReferral(): Promise<string | null> {
  let code: string | null = null
  try { code = localStorage.getItem(KEY) } catch {}
  return code ? claimReferral(code) : null
}

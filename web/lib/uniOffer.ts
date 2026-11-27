'use client'

// University offers (migration 044): the /uni/<code> page remembers the code
// here, and the claim happens as soon as the student is signed in, even if
// sign-up went through onboarding first. Login has no "return to" route, so
// carrying the code in storage is what survives that detour.
const KEY = 'demist_uni_code'

export function rememberUniCode(code: string) {
  try { localStorage.setItem(KEY, code) } catch { /* storage blocked: the page claims directly instead */ }
}

export type ClaimResult =
  | { ok: true; org: string; proUntil: string; alreadyPaid: boolean }
  | { ok: false; error: string }

export async function claimUniCode(code: string): Promise<ClaimResult> {
  const res = await fetch('/api/uni/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ code }),
  }).catch(() => null)
  if (!res) return { ok: false, error: 'network' }
  const j = await res.json().catch(() => ({}))
  // Signed out: keep the code for after sign-in. Anything final: forget it.
  if (res.ok || res.status === 410 || res.status === 400) {
    try { localStorage.removeItem(KEY) } catch {}
  }
  return res.ok ? { ok: true, ...j } : { ok: false, error: j.error ?? String(res.status) }
}

// Called by the app shell when a session exists.
export async function claimPendingUniCode(): Promise<ClaimResult | null> {
  let code: string | null = null
  try { code = localStorage.getItem(KEY) } catch {}
  if (!code) return null
  return claimUniCode(code)
}

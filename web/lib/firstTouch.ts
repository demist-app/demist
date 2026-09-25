// First-touch attribution: where a visitor came from on their FIRST page view,
// kept in a cookie until they sign up, then written to their profile once
// (migration 040, record_first_touch) and to PostHog as $set_once.
//
// WHY. 105 of 119 real accounts had no recorded source as of 2026-09-25. The
// referrer is only visible on the landing request; by the time someone signs
// in, three pages later, it is gone. So it is captured on arrival and carried.
//
// Rules, each for a reason:
// - Write once. A later visit from somewhere else must not overwrite where
//   they first came from; that is what "first touch" means.
// - Raw values. utm_source=chatgpt.com, a referrer of chatgpt.com, and no
//   referrer at all are three different signals; bucketing them here would
//   throw away which one happened.
// - Our own domain is not a referrer. Moving between demist.app pages would
//   otherwise record every visitor as coming from us.
// - The desktop app is labelled, not left blank. It loads the site in its own
//   window with no referrer and its own cookie jar, so its first page view
//   would read as "direct". Store installs are exactly that invisible channel.

import { isElectronNative } from '@/lib/electronNative'

const COOKIE = 'demist_ft'
const MAX_AGE_S = 90 * 86_400

export interface FirstTouch {
  source: string | null
  medium: string | null
  campaign: string | null
  content: string | null
  referrer: string | null
  landing_path: string | null
  at: string
}

function readCookie(): FirstTouch | null {
  const raw = document.cookie.split('; ').find(c => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  if (!raw) return null
  try {
    const v = JSON.parse(decodeURIComponent(raw))
    return v && typeof v.at === 'string' ? v as FirstTouch : null
  } catch {
    return null
  }
}

function writeCookie(v: FirstTouch) {
  // Shared by demist.app and www.demist.app, which both serve the site; a
  // visitor landing on one and signing up on the other must keep their touch.
  const host = window.location.hostname
  const domain = host.endsWith('demist.app') ? '; domain=.demist.app' : ''
  const secure = window.location.protocol === 'https:' ? '; secure' : ''
  document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(v))}; max-age=${MAX_AGE_S}; path=/; samesite=lax${domain}${secure}`
}

const clip = (s: string | null, n = 200) => (s ? s.trim().slice(0, n) || null : null)

/** Call on every page load. Does nothing if a first touch is already stored. */
export function captureFirstTouch(): void {
  if (typeof window === 'undefined') return
  try {
    if (readCookie()) return
    const url = new URL(window.location.href)
    const q = url.searchParams
    let referrer: string | null = null
    try {
      const h = document.referrer ? new URL(document.referrer).hostname : ''
      if (h && !h.endsWith('demist.app') && h !== window.location.hostname) referrer = h
    } catch { /* unparseable referrer: leave it null */ }
    writeCookie({
      source: clip(q.get('utm_source')) ?? (isElectronNative() ? 'desktop' : null),
      medium: clip(q.get('utm_medium')),
      campaign: clip(q.get('utm_campaign')),
      content: clip(q.get('utm_content')),
      referrer,
      landing_path: clip(url.pathname, 300),
      at: new Date().toISOString(),
    })
  } catch (e) {
    // Cookies blocked or similar. Nothing to recover; attribution for this
    // visitor is simply unknown, which the NULL columns will say honestly.
    console.warn('[demist] first-touch capture failed:', e)
  }
}

/** The stored first touch, if any. For the desktop app with no cookie yet, a
 *  'desktop' touch, so a desktop signup is never recorded as blank. */
export function getFirstTouch(): FirstTouch | null {
  if (typeof window === 'undefined') return null
  const stored = readCookie()
  if (stored) return stored
  if (isElectronNative()) {
    return { source: 'desktop', medium: null, campaign: null, content: null, referrer: null, landing_path: null, at: new Date().toISOString() }
  }
  return null
}

// Term detection for the phone, the same contract and the same filters as the
// web recorder (web/lib/recordingSession.tsx runDetection):
//
// 1. Candidate words are picked out ON THE DEVICE (extractCandidates).
// 2. Only those words, each with the one sentence it came from, go to the
//    detect-terms edge function. The audio never leaves the phone and nor
//    does the rest of the transcript.
// 3. What comes back passes the web's quality gates (termQuality.ts) and the
//    same-concept dedupe (termSimilarity.ts), copied in by sync-shared.
import { SUPABASE_URL, supabase } from './supabase'
import { capture } from './analytics'
import { extractCandidates } from './shared/extractTerms'
import { isLikelyJargon, isConfidentDefinition } from './shared/termQuality'
import { collidesWith } from './shared/termSimilarity'

export interface DetectedTerm { term: string; definition: string; context?: string | null }

export type DetectOutcome =
  | { kind: 'terms'; terms: DetectedTerm[] }
  | { kind: 'none' }
  | { kind: 'rate_limited' }
  | { kind: 'signed_out' }
  | { kind: 'unavailable'; detail: string }

/** State one recording carries between detection calls. */
export interface DetectState {
  known: Set<string>          // lowercased terms already in the glossary
  sent: Set<string>           // lowercased candidates already sent this session
  sessionTerms: string[]      // terms carded this session, for the same-concept check
}

function isLatinTerm(term: string): boolean {
  return /^[\x20-\x7EÀ-ɏͰ-Ͽ\s'-]+$/.test(term)
}

export function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean)
}

export async function detectTerms(
  newText: string,
  context: string,
  state: DetectState,
  profile: { subject: string | null; year: number | null },
): Promise<DetectOutcome> {
  const candidates = splitSentences(newText).flatMap(s => extractCandidates(s, state.known, state.sent))
  if (state.sent.size > 500) state.sent = new Set(Array.from(state.sent).slice(-500))
  if (!candidates.length) return { kind: 'none' }

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { kind: 'signed_out' }

  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/detect-terms`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates,
        context,
        subject: profile.subject || 'general',
        year: profile.year ?? 1,
        known_terms: Array.from(state.known).slice(-300),
      }),
    })
  } catch {
    return { kind: 'unavailable', detail: 'network' }
  }
  if (res.status === 429) return { kind: 'rate_limited' }
  if (res.status === 401) return { kind: 'signed_out' }
  if (!res.ok) return { kind: 'unavailable', detail: `http_${res.status}` }

  let raw: DetectedTerm[] = []
  try { raw = ((await res.json())?.terms ?? []) as DetectedTerm[] } catch { return { kind: 'unavailable', detail: 'bad_json' } }

  const source = `${context} ${newText}`
  const kept = raw.filter(t => {
    if (!t?.term || !t?.definition) return false
    const key = t.term.toLowerCase()
    if (!isLatinTerm(t.term)) return false
    if (!isLikelyJargon(t.term)) { rejected(t.term, 'not_jargon'); return false }
    if (!isConfidentDefinition(t.term, t.definition, source)) { rejected(t.term, 'unconfident_definition'); return false }
    if (state.known.has(key)) return false
    if (collidesWith(t.term, state.sessionTerms)) return false
    state.sessionTerms.push(t.term)
    state.known.add(key)
    return true
  })
  return kept.length ? { kind: 'terms', terms: kept } : { kind: 'none' }
}

// Counts and lengths only: term text from a lecture is not sent to analytics.
function rejected(term: string, reason: string) {
  capture('term_rejected_low_quality', { reason, chars: term.length, words: term.trim().split(/\s+/).length })
}

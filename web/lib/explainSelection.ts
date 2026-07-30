'use client'

// "Select a phrase, ask what it means" — shared by the transcript reader, the
// summary reader and the flashcard reader, which had three copies of the same
// call and drifted apart in their timeouts and error handling.
//
// In the desktop app this runs on the term-detection model that is already
// resident in the 'terms' worker (see desktop/native/llm.js's explain). That
// matters for more than speed: these three popups were the last route by which
// text derived from a user's own lecture left the machine, while the app's
// privacy policy said definitions in the desktop app "are generated on your
// device and nothing is sent". They now are.
//
// Everywhere else it falls back to the detect-terms edge function's
// explain_mode, exactly as before.

import { createClient } from '@/lib/supabase'
import { getDemistNative } from '@/lib/electronNative'

// The desktop shell and this web app ship on separate schedules: the shell
// loads whatever is deployed at demist.app, so a user on an older build has a
// window.demistNative WITHOUT explain on it. Feature-detect the method rather
// than the platform, or that user gets a popup that throws instead of one that
// quietly uses the cloud path it used to.
function nativeExplain() {
  const native = getDemistNative()
  return typeof native?.explain === 'function' ? native : null
}

// A local generation on a small model is seconds, and the cloud call was
// MEASURED at 9.2s against a 10s ceiling that was cutting real answers off
// just before they arrived. Generous enough that a slow answer still lands;
// the caller shows a spinner throughout, so the only cost of waiting is
// waiting.
export const EXPLAIN_TIMEOUT_MS = 30_000

export async function explainSelection(
  text: string,
  subject: string | null,
  year: number | null,
): Promise<string | null> {
  const native = nativeExplain()
  if (native) {
    try {
      return await native.explain(text, subject, year)
    } catch (e) {
      // Not a silent null: on desktop there is no cloud fallback to reach for,
      // so a failure here is the whole feature failing and needs to be
      // findable in the console.
      console.error('[demist] on-device explain failed:', e)
      return null
    }
  }

  const supabase = createClient()
  const { data } = await supabase.functions.invoke('detect-terms', {
    body: {
      transcript: text,
      subject: subject ?? 'general',
      year: year ?? 1,
      known_terms: [],
      explain_mode: true,
    },
  })
  return (data as { terms?: { definition?: string }[] } | null)?.terms?.[0]?.definition ?? null
}

'use client'

// A short guide on the recording screen, for people who have never had a word
// explained yet.
//
// WHY (2026-11-27). Most first recordings are a test of under two minutes:
// someone talks at their laptop to see what happens. In the Windows app the
// first words take about 9 seconds to appear (31 seconds for the slowest 10%,
// PostHog first_transcript_ms over 30 days), detection is held back for the
// first 20 seconds while its model loads, and casual talk has no difficult
// words in it anyway. So the test shows a blank screen and then nothing, and
// of 3 short testers after the sample lecture shipped, none saw a word and none
// came back. This says what is happening while they wait, and gives them a
// sentence that is known to produce explanations (checked on the browser path
// with web/scripts/test-term-candidates-live.ts guide, and on the bundled
// on-device model with desktop/test/guide-sentence.js: 2 words in about 5s).
//
// Calm by design: no modal, nothing blocks recording, it can be hidden, and it
// disappears for good once the first explanation has appeared.

import { useEffect, useRef, useState } from 'react'
import { capture } from '@/lib/analytics'

const SEEN_KEY = 'demist_first_card_seen'
export const GUIDE_SENTENCE = 'Mitochondria make ATP through oxidative phosphorylation, which is part of cellular respiration.'

export function FirstRecordingGuide({ eligible, hasText, cardCount, elapsed, capturingTab }: {
  /** Decided once when recording starts: nobody who has seen an explanation before. */
  eligible: boolean
  hasText: boolean
  cardCount: number
  elapsed: number
  capturingTab: boolean
}) {
  const [hidden, setHidden] = useState(false)
  const [doneAt, setDoneAt] = useState<number | null>(null)
  const shownRef = useRef(false)

  useEffect(() => {
    if (eligible && !shownRef.current) {
      shownRef.current = true
      capture('first_guide_shown', { capturing_tab: capturingTab })
    }
  }, [eligible, capturingTab])

  useEffect(() => {
    if (!eligible || cardCount === 0 || doneAt !== null) return
    try { localStorage.setItem(SEEN_KEY, '1') } catch {}
    setDoneAt(elapsed)
    capture('first_guide_card_seen', { elapsed_seconds: elapsed, capturing_tab: capturingTab })
  }, [eligible, cardCount, doneAt, elapsed, capturingTab])

  if (!eligible || hidden) return null
  // After the first explanation: one line, then gone.
  if (doneAt !== null && elapsed - doneAt > 8) return null

  let body: React.ReactNode
  if (doneAt !== null) {
    body = <p>That's it. In a lecture, this happens all the way through, and everything is saved for you.</p>
  } else if (capturingTab) {
    body = <p>{hasText ? 'It\'s working.' : 'Listening. Text appears below in a few seconds.'} Explanations appear when a difficult word is said. The first one can take up to 30 seconds, so keep it playing.</p>
  } else {
    // The sentence shows from the first second (2026-11-28): the first person
    // to see this guide stopped at 25s, before any text had appeared, and
    // waiting for text before offering the sentence wasted that time.
    body = (
      <>
        <p>{hasText ? 'It\'s working.' : 'Listening. Text appears below in a few seconds.'} Trying it out? Read this aloud:</p>
        <p className="mt-2 font-semibold dark:text-white text-gray-900">&ldquo;{GUIDE_SENTENCE}&rdquo;</p>
        <p className="mt-2">An explanation of the difficult words appears within about 30 seconds, so keep recording. Or play a lecture video out loud near your laptop.</p>
      </>
    )
  }

  return (
    <div className="relative z-10 mx-4 sm:mx-6 mb-2 flex justify-center">
      <div className="w-full max-w-xl rounded-2xl px-4 py-3 text-[13px] leading-relaxed dark:bg-brand-500/10 bg-brand-50 border dark:border-brand-500/25 border-brand-200 dark:text-brand-200 text-brand-900" role="status" aria-live="polite">
        <div className="flex items-start gap-3">
          <div className="flex-1">{body}</div>
          {doneAt === null && (
            <button
              onClick={() => { setHidden(true); capture('first_guide_hidden', { elapsed_seconds: elapsed, had_text: hasText }) }}
              className="shrink-0 text-[12px] underline underline-offset-2 dark:text-brand-300 text-brand-700"
            >
              Hide
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** True for someone who has never had a word explained: no saved flag, and no recent lecture with words. */
export function firstGuideEligible(recentSessions: { terms?: unknown[] | null }[]): boolean {
  try { if (localStorage.getItem(SEEN_KEY)) return false } catch { return false }
  return !recentSessions.some(s => (s.terms?.length ?? 0) > 0)
}

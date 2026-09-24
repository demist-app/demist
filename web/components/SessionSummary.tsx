'use client'

// End-of-session sheet for a lecture where nothing was caught. The session
// that DID catch terms gets SessionReview instead; this covers the two cases
// that used to be indistinguishable because both simply showed nothing:
//
//   empty  - detection ran for the whole session and found nothing worth a
//            card. Said plainly, so a quiet lecture does not look broken.
//   failed - detection did not work, or the evidence cannot support a claim
//            that the lecture had nothing (sessionOutcome.ts). Said plainly
//            too, so a broken pipeline does not look like a quiet lecture.
//
// The copy never claims the transcript was saved: in microphone mode without
// consent or a declared support need it deliberately is not, and a summary
// that promised otherwise would be the kind of reassurance this exists to stop.

import type { SessionOutcome, FailureReason } from '@/lib/sessionOutcome'
import { isElectronNative } from '@/lib/electronNative'

const FAILURE_COPY: Record<FailureReason, { heading: string; body: (native: boolean) => string }> = {
  no_transcript: {
    heading: 'Demist did not hear this lecture',
    body: () =>
      'Almost nothing was transcribed, so there was nothing to look for terms in. '
      + 'Before the next one, check that the right microphone is selected, or that you shared the tab with its audio.',
  },
  detection_errors: {
    heading: 'Term detection did not work this time',
    body: native => (native
      ? 'The term model on this computer kept hitting errors during this lecture'
      : 'Demist could not reach the service that finds terms for most of this lecture')
      + ', so an empty list here does not mean there were no terms. We have been told about it.',
  },
  audio_unclear: {
    heading: 'The audio was too unclear to pick out terms',
    body: () =>
      'Most of this recording came through too faintly or noisily to trust, and guessing at terms from a garbled '
      + 'transcript produces wrong definitions, so Demist held back. Sitting closer to the speaker, or sharing the '
      + 'lecture tab instead of using the microphone, usually fixes it.',
  },
  long_session_no_terms: {
    heading: 'No terms caught, which is unusual',
    body: () =>
      'A lecture this long almost always has some. This usually means something went wrong rather than that '
      + 'there was nothing to catch, and we have been told about it.',
  },
}

export function SessionSummary({ outcome, onClose }: { outcome: SessionOutcome; onClose: () => void }) {
  if (outcome.state !== 'empty' && outcome.state !== 'failed') return null

  const heading = outcome.state === 'empty'
    ? 'No new terms in this lecture'
    : FAILURE_COPY[outcome.reason].heading
  const body = outcome.state === 'empty'
    ? 'Term detection ran for the whole session and nothing came up that is likely to be new at your year of study. That happens with lighter lectures.'
    : FAILURE_COPY[outcome.reason].body(isElectronNative())

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0 dark:bg-black/60 bg-black/30"
      style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={heading}
    >
      <div className="w-full max-w-sm dark:bg-[#0d0d1c] bg-[#FDFCF9] border dark:border-white/[0.08] border-black/[0.12] rounded-[24px] p-6 space-y-4">
        <p className="text-[18px] font-bold dark:text-white text-gray-900">{heading}</p>
        <p className="text-[13px] dark:text-white/60 text-gray-600 leading-relaxed">{body}</p>
        <button
          onClick={onClose}
          className="w-full py-3 rounded-2xl bg-yellow-600 hover:brightness-110 text-white text-[14px] font-semibold active:scale-[0.97] transition-[filter,transform] duration-150"
        >
          OK
        </button>
      </div>
    </div>
  )
}

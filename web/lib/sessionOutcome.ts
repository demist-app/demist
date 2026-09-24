// What happened in a lecture, for the end-of-session summary.
//
// WHY. A session that produced no terms used to look exactly like a session
// whose term detection broke: the review sheet simply did not open. That is
// the shape of the worst failure this product has had (a 25-day outage where
// detect-terms returned 200 with nothing in it and every lecture looked
// quiet). So "found nothing" and "something broke" are separate outcomes,
// with separate copy and separate events, and the failure side is chosen
// whenever the evidence cannot support a claim that the lecture was simply
// jargon-free.
//
// Pure and dependency-free so it can be tested directly with node.

export interface SessionSignals {
  termsCount: number
  transcriptChars: number
  durationSec: number
  // Detection calls that completed (including ones that ran and found nothing)
  detectOk: number
  // Detection calls that errored: HTTP failure, network error, native crash
  detectFailed: number
  // Transcription chunks below the confidence floor (never sent to detection)
  // versus chunks clear enough to use. Cloud path only; native reports 0/0.
  unclearChunks: number
  clearChunks: number
}

export type FailureReason =
  | 'no_transcript'
  | 'detection_errors'
  | 'audio_unclear'
  | 'long_session_no_terms'

export type SessionOutcome =
  | { state: 'found'; termsCount: number }
  | { state: 'empty' }
  | { state: 'failed'; reason: FailureReason }
  | { state: 'skipped' }

// Below this, a stop with nothing caught is a mis-tap or a quick test, and
// telling someone "something went wrong" after four seconds would be false.
export const MIN_SUMMARY_SEC = 60
// A lecture this long with a real transcript and zero terms is far more likely
// to be a broken pipeline than a jargon-free hour, so it is reported as a
// failure rather than reassuring the user that there was nothing to catch.
export const LONG_SESSION_SEC = 600
// Fewer characters than this is effectively no transcript: a few words of
// noise, not a lecture.
const MIN_TRANSCRIPT_CHARS = 40

export function classifySession(s: SessionSignals): SessionOutcome {
  if (s.termsCount > 0) return { state: 'found', termsCount: s.termsCount }
  if (s.durationSec < MIN_SUMMARY_SEC) return { state: 'skipped' }
  if (s.transcriptChars < MIN_TRANSCRIPT_CHARS) return { state: 'failed', reason: 'no_transcript' }
  // Any failure with no success, or more failures than successes: the empty
  // result is the detector's, not the lecture's.
  if (s.detectFailed > 0 && s.detectFailed >= s.detectOk) return { state: 'failed', reason: 'detection_errors' }
  if (s.unclearChunks > 0 && s.unclearChunks >= s.clearChunks) return { state: 'failed', reason: 'audio_unclear' }
  if (s.durationSec >= LONG_SESSION_SEC) return { state: 'failed', reason: 'long_session_no_terms' }
  return { state: 'empty' }
}

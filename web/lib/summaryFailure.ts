// Maps summarize-session's `reason` codes to user-facing text. Shared by
// dashboard and history, which both render a "Could not generate summary"
// state with a Retry button.

export function summaryFailureMessage(reason: string | undefined): string {
  switch (reason) {
    case 'not_eligible':
      return 'Summaries for microphone recordings need an accessibility setting or lecturer consent enabled in your profile.'
    case 'no_terms':
      return 'No terms were captured for this session.'
    case 'ai_rate_limited':
      return 'Summary service is busy right now — try again shortly.'
    default:
      return 'Could not generate summary.'
  }
}

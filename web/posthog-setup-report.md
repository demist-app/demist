<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog into the Demist Next.js app (App Router, v16.2.6). This second pass extended the existing instrumentation with 7 new events covering onboarding completion, text/slides imports, and Notion integration activity — plus user identification at onboarding.

## Summary of changes

| File | Change |
|------|--------|
| `instrumentation-client.ts` | **Previously created** — initialises PostHog via the Next.js 15.3+ instrumentation API with EU reverse proxy (`/ingest`), exception capture, and debug mode in development |
| `app/providers.tsx` | **Previously updated** — simple children passthrough to avoid double-initialisation |
| `next.config.ts` | **Previously updated** — EU reverse proxy rewrites and `skipTrailingSlashRedirect: true` |
| `app/onboarding/page.tsx` | **Updated** — added `identify()` and `onboarding_completed` capture on profile save |
| `app/(app)/import/page.tsx` | **Updated** — added `import_text_started`, `import_text_completed`, `notion_connected`, `notion_push_completed`, `notion_import_completed` |
| `app/(app)/history/page.tsx` | **Updated** — added `history_viewed` on page load |
| `.env.local` | **Updated** — `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` refreshed to correct values |

## Events

| Event | Description | File |
|-------|-------------|------|
| `onboarding_completed` | User finishes onboarding by selecting year of study — marks end of activation funnel | `app/onboarding/page.tsx` |
| `import_text_started` | User initiates a text/slides/document import (PPTX, DOCX, TXT) | `app/(app)/import/page.tsx` |
| `import_text_completed` | Text/slides import processed successfully with term count | `app/(app)/import/page.tsx` |
| `notion_connected` | User successfully connected their Notion workspace via OAuth | `app/(app)/import/page.tsx` |
| `notion_push_completed` | User exported glossary or session summaries to Notion | `app/(app)/import/page.tsx` |
| `notion_import_completed` | User imported a Notion page and concepts were extracted | `app/(app)/import/page.tsx` |
| `history_viewed` | User opens the session history page | `app/(app)/history/page.tsx` |

## Previously instrumented events (pass 1)

| Event | File |
|-------|------|
| `login_success`, `otp_sent`, `otp_send_failed`, `otp_verify_failed` | `app/login/page.tsx` |
| `dashboard_viewed`, `recording_started`, `recording_stopped` | `app/(app)/dashboard/page.tsx` |
| `term_card_shown`, `term_card_auto_dismissed`, `term_card_expanded` | `app/(app)/dashboard/page.tsx` |
| `import_audio_started`, `import_audio_completed` | `app/(app)/import/page.tsx` |
| `study_viewed`, `study_mode_selected` | `app/(app)/study/page.tsx` |
| `quiz_viewed`, `quiz_started`, `quiz_completed` | `app/(app)/quiz/page.tsx` |
| `flashcards_viewed`, `flashcard_graded`, `flashcard_session_completed`, `flashcard_word_defined`, `flashcard_deck_filtered` | `app/(app)/flashcards/page.tsx` |
| `session_review_completed` | `components/SessionReview.tsx` |
| `history_session_expanded` | `app/(app)/history/page.tsx` |
| `account_deletion_initiated`, `profile_updated` | `app/(app)/profile/page.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](https://eu.posthog.com/project/201461/dashboard/746538)
- [User activation funnel: Login → Recording → Session review](https://eu.posthog.com/project/201461/insights/CV1GlOrA)
- [Daily active users](https://eu.posthog.com/project/201461/insights/39bYAIM2)
- [Study engagement over time](https://eu.posthog.com/project/201461/insights/QtfcT57c)
- [Import completions (audio & text)](https://eu.posthog.com/project/201461/insights/bIAhmLNK)
- [Recording sessions started](https://eu.posthog.com/project/201461/insights/zIy8RdDn)

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>

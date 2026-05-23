<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog into the Demist Next.js app (App Router, v16.2.6).

## Summary of changes

| File | Change |
|------|--------|
| `instrumentation-client.ts` | **Created** — initialises PostHog via the Next.js 15.3+ instrumentation API with EU reverse proxy (`/ingest`), exception capture, and debug mode in development |
| `app/providers.tsx` | **Updated** — removed conflicting `posthog.init()` (via `useEffect`) and `PostHogProvider` wrapper; now a simple children passthrough to avoid double-initialisation |
| `next.config.ts` | **Updated** — added EU reverse proxy rewrites (`/ingest/*` → `eu.i.posthog.com`, `/ingest/static|array/*` → `eu-assets.i.posthog.com`) and `skipTrailingSlashRedirect: true` |
| `app/page.tsx` | **Updated** — converted to client component; captures `get_started_clicked` on CTA click |
| `app/login/page.tsx` | **Updated** — captures `magic_link_requested` and identifies the user by email on successful OTP request; captures `magic_link_request_failed` with error message and exception on failure |
| `app/dashboard/page.tsx` | **Updated** — captures `dashboard_viewed` and identifies the user by Supabase user ID on confirmed authentication |
| `.env.local` | **Updated** — `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` set to correct values |

## Events

| Event | Description | File |
|-------|-------------|------|
| `get_started_clicked` | User clicks the 'Get started' CTA on the landing page — top of the acquisition funnel | `app/page.tsx` |
| `magic_link_requested` | User submits the login form and a magic link is sent successfully | `app/login/page.tsx` |
| `magic_link_request_failed` | Magic link request resulted in an error from Supabase | `app/login/page.tsx` |
| `dashboard_viewed` | Authenticated user lands on the dashboard — marks successful conversion through the auth funnel | `app/dashboard/page.tsx` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/700306)
- [Acquisition funnel: CTA → Magic link → Dashboard](/insights/A29i3Bdh)
- [CTA clicks over time](/insights/T0UpHtV0)
- [Magic link requests over time](/insights/uOCTktFq)
- [Failed login attempts](/insights/1plilGo5)
- [Daily active users (dashboard)](/insights/1BhvDiLy)

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>

// Init PostHog after the browser is idle: keeps it off the critical JS path
if (typeof window !== 'undefined') {
  const doInit = () =>
    import('posthog-js').then(({ default: posthog }) =>
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
        api_host: '/ingest',
        ui_host: 'https://eu.posthog.com',
        defaults: '2026-01-30',
        capture_exceptions: true,
        debug: process.env.NODE_ENV === 'development',
        // Never auto-start recording just because the PostHog project has it
        // enabled. Dashboard/history/flashcards etc. render real lecture
        // transcript and term-definition text as DOM content - exactly the
        // text the privacy policy promises the desktop app never sends to a
        // third party. Recording is instead started explicitly, only on the
        // public marketing pages, by SessionReplayGate in app/providers.tsx.
        disable_session_recording: true,
      })
    )

  if (document.readyState === 'complete') {
    doInit()
  } else {
    window.addEventListener('load', doInit, { once: true })
  }
}

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
        // third party. Recording is instead started explicitly, per route,
        // by SessionReplayGate in app/providers.tsx.
        disable_session_recording: true,
        session_recording: {
          // EVERY text node is masked, everywhere, unconditionally - not a
          // selector listing the sensitive bits, because that is a list
          // someone has to remember to update every time a page starts
          // rendering something new. '*' cannot go stale.
          //
          // This exists so in-app routes can be recorded at all. The replay
          // still shows layout, cursor, clicks, navigation, timing, rage and
          // dead clicks - everything needed to answer "where does the
          // flashcard funnel lose people" - while the lecture transcript and
          // term definitions on screen never leave as readable text.
          //
          // posthog-js 1.396 has no unmaskTextSelector, so there is no
          // allowlist-back-in option; maskTextFn could do it, but a bug in a
          // hand-written mask function leaks real lecture content, and
          // readable button labels are not worth that risk. Marketing pages
          // lose text fidelity too, which costs nothing: that content is the
          // same public page for every visitor.
          maskTextSelector: '*',
          maskAllInputs: true,
        },
      })
    )

  if (document.readyState === 'complete') {
    doInit()
  } else {
    window.addEventListener('load', doInit, { once: true })
  }
}

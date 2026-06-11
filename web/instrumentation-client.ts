// Init PostHog after the browser is idle — keeps it off the critical JS path
if (typeof window !== 'undefined') {
  const doInit = () =>
    import('posthog-js').then(({ default: posthog }) =>
      posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
        api_host: '/ingest',
        ui_host: 'https://eu.posthog.com',
        defaults: '2026-01-30',
        capture_exceptions: true,
        debug: process.env.NODE_ENV === 'development',
      })
    )

  if (document.readyState === 'complete') {
    doInit()
  } else {
    window.addEventListener('load', doInit, { once: true })
  }
}

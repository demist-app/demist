// PostHog events from server routes (cron jobs), with no PII beyond the
// user id PostHog already keys people by.
export async function captureServer(userId: string, event: string, properties: Record<string, unknown>) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return
  try {
    await fetch('https://eu.i.posthog.com/capture/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, event, distinct_id: userId, properties }),
    })
  } catch { /* analytics must never fail a send */ }
}

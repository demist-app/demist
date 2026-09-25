// The IndexNow key file. IndexNow (Bing, Yandex and others) only accepts URL
// submissions from someone who can serve the key on the same host; the
// submission names this path as its keyLocation (scripts/indexnow.mjs).
// 404 until INDEXNOW_KEY is set, so there is never an empty "valid" key.
export const dynamic = 'force-dynamic'

export function GET() {
  const key = process.env.INDEXNOW_KEY
  if (!key) return new Response('Not found', { status: 404 })
  return new Response(key, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

// Minimal app-shell service worker. Demist is real-time and auth-gated
// (live recording, Supabase Realtime), so caching pages or API responses
// would serve stale or wrong data: this only exists to (a) satisfy
// Chromium's install criteria and (b) show a real offline page instead of
// a browser error when there's genuinely no connection.

const CACHE = 'demist-shell-v1'
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  )
  self.clients.claim()
})

// A plain fetch(event.request) here has no upper bound: on a slow connection
// the promise just stays pending, and respondWith() cannot hand anything back
// to the browser until it settles - so the page cannot even start rendering
// in the meantime, no matter how long that takes. This raced a 6s timeout
// against the real fetch on iOS specifically (see providers.tsx for why iOS
// no longer registers this SW at all, which is the actual fix for the ~20s
// freeze that was reported there); kept here too because an unbounded wait on
// a bad connection is the wrong default on any platform, not just the one it
// was caught on. 6s: comfortably past a slow-but-working mobile handshake,
// short enough that offline.html's own retry button (see offline.html) is a
// reasonable thing to land on if it fires.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)
  event.respondWith(
    fetch(event.request, { signal: controller.signal })
      .finally(() => clearTimeout(timer))
      .catch(() => caches.match(OFFLINE_URL))
  )
})

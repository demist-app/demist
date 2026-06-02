# Demist — Claude Handoff Document
_Generated 2026-06-02. Paste this entire file into a new Claude chat._

---

## Project overview

**Demist** is a web app that listens to university lectures in real time, detects unfamiliar terms as the lecturer speaks, shows definitions on screen, and builds a personal glossary + spaced-repetition flashcard deck automatically.

- **Live URL**: https://demist.app (redirects to www.demist.app)
- **Stack**: Next.js 16 App Router + Tailwind v4 + TypeScript (in `/web`)
- **Backend**: Supabase (Postgres + Auth + Edge Functions) + OpenAI Whisper + GPT-4o-mini
- **Supabase project ref**: `bsjcdvhiuxtyvbnrcbwg`
- **Vercel**: auto-deploys from `main` branch
- **Analytics**: PostHog EU region

---

## Critical unresolved bug — NO CARDS SHOWING DURING RECORDING

### Symptoms
- User visits `demist.app`, clicks the microphone button to start recording
- The recording UI activates (red dot, timer counts up)
- User speaks for 15-30+ seconds
- Zero network requests appear in DevTools → Network tab (filtered to `v1/`)
- No term cards ever appear on screen

### What was already tried
1. Removed magic bytes check from `transcribe` edge function (was causing 415s)
2. Added `localhost` to CORS allowed origins on all edge functions
3. Fixed `summarize-session` 403 (switched from service role to user JWT + RLS)
4. Lowered Web Speech API buffer threshold from 300 chars to 65 chars
5. Added 20-second safety flush timer
6. Hard-refreshed browser — still no requests

### Recording architecture (current — just deployed to production)

The dashboard `startRecording()` function (in `web/app/(app)/dashboard/page.tsx`) tries **Web Speech API first**, then falls back to **Whisper chunks**:

```
Chrome/Edge users:
  getUserMedia() → stream (for waveform only)
  SpeechRecognitionAPI.start()
  onresult → accumulate text in speechBufferRef
  When buffer ≥ 65 chars AND 8s cooldown passed → processTranscriptChunk()
  processTranscriptChunk → runDetection → POST /functions/v1/detect-terms
  (NO calls to /functions/v1/transcribe in this path)

Firefox/Safari users (fallback):
  getUserMedia() → stream (for recording AND waveform)
  MediaRecorder records 10-second chunks
  Each chunk → processChunk(blob, sessionId, peak)
  If peak > 0.015 (silence detection) → POST /functions/v1/transcribe
  If transcribe returns text → POST /functions/v1/detect-terms
```

### Key functions to inspect in `web/app/(app)/dashboard/page.tsx`

| Function | What it does |
|---|---|
| `startRecording()` | ~line 345 — gets mic, creates session, branches to Web Speech or Whisper |
| `runDetection()` | ~line 243 — shared: calls detect-terms, saves terms, shows cards |
| `processChunk()` | ~line 330 — Whisper path: checks silence, calls transcribe, then runDetection |
| `processTranscriptChunk()` | ~line 365 — Web Speech path: calls runDetection directly |
| `stopRecording()` | ~line 500 — stops recognition or MediaRecorder, flushes buffer |

### Most likely root cause (uninvestigated)

**The Web Speech API is probably failing silently.** `SpeechRecognitionAPI` exists (Chrome), so it takes the Web Speech path. But `onresult` never fires — either:
- Chrome speech recognition is blocked (network, settings, Google servers unreachable)
- Dual mic access conflict: `getUserMedia()` is called first, then Web Speech API also tries to grab the mic — some Chrome versions block the second access
- The `recognition.onerror` handler silently ignores `audio-capture` errors (line ~480)

**Consequence**: `speechBufferRef` never accumulates text → `flushSpeechBuffer()` never called → zero network requests.

### Recommended fix to try first

In `startRecording()`, add error recovery: if Web Speech API fires any error (not just `no-speech`), tear it down and fall back to the Whisper MediaRecorder path. Current code ignores `audio-capture` silently.

Also try: release `getUserMedia` stream before starting Web Speech API — or don't call `getUserMedia` at all in speech mode (just skip the waveform visualization).

Simpler alternative: **disable the Web Speech API path entirely** for now. In `startRecording()`, change:
```javascript
const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
if (SpeechRecognitionAPI) { ...
```
to:
```javascript
const SpeechRecognitionAPI = null // disabled — using Whisper path for reliability
if (SpeechRecognitionAPI) { ...
```

This forces the Whisper 10-second chunk path which was working before. Then re-enable Web Speech API once the silence detection and chunk path are confirmed working.

---

## What was built/changed this session (all deployed to production)

### Web app (Next.js — `web/`)
- **UI**: Tiered max-widths across all pages, entrance animations, stop-slop copy pass
- **Security**: `proxy.ts` server-side auth guard, security headers in `next.config.ts`, postMessage origin fix, OTP resend cooldown, PostHog identify after verify
- **Import page**: YouTube URL import (new), progress bars, auto-redirect, fetch timeouts
- **Landing page**: New features grid (YouTube, Notion, import), updated hero/steps copy
- **Error boundaries**: `app/error.tsx` + `app/(app)/error.tsx`
- **Fixes**: Glossary stuck loading, history rollback on toggleKnown/rename, flashcard SM-2 error handling, Anki UTF-8 export, clipboard copy state fix
- **Accessibility**: aria-labels, aria-live regions, role=alert on errors
- **Stats page**: Per-dataset chart guards, prefers-reduced-motion support

### Edge functions (all deployed to Supabase)
| Function | Status | Notes |
|---|---|---|
| `transcribe` | Updated | JWT auth, localhost CORS, magic bytes check REMOVED |
| `detect-terms` | Updated | JWT auth, localhost CORS, prompt injection protection, 4000 char cap |
| `summarize-session` | Updated | JWT auth, uses user JWT + RLS (no service role), localhost CORS |
| `transcribe-audio` | NEW | Full audio import pipeline: download from storage, Groq/Whisper chunking (up to 60MB), term detection, synopsis |
| `process-text-upload` | NEW | Text import pipeline: PPTX/DOCX/TXT/Notion, chunked term detection, synopsis |

### Supabase secrets (all set)
- `OPENAI_API_KEY` ✓
- `GROQ_API_KEY` ✓ (Groq Whisper for imports — 9× cheaper than OpenAI)
- `SUPABASE_*` keys ✓

### Chrome extension (`extension/`)
Completely rewritten from side panel to **Grammarly-style overlay**:
- `manifest.json` — `<all_urls>` permissions, no side panel
- `content-bridge.js` — runs on demist.app only, bridges window ↔ extension
- `content-overlay.js` — runs on all other pages, Shadow DOM floating cards
- `background.js` — relay hub, manages recording state
- `popup.html/js` — toolbar icon click shows recording controls
- Updated zip at `web/public/demist-extension.zip`

### YouTube import (`web/app/api/youtube/route.ts`)
- GET endpoint that validates YouTube URL, fetches captions via `youtube-transcript` package, returns title/channel/duration/transcript
- Import section added to top of Import page
- `youtube-transcript` package installed in `web/`

---

## Design system

- **Background**: `#080810`
- **Accent**: violet-600 / violet-400
- **Entrance animation**: `animate-step opacity-0` with `animationFillMode: 'forwards'`, staggered delays
- **Max-widths**: Dashboard `4xl`, History `3xl`, Glossary/Import `2xl`, Profile `xl`
- **Buttons**: `active:scale-[0.97]`, no `transition-all`

## Tailwind note
Uses `@theme inline` in `globals.css` — NOT a `tailwind.config.ts`. This is Tailwind v4.

## Next.js note
This is Next.js 16. Middleware is called **`proxy.ts`** with `export function proxy()`. `@supabase/ssr` cannot be imported in `proxy.ts`.

---

## Cost structure (after optimisations)

| User action | Cost |
|---|---|
| 1hr live recording (Chrome — Web Speech) | ~$0.001 |
| 1hr live recording (Firefox — Whisper) | ~$0.12 |
| 2hr audio import (Groq) | ~$0.09 |
| YouTube video import | ~$0.004 |
| Text/PPTX import | ~$0.005 |

Monthly fixed: ~$45 (Supabase Pro + Vercel Pro)

---

## Key file locations

```
web/
  app/
    (app)/
      dashboard/page.tsx      ← recording logic, term detection, live cards
      import/page.tsx         ← YouTube, audio, text, Notion import UI
      history/page.tsx        ← session history, summarize
      flashcards/page.tsx     ← SM-2 spaced repetition
      glossary/page.tsx       ← term glossary
      profile/page.tsx        ← Anki export, settings
      stats/page.tsx          ← usage charts
      summary-viewer.tsx      ← select text → explain → save flashcard
      layout.tsx              ← auth guard + bottom nav
    api/
      youtube/route.ts        ← YouTube caption fetching
      notion/route.ts         ← Notion OAuth start (with CSRF state)
      notion/callback/route.ts← Notion OAuth callback
      notion/sync/route.ts    ← Notion push/pull operations
    error.tsx                 ← global error boundary
    landing-client.tsx        ← landing page
    globals.css               ← animate-step keyframe, nav-bottom-pad
  proxy.ts                    ← Next.js 16 middleware (server-side auth guard)
  next.config.ts              ← security headers, PostHog rewrites

backend/
  supabase/
    functions/
      transcribe/             ← live recording audio → Whisper
      detect-terms/           ← transcript → GPT-4o-mini → terms
      summarize-session/      ← terms → GPT-4o-mini → synopsis
      transcribe-audio/       ← audio file import pipeline
      process-text-upload/    ← text file import pipeline

extension/
  manifest.json
  content-bridge.js           ← demist.app bridge
  content-overlay.js          ← Grammarly-style overlay (all pages)
  background.js               ← relay hub
  popup.html / popup.js       ← toolbar popup
```

---

## Immediate next steps

1. **Fix the recording bug** (highest priority — see above)
2. **Practice questions** — after a session, GPT generates 3-5 exam questions from terms. One GPT call, no new infrastructure.
3. **Mobile app** — Expo scaffold already exists in `/mobile`
4. **Per-user usage caps** — prevent one user from draining OpenAI credits before monetisation

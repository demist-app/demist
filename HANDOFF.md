# Demist — Claude Handoff Document
_Generated 2026-06-05. Paste this entire file into a new Claude chat._

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

## Recording architecture (current — production)

The dashboard `startRecording()` function (in `web/app/(app)/dashboard/page.tsx`) uses **Whisper-only** (Web Speech API was disabled — see below):

```
All browsers:
  getUserMedia({ echoCancellation:false, noiseSuppression:true, autoGainControl:true })
  → raw stream (for waveform visualiser)
  → Web Audio pipeline: GainNode(2.5×) → DynamicsCompressor → processedStream
  → MediaRecorder records processedStream in 10-second chunks
  → Each chunk → processChunk(blob, sessionId, peak)
  → If peak > 0.003 (silence gate) → POST /functions/v1/transcribe
  → If transcribe returns text → POST /functions/v1/detect-terms
  → Cards shown on screen, terms saved to DB
```

### Why Web Speech API was disabled

Chrome's `webkitSpeechRecognition` accepts `.start()` without error but silently never fires `onresult`. A 12-second watchdog fallback was added and confirmed working in production (user saw the fallback log). Web Speech API was then disabled entirely (`const SpeechRecognitionAPI = null as any`) to eliminate the startup delay. Whisper path is reliable.

### Key functions in `web/app/(app)/dashboard/page.tsx`

| Function | What it does |
|---|---|
| `startRecording()` | ~line 398 — gets mic, builds audio processing pipeline, creates session, starts Whisper chunk loop |
| `doChunk()` | defined inside startRecording — 10-second MediaRecorder loop using processedStream |
| `runDetection()` | ~line 250 — shared: calls detect-terms, saves terms, shows cards |
| `processChunk()` | ~line 343 — silence gate (peak < 0.003 skipped), then transcribe → runDetection |
| `stopRecording()` | ~line 554 — stops recorder, closes AudioContext, flushes, updates session, triggers summarize |

---

## Audio quality for distant/quiet lecturers

Added in `startRecording()`:

1. **`getUserMedia` constraints**: `echoCancellation: false` (prevents suppressing lecturer's voice as "echo"), `noiseSuppression: true` (filters HVAC/ambient hum), `autoGainControl: true` (hardware-level boost for quiet sources)

2. **Web Audio processing pipeline**: raw mic stream → `GainNode(2.5×)` → `DynamicsCompressor(threshold:-30, knee:20, ratio:4, attack:3ms, release:150ms)` → `MediaStreamDestination`. MediaRecorder records the processed stream; waveform visualiser still reads the raw stream.

3. **Silence threshold lowered**: `SILENCE_THRESHOLD = 0.003` (was 0.015) — only skips true dead air, not quiet-but-real audio.

---

## Security hardening (code complete — edge functions need deploying)

### Edge functions — all have:
- Per-user **in-memory sliding-window rate limiting** (resets on cold start; effective against burst abuse)
- JWT auth on every request
- Input sanitisation and length caps

| Function | Rate limit | Notes |
|---|---|---|
| `transcribe` | 400/hr | Covers ~66-min recording at 10s chunks |
| `detect-terms` | 300/hr | Fixed regex bug in `sanitizeText` (was `[ -]` ASCII range, stripped all punctuation) |
| `summarize-session` | 30/hr | Added UUID validation on `session_id` |
| `transcribe-audio` | 5/hr | Added file extension whitelist (webm/mp4/mp3/ogg/m4a/wav/flac) |
| `process-text-upload` | 10/hr | `source` field validated against allowlist before DB insert |

### Next.js API routes (auto-deployed via Vercel — already live):
| Route | Rate limit | Notes |
|---|---|---|
| `/api/youtube` | 20/hr | URL capped at 200 chars |
| `/api/notion/sync` | 20/hr | Action validated against allowlist |

### ⚠️ Edge function deployment — still required
Edge functions are not auto-deployed via Vercel. Must be deployed manually:
```bash
cd backend
supabase functions deploy transcribe --project-ref bsjcdvhiuxtyvbnrcbwg
supabase functions deploy detect-terms --project-ref bsjcdvhiuxtyvbnrcbwg
supabase functions deploy summarize-session --project-ref bsjcdvhiuxtyvbnrcbwg
supabase functions deploy transcribe-audio --project-ref bsjcdvhiuxtyvbnrcbwg
supabase functions deploy process-text-upload --project-ref bsjcdvhiuxtyvbnrcbwg
```
No `config.toml` exists in the project — the `--project-ref` flag is required. Run from the `backend/` directory so the CLI finds `supabase/functions/<name>/index.ts`.

---

## Design system

- **Background**: `#080810`
- **Accent**: violet-600 / violet-400
- **Entrance animation**: `animate-step opacity-0` with `animationFillMode: 'forwards'`, staggered delays
- **Max-widths**: Dashboard `4xl`, History `3xl`, Glossary/Import `2xl`, Profile `xl`
- **Buttons**: `active:scale-[0.97]`, no `transition-all`
- **Cards** (standard): `bg-white/[0.03] border border-white/[0.07] rounded-xl` — used everywhere including session glossary during recording

## Tailwind note
Uses `@theme inline` in `globals.css` — NOT a `tailwind.config.ts`. This is Tailwind v4.

## Next.js note
This is Next.js 16. Middleware is called **`proxy.ts`** with `export function proxy()`. `@supabase/ssr` cannot be imported in `proxy.ts`.

---

## Cost structure

| User action | Cost |
|---|---|
| 1hr live recording (Whisper) | ~$0.12 |
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
      dashboard/page.tsx      ← recording logic, audio pipeline, term detection, live cards
      import/page.tsx         ← YouTube, audio, text, Notion import UI
      history/page.tsx        ← session history, summarize
      flashcards/page.tsx     ← SM-2 spaced repetition
      glossary/page.tsx       ← term glossary
      profile/page.tsx        ← Anki export, settings
      stats/page.tsx          ← usage charts
      summary-viewer.tsx      ← select text → explain → save flashcard
      layout.tsx              ← auth guard + bottom nav
    api/
      youtube/route.ts        ← YouTube caption fetching (rate limited)
      notion/route.ts         ← Notion OAuth start (with CSRF state)
      notion/callback/route.ts← Notion OAuth callback
      notion/sync/route.ts    ← Notion push/pull operations (rate limited)
    error.tsx                 ← global error boundary
    landing-client.tsx        ← landing page
    globals.css               ← animate-step keyframe, nav-bottom-pad
  proxy.ts                    ← Next.js 16 middleware (server-side auth guard)
  next.config.ts              ← security headers, PostHog rewrites

backend/
  supabase/
    functions/
      transcribe/             ← live recording audio → Whisper (rate limited, needs deploy)
      detect-terms/           ← transcript → GPT-4o-mini → terms (sanitize fix, needs deploy)
      summarize-session/      ← terms → GPT-4o-mini → synopsis (UUID validated, needs deploy)
      transcribe-audio/       ← audio file import pipeline (ext whitelist, needs deploy)
      process-text-upload/    ← text file import pipeline (source validated, needs deploy)

extension/
  manifest.json
  content-bridge.js           ← demist.app bridge
  content-overlay.js          ← Grammarly-style overlay (all pages)
  background.js               ← relay hub
  popup.html / popup.js       ← toolbar popup
```

---

## What was built/changed this session

### Recording bug fix
- Root cause: Chrome's Web Speech API accepted `recognition.start()` but never fired `onresult` or `onerror` — silently doing nothing
- Fix 1: Added 12-second no-result watchdog that fell back to Whisper MediaRecorder path
- Fix 2: Disabled Web Speech API entirely to skip the 12-second wait; all users now go straight to Whisper

### Audio quality for distant lecturers
- Better `getUserMedia` constraints (autoGainControl, noiseSuppression, no echoCancellation)
- Web Audio gain + compression pipeline before MediaRecorder
- Silence threshold lowered 5× so quiet audio isn't discarded

### UI fix
- Session glossary cards during recording were red-tinted (`bg-red-500/[0.04]`); restored to standard dark style

### Security hardening
- Rate limiting added to all 5 edge functions and 2 Next.js API routes
- `sanitizeText` regex bug fixed in detect-terms (was silently stripping all punctuation)
- UUID validation added to summarize-session
- File extension whitelist added to transcribe-audio
- `source` field allowlist added to process-text-upload
- YouTube URL length cap; Notion action allowlist

---

## Immediate next steps

1. **Deploy edge functions** (command above) — security fixes are in git but not live on Supabase yet
2. **Practice questions** — after a session, GPT generates 3-5 exam questions from the session terms. One GPT call, no new infrastructure needed.
3. **Per-user cost caps** — prevent a single user draining OpenAI credits before monetisation launches
4. **Mobile app** — Expo scaffold already exists in `/mobile`

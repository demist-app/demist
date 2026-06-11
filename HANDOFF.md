# Demist — Engineering Handoff

Last updated: June 2026. This file reflects the current production state. If you change the recording pipeline, edge functions, or design tokens, update this file in the same PR.

## What Demist is

A web app + Chrome extension for university students. It listens to lectures in real time, detects unfamiliar technical terms as the lecturer speaks, shows definitions on screen instantly, and builds a personal glossary + SM-2 spaced-repetition flashcard deck automatically.

- Live: https://demist.app
- Supabase project ref: `bsjcdvhiuxtyvbnrcbwg`
- Deploys: Vercel auto-deploys `/web` from main. Edge functions deploy manually (see below).

## Tech stack

- **Frontend**: Next.js 16 App Router + TypeScript + Tailwind v4 in `/web`
  - Tailwind v4 uses `@theme inline` in `globals.css` — there is NO `tailwind.config.ts`
  - Next.js 16 middleware is `proxy.ts` with `export function proxy()`. Never import `@supabase/ssr` there
- **Backend**: Supabase (Postgres + Auth + Deno edge functions)
- **AI**: Groq Whisper `whisper-large-v3-turbo` for transcription (OpenAI Whisper fallback), GPT-4o-mini for term detection and summaries
- **Analytics**: PostHog (EU region)

## Recording architecture (current)

```
getUserMedia({ echoCancellation:false, noiseSuppression:true, autoGainControl:true })
→ raw stream (waveform visualiser reads this)
→ GainNode(2.5×) → DynamicsCompressor(threshold:-30, knee:20, ratio:4) → processedStream
→ MediaRecorder records in 5-SECOND chunks (raw getUserMedia stream — Chrome suspends
  AudioContext in background tabs but always delivers getUserMedia audio)
→ each chunk → processChunk(blob, sessionId)
→ blob > 500 bytes → POST /functions/v1/transcribe (Groq Whisper, OpenAI fallback)
→ text accumulated in detectionBufferRef
→ every 15s (or immediately on stop) → POST /functions/v1/detect-terms (GPT-4o-mini)
  with rolling ~60s context from recentContextRef
```

**CONCURRENT: Web Speech API is ENABLED** and runs alongside Whisper as the instant word-by-word display layer:

- Web Speech `onresult` → drives `setSentences` (primary display source)
- If Web Speech fails (5s watchdog or 3 consecutive no-speech errors) → Whisper 5s chunks drive display instead
- `speechModeRef` = true means Web Speech is the active display source
- `webSpeechHasFiredRef` = true once Web Speech has fired at least once

**Supabase Realtime on `transcript_chunks` is a recovery layer only** — it re-populates `sentences` after a mid-session page reload. It is never the primary display path.

Key refs in `web/app/(app)/dashboard/page.tsx`:

| Ref | Purpose |
|---|---|
| `detectionBufferRef` | accumulated Whisper text waiting for detect-terms |
| `lastDetectionTimeRef` | ms timestamp of last detect-terms call |
| `recentContextRef` | last ~60s (~300 chars) of transcript, rolling context for detect-terms |
| `speechModeRef` | true = Web Speech is active display source |
| `webSpeechHasFiredRef` | true once Web Speech onresult has fired |

All three detection refs are reset in `startRecording()`. `stopRecording()` flushes any remaining `detectionBufferRef` content through `runDetection` so terms from the final seconds are never lost, and `processChunk` triggers an immediate detection for the final chunk after stop.

Other recording behaviours: screen Wake Lock held during recording (with iOS Safari fallback banner), Web Lock held so Chrome doesn't throttle the chunk timer, `beforeunload` handler stops Web Speech and the session cleanly, tab audio capture available via `getDisplayMedia` as an alternative to the microphone.

## Edge functions

Located in `backend/supabase/functions/`. **IMPORTANT: there are two function directories.** `supabase/functions/` at the repo root is legacy and ignored. Only `backend/supabase/functions/` is deployed.

| Function | Rate limit | Purpose |
|---|---|---|
| `transcribe` | 900/hr | 5s audio chunks → Groq Whisper (OpenAI fallback). Saves to `transcript_chunks` |
| `detect-terms` | 500/hr | transcript + rolling context + known_terms → GPT-4o-mini → 1-2 load-bearing terms |
| `summarize-session` | 30/hr | session terms → GPT-4o-mini → synopsis paragraph |
| `transcribe-audio` | 5/hr | audio file import → Groq Whisper (chunked for large files) |
| `process-text-upload` | 10/hr | text/PPTX/DOCX → GPT-4o-mini → terms |

All functions have: JWT auth, per-user sliding-window rate limiting, input sanitisation, prompt-injection hardening (user content wrapped in XML data blocks).

**Edge functions are NOT auto-deployed.** After changing any:

```bash
cd backend
supabase functions deploy transcribe --project-ref bsjcdvhiuxtyvbnrcbwg
supabase functions deploy detect-terms --project-ref bsjcdvhiuxtyvbnrcbwg
supabase functions deploy summarize-session --project-ref bsjcdvhiuxtyvbnrcbwg
supabase functions deploy transcribe-audio --project-ref bsjcdvhiuxtyvbnrcbwg
supabase functions deploy process-text-upload --project-ref bsjcdvhiuxtyvbnrcbwg
```

If `GROQ_API_KEY` is set in Supabase env, transcription is ~9× cheaper than OpenAI. It is configured for both live recording and audio imports.

## Frontend pages

```
web/app/(app)/
  dashboard/page.tsx      recording, live term cards, real-time transcript display
  import/page.tsx         audio file, text/PPTX/DOCX, Notion import (YouTube REMOVED — never re-add)
  history/page.tsx        session list, rename, summarize, expand, term preview chips
  flashcards/page.tsx     SM-2 spaced repetition (Again/Hard/Good/Easy), browse mode,
                          completion screen with streak + rating distribution
  glossary/page.tsx       full term glossary with search
  profile/page.tsx        Anki export, course/year settings
  stats/page.tsx          usage charts (streak, terms this week, etc.)
  leaderboard/page.tsx    leaderboard
  summary-viewer.tsx      highlight text in summary → definition → save as flashcard
  transcript-viewer.tsx   same for transcripts
  layout.tsx              auth guard + bottom navigation

web/app/
  landing-client.tsx      marketing landing page
  api/notion/*            Notion OAuth start/callback/sync (rate limited, action allowlist)

extension/                Chrome extension (overlay on all pages)
mobile/                   Expo scaffold (not built out)
```

## Design system

| Token | Value |
|---|---|
| Dark background | `#080810` |
| Light background | `#EDEAE3` |
| Primary accent | yellow/amber (`yellow-500`, `amber-500`, `amber-600`) |
| Cards | `bg-white/[0.03] border border-white/[0.07] rounded-xl` (light-mode variants throughout) |
| Entrance animation | `animate-step opacity-0` + `animationFillMode: 'forwards'`, staggered `animationDelay` |
| Buttons | `active:scale-[0.97]` — never `transition-all`, animate specific properties |

All pages support light + dark mode.

## Cost structure

| Action | Cost |
|---|---|
| 1hr live recording (Groq Whisper) | ~$0.013 |
| 1hr live recording (OpenAI fallback) | ~$0.12 |
| detect-terms per hour (GPT-4o-mini) | ~$0.02 |
| 2hr audio file import | ~$0.09 |
| Text/PPTX import | ~$0.005 |
| Monthly fixed (Supabase Pro + Vercel Pro) | ~$45 |

## Known issues / technical debt

1. **Opera GX**: its ad blocker blocks `speech.googleapis.com`, so Web Speech word-by-word display fails there. The 5s watchdog falls back to Whisper display gracefully. Users can disable the ad blocker on demist.app.
2. **Pending manual SQL** (Notion 403 fix — run in Supabase SQL editor):
   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON public.integrations TO authenticated;
   GRANT SELECT ON public.integrations TO anon;
   ```
3. Rate limit warnings exist in UI (amber, non-blocking) but are untested under real production load.
4. **No per-user cost caps** — a single user could drain API credits. Fine at current scale, must address before growth (usage_events table is the groundwork).

## Hard constraints — read before coding

- Next.js 16, not 14/15. Check `node_modules/next/dist/docs/` before using Next APIs
- Tailwind v4 — `@theme inline` in `globals.css`, NOT `tailwind.config.ts`
- No `transition-all` on buttons
- No YouTube import — completely removed, do not re-add
- No `@supabase/ssr` in `proxy.ts`
- Default to no code comments — only when the WHY is non-obvious
- Never mock databases in tests — use real Supabase connections
- PostHog: add `posthog.capture()` for any new user-facing interaction
- All user input sanitised before DB/prompt; JWT on all edge function calls; rate limits on all endpoints

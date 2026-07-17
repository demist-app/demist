# Demist Desktop

Electron shell that loads the existing web app and adds fully on-device
transcription, translation, and term detection through a native bridge.
No lecture audio or text reaches Groq, OpenAI, or anywhere else when
running inside this app: see `main.js` for why the window loads your
normal deployment rather than bundling a separate copy of the UI.

## Status

Dependency-verified and, as of the transcription rewrite below, has had
real error output from an actual run to fix against, not just assumptions.

- `npm install` succeeds cleanly
- Every native module resolves with the exact API surface the code calls:
  `getLlama`/`LlamaChatSession`/`resolveModelFile` (node-llama-cpp),
  `pipeline` (@huggingface/transformers), onnxruntime-node
- The Electron binary downloads and matches the pinned version (43.1.1)

### Real bug found and fixed: nodejs-whisper doesn't work here

The first version of `native/whisper.js` used `nodejs-whisper`. Running the
actual app surfaced `exec: Unable to find a path to the node binary` on
every transcription attempt. The real problem was worse than that message
suggests: `nodejs-whisper`'s auto-download step doesn't just fetch a model,
it compiles whisper.cpp from source with CMake on every fresh install. That
needs a full C++ build toolchain (Visual Studio Build Tools on Windows) that
no one downloading this app will have installed, and it also spawns
processes assuming `process.execPath` resolves to a `node` binary, which
under Electron resolves to `electron.exe` instead.

Fixed by dropping `nodejs-whisper` entirely and running Whisper through
`@huggingface/transformers` (same library and pattern as translation, no
compilation, ships as ONNX weights), with `ffmpeg-static` (a prebuilt
binary, downloaded precompiled at install time, not built from source)
handling the WebM-to-WAV decode step. No build toolchain required anywhere
in this path now.

### More real bugs found from actual runs, all fixed

- **Transcription silently produced nothing, no error anywhere**: the
  microphone stream itself was fine (Windows confirmed real access in its
  own privacy log), but `session.defaultSession.setPermissionRequestHandler`
  in `main.js` was comparing the page's live origin against `https://demist.app`,
  while production actually redirects to `https://www.demist.app`, an
  origin mismatch that silently denied the mic permission. `main.js` now
  points at the real canonical URL and compares hostnames with `www.`
  stripped from both sides, so it's correct regardless of redirect
  direction.
- **`session.defaultSession` accessed before `app.whenReady()`** threw
  `Session can only be received when app is ready` on every launch. Moved
  the permission handler setup inside the `whenReady()` callback.
- **Adding that permission handler broke Screen Wake Lock** (`Wake lock
  request failed: NotAllowedError`) as an unintended side effect: it only
  allowed `'media'`, and Electron has no dedicated `'wake-lock'` permission
  type (confirmed from Electron's own type definitions): wake lock
  requests land under the generic `'unknown'` bucket, which the handler was
  denying. Now allows both.
- **Term detection crashed every call**: `A context size of 24 is too large
  for the available VRAM`. node-llama-cpp auto-detects GPU and picks a
  configuration that doesn't fit on a machine without much dedicated VRAM,
  very common on laptops with only integrated graphics. `native/llm.js` now
  forces `gpu: false`, trading GPU speed for universal CPU reliability,
  which matters more given the small tier's whole point is running on
  whatever laptop a student actually has.
- **Model downloads were completely silent**: a multi-GB first-run download
  in progress and an actual stall looked identical from the console (both:
  no output at all). All three native modules now log download progress at
  10% steps via the shared `native/progressLog.js`.

What's still **not** verified: real transcription accuracy and term
detection quality/usefulness over a full recording, now that the pipeline
actually runs without crashing.

## Setup

```bash
cd desktop
npm install
npm start
```

By default this loads `https://demist.app`. To point at your local dev
server instead:

```bash
DEMIST_DESKTOP_URL=http://localhost:3000 npm start
```

(run `npm run dev` in `web/` first)

## What to verify locally

1. **App launches and loads the site** in its own window.
2. **Start a recording** and confirm text actually appears. First call to
   `native/whisper.js` downloads the `Xenova/whisper-base.en` ONNX model
   (exact size unverified, expect the first chunk to be slow while it does).
3. **Term cards appear**, sourced entirely from the local LLM now
   (`native/llm.js` via `runDetection()` in `dashboard/page.tsx`), no
   network call to the cloud edge function should fire at all inside this
   app. First call triggers a ~2GB model download (small tier) to
   `~/.demist/llm-models`.
4. **Translation**, if a language is set in Profile: term-definition
   translations and the live bilingual transcript view both route through
   `native/translate.js` now, falling back to it only when Chrome's own
   on-device Translator isn't usable inside Electron's bundled Chromium
   (untested whether Chrome's API even works in that context; the bundled
   model is what actually guarantees this works either way). Each language
   pair downloads its own small model on first use.
5. **Model tier toggle** in Profile (Small/Large), only appears when
   `window.demistNative` is present, i.e., running inside this app.
   Switching to Large downloads a ~4.9GB model on first use after the
   switch, worth confirming that download actually completes and the next
   `detectTerms` call picks up the new model.
6. **Quality check, not just "does it run"**: sit through a real lecture-style
   recording and judge whether the small-tier term detection is actually
   useful (missed terms, wrongly-flagged common words). This is the one
   piece where "it works" and "it works well" are genuinely different
   questions, per the earlier tradeoff discussion.

## What's still open

- **MSIX/Microsoft Store fields** in `electron-builder.yml`
  (`identityName`, `publisher`) are placeholders, real values come from
  reserving the app name in Partner Center.
- **Translation model IDs** in `native/translate.js`: only
  `Xenova/opus-mt-en-es` is confirmed to exist on Hugging Face; the other
  four language pairs follow the same naming convention but should be
  checked individually before shipping.

## Testing modules standalone (without the full Electron GUI)

Each native module is plain Node and can be exercised directly:

```bash
node -e "require('./native/whisper').transcribe(require('fs').readFileSync('test.webm'), 'audio/webm').then(console.log)"
node -e "require('./native/translate').translate('Hello world', 'es').then(console.log)"
node -e "require('./native/llm').detectTerms('The mitochondria is the powerhouse of the cell.', '').then(console.log)"
```

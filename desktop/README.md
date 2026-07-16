# Demist Desktop

Electron shell that loads the existing web app and adds fully on-device
transcription, translation, and term detection through a native bridge.
No lecture audio or text reaches Groq, OpenAI, or anywhere else when
running inside this app — see `main.js` for why the window loads your
normal deployment rather than bundling a separate copy of the UI.

## Status

Scaffolded and dependency-verified, not yet run end-to-end. Everything
below was actually confirmed in this environment:

- `npm install` succeeds cleanly (443 packages, 0 vulnerabilities)
- Every native module resolves with the exact API surface the code calls:
  `nodewhisper` (nodejs-whisper), `getLlama`/`LlamaChatSession`/`resolveModelFile`
  (node-llama-cpp), `pipeline` (@huggingface/transformers), onnxruntime-node
- The Electron binary downloads and matches the pinned version (43.1.1)

What's **not** verified, because this environment has no display or
microphone: does a recording session actually produce a transcript, is
term-detection output actually well-formed and useful, does the translate
pipeline actually download and run its ONNX model correctly. That needs a
real run on your machine.

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
2. **Start a recording** and confirm text actually appears — first call to
   `native/whisper.js` triggers a `base.en` model auto-download
   (~140MB) to `~/.demist/whisper-models`, so the first chunk will be slow.
3. **Term cards appear**, sourced entirely from the local LLM now
   (`native/llm.js` via `runDetection()` in `dashboard/page.tsx`) — no
   network call to the cloud edge function should fire at all inside this
   app. First call triggers a ~2GB model download (small tier) to
   `~/.demist/llm-models`.
4. **Translation**, if a language is set in Profile: term-definition
   translations should now route through `native/translate.js` (falling
   back to it only when Chrome's own on-device Translator isn't usable).
   Each language pair downloads its own small model on first use.
5. **Model tier toggle** in Profile (Small/Large) — only appears when
   `window.demistNative` is present, i.e., running inside this app.
   Switching to Large downloads a ~4.9GB model on first use after the
   switch — worth confirming that download actually completes and the next
   `detectTerms` call picks up the new model.
6. **Quality check, not just "does it run"**: sit through a real lecture-style
   recording and judge whether the small-tier term detection is actually
   useful (missed terms, wrongly-flagged common words) — this is the one
   piece where "it works" and "it works well" are genuinely different
   questions, per the earlier tradeoff discussion.

## What's still open

- **MSIX/Microsoft Store fields** in `electron-builder.yml`
  (`identityName`, `publisher`) are placeholders — real values come from
  reserving the app name in Partner Center.
- **Translation model IDs** in `native/translate.js` — only
  `Xenova/opus-mt-en-es` is confirmed to exist on Hugging Face; the other
  four language pairs follow the same naming convention but should be
  checked individually before shipping.
- **The live bilingual transcript view** (sentence-by-sentence, separate
  from term definitions) still only uses Chrome's on-device Translator —
  it isn't routed through `native/translate.js` yet. Worth doing if Chrome's
  API turns out not to work inside Electron's bundled Chromium (untested).

## Testing modules standalone (without the full Electron GUI)

Each native module is plain Node and can be exercised directly:

```bash
node -e "require('./native/whisper').transcribe(require('fs').readFileSync('test.webm'), 'audio/webm').then(console.log)"
node -e "require('./native/translate').translate('Hello world', 'es').then(console.log)"
node -e "require('./native/llm').detectTerms('The mitochondria is the powerhouse of the cell.', '').then(console.log)"
```

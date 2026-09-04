# Demist for macOS — build & distribution plan

Status: **CI build succeeds, real-hardware verification blocked - no Mac
exists anywhere in this project's reach.** Updated 2026-09-04 after actually
triggering the workflow (see below). `electron-builder.mac.yml` built
cleanly on the first real run on a `macos-14` (Apple Silicon) GitHub Actions
runner - no config bugs found, contrary to this plan's own expectation that
a never-executed native-module packaging config would fail its first run.
Produced an 827MB `.dmg`/`.zip` artifact (run
[33886095755](https://github.com/demist-app/demist/actions/runs/33886095755),
278s). A second run
([33886991579](https://github.com/demist-app/demist/actions/runs/33886991579))
added a CI step (`npm run test:mac-verify`, see `test/mac-hardware-verify.js`)
that runs the real transcription/term-detection/translation pipeline against
real cached models on that same runner - see the "what got verified through
CI" note below §7 for what that can and cannot prove.

**What's actually blocking §7 now is not engineering, it's hardware access:**
neither this session nor the user has a physical Mac, and the sandboxed
Windows dev environment this was built from cannot even download the
workflow's own build artifacts (network egress to
`productionresultssa2.blob.core.windows.net`, where GitHub redirects artifact
and log downloads, is not reachable from here - confirmed by a 302 that
then hangs). So the `.dmg` exists and CI says the native pipeline produces
real output on arm64 macOS, but nobody has clicked through Gatekeeper,
granted a mic permission, or opened the packaged `.app` even once. See §7 for
exactly what is and isn't checked off, and the question at the bottom of this
file for what's needed to close the gap.

Decisions confirmed by the user: Apple Silicon only for v1 (no Intel), reuse
existing brand assets rather than commission new ones, ship independently of
any change to the web version's trial/limits.

Written 2026-09-04 after auditing the actual Windows build
(`electron-builder.yml`, `main.js`, `scripts/`) rather than assuming what it
does.

**Hard constraint driving every decision here: no Apple Developer Program
membership ($99/year) until the product makes money.** That means no code
signing certificate, no notarization. Everything below is designed to work
without either, while leaving a clean, no-rearchitecting upgrade path for the
day that changes (marked "ONCE PAID" throughout).

**No Mac hardware was available to write or test this plan.** Everything here
is either (a) verified against the actual source of this repo, (b) verified
against `node-llama-cpp` / `onnxruntime-node`'s published package layout, or
(c) explicitly flagged as **NEEDS REAL MAC VERIFICATION**. Do not skip those
checks — this project's own history (two rejected Windows Store submissions,
both caught only by running the packaged app on real hardware, never by
reading config) is the reason to take that seriously here too.

---

## 1. What's already fine, verified from the actual code

Don't "fix" these — they already work correctly:

- **`scripts/bundle-vcredist.js`** (the `afterPack` hook) already guards itself
  with `if (context.electronPlatformName !== 'win32') return` at line 35. Wire
  it into the mac build unchanged — it will no-op there. It only exists to fix
  a Windows-specific DLL problem that has no macOS equivalent at all.
- **`scripts/start.js`** (the `npm start` dev launcher) already branches
  correctly: `taskkill` on `win32`, `child.kill('SIGTERM')` otherwise. Works
  on Mac unmodified.
- **`main.js`'s worker-forking logic** (`fork(path.join(NATIVE_DIR,
  'worker.js'), ...)`) uses `child_process.fork` + `path.join` with no
  hardcoded Windows paths or `.exe` assumptions. Should work identically
  inside a `.app` bundle's different directory layout, but confirm this with
  a real launch (see §7) — bundle layout differs enough between platforms
  (`Contents/Resources/app.asar.unpacked/...` vs `resources\app.asar.unpacked\...`)
  that "should" isn't "does."
- **`scripts/fetch-models.mjs`** is pure `path.join`, no platform branching
  needed — it downloads the same OS-agnostic Whisper model weights either way.
- **The native npm dependencies already ship real Mac builds.** Confirmed by
  reading `node_modules/node-llama-cpp/package.json`'s `optionalDependencies`:
  `@node-llama-cpp/mac-arm64-metal` (Apple Silicon, **with Metal GPU
  acceleration** — the Mac equivalent of the CUDA/Vulkan speedup already
  relied on for Windows term detection) and `@node-llama-cpp/mac-x64` (Intel).
  `onnxruntime-node` has a confirmed `darwin/arm64` prebuilt binary present
  in this repo's `node_modules` already (pulled incidentally as part of the
  cross-platform prebuild set onnxruntime ships). None of this needs
  vendoring or manual work — `npm install` running natively on a Mac (or a
  macOS CI runner) will pull the right platform binaries automatically, the
  same way this Windows dev machine's `npm install` only pulled `win-*`
  variants.

## 2. What genuinely needs building

### 2a. A separate electron-builder config, not a shared one

**Built: `desktop/electron-builder.mac.yml`.** Read that file directly rather
than trusting a copy pasted here — this section explains the reasoning, not
the config itself, so the two can't drift apart the way `review_log`'s
undocumented migration did earlier in this project's history.

Deliberately **not** the existing `electron-builder.yml` extended with
per-platform `files` overrides. That merge behavior (does a `mac.files` list
replace or extend the top-level `files` list?) isn't something to guess at
for a config this load-bearing — get it wrong and the *Windows* build
(currently live on the Store) silently breaks too. A fully separate file has
zero risk of cross-contamination, and it's how most real multi-platform
Electron projects with meaningfully different per-platform packaging needs
(which this one clearly has — look at how much Windows-only material is in
the current file) actually structure it.

What it does, at a glance:

- Reuses `scripts/bundle-vcredist.js` as the `afterPack` hook unchanged — it
  already guards itself with `context.electronPlatformName !== 'win32'`, so
  it no-ops on this build. No Mac equivalent of that Windows DLL problem
  exists.
- `mac.icon: build/icon-1024.png` — see §2c for where this came from.
- `mac.target`: `dmg` + `zip`, **`arch: [arm64]` only** — see the note below
  on why Intel isn't in v1.
- `hardenedRuntime: true` and `entitlements: build/entitlements.mac.plist`
  (§2b) from day one, even though neither is strictly required without
  notarization — turning Hardened Runtime on *later*, only once paying for
  Apple Developer, is exactly the kind of "worked fine unsigned, breaks the
  day signing gets added" surprise worth avoiding by building this way from
  the start.
- Deliberately **no `identity:` key.** Without one, electron-builder ad-hoc
  signs automatically — required just for the binary to *execute* at all on
  Apple Silicon, not a trusted Developer ID signature, and does not satisfy
  Gatekeeper. See §5 for the exact additive change once that's paid for.
- The `!node_modules/@node-llama-cpp/win-*` / `linux-*` and
  `onnxruntime-node/.../win32` / `linux` exclusions are defensive, not
  load-bearing in the normal case: a clean `npm install` run natively on
  macOS never pulls Windows/Linux optional-dependency binaries in the first
  place. They guard against a node_modules that was populated
  cross-platform (a shared CI cache, a monorepo install) shipping the wrong
  binaries by accident. Worth knowing: the *existing* Windows config
  excludes a path (`node_modules/node-llama-cpp/bins/mac-*`) that doesn't
  exist in this repo's installed `node-llama-cpp` v3.19.0 layout at all —
  real per-platform binaries live under the separate
  `@node-llama-cpp/<platform>` packages now, not
  `node-llama-cpp/bins/<platform>`. That Windows exclusion is very likely
  already dead weight; the Mac config's exclusions were written against the
  layout actually confirmed in this repo, not copied from the stale pattern.

Notes on the choices above:

- **Apple Silicon (`arm64`) only, for the first release.** Intel Mac
  (`x64`) support is real but doubles the CI matrix, doubles the native
  binaries to verify, and Apple Silicon has been the default for every new
  Mac since ~2020 — it covers the large majority of the realistic student
  audience. Treat `x64` as a fast-follow, not part of v1. If it's wanted
  later: add `arch: [arm64, x64]` to both targets, add `@node-llama-cpp/mac-x64`
  and confirm `onnxruntime-node/bin/napi-v6/darwin/x64` actually exists for
  the installed onnxruntime-node version (NOT confirmed in this repo's
  current install — only `darwin/arm64` is present locally). Do NOT attempt a
  true universal (arm64+x64 combined) binary for the first pass; it requires
  forcing both sets of native optional-dependencies to install simultaneously
  (`npm install --os=darwin --cpu=x64` then again for `arm64`, or similar),
  which is extra complexity for no real benefit over two separate downloads.
- **`category: public.app-category.education`** — pick from Apple's fixed
  list (`public.app-category.*`); education fits a lecture-transcription tool
  better than the generic default and matters for eventual Mac App Store
  submission, if that's ever pursued.
- **`hardenedRuntime: true` from day one**, even though it's not strictly
  required without notarization. Turning it on later, once paying for Apple
  Developer, is exactly the kind of "worked fine unsigned, breaks when
  signing gets added" surprise worth avoiding by just building with it from
  the start.

### 2b. Entitlements file

Native `.node` addons (onnxruntime, llama.cpp bindings) need explicit
entitlements to load under Hardened Runtime, and mic access needs its own
entitlement separate from the `NSMicrophoneUsageDescription` string in `mac.extendInfo`
above (that string is what shows in the permission dialog; this is what
actually grants the capability).

**Built: `desktop/build/entitlements.mac.plist`.** `disable-library-validation`
and `allow-unsigned-executable-memory` matter specifically because the native
`.node` binaries (onnxruntime, llama.cpp) aren't signed by Apple or by a
matching Developer ID — without those two entitlements, Hardened Runtime
refuses to load them at all, and the app would launch fine and then fail
silently the moment it tried to transcribe or detect a term. `network.client`
because the app loads its UI from demist.app and calls Supabase (matches the
Windows `internetClient` capability declaration in the existing config, same
underlying requirement).

### 2c. App icon

**Built: `desktop/build/icon-1024.png`.** Not a reuse of the existing
512×512 raster (`web/public/icon-512.png`) — rendered fresh at 1024×1024
(electron-builder's recommended size for full Retina-quality `.icns`
generation) straight from the real vector source, `web/app/icon.svg`, using
`sharp` (already present as an electron-builder transitive dependency, no
new tooling needed). One rejected option worth recording: `mobile/assets/icon.png`
is also 1024×1024 and was the obvious first guess for "reuse what we have,"
but it turned out to be a stale, unfinished placeholder — a completely
different blue "A" mark with visible Figma guide lines still baked into the
export, not the current amber-waveform Demist brand. Don't reuse it anywhere
else either; it should probably be cleaned up or replaced next time the
mobile app scaffold gets real attention.

`mac.icon` in `electron-builder.mac.yml` points straight at this PNG —
electron-builder auto-generates the full `.icns` set from it at build time,
the same way the Windows config points `icon:` straight at a PNG for `.ico`
generation. No macOS-only tooling (`iconutil`) needed to pre-build anything.

### 2d. `package.json` script

**Built:** `"dist:mac": "electron-builder --mac -c electron-builder.mac.yml"`,
added alongside the existing `"dist": "electron-builder --win appx"`
(untouched).

## 3. CI: GitHub Actions macOS runner

**Built: `.github/workflows/desktop-mac-build.yml`** (repo root, not under
`desktop/` — GitHub only discovers workflows there). No Mac hardware in this
session means no local build/test loop — everything here has to run on a
macOS GitHub Actions runner instead. This also solves distribution: build
artifacts can be published straight from CI. Both the workflow YAML and
`electron-builder.mac.yml` were validated with `js-yaml` (already vendored
as an electron-builder dependency) for syntax errors before committing —
real coverage against electron-builder's own schema still only comes from an
actual run, which needs the macOS runner this session doesn't have.

Triggers on a `desktop-v*` tag push, or manually via `workflow_dispatch`.
What it does, briefly (read the file for the exact steps):

- `npm ci`, then `node scripts/fetch-models.mjs` for the bundled Whisper models
- A verification step that fails the build loudly if
  `@node-llama-cpp/mac-arm64-metal` or `onnxruntime-node/.../darwin/arm64`
  didn't actually get installed — the exact failure mode this project's own
  history warns about repeatedly: a package that looks healthy and produces
  no transcript, discovered only by running it, never by reading config.
- `npm run dist:mac`, with `CSC_IDENTITY_AUTO_DISCOVERY: false` so
  electron-builder doesn't hunt for a local certificate that doesn't exist on
  a fresh runner and fail with a confusing error
- Uploads the `.dmg`/`.zip` as a workflow artifact — **not** auto-published to
  a Release yet. Attach it to a Release by hand for the first several builds
  while the pipeline itself is being trusted; wiring up `--publish always` is
  a good next step once a manual release or two has gone smoothly, not
  before.

The `ONCE PAID` env vars for `CSC_LINK` / `APPLE_ID` / etc. are already
present in the file as commented-out lines in the build step, ready to
uncomment alongside adding the matching GitHub Secrets — see §5.

Trigger a build by tagging: `git tag desktop-v1.0.0-mac && git push origin desktop-v1.0.0-mac`.

## 4. Distribution: GitHub Releases + a Homebrew tap

Both paths described to the user already; concretely:

### 4a. Direct download (primary path)

Attach the `.dmg` from the Actions artifact (§3) to a GitHub Release on the
main `demist-app/demist` repo. Landing page links straight to it.

**The install will hit Gatekeeper's block dialog** — "Demist can't be opened
because Apple cannot verify it is free of malware," with no direct "Open"
option on current macOS. The real recovery path: System Settings → Privacy &
Security → scroll down → "Open Anyway" → re-authenticate. This needs to be
documented on the support page (§6) with enough clarity that it doesn't read
as broken — because without paying for notarization, this step is not
optional, it's the actual first-run experience every Mac user will hit.

### 4b. Homebrew tap (secondary, technical-user path)

A **separate**, small repo: `demist-app/homebrew-demist`. One file,
`Casks/demist.rb`:

```ruby
cask "demist" do
  version "1.0.0"
  sha256 "<sha256 of the released .dmg or .zip - recompute per release>"

  url "https://github.com/demist-app/demist/releases/download/desktop-v#{version}-mac/Demist-#{version}-arm64.dmg"
  name "Demist"
  desc "Live lecture transcription, glossary, and flashcards"
  homepage "https://demist.app"

  depends_on macos: ">= :big_sur"
  depends_on arch: :arm64

  app "Demist.app"

  zap trash: [
    "~/.demist",
    "~/Library/Application Support/Demist",
    "~/Library/Preferences/app.demist.desktop.plist",
  ]
end
```

Homebrew Cask strips the quarantine attribute during install — this is why
an app installed via `brew install --cask` opens cleanly with **no** Gatekeeper
dialog at all, unlike a browser download of the identical file. Not a
loophole; it's documented Homebrew Cask behavior, used by plenty of
legitimate unsigned open-source Mac software.

Install instructions to publish alongside the direct-download link:
```
brew tap demist-app/demist
brew install --cask demist
```

Updating the cask's `version`/`sha256` after each release is a manual,
two-line edit for now — not worth automating (a bot PR, `brew bump-cask-pr`
tooling) until releases are frequent enough for the manual step to be
annoying. Compute the sha256 with `shasum -a 256 Demist-1.0.0-arm64.dmg`
right after downloading the built artifact from the Actions run.

## 5. ONCE PAID: what changes

When the Apple Developer Program membership exists, the upgrade path is
additive, not a rewrite:

1. Add `identity: "Developer ID Application: ..."` to `mac.identity` in
   `electron-builder.mac.yml`.
2. Add `desktop/scripts/notarize.js`:
   ```js
   const { notarize } = require('@electron/notarize')
   exports.default = async function notarizeApp(context) {
     if (context.electronPlatformName !== 'darwin') return
     if (!process.env.APPLE_ID) { console.log('  • notarize  skipped (no credentials)'); return }
     await notarize({
       appBundleId: 'app.demist.desktop',
       appPath: `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`,
       appleId: process.env.APPLE_ID,
       appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
       teamId: process.env.APPLE_TEAM_ID,
     })
   }
   ```
   Add `afterSign: ./scripts/notarize.js` to `electron-builder.mac.yml`.
3. Uncomment the `CSC_LINK`/`APPLE_ID`/etc. env vars in the GitHub Actions
   workflow and add the matching repo Secrets.
4. Nothing else changes — the same workflow, same config file, same Homebrew
   cask all keep working; they just produce a properly signed, notarized
   build instead of an ad-hoc one, and the Gatekeeper dialog in §4a
   disappears entirely.

## 6. Web app changes needed (separate from the desktop build itself)

These live in `web/`, not `desktop/`, and mirror patterns already established
there this session for the Windows Store rollout:

- **`web/lib/links.ts`**: add `MAC_DOWNLOAD_URL` (the GitHub Release asset
  link) and `MAC_HOMEBREW_TAP` alongside the existing `MS_STORE_URL`. Same
  file already centralizes install links specifically because they drifted
  into multiple copies once before — don't repeat that.
- **`web/app/landing-client.tsx`**: a Mac-equivalent section next to the
  existing Windows Store section, OR basic platform detection (there's
  already an `isMacSafari()`-style UA check pattern in
  `web/components/InstallPrompt.tsx` to copy) to show the right download
  button automatically based on the visitor's OS.
- **`web/app/support/page.tsx`**: a new FAQ section, "Installing on Mac,"
  walking through the exact Gatekeeper override steps from §4a. This is not
  optional polish — without notarization, this documentation is load-bearing
  for whether anyone successfully installs at all.

## 7. Verification checklist (needs a real Mac — cannot be done in CI alone)

CI proves the build *completes*. None of the following can be confirmed by a
green CI run, and this project's own history says exactly that gap is where
real bugs hid on Windows.

**What CI now additionally proves, as of the `test:mac-verify` step added
2026-09-04** (`test/mac-hardware-verify.js`, runs on every mac build after the
artifact upload): the real `native/whisper.js`, `native/llm.js` and
`native/translate.js` code paths — the same ones the packaged app calls —
actually produce real transcription text, a real term-detection LLM answer,
and real OPUS-MT translations, on the same `macos-14` arm64 runner that
built the package, plus which GPU backend `node-llama-cpp` picked
(`llama.gpu`, logged and asserted through a `::notice::`/`::error::`
annotation since this sandboxed dev environment cannot download full job
logs — see the check-run annotations on the run instead). **What it does NOT
prove**: whether that GPU backend is `'metal'` on a *physical* Mac — a
virtualized CI runner's GPU passthrough is a separate question from a real
machine's, not yet answered either way — and nothing below the OS-permission
layer (Gatekeeper, the mic permission dialog, `/Applications` launch) is
touched by a headless `node` process at all. Treat a pass here as "the engine
runs", not as a substitute for anything below.

- [ ] Downloaded `.dmg` via a real browser (not `curl`) on a Mac that has
      never had this app installed before, so quarantine is actually set and
      the real Gatekeeper flow can be observed end to end.
      **NOT DONE — no Mac available to this session or the user; the .dmg is
      built (see Status above) but nobody has downloaded it onto a Mac yet.**
- [ ] Gatekeeper's "Open Anyway" recovery path (§4a) actually works as
      documented on a current macOS version. **NOT DONE**, same blocker.
- [ ] App launches from `/Applications` without crashing. **NOT DONE**, same
      blocker.
- [ ] Microphone permission prompt appears and, once granted, live
      transcription actually produces text (not a silent no-op — this is the
      exact failure class the Windows Store rejection was, and mic access is
      the one macOS entitlement this build depends on most directly).
      **PARTIALLY COVERED, not truly done**: `test:mac-verify` confirms
      `native/whisper.js` transcribes real audio to real text on this
      runner's arm64 macOS (see run 33886991579) — but that is a fixture WAV
      fed directly to the module, not a real mic captured through the
      packaged `.app`'s permission dialog and Electron's actual audio
      capture path. The permission-dialog half is **NOT DONE**.
- [ ] Term detection loads and runs — ideally confirm Metal is actually
      engaging (Activity Monitor's GPU history, or comparable timing to the
      "~4x faster with GPU offload" figure already measured on Windows) not
      silently falling back to slow CPU-only inference. **PARTIALLY
      COVERED**: `test:mac-verify` logs `node-llama-cpp`'s actual
      `llama.gpu` value and gets real answers from `llm.explain` on this
      runner — check the run's annotations for the exact backend string.
      Activity Monitor GPU history specifically requires a physical machine
      and is **NOT DONE**.
- [ ] Translation (OPUS-MT models) works. **COVERED** by `test:mac-verify`
      (two real translations, en→es and en→fr, against the real bundled
      model family) to the extent a headless run can cover it — no UI
      involved either way, so this one item is about as done as CI can make
      it.
- [ ] Test on as clean a machine as realistically available — a fresh user
      account at minimum, ideally not the primary dev Mac, which will have
      Xcode Command Line Tools and other developer tooling already present
      that could mask a dependency a genuinely clean machine lacks. This is
      the direct Mac analogue of the Windows Store rejection: it passed on a
      dev machine and failed only on Microsoft's clean test hardware.
      **NOT DONE** — arguably closer to satisfied than a random dev's Mac
      would be, since a fresh GitHub Actions runner has no prior state at
      all, but it is not a substitute for a real clean *physical* machine
      (see the GPU-passthrough caveat above — virtualized and physical
      hardware are not guaranteed to behave identically here).
- [ ] `brew install --cask demist` (§4b) actually installs without a
      Gatekeeper prompt, confirming the quarantine-strip behavior holds for
      this specific cask setup. **NOT DONE, and deliberately not started**:
      the plan's own §5 ordering is to stand up the Homebrew tap only once a
      build is confirmed working end to end on real hardware, which hasn't
      happened yet (see Status above). Setting up `demist-app/homebrew-demist`
      now would be getting ahead of that.

**Closing this gap needs one of:** the user (or anyone) with physical access
to an Apple Silicon Mac downloading the `.dmg` from
[the workflow artifact](https://github.com/demist-app/demist/actions/runs/33886991579)
(requires being logged into GitHub — Actions artifacts, unlike Release
assets, are never publicly downloadable) and working through this checklist
by hand; or attaching the artifact to a GitHub Release (public, no login
needed) once someone can actually test it, per §4a. Neither this session nor
the user has that hardware right now — see the note at the end of this
document.

# Demist for macOS — build & distribution plan

Status: not started. This is a complete spec for a fresh agent to implement,
written 2026-09-04 after auditing the actual Windows build (`electron-builder.yml`,
`main.js`, `scripts/`) rather than assuming what it does.

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

Do **not** try to make the existing `electron-builder.yml` handle both
platforms via electron-builder's per-platform `files` merging. That merge
behavior (does a `mac.files` list replace or extend the top-level `files`
list?) isn't something to guess at for a config this load-bearing — get it
wrong and the *Windows* build (currently live on the Store) silently breaks
too. Create a fully separate file instead: `desktop/electron-builder.mac.yml`.
Zero risk of cross-contamination, and it's how most real multi-platform
Electron projects with meaningfully different per-platform packaging needs
(which this one clearly has — look at how much Windows-only material is in
the current file) actually structure it.

Draft content:

```yaml
appId: app.demist.desktop
productName: Demist
files:
  - main.js
  - preload.js
  - native/**/*
  - licenses/**/*
  - models/**/*
  # Universal, not platform-specific - always exclude accidental model cache
  # (measured at 1.6GB in a real Windows build; see electron-builder.yml's
  # comment on this exact exclusion for why it can silently reappear).
  - "!node_modules/@huggingface/transformers/.cache${/*}"
  # Defensive excludes for the OTHER platforms' native binaries. These are
  # likely NO-OPS in practice - see the note below - but keep them so a build
  # from a node_modules that WAS populated cross-platform (a shared CI cache,
  # a monorepo install, anyone who ran `npm install --include=optional`
  # broadly) can't accidentally ship Windows/Linux binaries in a Mac package.
  # VERIFY THESE EXACT PATHS on the actual mac CI runner before trusting them
  # (`ls node_modules/@node-llama-cpp/` and `ls node_modules/onnxruntime-node/bin/napi-v6/`)
  # - node-llama-cpp's on-disk layout has changed across major versions, and
  # the CURRENT Windows electron-builder.yml already excludes a path
  # (`node_modules/node-llama-cpp/bins/mac-*`) that doesn't exist in this
  # repo's installed v3.19.0 layout at all (real per-platform binaries live
  # under the separate `@node-llama-cpp/<platform>` packages, not
  # `node-llama-cpp/bins/<platform>`) - meaning that specific Windows
  # exclusion is likely already dead weight, not saving anything. Don't
  # copy it uncritically; confirm the real layout first.
  - "!node_modules/@node-llama-cpp/win-*${/*}"
  - "!node_modules/@node-llama-cpp/linux-*${/*}"
  - "!node_modules/onnxruntime-node/bin/napi-v6/win32${/*}"
  - "!node_modules/onnxruntime-node/bin/napi-v6/linux${/*}"
  - "!node_modules/@huggingface/transformers/node_modules/onnxruntime-node/bin/napi-v6/win32${/*}"
  - "!node_modules/@huggingface/transformers/node_modules/onnxruntime-node/bin/napi-v6/linux${/*}"

asarUnpack:
  - native/**/*
  - node_modules/**/*
  - models/**/*
  # Same reasoning as the Windows config: the worker.js child processes are
  # forked from outside the asar and Node's module resolution never looks
  # inside app.asar/node_modules from there. Unpacking everything wholesale
  # (not chasing the dependency closure by hand) is deliberate for the same
  # reason it was on Windows - a single miss is a silently broken build that
  # looks healthy right up until a recording produces no text, and it isn't
  # caught by reading the config.

afterPack: ./scripts/bundle-vcredist.js  # no-ops on darwin, safe to keep as-is

mac:
  category: public.app-category.education
  icon: build/icon.icns   # see §2c - needs creating, doesn't exist yet
  target:
    - target: dmg
      arch: [arm64]
    - target: zip
      arch: [arm64]
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  extendInfo:
    NSMicrophoneUsageDescription: "Demist needs microphone access to transcribe your lecture."
  # Deliberately no `identity:` key. Without one, electron-builder ad-hoc-signs
  # automatically (required just for the binary to EXECUTE on Apple Silicon -
  # NOT a trusted Developer ID signature, and does NOT satisfy Gatekeeper).
  # ONCE PAID: add
  #   identity: "Developer ID Application: <Name> (<TeamID>)"
  # and wire scripts/notarize.js as the afterSign hook (see §5).

dmg:
  sign: false
```

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

### 2b. Entitlements file (new)

Native `.node` addons (onnxruntime, llama.cpp bindings) need explicit
entitlements to load under Hardened Runtime, and mic access needs its own
entitlement separate from the `NSMicrophoneUsageDescription` string in `mac.extendInfo`
above (that string is what shows in the permission dialog; this is what
actually grants the capability).

Create `desktop/build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.device.audio-input</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
```

`disable-library-validation` and `allow-unsigned-executable-memory` matter
specifically because the native `.node` binaries (onnxruntime, llama.cpp)
aren't signed by Apple or by a matching Developer ID — without this,
Hardened Runtime refuses to load them. `network.client` because the app
loads its UI from demist.app and calls Supabase (matches the Windows
`internetClient` capability declaration in the existing config, same
underlying requirement).

### 2c. App icon (new — none exists yet)

Only PNGs exist right now (`web/public/icon-512.png` at 512×512,
`apple-touch-icon.png`). electron-builder can auto-generate a full `.icns`
from a single source PNG, but wants **1024×1024** for best quality on Retina
displays — 512 will technically work but isn't ideal. Either:

- Generate a 1024×1024 version of the existing icon artwork and point
  `mac.icon` at that PNG directly (electron-builder auto-converts), or
- Pre-build `desktop/build/icon.icns` with `iconutil` (macOS-only tool) from
  a full `.iconset` folder, if precise control over each resolution matters.

The PNG-in, auto-convert path is simpler and matches how the Windows build
already handles its `.ico` (`icon: ../web/public/icon-512.png` directly, no
manual `.ico` file). Do the same for consistency unless quality problems show
up in testing.

### 2d. `package.json` script

```json
"dist:mac": "electron-builder --mac -c electron-builder.mac.yml"
```

Leave the existing `"dist": "electron-builder --win appx"` untouched.

## 3. CI: GitHub Actions macOS runner

No Mac hardware in this session means no local build/test loop — everything
here has to run on a macOS GitHub Actions runner instead. This also solves
distribution: build artifacts can be published straight from CI.

Create `.github/workflows/desktop-mac-build.yml` (repo root, not under `desktop/`):

```yaml
name: Build macOS desktop app

on:
  push:
    tags: ['desktop-v*']
  workflow_dispatch: {}

jobs:
  build-mac:
    runs-on: macos-14   # Apple Silicon (arm64) runner
    defaults:
      run:
        working-directory: desktop
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: npm ci

      - name: Fetch bundled Whisper models
        run: node scripts/fetch-models.mjs

      - name: Verify the right native binaries actually installed
        # Fails loudly here rather than shipping a package that "looks
        # healthy right up until a recording produces no text" - the exact
        # failure mode this project's own history warns about repeatedly.
        run: |
          test -d node_modules/@node-llama-cpp/mac-arm64-metal || (echo "::error::mac-arm64-metal binary missing" && exit 1)
          test -d node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64 || (echo "::error::onnxruntime darwin/arm64 binary missing" && exit 1)

      - name: Build (unsigned / ad-hoc)
        env:
          # Prevents electron-builder from hunting for a local certificate
          # that doesn't exist on a fresh runner and failing confusingly.
          CSC_IDENTITY_AUTO_DISCOVERY: "false"
          # ONCE PAID, uncomment and add the matching GitHub Secrets:
          # CSC_LINK: ${{ secrets.MAC_CERTIFICATE_P12_BASE64 }}
          # CSC_KEY_PASSWORD: ${{ secrets.MAC_CERTIFICATE_PASSWORD }}
          # APPLE_ID: ${{ secrets.APPLE_ID }}
          # APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
          # APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: npm run dist:mac

      - name: Upload build artifact
        uses: actions/upload-artifact@v4
        with:
          name: demist-mac-arm64
          path: |
            desktop/dist/*.dmg
            desktop/dist/*.zip
          retention-days: 30
```

**Start with `upload-artifact`, not auto-publish to a Release.** Attach the
built `.dmg` to a Release by hand for the first several builds while the
pipeline itself is being validated — one less moving part while debugging
whether the *build* even works. Automating straight-to-Release (electron-builder's
`--publish always` plus a `GH_TOKEN`) is a good next step once a manual
release or two has gone smoothly, not before.

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
real bugs hid on Windows:

- [ ] Downloaded `.dmg` via a real browser (not `curl`) on a Mac that has
      never had this app installed before, so quarantine is actually set and
      the real Gatekeeper flow can be observed end to end.
- [ ] Gatekeeper's "Open Anyway" recovery path (§4a) actually works as
      documented on a current macOS version.
- [ ] App launches from `/Applications` without crashing.
- [ ] Microphone permission prompt appears and, once granted, live
      transcription actually produces text (not a silent no-op — this is the
      exact failure class the Windows Store rejection was, and mic access is
      the one macOS entitlement this build depends on most directly).
- [ ] Term detection loads and runs — ideally confirm Metal is actually
      engaging (Activity Monitor's GPU history, or comparable timing to the
      "~4x faster with GPU offload" figure already measured on Windows) not
      silently falling back to slow CPU-only inference.
- [ ] Translation (OPUS-MT models) works.
- [ ] Test on as clean a machine as realistically available — a fresh user
      account at minimum, ideally not the primary dev Mac, which will have
      Xcode Command Line Tools and other developer tooling already present
      that could mask a dependency a genuinely clean machine lacks. This is
      the direct Mac analogue of the Windows Store rejection: it passed on a
      dev machine and failed only on Microsoft's clean test hardware.
- [ ] `brew install --cask demist` (§4b) actually installs without a
      Gatekeeper prompt, confirming the quarantine-strip behavior holds for
      this specific cask setup.

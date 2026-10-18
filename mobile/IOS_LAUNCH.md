# Demist for iPhone and iPad: launch guide

Everything needed to go from "Apple Developer Program approved" to "live on the App Store", from a Windows PC. No Mac is needed: Expo's cloud (EAS) builds, signs and uploads the app.

## What v1 is

The core study loop, on iPhone and iPad:

- **Record a lecture.** You see live text as the lecturer speaks, and a card appears when a new word comes up.
- **"I'm lost".** Press it as many times as you like during a lecture. Each press marks the moment, and afterwards you see what was said around it.
- **Keeps recording with the screen locked.** This uses iOS background audio.
- **Glossary**, **flashcards** (same scheduling as the web, so progress syncs both ways), **lectures** with summaries, and **Settings**: reading comfort, lecturer permission and account deletion.
- **No in-app purchase.** Pro bought on the web or on Windows simply works here. The app never shows prices or upgrade buttons, as App Store rule 3.1.3(b) requires.

## How it works

| Piece | Where it runs | Notes |
|---|---|---|
| Speech to text | **On the phone** (Apple's built-in recogniser) | `requiresOnDeviceRecognition`. The audio never leaves the device. If a phone can't do this, recording **refuses to start** and explains how to turn on Dictation, because otherwise iOS silently sends audio to Apple. |
| Picking possible terms | On the phone | `lib/shared/extractTerms.ts`, the same code as the web. |
| Explaining terms | `detect-terms` edge function (unchanged) | Only the candidate words and the one sentence each came from are sent, the same as the web today. |
| Quality filters, duplicate check | On the phone | `lib/shared/termQuality.ts` and `termSimilarity.ts`, the same code as the web. |
| Summary | `summarize-session` edge function (unchanged) | The server checks recording consent itself. |
| Transcript saving | Supabase, `sessions.transcript` | Same consent rule as the web: saved only if the lecturer gave permission for that module, or the student declared a support need. |

The shared files in `lib/shared/` are **generated** from `web/lib/`. After changing any of these on the web, run `npm run sync-shared` and commit:

- `termQuality`
- `termSimilarity`
- `extractTerms`
- `entitlementRules`
- `age`

Run `npm run check` before every build. It confirms the shared files are current, type-checks the app and bundles it for iOS.

**Verified on Windows (2026-10-18):** type-check, a full iOS Hermes bundle, the final Info.plist and privacy manifest (checked with `expo config --type introspect`), and the term pipeline end to end against the live `detect-terms` with the review account. On biology sentences it kept 6 good terms. Small talk produced no server call at all.

**Not verified, because it needs a real iPhone:** everything in the device test list below.

## Pinned on purpose

`@supabase/supabase-js` is pinned to **2.105.4**. From 2.106 it contains a dynamic `import()` that Hermes refuses to compile, so the iOS build fails. Unpin it only once a newer version passes `npm run check`.

## Step by step, once Apple approves the account

### 1. One-time setup (about 20 minutes)

1. Install the build tool: `npm install -g eas-cli`, then `eas login` (create a free Expo account if needed).
2. Link the project: `cd mobile`, then `eas init`. This adds a `projectId` to `app.json`. Commit it.
3. In [App Store Connect](https://appstoreconnect.apple.com), go to **Apps**, then **+**, then **New App**:
   - Platform: iOS. Name: **Demist** (if it's taken, use **Demist: Lecture Helper**).
   - Primary language: English (U.K.). Bundle ID: `app.demist.mobile` (EAS registers it in step 4; if it isn't listed yet, run step 4 first and come back). SKU: `demist-ios`.
4. Copy the app's **Apple ID** (a number on the App Information page) into `eas.json`, replacing `REPLACE_WITH_APP_STORE_CONNECT_APP_ID`. Copy your **Team ID** (from developer.apple.com, under Membership) in place of `REPLACE_WITH_TEAM_ID`.
5. Set the review account password: `cd web`, then `node scripts/set-review-password.mjs "<a long random password>"`. Keep the password for step 7.
6. **Apply migration `042_session_marks.sql`** if you haven't yet. Without it, "I'm lost" presses aren't kept, on the web or on iOS.

### 2. Test on your own iPhone first

1. `eas device:create`. Open the link on your iPhone to register it.
2. `npm run build:dev`. EAS asks you to sign in with your Apple ID and creates the certificates for you. Install the result from the link it prints.
3. On the PC: `npm start`. Open the Demist dev app on the phone, which connects to your PC.
4. Go through the **device test list** below.

The app **cannot run in Expo Go**, because speech recognition is a native module. Always use the dev build.

### 3. Build and upload for real

```
npm run check
npm run build:ios      # about 15-25 min in Expo's cloud
npm run submit:ios     # uploads to App Store Connect / TestFlight
```

The build number goes up automatically each time. When you release an update, change `"version"` in `app.json` (for example to 1.0.1).

### 4. Fill in the listing (App Store Connect)

- **Category:** Education. Secondary: Productivity.
- **Age rating:** answer "None" to all content questions. Demist's own minimum age is 16 (the app enforces it at sign-up), so choose the **16+** rating if it's offered.
- **Price:** Free. **In-App Purchases:** none.
- **Privacy Policy URL:** https://demist.app/privacy. **Support URL:** https://demist.app/support.
- **Screenshots:** you need iPhone 6.9" (1320×2868) and iPad 13" (2064×2752). Take them on a real device from the TestFlight build, signed in as the review account, which has three ready-made lectures.
- **Encryption:** already declared in the app (HTTPS only, exempt), so App Store Connect won't ask.

### 5. App Privacy answers ("nutrition label")

Set **Tracking: No** for everything.

| Data type | Collected | Linked to user | Purpose |
|---|---|---|---|
| Email address | Yes | Yes | App Functionality |
| User ID | Yes | Yes | App Functionality, Analytics |
| Product interaction | Yes | Yes | Analytics |
| Crash data / other diagnostic data | Yes | Yes | App Functionality |
| Other user content (transcripts, terms, notes) | Yes | Yes | App Functionality |
| Sensitive info (optional support need, e.g. hearing, dyslexia) | Yes | Yes | App Functionality |
| Other data (date of birth, for the 16+ check) | Yes | Yes | App Functionality |
| **Audio data** | **No** | | Speech is turned into text on the device and the audio is never sent. |

### 6. Review notes (paste into App Review Information)

> Demist helps students follow lectures. Tap Record and speak; the iPhone turns speech into text on the device (Apple's on-device speech recognition; no audio is sent anywhere), and explanations of technical words appear as cards.
>
> Sign in: choose "Sign in", enter store-demo@demist.app, and the app asks for a password instead of an email code. Password: <the password from step 1.5>.
>
> Background audio: a lecture is often an hour long and students lock their phone. UIBackgroundModes "audio" keeps the microphone recording and transcribing while the screen is locked. It is only active while the user is recording, and iOS shows its microphone indicator throughout.
>
> Pro: this app has no in-app purchases. A subscription bought on our website unlocks features here (3.1.3(b) Multiplatform Services); the app shows no prices or links to buy.
>
> Account deletion: Settings > Delete account.

### 7. Submit

Use **TestFlight** for a day or two with real students, then go to the version page and choose **Add for Review**. The first review usually takes 1 to 3 days.

## Device test list (do this before the first submission)

1. **A long lecture with the phone locked.** Record 60+ minutes with the screen locked for most of it. Text and term cards should both keep coming. Check `recording_stopped` in PostHog: `restarts` should stay low and `words` should look sensible.
2. **Interruptions.** Take a phone call or trigger Siri mid-recording. Recording should resume by itself afterwards.
3. **Text isn't lost or doubled.** On iOS 17 and on iOS 18 or later, the saved transcript should read cleanly, with no repeated or missing sentences. Apple reports results differently between versions. `lib/recording.tsx` handles both, but this is the part most worth watching.
4. **Dictation off.** Turn off Settings > General > Keyboard > Enable Dictation. Recording should refuse to start with a clear message, and never send audio to Apple.
5. **Read aloud during a recording.** Tap the speaker on a term card. It should speak, and recording should carry on.
6. **"I'm lost".** Press it 3 times, stop, and open the lecture. All 3 moments should be there, with text around each one (this needs migration 042 and lecturer permission or a support need).
7. **iPad**, in portrait and landscape, and in Split View.
8. **Reading comfort.** Try each font, text size, tint, and light and dark mode.
9. **Pro.** Sign in with an account that has Pro on the web. Lectures older than 7 days should show, and no upgrade prompt should appear anywhere.
10. **Delete account** on a throwaway account. You should be signed out, and the data gone on the web too.

## Next version (v1.1), not built yet

- **On-device term explanations** with Apple's Foundation Models (iPhone 15 Pro and later, with Apple Intelligence), keeping `detect-terms` as the fallback. This needs a small Swift module. EAS can build it, but it can only be tested on a real device.
- **iOS 26 SpeechAnalyzer** for better long-lecture transcription.
- A Live Activity on the lock screen showing the recording timer and the latest term.
- Imports, quiz, translation, stats and Notion.

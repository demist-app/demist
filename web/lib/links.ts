// Canonical outbound links to the places Demist can be installed from.
//
// One definition, because these were drifting: the Microsoft Store URL had
// three separate copies (landing page, waitlist emails, confirm page) and the
// install prompt in the app had none at all - it was still telling people the
// desktop app was "on the way" weeks after the Store listing went live.
// Anything that offers an install must import from here.

// Microsoft Store, product 9N4TZSCFHZN8.
//
// The https:// form, not ms-windows-store://. This one opens the Store app
// when the visitor has it and a normal web listing when they do not, so it
// still does something sensible for the Mac and phone visitors who click it.
// The deep link fails outright anywhere except Windows.
export const MS_STORE_URL = 'https://apps.microsoft.com/detail/9N4TZSCFHZN8'

// Chrome Web Store listing. Null until it is live; the UI shows a disabled
// "Soon" button while it is, rather than pointing anywhere misleading.
export const CHROME_STORE_URL: string | null = null

// Where the Mac install CTA points. Deliberately the support page's install
// guide (#mac), NOT a direct .dmg link like MS_STORE_URL is for Windows:
// the Mac build is unsigned/ad-hoc (see desktop/MACOS_BUILD_PLAN.md section
// 5 - no Apple Developer Program membership yet), so opening it needs the
// Gatekeeper "Open Anyway" steps explained there BEFORE a person is handed a
// file that macOS will otherwise just refuse to open with no visible next
// step. The guide itself links to the actual GitHub Release asset.
export const MAC_SUPPORT_URL = '/support#mac'

// The repo's Releases page, not a specific asset URL. A specific .dmg link
// (like Demist-1.0.2-arm64.dmg) embeds the app version and would need
// updating by hand on every release - the Releases page always shows
// whichever is newest with no maintenance here. Built and published by
// .github/workflows/desktop-mac-build.yml on every desktop-v*-mac tag push.
export const MAC_RELEASES_URL = 'https://github.com/demist-app/demist/releases'

// The unpacked-extension beta, built by `npm run build:extension` from
// extension/ into web/public/. Never edit the zip by hand: it is a build
// output, and hand-maintaining it is exactly how it ended up five weeks
// behind the source with a different permissions model.
export const EXTENSION_DOWNLOAD_URL = '/demist-extension.zip'

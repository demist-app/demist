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

// The unpacked-extension beta, built by `npm run build:extension` from
// extension/ into web/public/. Never edit the zip by hand: it is a build
// output, and hand-maintaining it is exactly how it ended up five weeks
// behind the source with a different permissions model.
export const EXTENSION_DOWNLOAD_URL = '/demist-extension.zip'

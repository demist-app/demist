// Builds extension/ into web/public/demist-extension.zip, which is what the
// "Download the Chrome extension" button on the landing page serves.
//
//   npm run build:extension            # rebuild the zip
//   npm run build:extension -- --check # verify the zip matches source, no write
//
// This did not exist until 2026-08-06, and the zip was maintained by hand. It
// drifted, silently, for five weeks: the served build was from 8 June against
// source from 13 July, and the difference was not cosmetic. The old one
// declared host_permissions ["<all_urls>"] and injected content-overlay.js
// into every site; the current one asks for activeTab and injects on demand.
// So everyone who clicked Download got a build asking to "read and change all
// your data on all websites" - a permission that had been deliberately
// removed. Both were stamped version 2.0.0, so nothing on either side could
// tell them apart.
//
// The --check mode exists so that never goes unnoticed again. It is wired into
// `npm run build`, so a Vercel deploy fails rather than shipping a stale zip.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import JSZip from 'jszip'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT_DIR = path.resolve(HERE, '../../extension')
const OUT = path.resolve(HERE, '../public/demist-extension.zip')

// Explicit, not a directory walk. A glob would happily sweep up a stray
// .env, a node_modules, or an editor backup and publish it to the internet;
// this file is the manifest of what ships, and adding a file to the extension
// means adding it here on purpose.
const FILES = [
  'manifest.json',
  'background.js',
  'content-bridge.js',
  'content-overlay.js',
  'popup.html',
  'popup.js',
]

const check = process.argv.includes('--check')

const missing = FILES.filter(f => !existsSync(path.join(EXT_DIR, f)))
if (missing.length) {
  console.error(`extension source is missing: ${missing.join(', ')}`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(path.join(EXT_DIR, 'manifest.json'), 'utf8'))

// Everything nests under demist-extension/, so unzipping produces exactly the
// one folder the install instructions on the landing page tell people to
// select in "Load unpacked". Previously the files sat at the archive root and
// the instructions were only right by accident: Windows Explorer's Extract All
// invents a folder named after the zip, so it looked correct there, while
// command-line unzip scattered six loose files into the current directory.
const ROOT = 'demist-extension'

// Fixed date on every entry. Without it the zip bytes change on every run
// purely from mtimes, and --check can never say "identical" - which would make
// the guard useless and, worse, noisy enough to be trained to ignore.
const EPOCH = new Date('2000-01-01T00:00:00Z')

const zip = new JSZip()
// The directory entry is created EXPLICITLY. Adding "demist-extension/foo.js"
// makes JSZip synthesise the parent folder itself, and it stamps that implicit
// entry with new Date() regardless of what the files carry - which silently
// broke determinism the moment the files were nested, two hashes apart on
// consecutive runs.
zip.file(ROOT, null, { dir: true, date: EPOCH })
for (const f of FILES) {
  zip.file(`${ROOT}/${f}`, readFileSync(path.join(EXT_DIR, f)), { date: EPOCH })
}

const buf = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
})
const sha = b => createHash('sha256').update(b).digest('hex').slice(0, 12)

if (check) {
  if (!existsSync(OUT)) {
    console.error('demist-extension.zip does not exist. Run: npm run build:extension')
    process.exit(1)
  }
  const current = readFileSync(OUT)
  if (sha(current) !== sha(buf)) {
    console.error('demist-extension.zip is STALE: it does not match extension/.')
    console.error(`  served ${sha(current)}   source ${sha(buf)}`)
    console.error('  Run: npm run build:extension   (and bump manifest.json version)')
    process.exit(1)
  }
  console.log(`extension zip is up to date (v${manifest.version}, ${sha(buf)})`)
  process.exit(0)
}

writeFileSync(OUT, buf)
console.log(`built demist-extension.zip  v${manifest.version}  ${FILES.length} files  ${(buf.length / 1024).toFixed(1)} KB  ${sha(buf)}`)
console.log(`  permissions: ${JSON.stringify(manifest.permissions)}`)
if (manifest.host_permissions) {
  console.log(`  host_permissions: ${JSON.stringify(manifest.host_permissions)}`)
}

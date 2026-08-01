// The Visual C++ runtime must ship INSIDE the package, beside every native
// module.
//
// This is what failed certification twice. onnxruntime and llama.cpp import
// msvcp140.dll, vcruntime140.dll, vcruntime140_1.dll, msvcp140_1.dll and
// msvcp140_atomic_wait.dll; a clean Windows install has none of them. They come
// with the Visual C++ Redistributable, which every development machine has and
// a fresh test machine does not - so the app loaded here and returned
// "The specified module could not be found" on Microsoft's hardware.
//
// Beside each .node, not beside the exe: Node opens native modules with
// LOAD_WITH_ALTERED_SEARCH_PATH, which drops the executable's directory from
// the search order in favour of the loaded module's own directory.
//
//   node test/vcredist-bundled.js
const fs = require('fs')
const path = require('path')

const UNPACKED = path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources')
const REQUIRED = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140_1.dll', 'msvcp140_atomic_wait.dll']

let failures = 0
const check = (n, ok, d = '') => { if (ok) console.log(`  ok   ${n}${d ? '  ' + d : ''}`); else { failures++; console.log(`  FAIL ${n}${d ? '  ' + d : ''}`) } }

const dirs = new Set()
;(function walk(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.toLowerCase().endsWith('.node')) dirs.add(dir)
  }
})(UNPACKED)

check('the packaged tree exists', fs.existsSync(UNPACKED), UNPACKED)
check('native modules were found', dirs.size > 0, `${dirs.size} director${dirs.size === 1 ? 'y' : 'ies'}`)

for (const dir of dirs) {
  const missing = REQUIRED.filter(d => !fs.existsSync(path.join(dir, d)))
  check(`runtime present beside ${path.basename(dir)}`, missing.length === 0,
    missing.length ? `missing ${missing.join(', ')}` : '')
}

console.log(failures ? `\n${failures} FAILED - this package would not start on a machine without the VC++ redistributable` : '\nthe VC++ runtime ships with every native module')
process.exit(failures ? 1 : 0)

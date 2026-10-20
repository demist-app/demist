// npm run test:packaged - runs test/packaged-layout.js inside the built app's
// own runtime (dist/win-unpacked/Demist.exe as Node), the way the workers run.
const { spawnSync } = require('child_process')
const path = require('path')
const exe = path.join(__dirname, '..', 'dist', 'win-unpacked', 'Demist.exe')
const r = spawnSync(exe, [path.join(__dirname, '..', 'test', 'packaged-layout.js')], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
process.exit(r.status ?? 1)

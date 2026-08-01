// Puts the Visual C++ runtime next to every native module in the packaged app.
//
// This is the bug that failed certification twice. onnxruntime and llama.cpp's
// binaries import msvcp140.dll, vcruntime140.dll, vcruntime140_1.dll,
// msvcp140_1.dll and msvcp140_atomic_wait.dll. A clean Windows install has none
// of them - they arrive with the Visual C++ Redistributable, which every
// development machine has and a fresh test machine does not. So the app loaded
// fine here and returned "The specified module could not be found" (LoadLibrary
// error 126) on Microsoft's hardware.
//
// WHY NEXT TO EACH .node, and not next to the exe, which was tried first and
// did not work: Node opens native modules with LOAD_WITH_ALTERED_SEARCH_PATH,
// which replaces "the executable's directory" in the search order with "the
// directory of the module being loaded". The exe directory is therefore never
// consulted. That is also why onnxruntime.dll resolves out of the package
// already - it sits beside onnxruntime_binding.node.
//
// Copying per directory rather than manipulating PATH is deliberate. PATH is
// searched AFTER System32, so on any machine that already has the
// redistributable the System32 copy would win and the fix would be untestable
// here - the one place it can be tested before submitting. Beside the module,
// the package's copy wins everywhere, so "loaded from the package" is
// observable on this machine and proves what a clean machine will do.
//
// Wired in as electron-builder's afterPack hook so it re-derives itself on
// every build; a new native dependency is covered without anyone remembering.
const fs = require('fs')
const path = require('path')

// The 2015-2022 runtime. Microsoft's redistributable licence explicitly permits
// app-local deployment of these files.
const RUNTIME_DIR = path.join(__dirname, '..', 'vcredist')

exports.default = async function bundleVcRedist(context) {
  if (context.electronPlatformName !== 'win32') return

  const runtime = fs.readdirSync(RUNTIME_DIR).filter(f => f.toLowerCase().endsWith('.dll'))
  if (!runtime.length) throw new Error(`No runtime DLLs in ${RUNTIME_DIR} - the package would ship without them and fail on a clean machine.`)

  const appDir = context.appOutDir
  const dirsWithNativeModules = new Set()
  ;(function walk(dir) {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.toLowerCase().endsWith('.node')) dirsWithNativeModules.add(dir)
    }
  })(path.join(appDir, 'resources'))

  let copied = 0
  for (const dir of dirsWithNativeModules) {
    for (const dll of runtime) {
      const dest = path.join(dir, dll)
      if (!fs.existsSync(dest)) { fs.copyFileSync(path.join(RUNTIME_DIR, dll), dest); copied++ }
    }
  }

  console.log(`  • vcredist  placed ${runtime.length} runtime DLLs beside ${dirsWithNativeModules.size} native module director${dirsWithNativeModules.size === 1 ? 'y' : 'ies'} (${copied} files)`)
}

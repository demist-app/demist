// Plain-Node launcher for `npm start`, not just `electron .` directly:
// VS Code's integrated terminal (and Git Bash sessions opened from it)
// inherits ELECTRON_RUN_AS_NODE=1 from VS Code's own Electron host process.
// With that set, the electron binary runs as plain Node instead of launching
// the app: require('electron') in main.js then returns a path string
// instead of {app, BrowserWindow, ipcMain, session}, crashing on the first
// ipcMain.handle() call before any window opens. Clearing it here, in the
// spawning process, is the only place it can be fixed: by the time main.js
// itself runs, Electron has already decided which mode to boot into.
delete process.env.ELECTRON_RUN_AS_NODE

const { spawn } = require('child_process')
const electronPath = require('electron')

const child = spawn(electronPath, ['.'], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))

// The link only ran one way: the child exiting ended this process, but this
// process ending left the child running. Ctrl-C, closing the terminal, or any
// tooling that kills the npm process therefore ORPHANED the whole Electron
// tree - main process, renderer, GPU process, and the three worker threads
// holding every loaded model.
//
// That is not a tidy-up detail, it is the same bug the app has been chasing.
// One orphan measured 4928MB resident / 6553MB committed, and killing it took
// the machine from 2.8GB free to 7.8GB. Restart the app a couple of times
// during a debugging session and the orphans alone are enough to push the
// machine into paging, which is exactly what makes a startSession that does
// 1ms of work take 60+ seconds (see the keep-warm comment in main.js).
//
// child.kill() is not sufficient on Windows: Electron spawns its renderer and
// GPU processes as children of the child, and they survive their parent. The
// documented way to take down the whole tree is taskkill /T.
let killing = false
function killChildTree() {
  if (killing || child.exitCode !== null || child.signalCode !== null) return
  killing = true
  if (process.platform === 'win32') {
    // Detached and with stdio ignored so it cannot block or inherit streams
    // that are already closing; failures are non-fatal, since the process may
    // have died between the guard above and here.
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', detached: true }).unref() } catch { /* already gone */ }
  } else {
    try { child.kill('SIGTERM') } catch { /* already gone */ }
  }
}

process.on('exit', killChildTree)
// Ctrl-C in a shell is the single most common way this launcher dies, and a
// signal handler is the only place to catch it: without these, 'exit' fires
// too late to spawn anything.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => { killChildTree(); process.exit(0) })
}

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

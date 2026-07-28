// Measures the renderer -> main PCM hop for real, inside Electron, with a
// real BrowserWindow and the real preload bridge. This is the span the whole
// investigation converged on and the one span no headless harness can cover.
//
// The renderer posts 6400-byte buffers at 10/sec down BOTH channels
// (postMessage and send) and main counts what actually arrives on each.
//
//   npx electron test/ipc-rate/main.js
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

const counts = { post: 0, send: 0 }
ipcMain.on('rate:post', () => { counts.post++ })
ipcMain.on('rate:send', () => { counts.send++ })
ipcMain.on('rate:done', (_e, expected) => {
  const line = (name, got) =>
    `  ${name.padEnd(22)} ${String(got).padStart(4)} of ${expected} arrived  (${(100 * got / expected).toFixed(0)}%)`
  console.log('\nrenderer -> main, 6400-byte buffers at 10/sec:')
  console.log(line('ipcRenderer.postMessage', counts.post))
  console.log(line('ipcRenderer.send', counts.send))
  const postOk = counts.post >= expected * 0.8
  const sendOk = counts.send >= expected * 0.8
  console.log(`\npostMessage: ${postOk ? 'OK' : 'LOSING MESSAGES'}   send: ${sendOk ? 'OK' : 'LOSING MESSAGES'}`)
  app.exit(sendOk ? 0 : 1)
})

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  })
  win.loadFile(path.join(__dirname, 'index.html'))
})

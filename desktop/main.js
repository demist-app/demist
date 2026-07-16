// Electron shell for Demist. Deliberately thin: the window loads the same
// web app you already deploy to Vercel (so UI changes ship the normal way,
// no separate desktop release needed for them) — the only new thing this
// process adds is native, on-device transcription/translation/term
// detection, exposed to that web page through the preload bridge below.
// Nothing audio- or text-related that touches these handlers ever leaves
// the machine.

const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')

// Point at your own deployment in production; override for local dev against
// `npm run dev` in web/, e.g. DEMIST_DESKTOP_URL=http://localhost:3000
const APP_URL = process.env.DEMIST_DESKTOP_URL || 'https://demist.app'

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, '..', 'web', 'public', 'icon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  win.loadURL(APP_URL)
}

// Native modules are required lazily, on first actual use — whisper/llama.cpp
// bindings are heavy to load and most sessions won't touch all three.
let whisper, translate, llm

ipcMain.handle('demist:transcribe', async (_event, audioBuffer, mimeType) => {
  whisper ??= require('./native/whisper')
  return whisper.transcribe(audioBuffer, mimeType)
})

ipcMain.handle('demist:translate', async (_event, text, targetLang) => {
  translate ??= require('./native/translate')
  return translate.translate(text, targetLang)
})

ipcMain.handle('demist:detectTerms', async (_event, transcript, context) => {
  llm ??= require('./native/llm')
  return llm.detectTerms(transcript, context)
})

ipcMain.handle('demist:getModelTier', async () => {
  llm ??= require('./native/llm')
  return llm.getTier()
})

ipcMain.handle('demist:setModelTier', async (_event, tier) => {
  llm ??= require('./native/llm')
  return llm.setTier(tier)
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

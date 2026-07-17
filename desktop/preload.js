// Exposes a minimal, typed bridge to the loaded web page as
// `window.demistNative`. The web app (web/lib/electronNative.ts) checks for
// this to decide whether it's running inside the desktop app and can use
// on-device processing instead of the cloud edge functions.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('demistNative', {
  transcribe: (audioBuffer, mimeType) => ipcRenderer.invoke('demist:transcribe', audioBuffer, mimeType),
  translate: (text, targetLang) => ipcRenderer.invoke('demist:translate', text, targetLang),
  detectTerms: (transcript, context) => ipcRenderer.invoke('demist:detectTerms', transcript, context),
  getModelTier: () => ipcRenderer.invoke('demist:getModelTier'),
  setModelTier: (tier) => ipcRenderer.invoke('demist:setModelTier', tier),
  getTranscribeTier: () => ipcRenderer.invoke('demist:getTranscribeTier'),
  setTranscribeTier: (tier) => ipcRenderer.invoke('demist:setTranscribeTier', tier),
  startWakeLock: () => ipcRenderer.invoke('demist:wakeLockStart'),
  stopWakeLock: () => ipcRenderer.invoke('demist:wakeLockStop'),
})

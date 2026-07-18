// desktop/preload.js: FULL REPLACEMENT
// Same minimal typed bridge as before, reshaped around live sessions.
// The old per-blob transcribe(audioBuffer, mimeType) is gone: transcription
// is now a session the renderer starts, feeds raw PCM into, and receives
// ordered transcript segments back from via onEvent.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('demistNative', {
  // Live transcription session
  startSession: () => ipcRenderer.invoke('demist:startSession'),
  stopSession: () => ipcRenderer.invoke('demist:stopSession'),
  preloadWhisper: () => ipcRenderer.invoke('demist:preloadWhisper'),
  preloadTermDetection: () => ipcRenderer.invoke('demist:preloadTermDetection'),
  preloadTranslation: (lang) => ipcRenderer.invoke('demist:preloadTranslation', lang),
  // Not actually zero-copy: Electron's ipcRenderer.postMessage transfer list
  // only accepts MessagePort, not ArrayBuffer (confirmed from Electron's own
  // type definitions, unlike the standard window.postMessage/Worker
  // postMessage API this was modeled on). Passing an ArrayBuffer there threw
  // "Invalid value for transfer" on every single frame. Electron's
  // structured clone still copies the ArrayBuffer correctly here, it's just
  // a real copy rather than a transfer, negligible for PCM frames this
  // small, and correct beats a broken optimization.
  sendPcm: (arrayBuffer) => ipcRenderer.postMessage('demist:pcm', { buffer: arrayBuffer }),
  // Push events from native: { event: 'transcript', payload: { seq, text } }
  // and { event: 'modelProgress', payload: { label, pct, file } }.
  // Returns an unsubscribe function.
  onEvent: (callback) => {
    const listener = (_e, msg) => callback(msg)
    ipcRenderer.on('demist:event', listener)
    return () => ipcRenderer.removeListener('demist:event', listener)
  },

  // Existing request/response surface
  translate: (text, targetLang) => ipcRenderer.invoke('demist:translate', text, targetLang),
  detectTerms: (transcript, context, subject, year) =>
    ipcRenderer.invoke('demist:detectTerms', transcript, context, subject, year),
  getModelTier: () => ipcRenderer.invoke('demist:getModelTier'),
  setModelTier: (tier) => ipcRenderer.invoke('demist:setModelTier', tier),
  getTranscribeTier: () => ipcRenderer.invoke('demist:getTranscribeTier'),
  setTranscribeTier: (tier) => ipcRenderer.invoke('demist:setTranscribeTier', tier),
  startWakeLock: () => ipcRenderer.invoke('demist:wakeLockStart'),
  stopWakeLock: () => ipcRenderer.invoke('demist:wakeLockStop'),
})

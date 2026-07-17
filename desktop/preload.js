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
  // Zero-copy PCM frame: the ArrayBuffer is transferred, not cloned.
  sendPcm: (arrayBuffer) => ipcRenderer.postMessage('demist:pcm', { buffer: arrayBuffer }, [arrayBuffer]),
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

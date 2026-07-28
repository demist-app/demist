// desktop/preload.js: FULL REPLACEMENT
// Same minimal typed bridge as before, reshaped around live sessions.
// The old per-blob transcribe(audioBuffer, mimeType) is gone: transcription
// is now a session the renderer starts, feeds raw PCM into, and receives
// ordered transcript segments back from via onEvent.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('demistNative', {
  // Static, no IPC needed: lets the renderer know which platform-specific
  // capabilities apply (e.g. system-audio capture, see lib/tabCapture.ts,
  // is only wired up on Windows in main.js).
  platform: process.platform,

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
  // ipcRenderer.send, NOT ipcRenderer.postMessage.
  //
  // postMessage was chosen for a zero-copy transfer that Electron does not
  // actually support (see the note below): the transfer list only accepts
  // MessagePort, so the ArrayBuffer was being structured-cloned either way.
  // That left the audio going down the MessagePort path for no benefit, and
  // measurement says that path does not keep up. In a real session the
  // renderer reported "50 DELIVERED to main" every 5 seconds - postMessage
  // returning without throwing, 10 times a second - while the worker's own
  // edge counter saw 0.9 messages/sec. The hop AFTER main was proven healthy
  // in isolation (posted 9.0/sec, worker received 9.5/sec) and again under
  // Electron (9.5/sec), so the loss sits between this call and ipcMain.
  //
  // send() is the ordinary high-frequency IPC channel and is received by the
  // same ipcMain.on handler with the same payload shape, so nothing on the
  // main side changes.
  sendPcm: (arrayBuffer, seq) => ipcRenderer.send('demist:pcm', { buffer: arrayBuffer, seq }),
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
  summarize: (termRows, subject) => ipcRenderer.invoke('demist:summarize', termRows, subject),
  getModelTier: () => ipcRenderer.invoke('demist:getModelTier'),
  setModelTier: (tier) => ipcRenderer.invoke('demist:setModelTier', tier),
  getTranscribeTier: () => ipcRenderer.invoke('demist:getTranscribeTier'),
  setTranscribeTier: (tier) => ipcRenderer.invoke('demist:setTranscribeTier', tier),
  startWakeLock: () => ipcRenderer.invoke('demist:wakeLockStart'),
  stopWakeLock: () => ipcRenderer.invoke('demist:wakeLockStop'),
})

// Runs only on demist.app — bridges window.postMessage <-> chrome.runtime
;(function () {
  if (window.__demistBridgeLoaded) return
  window.__demistBridgeLoaded = true

  const DEMIST_ORIGIN = window.location.origin

  // Page → Extension: relay term events and recording status
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'demist') return
    const { type, term, definition, termId } = e.data
    if (type === 'term') {
      chrome.runtime.sendMessage({ type: 'DEMIST_TERM', term, definition, termId }).catch(() => {})
    } else if (type === 'recording-started') {
      chrome.runtime.sendMessage({ type: 'DEMIST_RECORDING_STARTED' }).catch(() => {})
    } else if (type === 'recording-stopped') {
      chrome.runtime.sendMessage({ type: 'DEMIST_RECORDING_STOPPED' }).catch(() => {})
    }
  })

  // Extension → Page: relay commands (start/stop recording, mark-known)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'DEMIST_COMMAND') {
      window.postMessage({
        source: 'demist-ext',
        command: msg.command,
        termId: msg.termId ?? undefined,
      }, DEMIST_ORIGIN)
    }
  })
})()

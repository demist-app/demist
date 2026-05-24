window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== 'demist') return
  const { type, term, definition } = e.data
  if (type === 'term') {
    chrome.runtime.sendMessage({ type: 'DEMIST_TERM', term, definition }).catch(() => {})
  } else if (type === 'recording-started') {
    chrome.runtime.sendMessage({ type: 'DEMIST_RECORDING_STARTED' }).catch(() => {})
  } else if (type === 'recording-stopped') {
    chrome.runtime.sendMessage({ type: 'DEMIST_RECORDING_STOPPED' }).catch(() => {})
  }
})

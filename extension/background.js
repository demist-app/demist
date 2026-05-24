const ports = new Set()

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return
  ports.add(port)
  port.onDisconnect.addListener(() => ports.delete(port))
})

chrome.runtime.onMessage.addListener((msg) => {
  if (!['DEMIST_TERM', 'DEMIST_RECORDING_STARTED', 'DEMIST_RECORDING_STOPPED'].includes(msg.type)) return
  ports.forEach(p => { try { p.postMessage(msg) } catch (_) {} })
})

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {})
})

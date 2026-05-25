const ports = new Set()
const pendingStart = new Map() // tabId -> true

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return
  ports.add(port)
  port.onDisconnect.addListener(() => ports.delete(port))
})

chrome.runtime.onMessage.addListener((msg) => {
  // Relay term/status events from content script to side panel
  if (['DEMIST_TERM', 'DEMIST_RECORDING_STARTED', 'DEMIST_RECORDING_STOPPED'].includes(msg.type)) {
    ports.forEach(p => { try { p.postMessage(msg) } catch (_) {} })
    return
  }

  // Start/stop commands from side panel
  if (msg.type === 'REQUEST_START_RECORDING') sendCommandToDemist('start-recording')
  if (msg.type === 'REQUEST_STOP_RECORDING')  sendCommandToDemist('stop-recording')
})

function sendCommandToDemist(command) {
  chrome.tabs.query({}, (tabs) => {
    const demistTab = tabs.find(t =>
      t.url && (t.url.includes('demist.app') || t.url.includes('localhost'))
    )
    if (demistTab) {
      chrome.tabs.sendMessage(demistTab.id, { type: 'DEMIST_COMMAND', command }).catch(() => {})
    } else if (command === 'start-recording') {
      chrome.tabs.create({ url: 'https://demist.app/dashboard', active: false }, (tab) => {
        pendingStart.set(tab.id, true)
      })
    }
  })
}

// When a newly opened Demist tab finishes loading, send the pending start command
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && pendingStart.has(tabId)) {
    pendingStart.delete(tabId)
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { type: 'DEMIST_COMMAND', command: 'start-recording' }).catch(() => {})
    }, 1500)
  }
})

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {})
})

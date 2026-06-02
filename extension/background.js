// Central relay hub — manages recording state and message routing

let recording = false
let demistTabId = null      // the hidden demist.app tab
let targetTabId = null      // the active tab where overlay cards appear
let elapsed = 0
let timerInterval = null

// Track all tabs running content-overlay.js so we can message them
const overlayTabs = new Set()

chrome.runtime.onMessage.addListener((msg, sender) => {
  switch (msg.type) {

    // content-bridge (demist.app) → relay to overlay tab
    case 'DEMIST_TERM':
    case 'DEMIST_RECORDING_STARTED':
    case 'DEMIST_RECORDING_STOPPED':
      forwardToOverlay(msg)
      if (msg.type === 'DEMIST_RECORDING_STARTED') startTimer()
      if (msg.type === 'DEMIST_RECORDING_STOPPED') stopTimer()
      break

    // content-overlay (any page) or popup → relay to demist.app
    case 'REQUEST_START_RECORDING':
      startRecording()
      break
    case 'REQUEST_STOP_RECORDING':
      sendCommandToDemist('stop-recording')
      break

    // content-overlay: user clicked "Mark as known" on a card
    case 'MARK_KNOWN':
      if (msg.termId) sendCommandToDemist('mark-known', msg.termId)
      break

    // Popup queries recording state
    case 'GET_STATE':
      return { recording, elapsed }

    // content-overlay registers itself so background knows which tabs have the overlay
    case 'OVERLAY_READY':
      if (sender.tab?.id) overlayTabs.add(sender.tab.id)
      break
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  overlayTabs.delete(tabId)
  if (tabId === demistTabId) demistTabId = null
  if (tabId === targetTabId) targetTabId = null
})

function forwardToOverlay(msg) {
  // Send to the target tab first, then fall back to all overlay tabs
  const tabs = targetTabId ? [targetTabId] : [...overlayTabs]
  tabs.forEach(tabId => {
    chrome.tabs.sendMessage(tabId, msg).catch(() => overlayTabs.delete(tabId))
  })
  // Also broadcast recording state to popup if open
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', recording, elapsed }).catch(() => {})
}

async function startRecording() {
  // Remember which tab the user is on so we can send cards there
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (activeTab?.id) targetTabId = activeTab.id

  if (demistTabId) {
    // Already have a demist.app tab — just send the command
    sendCommandToDemist('start-recording')
    return
  }

  // Open demist.app in the background and start recording once loaded
  chrome.tabs.create({ url: 'https://demist.app/dashboard', active: false }, (tab) => {
    demistTabId = tab.id
    waitForTabLoad(tab.id, () => {
      setTimeout(() => sendCommandToDemist('start-recording'), 1500)
    })
  })
}

function sendCommandToDemist(command, termId = null) {
  if (!demistTabId) return
  chrome.tabs.sendMessage(demistTabId, {
    type: 'DEMIST_COMMAND',
    command,
    termId,
  }).catch(() => { demistTabId = null })
}

function waitForTabLoad(tabId, callback) {
  const listener = (id, info) => {
    if (id === tabId && info.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener)
      callback()
    }
  }
  chrome.tabs.onUpdated.addListener(listener)
}

function startTimer() {
  recording = true
  elapsed = 0
  clearInterval(timerInterval)
  timerInterval = setInterval(() => {
    elapsed++
    broadcastState()
  }, 1000)
  broadcastState()
}

function stopTimer() {
  recording = false
  clearInterval(timerInterval)
  timerInterval = null
  broadcastState()
}

function broadcastState() {
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', recording, elapsed }).catch(() => {})
  // Also tell all overlay tabs the current state
  ;[...overlayTabs].forEach(tabId => {
    chrome.tabs.sendMessage(tabId, { type: 'STATE_UPDATE', recording, elapsed }).catch(() => overlayTabs.delete(tabId))
  })
}

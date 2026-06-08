// Central relay hub — manages recording state and message routing

let recording = false
let demistTabId = null      // the hidden demist.app tab
let activeTabId = null      // the tab the user is currently on (updated as they switch tabs)
let elapsed = 0
let timerInterval = null

// Track all tabs running content-overlay.js so we can message them
const overlayTabs = new Set()

// Keep activeTabId in sync as the user switches tabs
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (tab.url?.includes('demist.app')) return  // don't track the demist tab itself
    activeTabId = tabId
  } catch (_) {}
})

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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

    // Popup/overlay queries recording state — must use sendResponse, not return value
    case 'GET_STATE':
      sendResponse({ recording, elapsed })
      return true

    // content-overlay registers itself so background knows which tabs have the overlay
    case 'OVERLAY_READY':
      if (sender.tab?.id) overlayTabs.add(sender.tab.id)
      break
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  overlayTabs.delete(tabId)
  if (tabId === demistTabId) demistTabId = null
  if (tabId === activeTabId) activeTabId = null
})

function forwardToOverlay(msg) {
  // Send to whichever tab the user is on right now, fall back to all overlay tabs
  const tabs = activeTabId ? [activeTabId] : [...overlayTabs]
  tabs.forEach(tabId => {
    chrome.tabs.sendMessage(tabId, msg).catch(() => {
      overlayTabs.delete(tabId)
      if (tabId === activeTabId) activeTabId = null
    })
  })
  // Also broadcast recording state to popup if open
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', recording, elapsed }).catch(() => {})
}

async function startRecording() {
  // Capture the tab the user is currently on
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id && !tab.url?.includes('demist.app')) activeTabId = tab.id

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

// Central relay hub — manages recording state and message routing

let recording = false
let demistTabId = null      // the hidden demist.app tab
let activeTabId = null      // the tab the user is currently on (updated as they switch tabs)
let elapsed = 0
let timerInterval = null

// Track all tabs running content-overlay.js so we can message them
const overlayTabs = new Set()

// MV3 service workers are killed after ~30s of inactivity, wiping all state.
// On every wake-up, re-discover the Demist tab and ping any overlay tabs that
// were previously injected (but don't inject into new pages — overlay is now
// injected on demand when a session starts or the action icon is clicked).
async function rediscoverOverlayTabs() {
  const tabs = await chrome.tabs.query({})
  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id || !tab.url || tab.status !== 'complete') return

    const isDemist = tab.url.includes('demist.app') || tab.url.includes('localhost')
    const isRestricted = tab.url.startsWith('chrome') || tab.url.startsWith('about') || tab.url.startsWith('edge')

    if (isRestricted) return

    if (isDemist) {
      demistTabId = tab.id
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content-bridge.js'] })
      } catch (_) {}
      return
    }

    // For tabs that already have the overlay (injected this session), ping to confirm
    if (overlayTabs.has(tab.id)) {
      try {
        const res = await chrome.tabs.sendMessage(tab.id, { type: 'PING' })
        if (!res?.ok) overlayTabs.delete(tab.id)
      } catch (_) {
        overlayTabs.delete(tab.id)
      }
    }
  }))
}
rediscoverOverlayTabs()

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

async function forwardToOverlay(msg) {
  // Always refresh activeTabId — SW restarts wipe it on every wake-up
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id && tab.url &&
        !tab.url.includes('demist.app') &&
        !tab.url.startsWith('chrome') &&
        !tab.url.startsWith('about') &&
        !tab.url.startsWith('edge')) {
      activeTabId = tab.id
    }
  } catch (_) {}

  const targets = new Set([...(activeTabId ? [activeTabId] : []), ...overlayTabs])

  for (const tabId of targets) {
    try {
      await chrome.tabs.sendMessage(tabId, msg)
    } catch (_) {
      // Overlay not running on this tab — try injecting on demand and retry
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content-overlay.js'] })
        overlayTabs.add(tabId)
        await chrome.tabs.sendMessage(tabId, msg)
      } catch (_2) {
        overlayTabs.delete(tabId)
        if (tabId === activeTabId) activeTabId = null
      }
    }
  }

  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', recording, elapsed }).catch(() => {})
}

async function startRecording() {
  // Capture the tab the user is currently on and inject overlay on demand
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab?.id && !tab.url?.includes('demist.app')) {
    activeTabId = tab.id
    await injectOverlayIfNeeded(tab.id)
  }

  if (demistTabId) {
    sendCommandToDemist('start-recording')
    return
  }

  chrome.tabs.create({ url: 'https://demist.app/dashboard', active: false }, (tab) => {
    demistTabId = tab.id
    waitForTabLoad(tab.id, () => {
      setTimeout(() => sendCommandToDemist('start-recording'), 1500)
    })
  })
}

async function injectOverlayIfNeeded(tabId) {
  if (overlayTabs.has(tabId)) return
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content-overlay.js'] })
    overlayTabs.add(tabId)
  } catch (_) {
    // Restricted page (chrome://, PDF, etc.) — signal popup to show hint
    chrome.runtime.sendMessage({ type: 'INJECT_FAILED', tabId }).catch(() => {})
  }
}

// Inject overlay when user clicks the extension icon on a tab
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || tab.url?.includes('demist.app')) return
  activeTabId = tab.id
  await injectOverlayIfNeeded(tab.id)
})

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

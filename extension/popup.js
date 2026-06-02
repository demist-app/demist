const dotEl    = document.getElementById('status-dot')
const textEl   = document.getElementById('status-text')
const timerEl  = document.getElementById('status-timer')
const mainBtn  = document.getElementById('main-btn')

let recording = false
let elapsed = 0

function fmtTime(s) {
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function render() {
  if (recording) {
    dotEl.className = 'recording'
    textEl.textContent = 'Recording in progress'
    timerEl.textContent = fmtTime(elapsed)
    mainBtn.textContent = 'Stop recording'
    mainBtn.className = 'stop'
  } else {
    dotEl.className = ''
    textEl.textContent = 'Ready to record'
    timerEl.textContent = ''
    mainBtn.textContent = 'Start recording'
    mainBtn.className = 'start'
  }
}

mainBtn.addEventListener('click', () => {
  if (recording) {
    chrome.runtime.sendMessage({ type: 'REQUEST_STOP_RECORDING' })
  } else {
    chrome.runtime.sendMessage({ type: 'REQUEST_START_RECORDING' })
    // Close popup immediately so the user can see the page where cards will appear
    window.close()
  }
})

// Listen for state updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') {
    recording = msg.recording
    elapsed = msg.elapsed ?? elapsed
    render()
  }
})

// Fetch initial state
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
  if (!res) return
  recording = res.recording
  elapsed = res.elapsed ?? 0
  render()
})

render()

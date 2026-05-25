let terms = []
let recording = false
let port

const emptyEl      = document.getElementById('empty')
const termsEl      = document.getElementById('terms')
const dotEl        = document.getElementById('dot')
const statusEl     = document.getElementById('status-text')
const clearBtn     = document.getElementById('clear-btn')
const recordBtn     = document.getElementById('record-btn')
const recordBtnText = document.getElementById('record-btn-text')
const btnDot        = document.getElementById('btn-dot')

function connect() {
  port = chrome.runtime.connect({ name: 'sidepanel' })
  port.onMessage.addListener(handle)
  port.onDisconnect.addListener(() => setTimeout(connect, 1000))
}

function handle(msg) {
  if (msg.type === 'DEMIST_RECORDING_STARTED') {
    recording = true
    terms = []
    render()
  } else if (msg.type === 'DEMIST_RECORDING_STOPPED') {
    recording = false
    render()
  } else if (msg.type === 'DEMIST_TERM') {
    terms.unshift({ term: msg.term, definition: msg.definition, t: new Date(), fresh: true })
    render()
    setTimeout(() => {
      if (terms[0]) { terms[0].fresh = false; render() }
    }, 400)
  }
}

function fmt(d) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function render() {
  dotEl.className = 'dot' + (recording ? ' recording' : '')
  statusEl.textContent = recording ? 'Recording...' : (terms.length ? 'Session ended' : 'Ready')

  if (recording) {
    recordBtn.classList.add('recording')
    btnDot.classList.add('anim')
    recordBtnText.textContent = 'Stop session'
  } else {
    recordBtn.classList.remove('recording')
    btnDot.classList.remove('anim')
    recordBtnText.textContent = 'Start session'
  }

  if (!terms.length) {
    emptyEl.style.display = 'flex'
    termsEl.style.display = 'none'
    return
  }

  emptyEl.style.display = 'none'
  termsEl.style.display = 'flex'
  termsEl.innerHTML = terms.map(t => `
    <div class="term-card${t.fresh ? ' fresh' : ''}">
      <div class="term-name">${esc(t.term)}</div>
      <div class="term-def">${esc(t.definition)}</div>
      <div class="term-time">${fmt(t.t)}</div>
    </div>
  `).join('')
}

recordBtn.addEventListener('click', () => {
  recordBtn.disabled = true
  if (recording) {
    chrome.runtime.sendMessage({ type: 'REQUEST_STOP_RECORDING' }).catch(() => {})
  } else {
    chrome.runtime.sendMessage({ type: 'REQUEST_START_RECORDING' }).catch(() => {})
  }
  setTimeout(() => { recordBtn.disabled = false }, 2000)
})

clearBtn.addEventListener('click', () => { terms = []; render() })

connect()
render()

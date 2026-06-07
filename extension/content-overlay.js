// Injected into every non-demist.app page.
// Creates an isolated Shadow DOM overlay with floating term cards,
// a recording badge, and a session panel.

// ── Shadow DOM setup ─────────────────────────────────────────────────────────

const host = document.createElement('div')
host.id = 'demist-overlay-host'
host.style.cssText = [
  'position:fixed',
  'bottom:0',
  'right:0',
  'width:340px',
  'max-height:100vh',
  'z-index:2147483647',
  'pointer-events:none',
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
].join(';')
document.documentElement.appendChild(host)
const shadow = host.attachShadow({ mode: 'open' })

// ── Styles ────────────────────────────────────────────────────────────────────

const style = document.createElement('style')
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  /* ── Badge ── */
  #badge {
    position: absolute;
    bottom: 20px;
    right: 20px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #0e0e1c;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 40px;
    padding: 8px 14px;
    cursor: pointer;
    pointer-events: all;
    user-select: none;
    transition: border-color 0.2s, box-shadow 0.2s;
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.3s, transform 0.3s;
  }
  #badge.visible {
    opacity: 1;
    transform: translateY(0);
  }
  #badge:hover { border-color: rgba(251,191,36,0.45); box-shadow: 0 0 20px rgba(251,191,36,0.15); }

  #badge-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #ef4444;
    animation: pulse 2s ease-in-out infinite;
    flex-shrink: 0;
  }
  @keyframes pulse {
    0%,100% { opacity: 1; } 50% { opacity: 0.4; }
  }
  #badge-label {
    font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.9); white-space: nowrap;
  }
  #badge-timer {
    font-size: 11px; color: rgba(255,255,255,0.4);
    font-variant-numeric: tabular-nums;
  }
  #badge-stop {
    display: flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 6px;
    background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3);
    cursor: pointer; color: #ef4444;
    font-size: 9px; font-weight: 700;
    transition: background 0.15s;
    pointer-events: all;
  }
  #badge-stop:hover { background: rgba(239,68,68,0.3); }

  /* ── Cards ── */
  #cards {
    position: absolute;
    bottom: 72px;
    right: 20px;
    width: 300px;
    display: flex;
    flex-direction: column-reverse;
    gap: 8px;
  }

  .card {
    background: #0e0e1c;
    border: 1px solid rgba(251,191,36,0.28);
    border-radius: 16px;
    padding: 14px 16px;
    pointer-events: all;
    position: relative;
    animation: cardIn 0.45s cubic-bezier(0.16,1,0.3,1) both;
    box-shadow: 0 8px 32px rgba(0,0,0,0.7), 0 0 0 1px rgba(251,191,36,0.05);
    overflow: hidden;
  }
  .card.out {
    animation: cardOut 0.3s cubic-bezier(0.4,0,1,1) both;
    pointer-events: none;
  }
  @keyframes cardIn {
    from { transform: translateX(110%) scale(0.9); opacity: 0; filter: blur(4px); }
    to   { transform: translateX(0)   scale(1);   opacity: 1; filter: blur(0); }
  }
  @keyframes cardOut {
    to { transform: translateX(110%) scale(0.9); opacity: 0; filter: blur(4px); }
  }

  .card-tag {
    font-size: 10px; font-weight: 700; letter-spacing: 0.15em;
    text-transform: uppercase; color: rgba(251,191,36,0.75);
    margin-bottom: 6px;
  }
  .card-term {
    font-size: 15px; font-weight: 700; color: rgba(255,255,255,0.95);
    margin-bottom: 5px; line-height: 1.3;
  }
  .card-def {
    font-size: 12px; color: rgba(255,255,255,0.5); line-height: 1.5;
    margin-bottom: 12px;
  }
  .card-actions {
    display: flex; gap: 8px; align-items: center;
  }
  .card-btn {
    flex: 1; padding: 6px 10px; border-radius: 10px; font-size: 11px;
    font-weight: 600; cursor: pointer; border: 1px solid;
    transition: background 0.15s, color 0.15s;
  }
  .card-btn-known {
    background: rgba(251,191,36,0.10); border-color: rgba(251,191,36,0.28);
    color: #FBBF24;
  }
  .card-btn-known:hover { background: rgba(251,191,36,0.20); }
  .card-btn-dismiss {
    background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.4);
  }
  .card-btn-dismiss:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.7); }

  .card-progress {
    position: absolute; bottom: 0; left: 0; height: 2px;
    background: rgba(251,191,36,0.55);
    transition: width 0.1s linear;
    border-radius: 0 0 16px 16px;
  }

  /* ── Panel ── */
  #panel {
    position: absolute;
    bottom: 72px;
    right: 20px;
    width: 300px;
    max-height: 70vh;
    background: #0e0e1c;
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 20px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    pointer-events: all;
    box-shadow: 0 16px 48px rgba(0,0,0,0.8);
    animation: panelIn 0.35s cubic-bezier(0.16,1,0.3,1) both;
  }
  #panel.out { animation: panelOut 0.25s cubic-bezier(0.4,0,1,1) both; }
  @keyframes panelIn {
    from { transform: translateY(12px) scale(0.97); opacity: 0; }
    to   { transform: translateY(0)    scale(1);    opacity: 1; }
  }
  @keyframes panelOut {
    to { transform: translateY(12px) scale(0.97); opacity: 0; }
  }

  .panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }
  .panel-title { font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.5); text-transform: uppercase; letter-spacing: 0.12em; }
  .panel-count { font-size: 11px; color: rgba(251,191,36,0.8); }
  .panel-close { cursor: pointer; color: rgba(255,255,255,0.3); font-size: 18px; line-height: 1; padding: 2px 4px; }
  .panel-close:hover { color: rgba(255,255,255,0.7); }

  .panel-summary {
    padding: 10px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }
  .panel-summary-text { font-size: 12px; color: rgba(255,255,255,0.45); line-height: 1.5; }
  .panel-summary-label { font-size: 10px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; color: rgba(251,191,36,0.65); margin-bottom: 4px; }

  .panel-terms {
    overflow-y: auto; flex: 1;
    padding: 8px 0;
  }
  .panel-terms::-webkit-scrollbar { width: 4px; }
  .panel-terms::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

  .panel-term {
    padding: 8px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.03);
  }
  .panel-term:last-child { border-bottom: none; }
  .panel-term-name { font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.85); margin-bottom: 2px; }
  .panel-term-def  { font-size: 11px; color: rgba(255,255,255,0.35); line-height: 1.4; }

  .panel-empty {
    padding: 32px 16px; text-align: center;
    font-size: 12px; color: rgba(255,255,255,0.2);
  }

  .panel-links {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 6px; padding: 10px 12px 12px;
    border-top: 1px solid rgba(255,255,255,0.05);
    flex-shrink: 0;
  }
  .panel-link {
    display: block; text-align: center;
    padding: 7px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 600;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.5); text-decoration: none;
    cursor: pointer; transition: background 0.15s, color 0.15s;
  }
  .panel-link:hover { background: rgba(255,255,255,0.08); color: rgba(255,255,255,0.85); }
  .panel-link.primary {
    grid-column: 1 / -1;
    background: rgba(251,191,36,0.12); border-color: rgba(251,191,36,0.25);
    color: #FBBF24;
  }
  .panel-link.primary:hover { background: rgba(251,191,36,0.22); }
`
shadow.appendChild(style)

// ── HTML ──────────────────────────────────────────────────────────────────────

const root = document.createElement('div')
root.innerHTML = `
  <div id="cards"></div>

  <div id="badge">
    <span id="badge-dot"></span>
    <span id="badge-label">Recording</span>
    <span id="badge-timer">0:00</span>
    <span id="badge-stop" title="Stop recording">■</span>
  </div>

  <div id="panel" style="display:none">
    <div class="panel-header">
      <span class="panel-title">This session</span>
      <span class="panel-count" id="panel-count">0 terms</span>
      <span class="panel-close" id="panel-close">×</span>
    </div>
    <div class="panel-summary" id="panel-summary" style="display:none">
      <div class="panel-summary-label">AI Summary</div>
      <div class="panel-summary-text" id="panel-summary-text"></div>
    </div>
    <div class="panel-terms" id="panel-terms">
      <div class="panel-empty">No terms yet. Start recording to begin.</div>
    </div>
    <div class="panel-links">
      <a class="panel-link primary" id="link-app" href="https://demist.app/dashboard" target="_blank">Open Demist ↗</a>
      <a class="panel-link" href="https://demist.app/glossary" target="_blank">Glossary</a>
      <a class="panel-link" href="https://demist.app/flashcards" target="_blank">Flashcards</a>
      <a class="panel-link" href="https://demist.app/history" target="_blank">History</a>
      <a class="panel-link" href="https://demist.app/import" target="_blank">Import</a>
    </div>
  </div>
`
shadow.appendChild(root)

// ── State ─────────────────────────────────────────────────────────────────────

let recording = false
let elapsed = 0
let panelOpen = false
let sessionTerms = []   // { term, definition, termId }
let synopsis = null

// ── Element refs ──────────────────────────────────────────────────────────────

const badgeEl    = shadow.getElementById('badge')
const badgeDot   = shadow.getElementById('badge-dot')
const badgeLabel = shadow.getElementById('badge-label')
const badgeTimer = shadow.getElementById('badge-timer')
const badgeStop  = shadow.getElementById('badge-stop')
const cardsEl    = shadow.getElementById('cards')
const panelEl    = shadow.getElementById('panel')
const panelCount = shadow.getElementById('panel-count')
const panelTerms = shadow.getElementById('panel-terms')
const panelSummary     = shadow.getElementById('panel-summary')
const panelSummaryText = shadow.getElementById('panel-summary-text')
const panelClose = shadow.getElementById('panel-close')

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(s) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${String(sec).padStart(2, '0')}`
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Badge ─────────────────────────────────────────────────────────────────────

function updateBadge() {
  if (recording) {
    badgeEl.classList.add('visible')
    badgeTimer.textContent = fmtTime(elapsed)
  } else {
    // Keep badge visible briefly after recording stops if there are terms
    if (!sessionTerms.length) badgeEl.classList.remove('visible')
  }
}

badgeEl.addEventListener('click', (e) => {
  if (e.target === badgeStop) return // handled separately
  togglePanel()
})

badgeStop.addEventListener('click', (e) => {
  e.stopPropagation()
  chrome.runtime.sendMessage({ type: 'REQUEST_STOP_RECORDING' }).catch(() => {})
})

// ── Panel ─────────────────────────────────────────────────────────────────────

function togglePanel() {
  if (panelOpen) closePanel()
  else openPanel()
}

function openPanel() {
  panelOpen = true
  panelEl.style.display = 'flex'
  panelEl.classList.remove('out')
  renderPanel()
}

function closePanel() {
  panelOpen = false
  panelEl.classList.add('out')
  setTimeout(() => { if (!panelOpen) panelEl.style.display = 'none' }, 260)
}

panelClose.addEventListener('click', closePanel)

function renderPanel() {
  const n = sessionTerms.length
  panelCount.textContent = `${n} term${n !== 1 ? 's' : ''}`

  if (synopsis) {
    panelSummary.style.display = 'block'
    panelSummaryText.textContent = synopsis
  } else {
    panelSummary.style.display = 'none'
  }

  if (!n) {
    panelTerms.innerHTML = '<div class="panel-empty">No terms yet.<br>Terms appear here as your lecture progresses.</div>'
    return
  }

  panelTerms.innerHTML = sessionTerms.map(t => `
    <div class="panel-term">
      <div class="panel-term-name">${esc(t.term)}</div>
      <div class="panel-term-def">${esc(t.definition)}</div>
    </div>
  `).join('')
}

// ── Term cards ────────────────────────────────────────────────────────────────

const AUTO_DISMISS_MS = 10_000

function showCard({ term, definition, termId }) {
  const card = document.createElement('div')
  card.className = 'card'

  // Progress bar that drains over AUTO_DISMISS_MS
  const progress = document.createElement('div')
  progress.className = 'card-progress'
  progress.style.width = '100%'

  card.innerHTML = `
    <div class="card-tag">Just detected</div>
    <div class="card-term">${esc(term)}</div>
    <div class="card-def">${esc(definition)}</div>
    <div class="card-actions">
      <button class="card-btn card-btn-known" data-term-id="${esc(termId ?? '')}">Mark as known</button>
      <button class="card-btn card-btn-dismiss">Got it ✓</button>
    </div>
  `
  card.appendChild(progress)
  cardsEl.prepend(card)

  // Wire buttons
  card.querySelector('.card-btn-dismiss').addEventListener('click', () => dismissCard(card, timer))
  card.querySelector('.card-btn-known').addEventListener('click', () => {
    if (termId) chrome.runtime.sendMessage({ type: 'MARK_KNOWN', termId }).catch(() => {})
    dismissCard(card, timer)
  })

  // Drain the progress bar
  const start = Date.now()
  const tick = () => {
    const pct = Math.max(0, 100 - ((Date.now() - start) / AUTO_DISMISS_MS) * 100)
    progress.style.width = pct + '%'
    if (pct > 0) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  // Auto-dismiss
  const timer = setTimeout(() => dismissCard(card, timer), AUTO_DISMISS_MS)
}

function dismissCard(card, timer) {
  clearTimeout(timer)
  card.classList.add('out')
  setTimeout(() => card.remove(), 320)
}

// ── Recording state ───────────────────────────────────────────────────────────

function onRecordingStarted() {
  recording = true
  elapsed = 0
  sessionTerms = []
  synopsis = null
  badgeEl.classList.add('visible')
  updateBadge()
  if (panelOpen) renderPanel()
}

function onRecordingStopped(msg) {
  recording = false
  if (msg?.synopsis) synopsis = msg.synopsis
  updateBadge()
  if (panelOpen) renderPanel()
  // Keep badge visible so user can open the panel
  badgeEl.classList.add('visible')
}

function onTerm({ term, definition, termId }) {
  sessionTerms.unshift({ term, definition, termId })
  showCard({ term, definition, termId })
  if (panelOpen) renderPanel()
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DEMIST_TERM')              onTerm(msg)
  if (msg.type === 'DEMIST_RECORDING_STARTED') onRecordingStarted()
  if (msg.type === 'DEMIST_RECORDING_STOPPED') onRecordingStopped(msg)
  if (msg.type === 'STATE_UPDATE') {
    recording = msg.recording
    elapsed = msg.elapsed ?? elapsed
    updateBadge()
  }
})

// Register with background so it knows this tab has an overlay
chrome.runtime.sendMessage({ type: 'OVERLAY_READY' }).catch(() => {})

// Fetch initial state in case recording was already in progress when user switched tabs
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
  if (!res) return
  recording = res.recording
  elapsed = res.elapsed ?? 0
  if (recording) {
    badgeEl.classList.add('visible')
    updateBadge()
  }
})

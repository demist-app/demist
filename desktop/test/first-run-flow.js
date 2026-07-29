// Drives the desktop app's FIRST RUN the way a new user would: a clean
// Electron profile (so it is genuinely signed out), the real preload bridge,
// the real login page, and a real click on "Start without an account".
//
// Uses its own userData directory, so it cannot see or disturb the session in
// the app you actually use.
//
//   npx electron test/first-run-flow.js [url]
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const URL_BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3111'

// A throwaway profile: this is what makes the run a genuine first run.
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demist-firstrun-'))
app.setPath('userData', profileDir)

const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`)
  else { failures++; console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`) }
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(message)
  })

  console.log(`first run against ${URL_BASE}, clean profile\n`)

  // Straight to /dashboard, exactly as main.js does.
  await win.loadURL(`${URL_BASE}/dashboard`)
  await sleep(3500)
  const afterLoad = win.webContents.getURL()
  check('signed-out /dashboard redirects to /login', afterLoad.includes('/login'), `-> ${afterLoad}`)

  // The desktop-only guest CTA must be there and be the primary action.
  const cta = await win.webContents.executeJavaScript(`
    (() => {
      const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim())
      const guest = btns.find(t => /without an account/i.test(t))
      return { guest: guest || null, all: btns, heading: document.querySelector('h1')?.textContent?.trim() ?? null }
    })()
  `)
  check('"Start without an account" is offered', !!cta.guest, `buttons: ${JSON.stringify(cta.all)}`)
  check('heading is the desktop one', cta.heading === 'Get started', `-> ${JSON.stringify(cta.heading)}`)

  if (!cta.guest) {
    console.log('\nThe desktop branch did not render - window.demistNative missing? preload path wrong?')
    console.log(`errors: ${JSON.stringify(errors.slice(0, 3))}`)
    app.exit(1)
  }

  // Click it for real.
  await win.webContents.executeJavaScript(`
    [...document.querySelectorAll('button')].find(b => /without an account/i.test(b.textContent)).click()
  `)
  await sleep(6000)
  const afterGuest = win.webContents.getURL()
  check('lands on onboarding after starting without an account', afterGuest.includes('/onboarding'), `-> ${afterGuest}`)

  if (afterGuest.includes('/onboarding')) {
    const onboarding = await win.webContents.executeJavaScript(`
      (() => ({ heading: document.querySelector('h1')?.textContent?.trim() ?? null,
                inputs: document.querySelectorAll('input,button').length }))()
    `)
    check('onboarding rendered', onboarding.inputs > 0, `heading ${JSON.stringify(onboarding.heading)}`)
  } else {
    const shown = await win.webContents.executeJavaScript(
      `document.body.innerText.slice(0, 300)`)
    console.log(`\n  page said: ${JSON.stringify(shown)}`)
  }

  // The dashboard is where they actually land, and an anonymous user must not
  // be bounced back to /login by the (app) layout's session guard.
  await win.loadURL(`${URL_BASE}/dashboard`)
  await sleep(4000)
  const dash = win.webContents.getURL()
  check('anonymous user can reach the dashboard', dash.includes('/dashboard'), `-> ${dash}`)

  // Electron's own security notice is emitted only in development ("This
  // warning will not show up once the app is packaged"), so it is not a
  // finding about this app's first run.
  const realErrors = errors.filter(m =>
    !/DevTools|Autofill|preload|Electron Security Warning/i.test(m))
  check('no console errors during first run', realErrors.length === 0,
    realErrors.length ? `-> ${JSON.stringify(realErrors.slice(0, 2))}` : '')

  console.log(failures ? `\n${failures} FAILED` : '\nfirst run is clean')
  try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch { /* windows file locks */ }
  app.exit(failures ? 1 : 0)
})

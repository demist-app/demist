// Onboarding hard-coded a dark background while every other page followed the
// theme, so a light-mode user was dropped into a black screen mid-signup.
// This screenshots it in BOTH themes, after actually signing in anonymously,
// and checks the background really changed rather than just the class list.
//
//   npx electron test/onboarding-theme.js [url]
const { app, BrowserWindow, nativeTheme } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const URL_BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3115'
const OUT = path.join(os.tmpdir(), 'demist-onboarding')

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demist-theme-'))
app.setPath('userData', profileDir)
app.on('window-all-closed', () => { /* both themes still to measure */ })

const sleep = ms => new Promise(r => setTimeout(r, ms))
let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`)
  else { failures++; console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`) }
}

// sRGB relative luminance, so "is this actually a light page" is a measurement
// rather than a guess from class names.
const luminance = (hex) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return NaN
  const [r, g, b] = m.slice(1).map(h => parseInt(h, 16))
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

// Tailwind now emits lab()/oklch(), which no regex over digits can read - and
// reading canvas.fillStyle back does NOT normalise those, it returns lab()
// verbatim. Painting one pixel and sampling it does, whatever colour space
// went in.
const TO_HEX = `(css) => {
  const c = document.createElement('canvas'); c.width = c.height = 1
  const x = c.getContext('2d', { willReadFrequently: true })
  x.fillStyle = css; x.fillRect(0, 0, 1, 1)
  const [r, g, b] = x.getImageData(0, 0, 1, 1).data
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}`

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const results = {}

  for (const theme of ['light', 'dark']) {
    nativeTheme.themeSource = theme
    const win = new BrowserWindow({
      width: 1100, height: 900, show: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload.js'),
        contextIsolation: true,
        // A fresh in-memory session per theme. Sharing one meant the anonymous
        // sign-in from the first theme persisted, so /login redirected the
        // second straight to /dashboard and it never saw onboarding at all.
        partition: `onboarding-theme-${theme}-${Date.now()}`,
      },
    })
    // next-themes decides from localStorage, NOT from the OS, so setting
    // nativeTheme alone left both runs rendering the light theme and the dark
    // assertion failing against a page that was never dark.
    await win.loadURL(`${URL_BASE}/login`)
    await win.webContents.executeJavaScript(`localStorage.setItem('theme', ${JSON.stringify(theme)})`)
    await win.webContents.reload()
    await sleep(3000)
    const started = await win.webContents.executeJavaScript(`
      (() => {
        const b = [...document.querySelectorAll('button')].find(x => /without an account/i.test(x.textContent))
        if (!b) return false
        b.click(); return true
      })()
    `)
    if (!started) { check(`[${theme}] could start without an account`, false); win.destroy(); continue }
    await sleep(6000)

    const url = win.webContents.getURL()
    check(`[${theme}] reached onboarding`, url.includes('/onboarding'), `-> ${url}`)

    const look = await win.webContents.executeJavaScript(`
      (() => {
        const main = document.querySelector('main')
        const cs = getComputedStyle(main)
        const heading = document.querySelector('h1')
        const toHex = ${TO_HEX}
        return {
          bg: toHex(cs.backgroundColor),
          fg: toHex(cs.color),
          headingColor: heading ? toHex(getComputedStyle(heading).color) : null,
          htmlClass: document.documentElement.className,
          isDarkClass: document.documentElement.classList.contains('dark'),
        }
      })()
    `)
    results[theme] = look
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, `onboarding-${theme}.png`), img.toPNG())
    win.destroy()
    await sleep(500)
  }

  if (results.light && results.dark) {
    const lightLum = luminance(results.light.bg)
    const darkLum = luminance(results.dark.bg)
    console.log(`\n  light bg ${results.light.bg} (luminance ${lightLum.toFixed(2)})`)
    console.log(`  dark  bg ${results.dark.bg} (luminance ${darkLum.toFixed(2)})`)
    check('light mode gives a LIGHT background', lightLum > 0.7)
    check('dark mode still gives a dark background', darkLum < 0.2)
    // Text has to invert with it, or the page is a light box of white text.
    const lightFg = luminance(results.light.fg)
    check('light mode text is dark enough to read', lightFg < 0.4, `fg ${results.light.fg}`)
    const darkFg = luminance(results.dark.fg)
    check('dark mode text is light enough to read', darkFg > 0.6, `fg ${results.dark.fg}`)
  }

  try { fs.rmSync(profileDir, { recursive: true, force: true }) } catch { /* windows locks */ }
  console.log(`\nscreenshots: ${OUT}`)
  console.log(failures ? `${failures} FAILED` : 'onboarding follows the theme')
  app.exit(failures ? 1 : 0)
})

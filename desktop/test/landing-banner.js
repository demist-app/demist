// Screenshots the Pro waitlist banner at three widths and checks the things
// that are easy to get wrong on a FIXED bar: that it is actually pinned while
// the page scrolls, that it does not sit on top of the nav, and that it can be
// dismissed for good.
//
//   npx electron test/landing-banner.js [url] [outDir]
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')

const URL_BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:3112'
const OUT = process.argv[3] && !process.argv[3].startsWith('http')
  ? process.argv[3]
  : path.join(require('os').tmpdir(), 'demist-banner')

// A throwaway profile per run. Without it the dismissal check at the end
// writes demist_pro_banner_dismissed into a localStorage that Electron reuses
// next time, so the following run finds no banner at all and reports every
// width as broken - which is exactly what happened.
const profileDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'demist-banner-'))
app.setPath('userData', profileDir)

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Electron intermittently rejects a loadURL with a bare ERR_FAILED (-2) when a
// window is created straight after another was destroyed. Retrying is enough;
// treating it as a real failure would just make this harness flaky.
async function load(win, url, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try { await win.loadURL(url); return } catch (err) {
      if (i === attempts) throw err
      await sleep(600)
    }
  }
}
let failures = 0
const check = (name, ok, detail = '') => {
  if (ok) console.log(`  ok   ${name}${detail ? `  ${detail}` : ''}`)
  else { failures++; console.log(`  FAIL ${name}${detail ? `  ${detail}` : ''}`) }
}

const WIDTHS = [[1280, 820, 'desktop'], [768, 900, 'tablet'], [390, 780, 'mobile']]

// This harness destroys each window before opening the next one, and Electron
// quits the whole app by default once the last window closes - so without this
// the run ended silently after the FIRST width, having reported it as passing.
// It also explains the ERR_FAILED on the following load: the app was already
// on its way out.
app.on('window-all-closed', () => { /* keep going: more widths to measure */ })

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  console.log(`banner at ${URL_BASE}\n`)

  for (const [w, h, label] of WIDTHS) {
    const win = new BrowserWindow({ width: w, height: h, show: false, webPreferences: { offscreen: false } })
    await load(win, URL_BASE)
    await sleep(2500)

    const top = await win.webContents.executeJavaScript(`
      (() => {
        const bar = [...document.querySelectorAll('div')]
          .find(d => /Demist Pro is coming/.test(d.textContent) && getComputedStyle(d).position === 'fixed')
        if (!bar) return { found: false }
        const r = bar.getBoundingClientRect()
        const nav = document.querySelector('header')?.getBoundingClientRect()
        return {
          found: true, top: Math.round(r.top), height: Math.round(r.height),
          navTop: nav ? Math.round(nav.top) : null,
          // VISIBLE, not merely present: the field is 'hidden sm:block', so
          // below 640px it is still in the DOM with display:none, and
          // querySelector alone would call that a pass.
          hasInput: [...bar.querySelectorAll('input')].some(i => i.offsetParent !== null),
          buttons: [...bar.querySelectorAll('button,a')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim()).filter(Boolean),
        }
      })()
    `)
    check(`[${label}] banner renders, pinned to the top`, top.found && top.top === 0, JSON.stringify(top))
    if (top.found) {
      check(`[${label}] does not cover the nav`, top.navTop === null || top.navTop >= top.height,
        `nav starts at ${top.navTop}, banner is ${top.height} tall`)
      // The inline field only exists from sm (640px) up; below that it is a
      // link to the full section instead.
      check(`[${label}] right controls for this width`, w >= 640 ? top.hasInput : !top.hasInput,
        `hasInput=${top.hasInput} buttons=${JSON.stringify(top.buttons)}`)
    }

    // Still pinned after scrolling: the whole point of the change.
    await win.webContents.executeJavaScript('window.scrollTo(0, 2000)')
    await sleep(700)
    const afterScroll = await win.webContents.executeJavaScript(`
      (() => {
        const bar = [...document.querySelectorAll('div')]
          .find(d => /Demist Pro is coming/.test(d.textContent) && getComputedStyle(d).position === 'fixed')
        return bar ? Math.round(bar.getBoundingClientRect().top) : null
      })()
    `)
    check(`[${label}] stays put after scrolling 2000px`, afterScroll === 0, `top=${afterScroll}`)

    await win.webContents.executeJavaScript('window.scrollTo(0, 0)')
    await sleep(400)
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, `banner-${label}.png`), img.toPNG())
    win.destroy()
    await sleep(500)
  }

  // Dismissal has to survive a reload, or it is not a dismissal.
  const win = new BrowserWindow({ width: 1280, height: 820, show: false })
  await load(win, URL_BASE)
  await sleep(2200)
  // Guarded: an unguarded .click() on a missing button rejects, which stops
  // this async function dead and leaves the app running forever.
  const clicked = await win.webContents.executeJavaScript(`
    (() => {
      const b = document.querySelector('[aria-label="Dismiss the Pro waitlist banner"]')
      if (!b) return false
      b.click(); return true
    })()
  `)
  check('the dismiss control exists to be clicked', clicked === true)
  await sleep(500)
  const gone = await win.webContents.executeJavaScript(
    `!document.querySelector('[aria-label="Dismiss the Pro waitlist banner"]')`)
  check('dismiss hides it', gone === true)
  await win.webContents.reload()
  await sleep(2200)
  const stillGone = await win.webContents.executeJavaScript(
    `!document.querySelector('[aria-label="Dismiss the Pro waitlist banner"]')`)
  check('stays dismissed after a reload', stillGone === true)
  win.destroy()

  console.log(`\nscreenshots: ${OUT}`)
  console.log(failures ? `${failures} FAILED` : 'banner is correct at every width')
  app.exit(failures ? 1 : 0)
})

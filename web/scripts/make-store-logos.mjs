// Generates the Store listing logo art from the app's own icon and palette.
//
// Partner Center's "Store logos" are NOT the same as the tile assets baked
// into the .appx (those are in desktop/build/appx and Windows draws them on
// the Start menu). These are what the STORE PAGE shows, and 9:16 Poster art
// is the main logo for Windows 10/11 customers, so it is the one that matters.
//
//   node scripts/make-store-logos.mjs
import sharp from 'sharp'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const ICON = path.join(process.cwd(), 'public', 'icon-512.png')
const OUT = path.join(os.homedir(), 'Desktop', 'demist-store-logos')
mkdirSync(OUT, { recursive: true })

// Straight from web/app/globals.css, so the Store page and the app agree.
// --bg-subtle, one step darker than the app's --bg. The icon's own tile is
// #EDEAE3, so a poster on #EDEAE3 made the icon dissolve into the background
// and lose its shape entirely. One step of separation is enough for the tile
// to read as an object without introducing a colour the brand does not use.
const BG = '#E3E0D8'
const ACCENT = '#A16207'
const MUTED = 'rgba(15, 15, 20, 0.62)'

// A poster is seen small, in a crowded grid. Icon large, name unmissable, one
// line saying what it is. Nothing else survives being 200px wide.
function poster({ w, h, iconSize, iconY, nameY, nameSize, tagY, tagSize, tracking }) {
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="50%" cy="${(iconY + iconSize / 2) / h * 100}%" r="55%">
      <stop offset="0%" stop-color="rgba(161,98,7,0.20)"/>
      <stop offset="100%" stop-color="rgba(161,98,7,0)"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${BG}"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  <text x="${w / 2}" y="${nameY}" text-anchor="middle"
        font-family="Segoe UI, Arial, Helvetica, sans-serif" font-weight="700"
        font-size="${nameSize}" letter-spacing="${tracking}" fill="${ACCENT}">DEMIST</text>
  <text x="${w / 2}" y="${tagY}" text-anchor="middle"
        font-family="Segoe UI, Arial, Helvetica, sans-serif" font-weight="400"
        font-size="${tagSize}" fill="${MUTED}">Lecture terms, explained as they are said</text>
</svg>`)
}

const LAYOUTS = [
  // 9:16 Poster art - the main logo on Windows 10/11. Highest offered size.
  { name: 'poster-9x16-1440x2160.png', w: 1440, h: 2160,
    iconSize: 660, iconY: 620, nameY: 1520, nameSize: 150, tagY: 1636, tagSize: 52, tracking: 26 },
  { name: 'poster-9x16-720x1080.png', w: 720, h: 1080,
    iconSize: 330, iconY: 310, nameY: 760, nameSize: 75, tagY: 818, tagSize: 26, tracking: 13 },
  // 1:1 Box art - used across various Store layouts.
  { name: 'boxart-1x1-2160x2160.png', w: 2160, h: 2160,
    iconSize: 900, iconY: 480, nameY: 1620, nameSize: 200, tagY: 1760, tagSize: 68, tracking: 34 },
  { name: 'boxart-1x1-1080x1080.png', w: 1080, h: 1080,
    iconSize: 450, iconY: 240, nameY: 810, nameSize: 100, tagY: 880, tagSize: 34, tracking: 17 },
]

for (const L of LAYOUTS) {
  const icon = await sharp(ICON).resize(L.iconSize, L.iconSize, { fit: 'contain' }).toBuffer()
  await sharp(poster(L))
    .composite([{ input: icon, top: L.iconY, left: Math.round((L.w - L.iconSize) / 2) }])
    .png()
    .toFile(path.join(OUT, L.name))
  console.log(`  ${L.name.padEnd(30)} ${L.w}x${L.h}`)
}

// Store display images: square icon overrides. The package already ships tile
// assets, so these are optional - but the Store has no 300x300 of its own to
// fall back on, and a crisp one beats an upscale.
for (const size of [300, 150, 71]) {
  const name = `store-tile-${size}x${size}.png`
  await sharp(ICON).resize(size, size, { fit: 'contain' }).png().toFile(path.join(OUT, name))
  console.log(`  ${name.padEnd(30)} ${size}x${size}`)
}

console.log(`\nwritten to ${OUT}`)

// ── 16:9 Super hero art ──────────────────────────────────────────────────────
// The banner across the top of the Store listing on Windows 10 1607+. Partner
// Center is explicit that it MUST NOT include the product's title, because the
// Store draws its own title over it - so this carries no wordmark at all, only
// the waveform motif from the icon.
//
// The motif sits right of centre and the left third is left quiet: that is
// where the Store overlays the title and buttons, and art that competes with
// them just makes both harder to read.
function hero(w, h) {
  const cx = w * 0.66
  const cy = h * 0.5
  const unit = h / 14
  // Same five-bar rhythm as the app icon, mirrored outward from the centre.
  const bars = [0.34, 0.62, 1.0, 0.62, 0.34]
  const colours = ['#9A5B06', '#B4740E', '#F0A32A', '#B4740E', '#9A5B06']
  const gap = unit * 2.1
  const rects = bars.map((scale, i) => {
    const bh = unit * 7.4 * scale
    const bw = unit * 0.92
    const x = cx + (i - 2) * gap - bw / 2
    return `<rect x="${x.toFixed(1)}" y="${(cy - bh / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${(bw / 2).toFixed(1)}" fill="${colours[i]}"/>`
  }).join('\n    ')
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#EDEAE3"/>
      <stop offset="100%" stop-color="#DEDACF"/>
    </linearGradient>
    <radialGradient id="warm" cx="66%" cy="50%" r="46%">
      <stop offset="0%" stop-color="rgba(161,98,7,0.22)"/>
      <stop offset="100%" stop-color="rgba(161,98,7,0)"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#warm)"/>
  ${rects}
</svg>`)
}

for (const [w, h] of [[3840, 2160], [1920, 1080]]) {
  const name = `superhero-16x9-${w}x${h}.png`
  await sharp(hero(w, h)).png().toFile(path.join(OUT, name))
  console.log(`  ${name.padEnd(30)} ${w}x${h}  (no title text, per Partner Center)`)
}

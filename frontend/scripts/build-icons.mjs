// The icons a phone or a desktop shows for the app: the small form of the logo (public/favicon.svg: the river as one
// line running into the R in its open ring) on the app's ground, as PNGs. A home screen's icon is a still picture on
// every phone, so this is the mark at rest; it moves when the app opens.
//
//   node scripts/build-icons.mjs          (needs Playwright's Chromium: npx playwright install chromium)
//
// Writes public/apple-touch-icon.png (180: an iPhone rounds the corners itself, so the ground runs to the edge),
// public/icon-192.png and public/icon-512.png (the manifest's), and public/icon-maskable-512.png (the same with the
// mark inside the middle 80 %, where a launcher that cuts its own shape cannot reach it). Run it after the favicon's
// drawing changes and commit what it writes.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
// the favicon's own strokes, without its rounded ground
const strokes = (readFileSync(join(PUBLIC, 'favicon.svg'), 'utf8').match(/<path[^>]*\/>/g) || []).join('')
if (!strokes) throw new Error('public/favicon.svg has no strokes to draw')
const svg = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;width:100vw;height:100vh">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1d4039"/><stop offset="1" stop-color="#081714"/></linearGradient></defs>
  <rect width="100" height="100" fill="url(#g)"/>
  <g transform="translate(50 50) scale(${scale}) translate(-50 -50)">${strokes}</g></svg>`

const browser = await chromium.launch()
for (const [file, size, scale] of [['apple-touch-icon.png', 180, 0.86], ['icon-192.png', 192, 0.86], ['icon-512.png', 512, 0.86], ['icon-maskable-512.png', 512, 0.68]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
  await page.setContent(`<body style="margin:0">${svg(scale)}</body>`)
  await page.screenshot({ path: join(PUBLIC, file), omitBackground: false })
  await page.close()
  console.log(`${file}  ${size} x ${size}`)
}
await browser.close()

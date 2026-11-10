// What the two draw-cost profiles share: the switches, a traced stretch of the page, a pointer sweep.
import fs from 'node:fs'

const ALL = '*,*::before,*::after'
export const CSS = {
  base: '',
  'no blur': `${ALL}{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}`,
  'no canvas': 'canvas{visibility:hidden!important}',
  'no animation': `${ALL}{animation:none!important;transition:none!important}`,
  'no shadow': `${ALL}{box-shadow:none!important;text-shadow:none!important}`,
}
CSS['all off'] = Object.values(CSS).join('\n')
const WATCH = ['RasterTask', 'Paint', 'PrePaint', 'Layerize', 'Layout', 'UpdateLayoutTree', 'Commit', 'GPUTask', 'FireAnimationFrame', 'EventDispatch', 'ImageDecodeTask']


export const setCss = (page, css) => page.evaluate((c) => {
  let s = document.getElementById('perf-css'); if (!s) { s = document.createElement('style'); s.id = 'perf-css'; document.head.appendChild(s) }
  s.textContent = c
}, css)
export const frame = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())))

// One stretch of the page under Chromium's tracing: frames the page saw (requestAnimationFrame deltas), frames the
// compositor drew, and the work of each stage in ms per second of wall time.
export async function traced(browser, page, act) {
  await page.evaluate(() => { const w = window; w.__f = []; w.__on = true; let l = 0
    const t = (n) => { if (!w.__on) return; if (l) w.__f.push(n - l); l = n; requestAnimationFrame(t) }; requestAnimationFrame(t) })
  await browser.startTracing(page, { categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame'] })
  const t0 = Date.now(); await act(); const wall = (Date.now() - t0) / 1000
  const buf = await browser.stopTracing()
  const f = (await page.evaluate(() => { window.__on = false; return window.__f })).sort((a, b) => a - b)
  const sum = {}; let drawn = 0
  for (const e of JSON.parse(buf.toString()).traceEvents) {
    if (e.name === 'DrawFrame') drawn++
    if (e.ph === 'X' && WATCH.includes(e.name)) sum[e.name] = (sum[e.name] || 0) + e.dur / 1000
  }
  const per = (k) => +((sum[k] || 0) / wall).toFixed(1)        // ms of work per second of wall time
  return {
    fps: +(f.length / wall).toFixed(1), p95: f.length ? +f[Math.floor(0.95 * (f.length - 1))].toFixed(1) : 0, max: f.length ? +f[f.length - 1].toFixed(1) : 0,
    over20: f.filter(x => x > 20).length, drawn: +(drawn / wall).toFixed(1),
    raster: per('RasterTask'), paint: +(per('Paint') + per('PrePaint') + per('Layerize')).toFixed(1), gpu: per('GPUTask'),
    style: +(per('UpdateLayoutTree') + per('Layout')).toFixed(1), commit: per('Commit'), rafJs: per('FireAnimationFrame'), eventJs: per('EventDispatch'),
  }
}
export const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
export async function sweep(page, box, n = 120) {
  for (let i = 0; i < n; i++) {
    const k = i / n
    await page.mouse.move(box.x + box.width * (0.05 + 0.9 * Math.abs(((k * 3) % 2) - 1)), box.y + box.height * (0.05 + 0.9 * k)); await frame(page)
  }
}
export const idle = (page) => page.waitForTimeout(2000)


// What is written to the DOM under `locator` while `act` runs: the count, and the commonest targets.
export async function writesDuring(locator, act) {
  await locator.evaluate(el => {
    const w = window; w.__w = {}
    const name = (n) => n.nodeType === 1 ? `${n.tagName.toLowerCase()}.${String(n.className?.baseVal ?? n.className).split(' ')[0]}` : `text in ${n.parentElement?.className}`
    w.__wo = new MutationObserver(ms => { for (const m of ms) { const k = `${name(m.target)} ${m.attributeName || m.type}`; w.__w[k] = (w.__w[k] || 0) + 1 } })
    w.__wo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true })
  })
  const result = await act()
  const w = await locator.page().evaluate(() => { window.__wo.disconnect(); return window.__w })
  const top = Object.entries(w).sort((x, y) => y[1] - x[1])
  return { result, writes: top.reduce((n, [, v]) => n + v, 0), top: top.slice(0, 4).map(([k, v]) => `${v} × ${k}`) }
}
export const saver = (file, out) => () => { fs.mkdirSync('e2e/.out', { recursive: true }); fs.writeFileSync(file, JSON.stringify(out, null, 1)) }

// Where the lag comes from: for each screen, the frames while the pointer moves, the long frames with the script
// that made them, and which elements React rewrote while nothing was clicked.
import { test } from '../fixtures.js'
import fs from 'node:fs'

const REC = () => {
  const w = window
  w.__perf = { on: false, frames: [], loaf: [], muts: {}, mutTotal: 0 }
  let last = 0
  const tick = (t) => { if (w.__perf.on && last) w.__perf.frames.push(t - last); last = t; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  try {
    new PerformanceObserver(list => {
      if (!w.__perf.on) return
      for (const e of list.getEntries()) w.__perf.loaf.push({
        d: Math.round(e.duration), block: Math.round(e.blockingDuration), style: Math.round(e.startTime + e.duration - e.styleAndLayoutStart),
        scripts: (e.scripts || []).map(s => ({ d: Math.round(s.duration), inv: s.invoker, fn: s.sourceFunctionName, url: (s.sourceURL || '').split('/').pop(), forced: Math.round(s.forcedStyleAndLayoutDuration) })),
      })
    }).observe({ type: 'long-animation-frame', buffered: false })
  } catch { /* an older browser */ }
  const name = (n) => { let el = n.nodeType === 1 ? n : n.parentElement; while (el && !(el.className && typeof el.className === 'string') && !el.dataset?.testid) el = el.parentElement
    return el ? (el.dataset?.testid ? `[${el.dataset.testid}]` : '.' + el.className.split(' ')[0]) : '?' }
  document.addEventListener('DOMContentLoaded', () => new MutationObserver(ms => {
    if (!w.__perf.on) return
    for (const m of ms) { const k = `${m.type}:${name(m.target)}`; w.__perf.muts[k] = (w.__perf.muts[k] || 0) + 1; w.__perf.mutTotal++ }
  }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }))
}

let out = {}, outFile = ''
const save = () => { if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1)) }
// a step that fails says so in the file and the profile carries on: one missing control must not lose the rest
async function step(label, fn) { try { await fn() } catch (e) { out[`${label} FAILED`] = String(e.message || e).split('\n')[0]; save() } }
async function record(page, label, act) {
  await page.evaluate(() => { const p = window.__perf; p.frames = []; p.loaf = []; p.muts = {}; p.mutTotal = 0; p.on = true })
  await act()
  const r = await page.evaluate(() => { const p = window.__perf; p.on = false; return { frames: p.frames, loaf: p.loaf, muts: p.muts, mutTotal: p.mutTotal } })
  const f = r.frames.slice().sort((a, b) => a - b), q = (x) => f.length ? +f[Math.min(f.length - 1, Math.floor(x * f.length))].toFixed(1) : 0
  const scripts = {}
  for (const l of r.loaf) for (const s of l.scripts) { const k = `${s.inv} ${s.fn}@${s.url}`; scripts[k] = scripts[k] || { n: 0, ms: 0, forced: 0 }; scripts[k].n++; scripts[k].ms += s.d; scripts[k].forced += s.forced }
  out[label] = {
    frames: f.length, p50: q(0.5), p95: q(0.95), max: q(1), over20: f.filter(x => x > 20).length, over34: f.filter(x => x > 34).length, over50: f.filter(x => x > 50).length,
    longFrames: r.loaf.length, longFrameMs: r.loaf.reduce((a, l) => a + l.d, 0), styleMs: r.loaf.reduce((a, l) => a + l.style, 0),
    scripts: Object.entries(scripts).sort((a, b) => b[1].ms - a[1].ms).slice(0, 6),
    mutations: r.mutTotal, mutTop: Object.entries(r.muts).sort((a, b) => b[1] - a[1]).slice(0, 8),
  }
  save()
}
const frame = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())))
async function sweep(page, box, n = 150) {
  for (let i = 0; i < n; i++) {
    const k = i / n, x = box.x + box.width * (0.05 + 0.9 * Math.abs(((k * 3) % 2) - 1)), y = box.y + box.height * (0.05 + 0.9 * k)
    await page.mouse.move(x, y); await frame(page)
  }
}
const idle = (page, ms = 1500) => page.waitForTimeout(ms)

for (const rate of [1, 4]) {
  test(`profile at ${rate}x cpu`, async ({ app, context }) => {
    test.setTimeout(420_000)
    app.setDefaultTimeout(15_000)
    out = {}; fs.mkdirSync('e2e/.out', { recursive: true }); outFile = `e2e/.out/perf-${rate}x.json`
    await app.addInitScript(REC)
    const cdp = await context.newCDPSession(app)
    const T = (l) => `${rate}x ${l}`
    const vp = { x: 0, y: 0, width: 1440, height: 900 }

    await app.goto('/command-center'); await app.waitForTimeout(4000)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })
    await record(app, T('home idle'), () => idle(app))
    await record(app, T('home pointer'), () => sweep(app, vp))

    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await app.goto('/blotter'); await app.waitForTimeout(3000)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate })
    await record(app, T('blotter idle'), () => idle(app))
    await record(app, T('blotter pointer'), () => sweep(app, vp))
    await record(app, T('blotter wheel'), async () => { await app.mouse.move(700, 500); for (let i = 0; i < 60; i++) { await app.mouse.wheel(0, i < 30 ? 60 : -60); await frame(app) } })

    await app.getByText('+ NEW TRADE').first().click()
    const win = app.locator('.tbw-window'); await win.waitFor(); await app.waitForTimeout(2500)
    let box = await win.boundingBox()
    await record(app, T('rates ticket idle'), () => idle(app))
    await record(app, T('rates ticket pointer'), () => sweep(app, box))
    const drag = async () => {
      const b = await win.boundingBox(); const hx = b.x + b.width * 0.45, hy = b.y + 12
      await app.mouse.move(hx, hy); await app.mouse.down()
      for (let i = 1; i <= 90; i++) { await app.mouse.move(hx + 120 * Math.sin(Math.PI * 4 * i / 90), hy + 60 * Math.sin(Math.PI * 6 * i / 90)); await frame(app) }   // ends where it began
      await app.mouse.up()
    }
    await step(T('rates ticket drag'), () => record(app, T('rates ticket drag'), drag))
    await app.mouse.up()

    await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
    await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click(); await app.waitForTimeout(3000)
    box = await win.boundingBox()
    await record(app, T('crypto ticket idle'), () => idle(app))
    await record(app, T('crypto ticket pointer'), () => sweep(app, box))
    await step(T('crypto ticket drag'), () => record(app, T('crypto ticket drag'), drag))
    await app.mouse.up()
    await step(T('typing a notional'), async () => {
      const inp = win.locator('input[type="text"]:visible, input:not([type]):visible').first()
      await inp.click()
      await record(app, T('typing a notional'), async () => { for (const ch of '1234567') { await app.keyboard.type(ch); await frame(app); await frame(app) } })
    })
    await step(T('crypto scenario'), async () => {
      await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click(); await app.waitForTimeout(2500)
      await record(app, T('crypto scenario idle'), () => idle(app))
      const cb = await win.getByTestId('fx-scenario-chart').boundingBox()
      await record(app, T('crypto scenario chart pointer'), () => sweep(app, cb, 120))
    })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    save()
  })
}

// What the screen costs to draw. The frame profile (profile.spec.js) measures the main thread; this one measures
// the work after it (paint, raster, the GPU process) at the pixel count of a 16-inch laptop, and switches off one
// suspect at a time (blur behind cards, canvases, endless animations, shadows) to see which one the cost belongs to.
// The perf config runs this on the full Chromium build, which draws with the machine's own graphics chip even
// headless; the default headless shell rasterises in software and overstates every figure. Frames are still paced
// at 60 a second: on a 120 Hz screen the budget per frame is half, so read `ms` (work per drawn frame) against 8.3.
import { test } from '../fixtures.js'
import fs from 'node:fs'
import { CSS, setCss, frame, traced, median, sweep, idle } from './trace.js'

test.use({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 })

const out = {}
const outFile = 'e2e/.out/paint.json'
const save = () => fs.writeFileSync(outFile, JSON.stringify(out, null, 1))
async function step(label, fn) { try { await fn() } catch (e) { out[`${label} FAILED`] = String(e.message || e).split('\n')[0]; save() } }
test('what each screen costs to draw', async ({ app, browser }) => {
  test.setTimeout(600_000)
  app.setDefaultTimeout(15_000)
  fs.mkdirSync('e2e/.out', { recursive: true })
  const vp = { x: 0, y: 0, width: 1728, height: 1117 }
  // one screen, one action, under each switch
  // each switch in turn, the whole round `reps` times, the median of each figure kept: one run of one switch
  // moves by more than the difference between two switches
  const under = async (name, variants, act, reps = 1) => {
    const runs = {}
    for (let r = 0; r < reps; r++) for (const v of variants) {
      await setCss(app, CSS[v]); await app.waitForTimeout(400)
      await step(`${name} [${v}]`, async () => { (runs[v] = runs[v] || []).push(await traced(browser, app, act)) })
    }
    for (const [v, list] of Object.entries(runs)) {
      const m = { runs: list.length }; for (const k of Object.keys(list[0])) m[k] = median(list.map(x => x[k]))
      m.over20max = Math.max(...list.map(x => x.over20)); out[`${name} [${v}]`] = m
    }
    save(); await setCss(app, '')
  }
  const every = Object.keys(CSS)

  await app.goto('/command-center'); await app.waitForTimeout(5000)
  await under('home idle', every, () => idle(app), 3)
  await under('home pointer', ['base', 'no blur', 'no canvas', 'no animation', 'all off'], () => sweep(app, vp), 3)

  await app.goto('/blotter'); await app.waitForTimeout(3000)
  await under('blotter idle', ['base', 'all off'], () => idle(app))
  await under('blotter pointer', ['base', 'all off'], () => sweep(app, vp))
  await under('blotter wheel', ['base', 'all off'], async () => { await app.mouse.move(800, 600); for (let i = 0; i < 60; i++) { await app.mouse.wheel(0, i < 30 ? 60 : -60); await frame(app) } })

  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window'); await win.waitFor(); await app.waitForTimeout(2500)
  const drag = async () => {
    const b = await win.boundingBox(); const hx = b.x + b.width * 0.45, hy = b.y + 12
    await app.mouse.move(hx, hy); await app.mouse.down()
    for (let i = 1; i <= 90; i++) { await app.mouse.move(hx + 120 * Math.sin(Math.PI * 4 * i / 90), hy + 60 * Math.sin(Math.PI * 6 * i / 90)); await frame(app) }   // ends where it began
    await app.mouse.up()
  }
  await under('rates ticket idle', ['base', 'all off'], () => idle(app))
  await under('rates ticket pointer', ['base', 'all off'], async () => sweep(app, await win.boundingBox()))
  await under('rates ticket drag', ['base', 'no shadow', 'all off'], drag, 3)
  await app.mouse.up()

  await step('crypto ticket', async () => {
    await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
    await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click(); await app.waitForTimeout(3000)
    await under('crypto ticket pointer', ['base', 'all off'], async () => sweep(app, await win.boundingBox()))
    await under('crypto ticket drag', ['base', 'all off'], drag, 3)
    await app.mouse.up()
    await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click(); await app.waitForTimeout(2500)
    await under('crypto scenario idle', ['base', 'no canvas', 'all off'], () => idle(app))
  })
  save()
})

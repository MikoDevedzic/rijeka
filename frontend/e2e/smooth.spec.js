// What is rewritten on the page while the pointer moves and nothing is pressed. A handler that sets state on every
// mouse move redraws the screen under the hand: that was the lag the owner felt on 9 November 2026, when a drag
// rewrote the whole ticket (1,733 attributes in three seconds on a swap). Frame times are a measurement, taken on a
// real graphics chip (e2e/perf, local); the number of writes is the same on any machine, so that is what is held.
// Measured on 12 November 2026: nothing under a pointer on the blotter or a ticket; a drag writes the window's own
// position and nothing else; on the home, the policy chart's tip and the clocks.
import { test, expect, expectClean } from './fixtures.js'

const frame = (page) => page.evaluate(() => new Promise(r => requestAnimationFrame(() => r())))
const watch = (page) => page.evaluate(() => {
  const name = (n) => { let el = n.nodeType === 1 ? n : n.parentElement
    while (el && !(typeof el.className === 'string' && el.className) && !el.dataset?.testid) el = el.parentElement
    return el ? (el.dataset?.testid ? `[${el.dataset.testid}]` : '.' + el.className.split(' ')[0]) : '?' }
  window.__writes = {}
  window.__watch = new MutationObserver(ms => { for (const m of ms) { const k = name(m.target); window.__writes[k] = (window.__writes[k] || 0) + 1 } })
  window.__watch.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
})
const written = (page) => page.evaluate(() => { window.__watch.disconnect(); return window.__writes })
// a slow figure of eight across the middle of the box, a frame between steps
async function sweep(page, box, n = 90) {
  for (let i = 0; i <= n; i++) {
    const t = i / n
    await page.mouse.move(box.x + box.width * (0.15 + 0.7 * t), box.y + box.height * (0.5 + 0.3 * Math.sin(t * Math.PI * 4)))
    await frame(page)
  }
}
const count = (writes, allowed = []) => Object.entries(writes).filter(([k]) => !allowed.some(rx => rx.test(k))).reduce((s, [, n]) => s + n, 0)
const say = (writes) => JSON.stringify(Object.entries(writes).sort((a, b) => b[1] - a[1]).slice(0, 6))

test('the blotter and a ticket rewrite nothing under a moving pointer; a drag writes only the window', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.locator('.bl-row, tbody tr').first().waitFor()
  await app.waitForTimeout(600)
  const view = app.viewportSize()
  await watch(app)
  await sweep(app, { x: 220, y: 120, width: view.width - 260, height: view.height - 200 })
  const blotter = await written(app)
  expect(count(blotter), `the blotter under a pointer wrote ${say(blotter)}`).toBeLessThanOrEqual(8)

  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await app.waitForTimeout(800)
  const box = await win.boundingBox()
  await watch(app)
  // across the ticket's body, clear of its header (a tab's hover is the browser's own) and of the info marks' tips
  await sweep(app, { x: box.x + 20, y: box.y + 140, width: box.width - 40, height: box.height - 260 })
  const ticket = await written(app)
  // a label's tip may open as the pointer crosses it: that is the one thing a pointer is allowed to write here
  expect(count(ticket, [/tip/i]), `the ticket under a pointer wrote ${say(ticket)}`).toBeLessThanOrEqual(8)

  // a drag by the title bar: the window's own position, and nothing inside it
  const hx = box.x + box.width / 2, hy = box.y + 22
  await app.mouse.move(hx, hy)
  await watch(app)
  await app.mouse.down()
  for (let i = 1; i <= 60; i++) { await app.mouse.move(hx + 100 * Math.sin(Math.PI * 4 * i / 60), hy + 40 * Math.sin(Math.PI * 6 * i / 60)); await frame(app) }
  await app.mouse.up()
  const drag = await written(app)
  expect(drag['.tbw-window'] || 0, 'the window moved').toBeGreaterThan(10)
  // the ticket may redraw once as the drag starts and once as it ends (Firefox and Safari: three fields each time);
  // what it must not do is redraw on every move, which is sixty moves times every field of the form
  expect(count(drag, [/^\.tbw-window$/]), `a drag wrote more than the window's position: ${say(drag)}`).toBeLessThanOrEqual(40)
  expectClean(problems)
})

test('the home rewrites only its chart\'s tip and its clocks under a moving pointer', async ({ app, problems }) => {
  await app.goto('/command-center')
  await app.locator('.dh-plot svg').first().waitFor({ timeout: 30_000 })
  await app.waitForTimeout(1200)
  const view = app.viewportSize()
  await watch(app)
  await sweep(app, { x: 20, y: 180, width: view.width - 40, height: view.height - 220 })
  const home = await written(app)
  expect(count(home, [/^\.dh-plot$/, /^\.dh-tip$/, /^\.dh-clock/, /^\.dh-cross$/, /^\.dh-marker$/]), `the home under a pointer wrote ${say(home)}`).toBeLessThanOrEqual(12)
  expectClean(problems)
})

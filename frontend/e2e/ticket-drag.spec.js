// Moving the ticket. It follows the pointer, stays where it is dropped, cannot be pushed above the top of the
// screen (the header would be lost), and travelling does not make React write the ticket again: before this
// journey a three-second drag rewrote 1,700 attributes of the rates ticket and 3,300 of the crypto one. A press
// that does not travel, or one with the right button, starts nothing. The first journey drives the rates ticket
// through all of it; the second drags the crypto ticket, which prices itself, and counts the writes the same way.
import { test, expect, expectClean, API } from './fixtures.js'

test('ticket: dragged by its header it follows the pointer, rests where dropped, and is not re-rendered on the way', async ({ app, problems }) => {
  await app.goto('/blotter')
  const par = app.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith('/api/price/par-rate'))
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await expect(win.getByRole('button', { name: '▶ PRICE' })).toBeVisible()
  await par                                          // the par rate has landed: nothing else is about to write the ticket
  await app.waitForLoadState('networkidle')

  const at = async () => win.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, left: el.style.left, top: el.style.top, transform: el.style.transform, willChange: el.style.willChange } })
  const frame = () => app.evaluate(() => new Promise(r => requestAnimationFrame(() => r())))
  const before = await at()
  const hx = before.x + 500, hy = before.y + 12      // the header, clear of the traffic lights

  // a press that does not travel, and a press with the other button, change nothing on the window
  await app.mouse.move(hx, hy)
  await app.mouse.down()
  await frame()
  expect((await at()).willChange, 'a press alone does not lift the window onto its own layer').toBe('')
  await app.mouse.up()
  await app.mouse.down({ button: 'right' })
  await app.mouse.move(hx + 40, hy + 40); await frame()
  await app.mouse.up({ button: 'right' })
  await app.keyboard.press('Escape')
  expect(Math.round((await at()).x - before.x), 'the right button does not move the window').toBe(0)

  // count what is written to the ticket from press to just before release; the window's own style is how it moves
  await win.evaluate(el => {
    window.__writes = []
    const name = (n) => n.nodeType === 1 ? `${n.tagName.toLowerCase()}.${String(n.className?.baseVal ?? n.className).split(' ')[0]}` : `text in ${n.parentElement?.className}`
    window.__obs = new MutationObserver(ms => { for (const m of ms) if (!(m.target === el && m.attributeName === 'style')) window.__writes.push(`${name(m.target)} ${m.attributeName || m.type}`) })
    window.__obs.observe(el, { subtree: true, childList: true, attributes: true, characterData: true })
  })
  await app.mouse.move(hx, hy)
  await app.mouse.down()
  for (let i = 1; i <= 30; i++) { await app.mouse.move(hx + 4 * i, hy + 3 * i); await frame() }
  const mid = await at()
  const writes = await app.evaluate(() => { window.__obs.disconnect(); return window.__writes })
  expect(Math.round(mid.x - before.x), 'the window is under the pointer while the button is down').toBe(120)
  expect(Math.round(mid.y - before.y)).toBe(90)
  expect(mid.left, 'on the way it moves as a transform: its resting place is not rewritten').toBe(before.left)
  expect(mid.transform).toContain('translate3d(120px, 90px')
  expect(writes, 'nothing inside the ticket is rewritten while it moves').toEqual([])
  await app.mouse.up()
  await frame()

  const dropped = await at()
  expect(Math.round(dropped.x - before.x), 'it rests where it was dropped').toBe(120)
  expect(Math.round(dropped.y - before.y)).toBe(90)
  expect(dropped.transform, 'at rest the position is left/top, with no transform left behind').toBe('')
  expect(dropped.willChange).toBe('')
  expect(parseFloat(dropped.left)).toBeCloseTo(parseFloat(before.left) + 120, 0)

  // pushed far above the screen, the top edge stops at the top
  await app.mouse.move(hx + 120, hy + 90)
  await app.mouse.down()
  for (let i = 1; i <= 10; i++) { await app.mouse.move(hx + 120, Math.max(0, hy + 90 - 60 * i)); await frame() }
  await app.mouse.up()
  await frame()
  const top = await at()
  expect(Math.round(top.y), 'the header cannot leave the screen').toBe(0)
  expect(Math.round(top.x - dropped.x)).toBe(0)

  // a click on the header that does not travel leaves the window where it is, and the ticket still works
  await app.mouse.click(top.x + 500, top.y + 12)
  expect(Math.round((await at()).y)).toBe(0)
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  const priced = app.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith('/price/preview') && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  expect((await priced).status(), 'the moved ticket still prices').toBe(200)
  expectClean(problems)
})

test('crypto ticket: priced and at rest, a drag by its header rewrites nothing inside it', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
  await win.getByRole('button', { name: /^CRYPTO FORWARD$/i }).click()
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value')), { message: 'the ticket priced itself' }).toBeGreaterThan(0)
  await expect(win.getByTestId('fx-pricing')).toHaveCount(0)
  await app.waitForLoadState('networkidle')

  const frame = () => app.evaluate(() => new Promise(r => requestAnimationFrame(() => r())))
  const box = await win.boundingBox()
  const hx = box.x + 500, hy = box.y + 12
  await win.evaluate(el => {
    window.__writes = []
    const name = (n) => n.nodeType === 1 ? `${n.tagName.toLowerCase()}.${String(n.className?.baseVal ?? n.className).split(' ')[0]}` : `text in ${n.parentElement?.className}`
    window.__obs = new MutationObserver(ms => { for (const m of ms) if (!(m.target === el && m.attributeName === 'style')) window.__writes.push(`${name(m.target)} ${m.attributeName || m.type}`) })
    window.__obs.observe(el, { subtree: true, childList: true, attributes: true, characterData: true })
  })
  await app.mouse.move(hx, hy)
  await app.mouse.down()
  for (let i = 1; i <= 30; i++) { await app.mouse.move(hx + 4 * i, hy + 3 * i); await frame() }
  const writes = await app.evaluate(() => { window.__obs.disconnect(); return window.__writes })
  const mid = await win.boundingBox()
  await app.mouse.up()
  expect(Math.round(mid.x - box.x), 'the window is under the pointer while the button is down').toBe(120)
  expect(Math.round(mid.y - box.y)).toBe(90)
  expect(writes, 'nothing inside the crypto ticket is rewritten while it moves').toEqual([])
  expectClean(problems)
})

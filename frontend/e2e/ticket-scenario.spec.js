// CURVE SCENARIO in the XVA tab's shape: every curve the price was built on is listed; whichever is selected is
// shocked flat, point by point, or by dragging on the chart; the result is one table, factor by factor, whose
// total is the change in value; one ladder, for the selected curve; nothing scrolls inside the tab.
import { test, expect, expectClean, expectNoHorizontalOverflow, API } from './fixtures.js'

const selectDemoBank = (app, win) => win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
const num = (s) => Number(String(s).replace(/[^0-9.+\-−]/g, '').replace('−', '-'))

test('a forward: its curves are listed; the discounting curve is shocked flat, by a point and by a drag; the table adds up', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  const priced = app.waitForResponse(r => r.url().startsWith(API) && /\/forward\/price$/.test(r.url()) && r.request().method() === 'POST' && r.status() === 200)
  await selectDemoBank(app, win)
  const quote = await (await priced).json()
  // the answer carries the pillars of the curve it discounted on
  expect(quote.curves.quote.id).toBe(quote.quote_curve)
  expect(quote.curves.quote.pillars.length).toBeGreaterThan(2)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await expect(win.getByTestId('fx-scenario-chart')).toBeVisible()

  // the curves that price this trade, each with its risk factor's mark; nothing has been moved
  for (const k of ['spot', 'fwd', 'quote']) {
    await expect(win.getByTestId(`fx-scn-curve-${k}`)).toBeVisible()
    await expect(win.getByTestId(`fx-scn-says-${k}`)).toHaveText('—')
  }
  await expect(win.getByTestId('fx-scn-curve-quote')).toContainText(quote.quote_curve)
  await expect(win.getByTestId('fx-scn-curve-spot')).toHaveAttribute('aria-pressed', 'true')
  const forward = async () => Number(await win.getByTestId('fx-scenario-forward').getAttribute('data-value'))
  const cells = async (row) => (await win.getByTestId(row).locator(':scope > div').allInnerTexts()).slice(1)
  const total = async () => num((await cells('fx-scn-change')).at(-1))
  expect(await forward()).toBeCloseTo(quote.forward, 2)
  expect(await total()).toBe(0)

  // the discounting curve: its pillars as a table and a chart
  await win.getByTestId('fx-scn-curve-quote').click()
  await expect(win.getByTestId('fx-rate-curve')).toBeVisible()
  const rows = win.getByTestId('fx-scn-points').locator('tbody tr')
  expect(await rows.count()).toBeGreaterThan(2)
  const zero0 = num(await rows.nth(0).locator('td').nth(1).innerText())

  // flat: +25 bp on every pillar
  const flat = win.getByTestId('fx-scn-flat')
  await flat.focus()
  for (let i = 0; i < 5; i++) await app.keyboard.press('ArrowRight')
  await expect(win.getByTestId('fx-scn-says-quote')).toHaveText('+25 bp')
  expect(num(await rows.nth(0).locator('td').nth(3).innerText())).toBeCloseTo(zero0 + 0.25, 3)
  expect((await cells('fx-scn-shock'))[2]).toBe('+25 bp')
  const flatOnly = await total()
  expect(flatOnly, 'a higher discount rate carries the forward up: a bought forward gains').toBeGreaterThan(0)
  // the table adds up: the factors alone, plus what is left over, are the total, and the total is the CHANGE tile
  const add = async () => { const c = (await cells('fx-scn-change')).map(num); return { sum: c.slice(0, -1).reduce((a, b) => a + b, 0), total: c.at(-1) } }
  let t = await add()
  expect(Math.abs(t.sum - t.total)).toBeLessThanOrEqual(2)
  // sensitivity × shock is the ticket's own IR01 × 25
  expect(Math.abs(num((await cells('fx-scn-first'))[2]) - 25 * quote.ir01_disc)).toBeLessThanOrEqual(1)

  // a typed point, with a sign: the pillar nearest the settlement moves, and the price with it
  const settleRow = rows.filter({ hasText: /^3M/ }).first()
  await settleRow.locator('input').fill('-40')
  await settleRow.locator('input').blur()
  await expect(win.getByTestId('fx-scn-says-quote')).toHaveText('+25 bp · 1 point')
  await expect.poll(total).toBeLessThan(flatOnly)
  // an unreadable shock changes nothing
  const before = await total()
  await rows.nth(0).locator('input').fill('abc')
  await rows.nth(0).locator('input').blur()
  expect(await total()).toBe(before)
  await expect(win.getByTestId('fx-scn-says-quote')).toHaveText('+25 bp · 1 point')

  // a drag on the chart: the first pillar goes up
  const pillar = win.getByTestId('fx-rate-curve').locator('circle').first()
  const box = await pillar.boundingBox()
  await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await app.mouse.down()
  await app.mouse.move(box.x + box.width / 2, box.y - 30, { steps: 6 })
  await app.mouse.up()
  await expect(win.getByTestId('fx-scn-says-quote')).toHaveText('+25 bp · 2 points')
  await app.screenshot({ path: 'e2e/.out/shots/scenario-rate-curve.png' })

  // one ladder, for the selected curve; its middle column is the scenario
  const ladder = win.getByTestId('fx-scn-ladder')
  await expect(ladder).toContainText(`LADDER · ${quote.quote_curve}`)
  expect(Number(await win.getByTestId('fx-scenario-base').getAttribute('data-forward'))).toBeCloseTo(await forward(), 6)

  // RESET CURVE takes back this curve only; RESET ALL the rest
  await win.getByTestId('fx-scn-curve-spot').click()
  await win.getByTestId('fx-scn-flat-value').fill('2')
  await win.getByTestId('fx-scn-flat-value').blur()
  await expect(win.getByTestId('fx-scn-says-spot')).toHaveText('+2%')
  await win.getByTestId('fx-scn-curve-quote').click()
  await win.getByTestId('fx-scn-reset-curve').click()
  await expect(win.getByTestId('fx-scn-says-quote')).toHaveText('—')
  await expect(win.getByTestId('fx-scn-says-spot')).toHaveText('+2%')
  t = await add()
  expect(Math.abs(t.sum - t.total)).toBeLessThanOrEqual(2)
  await win.getByTestId('fx-scenario-reset').click()
  await expect(win.getByTestId('fx-scn-says-spot')).toHaveText('—')
  expect(await total()).toBe(0)

  // nothing scrolls inside the tab, and it is not wider than the window
  expect(await win.getByTestId('fx-scn-left').evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1)
  await expectNoHorizontalOverflow(win, 'the scenario tab')
  expectClean(problems)
})

test('an FX forward lists both rate curves and its quoted points; an option adds its vol surface', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'FX', exact: true }).click()
  await win.getByRole('button', { name: /^FX FORWARD$/i }).click()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  for (const k of ['spot', 'fwd', 'quote', 'base']) await expect(win.getByTestId(`fx-scn-curve-${k}`)).toBeVisible()
  await expect(win.getByTestId('fx-scn-curve-vol')).toHaveCount(0)
  // the quoted points move together, in pips
  await win.getByTestId('fx-scn-curve-fwd').click()
  await win.getByTestId('fx-scn-flat-value').fill('5')
  await win.getByTestId('fx-scn-flat-value').blur()
  await expect(win.getByTestId('fx-scn-says-fwd')).toHaveText('+5 pips')
  await expect(win.getByTestId('fx-scn-shock')).toContainText('+5 pips')
  await app.screenshot({ path: 'e2e/.out/shots/scenario-fx-points.png' })

  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  await win.getByRole('button', { name: /^FX OPTION$/i }).click()
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value')), { timeout: 30_000 }).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await expect(win.getByTestId('fx-scn-curve-vol')).toBeVisible()
  await win.getByTestId('fx-scn-curve-vol').click()
  await expect(win.getByTestId('fx-vol-surface')).toBeVisible()
  expectClean(problems)
})

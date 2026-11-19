// CURVE SCENARIO on a rates ticket, in the one shape every product's scenario tab has: the curves that price the
// trade are listed; whichever is selected is shocked flat, point by point, or by dragging on its chart, a volatility
// surface exactly as a rate curve; the result is one table whose total is the change in value; one ladder. Every
// figure is the pricing engine's own: with nothing shocked it is the ticket's value, and a cap is repriced as a cap.
import { test, expect, expectClean, expectNoHorizontalOverflow, API } from './fixtures.js'

const selectDemoBank = (app, win) => win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
const settled = (win) => expect(win.getByTestId('scn-tab')).toHaveAttribute('data-busy', 'false', { timeout: 60_000 })
const value = async (loc) => Number(await loc.getAttribute('data-value'))

// a rates ticket of one product, priced, on its CURVE SCENARIO tab; returns the window and the ticket's own price
async function priced(app, chip, route) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  if (chip) await win.getByRole('button', { name: chip, exact: true }).click()
  // a collar has no strike to take from the market: both are typed (a cap's and a floor's left blank are at the money)
  if (/COLLAR/.test(chip || '')) { await win.getByTestId('cap-rate').fill('4.5'); await win.getByTestId('floor-rate').fill('3.0') }
  await selectDemoBank(app, win)
  const answer = app.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith(route) && r.request().method() === 'POST' && r.status() === 200)
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const quote = await (await answer).json()
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await expect(win.getByTestId('scn-chart')).toBeVisible({ timeout: 30_000 })
  await settled(win)
  return { win, quote }
}
const flat = async (win, v) => { const box = win.getByTestId('scn-flat-value'); await box.fill(String(v)); await box.blur(); await settled(win) }

test('a swap: its curve is listed and shocked flat, by a point and by a drag; the engine reprices it; the ladder stands on the scenario', async ({ app, problems }) => {
  const { win, quote } = await priced(app, null, '/price/preview')
  // the curve the price was built on, and no volatility
  await expect(win.getByTestId('scn-curve-USD_SOFR')).toHaveAttribute('aria-pressed', 'true')
  await expect(win.getByTestId('scn-curve-vol')).toHaveCount(0)
  await expect(win.getByTestId('scn-says-USD_SOFR')).toHaveText('—')
  // nothing shocked: the engine's value is the ticket's, and nothing has changed
  expect(await value(win.getByTestId('scn-npv'))).toBeCloseTo(quote.npv, 2)
  expect(await value(win.getByTestId('scn-change-total'))).toBe(0)
  // the points are the saved quotes, up to the trade's last date and two after
  const pts = win.getByTestId('scn-points').locator('tbody tr')
  expect(await pts.count()).toBeGreaterThan(4)
  await expect(win.getByTestId('scn-point-5Y')).toBeVisible()
  await expect(win.getByTestId('scn-point-30Y')).toHaveCount(0)

  // +10bp flat: the change is about ten IR01s, and the one column is the total
  await flat(win, 10)
  await expect(win.getByTestId('scn-says-USD_SOFR')).toHaveText('+10 bp')
  const d10 = await value(win.getByTestId('scn-change-total'))
  expect(d10 / (quote.ir01 * 10), 'ten basis points move a swap by about ten IR01s').toBeGreaterThan(0.95)
  expect(d10 / (quote.ir01 * 10)).toBeLessThan(1.05)
  const change = win.getByTestId('scn-change')
  expect(await value(change.locator('[data-cell="USD_SOFR"]'))).toBeCloseTo(d10, 2)
  expect(await value(change.locator('[data-cell="total"]'))).toBeCloseTo(d10, 2)
  await expect(change.locator('[data-cell="cross"]')).toHaveCount(0)
  expect(await value(win.getByTestId('scn-first').locator('[data-cell="USD_SOFR"]'))).toBeCloseTo(quote.ir01 * 10, 0)

  // the ladder is the curve moved further, on top of the scenario: its middle is the scenario, +10 more is +20 in all
  const ladder = win.getByTestId('scn-ladder')
  expect(Number(await ladder.getByTestId('scn-ladder-base').getAttribute('data-npv'))).toBeCloseTo(await value(win.getByTestId('scn-npv')), 2)
  const up10 = Number(await ladder.locator('[data-ladder="10"]').getAttribute('data-npv'))
  expect((up10 - quote.npv) / (quote.ir01 * 20)).toBeGreaterThan(0.95)
  expect((up10 - quote.npv) / (quote.ir01 * 20)).toBeLessThan(1.05)

  // a point of its own: typed, it carries the brass rule and the button says so
  const five = win.locator('input[data-point="5Y"]')
  await five.fill('5'); await five.blur(); await settled(win)
  await expect(win.getByTestId('scn-says-USD_SOFR')).toHaveText('+10 bp · 1 point')
  expect(Number(await win.getByTestId('scn-point-5Y').getAttribute('data-scenario')) - Number(await win.getByTestId('scn-point-5Y').getAttribute('data-market'))).toBeCloseTo(0.15, 6)
  expect(await value(win.getByTestId('scn-change-total')), 'the five-year quote moved further moves a five-year swap further').toBeGreaterThan(d10 * 1.2)
  await expect(win.getByTestId('scn-first').locator('[data-cell="USD_SOFR"]'), 'a curve shocked point by point has no single figure to multiply').toHaveText('—')

  // a drag on the chart moves that quote, and the engine answers
  const before = await value(win.getByTestId('scn-change-total'))
  await win.evaluate(el => { el.scrollTop = 0 })                  // the chart is at the top of the tab, under the ticket's own bar when scrolled
  const dot = win.getByTestId('scn-chart').locator('circle[data-pillar="2Y"]')
  const box = await dot.boundingBox()
  await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await app.mouse.down(); await app.mouse.move(box.x + box.width / 2, box.y - 40, { steps: 6 }); await app.mouse.up()
  await settled(win)
  await expect(win.getByTestId('scn-says-USD_SOFR')).toHaveText('+10 bp · 2 points')
  expect(Number(await win.locator('input[data-point="2Y"]').inputValue()), 'the dragged quote went up').toBeGreaterThan(0)
  expect(await value(win.getByTestId('scn-change-total'))).not.toBeCloseTo(before, 0)
  await expectNoHorizontalOverflow(win.getByTestId('scn-tab'), 'the swap scenario tab')
  await win.screenshot({ path: 'e2e/.out/shots/scn-swap.png' })

  // RESET ALL: the ticket's value again
  await win.getByTestId('scn-reset').click(); await settled(win)
  expect(await value(win.getByTestId('scn-change-total'))).toBe(0)
  expect(await value(win.getByTestId('scn-npv'))).toBeCloseTo(quote.npv, 2)
  await expect(win.getByTestId('scn-error')).toHaveCount(0)
  expectClean(problems)
})

for (const [name, chip, route, npvKey, vegaKey, ir01Key] of [
  ['a cap', 'INTEREST RATE CAP', '/api/price/cap', 'npv', 'vega', 'ir01'],
  ['a collar', 'INTEREST RATE COLLAR', '/api/price/collar', 'net_npv', 'net_vega', 'net_ir01'],
  ['a swaption', 'IR SWAPTION', '/api/price/swaption', 'npv', 'vega', 'ir01'],
]) test(`${name}: priced as itself; its volatility is one of its curves, moved flat, by a point and by a drag as a rate curve is; curve and vol add up`, async ({ app, problems }) => {
  const { win, quote } = await priced(app, chip, route)
  const tag = name.replace(/\W+/g, '-')
  // the engine's value with nothing shocked is this product's own price, not a swap's
  expect(await value(win.getByTestId('scn-npv'))).toBeCloseTo(quote[npvKey], 2)
  await expect(win.getByTestId('scn-curve-USD_SOFR')).toBeVisible()
  await expect(win.getByTestId('scn-curve-vol')).toBeVisible()
  await win.screenshot({ path: `e2e/.out/shots/scn-${tag}-curve.png` })

  // the volatility: selected, it has a chart of its own with points to drag, a flat shock and a point-by-point table
  await win.getByTestId('scn-curve-vol').click(); await settled(win)
  await expect(win.getByTestId('scn-chart')).toBeVisible()
  expect(await win.getByTestId('scn-chart').locator('circle[data-pillar]').count(), 'the surface\'s points').toBeGreaterThan(2)
  expect(await win.getByTestId('scn-points').locator('tbody tr').count()).toBeGreaterThan(2)
  // what the lines and the dot are is said under the chart, as on a currency option's
  await expect(win.getByTestId('scn-legend')).toContainText('ATM')
  if (name !== 'a collar') await expect(win.getByTestId('scn-legend')).toContainText('THE VOL THIS TRADE PRICED AT')
  await flat(win, 5)
  await expect(win.getByTestId('scn-legend')).toContainText('SHOCKED')
  await expect(win.getByTestId('scn-says-vol')).toHaveText('+5 bp')
  const dVol = await value(win.getByTestId('scn-change').locator('[data-cell="vol"]'))
  expect(dVol / (quote[vegaKey] * 5), 'five basis points of vol move it by about five vegas').toBeGreaterThan(0.9)
  expect(dVol / (quote[vegaKey] * 5)).toBeLessThan(1.1)
  expect(await value(win.getByTestId('scn-change-total'))).toBeCloseTo(dVol, 2)
  // a point of the surface dragged up: the button says a point was moved, and the engine answers
  const dots = win.getByTestId('scn-chart').locator('circle[data-pillar]')
  await win.evaluate(el => { el.scrollTop = 0 })
  const box = await dots.nth(1).boundingBox()
  await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await app.mouse.down(); await app.mouse.move(box.x + box.width / 2, box.y - 30, { steps: 6 }); await app.mouse.up()
  await settled(win)
  await expect(win.getByTestId('scn-says-vol')).toHaveText('+5 bp · 1 point')
  await win.screenshot({ path: `e2e/.out/shots/scn-${tag}-vol.png` })
  await win.getByTestId('scn-reset-curve').click(); await settled(win)
  await flat(win, 5)

  // the curve as well: each alone, the two together, and what is left over is the cross term
  await win.getByTestId('scn-curve-USD_SOFR').click(); await settled(win)
  await flat(win, 10)
  const change = win.getByTestId('scn-change')
  const [dCurve, dV, cross, total] = [await value(change.locator('[data-cell="USD_SOFR"]')), await value(change.locator('[data-cell="vol"]')), await value(change.locator('[data-cell="cross"]')), await value(change.locator('[data-cell="total"]'))]
  expect(dV).toBeCloseTo(dVol, 2)
  expect(dCurve / (quote[ir01Key] * 10), 'ten basis points of curve move it by about ten IR01s, the vol held').toBeGreaterThan(0.8)
  expect(dCurve / (quote[ir01Key] * 10)).toBeLessThan(1.2)
  expect(dCurve + dV + cross).toBeCloseTo(total, 1)
  expect(Math.abs(cross), 'the cross term is small beside the two').toBeLessThan(Math.abs(dCurve) + Math.abs(dV))
  expect(await value(win.getByTestId('scn-npv'))).toBeCloseTo(quote[npvKey] + total, 1)
  await expectNoHorizontalOverflow(win.getByTestId('scn-tab'), `${name}: the scenario tab`)
  await expect(win.getByTestId('scn-error')).toHaveCount(0)
  await win.screenshot({ path: `e2e/.out/shots/scn-${tag}-both.png` })
  expectClean(problems)
})

test('a Bermudan swaption: its vol is the tree\'s own σ, shocked flat; its curve is shocked and the tree answers', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.getByRole('button', { name: 'IR SWAPTION', exact: true }).click()
  await win.getByRole('button', { name: 'BERMUDAN', exact: true }).click()
  await selectDemoBank(app, win)
  const answer = app.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith('/api/price/swaption') && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const priced = await answer
  test.skip(priced.status() !== 200, 'the stack has no Hull-White calibration to price a Bermudan on')
  const quote = await priced.json()
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await expect(win.getByTestId('scn-chart')).toBeVisible({ timeout: 30_000 })
  await settled(win)
  expect(await value(win.getByTestId('scn-npv'))).toBeCloseTo(quote.npv, 2)
  await flat(win, 10)
  expect(await value(win.getByTestId('scn-change-total')), 'the curve moves the tree').not.toBe(0)
  await expect(win.getByTestId('scn-error')).toHaveCount(0)
  await win.getByTestId('scn-reset').click(); await settled(win)
  // the vol in the list is the model's σ: one number, no points to drag, shocked flat; a basis point of it is the ticket's vega
  await win.getByTestId('scn-curve-vol').click()
  await expect(win.getByTestId('scn-curve-vol')).toContainText('HULL-WHITE σ')
  await expect(win.getByTestId('scn-points')).toHaveCount(0)
  await expect(win.getByTestId('scn-chart-second')).toHaveCount(0)
  await expect(win.getByTestId('scn-no-points')).toContainText('Hull-White tree')
  await expect(win.getByTestId('scn-no-points')).toContainText('one number')
  expect(await value(win.getByTestId('scn-vol')), 'the σ shown is the tree\'s, as the ticket\'s price reports it').toBeCloseTo(quote.vol_bp, 6)
  await flat(win, 1)
  const dVol = await value(win.getByTestId('scn-change-total'))
  expect(dVol, 'a higher σ is worth more to the holder of the option').not.toBe(0)
  if (quote.vega) expect(dVol / quote.vega, 'one basis point of σ is the ticket\'s vega').toBeCloseTo(1, 1)
  expect(await value(win.getByTestId('scn-vol'))).toBeCloseTo(quote.vol_bp + 1, 6)
  await expect(win.getByTestId('scn-error')).toHaveCount(0)
  await win.screenshot({ path: 'e2e/.out/shots/scn-bermudan-sigma.png' })
  expectClean(problems)
})

test('terms changed after the price: the scenario is of the terms as priced, and says so', async ({ app, problems }) => {
  const { win, quote } = await priced(app, 'INTEREST RATE CAP', '/api/price/cap')
  await expect(win.getByTestId('scn-stale')).toHaveCount(0)
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  const strike = win.getByTestId('cap-rate')
  await strike.fill('4.75'); await strike.blur()
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await expect(win.getByTestId('scn-stale')).toContainText('The terms have changed since the ticket was priced')
  await settled(win)
  expect(await value(win.getByTestId('scn-npv')), 'still the value of the terms as priced').toBeCloseTo(quote.npv, 2)
  expectClean(problems)
})

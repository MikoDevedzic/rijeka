// The shape of a ticket, the same on every product: TRADE is what the user sets; what comes back is in the footer
// on every tab and, in full, on CASHFLOWS (the flows as legs with their present values, then the valuation with
// its formulas); DETAILS is the record and the market it was priced on. A new ticket opens on digital assets.
// The same risk factor is the same colour on every product, and a figure that changes rolls to its new value.
import { test, expect, expectClean, expectNoHorizontalOverflow, API } from './fixtures.js'

const num = (s) => Number(String(s).replace(/[^0-9.+\-−]/g, '').replace('−', '-'))
const selectDemoBank = (app, win) => win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
const priced = async (win) => {
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value')), { message: 'the ticket priced itself' }).toBeGreaterThan(0)
  await expect(win.getByTestId('fx-pricing')).toHaveCount(0)
}
const markColour = (win, label) => win.locator('.tbw-footer .tbw-footer-metric', { hasText: label }).first().locator('.rf-mark').evaluate(el => getComputedStyle(el).backgroundColor)

test('a new ticket opens on a digital-asset forward: inputs on TRADE, the record on DETAILS, the flows and the valuation on CASHFLOWS', async ({ app, problems }) => {
  await app.goto('/blotter')
  // the blotter's rail lists digital assets first
  const rail = app.locator('.bl-left .bl-filter-btn')
  await expect(rail.filter({ hasText: /^(CRYPTO|FX|RATES)$/ }).first()).toHaveText(/CRYPTO/)
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  // digital assets first among the asset classes, and selected; the forward is the instrument
  const chips = win.locator('.tbw-chip-row').first().locator('.tbw-chip')
  await expect(chips).toHaveText(['CRYPTO', 'FX', 'RATES'])
  await expect(chips.nth(0)).toHaveClass(/is-on/)
  await expect(win.getByRole('button', { name: /^CRYPTO FORWARD$/i })).toHaveClass(/is-on/)
  await selectDemoBank(app, win)
  await priced(win)

  // TRADE: what the user sets, and nothing that comes back but the footer
  const trade = win.locator('.tbw-fieldset')
  await expect(trade).toContainText('PRIMARY ECONOMICS')
  await expect(trade).toContainText('FORWARD TERMS')
  for (const out of ['ANALYTICS', 'BREAKDOWN', 'SIMULATE in XVA tab']) await expect(win.getByText(out, { exact: false }), `${out} is not among the inputs`).toHaveCount(0)
  const footer = win.locator('.tbw-footer')
  await expect(footer).toContainText('NET NPV')
  expect(await win.evaluate(el => el.scrollHeight <= el.clientHeight + 1), 'the TRADE tab fits the window without scrolling inside it').toBe(true)
  await app.screenshot({ path: 'e2e/.out/shots/shape-crypto-trade.png' })

  // DETAILS: the record beside the market it was priced on, as rows
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await expect(win.getByText('TERM SHEET · AS IT WILL BE BOOKED', { exact: true })).toBeVisible()
  await expect(win.getByText('MARKET IT WAS PRICED ON', { exact: true })).toBeVisible()
  const sheet = await win.getByText('TERM SHEET · AS IT WILL BE BOOKED', { exact: true }).boundingBox()
  const market = await win.getByText('MARKET IT WAS PRICED ON', { exact: true }).boundingBox()
  expect(Math.abs(sheet.y - market.y), 'the two panels sit side by side').toBeLessThan(4)
  expect(market.x).toBeGreaterThan(sheet.x + 300)
  await app.screenshot({ path: 'e2e/.out/shots/shape-crypto-details.png' })

  // CASHFLOWS: summary tiles, one table per leg, the net; the legs add up to the net, and the net is the NPV
  await win.getByRole('button', { name: 'CASHFLOWS', exact: true }).click()
  const flows = win.getByText(/^CASHFLOWS · SETTLEMENT/).locator('xpath=../..')      // the heading sits in a row with its note and the export
  await expect(flows).toContainText('BTC LEG PV')
  await expect(flows).toContainText('USD LEG PV')
  await expect(flows).toContainText('SETTLES · CASH')
  const legPv = async (key) => num(await win.getByTestId(`fx-cf-leg-${key}`).locator('tbody td').last().innerText())
  const basePv = await legPv('base'), quotePv = await legPv('quote')
  expect(basePv, 'we buy: the asset leg is received').toBeGreaterThan(0)
  expect(quotePv, 'and the dollar leg is paid').toBeLessThan(0)
  const netPv = num(await win.getByTestId('fx-cf-net').locator('td').last().innerText())
  expect(Math.abs(basePv + quotePv - netPv), 'the two legs add up to the net').toBeLessThanOrEqual(1)
  const npv = num(await win.getByTestId('fx-cf-npv').innerText())
  expect(Math.abs(netPv - npv), 'and the net is the NPV the engine gave').toBeLessThanOrEqual(1)
  // under the flows, the valuation: the figures with their formulas and what the price was built from
  const valuation = win.getByTestId('fx-valuation')
  await expect(valuation).toContainText('ANALYTICS')
  await expect(valuation).toContainText('BREAKDOWN (MARKET)')
  const flowsY = (await win.getByText(/^CASHFLOWS · SETTLEMENT/).boundingBox()).y
  expect((await valuation.boundingBox()).y, 'the flows come first').toBeGreaterThan(flowsY)
  await valuation.getByText('Σ MATH').click()
  await expect(valuation).toContainText('±N·(F − K)·DF_USD')
  await expectNoHorizontalOverflow(win, 'the CASHFLOWS tab')
  await app.screenshot({ path: 'e2e/.out/shots/shape-crypto-cashflows.png' })

  // sold instead of bought: each leg changes sides, and they still add up to the net and to the NPV
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  const before = await win.getByTestId('fx-forward-rate').getAttribute('data-value')
  await win.getByRole('button', { name: 'Sell BTC', exact: true }).click()
  await priced(win)
  expect(await win.getByTestId('fx-forward-rate').getAttribute('data-value')).toBe(before)
  await win.getByRole('button', { name: 'CASHFLOWS', exact: true }).click()
  await expect.poll(() => legPv('base'), { message: 'sold: the asset leg is paid' }).toBeLessThan(0)
  expect(await legPv('quote'), 'and the dollar leg received').toBeGreaterThan(0)
  await expect(win.getByTestId('fx-cf-leg-base')).toContainText('→ PAY')
  await expect(win.getByTestId('fx-cf-leg-quote')).toContainText('← RECEIVE')
  const netSold = num(await win.getByTestId('fx-cf-net').locator('td').last().innerText())
  expect(Math.abs((await legPv('base')) + (await legPv('quote')) - netSold)).toBeLessThanOrEqual(1)
  expect(Math.abs(netSold - num(await win.getByTestId('fx-cf-npv').innerText()))).toBeLessThanOrEqual(1)

  // the same risk factor is the same colour on this forward and on a swap; the asset classes differ
  const irOnForward = await markColour(win, 'IR01')
  const spotOnForward = await markColour(win, 'CRY01')
  expect(irOnForward).not.toBe(spotOnForward)
  await expect(footer.locator('.tbw-footer-metric', { hasText: 'NET NPV' }).locator('.rf-mark'), 'a value is not a risk factor').toHaveCount(0)
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  const swapPriced = app.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith('/price/preview') && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  expect((await swapPriced).status()).toBe(200)
  await expect(footer).toContainText('IR01')
  expect(await markColour(win, 'IR01'), 'IR01 on a swap is the colour of IR01 on a digital-asset forward').toBe(irOnForward)
  // the swap's TRADE tab holds no valuation either, and its CASHFLOWS has it under the legs
  // (the swap's CASHFLOWS pane is mounted and hidden by now, so this is about what can be seen on TRADE)
  for (const out of [/^ANALYTICS/, /BREAKDOWN/]) expect(await win.getByText(out).filter({ visible: true }).count(), `${out} is not on the swap's TRADE tab`).toBe(0)
  await win.getByRole('button', { name: 'CASHFLOWS', exact: true }).click()
  await expect(win.getByText('FIXED LEG PV', { exact: true })).toBeVisible()
  await expect(win.getByText(/^ANALYTICS/).first()).toBeVisible()
  expect((await win.getByText(/^ANALYTICS/).first().boundingBox()).y).toBeGreaterThan((await win.getByText('FIXED LEG PV', { exact: true }).boundingBox()).y)
  await app.screenshot({ path: 'e2e/.out/shots/shape-rates-cashflows.png' })
  expectClean(problems)
})

test('a figure that changes rolls to its new value and flashes once; with less motion asked for it is simply shown', async ({ app, problems }) => {
  await app.emulateMedia({ reducedMotion: 'no-preference' })
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await priced(win)
  const spot = win.locator('.tbw-footer .tbw-footer-metric', { hasText: 'CRY01' }).locator('[data-roll]')
  await expect(spot).toHaveText(/\d/)
  const before = await spot.getAttribute('data-roll')
  // watch the figure while the notional doubles: every frame it shows is a well-formed figure between the two
  await spot.evaluate(el => { window.__frames = []; new MutationObserver(() => window.__frames.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true }) })
  const notional = win.locator('.tbw-fx-grid-6 input').first()
  await notional.fill('20')
  await expect.poll(() => spot.getAttribute('data-roll'), { message: 'the sensitivity doubled' }).not.toBe(before)
  await expect(spot).toHaveClass(/rj-flash/)
  const after = await spot.getAttribute('data-roll')
  await expect(spot, 'the roll ends on the figure itself').toHaveText(after)
  const frames = await app.evaluate(() => window.__frames)
  expect(frames.length, 'it rolled through figures in between').toBeGreaterThan(3)
  const lo = Math.min(num(before), num(after)), hi = Math.max(num(before), num(after))
  for (const f of frames) {
    expect(f, 'a frame is a figure the app would print').toMatch(/^[+\-−]?\$?[\d,]+(\.\d+)?$/)
    expect(num(f)).toBeGreaterThanOrEqual(lo - 1); expect(num(f)).toBeLessThanOrEqual(hi + 1)
  }
  await expect(spot, 'the number went up: the flash is the colour of a rise').toHaveClass(/rj-flash-up/)

  // less motion: the new figure is shown, with no frames in between
  await app.emulateMedia({ reducedMotion: 'reduce' })
  await app.evaluate(() => { window.__frames = [] })
  const shown = await spot.getAttribute('data-roll')
  await notional.fill('10')
  await expect.poll(() => spot.getAttribute('data-roll')).not.toBe(shown)
  await expect(spot).toHaveText(await spot.getAttribute('data-roll'))
  expect((await app.evaluate(() => window.__frames)).length, 'one write, no roll').toBeLessThanOrEqual(1)
  expectClean(problems)
})

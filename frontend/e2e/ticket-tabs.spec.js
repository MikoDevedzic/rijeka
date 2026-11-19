// The other tabs of a rates option ticket say what the price is made of, and offer nothing that does not reach it
// (0.59.1, from the second walk of the tickets). A swaption's CASHFLOWS showed a swap made up in the browser: every
// accrual exactly one year, no payment lag, and two legs that did not add to nothing at the at-the-money strike as
// the tab said. A collar's had a table with no rows. DETAILS on a cap, a floor, a collar and a swaption offered a
// swap's coupon, spread and notional schedules, and a fee schedule, that nothing read. A currency NDF showed the
// day its price fixes on only on DETAILS.
import { test, expect, expectClean, API } from './fixtures.js'

const num = (s) => Number(String(s).replace(/[^0-9.−-]/g, '').replace('−', '-'))
const SHOTS = 'e2e/.out/shots'
async function ticket(app, cls, product) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: cls, exact: true }).click()
  await win.getByRole('button', { name: new RegExp(`^${product}$`, 'i') }).click()
  return win
}
const price = async (app, win, route) => {
  const answer = app.waitForResponse(r => r.url() === `${API}${route}` && r.request().method() === 'POST' && r.ok(), { timeout: 90_000 })
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  return (await answer).json()
}

test('a swaption\'s CASHFLOWS is the swap it books, valued by the engine: its two legs add to about nothing at the money', async ({ app, problems }) => {
  const win = await ticket(app, 'RATES', 'IR SWAPTION')
  await expect(win.getByTestId('swaption-underlying')).toBeVisible()
  const legs = app.waitForResponse(r => r.url() === `${API}/price/preview` && r.request().method() === 'POST' && r.ok() && (r.request().postDataJSON().legs || []).length === 2 && r.request().postDataJSON().legs[0].effective_date > '2027', { timeout: 90_000 })
  const quote = await price(app, win, '/api/price/swaption')
  const res = await legs
  const sent = res.request().postDataJSON(), under = await res.json()
  expect(sent.legs.find(l => l.leg_type === 'FIXED').fixed_rate, 'the delivered swap\'s coupon is the strike the price struck').toBeCloseTo(quote.strike, 10)
  await win.getByRole('button', { name: 'CASHFLOWS', exact: true }).click()
  const said = win.getByTestId('swaption-underlying-npv')
  await expect(said).toContainText('The two legs add to')
  const fixed = under.legs.find(l => l.leg_type === 'FIXED'), float = under.legs.find(l => l.leg_type === 'FLOAT')
  expect(Math.abs(fixed.pv + float.pv), 'at the money the delivered swap is worth about nothing: under a thousandth of a leg').toBeLessThan(Math.abs(fixed.pv) * 0.001)
  expect(Math.abs(num((await said.innerText()).split('add to')[1].split('today')[0]) - (fixed.pv + float.pv))).toBeLessThanOrEqual(1)
  // the engine's periods: an ACT/360 year is more than one, and the coupon is paid after the period ends
  const cf = fixed.cashflows[0]
  expect(cf.dcf).toBeGreaterThan(1.01)
  expect(cf.payment_date > cf.period_end, 'paid after the period, by the payment lag').toBe(true)
  await expect(win.getByText(cf.dcf.toFixed(5)).first()).toBeVisible()
  await expect(win.getByText('1.00000')).toHaveCount(0)
  await win.screenshot({ path: `${SHOTS}/swaption-cashflows.png` })

  // DETAILS: no schedule of a swap's that the option's price does not read
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await expect(win.getByTestId('details-not-open')).toContainText('is not open on this ticket')
  await expect(win.getByText('PERIOD SCHEDULE')).toHaveCount(0)
  await expect(win.getByText('OPTION FEE SCHEDULE')).toHaveCount(0)
  expectClean(problems)
})

test('a collar\'s CASHFLOWS lists each option\'s periods, and they add to the net', async ({ app, problems }) => {
  const win = await ticket(app, 'RATES', 'INTEREST RATE COLLAR')
  await expect(win.locator('input[type=date]').nth(2)).not.toHaveValue('')
  await win.getByTestId('cap-rate').fill('4.5'); await win.getByTestId('floor-rate').fill('3.0')
  const quote = await price(app, win, '/api/price/collar')
  await win.getByRole('button', { name: 'CASHFLOWS', exact: true }).click()
  const groups = win.getByTestId('caplet-group')
  await expect(groups).toHaveCount(2)
  await expect(groups.nth(0)).toContainText('CAP @ 4.50% · held')
  await expect(groups.nth(1)).toContainText('FLOOR @ 3.00% · written')
  expect(Math.abs(num(await groups.nth(0).locator('td').last().innerText()) - quote.cap_npv)).toBeLessThanOrEqual(1)
  expect(Math.abs(num(await groups.nth(1).locator('td').last().innerText()) + quote.floor_npv), 'the written floor is a liability').toBeLessThanOrEqual(1)
  await expect(win.getByTestId('caplet-rows').locator('tr')).toHaveCount(2 + 2 * quote.n_caplets + 1)        // two headings, the periods, the total
  await win.screenshot({ path: `${SHOTS}/collar-cashflows.png` })
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await expect(win.getByTestId('details-not-open')).toContainText('A collar is one leg at one notional and two strikes')
  expectClean(problems)
})

test('a cap\'s DETAILS offers no swap schedule; an amortizing swap says where its schedule is; a currency NDF says when it fixes', async ({ app, problems }) => {
  let win = await ticket(app, 'RATES', 'INTEREST RATE CAP')
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await expect(win.getByTestId('details-not-open')).toContainText('A cap is one leg at one notional and one strike')
  await expect(win.getByText('FIXED LEG')).toHaveCount(0)

  win = await ticket(app, 'RATES', 'IR SWAP')
  await win.getByRole('button', { name: 'AMORTIZING', exact: true }).first().click()
  await expect(win.locator('.tbw-helper-badge').first()).toContainText('the notional by period is set on DETAILS')
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await expect(win.getByText('PERIOD SCHEDULE').first(), 'a swap keeps its schedules').toBeVisible()

  win = await ticket(app, 'FX', 'NDF')
  const badge = win.locator('.tbw-helper-badge', { hasText: 'non-deliverable' })
  await expect(badge).toContainText(/fixes \d{4}-\d{2}-\d{2}, settles \d{4}-\d{2}-\d{2}/, { timeout: 30_000 })
  const [, fixes, settles] = (await badge.innerText()).match(/fixes (\S+), settles (\S+)/)
  expect(fixes < settles, 'it fixes before it settles').toBe(true)
  await win.screenshot({ path: `${SHOTS}/ndf-fixes.png` })
  expectClean(problems)
})

test('the XVA tab says what the run did that the figures do not: a Bermudan as its European, a basis swap with nothing on the paths, an American option as its European', async ({ app, problems }) => {
  const bank = (win) => win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  const run = async (win, route) => {
    await win.getByRole('button', { name: 'XVA', exact: true }).click()
    const answer = app.waitForResponse(r => r.url() === `${API}${route}` && r.request().method() === 'POST' && r.ok(), { timeout: 120_000 })
    await win.getByRole('button', { name: /SIMULATE/ }).first().click()
    return (await answer).json()
  }
  // a Bermudan swaption
  let win = await ticket(app, 'RATES', 'IR SWAPTION')
  await win.getByRole('button', { name: 'BERMUDAN', exact: true }).first().click()
  await bank(win)
  await expect(win.getByTestId('swaption-underlying')).toBeVisible()
  await price(app, win, '/api/price/swaption')
  let out = await run(win, '/api/xva/simulate')
  expect(out.basis.run_as).toBe('EUROPEAN')
  await expect(win.getByTestId('xva-basis')).toContainText('a Bermudan, run as its European: exercised at the expiry only')

  // a basis swap: two floating legs off one curve
  win = await ticket(app, 'RATES', 'IR SWAP')
  await win.getByRole('button', { name: 'BASIS', exact: true }).first().click()
  await bank(win)
  await expect(win.locator('input[type=date]').nth(2)).not.toHaveValue('')
  await price(app, win, '/price/preview')
  out = await run(win, '/api/xva/simulate')
  expect(out.basis.one_curve).toBe(true)
  expect(Math.abs(out.xva.cva) + Math.abs(out.xva.dva)).toBeLessThan(0.01)
  await expect(win.getByTestId('xva-basis')).toContainText('both legs off one curve: no exposure on the paths, capital only')

  // an American option on a currency pair
  win = await ticket(app, 'FX', 'FX OPTION')
  await win.locator('.tbw-chip', { hasText: /^AMERICAN$/ }).first().click()
  await bank(win)
  await price(app, win, '/api/currency/option/price')
  await run(win, '/api/xva/currency-option')
  await expect(win.getByText('AMERICAN, run on the paths as its European (a lower bound)')).toBeVisible()
  await win.screenshot({ path: `${SHOTS}/xva-american-words.png` })
  expectClean(problems)
})

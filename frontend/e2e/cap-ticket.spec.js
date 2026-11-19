// A cap, a floor and a collar ticket price the trade they book (0.59.0). The price on the ticket and the value of the
// booked trade, read back from the stored record, are one figure: the ticket sends the leg it books, and the dates,
// the day count and the side on it are the ones priced. (The routes priced a schedule of their own: the ticket's dates
// and day count were not read, a sold option showed a bought one's figures, an untouched cap was struck at 4.5 %
// whatever the curve, and the vol field showed the text of an escape sequence.) Also here, from the same walk of the
// tickets: a sold swaption carries its sign; the swap a swaption delivers is shown as it is priced, not as fields
// that never reached the price; a basis swap's first leg is not called fixed, and an index with no curve of its own
// says what it is forecast off.
import { test, expect, expectClean, API } from './fixtures.js'

const selectDemoBank = (app, win) => win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
const num = (s) => Number(String(s).replace(/[^0-9.−-]/g, '').replace('−', '-'))
const SHOTS = 'e2e/.out/shots'

async function ticket(app, product) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.getByRole('button', { name: new RegExp(`^${product}$`, 'i') }).click()
  await expect(win.locator('input[type=date]').nth(2), 'the schedule dates have arrived').not.toHaveValue('')
  return win
}
const price = async (app, win, route) => {
  const answer = app.waitForResponse(r => r.url() === `${API}${route}` && r.request().method() === 'POST', { timeout: 90_000 })
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const res = await answer
  expect(res.ok(), `${route} answers`).toBe(true)
  return { sent: res.request().postDataJSON(), quote: await res.json() }
}
const first = (win) => win.locator('.tbw-footer-metric').first()

test('a cap left alone is struck at the money, says what it read, and is worth what the booked trade is worth', async ({ app, problems }) => {
  const win = await ticket(app, 'INTEREST RATE CAP')
  // an option on the rate has a side, not a pay or receive of a fixed leg
  await expect(win.getByText('DIRECTION', { exact: true })).toHaveCount(0)
  await expect(win.getByRole('button', { name: 'PAY FIXED' })).toHaveCount(0)
  // nothing typed: no strike and no vol of the ticket's own, and each field says where its number will come from
  await expect(win.getByTestId('cap-rate')).toHaveValue('')
  await expect(win.getByTestId('cap-rate-note')).toContainText('at the money')
  await expect(win.getByTestId('cap-vol')).toHaveValue('')
  await expect(win.getByTestId('cap-vol')).toHaveAttribute('placeholder', 'surface')
  await expect(win.getByTestId('cap-vol-note')).toContainText('cap surface')
  await selectDemoBank(app, win)

  const { sent, quote } = await price(app, win, '/api/price/cap')
  expect(sent.cap_rate ?? null, 'a blank strike is sent as none').toBeNull()
  expect(sent.vol_override_bp, 'and no vol').toBeUndefined()
  const dates = [await win.locator('input[type=date]').nth(1).inputValue(), await win.locator('input[type=date]').nth(2).inputValue()]
  expect([sent.leg.effective_date, sent.leg.maturity_date], 'the leg sent is the ticket\'s own dates').toEqual(dates)
  expect([quote.effective_date, quote.maturity_date], 'and they are the ones priced').toEqual(dates)
  expect(quote.strike_from).toBe('ATM')
  expect(quote.cap_rate).toBeCloseTo(quote.atm_forward, 10)
  expect(quote.caplets[0].start_date, 'the first period starts on the effective date').toBe(dates[0])
  await expect(win.getByTestId('cap-rate-note')).toContainText(`${+(quote.cap_rate * 100).toFixed(4)} %`)
  await expect(win.getByTestId('cap-vol-note')).toContainText(`${+quote.vol_bp.toFixed(2)} bp`)
  await expect(win.getByTestId('cap-priced-note')).toContainText(`${quote.n_caplets} periods from ${dates[0]} to ${dates[1]}`)
  expect(Math.abs(num(await first(win).locator('span').last().innerText()) - quote.npv)).toBeLessThanOrEqual(1)
  await win.screenshot({ path: `${SHOTS}/cap-ticket-atm.png` })

  // booked: the strike the price struck, and the stored trade is worth the ticket's price
  const booked = app.waitForResponse(r => r.url().includes('/api/book/trade') && r.request().method() === 'POST', { timeout: 90_000 })
  const stored = app.waitForResponse(r => r.url() === `${API}/price` && r.request().method() === 'POST' && r.ok(), { timeout: 90_000 })
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  const res = await booked
  expect(res.ok(), 'the cap is booked').toBe(true)
  const body = res.request().postDataJSON()
  expect(body.terms.cap_rate, 'the booking carries the rate the price struck').toBe(quote.cap_rate)
  expect(body.legs[0].embedded_options[0]).toMatchObject({ type: 'CAP', direction: 'BUY', default_strike: quote.cap_rate })
  expect(body.terms.premium_amount).toBeCloseTo(quote.npv, 2)
  const value = (await (await stored).json()).npv
  expect(Math.abs(value - quote.npv), 'the stored trade\'s value is the ticket\'s price').toBeLessThanOrEqual(0.01)
  expectClean(problems)
})

test('the day count, a typed start and the side on a cap ticket are priced; a changed term takes the price\'s words away', async ({ app, problems }) => {
  const win = await ticket(app, 'INTEREST RATE CAP')
  await win.getByTestId('cap-rate').fill('4.5')
  const base = (await price(app, win, '/api/price/cap')).quote
  expect(base.strike_from).toBe('TYPED')
  await expect(win.getByTestId('cap-rate-note'), 'a typed strike is shown against the money').toContainText('ATM')
  await expect(win.getByTestId('cap-priced-note')).toBeVisible()

  // a term changed: the words of the old price go until it is priced again
  await win.locator('select').filter({ hasText: 'ACT/365F' }).first().selectOption('30/360')
  await expect(win.getByTestId('cap-priced-note')).toHaveCount(0)
  const thirty = (await price(app, win, '/api/price/cap')).quote
  expect(thirty.day_count).toBe('30/360')
  expect(Math.abs(thirty.npv / base.npv - 1), 'another day count is another price').toBeGreaterThan(0.01)
  await expect(win.getByTestId('cap-priced-note')).toContainText('30/360')

  // a start three months on: one period fewer, from that day
  const eff = win.locator('input[type=date]').nth(1)
  const start = new Date(Date.parse((await eff.inputValue()) + 'T00:00:00Z')); start.setUTCMonth(start.getUTCMonth() + 3)
  await eff.fill(start.toISOString().slice(0, 10))
  const later = (await price(app, win, '/api/price/cap')).quote
  expect(later.n_caplets).toBe(thirty.n_caplets - 1)
  expect(later.caplets[0].start_date).toBe(start.toISOString().slice(0, 10))

  // sold: the same trade with its sign turned, in every figure of the footer, and the model's premium is received
  await win.getByRole('button', { name: 'SELL', exact: true }).first().click()
  await win.getByTestId('cap-vol').fill('100')
  const sold = await price(app, win, '/api/price/cap')
  expect(sold.sent).toMatchObject({ side: 'SELL', vol_override_bp: 100 })
  expect(sold.quote.npv).toBeLessThan(0)
  expect(sold.quote.vega).toBeLessThan(0)
  expect(sold.quote.vol_tier).toBe('OVERRIDE')
  await expect(first(win)).toContainText('−')
  await expect(win.getByTestId('cap-vol-note')).toContainText('typed')
  const block = win.getByTestId('fees-block')
  await block.scrollIntoViewIfNeeded()
  await block.getByRole('button', { name: /MODEL PREMIUM/ }).click()
  await expect(win.getByTestId('footer-fees-net')).toBeVisible()
  const pv = num(await win.getByTestId('footer-fees-pv').locator('span').last().innerText())
  expect(pv, 'the premium of a sold cap comes to us').toBeGreaterThan(0)
  expect(Math.abs(num(await win.getByTestId('footer-fees-net').locator('span').last().innerText())), 'a sold cap and its premium come to about nothing').toBeLessThan(Math.abs(sold.quote.npv) * 0.02 + 5)
  await win.screenshot({ path: `${SHOTS}/cap-ticket-sold.png` })
  expectClean(problems)
})

test('text that is not a rate or a vol is refused in words and nothing is priced on it', async ({ app, problems }) => {
  const win = await ticket(app, 'INTEREST RATE CAP')
  let asked = 0
  app.on('request', r => { if (/\/api\/price\/(cap|floor|collar)$/.test(r.url()) && r.method() === 'POST') asked += 1 })
  await win.getByTestId('cap-rate').fill('abc')
  await expect(win.getByTestId('cap-rate-note')).toContainText('not a rate')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await expect(win.locator('.tbw-footer')).toContainText('is not a rate in percent')
  await win.getByTestId('cap-rate').fill('')
  await win.getByTestId('cap-vol').fill('-5')
  await expect(win.getByTestId('cap-vol-note')).toContainText('not a vol')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await expect(win.locator('.tbw-footer')).toContainText('is not a normal vol')
  expect(asked, 'neither reached the pricer').toBe(0)
  expectClean(problems)
})

test('a floor at the money mirrors the cap; an index with no curve of its own says what it is forecast off', async ({ app, problems }) => {
  const win = await ticket(app, 'INTEREST RATE FLOOR')
  await expect(win.getByTestId('floor-rate')).toHaveValue('')
  await win.locator('select').filter({ hasText: 'TERM SOFR 3M' }).first().selectOption('TERM SOFR 3M')
  const { quote } = await price(app, win, '/api/price/floor')
  expect(quote.strike_from).toBe('ATM')
  expect(quote.floor_rate).toBeCloseTo(quote.atm_forward, 10)
  expect(quote.ir01, 'a bought floor loses as rates rise').toBeLessThan(0)
  await expect(win.getByTestId('cap-index-note')).toContainText('forecast off USD_SOFR')
  expectClean(problems)
})

test('a collar\'s strikes are typed; sold, it is the floor held and the cap written', async ({ app, problems }) => {
  const win = await ticket(app, 'INTEREST RATE COLLAR')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await expect(win.locator('.tbw-footer')).toContainText('Type the cap rate and the floor rate')
  await win.getByTestId('cap-rate').fill('4.5'); await win.getByTestId('floor-rate').fill('3.0')
  const bought = (await price(app, win, '/api/price/collar')).quote
  await expect(win.locator('.tbw-footer')).toContainText('WIDTH')
  await expect(win.locator('.tbw-footer')).not.toContainText('ZC SPREAD')
  await win.getByRole('button', { name: 'SELL', exact: true }).first().click()
  const sold = (await price(app, win, '/api/price/collar')).quote
  expect(sold.net_npv).toBeCloseTo(-bought.net_npv, 1)
  expect(sold.net_ir01).toBeCloseTo(-bought.net_ir01, 1)
  expect([sold.cap_npv, sold.floor_npv], 'each option on its own is what it was').toEqual([bought.cap_npv, bought.floor_npv])
  await win.screenshot({ path: `${SHOTS}/collar-ticket-sold.png` })
  expectClean(problems)
})

test('a sold swaption carries its sign; the swap it delivers is shown as it is priced and is not open', async ({ app, problems }) => {
  const win = await ticket(app, 'IR SWAPTION')
  const held = (await price(app, win, '/api/price/swaption')).quote
  expect(held.npv).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'SELL', exact: true }).first().click()
  const { sent, quote } = await price(app, win, '/api/price/swaption')
  expect(sent.side).toBe('SELL')
  expect(quote.npv).toBeCloseTo(-held.npv, 2)
  expect(quote.vega).toBeCloseTo(-held.vega, 2)
  await expect(first(win)).toContainText('−')
  // the delivered swap: stated, shut, with no coupon of its own and no cap or floor to add
  await expect(win.getByTestId('swaption-underlying-note')).toContainText('paid annually on ACT/360')
  const legs = win.getByTestId('swaption-underlying-legs')
  await expect(legs).toHaveAttribute('disabled', '')
  for (const field of await legs.locator('select, input').all()) await expect(field).toBeDisabled()
  expect(await legs.locator('select, input').count(), 'the legs\' conventions are shown').toBeGreaterThan(8)
  await expect(win.getByText('COUPON (%)', { exact: true })).toHaveCount(0)
  await expect(win.getByRole('button', { name: '+ CAP' })).toHaveCount(0)
  await win.getByTestId('swaption-underlying-legs').scrollIntoViewIfNeeded()
  await win.screenshot({ path: `${SHOTS}/swaption-ticket-sold.png` })
  expectClean(problems)
})

test('a basis swap\'s legs are both floating, and the second index says what it is forecast off', async ({ app, problems }) => {
  const win = await ticket(app, 'IR SWAP')
  await win.getByRole('button', { name: 'BASIS', exact: true }).first().click()
  await expect(win.getByText('PAY FLOAT 1')).toBeVisible()
  await expect(win.locator('.tbw-sec', { hasText: 'SWAP TERMS' }).getByText('PAY FIXED')).toHaveCount(0)
  await expect(win.getByTestId('index-note-2')).toContainText('EFFR is forecast off the USD overnight curve')
  await expect(win.getByTestId('index-note')).toHaveCount(0)
  await win.getByTestId('index-note-2').scrollIntoViewIfNeeded()
  await win.screenshot({ path: `${SHOTS}/basis-ticket.png` })
  expectClean(problems)
})

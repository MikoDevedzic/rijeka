// Fees on a trade: any number of known payments entered with it (the FEES block of the TRADE tab). On a digital-asset
// option: the premium at the model's price as a row, a second fee, what they are worth today and the value net of
// them; a row that is not complete stops the booking and says so; the XVA run carries them; the booked trade keeps
// them, and the confirmation's premium is the PREMIUM row. On a swap: an upfront payment is valued on its curve.
import { test, expect, expectClean, expectNoHorizontalOverflow, API } from './fixtures.js'

const DAY = 86400000
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
const num = (s) => Number(String(s).replace(/[^0-9.−-]/g, '').replace('−', '-'))

test('a digital-asset option: its premium and another fee are entered, valued, simulated and booked with the trade', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
  await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click()
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  const priced = app.waitForResponse(r => /\/api\/currency\/option\/price/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const quote = await (await priced).json()
  expect(quote.npv, 'a bought option has a value').toBeGreaterThan(0)

  const block = win.getByTestId('fees-block')
  await block.scrollIntoViewIfNeeded()
  await expect(block.getByTestId('fees-summary')).toHaveText('none entered')
  await expect(block.getByTestId('fee-row')).toHaveCount(0)

  // 1. the premium at the model's price: one press, a PREMIUM row we pay, to change as agreed
  const valued = () => app.waitForResponse(r => r.url() === `${API}/api/price/fees` && r.request().method() === 'POST')
  let answer = valued()
  await block.getByTestId('fee-premium').click()
  const rows = block.getByTestId('fee-row')
  await expect(rows).toHaveCount(1)
  await expect(block.getByLabel('Fee 1 type')).toHaveValue('PREMIUM')
  await expect(block.getByRole('button', { name: 'Fee 1: we pay' })).toHaveAttribute('aria-pressed', 'true')
  await expect(block.getByRole('button', { name: 'Fee 1: we pay' }), 'a side takes its colour').toHaveClass(/tbw-chip-dir-pay/)
  expect(num(await block.getByLabel('Fee 1 amount').inputValue())).toBeCloseTo(quote.npv, 1)
  await expect(block.getByLabel('Fee 1 date')).toHaveValue(quote.valuation_date)
  let pv = await (await answer).json()
  expect(pv.pv, 'paid today: its whole amount, from our side').toBeCloseTo(-quote.npv, 1)
  await expect(block.getByTestId('fee-premium'), 'offered once').toHaveCount(0)
  expect(num(await block.getByTestId('fees-net').innerText()), 'the option at the model\'s price less that premium is nothing').toBeCloseTo(0, 0)

  // the agreed premium is not the model's: type it, and the net is the difference
  answer = valued()
  const agreed = Math.round(quote.npv * 0.9)
  await block.getByLabel('Fee 1 amount').fill(String(agreed))
  pv = await (await answer).json()
  expect(pv.pv).toBeCloseTo(-agreed, 2)
  await expect.poll(async () => num(await block.getByTestId('fees-net').innerText())).toBeCloseTo(quote.npv - agreed, 0)

  // 2. a second fee, of another type, on a later date: discounted from its date
  await block.getByTestId('fee-add').click()
  await expect(rows).toHaveCount(2)
  await block.getByLabel('Fee 2 type').selectOption('BROKERAGE')
  const later = iso(Date.now() + 40 * DAY)
  answer = valued()
  await block.getByLabel('Fee 2 amount').fill('2500')
  await block.getByLabel('Fee 2 date').fill(later)
  await expect(block.getByLabel('Fee 2 amount'), 'left, the amount is written with its thousands separated').toHaveValue('2,500')
  pv = await (await answer).json()
  expect(pv.fees).toHaveLength(2)
  expect(pv.fees[1].df, 'a later fee is discounted').toBeLessThan(1)
  expect(pv.fees[1].pv).toBeCloseTo(-2500 * pv.fees[1].df, 4)
  await expect(block.getByTestId('fees-summary')).toContainText('2 fees · pay')
  await expect(rows.nth(1).getByTestId('fee-pv')).toContainText('−2,4')

  // 3. a row that is not complete: said on the row, nothing is valued, and BOOK books nothing and says why
  await block.getByTestId('fee-add').click()
  await block.getByLabel('Fee 3 amount').fill('abc')
  await expect(rows.nth(2).getByTestId('fee-pv')).toContainText('the amount is a number')
  await expect(block.getByTestId('fees-summary')).toHaveText('finish or remove the incomplete row')
  await expect(block.getByTestId('fees-pv')).toHaveCount(0)
  let posted = 0
  app.on('request', r => { if (r.url() === `${API}/api/trades/` && r.method() === 'POST') posted += 1 })
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  await expect(win).toContainText('A fee on the TRADE tab is not complete')
  expect(posted).toBe(0)
  answer = valued()
  await block.getByRole('button', { name: 'Remove fee 3' }).click()
  await answer
  await expect(rows).toHaveCount(2)
  await expectNoHorizontalOverflow(win, 'the ticket with its fees')
  await app.screenshot({ path: 'e2e/.out/shots/fees-ticket.png' })

  // 4. the XVA run carries them: the request has both, the answer says what they were worth along the run
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  const sim = app.waitForResponse(r => r.url() === `${API}/api/xva/currency-option` && r.request().method() === 'POST')
  await win.getByRole('button', { name: /SIMULATE/ }).first().click()
  const run = await sim
  const sent = run.request().postDataJSON()
  expect(sent.fees.map(f => [f.type, f.direction, f.amount, f.date])).toEqual([['PREMIUM', 'PAY', agreed, quote.valuation_date], ['BROKERAGE', 'PAY', 2500, later]])
  const out = await run.json()
  // the premium is paid today: it is in the ticket's value and not in the run; the fee still to come is in the run
  expect(out.params.fees.count).toBe(1)
  expect(out.params.fees.pv).toBeLessThan(-2400)
  expect(out.params.fees.pv).toBeGreaterThan(-2500)

  // an incomplete row stops SIMULATE too, and says so: a run without the ticket's fees is not that ticket's run
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  await block.getByTestId('fee-add').click()
  await block.getByLabel('Fee 3 date').fill(later)
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  let runs = 0
  const count = r => { if (r.url() === `${API}/api/xva/currency-option` && r.method() === 'POST') runs += 1 }
  app.on('request', count)
  await win.getByRole('button', { name: /SIMULATE/ }).first().click()
  await expect(win).toContainText('A fee on the TRADE tab is not complete: finish or remove it before simulating.')
  expect(runs).toBe(0)
  app.off('request', count)
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  await block.getByRole('button', { name: 'Remove fee 3' }).click()
  await expect(rows).toHaveCount(2)

  // 5. booked: the trade keeps its fees, and the confirmation's premium is the PREMIUM row
  const booked = app.waitForResponse(r => r.url() === `${API}/api/trades/` && r.request().method() === 'POST')
  await win.getByRole('button', { name: /BOOK TRADE|RETRY BOOK/ }).click()      // after a refused attempt the button says RETRY
  const res = await booked
  expect(res.ok(), 'the trade is booked').toBe(true)
  const body = res.request().postDataJSON()
  expect(body.terms.fees).toHaveLength(2)
  expect(body.terms).toMatchObject({ premium_amount: agreed, premium_currency: 'USD', premium_payment_date: quote.valuation_date })
  const trade = await res.json()
  expect(trade.terms.fees.map(f => [f.type, f.direction, f.amount, f.currency, f.date])).toEqual([['PREMIUM', 'PAY', agreed, 'USD', quote.valuation_date], ['BROKERAGE', 'PAY', 2500, 'USD', later]])
  expectClean(problems.filter(p => !/A fee on the TRADE tab/.test(p)))
})

test('a swap: an upfront payment received in a month is a fee, valued on the swap\'s own curve', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  const block = win.getByTestId('fees-block')
  await block.scrollIntoViewIfNeeded()
  await expect(block.getByTestId('fee-premium'), 'a swap has no premium to offer').toHaveCount(0)
  await block.getByTestId('fee-add').click()
  await expect(block.getByLabel('Fee 1 type')).toHaveValue('UPFRONT')
  await block.getByRole('button', { name: 'Fee 1: we receive' }).click()
  const answer = app.waitForResponse(r => r.url() === `${API}/api/price/fees` && r.request().method() === 'POST')
  await block.getByLabel('Fee 1 amount').fill('10000')
  await block.getByLabel('Fee 1 date').fill(iso(Date.now() + 31 * DAY))
  const pv = await (await answer).json()
  expect(pv.currency).toBe('USD')
  expect(pv.pv).toBeGreaterThan(9900)
  expect(pv.pv).toBeLessThan(10000)
  await expect(block.getByTestId('fees-pv')).toContainText('+9,9')
  await expect(block.getByTestId('fees-summary')).toHaveText('1 fee · receive 10,000.00 USD · face value')
  await app.screenshot({ path: 'e2e/.out/shots/fees-swap.png' })
  expectClean(problems)
})

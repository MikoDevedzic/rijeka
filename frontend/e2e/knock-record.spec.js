// The desk records that a barrier was touched, from the ticket: a digital-asset knock-out booked, the touch recorded
// with its date and level on the CONFIRM tab, the trade then over (a fixed view, nothing outstanding), and the record
// taken off again.
import { test, expect, expectClean, expectNoHorizontalOverflow, API } from './fixtures.js'

test('a booked knock-out: the touch is recorded with its date, the trade is over, and the record can be taken off', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  let win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
  await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click()
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  const first = app.waitForResponse(r => /\/api\/currency\/option\/price$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await first
  const priced = app.waitForResponse(r => /\/api\/currency\/option\/price$/.test(r.url()) && r.request().method() === 'POST')
  await win.locator('.tbw-chip', { hasText: /^BARRIER$/ }).click()
  const quote = await (await priced).json()
  expect(quote.style).toBe('BARRIER')
  const booking = app.waitForResponse(r => /\/api\/trades\/$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  const trade = await (await booking).json()
  expect(trade.terms.style).toBe('BARRIER')
  await win.getByRole('button', { name: '◆ CONFIRM' }).click()

  // nothing recorded yet, and the block says what that means
  const block = win.getByTestId('knock-record')
  await expect(block).toBeVisible()
  await expect(win.getByTestId('knock-line')).toContainText('Nothing recorded')
  await expect(win.getByTestId('knock-never'), '"never touched" is not offered before expiry').toHaveCount(0)
  await win.getByTestId('knock-open').click()
  const today = new Date().toISOString().slice(0, 10)
  await expect(win.getByTestId('knock-date')).toHaveValue(today)
  await win.getByTestId('knock-level').fill('151,200.5')
  await expectNoHorizontalOverflow(block, 'the barrier block')
  await app.screenshot({ path: 'e2e/.out/shots/knock-record-form.png' })
  const sent = app.waitForResponse(r => r.url() === `${API}/api/currency/knock/${trade.id}` && r.request().method() === 'POST')
  // the ticket is opened again on the trade, which is priced for what it now is
  const revalued = app.waitForResponse(async r => r.url() === `${API}/price` && r.request().method() === 'POST' && (await r.json().catch(() => null))?.state === 'FIXED')
  await win.getByTestId('knock-submit').click()
  const res = await sent
  expect(res.status()).toBe(200)
  expect(res.request().postDataJSON()).toEqual({ knocked: true, on: today, level: 151200.5 })
  const terms = (await res.json()).trade.terms
  expect([terms.knocked, terms.knock_date, terms.knock_level]).toEqual([true, today, 151200.5])
  const view = await (await revalued).json()
  expect(view.npv, 'knocked out: nothing is outstanding').toBe(0)
  expect(view.model).toContain('knocked out')

  win = app.locator('.tbw-window')
  await expect(win, 'one ticket, not two').toHaveCount(1)
  await expect(win.getByTestId('knock-line')).toHaveText(`Touched on ${today} at 151,200.5`)
  await app.screenshot({ path: 'e2e/.out/shots/knock-record-done.png' })
  // the other tabs of a trade that is over: the scenario has no forward to shock and says why
  await win.getByRole('button', { name: 'CURVE SCENARIO' }).click()
  const fixedView = win.getByTestId('fx-settled-view')
  await expect(fixedView).toBeVisible()
  await expect(fixedView).toHaveAttribute('data-state', 'FIXED')
  await expect(win.getByTestId('fx-settled-knock')).toContainText(`knocked out on ${today}`)
  await expect(win.getByTestId('fx-scenario-forward')).toHaveCount(0)
  expect(await fixedView.innerText()).not.toMatch(/NaN|undefined|Infinity/)
  await app.screenshot({ path: 'e2e/.out/shots/knock-record-scenario.png' })
  await win.getByRole('button', { name: '◆ CONFIRM' }).click()

  // taken off again: the option is live once more
  const live = app.waitForResponse(async r => r.url() === `${API}/price` && r.request().method() === 'POST' && (await r.json().catch(() => null))?.state === 'LIVE')
  await win.getByTestId('knock-clear').click()
  expect((await (await live).json()).npv).toBeGreaterThan(0)
  await expect(app.locator('.tbw-window').getByTestId('knock-line')).toContainText('Nothing recorded')
  expectClean(problems)
})

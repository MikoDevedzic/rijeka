// A scenario starts from the curve the ticket priced on. The app ships with a set of quotes for every curve, and
// the store holds those until a curve's own page has been opened: a scenario opened first showed them, beside a
// ticket priced on the firm's saved snapshot (Marco, 15 November 2026). The scenario tab reads the saved snapshot
// itself, and the engine moves that snapshot's quotes.
import { test, expect, expectClean, API } from './fixtures.js'
import { RATES_CURVES } from '../src/data/ratesCurves.js'

test('a swap\'s curve scenario starts from the saved snapshot, not from the quotes the app ships with', async ({ app, problems }) => {
  const asked = app.waitForResponse(r => r.url().startsWith(API) && /\/api\/market-data\/snapshots\/USD_SOFR\/latest$/.test(r.url()))
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  // an unpriced ticket has nothing to start a scenario from, and says so
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await expect(win.getByTestId('scn-unpriced')).toBeVisible()
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  const priced = app.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith('/price/preview') && r.request().method() === 'POST' && r.status() === 200)
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await priced
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  const snap = await (await asked).json()
  expect(snap.exists, 'the stack has a saved SOFR snapshot').toBe(true)
  // the journey says something only where the saved snapshot is not the curve the app ships with
  const shipped = RATES_CURVES.find(c => c.id === 'USD_SOFR').instruments.find(i => i.tenor === '5Y').quote
  expect(Math.abs(Number(snap.quotes.find(q => q.tenor === '5Y').rate) - Number(shipped)), 'the stack\'s snapshot differs from the shipped quotes').toBeGreaterThan(0.01)
  for (const tenor of ['1Y', '5Y', '7Y']) {
    const quote = snap.quotes.find(q => q.tenor === tenor)
    expect(quote, `${tenor} is quoted`).toBeTruthy()
    await expect.poll(async () => Number(await win.getByTestId(`scn-point-${tenor}`).getAttribute('data-market')), { message: `the ${tenor} quote the scenario starts from` }).toBeCloseTo(Number(quote.rate), 6)
  }
  expectClean(problems)
})

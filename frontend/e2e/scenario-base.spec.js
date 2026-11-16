// A scenario starts from the curve the ticket priced on. The app ships with a set of quotes for every curve, and
// the store holds those until a curve's own page has been opened: a scenario opened first showed them, beside a
// ticket priced on the firm's saved snapshot (Marco, 15 November 2026).
import { test, expect, expectClean, API } from './fixtures.js'

test('a swap\'s curve scenario starts from the saved snapshot, not from the quotes the app ships with', async ({ app, problems }) => {
  const asked = app.waitForResponse(r => r.url().startsWith(API) && /\/api\/market-data\/snapshots\/USD_SOFR\/latest$/.test(r.url()))
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  const snap = await (await asked).json()
  expect(snap.exists, 'the stack has a saved SOFR snapshot').toBe(true)
  for (const tenor of ['1Y', '5Y', '10Y']) {
    const quote = snap.quotes.find(q => q.tenor === tenor)
    expect(quote, `${tenor} is quoted`).toBeTruthy()
    await expect.poll(async () => Number(await win.getByTestId(`sc-par-${tenor}`).getAttribute('data-market')), { message: `the ${tenor} par the scenario starts from` }).toBeCloseTo(Number(quote.rate), 6)
  }
  expectClean(problems)
})

// A date the API sends as a calendar day ("2026-11-14") is that day wherever the browser is. Read as a moment, it is
// midnight in London, which is the evening before in New York: the home's ticker and the maturities under it were
// a day early for everyone west of UTC. CI runs in UTC and never saw it; this journey runs in Los Angeles.
import { test, expect, expectClean } from './fixtures.js'

test.use({ timezoneId: 'America/Los_Angeles' })

test('a calendar date is the same day west of UTC: the snapshot on the home\'s ticker', async ({ app, problems }) => {
  const asked = app.waitForResponse(r => /\/api\/market-data\/snapshots\/USD_SOFR\/latest/.test(r.url()))
  await app.goto('/command-center')
  const snap = await (await asked).json()
  expect(snap.valuation_date, 'the stack has a SOFR snapshot').toBeTruthy()
  const [y, m, d] = String(snap.valuation_date).slice(0, 10).split('-').map(Number)
  const want = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  await expect(app.locator('.dh-asof')).toContainText(`SNAPSHOT · ${want}`)
  expectClean(problems)
})

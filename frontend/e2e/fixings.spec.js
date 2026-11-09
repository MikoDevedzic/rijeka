// Fixings for digital assets: the ticket's settlement source, the Fixings tab on the market-data page, and the
// CURVE SCENARIO tab with a forward curve that can be dragged and a fixing at expiry. The stack has no venue, so
// stored fixings are answered here where a journey needs them; the store, the feed and the settlement rule are
// tested on the database in backend/tests/integration/test_fixings.py.
import { test, expect, expectClean, expectFullyInView, expectNoHorizontalOverflow } from './fixtures.js'

const DAY = 86400000
const iso = (d) => new Date(d).toISOString().slice(0, 10)

async function openCrypto(app, product) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
  await win.getByRole('button', { name: product }).click()
  return win
}

test('crypto ticket: the settlement source is a choice, and says who fixes it', async ({ app, problems }) => {
  const win = await openCrypto(app, /^CRYPTO OPTION$/i)
  const pick = win.getByTestId('settles-on')
  await expect(pick).toBeVisible()
  const options = await pick.locator('option').allTextContents()
  expect(options.length, 'a benchmark and the venue').toBeGreaterThanOrEqual(2)
  const venue = options.find(o => /Deribit/.test(o))
  const bench = options.find(o => !/Deribit/.test(o))
  await pick.selectOption({ label: venue })
  await expect(win).toContainText('fixed automatically each day at 08:00 UTC')
  await expect(win).toContainText(/cash-settled in USD against Deribit BTC delivery price/i)
  await pick.selectOption({ label: bench })
  await expect(win).toContainText('your desk enters this fixing')
  await expectNoHorizontalOverflow(win, 'crypto option ticket with the settlement source')
  // the forward ticket has it too
  await win.getByRole('button', { name: /^CRYPTO FORWARD$/i }).click()
  await expect(win.getByTestId('settles-on')).toBeVisible()
  await expectNoHorizontalOverflow(win, 'crypto forward ticket with the settlement source')
  expectClean(problems)
})

test('market data: the Fixings tab lists fixings and takes a desk entry', async ({ app, problems }) => {
  const today = Date.now()
  const rows = [0, 1, 2, 3, 4].map(i => ({ date: iso(today - (5 - i) * DAY), source: 'Deribit BTC delivery price', time: '08:00 UTC', value: 74000 + 120 * i, origin: 'FEED', own: false }))
  let saved = null
  const answer = async (route, extra = []) => {
    const res = await route.fetch()
    const body = await res.json()
    await route.fulfill({ response: res, json: { ...body, stored: true, fixings: [...rows, ...extra] } })
  }
  await app.route(/\/api\/currency\/fixings\/BTCUSD(\?.*)?$/, route => answer(route, saved ? [saved] : []))
  await app.route(/\/api\/currency\/fixings$/, async route => {
    const b = route.request().postDataJSON()
    saved = { date: b.fixing_date, source: b.source, time: '16:00 London', value: b.value, origin: 'MANUAL', own: true }
    await route.fulfill({ json: { pair: 'BTCUSD', stored: true, sources: [], fixings: [...rows, saved] } })
  })
  await app.goto('/configurations/market-data/crypto')
  await app.locator('.crv-item', { hasText: 'BTCUSD' }).click()
  await app.getByText('Fixings', { exact: true }).click()
  const table = app.getByTestId('fixings-table')
  await expect(table).toContainText('Deribit BTC delivery price')
  await expect(table.getByText('FEED', { exact: true }).first()).toBeVisible()
  await expect(table).toContainText('74,480')
  // a desk's own fixing for the licensed benchmark
  const source = app.getByTestId('fixing-source')
  expect((await source.locator('option').allTextContents()).some(o => /Deribit/.test(o)), 'the venue fixing is not a desk entry').toBe(false)
  await app.getByTestId('fixing-value').fill('74512.25')
  await app.getByTestId('fixing-save').click()
  await expect(app.getByText('BTCUSD fixing saved')).toBeVisible()
  expect(saved.value).toBe(74512.25)
  expect(saved.source).not.toMatch(/Deribit/)
  await expect(table.getByText('MANUAL', { exact: true }).first()).toBeVisible()
  await expect(table).toContainText('74,512.25')
  await expectNoHorizontalOverflow(table, 'fixings table')
  await app.screenshot({ path: 'e2e/.out/shots/fixings-tab.png', fullPage: true })
  // a currency pair has no fixings tab
  await app.locator('.crv-item', { hasText: 'EURUSD' }).click()
  await expect(app.getByText('Fixings', { exact: true })).toHaveCount(0)
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

test('crypto forward: the scenario tab has a curve to drag, and a fixing at expiry gives the settlement amount', async ({ app, problems }) => {
  const today = Date.now()
  await app.route(/\/api\/currency\/fixings\/BTCUSD(\?.*)?$/, async route => {
    const res = await route.fetch()
    const body = await res.json()
    const fixings = Array.from({ length: 20 }, (_, i) => ({ date: iso(today - (20 - i) * DAY), source: 'Deribit BTC delivery price', time: '08:00 UTC', value: 106000 + 110 * i + (i % 3) * 180, origin: 'FEED', own: false }))
    await route.fulfill({ response: res, json: { ...body, stored: true, fixings } })
  })
  const win = await openCrypto(app, /^CRYPTO FORWARD$/i)
  const priced = app.waitForResponse(r => /\/api\/currency\/forward\/price$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const quote = await (await priced).json()
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()

  const chart = win.getByTestId('fx-scenario-chart')
  await expect(chart).toBeVisible()
  const value = async (id) => Number(await win.getByTestId(id).getAttribute('data-value'))
  await expect.poll(() => value('fx-scenario-forward')).toBeCloseTo(quote.forward, 0)
  await app.screenshot({ path: 'e2e/.out/shots/scenario-base.png' })

  // drag the spot point up: the whole curve moves, and the forward and the value move with it
  const box = await chart.boundingBox()
  const sx = Number(await chart.getAttribute('data-spot-x')), sy = Number(await chart.getAttribute('data-spot-y')), ppu = Number(await chart.getAttribute('data-px-per-unit'))
  expect(ppu, 'the chart says how many pixels a unit of price is').toBeGreaterThan(0)
  await app.mouse.move(box.x + sx, box.y + sy)
  await app.mouse.down()
  await app.mouse.move(box.x + sx, box.y + sy - 20, { steps: 4 })
  await app.mouse.move(box.x + sx, box.y + sy - 40, { steps: 4 })
  await app.mouse.up()
  const moved = await value('fx-scenario-forward')
  const expected = quote.forward * (1 + (40 / ppu) / quote.spot)
  expect(moved, 'the forward follows the drag').toBeGreaterThan(quote.forward)
  expect(Math.abs(moved / expected - 1), 'by the size of the drag').toBeLessThan(0.02)
  await app.screenshot({ path: 'e2e/.out/shots/scenario-dragged.png' })
  await win.getByTestId('fx-scenario-reset').click()
  await expect.poll(() => value('fx-scenario-forward')).toBeCloseTo(quote.forward, 0)

  // a fixing at expiry: the settlement amount is N × (fixing − K) for the bought forward
  const k = quote.forward_rate ?? quote.forward
  const fix = Math.round(k) + 1000
  await win.getByTestId('fx-scenario-fixing').fill(String(fix))
  await expect.poll(() => value('fx-scenario-settlement')).toBeCloseTo(quote.base_notional * (fix - k), -1)
  await expect(win.getByTestId('fx-scenario-source')).toBeVisible()
  await expectNoHorizontalOverflow(win, 'scenario tab')
  await expectFullyInView(chart, 'the scenario chart')
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

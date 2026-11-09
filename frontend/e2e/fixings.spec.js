// Fixings for digital assets: the ticket's settlement source, the Fixings tab on the market-data page, and the
// CURVE SCENARIO tab with a forward curve that can be dragged and a fixing at expiry, the fixing date of a forward,
// and what the window shows for a trade that has settled. The stack has no venue, so stored fixings and the settled
// valuation are answered here where a journey needs them; the store, the feed and the settlement rule are tested
// on the database in backend/tests/integration/test_fixings.py.
import { test, expect, expectClean, expectFullyInView, expectNoHorizontalOverflow } from './fixtures.js'

const DAY = 86400000
const iso = (d) => new Date(d).toISOString().slice(0, 10)

// The pairs answer as it is where the feed is delivering the pair's fixing: the venue's source is offered too (the
// stack has no venue, so the API offers the benchmark alone here). `asDefault` also makes it the ticket's default.
async function offerVenue(app, { asDefault = false } = {}) {
  await app.route(/\/api\/currency\/pairs(\?.*)?$/, async route => {
    const res = await route.fetch()
    const body = await res.json()
    const list = Array.isArray(body) ? body : (body.pairs || [])
    for (const p of list) {
      if (!p.crypto && !/^(BTC|ETH|SOL)USD$/.test(p.pair || '')) continue
      const asset = (p.pair || '').slice(0, 3)
      const venue = { source: `Deribit ${asset} delivery price`, time: '08:00 UTC', auto: true }
      const have = Array.isArray(p.fixing_sources) ? p.fixing_sources.filter(x => !/Deribit/.test(x.source)) : []
      p.fixing_sources = [...have, venue]
      if (asDefault) p.settlement_default = { source: venue.source, time: venue.time }
    }
    await route.fulfill({ response: res, json: body })
  })
}

async function openCrypto(app, product) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
  await win.getByRole('button', { name: product }).click()
  return win
}

test('crypto ticket: where the feed does not deliver, the benchmark is the only source offered', async ({ app, problems }) => {
  const win = await openCrypto(app, /^CRYPTO FORWARD$/i)
  const pick = win.getByTestId('settles-on')
  await expect(pick).toBeVisible()                                           // the pairs have loaded: the select is there with its sources
  await expect(win).toContainText('your desk enters this fixing')
  await expect.poll(async () => (await pick.locator('option').allTextContents()).length).toBeGreaterThanOrEqual(1)
  const options = await pick.locator('option').allTextContents()
  expect(options.some(o => /Deribit/.test(o)), 'no automatic fixing is promised where none arrives').toBe(false)
  expectClean(problems)
})

test('crypto ticket: the settlement source is a choice, and says who fixes it', async ({ app, problems }) => {
  await offerVenue(app)
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
  // the option fixes at its expiry: said in words, no second date to fill
  await expect(win).toContainText(/fixes at expiry, \d{4}-\d{2}-\d{2} at /)
  await expect(win.getByTestId('fixing-date')).toHaveCount(0)
  // the forward ticket has the source too, and a fixing date of its own
  await win.getByRole('button', { name: /^CRYPTO FORWARD$/i }).click()
  const pickF = win.getByTestId('settles-on')
  await expect(pickF).toBeVisible()
  const fixing = win.getByTestId('fixing-date')
  await expect(fixing).toBeVisible()
  const dates = async () => {
    const m = /fixes on (\d{4}-\d{2}-\d{2}) at ([^,]+), settles (\d{4}-\d{2}-\d{2})/.exec(await win.innerText())
    expect(m, 'the ticket says when the forward fixes and when it settles').not.toBeNull()
    return { fixes: m[1], time: m[2], settles: m[3] }
  }
  // the venue's morning price fixes on the settlement date; a benchmark the desk enters fixes the day before
  await pickF.selectOption({ label: (await pickF.locator('option').allTextContents()).find(o => /Deribit/.test(o)) })
  let d = await dates()
  expect(d.fixes, 'the venue price fixes on the settlement date').toBe(d.settles)
  expect(d.time).toBe('08:00 UTC')
  await expect(fixing).toHaveValue(d.settles)
  await pickF.selectOption({ label: (await pickF.locator('option').allTextContents()).find(o => !/Deribit/.test(o)) })
  d = await dates()
  expect(d.fixes, 'a benchmark fixes one day before settlement').toBe(iso(Date.parse(d.settles) - DAY))
  await expect(win).toContainText('priced to the settlement date')
  // a date typed after the settlement date is brought back to it, and one more than a week before it to the week
  await fixing.fill(iso(Date.parse(d.settles) + 5 * DAY))
  await fixing.blur()
  await expect(fixing).toHaveValue(d.settles)
  await fixing.fill(iso(Date.parse(d.settles) - 30 * DAY))
  await fixing.blur()
  await expect(fixing).toHaveValue(iso(Date.parse(d.settles) - 7 * DAY))
  const earlier = iso(Date.parse(d.settles) - 2 * DAY)
  await fixing.fill(earlier)
  await fixing.blur()
  expect((await dates()).fixes).toBe(earlier)
  // a new settlement date drops the typed fixing date: the default for the new date applies
  const tenor = win.locator('select').filter({ has: app.locator('option', { hasText: /^6M$/ }) }).first()
  await tenor.selectOption({ label: '6M' })
  d = await dates()
  expect(d.fixes, 'the typed date did not survive the new settlement date').toBe(iso(Date.parse(d.settles) - DAY))
  await expect(fixing).toHaveValue(d.fixes)
  await expectFullyInView(fixing, 'the fixing date')
  await expectNoHorizontalOverflow(win, 'crypto forward ticket with the settlement source and the fixing date')
  await app.screenshot({ path: 'e2e/.out/shots/ticket-fixing-date.png' })
  await app.unrouteAll({ behavior: 'ignoreErrors' })
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
  // PRICE pressed from the scenario tab itself: the terms reach a tab that was open before the quote arrived
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  const priced = app.waitForResponse(r => /\/api\/currency\/forward\/price$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const quote = await (await priced).json()
  await expect(win).not.toContainText('No settlement price source is named')

  const chart = win.getByTestId('fx-scenario-chart')
  await expect(chart).toBeVisible()
  await expect(chart, 'the chart has drawn the fixings and the curve').toHaveAttribute('data-ready', 'true')
  await expect(win.getByTestId('fx-scenario-banner')).toContainText('an approximation in the browser')
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
  const expected = quote.forward * (1 + (40 / ppu) / quote.spot)
  await expect.poll(async () => Math.abs(await value('fx-scenario-forward') / expected - 1), 'the forward follows the drag, by its size').toBeLessThan(0.02)
  expect(await value('fx-scenario-forward')).toBeGreaterThan(quote.forward)
  await app.screenshot({ path: 'e2e/.out/shots/scenario-dragged.png' })
  await win.getByTestId('fx-scenario-reset').click()
  await expect.poll(() => value('fx-scenario-forward')).toBeCloseTo(quote.forward, 0)

  // a fixing at expiry: the settlement amount is N × (fixing − K) for the bought forward
  const k = quote.forward_rate ?? quote.forward
  const fix = Math.round(k) + 1000
  await win.getByTestId('fx-scenario-fixing').fill(String(fix))
  await expect.poll(() => value('fx-scenario-settlement')).toBeCloseTo(quote.base_notional * (fix - k), -1)
  await expect(win.getByTestId('fx-scenario-source')).toBeVisible()
  await expect(win.getByTestId('fx-scenario-dates')).toContainText(/fixes on \d{4}-\d{2}-\d{2}, settles \d{4}-\d{2}-\d{2}/)
  await expectNoHorizontalOverflow(win, 'scenario tab')
  await expectFullyInView(chart, 'the scenario chart')
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

test('a settled crypto forward opened from the blotter shows the fixing and the amount, and no forward to shock', async ({ app, problems }) => {
  // book a forward, then answer its valuation as the API does once the trade has settled (the stack cannot move the clock)
  const win = await openCrypto(app, /^CRYPTO FORWARD$/i)
  const cp = win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first()
  await cp.selectOption({ label: 'RIJEKA DEMO BANK AG' })
  const priced = app.waitForResponse(r => /\/api\/currency\/forward\/price$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const quote = await (await priced).json()
  // a fixing date of our own, three days before settlement: the record must carry exactly it
  const chosen = iso(Date.parse(quote.settlement_date) - 3 * DAY)
  await win.getByTestId('fixing-date').fill(chosen)
  await win.getByTestId('fixing-date').blur()
  const booking = app.waitForResponse(r => /\/api\/trades\/$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  const booked = await booking
  expect(booked.status(), 'the forward books').toBeLessThan(300)
  const trade = await booked.json()
  expect(trade.terms.valuation_date, 'the record fixes on the date chosen on the ticket').toBe(chosen)
  expect(trade.terms.settlement_date).toBe(quote.settlement_date)
  expect(trade.terms.valuation_time, 'the time of the source booked').toBe('16:00 London')
  expect(trade.terms.settlement_price_source).not.toMatch(/Deribit/)

  const k = Number(trade.terms.forward_price ?? quote.forward_rate ?? quote.forward)
  const fixing = Math.round(k) + 1500
  const amount = quote.base_notional * (fixing - k)
  const source = trade.terms.settlement_price_source
  const settled = {
    state: 'SETTLED', trade_id: trade.id, trade_ref: trade.trade_ref, instrument_type: 'CRYPTO_FORWARD', npv_ccy: 'USD', legs: [],
    pair: quote.pair, shape: 'NDF', crypto: true, base_currency: quote.base_currency, quote_currency: 'USD', direction: 'BUY',
    base_notional: quote.base_notional, valuation_date: iso(Date.parse(trade.terms.settlement_date) + DAY), settlement_date: trade.terms.settlement_date,
    settled: true, npv: 0, fixing_date: trade.terms.valuation_date, fixing_source: source,
    fixing: { source, date: trade.terms.valuation_date, time: trade.terms.valuation_time, value: fixing, origin: 'MANUAL' },
    settlement_amount: amount, settlement_price: fixing, provisional: false, provisional_reason: null, provisional_basis: null,
    ir01: 0, ir01_disc: 0, fund01: 0, theta: 0, model: 'settled: the mark is zero from the settlement date; the amount is reported beside it',
    forward: null, df_quote: null, df_base: null, t: null, t_settle: null, t_expiry: null, vol_pct: null, spot01: null, vega: null, forward_rate: k,
  }
  let answer = settled, asked = null
  await app.route(/\/price$/, async route => {
    const body = route.request().method() === 'POST' ? route.request().postDataJSON() : null
    if (body?.trade_id === trade.id) { asked = body; await route.fulfill({ json: answer }) }
    else await route.fallback()
  })
  await app.goto('/blotter')                 // a fresh page: the ticket is gone, the blotter lists the booked trade
  await app.locator('.bl-row', { hasText: trade.trade_ref }).first().click()
  const view = app.locator('.tbw-window').last()
  await view.waitFor()
  await view.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  const panel = view.getByTestId('fx-settled-view')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-state', 'SETTLED')
  await expect(panel).toContainText('This trade has settled')
  expect(Number(await view.getByTestId('fx-settled-fixing').getAttribute('data-value'))).toBe(fixing)
  expect(Number(await view.getByTestId('fx-settled-amount').getAttribute('data-value'))).toBeCloseTo(amount, 2)
  // nothing is repriced for it: no scenario forward, no slider, no invented figure
  await expect(view.getByTestId('fx-scenario-forward')).toHaveCount(0)
  await expect(view.getByTestId('fx-scenario-reset')).toHaveCount(0)
  expect(await view.innerText()).not.toMatch(/NaN|undefined|Infinity/)
  await expectNoHorizontalOverflow(view, 'the settled view')
  await app.screenshot({ path: 'e2e/.out/shots/scenario-settled.png' })
  expect(asked?.states, 'the window asks for the settled answer; an older client that does not is answered as before').toBe(true)
  // the term sheet and the cash flows say the same
  await view.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await expect(view).toContainText('TERM SHEET · AS BOOKED')
  expect(await view.innerText()).not.toMatch(/NaN|undefined|Infinity/)
  await view.getByRole('button', { name: 'CASHFLOWS', exact: true }).click()
  expect(await view.innerText()).not.toMatch(/NaN|undefined|Infinity/)
  // no exposure is simulated for it
  await view.getByRole('button', { name: 'XVA', exact: true }).click()
  await expect(view.getByTestId('xva-fixed-note')).toBeVisible()
  await expect(view.getByRole('button', { name: /SIMULATE/ }).first()).toBeDisabled()

  // fixed, not yet settled, and no fixing stored for the named source: the stored spot stands in, and says so
  const stand = Math.round(k) + 900
  answer = { ...settled, state: 'FIXED', settled: false, valuation_date: trade.terms.valuation_date, fixing: null, settlement_price: stand,
             settlement_amount: quote.base_notional * (stand - k), npv: quote.base_notional * (stand - k) * 0.9996,
             provisional: true, provisional_reason: 'no fixing stored', provisional_basis: `the stored spot of ${trade.terms.valuation_date}`, model: null }
  await view.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await view.getByRole('button', { name: '▶ PRICE' }).click()
  await expect(panel).toHaveAttribute('data-state', 'FIXED')
  await expect(panel).toContainText('This trade has fixed and is not yet settled')
  await expect(panel).toContainText(/none stored for/)
  await expect(panel).toContainText('not a fixing')
  expect(Number(await view.getByTestId('fx-settled-amount').getAttribute('data-value'))).toBeCloseTo(quote.base_notional * (stand - k), 2)
  expect(await view.innerText()).not.toMatch(/NaN|undefined|Infinity/)
  await app.screenshot({ path: 'e2e/.out/shots/scenario-fixed-provisional.png' })
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

test('where the feed delivers, the venue\'s price is the default and the forward books on it, fixing on its settlement date', async ({ app, problems }) => {
  await offerVenue(app, { asDefault: true })
  const win = await openCrypto(app, /^CRYPTO FORWARD$/i)
  const cp = win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first()
  await cp.selectOption({ label: 'RIJEKA DEMO BANK AG' })
  await expect(win).toContainText('fixed automatically each day at 08:00 UTC')
  const priced = app.waitForResponse(r => /\/api\/currency\/forward\/price$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const quote = await (await priced).json()
  const booking = app.waitForResponse(r => /\/api\/trades\/$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  const booked = await booking
  expect(booked.status(), 'a forward on the venue\'s price books').toBeLessThan(300)
  const t = (await booked.json()).terms
  expect(t.settlement_price_source).toBe('Deribit BTC delivery price')
  expect(t.valuation_time).toBe('08:00 UTC')
  expect(t.valuation_date, 'same-day cash: it fixes on its settlement date').toBe(quote.settlement_date)
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

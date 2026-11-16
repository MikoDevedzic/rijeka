// What a first-time visitor found on the released desk on 16 November 2026 and what each screen does now: the
// blotter's rail keeps NEW TRADE in view on a short window, offers no filter that can only answer "empty", and its
// summary adds up; a link that names a trade opens that trade; the curves list prints the stored rate, not the
// built-in one; the Risk page does not add a vega per vol point to a vega per basis point; the System page shows a
// trader no block that only says it is not for them. (The messenger's greeting has its own journey, chat-opens.)
import { test, expect, expectClean } from './fixtures.js'

const whole = (n) => Math.round(Math.abs(n)).toLocaleString('en-US', { maximumFractionDigits: 0 })
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${whole(n)}`

test('the blotter\'s rail on a short window: NEW TRADE in view, the roadmap\'s asset classes not offered, a summary that adds up', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 760 })
  const read = app.waitForResponse(r => /\/trades\?select=/.test(r.url()) && r.request().method() === 'GET' && r.ok(), { timeout: 60_000 })
  await app.goto('/blotter')
  const book = await (await read).json()
  const rail = app.locator('.bl-left')
  const btn = rail.locator('.bl-new-trade-btn')
  await expect(btn).toBeVisible()
  await expect(app.locator('.bl-root tbody tr').first()).toBeVisible({ timeout: 30_000 })
  const b = await btn.boundingBox()
  expect(b.y + b.height, 'the whole button is inside the window').toBeLessThanOrEqual(760)
  const sum = await rail.locator('.bl-summary-block').boundingBox()
  expect(sum.y + sum.height, 'and the summary above it').toBeLessThanOrEqual(b.y + 1)

  // an asset class the desk does not trade yet is named and cannot be pressed
  for (const next of ['CREDIT', 'EQUITY', 'COMMODITY']) {
    const f = rail.locator('.bl-filter-btn', { hasText: next })
    await expect(f, `${next} is on the roadmap`).toContainText('ROADMAP')
    await expect(f).toBeDisabled()
  }
  await expect(rail.locator('.bl-filter-btn', { hasText: /^RATES/ })).toBeEnabled()
  // STORE: where every trade of the book is kept WORKING, the column and its filter are not there to say it; a book
  // with a trade kept elsewhere (the API takes a store on a booking) shows both
  const elsewhere = Array.isArray(book) && book.some(t => t.store && t.store !== 'WORKING') ? 1 : 0
  await expect(app.locator('.bl-root thead th', { hasText: /^STORE$/ })).toHaveCount(elsewhere)
  await expect(rail.locator('.bl-section-lbl', { hasText: 'STORE' })).toHaveCount(elsewhere)
  await expect(app.locator('.bl-root thead th', { hasText: /^UTI$/ })).toHaveCount(1)
  expect(await app.locator('.bl-root thead th').count(), 'a head cell for every body cell').toBe(await app.locator('.bl-root tbody tr').first().locator('td').count())

  // TOTAL = PENDING + CONFIRMED + LIVE + CLOSED (CLOSED is on the rail only when there is one)
  const n = async (loc) => Number((await loc.textContent()).replace(/\D/g, ''))
  const rows = rail.locator('.bl-sum-row')
  const total = await n(rows.filter({ hasText: 'TOTAL' }).locator('.bl-sum-val'))
  const parts = await Promise.all(['PENDING', 'CONFIRMED', 'LIVE'].map(k => n(rows.filter({ hasText: new RegExp(`^${k}`) }).locator('.bl-sum-val'))))
  const closed = await app.getByTestId('bl-sum-closed').count() ? await n(app.getByTestId('bl-sum-closed')) : 0
  expect(parts.reduce((a, x) => a + x, 0) + closed, 'the rows add up to the total').toBe(total)
  await app.screenshot({ path: 'e2e/.out/shots/second-look-blotter-760.png' })
  expectClean(problems)
})

test('a link that names a trade opens that trade\'s ticket, once', async ({ app, problems }) => {
  const feed = app.waitForResponse(r => /\/api\/desk\/lifecycle(\?|$)/.test(r.url()) && r.ok(), { timeout: 60_000 })
  await app.goto('/')
  const actions = (await (await feed).json()).actions || []
  const a = actions.find(x => x.trade_id && /^\/blotter\?trade=/.test(x.href || ''))
  expect(a, 'the stack\'s book has a trade that awaits something').toBeTruthy()
  const needs = app.getByTestId('th-needs')
  await expect(needs.locator('.lf-list li').first()).toBeVisible({ timeout: 30_000 })
  // pressed on the home when it is one of the rows shown there; otherwise by its link, which is the same thing
  const row = needs.locator('.lf-list li', { hasText: a.trade_ref })
  if (await row.count()) await row.first().click(); else await app.goto(a.href)
  const win = app.locator('.tbw-window')
  await expect(win, 'the ticket of the trade the item named').toBeVisible({ timeout: 30_000 })
  await expect(win).toContainText(a.trade_ref)
  await expect(app, 'the name is taken off the address as it is used').toHaveURL(/\/blotter$/)
  await app.screenshot({ path: 'e2e/.out/shots/second-look-needs-you-ticket.png' })
  // a reload does not open it a second time
  await app.reload()
  await expect(app.locator('.bl-root tbody tr').first()).toBeVisible({ timeout: 30_000 })
  await expect(app.locator('.tbw-window')).toHaveCount(0)
  // a trade the book does not hold leaves the blotter as it is
  await app.goto('/blotter?trade=00000000-0000-4000-8000-000000000000')
  await expect(app.locator('.bl-root tbody tr').first()).toBeVisible({ timeout: 30_000 })
  await expect(app).toHaveURL(/\/blotter$/)
  await expect(app.locator('.tbw-window')).toHaveCount(0)
  expectClean(problems)
})

test('the curves list prints the stored rate of a curve before it is pressed', async ({ app, problems }) => {
  const stored = app.waitForResponse(r => r.url().endsWith('/api/market-data/snapshots/USD_SOFR/latest') && r.ok(), { timeout: 60_000 })
  await app.goto('/configurations/market-data/curves')
  const snap = await (await stored).json()
  const cell = app.getByTestId('crv-val-USD_SOFR')
  await expect(cell).not.toHaveText('…', { timeout: 30_000 })
  const on = (snap.quotes || []).find(q => q.tenor === 'ON')
  if (snap.exists && on) await expect(cell, 'the stored overnight rate').toHaveText(`${Number(on.rate).toFixed(2)}%`)
  // every stored curve in the list has been asked for: none is left waiting
  await expect(app.locator('.ci-val.ci-wait')).toHaveCount(0, { timeout: 30_000 })
  await app.screenshot({ path: 'e2e/.out/shots/second-look-curves.png' })
  expectClean(problems)
})

test('the Risk page keeps a vega per vol point and a vega per basis point of normal vol apart', async ({ app, problems }) => {
  const answer = app.waitForResponse(r => /\/api\/risk\/report(\?|$)/.test(r.url()) && r.request().method() === 'GET' && r.ok(), { timeout: 60_000 })
  await app.goto('/risk')
  const rep = await (await answer).json()
  const vega = rep.ladder?.vega || []
  test.skip(!vega.length, 'the stack\'s book holds no option')
  const card = app.getByTestId('rk-vega')
  await expect(card).toBeVisible({ timeout: 60_000 })
  const rates = vega.filter(v => /SWVOL/.test(v.curve)), fx = vega.filter(v => !/SWVOL/.test(v.curve))
  const sum = (xs) => xs.reduce((a, v) => a + v.total, 0)
  if (fx.length) await expect(card).toContainText(signed(sum(fx)))
  if (rates.length) await expect(card).toContainText(signed(sum(rates)))
  if (fx.length && rates.length) {
    await expect(card).toContainText(`FX ${signed(sum(fx))} · RATES ${signed(sum(rates))}`)
    await expect(card).toContainText('per vol pt · per bp normal vol')
    await expect(card, 'the two are not added').not.toContainText(signed(sum(vega)))
    // a report computed since 0.46.5 gives the two totals itself, and no longer one that adds them (a report stored
    // before it has the old figure and not the new ones: the card works from the rows either way)
    if (rep.ladder.vega_point_usd != null) {
      expect(rep.ladder.vega_point_usd).toBeCloseTo(sum(fx), 6)
      expect(rep.ladder.vega_normal_bp_usd).toBeCloseTo(sum(rates), 6)
      expect(rep.ladder.vega_usd).toBeUndefined()
    }
    // a name is not parted from its own figure where the line breaks
    for (const pair of await card.locator('.pnl-big span span').all()) expect(await pair.evaluate(el => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).fontSize)), 'a name and its figure on one line').toBeLessThan(2)
  } else await expect(card).toContainText(fx.length ? 'PV for +1 vol point' : 'PV for +1 bp of normal vol')
  // a VaR with too few days is a dash, as on the home, not a figure, and the reason is said once
  if (rep.var && !rep.var.enough) {
    const var_ = app.locator('.rk-cards .pnl-card').first()
    await expect(var_.locator('.pnl-big')).toHaveText('—')
    await expect(var_).toContainText('days of history · a VaR needs')
  }
  await app.screenshot({ path: 'e2e/.out/shots/second-look-risk-cards.png' })
  expectClean(problems)
})

test('the System page shows a trader no usage block', async ({ app, problems }) => {
  await app.goto('/configurations/system')
  await expect(app.getByText('SCHEDULED BATCHES', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(app.getByText(/BROWSER ERRORS/)).toBeVisible()
  await expect(app.getByTestId('sys-usage')).toHaveCount(0)
  await expect(app.locator('.pnl')).not.toContainText('not available')
  expectClean(problems)
})

test('the home\'s snapshot line is whole, old or current: nothing in the strip ends in an ellipsis', async ({ app, problems }) => {
  const cut = (line) => line.evaluate(el => { const box = el.parentElement; return box.scrollWidth - box.clientWidth })
  for (const width of [1600, 1440, 1280]) {
    await app.setViewportSize({ width, height: 900 })
    // as the stack stores it: a snapshot some days old says so
    await app.goto('/')
    const line = app.getByTestId('dh-asof')
    await expect(line).toContainText('DEMO DATA · PUBLIC SOURCES', { timeout: 30_000 })
    expect(await cut(line), `the line is cut at ${width} wide`).toBeLessThanOrEqual(1)
  }
  // a snapshot of today, as the hosted desk has it every morning, and one a month old: the longest the line gets
  for (const [days, says] of [[0, /SNAPSHOT · [A-Z][a-z]{2} \d{2}, \d{4} · DEMO DATA/], [31, /31D OLD · DEMO DATA/]]) {
    await app.route('**/api/market-data/snapshots/USD_SOFR/latest', async (route) => {
      const r = await route.fetch(), j = await r.json()
      const d = new Date(Date.now() - days * 86_400_000)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      await route.fulfill({ response: r, json: { ...j, valuation_date: iso } })
    })
    for (const width of [1440, 1280]) {
      await app.setViewportSize({ width, height: 900 })
      await app.goto('/')
      const line = app.getByTestId('dh-asof')
      await expect(line).toContainText(says, { timeout: 30_000 })
      expect(await cut(line), `${days} days old, the line is cut at ${width} wide`).toBeLessThanOrEqual(1)
    }
    await app.unroute('**/api/market-data/snapshots/USD_SOFR/latest')
  }
  await app.screenshot({ path: 'e2e/.out/shots/second-look-strip-1280.png', clip: { x: 0, y: 0, width: 1280, height: 120 } })
  expectClean(problems)
})

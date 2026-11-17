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
  expect(await app.locator('.bl-root colgroup col').count(), 'and a width for every one of them, no more').toBe(await app.locator('.bl-root thead th').count())
  // the head reaches the table's right edge: a column's width left behind would leave a gap after UTI
  const edge = await app.locator('.bl-root thead th').last().evaluate(el => { const t = el.closest('table').getBoundingClientRect(), c = el.getBoundingClientRect(); return Math.round(t.right - c.right) })
  expect(edge, 'the last head cell ends where the table does').toBeLessThanOrEqual(1)

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

// Third walk, 16 November 2026: on a 1280x720 window the round CHAT button stood on the ticket's BOOK TRADE.
test('on a small window nothing of the messenger stands on a ticket\'s buttons', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1280, height: 720 })
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  for (const name of [/BOOK TRADE/, /PRICE/, /^CANCEL$/]) {
    const b = win.locator('.tbw-footer').getByRole('button', { name }).first()
    await expect(b).toBeVisible()
    const box = await b.boundingBox()
    const top = await app.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el?.closest('.ms-launcher') ? 'chat' : el?.closest('.tbw-window') ? 'ticket' : 'other' }, [box.x + box.width / 2, box.y + box.height / 2])
    expect(top, `what is on top at the middle of ${name}`).toBe('ticket')
    // and at its right-hand end, where the button used to stand
    const end = await app.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el?.closest('.ms-launcher') ? 'chat' : el?.closest('.tbw-window') ? 'ticket' : 'other' }, [box.x + box.width - 4, box.y + box.height / 2])
    expect(end, `what is on top at the end of ${name}`).toBe('ticket')
  }
  await app.screenshot({ path: 'e2e/.out/shots/second-look-ticket-1280x720.png' })
  // with the ticket closed the button is there again, and pressed as before
  await win.getByTestId('tbw-close').click()
  await app.locator('.ms-launcher').click()
  await expect(app.locator('.ms-window')).toBeVisible()
  expectClean(problems)
})

// Third walk: a new FX option opened on the digital asset's three-month expiry and called it "CUSTOM · 2.9 months".
test('a new ticket\'s date is the pair\'s own tenor date when the pair changes', async ({ app, problems }) => {
  const pairs = app.waitForResponse(r => r.url().endsWith('/api/currency/pairs') && r.ok(), { timeout: 60_000 })
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  const by = Object.fromEntries((await (await pairs).json()).pairs.map(p => [p.pair, p]))
  await win.getByRole('button', { name: 'FX', exact: true }).click()
  await win.getByRole('button', { name: /^FX OPTION$/i }).click()
  const tenor = win.getByTestId('fx-tenor')
  await expect(tenor.locator('option:checked'), 'the option is a three-month one, by name').toHaveText('3M')
  const eur = by.EURUSD?.tenor_dates?.option?.['3M']
  if (eur?.expiry) await expect(win.locator('input[type=date]').nth(1), 'and its expiry is EURUSD\'s own').toHaveValue(eur.expiry)
  // back to a digital asset: its own three months, again by name
  await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
  await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click()
  await expect(win.getByTestId('fx-tenor').locator('option:checked')).toHaveText('3M')
  expectClean(problems)
})

// Third walk: a EUR swap's PV and IR01 stood under a dollar sign; a swap in a currency with no curve left an empty
// footer and its reason below the fold.
test('a rates ticket writes its figures in its own currency, and says in its footer why it could not price', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 900 })
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  const ccy = win.getByRole('combobox', { name: /^CCY/ })
  const footer = win.locator('.tbw-footer-metrics')
  // dollars first: as it was
  let priced = app.waitForResponse(r => r.url().endsWith('/price/preview') && r.request().method() === 'POST', { timeout: 60_000 })
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await priced
  await expect(footer).toContainText('$')
  // the same swap in EUR: every figure in the footer and under ANALYTICS is in euros
  await ccy.selectOption('EUR')
  priced = app.waitForResponse(r => r.url().endsWith('/price/preview') && r.request().method() === 'POST' && r.ok(), { timeout: 60_000 })
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await priced
  await expect(footer).toContainText('€')
  await expect(footer, 'no dollar sign on a EUR swap').not.toContainText('$')
  await win.getByRole('button', { name: 'CASHFLOWS', exact: true }).click()
  const grid = win.locator('.tbw-metrics-grid')
  await expect(grid).toContainText('€')
  await expect(grid, 'no dollar sign under ANALYTICS on a EUR swap').not.toContainText('$')
  await expect(win.getByTestId('cf-curve-line')).toContainText(/stored curve saved .* valued on/)
  await app.screenshot({ path: 'e2e/.out/shots/second-look-eur-swap.png' })
  // its XVA runs on volatility calibrated to dollar swaptions, the one surface stored: said above the figures, with the reason
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  const sim = app.waitForResponse(r => r.url().endsWith('/api/xva/simulate') && r.request().method() === 'POST' && r.request().postDataJSON()?.csa?.preset !== 'ON_CHAIN', { timeout: 90_000 })
  await win.getByRole('button', { name: /SIMULATE/ }).click()
  const run = await (await sim).json()
  expect(run.vol_basis, JSON.stringify(run).slice(0, 300)).toMatchObject({ surface: 'USD_SWVOL_ATM', currency: 'EUR', proxy: true })
  const said = win.getByTestId('xva-vol-basis')
  await expect(said).toContainText('simulated on volatility calibrated to USD swaptions')
  await expect(said).toContainText('no market data provider for EUR swaption volatility')
  await app.screenshot({ path: 'e2e/.out/shots/second-look-eur-swap-xva.png' })
  // the engine refuses (here: answered for it, so the journey does not depend on which curves the stack holds):
  // the footer says why, in view, instead of standing empty over a reason below the fold
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  await app.route('**/price/preview', route => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'no curve is stored for this currency' }) }))
  const refused = app.waitForResponse(r => r.url().endsWith('/price/preview') && r.status() === 422, { timeout: 60_000 })
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await refused
  const note = win.getByTestId('tbw-footer-error')
  await expect(note).toContainText('Not priced:')
  await expect(note).toContainText('no curve is stored')
  const box = await note.boundingBox()
  expect(box.y + box.height, 'the reason is inside the window').toBeLessThanOrEqual(900)
  await app.screenshot({ path: 'e2e/.out/shots/second-look-not-priced.png' })
  await app.unroute('**/price/preview')
  expectClean(problems.filter(p => !/422|404|price\/(preview|par)/.test(String(p))))
})

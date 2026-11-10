// A forward as a package of legs (DETAILS): the ticket is the first leg; a strip adds a forward for each month,
// each priced by the engine at its own fair forward; a leg takes its own side, size, date and strike; the value
// and the sensitivities add; BOOK books every leg as its own trade, tied by the package's reference.
import { test, expect, expectClean, expectNoHorizontalOverflow, API } from './fixtures.js'

const selectDemoBank = (app, win) => win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
const num = (s) => Number(String(s).replace(/[^0-9.+\-−]/g, '').replace('−', '-'))

test('a strip of forwards: built on DETAILS, each leg priced, a strike and a side changed, booked as one package', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()

  // the ticket alone is one leg, an outright, and the record is still under it
  const legs = win.getByTestId('fx-legs')
  await expect(legs).toHaveAttribute('data-structure', 'OUTRIGHT')
  await expect(win.getByTestId('fx-leg-first')).toHaveCount(1)
  await expect(win.getByTestId('fx-leg')).toHaveCount(0)
  await expect(win.getByText('TERM SHEET · AS IT WILL BE BOOKED', { exact: true })).toBeVisible()
  await expect(win.getByRole('button', { name: /BOOK TRADE/ })).toBeVisible()

  // a strip of three: two further legs, a month apart, each priced by the engine at its own fair forward
  const pricedLegs = []
  app.on('response', async r => { if (r.url().startsWith(API) && /\/forward\/price$/.test(r.url()) && r.status() === 200) { try { pricedLegs.push(await r.json()) } catch { /* gone */ } } })
  await win.getByTestId('fx-legs-strip-3').click()
  const rows = win.getByTestId('fx-leg')
  await expect(rows).toHaveCount(2)
  await expect(legs).toHaveAttribute('data-structure', 'STRIP')
  const npv = (i) => rows.nth(i).getByTestId('fx-leg-npv').getAttribute('data-value')
  await expect.poll(async () => (await npv(0)) !== '' && (await npv(1)) !== '', { message: 'both legs are priced' }).toBe(true)
  const dates = await rows.locator('input[type=date]').evaluateAll(els => els.map(e => e.value))
  expect(new Date(dates[1]) > new Date(dates[0]), 'a month apart, in order').toBe(true)
  // at its fair forward a leg is worth nothing, to the rounding of its strike
  for (const i of [0, 1]) expect(Math.abs(Number(await npv(i)))).toBeLessThan(100)
  await expect(win.getByRole('button', { name: /BOOK 3 LEGS/ })).toBeVisible()
  await expect(win.getByTestId('fx-legs-chart')).toBeVisible()

  // its own strike on the second leg: bought above the fair forward, it loses; the package's value is the sum
  const strike = rows.nth(0).locator('input[aria-label="Strike of leg 2"]')
  const fair = num(await strike.getAttribute('placeholder'))
  await strike.fill(String(Math.round(fair + 500)))
  await strike.blur()
  await expect.poll(async () => Number(await npv(0)), { message: 'bought 500 above the forward' }).toBeLessThan(-1000)
  await expect(legs).toHaveAttribute('data-structure', 'STRIP')
  const total = async () => Number(await win.getByTestId('fx-legs-npv').getAttribute('data-value'))
  const firstNpv = Number(await win.getByTestId('fx-leg-first').getByTestId('fx-leg-npv').getAttribute('data-value'))
  await expect.poll(async () => Math.abs((await total()) - (firstNpv + Number(await npv(0)) + Number(await npv(1))))).toBeLessThan(1)
  // a strike that is not a number goes back to what it was
  await strike.fill('abc'); await strike.blur()
  await expect(strike).toHaveValue(/\d/)

  // the third leg sold instead: no longer a strip
  await rows.nth(1).getByRole('button', { name: 'Side of leg 3' }).click()
  await expect(legs).toHaveAttribute('data-structure', 'CUSTOM')
  await expect.poll(async () => (await npv(1)) !== '').toBe(true)
  await expectNoHorizontalOverflow(win, 'DETAILS with three legs')
  await app.screenshot({ path: 'e2e/.out/shots/legs-strip.png' })

  // BOOK books the three, each its own trade, and shows what each became
  const calls = []
  app.on('request', r => { if (r.url() === API + '/api/book/package' && r.method() === 'POST') calls.push(r.postDataJSON()) })
  // BOOK pressed while a leg is still being priced for its new side books nothing and says so
  await win.getByRole('button', { name: /BOOK 3 LEGS/ }).click()
  await expect(win.locator('.tbw-title')).toContainText(/nothing was booked/i)
  expect(calls.length, 'nothing was sent').toBe(0)
  for (const i of [0, 1]) await expect(rows.nth(i), 'every leg holds the price of the terms it shows').toHaveAttribute('data-pending', 'false')
  await expect(rows.getByTestId('fx-leg-says')).toHaveCount(0)
  await win.getByRole('button', { name: /BOOK/ }).click()
  await expect(win.getByTestId('fx-legs-package')).toBeVisible({ timeout: 30_000 })
  const pkg = (await win.getByTestId('fx-legs-package').innerText()).trim()
  // the package has ONE trade ID, of the usual shape, and each leg its own ID under it
  expect(pkg).toMatch(/^TRD-\d{8}$/)
  await expect(win.getByTestId('fx-leg-ref')).toHaveCount(3)
  const refs = (await win.getByTestId('fx-leg-ref').allInnerTexts()).map(x => x.trim())
  expect(refs, 'each leg is the trade ID and its place').toEqual([`${pkg}-1`, `${pkg}-2`, `${pkg}-3`])
  // one call books the three: the legs as the ticket shows them, none named by the ticket
  expect(calls.length, 'one call for the whole package').toBe(1)
  const booked = calls[0].legs.map(sent => ({ sent }))
  expect(calls[0].structure).toBe('CUSTOM')
  expect(booked.length).toBe(3)
  for (const b of booked) { expect(b.sent.trade_ref).toBeUndefined(); expect(b.sent.strategy).toBeUndefined() }
  expect(booked[1].sent.terms.forward_price).toBe(String(Math.round(fair + 500)))
  expect(booked[2].sent.terms.direction).toBe('SELL')
  expect(new Set(booked.map(b => b.sent.terms.settlement_date)).size, 'three settlement dates').toBe(3)
  for (const b of booked) expect(b.sent.terms.digital_asset).toBe('BTC')
  // once booked the legs are not edited
  await expect(win.getByTestId('fx-legs-add')).toHaveCount(0)
  await expect(rows.nth(0).locator('input')).toHaveCount(0)

  // NEW TRADE in the same window starts with the ticket alone: no legs, no package, and a new strip is priced again
  await win.getByRole('button', { name: 'NEW TRADE', exact: true }).click()
  await expect(legs).toHaveAttribute('data-structure', 'OUTRIGHT')
  await expect(win.getByTestId('fx-legs-package')).toHaveCount(0)
  await expect(rows).toHaveCount(0)
  await win.getByTestId('fx-legs-add').click()
  await expect(rows).toHaveCount(1)
  await expect(rows.nth(0)).toHaveAttribute('data-pending', 'false')
  expect(await npv(0)).not.toBe('')
  // another pair starts with the ticket alone too: a size and a strike typed for one asset mean nothing on another
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'ETHUSD' }) }).first().selectOption('ETHUSD')
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeLessThan(50_000)
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await expect(rows).toHaveCount(0)
  await expect(win.getByRole('button', { name: /BOOK TRADE/ })).toBeVisible()

  // the blotter: the three are found by the package's reference, each saying its place
  await win.locator('.tbw-light-r').click()
  await app.getByPlaceholder(/Search/).fill(pkg)
  await expect(app.locator('.bl-row')).toHaveCount(3)
  expect((await app.getByTestId('bl-pkg').allInnerTexts()).map(x => x.trim()).sort()).toEqual(['CUSTOM 1/3', 'CUSTOM 2/3', 'CUSTOM 3/3'])
  await app.getByPlaceholder(/Search/).fill('')
  await app.locator('.bl-row', { has: app.getByTestId('bl-pkg') }).first().click({ button: 'right' })
  await app.getByTestId('context-menu').getByRole('menuitem', { name: 'The 3 legs of this package' }).click()
  await expect(app.getByPlaceholder(/Search/)).toHaveValue(pkg)
  await expect(app.locator('.bl-row')).toHaveCount(3)
  await app.screenshot({ path: 'e2e/.out/shots/legs-blotter.png' })
  expectClean(problems)
})

test('a package that is refused books nothing: no leg stands on its own, and the ticket says so', async ({ app, problems }) => {
  await app.goto('/blotter')
  const before = await app.locator('.bl-row').count()
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await win.getByTestId('fx-legs-strip-3').click()
  const rows = win.getByTestId('fx-leg')
  await expect(rows).toHaveCount(2)
  for (const i of [0, 1]) await expect(rows.nth(i)).toHaveAttribute('data-pending', 'false')

  // the booking is refused (as the API refuses a leg it cannot take): one call, and nothing of the package exists
  let calls = 0
  await app.route(API + '/api/book/package', async (route) => {
    calls += 1
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'leg 3 of 3: refused by the test. Nothing was booked.' }) })
  })
  await win.getByRole('button', { name: /BOOK 3 LEGS/ }).click()
  await expect(win.locator('.tbw-title')).toContainText(/leg 3 of 3/i)
  await expect(win.locator('.tbw-title')).toContainText(/nothing was booked/i)
  expect(calls).toBe(1)
  await expect(win.getByTestId('fx-legs-package'), 'no trade ID: nothing was booked').toHaveCount(0)
  await expect(win.getByTestId('fx-leg-ref')).toHaveCount(0)
  await expect(rows.nth(0).locator('input').first(), 'the legs are still the ticket\'s to change').toBeVisible()
  await expect(win.getByRole('button', { name: /RETRY BOOK/ })).toBeVisible()

  // with the refusal gone the retry books the three
  await app.unroute(API + '/api/book/package')
  await win.getByRole('button', { name: /RETRY BOOK/ }).click()
  await expect(win.getByTestId('fx-legs-package')).toBeVisible({ timeout: 30_000 })
  await expect(win.getByTestId('fx-leg-ref')).toHaveCount(3)
  await win.locator('.tbw-light-r').click()
  await expect.poll(async () => app.locator('.bl-row').count()).toBe(before + 3)
  expect(problems.filter(x => !/422|book\/package/.test(x)), `other problems:\n${problems.join('\n')}`).toEqual([])
})

// Step 2: a leg can be an option of any style the ticket books on its own, and the two-option structures are one press.
const openTicket = async (app, asset, product) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  if (asset) { await win.getByRole('button', { name: asset, exact: true }).click(); await win.getByRole('button', { name: product }).click() }
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value')), { timeout: 30_000 }).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  return win
}
const settled = async (rows, i) => { await expect(rows.nth(i)).toHaveAttribute('data-pending', 'false'); await expect(rows.nth(i).getByTestId('fx-leg-says')).toHaveCount(0) }

test('an option ticket: a risk reversal, a straddle and a calendar in one press; a leg made a barrier, then a touch; booked', async ({ app, problems }) => {
  const win = await openTicket(app, 'CRYPTO', /^CRYPTO OPTION$/i)
  const legs = win.getByTestId('fx-legs'), rows = win.getByTestId('fx-leg')
  await expect(win.getByTestId('fx-leg-first')).toHaveAttribute('data-kind', 'CALL')
  await expect(legs).toHaveAttribute('data-structure', 'OUTRIGHT')

  // a call bought: the other side is a put sold, as far below the forward: a risk reversal, drawn as what it pays at expiry
  await expect(win.getByTestId('fx-legs-other')).toHaveText('RISK REVERSAL')
  await win.getByTestId('fx-legs-other').click()
  await expect(rows).toHaveCount(1)
  await expect(rows.nth(0)).toHaveAttribute('data-kind', 'PUT')
  await expect(rows.nth(0).getByRole('button', { name: 'Side of leg 2' })).toHaveText('SELL')
  await expect(legs).toHaveAttribute('data-structure', 'RISK REVERSAL')
  await settled(rows, 0)
  const npv = (i) => rows.nth(i).getByTestId('fx-leg-npv').getAttribute('data-value')
  expect(Number(await npv(0)), 'a put sold is worth less than nothing to us').toBeLessThan(0)
  await expect(win.getByTestId('fx-legs-payoff')).toBeVisible()
  await expect(win.getByRole('button', { name: /BOOK 2 LEGS/ })).toBeVisible()
  await app.screenshot({ path: 'e2e/.out/shots/legs-risk-reversal.png' })

  await win.getByTestId('fx-legs-straddle').click()
  await expect(legs).toHaveAttribute('data-structure', 'STRADDLE')
  await expect(rows.nth(0).getByRole('button', { name: 'Side of leg 2' })).toHaveText('BUY')
  await win.getByTestId('fx-legs-calendar').click()
  await expect(legs).toHaveAttribute('data-structure', 'CALENDAR')
  await settled(rows, 0)
  await expect(win.getByTestId('fx-legs-chart'), 'two dates: the strikes against the forwards').toBeVisible()

  // the second leg made a barrier: its terms open under it with a level to start from, and it is priced as a barrier
  await rows.nth(0).getByLabel('Style of leg 2').selectOption('BARRIER')
  const terms = win.getByTestId('fx-leg-terms')
  await expect(terms).toHaveCount(1)
  await expect(terms.getByLabel('Barrier of leg 2')).toHaveValue(/\d/)
  await expect(terms.getByTestId('fx-leg-sentence')).toContainText(/dies if spot rises to/)
  await expect(legs).toHaveAttribute('data-structure', 'CUSTOM')
  await settled(rows, 0)
  expect(await npv(0)).not.toBe('')
  await terms.getByLabel('Barrier kind of leg 2').selectOption('DOWN_IN')
  await expect(terms.getByTestId('fx-leg-sentence')).toContainText(/comes alive if spot falls to/)
  // a level that is not a number goes back to what it was
  const level = await terms.getByLabel('Barrier of leg 2').inputValue()
  await terms.getByLabel('Barrier of leg 2').fill('abc'); await terms.getByLabel('Barrier of leg 2').blur()
  await expect(terms.getByLabel('Barrier of leg 2')).toHaveValue(level)

  // then a touch: no strike, no size, a payout
  await rows.nth(0).getByLabel('Type of leg 2').selectOption('TOUCH')
  await expect(rows.nth(0)).toHaveAttribute('data-style', 'TOUCH')
  await expect(rows.nth(0).getByLabel('Strike of leg 2')).toHaveCount(0)
  await expect(terms.getByLabel('Payout of leg 2')).toHaveValue('100,000')
  await settled(rows, 0)
  expect(Number(await npv(0))).not.toBe(0)
  await app.screenshot({ path: 'e2e/.out/shots/legs-touch.png' })

  const sent = []
  let structureSent = null
  app.on('request', r => { if (r.url() === API + '/api/book/package' && r.method() === 'POST') { const b = r.postDataJSON(); structureSent = b.structure; sent.push(...b.legs) } })
  await win.getByRole('button', { name: /BOOK 2 LEGS/ }).click()
  await expect(win.getByTestId('fx-legs-package')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => sent.length).toBe(2)
  expect(sent.map(b => [b.instrument_type, b.structure])).toEqual([['CRYPTO_OPTION', 'EUROPEAN'], ['CRYPTO_OPTION', 'TOUCH']])
  expect(sent[1].terms).toMatchObject({ direction: 'SELL', touch_type: 'ONE_TOUCH', payout: '100000', barrier_monitoring: 'CONTINUOUS' })
  expect(sent[1].terms.strike_price, 'a touch books no strike').toBeUndefined()
  expect(structureSent, 'the structure travels with the package, the server writes each leg\'s place').toBe('CUSTOM')
  const pkgId = (await win.getByTestId('fx-legs-package').innerText()).trim()
  expect(pkgId).toMatch(/^TRD-\d{8}$/)
  await win.locator('.tbw-light-r').click()
  await app.getByPlaceholder(/Search/).fill(pkgId)
  expect((await app.getByTestId('bl-pkg').allInnerTexts()).map(x => x.trim()).sort()).toEqual(['EUROPEAN · CUSTOM 1/2', 'TOUCH · CUSTOM 2/2'])
  expectClean(problems)
})

test('a forward with an option leg: a put added to a forward, made a digital, booked; an FX forward prices a call leg', async ({ app, problems }) => {
  const win = await openTicket(app)
  const rows = win.getByTestId('fx-leg')
  await win.getByTestId('fx-legs-add').click()
  await rows.nth(0).getByLabel('Type of leg 2').selectOption('PUT')
  await expect(rows.nth(0)).toHaveAttribute('data-style', 'EUROPEAN')
  await settled(rows, 0)
  expect(Number(await rows.nth(0).getByTestId('fx-leg-npv').getAttribute('data-value')), 'a put bought is worth its premium').toBeGreaterThan(0)
  await rows.nth(0).getByLabel('Style of leg 2').selectOption('DIGITAL')
  const terms = win.getByTestId('fx-leg-terms')
  await expect(terms.getByLabel('Payout of leg 2')).toHaveValue('100,000')
  await expect(rows.nth(0).getByLabel('Notional of leg 2'), 'a payout has no size').toHaveCount(0)
  await settled(rows, 0)
  const sent = []
  let structureSent = null
  app.on('request', r => { if (r.url() === API + '/api/book/package' && r.method() === 'POST') { const b = r.postDataJSON(); structureSent = b.structure; sent.push(...b.legs) } })
  await win.getByRole('button', { name: /BOOK 2 LEGS/ }).click()
  await expect(win.getByTestId('fx-legs-package')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => sent.length).toBe(2)
  expect(sent.map(b => [b.instrument_type, b.structure])).toEqual([['CRYPTO_FORWARD', 'VANILLA'], ['CRYPTO_OPTION', 'DIGITAL']])
  expect(sent[1].terms).toMatchObject({ option_type: 'PUT', direction: 'BUY', payout: '100000', digital_asset: 'BTC' })
  expect(structureSent).toBe('CUSTOM')
  expect(sent[1].notional, 'the record carries the payout').toBe(100000)
  await win.locator('.tbw-light-r').click()

  // a currency pair: a call leg on an FX forward is priced by the FX option route
  const fx = await openTicket(app, 'FX', /^FX FORWARD$/i)
  const fxRows = fx.getByTestId('fx-leg')
  await fx.getByTestId('fx-legs-add').click()
  await fxRows.nth(0).getByLabel('Type of leg 2').selectOption('CALL')
  await settled(fxRows, 0)
  expect(Number(await fxRows.nth(0).getByTestId('fx-leg-npv').getAttribute('data-value'))).toBeGreaterThan(0)
  await expect(fx.getByRole('button', { name: /BOOK 2 LEGS/ })).toBeVisible()
  expectClean(problems)
})

test('XVA of a package: a strip on a digital asset runs as one netting set, and a changed leg clears the run', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  // a forward hedged with a strip: three legs, each priced
  await win.getByTestId('fx-legs-strip-3').click()
  const rows = win.getByTestId('fx-leg')
  await expect(rows).toHaveCount(2)
  await expect.poll(async () => (await rows.getByTestId('fx-leg-npv').evaluateAll(els => els.every(e => e.getAttribute('data-value') !== ''))), { message: 'every leg is priced' }).toBe(true)

  // the XVA tab runs the package, not the ticket alone
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  await expect(win.getByTestId('xva-package')).toHaveAttribute('data-legs', '3')
  const asked = app.waitForResponse(r => r.url().endsWith('/api/xva/currency-package') && r.request().method() === 'POST', { timeout: 90_000 })
  await win.getByRole('button', { name: /SIMULATE 3 LEGS/ }).click()
  const resp = await asked
  expect(resp.status()).toBe(200)
  const sent = resp.request().postDataJSON(), got = await resp.json()
  expect(sent.trades).toHaveLength(3)
  expect(sent.trades.every(t => t.instrument_type === 'CRYPTO_FORWARD')).toBe(true)
  expect(got.package).toBe(true)
  expect(got.legs).toHaveLength(3)
  // the legs settle a month apart: the grid runs to the last of them
  expect(got.legs[2].settles).toBeGreaterThan(got.legs[0].settles)
  await expect(win.getByTestId('va-strip')).toBeVisible()
  await expect(win.getByTestId('xva-netting')).toBeVisible()
  // netting never adds exposure: the set's peak is at most the legs' peaks added up
  expect(Number(await win.getByTestId('xva-netting').getAttribute('data-net'))).toBeLessThanOrEqual(Number(await win.getByTestId('xva-netting').getAttribute('data-gross')))
  await expectNoHorizontalOverflow(win, 'XVA of a package')
  await app.screenshot({ path: 'e2e/.out/shots/legs-xva-package.png' })

  // a leg removed: the run on screen was of other terms, so it goes, and the button counts the legs that are left
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await rows.first().getByRole('button', { name: /Remove leg/ }).click()
  await expect(rows).toHaveCount(1)
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  await expect(win.getByTestId('xva-netting')).toHaveCount(0)
  await expect(win.getByRole('button', { name: /SIMULATE 2 LEGS/ })).toBeVisible()
  // with no further leg the ticket runs on its own again
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await win.getByTestId('fx-legs-clear').click()
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  await expect(win.getByTestId('xva-package')).toHaveCount(0)
  const single = app.waitForResponse(r => r.url().endsWith('/api/xva/currency') && r.request().method() === 'POST', { timeout: 90_000 })
  await win.getByRole('button', { name: /SIMULATE$/ }).click()
  expect((await single).status()).toBe(200)
  expectClean(problems)
})

test('wrong-way risk: a sold forward to a counterparty whose credit worsens as the coin falls is charged more, and says so', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  // sell the coin forward: we are owed when it has fallen
  await win.getByRole('button', { name: /^Sell / }).first().click()
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  const toggle = win.getByRole('button', { name: /MODEL INPUTS/ })
  await expect(toggle).toBeVisible()
  if (!/HIDE/.test(await toggle.innerText())) await toggle.click()
  await expect(win.getByTestId('xva-credit-link')).toBeVisible()

  // independent first: no wrong-way line
  const first = app.waitForResponse(r => r.url().endsWith('/api/xva/currency') && r.request().method() === 'POST', { timeout: 90_000 })
  await win.getByRole('button', { name: /SIMULATE$/ }).click()
  const plain = await (await first).json()
  expect(plain.wwr).toBe(null)
  await expect(win.getByTestId('xva-wwr')).toHaveCount(0)

  // the counterparty's intensity × 3 when the coin halves: the same paths, a larger charge
  await win.getByTestId('xva-link-cp').selectOption('3')
  const second = app.waitForResponse(r => r.url().endsWith('/api/xva/currency') && r.request().method() === 'POST' && r.request().postDataJSON().cp_hazard_if_halves === 3, { timeout: 90_000 })
  await win.getByRole('button', { name: /SIMULATE$/ }).click()
  const linked = await (await second).json()
  expect(linked.wwr.cva_independent).toBe(plain.xva.cva)
  expect(linked.xva.cva).toBeLessThan(plain.xva.cva)
  const line = win.getByTestId('xva-wwr')
  await expect(line).toContainText('WRONG-WAY RISK')
  expect(Number(await line.getAttribute('data-cva'))).toBeLessThan(Number(await line.getAttribute('data-independent')))
  await expectNoHorizontalOverflow(win, 'XVA with a credit link')
  await app.screenshot({ path: 'e2e/.out/shots/xva-wrong-way.png' })
  expectClean(problems)
})

test('margin and capital on a digital-asset ticket: no SIMM anywhere; a typed dollar amount or the estimate; the Basel group moves KVA alone', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  const toggle = win.getByRole('button', { name: /MODEL INPUTS/ })
  await expect(toggle).toBeVisible()
  if (!/HIDE/.test(await toggle.innerText())) await toggle.click()
  // nothing on the tab is called SIMM except the note that says it is not computed
  await expect(win.getByText('Initial margin exchanged', { exact: true })).toBeVisible()
  await expect(win.getByText(/SIMM IM/)).toHaveCount(0)

  // on chain with margin exchanged, the amount left blank: the engine's estimate, named as that
  await win.getByRole('button', { name: 'ON-CHAIN', exact: true }).click()
  const run = (pred = () => true) => app.waitForResponse(r => r.url().endsWith('/api/xva/currency') && r.request().method() === 'POST' && pred(r.request().postDataJSON()), { timeout: 90_000 })
  let asked = run(b => b.csa?.preset === 'ON_CHAIN' && b.im_usd == null)
  await win.getByRole('button', { name: /SIMULATE$/ }).click()
  const est = await (await asked).json()
  expect(est.capital.im_basis).toMatch(/engine's estimate/)
  expect(est.capital.im_0).toBeGreaterThan(0)
  expect(est.capital.crypto_group).toBe('2a')
  await expect(win.getByTestId('xva-im-basis')).toContainText("the engine's estimate")
  await expect(win.getByTestId('xva-im-basis')).toContainText('not ISDA SIMM')
  await expect(win.getByTestId('xva-capital-basis')).toContainText('SCO60.98')

  // a dollar amount typed: that amount, held for the life; MVA is its funding cost
  await win.getByTestId('xva-im-usd').fill('250k')
  asked = run(b => b.im_usd === 250000)
  await win.getByRole('button', { name: /SIMULATE$/ }).click()
  const typed = await (await asked).json()
  expect(typed.capital.im_0).toBe(250000)
  expect(new Set(typed.im_profile).size).toBe(1)
  expect(typed.xva.mva).toBeLessThan(0)
  await expect(win.getByTestId('xva-im-basis')).toContainText('set by the desk')
  expect(Number(await win.getByTestId('xva-im-basis').getAttribute('data-im'))).toBe(250000)

  // Group 2b: half of the notional as the add-on; the capital charge grows and nothing else moves
  await win.getByTestId('xva-crypto-group').selectOption('2b')
  asked = run(b => b.crypto_group === '2b')
  await win.getByRole('button', { name: /SIMULATE$/ }).click()
  const twoB = await (await asked).json()
  expect(twoB.capital.crypto_group).toBe('2b')
  expect(twoB.xva.kva).toBeLessThan(typed.xva.kva)
  for (const k of ['cva', 'dva', 'fva', 'fba', 'mva']) expect(twoB.xva[k], k).toBe(typed.xva[k])
  await expect(win.getByTestId('xva-capital-basis')).toContainText('SCO60.99')
  await expectNoHorizontalOverflow(win, 'XVA with margin and capital lines')

  // an entry that is not an amount is said to be that, and no run starts on it (found by review: it was taken as blank)
  await win.getByTestId('xva-im-usd').fill('1,5m')
  await expect(win.getByTestId('xva-im-usd')).toHaveAttribute('aria-invalid', 'true')
  let ran = false
  const watch = r => { if (r.url().endsWith('/api/xva/currency') && r.method() === 'POST') ran = true }
  app.on('request', watch)
  await win.getByRole('button', { name: /SIMULATE$/ }).click()
  await expect(win.getByText(/Initial margin: type an amount/)).toBeVisible()
  await app.waitForTimeout(500)
  app.off('request', watch)
  expect(ran, 'no run on an entry that is not an amount').toBe(false)
  // the box is in the ticket's own currency, and says so
  await expect(win.getByText('Initial margin USD', { exact: true })).toBeVisible()
  await app.screenshot({ path: 'e2e/.out/shots/xva-margin-capital.png' })

  // another asset starts with neither the amount nor the group of the last one
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'ETHUSD' }) }).first().selectOption('ETHUSD')
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeLessThan(50_000)
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  await expect(win.getByTestId('xva-im-usd')).toHaveValue('')
  await expect(win.getByTestId('xva-crypto-group')).toHaveValue('')
  expectClean(problems)
})

test('a package is one trade on chain: one trade ID, a leg ID each, confirmed together as one record, each leg verified', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await win.getByTestId('fx-legs-strip-3').click()
  const rows = win.getByTestId('fx-leg')
  await expect(rows).toHaveCount(2)
  for (const i of [0, 1]) await expect(rows.nth(i)).toHaveAttribute('data-pending', 'false')
  await win.getByRole('button', { name: /BOOK 3 LEGS/ }).click()
  await expect(win.getByTestId('fx-legs-package')).toBeVisible({ timeout: 30_000 })
  const pid = (await win.getByTestId('fx-legs-package').innerText()).trim()
  expect(pid).toMatch(/^TRD-\d{8}$/)
  await expect(win.getByText('TRADE ID', { exact: true })).toBeVisible()

  // CONFIRM: the tab names the package, its trade ID and every leg's ID, and offers ONE confirmation for the three
  await win.getByRole('button', { name: /CONFIRM/ }).first().click()
  const pkg = win.getByTestId('confirm-package')
  await expect(pkg).toHaveAttribute('data-legs', '3')
  await expect(win.getByTestId('confirm-package-id')).toHaveText(pid)
  await expect(win.getByTestId('confirm-package-legs')).toContainText(`${pid}-1 pending`)
  await expect(win.getByTestId('confirm-package-legs')).toContainText(`${pid}-3 pending`)
  const one = app.waitForResponse(r => r.url().endsWith('/api/chain/confirm-package') && r.request().method() === 'POST', { timeout: 120_000 })
  let single = 0
  app.on('request', r => { if (/\/api\/chain\/confirm\/[0-9a-f-]+$/.test(r.url())) single += 1 })
  await win.getByRole('button', { name: /CONFIRM PACKAGE ON-CHAIN · 3 LEGS, ONE RECORD/ }).click()
  const resp = await one
  expect(resp.status()).toBe(201)
  const done = await resp.json()
  expect(resp.request().postDataJSON().trade_ids).toHaveLength(3)
  expect(done.package.trade_id).toBe(pid)
  expect(done.package.record.legs).toHaveLength(3)
  expect(done.trades.map(t => t.status)).toEqual(['CONFIRMED', 'CONFIRMED', 'CONFIRMED'])
  expect(done.trades.map(t => t.trade_ref)).toEqual([`${pid}-1`, `${pid}-2`, `${pid}-3`])
  expect(single, 'no leg was confirmed on its own').toBe(0)

  // the certificate of the leg in the window: the package, its hash, and this leg's own hash, three different things
  const cert = win.getByTestId('confirm-certificate')
  await expect(cert).toBeVisible({ timeout: 30_000 })
  await expect(win.getByTestId('cert-package')).toContainText(`${pid} · leg 1 of 3`)
  await expect(win.getByTestId('cert-package-hash')).toHaveText(done.package.hash)
  await expect(cert).toContainText("THIS LEG'S HASH")
  await expect(win.getByTestId('confirm-package-legs')).toContainText(`${pid}-2 confirmed`)
  // VERIFY re-derives this leg's record, finds it in the package, and re-derives the package's hash
  const verified = app.waitForResponse(r => /\/api\/chain\/verify\//.test(r.url()), { timeout: 60_000 })
  await cert.getByRole('button', { name: /VERIFY/ }).click()
  const v = await (await verified).json()
  expect(v.hash_matches).toBe(true)
  expect(v.package).toMatchObject({ trade_id: pid, leg: 1, of: 3, hash: done.package.hash, hash_matches: true, leg_in_package: true })
  expect(v.signatures_valid_for_current_state).toBe(true)
  await expectNoHorizontalOverflow(win, 'CONFIRM of a package')
  await app.screenshot({ path: 'e2e/.out/shots/legs-confirm-package.png' })

  // the blotter: the three legs, each confirmed, found by the trade ID
  await win.locator('.tbw-light-r').click()
  await app.getByPlaceholder(/Search/).fill(pid)
  await expect(app.locator('.bl-row')).toHaveCount(3)
  await expect(app.locator('.bl-row').filter({ hasText: 'CONFIRMED' })).toHaveCount(3)
  expect((await app.getByTestId('bl-pkg').allInnerTexts()).map(x => x.trim()).sort()).toEqual(['STRIP 1/3', 'STRIP 2/3', 'STRIP 3/3'])
  expectClean(problems)
})

test('CONFIRM pressed before the blotter has the new legs still confirms the package as one, never one leg alone', async ({ app, problems }) => {
  // Found by review: the package was read from the blotter's trades, which arrive a moment after BOOK; a quick press
  // confirmed the first leg alone, and the package could then never be one record.
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await win.getByTestId('fx-legs-strip-3').click()
  const rows = win.getByTestId('fx-leg')
  await expect(rows).toHaveCount(2)
  for (const i of [0, 1]) await expect(rows.nth(i)).toHaveAttribute('data-pending', 'false')

  // from here the blotter's list of trades does not arrive until it is let through
  const held = []
  await app.route(/\/rest\/v1\/trades\?/, route => { held.push(route) })
  await win.getByRole('button', { name: /BOOK 3 LEGS/ }).click()
  await expect(win.getByTestId('fx-legs-package')).toBeVisible({ timeout: 30_000 })
  const pid = (await win.getByTestId('fx-legs-package').innerText()).trim()
  await win.getByRole('button', { name: /CONFIRM/ }).first().click()
  // the tab already knows the package, from the legs this window booked
  await expect(win.getByTestId('confirm-package-id')).toHaveText(pid)
  await expect(win.getByTestId('confirm-package')).toHaveAttribute('data-legs', '3')
  let single = 0
  app.on('request', r => { if (/\/api\/chain\/confirm\/[0-9a-f-]+$/.test(r.url())) single += 1 })
  const one = app.waitForResponse(r => r.url().endsWith('/api/chain/confirm-package') && r.request().method() === 'POST', { timeout: 120_000 })
  await win.getByRole('button', { name: /CONFIRM PACKAGE ON-CHAIN · 3 LEGS, ONE RECORD/ }).click()
  const resp = await one
  expect(resp.status()).toBe(201)
  expect(resp.request().postDataJSON().trade_ids).toHaveLength(3)
  expect(single, 'no leg was confirmed on its own').toBe(0)
  // and the server would not have taken one leg alone either: a whole pending package is confirmed as one
  await app.unroute(/\/rest\/v1\/trades\?/)
  for (const r of held) { try { await r.continue() } catch { /* the page moved on */ } }
  await expect(win.getByTestId('cert-package')).toContainText(`${pid} · leg 1 of 3`, { timeout: 30_000 })
  expect(problems.filter(x => !/rest\/v1\/trades|Failed to fetch|aborted/i.test(x)), `other problems:\n${problems.join('\n')}`).toEqual([])
})

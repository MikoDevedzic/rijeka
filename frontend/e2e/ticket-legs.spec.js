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
  const booked = []
  app.on('request', r => { if (r.url() === API + '/api/trades/' && r.method() === 'POST') booked.push({ sent: r.postDataJSON() }) })
  // BOOK pressed while a leg is still being priced for its new side books nothing and says so
  await win.getByRole('button', { name: /BOOK 3 LEGS/ }).click()
  await expect(win.locator('.tbw-title')).toContainText(/nothing was booked/i)
  expect(booked.length, 'nothing was sent').toBe(0)
  for (const i of [0, 1]) await expect(rows.nth(i), 'every leg holds the price of the terms it shows').toHaveAttribute('data-pending', 'false')
  await expect(rows.getByTestId('fx-leg-says')).toHaveCount(0)
  await win.getByRole('button', { name: /BOOK/ }).click()
  await expect(win.getByTestId('fx-legs-package')).toBeVisible({ timeout: 30_000 })
  const pkg = (await win.getByTestId('fx-legs-package').innerText()).trim()
  expect(pkg).toMatch(/^PKG-[A-Z0-9]+$/)
  await expect(win.getByTestId('fx-leg-ref')).toHaveCount(3)
  await expect(win.getByTestId('fx-legs-failed')).toHaveCount(0)
  const refs = (await win.getByTestId('fx-leg-ref').allInnerTexts()).map(x => x.trim())
  expect(refs[0]).toMatch(/^TRD-\d+$/)
  expect(refs.slice(1), 'each further leg is named after the first').toEqual([`${refs[0]}-2`, `${refs[0]}-3`])
  await expect.poll(() => booked.length, { message: 'three trades were booked' }).toBe(3)
  booked.sort((a, b) => a.sent.strategy.localeCompare(b.sent.strategy))
  expect(booked.map(b => b.sent.strategy)).toEqual([`CUSTOM ${pkg} 1/3`, `CUSTOM ${pkg} 2/3`, `CUSTOM ${pkg} 3/3`])
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

test('a package that stops part of the way says what stands, and the rest is booked from the table', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await win.getByTestId('fx-legs-strip-3').click()
  const rows = win.getByTestId('fx-leg')
  for (const i of [0, 1]) await expect(rows.nth(i)).toHaveAttribute('data-pending', 'false')

  // the API refuses the second trade once (as it does when two trades are named alike)
  let posts = 0
  await app.route(API + '/api/trades/', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    posts += 1
    if (posts === 2) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'The trade could not be saved; the error is in the server log.' }) })
    return route.continue()
  })
  await win.getByRole('button', { name: /BOOK 3 LEGS/ }).click()
  const failed = win.getByTestId('fx-legs-failed')
  await expect(failed).toBeVisible({ timeout: 30_000 })
  await expect(failed).toContainText('1 of 3 legs are booked. Leg 2 was not: The trade could not be saved')
  const refs = () => win.getByTestId('fx-leg-ref').allInnerTexts().then(a => a.map(x => x.trim()))
  expect((await refs()).filter(r => r !== '—').length, 'one leg stands').toBe(1)
  // BOOK is done for the first leg and cannot send it again; the rest is booked from the table
  await expect(win.getByRole('button', { name: /BOOKED/ })).toBeDisabled()
  await win.getByTestId('fx-legs-book-rest').click()
  await expect(failed).toHaveCount(0, { timeout: 30_000 })
  const all = await refs()
  expect(all.filter(r => r !== '—').length).toBe(3)
  expect(all.slice(1)).toEqual([`${all[0]}-2`, `${all[0]}-3`])
  expect(posts, 'the first leg was sent once: four posts in all, one of them refused').toBe(4)
  // the refused booking is the one problem the browser reports, and it is the one this journey made
  expect(problems.filter(x => !/500|trades\//.test(x)), `other problems:\n${problems.join('\n')}`).toEqual([])
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
  app.on('request', r => { if (r.url() === API + '/api/trades/' && r.method() === 'POST') sent.push(r.postDataJSON()) })
  await win.getByRole('button', { name: /BOOK 2 LEGS/ }).click()
  await expect(win.getByTestId('fx-legs-package')).toBeVisible({ timeout: 30_000 })
  await expect(win.getByTestId('fx-legs-failed')).toHaveCount(0)
  await expect.poll(() => sent.length).toBe(2)
  expect(sent.map(b => [b.instrument_type, b.structure])).toEqual([['CRYPTO_OPTION', 'EUROPEAN'], ['CRYPTO_OPTION', 'TOUCH']])
  expect(sent[1].terms).toMatchObject({ direction: 'SELL', touch_type: 'ONE_TOUCH', payout: '100000', barrier_monitoring: 'CONTINUOUS' })
  expect(sent[1].terms.strike_price, 'a touch books no strike').toBeUndefined()
  expect(sent.map(b => b.strategy.replace(/PKG-\w+/, 'PKG'))).toEqual(['CUSTOM PKG 1/2', 'CUSTOM PKG 2/2'])
  await win.locator('.tbw-light-r').click()
  await app.getByPlaceholder(/Search/).fill(sent[0].strategy.match(/PKG-\w+/)[0])
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
  app.on('request', r => { if (r.url() === API + '/api/trades/' && r.method() === 'POST') sent.push(r.postDataJSON()) })
  await win.getByRole('button', { name: /BOOK 2 LEGS/ }).click()
  await expect(win.getByTestId('fx-legs-package')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => sent.length).toBe(2)
  expect(sent.map(b => [b.instrument_type, b.structure])).toEqual([['CRYPTO_FORWARD', 'VANILLA'], ['CRYPTO_OPTION', 'DIGITAL']])
  expect(sent[1].terms).toMatchObject({ option_type: 'PUT', direction: 'BUY', payout: '100000', digital_asset: 'BTC' })
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

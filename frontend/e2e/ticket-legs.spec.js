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

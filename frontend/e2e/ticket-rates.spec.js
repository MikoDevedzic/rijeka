// The rates ticket, end to end, as a trader uses it: a new swap against the demo bank, priced; the XVA tab under
// a bilateral CSA with the on-chain comparison and the collateral choice; the CAPITAL tab; booked; confirmed.
// Layout is part of the journey: nothing is clipped, nothing scrolls inside itself.
import { test, expect, expectClean, expectFullyInView, expectNoHorizontalOverflow, expectZero, simulateWithComparison, API } from './fixtures.js'

test('rates ticket: price, XVA with the saving on chain, collateral, capital, book, confirm', async ({ app, problems }) => {
  // the par solve answers a second and a half late, so the PRICE click below is certain to come before the coupon
  let parAnswered = 0
  await app.route(`${API}/api/price/par-rate`, async route => {
    await new Promise(r => setTimeout(r, 1500))
    const resp = await route.fetch()
    parAnswered = Date.now()
    await route.fulfill({ response: resp })
  })
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()          // a new ticket opens on digital assets; this journey is a swap's

  // counterparty and price
  const cp = win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first()
  await cp.selectOption({ label: 'RIJEKA DEMO BANK AG' })
  // PRICE at once, before the par rate has had time to solve: the window must wait for the coupon, not price
  // the fixed leg at 0 % (which showed a par swap worth $1.6m)
  const priced = app.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith('/price/preview') && r.request().method() === 'POST')
  await expect(win.locator('input.tbw-amber').first(), 'the coupon is still blank when PRICE is pressed').toHaveValue('')
  const clicked = Date.now()
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await expect(win.getByRole('button', { name: /PRICING/ }), 'the click is held, and says so').toBeVisible()
  const priceResp = await priced
  expect(priceResp.status()).toBe(200)
  expect(parAnswered, 'the price was requested only after the par rate arrived').toBeGreaterThan(clicked)
  const fixedLeg = priceResp.request().postDataJSON().legs.find(l => l.leg_type === 'FIXED')
  expect(fixedLeg.fixed_rate, 'the fixed leg is struck at the solved par rate, never at zero').toBeGreaterThan(0.001)
  const price = await priceResp.json()
  expect(Math.abs(price.npv), 'a par swap is worth about nothing').toBeLessThan(100)
  expect(Math.abs(price.ir01), 'a 5Y swap on 10m has an IR01 in the thousands').toBeGreaterThan(1000)
  const footer = win.locator('text=NET NPV').last().locator('xpath=ancestor::div[2]')
  await expect(footer).toContainText(/IR01\s*[+−-]\$[1-9]/)

  // a field reached by keyboard shows where the focus is: the app's ring, which the ticket's own styles leave alone
  await win.locator('.tbw-sec input').first().focus()
  await app.keyboard.press('Tab')
  const ring = await app.evaluate(() => { const e = document.activeElement, c = getComputedStyle(e); return { tag: e.tagName, inTicket: !!e.closest('.tbw-window'), style: c.outlineStyle, width: parseFloat(c.outlineWidth) } })
  expect(ring.inTicket, 'Tab moved to another control of the ticket').toBe(true)
  expect(ring.style, `keyboard focus on a ${ring.tag} is visible`).not.toBe('none')
  expect(ring.width).toBeGreaterThan(0)

  // XVA: bilateral, simulate; the comparison under atomic settlement runs by default
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  await win.getByRole('button', { name: 'BILATERAL', exact: true }).click()
  const one = await simulateWithComparison(app, win, '/api/xva/simulate')
  expect(Math.abs(one.request.ir01), 'the simulation runs on the priced ticket (IR01 drives the IM behind MVA)').toBeGreaterThan(1000)
  const first = one.run
  expectZero(first.xva.colva, 'cash collateral carries nothing')
  expect(first.xva.mva, 'initial margin exchanged under a bilateral CSA has a funding cost').toBeLessThan(0)
  expect(one.onChain.csa.mpor_days, 'the comparison ran under atomic settlement').toBe(5)
  const strip = win.getByTestId('va-strip')
  await expect(strip).toContainText('CVA')
  await expect(strip).toContainText('ColVA')
  await expect(strip).toContainText('ALL-IN')
  const saving = win.getByTestId('saving-on-chain')
  await expect(saving).toContainText('SAVING ON CHAIN', { timeout: 60_000 })
  await expect(saving).toContainText(/bp upfront/)
  // the line shows this run's saving: the on-chain all-in less the ticket's, to the dollar
  const savedUsd = Math.round(one.onChain.xva.all_in - first.xva.all_in)
  await expect(saving).toContainText(Math.abs(savedUsd).toLocaleString('en-US'))
  expect(await win.getByTestId('xva-outputs').innerText(), 'one sign per figure, a rounded zero unsigned').not.toMatch(/\+\+|--|−−|\+-|\+−|-\+|−\+/)
  // the saving line is one row: every part sits on the same line as the label
  const tops = await saving.locator('span').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().bottom)))
  expect(Math.max(...tops) - Math.min(...tops), 'the saving line wraps').toBeLessThanOrEqual(6)
  await expectFullyInView(win.getByTestId('xva-outputs'), 'XVA results (strip, saving, comparison) under BILATERAL')
  await expectNoHorizontalOverflow(win.getByTestId('xva-left'), 'XVA left column')

  // collateral: the margin we post held in a stablecoin that pays its holder nothing → a carry cost in ColVA
  await win.getByLabel('VM posted in').selectOption('USDC')
  const two = await simulateWithComparison(app, win, '/api/xva/simulate')
  const usdc = two.run
  expect(usdc.xva.colva, 'posted margin in USDC costs the OIS it does not earn').toBeLessThan(0)
  expect(usdc.csa.collateral.posted).toEqual({ USDC: 1 })
  expect(usdc.xva.cva, 'the credit charge does not depend on what the margin is held in').toBeCloseTo(first.xva.cva, 1)
  await expect(saving).toContainText(Math.abs(Math.round(two.onChain.xva.all_in - usdc.xva.all_in)).toLocaleString('en-US'))
  await expect(win.getByTestId('va-strip')).toContainText(Math.abs(Math.round(usdc.xva.colva)).toLocaleString('en-US'))
  await expectFullyInView(win.getByTestId('xva-outputs'), 'XVA results after the collateral change')
  await app.screenshot({ path: 'e2e/.out/shots/rates-xva.png' })

  // CAPITAL: regulatory stock only, chips whole, no sideways scroll
  await win.getByRole('button', { name: 'CAPITAL', exact: true }).click()
  await expectNoHorizontalOverflow(win.getByTestId('capital-left'), 'CAPITAL left column')
  const cap = app.waitForResponse(r => r.url().includes('/api/capital/trade'), { timeout: 120_000 })
  await win.getByRole('button', { name: /CAPITAL UNDER EVERY REGIME/ }).click()
  expect((await cap).status()).toBe(200)
  const grid = win.getByTestId('capital-grid')
  await expect(grid).toContainText('SA-CCR EAD')
  await expect(grid).toContainText('RWA')
  await expect(grid).toContainText('AS RECORDED')
  const rows = await grid.locator('tbody tr').count()
  expect(rows, 'seven stock rows, no prices').toBe(7)
  expect(await grid.innerText()).not.toMatch(/\bKVA\b|\bMVA\b|QUOTE VS/)
  await app.screenshot({ path: 'e2e/.out/shots/rates-capital.png' })

  // book, then confirm (the local stack signs both sides and has no chain: signed, not anchored)
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  const booked = app.waitForResponse(r => r.url().includes('/api/book/trade'))
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  expect((await booked).status()).toBe(201)
  await win.getByRole('button', { name: '◆ CONFIRM' }).click()
  await expect(win).toContainText('PENDING')
  const confirmed = app.waitForResponse(r => r.url().includes('/api/chain/confirm/'), { timeout: 60_000 })
  await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click()
  // the answer lands while another tab is open: the ticket keeps CONFIRM mounted and hidden, where a canvas has no size
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  expect([201, 202]).toContain((await confirmed).status())
  await expect(win).toContainText('CONFIRMED', { timeout: 60_000 })
  await expect(win).toContainText('TRADE HASH')
  await expect(win).toContainText('demo, not bilateral')
  // the certificate: the heading says what the record is (the stack has no chain, and one side's key is Rijeka's),
  // and the seal is drawn from the hash once the tab is looked at again
  await win.getByRole('button', { name: '◆ CONFIRM' }).click()
  const cert = win.getByTestId('confirm-certificate')
  await expect(cert).toContainText('Certificate of confirmation')
  await expect(cert).toContainText('The terms are signed, not anchored')
  await expect(cert).not.toContainText('Both sides signed')
  const inked = () => win.getByTestId('confirm-seal').evaluate(cv => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  })
  await expect.poll(inked, { message: 'the seal is drawn after the tab comes back into view', timeout: 15_000 }).toBeGreaterThan(5000)
  await expectNoHorizontalOverflow(cert, 'the certificate')
  await app.screenshot({ path: 'e2e/.out/shots/rates-confirmed.png' })

  expectClean(problems)
})

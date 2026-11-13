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

  // DETAILS: the period schedule writes its figures as the ticket does (a notional grouped, a coupon without spare
  // zeros), shows the plain number in the field being typed in, and a look changes nothing: no amber, the same price
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  const n1 = win.getByLabel('Fixed leg notional, period 1'), c1 = win.getByLabel('Coupon %, period 1')
  await expect(n1).toHaveValue('10,000,000')
  await expect(c1).toHaveValue(/^\d\.\d{1,6}$/)
  const coupon = await c1.inputValue()                  // at rest
  await n1.focus()
  await expect(n1, 'the field being typed in holds the plain number').toHaveValue('10000000')
  await c1.focus()
  await expect(n1).toHaveValue('10,000,000')
  await expect(win.getByLabel('Float leg notional, period 1')).toHaveValue('10,000,000')
  // a comma typed as a decimal is refused and marked, never read as 35; leaving the field puts the coupon back
  await c1.fill('3,5')
  await expect(c1).toHaveAttribute('aria-invalid', 'true')
  await n1.focus()
  await expect(c1, 'the coupon is what it was').toHaveValue(coupon)
  await expect(c1).not.toHaveAttribute('aria-invalid', 'true')
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()

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
  const tops = await saving.locator('span:visible').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().bottom)))
  expect(Math.max(...tops) - Math.min(...tops), 'the saving line wraps').toBeLessThanOrEqual(6)
  await expectFullyInView(win.getByTestId('xva-outputs'), 'XVA results (strip, saving, comparison) under BILATERAL')
  // a swap under a CSA on a laptop (1440 by 900): the inputs fit the window, so nothing scrolls, and the incremental
  // charge is in view under the results, not under the fold (it sat below the whole tab until 0.30.1)
  const fits = await win.evaluate(w => {
    const left = w.querySelector('[data-testid="xva-left"]').getBoundingClientRect(), foot = w.querySelector('.tbw-footer').getBoundingClientRect()
    const body = [...w.querySelectorAll('*')].find(e => /auto|scroll/.test(getComputedStyle(e).overflowY) && e.contains(w.querySelector('[data-testid="xva-left"]')))
    const last = [...w.querySelector('[data-testid="xva-left"]').children].filter(c => c.getBoundingClientRect().height > 0).at(-1).getBoundingClientRect()
    return { inputsEnd: Math.round(last.bottom), leftBottom: Math.round(left.bottom), footTop: Math.round(foot.top), scrolls: body ? body.scrollHeight - body.clientHeight : 0 }
  })
  expect(fits.inputsEnd, 'the XVA inputs under a CSA end above the footer').toBeLessThanOrEqual(fits.footTop)
  expect(fits.scrolls, `the XVA tab fits the window after a run with the comparison (${JSON.stringify(fits)})`).toBeLessThanOrEqual(2)
  await expectFullyInView(win.getByTestId('xva-below').getByRole('button', { name: /CHARGE THIS TRADE/ }), 'the incremental charge, under BILATERAL')
  const sw = await win.getByTestId('xva-switches').locator('label').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)))
  expect(Math.max(...sw) - Math.min(...sw), 'the two switches share one row').toBeLessThanOrEqual(3)
  // and each has its box: Safari shrinks a checkbox with no width of its own to nothing in a flex row
  const boxes = await win.getByTestId('xva-switches').locator('input[type=checkbox]').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().width)))
  expect(Math.min(...boxes), `a switch's box is drawn (${boxes})`).toBeGreaterThanOrEqual(10)
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

  // the incremental charge, opened in the results column: its heading is set as the tab's other section headings
  // are, the engine answers, and neither half of its table is cut by the column's edge
  const inc = win.getByTestId('xva-below')
  const heads = await win.evaluate(w => {
    const style = e => { const s = getComputedStyle(e); return `${s.fontSize} ${s.fontWeight} ${s.color}` }
    const curves = [...w.querySelectorAll('*')].find(e => !e.children.length && /^SPREAD CURVES/.test(e.textContent))
    return { incremental: style(w.querySelector('[data-testid="xva-below"] .tbw-lbl')), curves: style(curves) }
  })
  expect(heads.incremental, 'the incremental heading reads as SPREAD CURVES does').toBe(heads.curves)
  const charged = app.waitForResponse(r => r.url().includes('/api/xva/incremental'), { timeout: 120_000 })
  await inc.getByRole('button', { name: /CHARGE THIS TRADE/ }).click()
  expect((await charged).status(), 'the incremental charge answers').toBe(200)
  await expect(inc.getByRole('button', { name: 'RECOMPUTE' })).toBeVisible()
  await expect(inc).toContainText('WITHOUT')
  await expectNoHorizontalOverflow(inc, 'the incremental charge, opened')
  await inc.scrollIntoViewIfNeeded()
  await app.screenshot({ path: 'e2e/.out/shots/rates-xva-incremental.png' })

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
  const inked = () => win.getByTestId('cert-mark').evaluate(cv => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  })
  await expect.poll(inked, { message: 'the mark is drawn after the tab comes back into view', timeout: 15_000 }).toBeGreaterThan(900)
  await expect(win.getByTestId('cert-mark'), 'the ring is the seal: not closed where nothing is anchored').toHaveAttribute('data-stands', 'no')
  await expectNoHorizontalOverflow(cert, 'the certificate')
  // the certificate is paper with its own inks: the app's raised buttons and wells stop at its edge
  const paper = await cert.locator('button').evaluateAll(els => els.map(e => getComputedStyle(e).backgroundColor))
  expect(paper.length, 'the certificate has buttons').toBeGreaterThan(0)
  expect(paper, 'none of them is the app\'s raised face').not.toContain('rgb(33, 73, 63)')
  await app.screenshot({ path: 'e2e/.out/shots/rates-confirmed.png' })

  // the paper confirmation: the signed record as a sheet, over the app, and the only thing that prints
  await cert.getByTestId('paper-open').click()
  const sheet = app.getByTestId('paper-confirmation')
  await expect(sheet).toBeVisible()
  await expect(sheet).toHaveAttribute('data-state', 'signed')                         // the stack has no chain
  await expect(sheet).toContainText('Trade confirmation')
  await expect(sheet).toContainText('Interest rate swap')
  await expect(sheet).toContainText('Not anchored on a registry')
  await expect(app.getByTestId('paper-demo'), 'a record signed by Rijeka for both sides says so on paper').toContainText('not a confirmation between two parties')
  await expect(sheet.locator('.paper-stamp'), 'the stamp does not say both parties signed where Rijeka signed for both').toHaveText(/Signed with demonstration keys\s*Not anchored on a registry/i)
  await expect(sheet.locator('.paper-party b'), 'both parties are named, as the book knows them').toHaveCount(2)
  for (const word of ['Parties', 'Pays fixed', 'Pays floating', 'Fixed rate', 'Floating rate', 'Record hash', 'Signatures', 'Booked by', 'not a master agreement']) await expect(sheet).toContainText(word)
  const hash = (await cert.textContent()).match(/0x[0-9a-f]{64}/)[0]
  await expect(sheet, 'the hash on the paper is the certificate\'s').toContainText(hash)
  await expectNoHorizontalOverflow(sheet, 'the paper')
  await app.screenshot({ path: 'e2e/.out/shots/paper-confirmation-screen.png' })
  await app.emulateMedia({ media: 'print' })
  expect(await app.evaluate(() => [...document.body.children].filter(e => getComputedStyle(e).display !== 'none').map(e => e.className)), 'printed: the sheet and nothing else').toEqual(['paper-view'])
  await expect(app.getByTestId('paper-print')).toBeHidden()
  await app.screenshot({ path: 'e2e/.out/shots/paper-confirmation.png', fullPage: true })
  await app.emulateMedia({ media: 'screen' })
  await app.keyboard.press('Escape')
  await expect(sheet).toHaveCount(0)

  expectClean(problems)
})

// Reported by the owner on 11 November 2026: "why did we also lose per leg value. i'm looking at IR swap and we only
// have Net NPV, also, when i'm adding embeded optionality it doesnt show me Vega risk or the value of the option
// value on the swap." The footer, on every tab: the net, each leg, and an embedded option's value and vega.
test('a swap shows each leg beside the net; an embedded cap shows its value and its vega, and the figures add up', async ({ app, problems }) => {
  const money = t => { const m = String(t).replace(/[−–]/g, '-').match(/([+-]?)\$?([\d,]+(?:\.\d+)?)/); return m ? (m[1] === '-' ? -1 : 1) * Number(m[2].replace(/,/g, '')) : NaN }
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.getByRole('button', { name: /^IR SWAP$/i }).click()
  const figure = async label => money(await win.locator('.tbw-footer-metric', { hasText: label }).first().locator('span').last().textContent())
  const priced = async () => { const r = app.waitForResponse(x => x.url().endsWith('/price/preview') && x.request().method() === 'POST'); await win.getByRole('button', { name: '▶ PRICE' }).click(); return (await r).json() }

  let body = await priced()
  await expect(win.locator('.tbw-footer-metric', { hasText: 'FIXED PV' })).toBeVisible()
  await expect(win.locator('.tbw-footer-metric', { hasText: 'FLOAT PV' })).toBeVisible()
  await expect(win.locator('.tbw-footer-metric', { hasText: 'OPTION PV' }), 'no option, no option figure').toHaveCount(0)
  expect(body.option_pv, 'the API says "no option", not "an option worth nothing"').toBeNull()
  const fixed = await figure('FIXED PV'), float = await figure('FLOAT PV')
  expect(Math.abs(fixed), 'a leg of a 10mm five-year swap is worth something').toBeGreaterThan(100_000)
  expect(Math.abs(fixed + float - await figure('NET NPV'))).toBeLessThanOrEqual(2)

  // an embedded cap, sold, on the floating leg
  await win.getByRole('button', { name: '+ CAP' }).first().click()
  const strike = win.getByLabel('Strike of the embedded cap').first()
  await strike.fill('4.5'); await strike.blur()
  // the side the figures below are read against: a cap is added sold, and SELL is the lit chip (coral)
  expect(await win.getByRole('button', { name: 'SELL', exact: true }).last().evaluate(el => getComputedStyle(el).color)).toBe('rgb(240, 130, 140)')
  body = await priced()
  await expect(win.locator('.tbw-footer-metric', { hasText: 'OPTION PV' })).toBeVisible()
  const option = await figure('OPTION PV'), vega = await figure('VEGA/1BP')
  expect(option, 'a cap sold is a liability').toBeLessThan(0)
  expect(vega, 'and short vol').toBeLessThan(0)
  expect(Math.abs(option - body.option_pv)).toBeLessThanOrEqual(1)
  expect(Math.abs(vega - body.vega)).toBeLessThanOrEqual(1)
  expect(Math.abs((await figure('FIXED PV')) + (await figure('FLOAT PV')) + option - (await figure('NET NPV'))), 'the legs and the option add up to the net').toBeLessThanOrEqual(3)
  expect(Math.abs((await figure('FLOAT PV')) - float), 'the coupons are worth what they were: the option is shown apart').toBeLessThanOrEqual(1)
  // seven figures still sit on one line beside the buttons, at the narrowest width the ticket is used at
  await app.setViewportSize({ width: 1280, height: 800 })
  const boxes = await win.locator('.tbw-footer-metric').evaluateAll(els => els.map(e => { const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.right)] }))
  expect(new Set(boxes.map(b => b[0])).size, 'one line').toBe(1)
  const actions = await win.locator('.tbw-footer-actions').boundingBox()
  expect(Math.max(...boxes.map(b => b[1])), 'clear of the buttons').toBeLessThanOrEqual(Math.round(actions.x) + 1)
  await app.setViewportSize({ width: 1440, height: 900 })
  // the same figures are on every tab
  await win.getByRole('button', { name: 'CASHFLOWS', exact: true }).click()
  await expect(win.locator('.tbw-footer-metric', { hasText: 'OPTION PV' })).toBeVisible()
  await expect(win.getByTestId('option-error')).toHaveCount(0)
  expectClean(problems)
})

// The FX and digital-asset tickets: a forward and an option in each, priced, the XVA panel under a bilateral CSA
// with the on-chain comparison in view, and the margin held in a stablecoin showing its carry.
import { test, expect, expectClean, expectFullyInView, expectNoHorizontalOverflow, expectZero, simulateWithComparison } from './fixtures.js'

const CASES = [
  { name: 'crypto forward', asset: 'CRYPTO', product: /^CRYPTO FORWARD$/i, xva: '/api/xva/currency' },
  { name: 'crypto option', asset: 'CRYPTO', product: /^CRYPTO OPTION$/i, xva: '/api/xva/currency-option' },
  { name: 'FX forward', asset: 'FX', product: /^FX FORWARD$/i, xva: '/api/xva/currency' },
  { name: 'FX option', asset: 'FX', product: /^FX OPTION$/i, xva: '/api/xva/currency-option' },
]

for (const c of CASES) {
  test(`${c.name}: price, XVA with the saving on chain, collateral`, async ({ app, problems }) => {
    await app.goto('/blotter')
    await app.getByText('+ NEW TRADE').first().click()
    const win = app.locator('.tbw-window')
    await win.waitFor()
    await win.getByRole('button', { name: c.asset, exact: true }).click()
    await win.getByRole('button', { name: c.product }).click()
    const cp = win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first()
    await cp.selectOption({ label: 'RIJEKA DEMO BANK AG' })

    const priced = app.waitForResponse(r => /\/api\/currency\/.*price/.test(r.url()) && r.request().method() === 'POST')
    await win.getByRole('button', { name: '▶ PRICE' }).click()
    const quote = await (await priced).json()
    expect(quote.npv, 'the ticket has a value').toEqual(expect.any(Number))
    await expect(win).toContainText('NET NPV')

    await win.getByRole('button', { name: 'XVA', exact: true }).click()
    await win.getByRole('button', { name: 'BILATERAL', exact: true }).click()
    const one = await simulateWithComparison(app, win, c.xva)
    const first = one.run
    expectZero(first.xva.colva, 'cash collateral carries nothing')
    const strip = win.getByTestId('va-strip')
    await expect(strip).toContainText('ColVA')
    const saving = win.getByTestId('saving-on-chain')
    await expect(saving).toContainText('SAVING ON CHAIN')
    await expect(saving).toContainText(Math.abs(Math.round(one.onChain.xva.all_in - first.xva.all_in)).toLocaleString('en-US'))
    await expectFullyInView(win.getByTestId('xva-outputs'), `${c.name}: XVA results`)
    await expectNoHorizontalOverflow(win.getByTestId('xva-left'), `${c.name}: XVA left column`)
    expect(await win.getByTestId('xva-outputs').innerText(), 'one sign per figure, a rounded zero unsigned').not.toMatch(/\+\+|--|−−|\+-|\+−|-\+|−\+/)

    await win.getByLabel('VM posted in').selectOption('USDC')
    await win.getByLabel('VM received in').selectOption('USDC')
    const two = await simulateWithComparison(app, win, c.xva)
    const usdc = two.run
    expect(usdc.xva.colva, 'margin held in a stablecoin on both sides costs its carry').toBeLessThan(0)
    expect(usdc.xva.cva).toBeCloseTo(first.xva.cva, 1)
    await expect(saving).toContainText(Math.abs(Math.round(two.onChain.xva.all_in - usdc.xva.all_in)).toLocaleString('en-US'))
    await app.screenshot({ path: `e2e/.out/shots/${c.name.replace(/ /g, '-')}-xva.png` })
    expectClean(problems)
  })
}

// A venue's marks (market_data/deribit.py) reach the ticket as captions: where the vol and the forward came from and when.
// The stack has no venue, so the two responses are given the fields the API adds when it has one; the rest is the real app.
test('crypto ticket: the vol and the forward name the venue and the time of its marks', async ({ app, problems }) => {
  const AT = 'Deribit 9 Nov 12:57 UTC'              // the caption: short enough for one line over an input
  const MARKS = 'Deribit option marks · 2026-11-09 12:57 UTC'
  const FWDS = 'Deribit forwards · 2026-11-09 12:57 UTC'
  await app.route(/\/api\/currency\/pairs(\?.*)?$/, async route => {
    const res = await route.fetch()
    const body = await res.json()
    for (const p of body.pairs) {
      if (!p.crypto) continue
      if (p.vol_surface) p.vol_surface.label = AT
      p.forward_curve = { valuation_date: '2026-11-09', source: `DEMO · ${FWDS} · listed to 24SEP27, flat beyond`, label: AT, tenors: ['1M', '3M'] }
    }
    await route.fulfill({ response: res, json: body })
  })
  await app.route(/\/api\/currency\/option\/price$/, async route => {
    const res = await route.fetch()
    const body = await res.json()
    if (res.ok()) body.vol_marks = `${MARKS} · listed to 24SEP27, flat beyond`
    await route.fulfill({ response: res, json: body })
  })
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
  await win.getByRole('button', { name: /^CRYPTO FORWARD$/i }).click()
  await expect(win).toContainText(`forward from ${AT}`)
  await expect(win.getByTestId('fx-funding'), 'the funding field says what typing in it does').toHaveAttribute('title', /overrides the quoted forward/)
  await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click()
  await expect(win.getByTestId('fx-vol').locator('xpath=..'), 'the vol on its default names the surface it came from').toContainText(AT, { ignoreCase: true })
  const priced = app.waitForResponse(r => /\/api\/currency\/option\/price$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  expect((await priced).status(), 'the option prices').toBe(200)
  await expect(win).toContainText('NET NPV')
  await expectNoHorizontalOverflow(win, 'crypto option ticket with the venue captions')
  await app.screenshot({ path: 'e2e/.out/shots/crypto-option-marks.png' })
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

// Vera, 2026-11-09: with the feed's points on a digital-asset pair, SAVE DESK SPOT sent the feed's label as the source
// and the API refused it. The desk's spot now goes alone, as MANUAL, and the feed's points are not re-saved as the desk's.
// The save itself is answered here (it is tested on the database in tests/integration/test_crypto_marks.py) so the
// stack's spot, which the pinned book reads, is not changed by a journey.
test('market data: a desk spot saves on a pair whose forward points come from the feed', async ({ app, problems }) => {
  const FEED = 'DEMO · Deribit forwards · 2026-11-09 12:57 UTC · listed to 24SEP27, flat beyond'
  let pairs = null
  await app.route(/\/api\/currency\/pairs(\?.*)?$/, async route => {
    const res = await route.fetch()
    const body = await res.json()
    for (const p of body.pairs) {
      if (p.pair !== 'BTCUSD') continue
      p.forward_curve = { valuation_date: '2026-11-09', source: FEED, label: 'Deribit 9 Nov 12:57 UTC', tenors: ['1M', '3M'], in_use: true }
      p.forward_points = { '1M': 348.27, '3M': 1011.65 }
    }
    pairs = body.pairs
    await route.fulfill({ response: res, json: body })
  })
  let sent = null
  await app.route(/\/api\/currency\/forward-curve$/, async route => {
    sent = route.request().postDataJSON()
    await route.fulfill({ json: { ...pairs.find(p => p.pair === 'BTCUSD'), spot: sent.spot } })
  })
  await app.goto('/configurations/market-data/crypto')
  await app.locator('.crv-item', { hasText: 'BTCUSD' }).click()
  await expect(app.locator('.crv-item', { hasText: 'BTCUSD' })).toContainText('Deribit · 2 tenors')      // one word in the narrow list
  await expect(app.getByText('Deribit 9 Nov 12:57 UTC points', { exact: true })).toBeVisible()            // the venue and the time of its marks, above the table
  await app.getByText('Spot & funding', { exact: true }).click()
  await app.getByPlaceholder(/desk spot/).fill('70123')
  const reloaded = app.waitForResponse(r => /\/api\/currency\/pairs/.test(r.url()))       // the page reads the pairs again after a save
  await app.getByRole('button', { name: 'SAVE DESK SPOT' }).click()
  await expect(app.getByText('BTCUSD desk spot saved')).toBeVisible()
  expect(sent, 'the spot alone, under the desk\'s own label').toEqual({ pair: 'BTCUSD', points: {}, source: 'MANUAL', spot: 70123 })
  await reloaded
  await app.unrouteAll({ behavior: 'ignoreErrors' })       // nothing intercepted is left in flight when the test ends
  expectClean(problems)
})

// Miko, 9 November 2026: "our curves tab, there is not vol surface for crypto options." The CURVE SCENARIO tab of an
// option shows the pair's surface: the term structure with the expiry marked, the smile at the expiry with the strike
// marked, both moved by the VOL slider. What the browser reads off the surface must be the vol the engine priced at.
test('crypto option: the scenario tab shows the vol surface, read as the engine reads it, and the VOL slider moves it', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
  await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click()
  const priced = app.waitForResponse(r => /\/api\/currency\/option\/price$/.test(r.url()) && r.request().method() === 'POST' && r.ok())
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const quote = await (await priced).json()
  expect(quote.vol_pct, 'the option priced at a vol').toBeGreaterThan(0)
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()

  const block = win.getByTestId('fx-vol-surface')
  await block.scrollIntoViewIfNeeded()
  await expect(block, 'both charts have drawn').toHaveAttribute('data-ready', 'true')
  await expect(win.getByTestId('fx-vol-term')).toBeVisible()
  await expect(win.getByTestId('fx-vol-smile')).toBeVisible()
  const strikeVol = win.getByTestId('fx-vol-strike-vol')
  const num = async (loc, attr) => Number(await loc.getAttribute(attr))
  expect(await num(strikeVol, 'data-value'), 'the vol the quote priced at').toBeCloseTo(quote.vol_pct, 6)
  // the browser's own reading of the stored surface at this expiry and strike is the engine's vol
  expect(Math.abs(await num(strikeVol, 'data-surface') - quote.vol_pct), 'the surface read in the browser against the engine').toBeLessThan(0.05)
  await expect(win.getByTestId('fx-vol-differs')).toHaveCount(0)
  const atm = win.getByTestId('fx-vol-expiry-atm')
  expect(await num(atm, 'data-value')).toBeGreaterThan(0)
  for (const id of ['fx-vol-term', 'fx-vol-smile']) {
    const box = await win.getByTestId(id).boundingBox()
    expect(box.height, `${id} is tall enough to read`).toBeGreaterThanOrEqual(200)
  }
  await expectNoHorizontalOverflow(win, 'scenario tab with the vol surface')
  await app.screenshot({ path: 'e2e/.out/shots/scenario-vol-surface.png' })

  // the VOL slider: +2 points moves the surface shown by 2 points
  const vol = win.locator('input[type="range"]').filter({ has: app.locator('xpath=preceding-sibling::span[normalize-space()="VOL"]') }).first()
  const slider = (await vol.count()) ? vol : win.locator('span', { hasText: /^VOL$/ }).locator('xpath=following-sibling::input[@type="range"]').first()
  await slider.focus()
  for (let i = 0; i < 8; i++) await app.keyboard.press('ArrowRight')          // eight steps of a quarter point
  await expect.poll(() => num(atm, 'data-shocked')).toBeCloseTo((await num(atm, 'data-value')) + 2, 6)
  await expect.poll(() => num(strikeVol, 'data-shocked')).toBeCloseTo(quote.vol_pct + 2, 6)
  await app.screenshot({ path: 'e2e/.out/shots/scenario-vol-surface-shocked.png' })

  // a forward has no surface block
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  await win.getByRole('button', { name: /^CRYPTO FORWARD$/i }).click()
  const pricedF = app.waitForResponse(r => /\/api\/currency\/forward\/price$/.test(r.url()) && r.request().method() === 'POST' && r.ok())
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await pricedF
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await expect(win.getByTestId('fx-scenario-chart')).toBeVisible()
  await expect(win.getByTestId('fx-vol-surface')).toHaveCount(0)
  expectClean(problems)
})

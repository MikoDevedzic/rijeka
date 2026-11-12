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
    await expect(win, 'a forward shows its value, an option its premium').toContainText(c.xva.endsWith('option') ? 'PREMIUM' : 'NET NPV')

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

    // what the run says about its vol: a digital asset's regimes in the run's own figures; a currency pair has one vol
    const regimes = usdc.params.vol_regimes
    await win.getByText('SURFACE PROOF').click()
    const proof = win.locator('table', { hasText: 'VOL USED' })
    await expect(proof).toContainText('MODEL')
    if (c.asset === 'CRYPTO') {
      expect(regimes.lowest_vol_pct, 'the calmest day is below the vol used').toBeLessThan(usdc.params.vol_pct)
      expect(regimes.highest_vol_pct, 'and the most stressed above it').toBeGreaterThan(usdc.params.vol_pct)
      await expect(proof).toContainText('REGIMES')
      await expect(proof).toContainText(`between ${regimes.lowest_vol_pct.toFixed(1)} % and ${regimes.highest_vol_pct.toFixed(1)} %`)
      await expect(proof).toContainText(`daily closes to ${regimes.as_of}`)
      await expectNoHorizontalOverflow(win.getByTestId('xva-left'), `${c.name}: XVA left column with the proof open`)
    } else {
      expect(regimes, 'a currency pair has one vol').toBeNull()
      await expect(proof).not.toContainText('REGIMES')
    }
    await app.screenshot({ path: `e2e/.out/shots/${c.name.replace(/ /g, '-')}-proof.png` })
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
  await expect(win.getByTestId('fx-funding'), 'the funding field says what typing in it does').toHaveAttribute('title', /replaces the quoted forward/)
  await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click()
  await expect(win.getByTestId('fx-vol').locator('xpath=..'), 'the vol on its default names the surface it came from').toContainText(AT, { ignoreCase: true })
  const priced = app.waitForResponse(r => /\/api\/currency\/option\/price$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  expect((await priced).status(), 'the option prices').toBe(200)
  await expect(win).toContainText('PREMIUM')
  await expectNoHorizontalOverflow(win, 'crypto option ticket with the venue captions')
  await app.screenshot({ path: 'e2e/.out/shots/crypto-option-marks.png' })
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

// Found by opening every tab, 2026-11-09: on an FX pair the scenario tab rebuilt the forward as S·DF_base/DF_quote
// from today's discount factors, while the engine carries spot from the spot date, so the unshocked scenario showed a
// forward and an NPV that were not the ticket's (1.3 pips and 1,300 USD on ten million EURUSD at the fair forward, on the local stack's curves).
// The unshocked row of the scenario is the ticket's own forward and NPV, on a pair that has a spot lag.
test('FX forward: the scenario tab with no shock shows the forward and the NPV the ticket priced', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'FX', exact: true }).click()
  await win.getByRole('button', { name: /^FX FORWARD$/i }).click()
  const priced = app.waitForResponse(r => /\/api\/currency\/forward\/price$/.test(r.url()) && r.request().method() === 'POST' && r.ok())
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const quote = await (await priced).json()
  // parity is the mode in which the scenario is the engine's own arithmetic; on quoted points the tab says what differs
  expect(quote.forward_mode === 'MARKET' && quote.market_points != null, 'the stack prices this pair by parity, not on quoted points').toBe(false)
  expect(quote.t_spot, 'the answer names the spot lag the scenario carries from').toBeGreaterThan(0)
  // the case is worth running only if the two readings of the forward differ: the pair settles spot after today
  const fromToday = quote.spot * quote.df_base / quote.df_quote
  expect(Math.abs(fromToday - quote.forward) / quote.forward, 'the pair has a spot lag the old arithmetic would miss').toBeGreaterThan(1e-6)

  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await expect(win.getByTestId('fx-scenario-chart')).toBeVisible()
  const base = win.getByTestId('fx-scenario-base')
  await expect(base).toBeVisible()
  await expect(win.getByTestId('fx-scenario-quoted-note')).toHaveCount(0)
  const forward = Number(await base.getAttribute('data-forward'))
  const npv = Number(await base.getAttribute('data-npv'))
  expect(Math.abs(forward - quote.forward) / quote.forward, 'the unshocked forward is the engine\'s').toBeLessThan(1e-12)
  expect(Math.abs(npv - quote.npv), 'the unshocked NPV is the engine\'s, to a cent').toBeLessThan(0.01)
  await app.screenshot({ path: 'e2e/.out/shots/fx-forward-scenario-base.png' })
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
  await app.getByText('Spot & BTC rate', { exact: true }).click()
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

  await win.getByTestId('fx-scn-curve-vol').click()                           // the surface is one of the curves that price the option
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
  const slider = win.getByTestId('fx-scn-flat')                               // the selected curve's flat shock: here, vol points
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

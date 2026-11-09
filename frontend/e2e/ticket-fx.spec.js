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
  await expect(win).toContainText('overrides the quoted forward')
  await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click()
  await expect(win).toContainText(`VOL % · ${AT}`, { ignoreCase: true })
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
  await expect(app.locator('.crv-item', { hasText: 'BTCUSD' })).toContainText('Deribit 9 Nov 12:57 UTC · 2 tenors')
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

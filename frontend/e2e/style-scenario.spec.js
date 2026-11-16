// An option of any style has the scenario tab every other trade has: the same curves, shocked flat, point by point
// or on the chart, the same table and one ladder. A style the browser has no closed form for (American, digital,
// barrier, double barrier, touch) is priced by the engine at the scenario's market, so with nothing shocked the
// figure is the ticket's own, a 1 % spot shock is the ticket's own spot delta and a vol point its own vega; a spot
// carried through a barrier is valued as touched and the tab says so; and the settlement cell follows the
// settlement rule for the style (a barrier or a touch: what it pays if its level never traded, and if it did).
import { test, expect, expectClean, expectNoHorizontalOverflow } from './fixtures.js'

const num = async (loc, attr = 'data-value') => Number(await loc.getAttribute(attr))
const STYLES = ['AMERICAN', 'DIGITAL', 'BARRIER', 'DOUBLE BARRIER', 'TOUCH']
const PATH = ['BARRIER', 'DOUBLE BARRIER', 'TOUCH']                 // a level that can trade on the way

for (const [name, asset, product] of [['a crypto option', 'CRYPTO', /^CRYPTO OPTION$/i], ['an FX option', 'FX', /^FX OPTION$/i]]) {
  test(`${name}: every style is shocked like a European and priced by the engine`, async ({ app, problems }) => {
    test.setTimeout(180_000)
    await app.goto('/blotter')
    await app.getByText('+ NEW TRADE').first().click()
    const win = app.locator('.tbw-window')
    await win.waitFor()
    await win.getByRole('button', { name: asset, exact: true }).click()
    await win.getByRole('button', { name: product }).click()
    const tab = win.getByTestId('fx-scn-tab')
    const settled = () => expect(tab, 'the engine has answered the scenario on screen').toHaveAttribute('data-busy', 'false')
    const change = win.getByTestId('fx-scenario-change'), npv = win.getByTestId('fx-scenario-npv')
    const flat = win.getByTestId('fx-scn-flat-value')
    const shock = async (curve, text) => { await win.getByTestId(`fx-scn-curve-${curve}`).click(); await flat.fill(text); await flat.blur() }

    for (const style of STYLES) {
      await win.getByRole('button', { name: /^TRADE$/ }).click()
      const priced = app.waitForResponse(r => /\/api\/currency\/option\/price$/.test(r.url()) && r.request().postDataJSON()?.style === style.replace(' ', '_') && r.ok())
      await win.locator('.tbw-chip', { hasText: new RegExp(`^${style}$`) }).click()
      const first = await (await priced).json()
      await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
      await expect(win.getByTestId('fx-scn-engine')).toHaveText('ENGINE PRICED')
      await settled()
      await win.evaluate(el => { el.scrollTop = 0 })

      // the same curves as a European option, each one selectable; the old spot-by-vol grid is gone
      for (const c of ['spot', 'fwd', 'quote', ...(asset === 'FX' ? ['base'] : []), 'vol']) await expect(win.getByTestId(`fx-scn-curve-${c}`), `${style}: ${c} is a curve of this trade`).toBeVisible()
      await expect(win.getByTestId('fx-ladder')).toHaveCount(0)

      // nothing shocked: the engine's figure at the scenario's market is the ticket's own price
      // (the tab is held to its own quote: a ticket may have priced itself again since the answer above was read)
      const market = await num(npv)
      expect(Number.isFinite(market) && market !== 0, `${style} has a value`).toBe(true)
      expect(Math.abs(await num(change)), `${style}: no shock, no change`).toBeLessThan(1e-6 * Math.max(1, Math.abs(market)))
      expect(Math.abs(market / first.npv - 1), `${style}: the figure is the ticket's price, or a later price's of the same ticket`).toBeLessThan(0.05)

      // +1 % of spot: the ticket's own spot delta is that revaluation (the forward moves with spot, the carry held)
      const q = first
      await shock('spot', '1'); await settled()
      const dSpot = await num(change)
      if (Math.abs(q.spot01) > 1) { expect(dSpot / q.spot01, `${style}: +1 % of spot is the ticket's spot delta`).toBeGreaterThan(0.9); expect(dSpot / q.spot01).toBeLessThan(1.1) }
      await win.getByTestId('fx-scn-reset-curve').click(); await settled()

      // +1 vol point, flat: the ticket's own vega. Then a tenor of the surface alone: the option sees it at its expiry
      await shock('vol', '1'); await settled()
      const dVol = await num(change)
      if (Math.abs(q.vega) > 1) { expect(dVol / q.vega, `${style}: one vol point is the ticket's vega`).toBeGreaterThan(0.9); expect(dVol / q.vega).toBeLessThan(1.1) }
      await win.getByTestId('fx-scn-reset-curve').click()
      const rows = win.getByTestId('fx-scn-points').locator('tbody tr')
      expect(await rows.count(), `${style}: the surface's tenors are listed point by point`).toBeGreaterThan(2)
      const tenors = await rows.locator('input[data-point]').evaluateAll(els => els.map(e => e.getAttribute('data-point')))
      for (const t of tenors) { const box = win.locator(`input[data-point="${t}"]`); await box.fill('1'); await box.blur() }
      await settled()
      if (Math.abs(q.vega) > 1) expect((await num(change)) / dVol, `${style}: a point on every tenor is the flat point`).toBeCloseTo(1, 6)
      await win.getByTestId('fx-scn-reset-curve').click(); await settled()

      // a rate shock reaches it too: the quote curve up 25 bp moves the value
      await shock('quote', '25'); await settled()
      expect(Number.isFinite(await num(change)), `${style}: the quote curve's shock is priced`).toBe(true)
      await expect(win.getByTestId('fx-scn-change').locator('div').nth(0)).toContainText('CHANGE IN NPV')
      await win.getByTestId('fx-scenario-reset').click(); await settled()

      // one ladder, for the selected curve, on top of the scenario: its middle column is the scenario
      await win.getByTestId('fx-scn-curve-spot').click(); await settled()
      const ladder = win.getByTestId('fx-scn-ladder')
      expect(await num(ladder.getByTestId('fx-scenario-base'), 'data-npv')).toBeCloseTo(await num(npv), 6)
      for (const x of ['-10', '-1', '1', '10']) expect(Number.isFinite(await num(ladder.locator(`[data-ladder="${x}"]`), 'data-npv')), `${style}: the ladder's ${x} % column is priced`).toBe(true)

      // a spot carried through a level: valued as touched, and the tab says so
      if (PATH.includes(style)) {
        let seen = false
        for (const far of ['50', '-50']) {
          await shock('spot', far); await settled()
          if (await win.getByTestId('fx-scn-touched').isVisible()) { seen = true; break }
        }
        expect(seen, `${style}: a 50 % move of spot, one way or the other, touches its level`).toBe(true)
        expect(Number.isFinite(await num(npv)), `${style}: a touched option still has a value`).toBe(true)
        await expect(win.getByTestId('fx-scn-ladder-touched').locator('[data-touched="true"]').first()).toBeVisible()
        await win.screenshot({ path: `e2e/.out/shots/style-${asset.toLowerCase()}-${style.toLowerCase().replace(' ', '-')}-touched.png` })
        await win.getByTestId('fx-scenario-reset').click(); await settled()
        await expect(win.getByTestId('fx-scn-touched')).toHaveCount(0)
      }

      // what it settles: by the fixing alone, or, with a level that can trade on the way, both amounts
      const path = win.getByTestId('fx-scenario-settlement-path')
      if (PATH.includes(style)) {
        await expect(path).toBeVisible()
        if ((await path.getAttribute('data-certain')) === 'false') expect(Number.isFinite(await num(win.getByTestId('fx-scenario-settlement-touched')))).toBe(true)
      } else await expect(path).toHaveCount(0)
      expect(Number.isFinite(await num(win.getByTestId('fx-scenario-settlement'))), `${style}: the settlement at the scenario's fixing is an amount`).toBe(true)

      await win.evaluate(el => { el.scrollTop = 0 })
      await win.getByTestId('fx-scn-curve-vol').click(); await settled()
      await expectNoHorizontalOverflow(win, `${name}, ${style}: the scenario tab`)
      await win.screenshot({ path: `e2e/.out/shots/style-${asset.toLowerCase()}-${style.toLowerCase().replace(' ', '-')}.png` })
    }
    expectClean(problems)
  })
}

test('a scenario the engine cannot price says so, and shows no figure in its place', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
  await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click()
  await app.route('**/api/currency/option/scenario', route => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'an up barrier must be above spot' }) }))
  await win.locator('.tbw-chip', { hasText: /^BARRIER$/ }).click()
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await expect(win.getByTestId('fx-scn-error')).toContainText('an up barrier must be above spot')
  await expect(win.getByTestId('fx-scenario-npv')).toHaveText('—')
  await expect(win.getByTestId('fx-scenario-change')).toHaveText('—')
  await expect(win.getByTestId('fx-scn-tab')).toHaveAttribute('data-busy', 'false')
  expectClean(problems.filter(p => !/422/.test(String(p))))
})

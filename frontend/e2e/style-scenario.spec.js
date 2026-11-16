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
        await win.screenshot({ path: `e2e/.out/shots/style-${asset.toLowerCase()}-${style.toLowerCase().replace(' ', '-')}-touched.png` })
        // the ladder says which of its columns stand at or beyond the level (pictured with the ladder in view)
        const mark = win.getByTestId('fx-scn-ladder-touched')
        await mark.evaluate(el => el.scrollIntoView({ block: 'center' }))          // clear of the ticket's sticky footer
        await expect(mark.locator('[data-touched="true"]').first()).toBeVisible()
        await win.screenshot({ path: `e2e/.out/shots/style-${asset.toLowerCase()}-${style.toLowerCase().replace(' ', '-')}-touched-ladder.png` })
        await win.evaluate(el => { el.scrollTop = 0 })
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

// A forward and a European option had the browser's closed form alone and an amber APPROXIMATION; they are asked of
// the engine like every other style, and the closed form stands in for a figure only while the answer is on its way.
for (const [name, product, route, priceRoute] of [
  ['an FX forward', /^FX FORWARD$/i, 'forward/scenario', 'forward/price'],
  ['a European FX option', /^FX OPTION$/i, 'option/scenario', 'option/price'],
]) {
  test(`${name} under a scenario: priced by the engine, the unshocked figure the ticket's own, and a figure there while the answer is awaited`, async ({ app, problems }) => {
    await app.goto('/blotter')
    await app.getByText('+ NEW TRADE').first().click()
    const win = app.locator('.tbw-window')
    await win.waitFor()
    await win.getByRole('button', { name: 'FX', exact: true }).click()
    const priced = app.waitForResponse(r => new RegExp(`/api/currency/${priceRoute}$`).test(r.url()) && r.request().method() === 'POST' && r.ok(), { timeout: 60_000 })
    await win.getByRole('button', { name: product }).click()
    const quote = await (await priced).json()
    const first = app.waitForResponse(r => r.url().endsWith(`/api/currency/${route}`) && r.ok(), { timeout: 60_000 })
    await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
    const tab = win.getByTestId('fx-scn-tab'), npv = win.getByTestId('fx-scenario-npv'), change = win.getByTestId('fx-scenario-change')
    const asked = await first
    await expect(tab).toHaveAttribute('data-busy', 'false')
    await expect(win.getByTestId('fx-scn-engine')).toHaveText('ENGINE PRICED')
    await expect(win.getByTestId('fx-scenario-banner')).toContainText(/the engine prices the (trade|option) there/)
    await expect(win).not.toContainText('APPROXIMATION')
    // with no shock the engine's figure is the ticket's own: the same number, not one near it
    const body = asked.request().postDataJSON(), values = (await asked.json()).values
    expect(body.states.length).toBeGreaterThan(0)
    // (a forward's to the last digit; an option's vol goes over as vol points and comes back divided by 100, which
    // can move its last digit: a part in 10^15 of the vol)
    expect(values.some(v => (route.startsWith('forward') ? v.npv === quote.npv : Math.abs(v.npv - quote.npv) < 1e-6)), 'the engine\'s value at the ticket\'s own market is the ticket\'s NPV').toBe(true)
    expect(await num(npv)).toBeCloseTo(quote.npv, 2)

    // a shock while the engine is held back: the figure moves at once (the closed form), the chip says the engine is asked
    let release
    const gate = new Promise(r => { release = r })
    // (choosing the curve asks for its ladder, and the shock then asks again: every answer on the route is kept, the
    // one a request was dropped for among them)
    const engine = []
    const keep = async (r) => { if (r.url().endsWith(`/api/currency/${route}`) && r.ok()) { try { engine.push(...(await r.json()).values.map(v => v.npv)) } catch { /* a request the tab dropped */ } } }
    app.on('response', keep)
    await app.route(`**/api/currency/${route}`, async r => { await gate; await r.continue().catch(() => {}) })
    await win.getByTestId('fx-scn-curve-spot').click()
    const flat = win.getByTestId('fx-scn-flat-value'); await flat.fill('2'); await flat.blur()
    await expect(win.getByTestId('fx-scn-engine')).toHaveText('REPRICING…')
    await expect(npv, 'a figure is on screen before the answer').not.toHaveText('—')
    const soon = { npv: await num(npv), change: await num(change) }
    expect(soon.change).not.toBe(0)
    expect(engine.length, 'nothing has been answered yet').toBe(0)
    release()
    await expect(tab).toHaveAttribute('data-busy', 'false')
    await expect(win.getByTestId('fx-scn-engine')).toHaveText('ENGINE PRICED')
    const after = await num(npv)
    await expect.poll(() => engine.some(v => Math.abs(v - after) < 0.005), { message: 'the figure on screen is one the engine answered' }).toBe(true)
    expect(Math.abs(after - soon.npv), 'and the closed form had it to far less than a cent').toBeLessThan(0.001)
    app.off('response', keep)
    await app.unroute(`**/api/currency/${route}`)
    expectClean(problems)
  })
}

test('terms changed under a scenario: no figure of the earlier trade stands beside the new one', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
  await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click()
  await win.locator('.tbw-chip', { hasText: /^AMERICAN$/ }).click()
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  const tab = win.getByTestId('fx-scn-tab'), npv = win.getByTestId('fx-scenario-npv'), change = win.getByTestId('fx-scenario-change')
  await expect(win.getByTestId('fx-scn-engine')).toHaveText('ENGINE PRICED')
  await win.getByTestId('fx-scn-curve-spot').click()
  const flat = win.getByTestId('fx-scn-flat-value'); await flat.fill('5'); await flat.blur()
  await expect(tab).toHaveAttribute('data-busy', 'false')
  const before = { npv: await num(npv), change: await num(change) }
  expect(before.change).not.toBe(0)
  // the engine is held back, then the option is turned from a call into a put: another trade under the same scenario
  let release
  const gate = new Promise(r => { release = r })
  await app.route('**/api/currency/option/scenario', async route => { await gate; await route.continue() })
  await win.getByRole('button', { name: /^TRADE$/ }).click()
  const repriced = app.waitForResponse(r => /\/api\/currency\/option\/price$/.test(r.url()) && r.request().postDataJSON()?.option_type === 'PUT' && r.ok())
  await win.getByRole('button', { name: 'PUT', exact: true }).click()
  await repriced
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await expect(win.getByTestId('fx-scn-engine')).toHaveText('REPRICING…')
  await expect(npv, 'while the put is being priced its scenario value is a dash, not the call\'s').toHaveText('—')
  await expect(change).toHaveText('—')
  release()
  await expect(tab).toHaveAttribute('data-busy', 'false')
  const after = { npv: await num(npv), change: await num(change) }
  expect(Number.isFinite(after.npv)).toBe(true)
  expect(Math.sign(after.change), 'spot up 5 %: a bought call gains and a bought put loses').toBe(-Math.sign(before.change))
  expectClean(problems)
})

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
  await expect(win.getByTestId('fx-scn-engine'), 'the chip does not say the engine priced it').toHaveText('NOT PRICED')
  await expect(win.getByTestId('fx-scenario-npv')).toHaveText('—')
  await expect(win.getByTestId('fx-scenario-change')).toHaveText('—')
  await expect(win.getByTestId('fx-scn-tab')).toHaveAttribute('data-busy', 'false')
  expectClean(problems.filter(p => !/422/.test(String(p))))
})

test('a forward the engine does not answer for: the closed form\'s figures, and a chip that says so', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'FX', exact: true }).click()
  await app.route('**/api/currency/forward/scenario', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'the engine is not there' }) }))
  const priced = app.waitForResponse(r => /\/api\/currency\/forward\/price$/.test(r.url()) && r.request().method() === 'POST' && r.ok(), { timeout: 60_000 })
  await win.getByRole('button', { name: /^FX FORWARD$/i }).click()
  const quote = await (await priced).json()
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await expect(win.getByTestId('fx-scn-error')).toContainText('the engine is not there')
  await expect(win.getByTestId('fx-scn-error')).toContainText('closed form')
  await expect(win.getByTestId('fx-scn-engine')).toHaveText('APPROXIMATION')
  await expect(win.getByTestId('fx-scn-tab')).toHaveAttribute('data-busy', 'false')
  expect(await num(win.getByTestId('fx-scenario-npv')), 'the closed form at the ticket\'s own market').toBeCloseTo(quote.npv, 4)
  expectClean(problems.filter(p => !/503/.test(String(p))))
})


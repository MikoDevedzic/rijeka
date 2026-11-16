// Volatility is moved as a curve is, on every option: flat, tenor by tenor, or by dragging a tenor on the term
// structure, which is the one chart a rate curve and a rates vol are drawn with (ScenarioCurve.jsx). On a currency or
// digital-asset option the surface's tenors are the points; the option sees the shock at its own expiry.
import { test, expect, expectClean, expectNoHorizontalOverflow } from './fixtures.js'

const num = async (loc, attr) => Number(await loc.getAttribute(attr))

for (const [name, asset, product] of [['a crypto option', 'CRYPTO', /^CRYPTO OPTION$/i], ['an FX option', 'FX', /^FX OPTION$/i]]) {
  test(`${name}: a tenor of its vol surface is typed and dragged, and the option is repriced at the shock at its expiry`, async ({ app, problems }) => {
    await app.goto('/blotter')
    await app.getByText('+ NEW TRADE').first().click()
    const win = app.locator('.tbw-window')
    await win.waitFor()
    await win.getByRole('button', { name: asset, exact: true }).click()
    await win.getByRole('button', { name: product }).click()
    const priced = app.waitForResponse(r => /\/api\/currency\/option\/price$/.test(r.url()) && r.request().method() === 'POST' && r.ok())
    await win.getByRole('button', { name: '▶ PRICE' }).click()
    const quote = await (await priced).json()
    await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
    await win.getByTestId('fx-scn-curve-vol').click()
    const says = win.getByTestId('fx-scn-says-vol'), strikeVol = win.getByTestId('fx-vol-strike-vol'), change = win.getByTestId('fx-scenario-change')
    await expect(says).toHaveText('—')
    // the vol the tab starts from is the one the ticket's price carries now (a ticket may have priced itself again since
    // the answer above was read: the tab is held to its own quote, the answer gives the size of a vega)
    await expect.poll(() => num(strikeVol, 'data-value')).toBeGreaterThan(0)
    const vol0 = await num(strikeVol, 'data-value')
    expect(Math.abs(vol0 - quote.vol_pct), 'the tab\'s vol is the price\'s, or a later price\'s of the same ticket').toBeLessThan(1)
    const curve = win.getByTestId('fx-vol-term-curve')
    await expect(curve).toBeVisible()
    const tenors = await curve.locator('circle[data-pillar]').evaluateAll(els => els.map(e => e.getAttribute('data-pillar')))
    expect(tenors.length, 'the surface\'s tenors are the points').toBeGreaterThan(2)
    // the tenors are listed point by point, each with the surface's at-the-money vol
    const rows = win.getByTestId('fx-scn-points').locator('tbody tr')
    await expect(rows).toHaveCount(tenors.length)

    // every tenor moved by two points: the option, wherever it expires, is repriced two points higher, as the flat shock would
    for (const t of tenors) { const box = win.locator(`input[data-point="${t}"]`); await box.fill('2'); await box.blur() }
    await expect(says).toHaveText(`${tenors.length} points`)
    await expect.poll(() => num(strikeVol, 'data-shocked')).toBeCloseTo(vol0 + 2, 6)
    const dAll = await num(change, 'data-value')
    expect(dAll / (quote.vega * 2), 'two vol points on every tenor move it by about two vegas').toBeGreaterThan(0.9)
    expect(dAll / (quote.vega * 2)).toBeLessThan(1.1)
    await win.getByTestId('fx-scn-reset-curve').click()
    await expect(says).toHaveText('—')
    await expect.poll(() => num(change, 'data-value')).toBeCloseTo(0, 6)

    // one tenor dragged up on the chart: it is the point that moved, the button says so, and the option moves by less
    // than the tenor did unless it expires on it
    await win.evaluate(el => { el.scrollTop = 0 })
    const dot = curve.locator('circle[data-pillar]').nth(Math.min(2, tenors.length - 1))
    const tenor = await dot.getAttribute('data-pillar')
    const box = await dot.boundingBox()
    await app.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await app.mouse.down(); await app.mouse.move(box.x + box.width / 2, box.y - 36, { steps: 6 }); await app.mouse.up()
    await expect(says).toHaveText('1 point')
    const moved = Number(await win.locator(`input[data-point="${tenor}"]`).inputValue())
    expect(moved, 'the dragged tenor went up, by quarter points').toBeGreaterThan(0)
    expect(Math.abs(moved * 4 - Math.round(moved * 4))).toBeLessThan(1e-9)
    const atExpiry = (await num(strikeVol, 'data-shocked')) - vol0
    expect(atExpiry).toBeGreaterThanOrEqual(0)
    expect(atExpiry).toBeLessThanOrEqual(moved + 1e-9)
    await expect(win.getByTestId('fx-vol-shock-note')).toContainText('tenor by tenor')
    // the flat shock on top of it
    const flat = win.getByTestId('fx-scn-flat-value'); await flat.fill('1'); await flat.blur()
    await expect(says).toHaveText('+1 pt · 1 point')
    await expect.poll(() => num(strikeVol, 'data-shocked')).toBeCloseTo(vol0 + 1 + atExpiry, 6)
    await expectNoHorizontalOverflow(win, `${name}: the scenario tab with a tenor of the surface moved`)
    await win.screenshot({ path: `e2e/.out/shots/scn-${name.replace(/\W+/g, '-')}-vol.png` })
    // RESET ALL
    await win.getByTestId('fx-scenario-reset').click()
    await expect(says).toHaveText('—')
    await expect.poll(() => num(strikeVol, 'data-shocked')).toBeCloseTo(vol0, 6)
    expectClean(problems)
  })
}

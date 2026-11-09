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

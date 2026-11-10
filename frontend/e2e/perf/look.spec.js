// One picture of every screen a new user meets, for a person to read after a change to the look: the home, the
// blotter, the ticket, the XVA tab after a run, the confirmation, the option ticket, and the pages behind the top
// bar. Not a journey and not a gate (it asserts nothing about the pictures): run it with the profile's config,
//   npx playwright test -c playwright.perf.config.js look.spec.js
// and read e2e/.out/look/*.png.
import { test, simulateWithComparison } from '../fixtures.js'

test.use({ viewport: { width: 1440, height: 900 } })
const SHOTS = 'e2e/.out/look'
const shot = (app, name) => app.screenshot({ path: `${SHOTS}/${name}.png` })

async function ticket(app, asset, product) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  if (asset) {
    await win.getByRole('button', { name: asset, exact: true }).click()
    await win.getByRole('button', { name: product }).click()
  }
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  return win
}

test('the pages behind the top bar', async ({ app }) => {
  for (const [name, path, wait] of [
    ['home', '/command-center', 1500], ['blotter', '/blotter', 800], ['pnl', '/pnl', 800], ['risk', '/risk', 800],
    ['risk-collateral', '/risk/collateral', 800], ['configurations-curves', '/configurations/market-data/curves', 1200],
    ['configurations-modules', '/configurations/modules', 800], ['counterparties', '/configurations/counterparties', 800],
    ['methodology', '/methodology', 800], ['roadmap', '/roadmap', 500],
  ]) {
    await app.goto(path)
    if (name === 'home') await app.getByText('USD SOFR', { exact: true }).first().waitFor({ timeout: 30_000 })
    await app.waitForTimeout(wait)
    await shot(app, name)
  }
})

test('the rates ticket: trade, details, cashflows, XVA, scenario, booked, confirmed', async ({ app }) => {
  test.setTimeout(300_000)
  const win = await ticket(app)
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await app.waitForResponse(r => r.url().endsWith('/price/preview') && r.request().method() === 'POST')
  await app.waitForTimeout(600)
  await shot(app, 'rates-trade')
  for (const [tab, name] of [['DETAILS', 'rates-details'], ['CASHFLOWS', 'rates-cashflows'], ['CURVE SCENARIO', 'rates-scenario']]) {
    await win.getByRole('button', { name: tab, exact: true }).click()
    await app.waitForTimeout(700)
    await shot(app, name)
  }
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  await app.waitForTimeout(400)
  await shot(app, 'rates-xva-before')
  await win.getByRole('button', { name: 'BILATERAL', exact: true }).click()
  await simulateWithComparison(app, win, '/api/xva/simulate')
  await app.waitForTimeout(900)
  await shot(app, 'rates-xva')
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  await win.getByRole('button', { name: '◆ CONFIRM' }).click()
  await app.waitForTimeout(800)
  await shot(app, 'rates-confirm-before')
  await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click()
  await win.getByText(/ANCHORED|CONFIRMED/).first().waitFor({ timeout: 120_000 })
  await app.waitForTimeout(800)
  await shot(app, 'rates-confirmed')
})

test('the digital-asset option ticket: trade and XVA', async ({ app }) => {
  test.setTimeout(300_000)
  const win = await ticket(app, 'CRYPTO', /^CRYPTO OPTION$/i)
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await app.waitForTimeout(2500)
  await shot(app, 'option-trade')
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  await win.getByRole('button', { name: 'BILATERAL', exact: true }).click()
  await simulateWithComparison(app, win, '/api/xva/currency-option').catch(() => {})
  await app.waitForTimeout(900)
  await shot(app, 'option-xva')
})

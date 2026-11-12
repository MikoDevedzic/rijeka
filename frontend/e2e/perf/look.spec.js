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
    ['counterparties', '/configurations/counterparties', 800],
    ['methodology', '/methodology', 800], ['roadmap', '/roadmap', 500],
  ]) {
    await app.goto(path)
    if (name === 'home') await app.getByText('USD SOFR', { exact: true }).first().waitFor({ timeout: 30_000 })
    await app.waitForTimeout(wait)
    await shot(app, name)
  }
})

// The pages behind CONFIGURATIONS a first user opens to see where a price comes from, and the messenger: read after a
// change to their type or colour. LOOK_TAG names the set (LOOK_TAG=before, then after), so two runs sit side by side.
test('configurations and the messenger', async ({ app }) => {
  const tag = process.env.LOOK_TAG ? `-${process.env.LOOK_TAG}` : ''
  for (const [name, path, wait] of [
    ['cfg-curves', '/configurations/market-data/curves', 1500], ['cfg-swvol', '/configurations/market-data/swvol', 1500],
    ['cfg-capfloor', '/configurations/market-data/capfloor', 1500], ['cfg-pairs', '/configurations/market-data/crypto', 1500],
    ['cfg-hw1f', '/configurations/xva-parameters/hw1f', 1200], ['cfg-counterparties', '/configurations/counterparties', 800],
    ['cfg-legal-entities', '/configurations/legal-entities', 800], ['cfg-collateral', '/configurations/collateral/instruments', 800],
    ['cfg-system', '/configurations/system', 1000],
  ]) {
    await app.goto(path)
    await app.waitForLoadState('networkidle').catch(() => {})
    await app.waitForTimeout(wait)
    await shot(app, `${name}${tag}`)
  }
  await app.goto('/blotter')
  await app.locator('.ms-launcher').click()
  await app.waitForTimeout(1200)
  await shot(app, `messenger${tag}`)
})

test('the rates ticket: trade, details, cashflows, XVA, scenario, booked, confirmed', async ({ app }) => {
  test.setTimeout(300_000)
  const win = await ticket(app, 'RATES', /^IR SWAP$/i)
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

for (const [slug, asset, product] of [['crypto-forward', 'CRYPTO', /^CRYPTO FORWARD$/i], ['crypto-option', 'CRYPTO', /^CRYPTO OPTION$/i], ['fx-forward', 'FX', /^FX FORWARD$/i]]) {
  test(`${slug}: every tab, the whole height of each`, async ({ app }) => {
    test.setTimeout(300_000)
    const win = await ticket(app, asset, product)
    await win.getByRole('button', { name: '▶ PRICE' }).click()
    await app.waitForTimeout(2500)
    // the ticket scrolls inside itself: one picture per screenful of the TRADE tab
    await shot(app, `${slug}-trade-1`)
    await win.evaluate(el => { el.scrollTop = el.scrollHeight })
    await app.waitForTimeout(300)
    await shot(app, `${slug}-trade-2`)
    for (const tab of ['DETAILS', 'CASHFLOWS', 'CURVE SCENARIO']) {
      await win.getByRole('button', { name: tab, exact: true }).click()
      await app.waitForTimeout(900)
      await shot(app, `${slug}-${tab.toLowerCase().replace(' ', '-')}`)
    }
    // the scenario tab: each curve selected in turn, with a shock on it
    await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
    for (const key of ['fwd', 'quote', 'base', 'vol']) {
      const c = win.getByTestId(`fx-scn-curve-${key}`)
      if (!(await c.count())) continue
      await c.click()
      const flat = win.getByTestId('fx-scn-flat')
      if (await flat.count()) { await flat.focus(); for (let i = 0; i < 5; i++) await app.keyboard.press('ArrowRight') }
      const first = win.locator('[data-testid="fx-scn-points"] input').nth(1)
      if (await first.count()) { await first.fill(key === 'fwd' ? '150' : '-20'); await first.blur() }
      await app.waitForTimeout(500)
      await shot(app, `${slug}-scenario-${key}`)
    }
    await win.getByTestId('fx-scenario-reset').click()
    // XVA with every input showing, after a run; then a note under the pointer, and the same tab with NOTES on
    await win.getByRole('button', { name: 'XVA', exact: true }).click()
    const inputs = win.getByRole('button', { name: /SHOW MODEL INPUTS/ })
    if (await inputs.count()) await inputs.click()
    await win.getByRole('button', { name: /SIMULATE/ }).click()
    await app.waitForTimeout(3500)
    await shot(app, `${slug}-xva`)
    await win.getByRole('button', { name: 'CASHFLOWS', exact: true }).click()
    await win.locator('.rj-note:visible').first().hover()
    await app.waitForTimeout(300)
    await shot(app, `${slug}-cashflows-note`)
    await win.getByTestId('notes-toggle').click()
    await app.waitForTimeout(300)
    await shot(app, `${slug}-cashflows-notes-on`)
    await win.getByTestId('notes-toggle').click()
  })
}

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

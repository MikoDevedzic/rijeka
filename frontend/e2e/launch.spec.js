// The launch view: what a new sign-up's workspace shows (the LAUNCH module preset), and that an existing firm is
// untouched by it. The stack's firm has every module on, so the launch firm is made by answering GET /api/modules
// the way the API does for a workspace provisioned on LAUNCH (backend: tests/integration/test_modules.py).
import { test, expect, expectClean, expectFullyInView, expectNoHorizontalOverflow, simulateWithComparison } from './fixtures.js'

const OFF = ['PNL', 'MARKET_RISK', 'COUNTERPARTY_CREDIT', 'CAPITAL', 'COLLATERAL', 'XVA_RESERVES', 'IPV']

async function onLaunch(app, { canEdit = true, alsoOn = [] } = {}) {
  await app.route(/\/api\/modules$/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch()
    const body = await res.json()
    for (const k of OFF) body.modules[k] = alsoOn.includes(k)
    // `view` is what makes a launch workspace, not the preset's name: with one module switched on the preset is CUSTOM
    Object.assign(body, { preset: alsoOn.length ? 'CUSTOM' : 'LAUNCH', view: 'launch', source: 'firm', can_edit: canEdit })
    await route.fulfill({ response: res, json: body })
  })
}

async function openTicket(app) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  const cp = win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first()
  await cp.selectOption({ label: 'RIJEKA DEMO BANK AG' })
  return win
}

test('launch workspace: the home is four next steps and the navigation is the narrow set', async ({ app, problems }) => {
  await onLaunch(app)
  await app.goto('/command-center')
  const home = app.getByTestId('launch-home')
  await expect(home).toBeVisible()
  await expect(home).toContainText('Book one trade and follow it through')
  for (const step of ['Book a trade', 'Price it', 'See the XVA charge and what settling on chain saves', 'Confirm it on chain']) await expect(home).toContainText(step)
  await expect(app.getByTestId('launch-more')).toHaveText('Switch on P&L, risk and more')
  // nothing of the dashboard a new desk does not need yet
  for (const gone of ['USD SOFR', 'ATM VOL', 'YOUR BOOK']) await expect(app.getByText(gone, { exact: true })).toHaveCount(0)
  for (const gone of ['RISK', 'P&L']) await expect(app.getByRole('button', { name: gone, exact: true })).toHaveCount(0)
  await expectNoHorizontalOverflow(home, 'launch home')
  await expectFullyInView(app.getByTestId('launch-book'), 'the one button the home is about')
  await app.screenshot({ path: 'e2e/.out/shots/launch-home.png' })

  // the button goes to the blotter, where the bar is the narrow set too
  await app.getByTestId('launch-book').click()
  await expect(app).toHaveURL(/\/blotter/)
  await expect(app.getByRole('button', { name: 'BLOTTER', exact: true })).toBeVisible()
  for (const gone of ['RISK', 'P&L']) await expect(app.getByRole('button', { name: gone, exact: true })).toHaveCount(0)
  // a page whose module is off sends a direct visit home
  for (const path of ['/risk', '/pnl']) {
    await app.goto(path)
    await expect(app, `${path} is off on the launch set`).toHaveURL(/\/command-center/)
  }
  // Configurations: the module's items are gone, the roadmap placeholders too, and the switches are one click away
  await app.goto('/configurations/market-data/curves')
  await expect(app.getByText(/SOFR OIS/).first()).toBeVisible()
  for (const gone of ['IPV TOLERANCES', 'P&L CONVENTIONS', 'COLLATERAL INSTRUMENTS']) await expect(app.getByText(gone, { exact: true })).toHaveCount(0)
  await app.goto('/configurations/modules')
  await expect(app.getByText('This workspace is on the launch view.', { exact: false })).toBeVisible()
  await expect(app.getByRole('button', { name: /Dealer/i }).first()).toBeVisible()
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

test('launch workspace: one module switched on keeps the simple home; a member who cannot switch is told who can', async ({ app, problems }) => {
  await onLaunch(app, { canEdit: false, alsoOn: ['PNL'] })
  await app.goto('/command-center')
  await expect(app.getByTestId('launch-home')).toBeVisible()                    // still the launch home, not the dashboard
  await expect(app.getByRole('button', { name: 'P&L', exact: true }).first()).toBeVisible()      // and the page it switched on is in the bar
  await expect(app.getByRole('button', { name: 'RISK', exact: true })).toHaveCount(0)
  await expect(app.getByTestId('launch-more')).toHaveText("More modules can be switched on by your firm's admin")
  await expect(app.getByTestId('launch-more')).not.toHaveAttribute('href', /.*/)
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

test('launch workspace: the ticket has no CAPITAL tab and XVA opens simple, with the same run behind it', async ({ app, problems }) => {
  await onLaunch(app)
  const win = await openTicket(app)
  const priced = app.waitForResponse(r => r.url().endsWith('/price/preview') && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  expect((await priced).status()).toBe(200)
  await expect(win.getByRole('button', { name: 'CAPITAL', exact: true })).toHaveCount(0)
  await win.getByRole('button', { name: 'XVA', exact: true }).click()

  // simple: settlement and collateral, SIMULATE, what the run assumes; no model inputs
  const toggle = win.getByTestId('xva-view-toggle')
  await expect(toggle).toHaveText('SHOW MODEL INPUTS')
  await expect(win.getByTestId('xva-advanced')).toHaveCount(0)
  await expect(win.getByTestId('xva-run-assumes')).toContainText('2,000 paths')
  await expect(win.getByText('Counterparty', { exact: true })).toBeVisible()
  await expect(win).toContainText('RIJEKA DEMO BANK AG')
  await expect(win.getByLabel('VM posted in')).toHaveCount(0)            // NO CSA to start with: nothing is posted
  await win.getByRole('button', { name: 'BILATERAL', exact: true }).click()
  await expect(win.getByLabel('VM posted in')).toBeVisible()
  const simple = await simulateWithComparison(app, win, '/api/xva/simulate')
  await expect(win.getByTestId('va-strip')).toContainText('CVA')
  await expect(win.getByTestId('saving-on-chain')).toContainText('SAVING ON CHAIN')
  await expectFullyInView(win.getByTestId('xva-outputs'), 'XVA results in the simple view')
  await expectNoHorizontalOverflow(win.getByTestId('xva-left'), 'XVA left column, simple view')
  await app.screenshot({ path: 'e2e/.out/shots/launch-xva-simple.png' })

  // the model inputs are one click away, and the run they sit behind is the same run
  await toggle.click()
  await expect(toggle).toHaveText('HIDE MODEL INPUTS')
  await expect(win.getByTestId('xva-advanced')).toBeVisible()
  await expect(win.getByTestId('xva-run-assumes')).toHaveCount(0)
  const advanced = await simulateWithComparison(app, win, '/api/xva/simulate')
  expect(advanced.request, 'the request is the same in both views').toEqual(simple.request)
  expect(advanced.run.xva, 'and so is the answer').toEqual(simple.run.xva)
  await expectFullyInView(win.getByTestId('xva-outputs'), 'XVA results in the advanced view')
  // the choice is remembered on this machine
  expect(await app.evaluate(() => window.localStorage.getItem('rijeka.xva.view'))).toBe('advanced')
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

// Capital is not part of the demo (9 November 2026): where sign-ins get a sandbox, the API answers everyone but
// the admin role with it off, marked on request, and off in every preset (backend: tests/integration/test_modules.py).
// The stack runs with provisioning off, where nothing is held back, so that answer is given here the way onLaunch
// gives LAUNCH. `shape` is the rest of the firm's state: the preset it chose, or nothing chosen at all.
test('demo: capital is on request; no CAPITAL tab, no Risk → CAPITAL, and KVA stays on the XVA tab', async ({ app, problems }) => {
  let shape = { source: 'firm', preset: 'FUND' }
  await app.route(/\/api\/modules$/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch()
    const body = await res.json()
    for (const k of Object.keys(body.modules)) body.modules[k] = k !== 'CAPITAL'
    for (const p of Object.values(body.presets)) p.modules.CAPITAL = false
    body.presets.DEALER.desc = 'everything on (capital on request)'
    body.definitions = body.definitions.map(d => d.key === 'CAPITAL' ? { ...d, on_request: true } : d)
    Object.assign(body, { on_request: ['CAPITAL'], contact: 'miko@rijeka.app', can_edit: true, view: 'full', ...shape })
    await route.fulfill({ response: res, json: body })
  })
  // Configurations → Modules: shown, not switchable, with the address to write to; every other module still switches
  await app.goto('/configurations/modules')
  const row = app.getByTestId('module-on-request-CAPITAL')
  await expect(row).toContainText('CAPITAL · on request')
  await expect(row).toContainText('Not part of this demo. To see it, write to miko@rijeka.app.')
  // without capital Dealer, Fund and Classroom are the same switches: the one the firm chose is the one lit
  const preset = name => app.getByRole('button', { name, exact: true })
  const colour = name => preset(name).evaluate(el => getComputedStyle(el).color)
  await expect(app.getByText('PRESET FUND', { exact: true })).toBeVisible()
  expect(await colour('FUND'), 'the chosen preset is lit').not.toBe(await colour('LAUNCH'))
  expect(await colour('DEALER'), 'a preset that merely has the same switches is not').toBe(await colour('LAUNCH'))
  await expect(preset('DEALER')).toHaveAttribute('title', 'everything on (capital on request)')
  await expect(row.getByRole('link', { name: 'miko@rijeka.app' })).toHaveAttribute('href', 'mailto:miko@rijeka.app')
  await expect(row.getByRole('checkbox')).toHaveCount(0)
  await expect(app.getByRole('checkbox', { name: 'Capital on' })).toHaveCount(0)
  await expect(app.getByRole('checkbox', { name: 'Collateral on' })).toBeEnabled()
  await expectNoHorizontalOverflow(row, 'the on-request row')
  await app.screenshot({ path: 'e2e/.out/shots/modules-capital-on-request.png' })
  // a workspace that has chosen nothing (made before the launch preset): the page does not say "everything on"
  shape = { source: 'default', preset: null, events: [] }
  await app.reload()
  await expect(app.getByText('DEFAULT · NOTHING CHOSEN', { exact: true })).toBeVisible()
  await expect(app.getByText('No changes yet.', { exact: true })).toBeVisible()
  await expect(app.getByText(/EVERYTHING ON|every module is on/)).toHaveCount(0)
  await expect(app.getByTestId('module-on-request-CAPITAL')).toBeVisible()
  // Risk: the other sections are there, CAPITAL is not, and its address goes home
  await app.goto('/risk')
  const sections = app.getByRole('navigation', { name: 'Risk sections' })
  await expect(sections.getByRole('link', { name: 'COLLATERAL', exact: true })).toBeVisible()
  await expect(sections.getByRole('link', { name: 'CAPITAL', exact: true })).toHaveCount(0)
  await app.goto('/risk/capital')
  await expect(app, 'Risk → CAPITAL is off').toHaveURL(/\/command-center/)
  // the roadmap says so instead of promising the tab
  await app.goto('/roadmap')
  await expect(app.getByText('(not part of this demo: available on request, write to miko@rijeka.app)', { exact: false })).toHaveCount(2)
  // the ticket: no CAPITAL tab beside XVA; KVA is an XVA charge and stays
  const win = await openTicket(app)
  const priced = app.waitForResponse(r => r.url().endsWith('/price/preview') && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  expect((await priced).status()).toBe(200)
  await expect(win.getByRole('button', { name: 'CAPITAL', exact: true })).toHaveCount(0)
  for (const tab of ['TRADE', 'DETAILS', 'CASHFLOWS', 'XVA', 'CURVE SCENARIO', '◆ CONFIRM']) await expect(win.getByRole('button', { name: tab, exact: true })).toBeVisible()
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  await win.getByRole('button', { name: 'BILATERAL', exact: true }).click()
  const { run } = await simulateWithComparison(app, win, '/api/xva/simulate')
  expect(run.xva.kva, 'KVA is computed').toBeLessThan(0)
  await expect(win.getByTestId('va-strip')).toContainText('KVA')
  await app.screenshot({ path: 'e2e/.out/shots/ticket-capital-on-request.png' })
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

test('an existing firm is untouched: the dashboard, every tab, and the XVA tab as it was', async ({ app, problems }) => {
  await app.goto('/command-center')
  await expect(app.getByTestId('launch-home')).toHaveCount(0)
  await expect(app.getByText('USD SOFR', { exact: true })).toBeVisible()
  await expect(app.getByRole('button', { name: 'RISK', exact: true }).first()).toBeVisible()
  const win = await openTicket(app)
  await expect(win.getByRole('button', { name: 'CAPITAL', exact: true })).toBeVisible()
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  await expect(win.getByTestId('xva-view-toggle')).toHaveText('HIDE MODEL INPUTS')
  await expect(win.getByTestId('xva-advanced')).toBeVisible()
  expectClean(problems)
})

// The owner's way back to the venue's forwards on a pair where the account saved its own points (production,
// 9 November 2026). Nothing is deleted: the pair is handed back and the saved points stay in the history. The
// hand-back itself is answered here; it is tested on the database in backend/tests/integration/test_crypto_marks.py.
test('market data: saved forward points on a digital-asset pair can be handed back to the feed, in two steps', async ({ app, problems }) => {
  let pairs = null
  let handed = false
  const own = { valuation_date: '2026-10-28', source: 'MANUAL', label: 'MANUAL points 2026-10-28', tenors: ['1M', '3M'], in_use: true }
  const feed = { valuation_date: '2026-11-09', source: 'DEMO · handed back to the feed', label: 'DEMO · handed back to the feed points 2026-11-09', tenors: ['1M', '3M'], in_use: true }
  await app.route(/\/api\/currency\/pairs(\?.*)?$/, async route => {
    const res = await route.fetch()
    const body = await res.json()
    for (const p of body.pairs) {
      if (p.pair !== 'BTCUSD') continue
      p.forward_curve = handed ? feed : own
      p.forward_points = { '1M': 300, '3M': 900 }
    }
    pairs = body.pairs
    await route.fulfill({ response: res, json: body })
  })
  let sent = null
  await app.route(/\/api\/currency\/forward-curve\/use-feed$/, async route => {
    sent = route.request().postDataJSON()
    handed = true
    await route.fulfill({ json: { ...pairs.find(p => p.pair === 'BTCUSD'), forward_curve: feed, handed_back: true, accounts: 4 } })
  })
  await app.goto('/configurations/market-data/crypto')
  await app.locator('.crv-item', { hasText: 'BTCUSD' }).click()
  // the source is a word in the list and in the table, never the whole label (it wrapped and stretched every row)
  await expect(app.locator('.crv-item', { hasText: 'BTCUSD' })).toContainText('MANUAL · 2 tenors')
  const table = app.getByTestId('fwd-table')
  await expect(table.getByText('MANUAL', { exact: true }).first()).toBeVisible()
  const oneLine = async (label) => expect((await table.getByText(label, { exact: true }).first().boundingBox()).height, `${label} is one line in its cell`).toBeLessThan(26)
  await oneLine('MANUAL')
  const box = app.getByTestId('use-feed')
  await expect(box).toContainText('BTCUSD prices on forward points saved in this account (MANUAL, 2026-10-28)')
  await box.getByRole('button', { name: "USE THE FEED'S FORWARDS", exact: true }).click()
  await expect(box).toContainText('Hand BTCUSD back to the feed? Your saved points stay in the history')
  expect(sent, 'nothing happens on the first click').toBeNull()
  await box.getByRole('button', { name: 'KEEP MINE', exact: true }).click()
  await expect(box.getByRole('button', { name: "USE THE FEED'S FORWARDS", exact: true })).toBeVisible()
  await box.getByRole('button', { name: "USE THE FEED'S FORWARDS", exact: true }).click()
  const reloaded = app.waitForResponse(r => /\/api\/currency\/pairs/.test(r.url()))
  await box.getByRole('button', { name: 'USE THE FEED', exact: true }).click()
  await expect(app.getByText(/BTCUSD is back on the feed/)).toBeVisible()
  expect(sent).toEqual({ pair: 'BTCUSD' })
  await reloaded
  await expect(app.getByTestId('use-feed')).toHaveCount(0)               // on the feed now: the offer is gone
  await expect(app.locator('.crv-item', { hasText: 'BTCUSD' })).toContainText('feed (pending) · 2 tenors')
  await expect(table.getByText('FEED', { exact: true }).first()).toBeVisible()
  await expect(table).not.toContainText('handed back')
  await oneLine('FEED')
  // every row is one line high: the header and nine tenors (a wrapped label made a row four lines)
  const rows = await table.locator('> div').evaluateAll(cells => [...new Set(cells.map(c => Math.round(c.getBoundingClientRect().top)))].length)
  expect(rows).toBe(10)
  expect((await table.boundingBox()).height / rows, 'the height of a row').toBeLessThan(40)
  await app.screenshot({ path: 'e2e/.out/shots/forward-points.png', fullPage: true })
  // on a wide screen the panel reads as a table with its chart and buttons, not columns spread across the monitor
  await app.setViewportSize({ width: 1920, height: 1000 })
  expect((await table.boundingBox()).width, 'the table on a wide screen').toBeLessThanOrEqual(1040)
  expect((await app.getByRole('button', { name: /SAVE TO DB/ }).first().boundingBox()).x, 'the save button stays with the table').toBeLessThan((await table.boundingBox()).x + 1040)
  await app.setViewportSize({ width: 1440, height: 900 })
  // an FX pair is never offered it
  await app.locator('.crv-item', { hasText: 'EURUSD' }).click()
  await expect(app.getByTestId('use-feed')).toHaveCount(0)
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

// The launch view: what a new sign-up's workspace shows (the LAUNCH module preset), and that an existing firm is
// untouched by it. The stack's firm has every module on, so the launch firm is made by answering GET /api/modules
// the way the API does for a workspace provisioned on LAUNCH (backend: tests/integration/test_modules.py).
import { test, expect, expectClean, expectFullyInView, expectNoHorizontalOverflow, simulateWithComparison } from './fixtures.js'

const OFF = ['PNL', 'MARKET_RISK', 'COUNTERPARTY_CREDIT', 'CAPITAL', 'COLLATERAL', 'XVA_RESERVES', 'IPV']

async function onLaunch(app, { canEdit = true } = {}) {
  await app.route(/\/api\/modules$/, async route => {
    if (route.request().method() !== 'GET') return route.fallback()
    const res = await route.fetch()
    const body = await res.json()
    for (const k of OFF) body.modules[k] = false
    Object.assign(body, { preset: 'LAUNCH', source: 'firm', can_edit: canEdit })
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
  await expect(app.getByTestId('launch-more')).toHaveText('Switch on P&L, risk, capital and more')
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
  for (const path of ['/risk', '/risk/capital', '/pnl', '/pnl/ipv']) {
    await app.goto(path)
    await expect(app, `${path} is off on the launch set`).toHaveURL(/\/command-center/)
  }
  // Configurations: the module's items are gone, the roadmap placeholders too, and the switches are one click away
  await app.goto('/configurations/market-data/curves')
  await expect(app.getByText(/SOFR OIS/).first()).toBeVisible()
  for (const gone of ['IPV TOLERANCES', 'P&L CONVENTIONS', 'COLLATERAL INSTRUMENTS']) await expect(app.getByText(gone, { exact: true })).toHaveCount(0)
  await app.goto('/configurations/modules')
  await expect(app.getByText('This workspace is on the launch set.', { exact: false })).toBeVisible()
  await expect(app.getByRole('button', { name: /Dealer/i }).first()).toBeVisible()
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

test('launch workspace: a member who cannot switch modules is told who can', async ({ app, problems }) => {
  await onLaunch(app, { canEdit: false })
  await app.goto('/command-center')
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
// 9 November 2026). The removal itself is answered here; it is tested on the database in
// backend/tests/integration/test_crypto_marks.py.
test('market data: saved forward points on a digital-asset pair can be given up for the feed, in two steps', async ({ app, problems }) => {
  let pairs = null
  let removed = false
  await app.route(/\/api\/currency\/pairs(\?.*)?$/, async route => {
    const res = await route.fetch()
    const body = await res.json()
    for (const p of body.pairs) {
      if (p.pair !== 'BTCUSD' || removed) continue
      p.forward_curve = { valuation_date: '2026-10-28', source: 'MANUAL', label: 'MANUAL points 2026-10-28', tenors: ['1M', '3M'], in_use: true }
      p.forward_points = { '1M': 300, '3M': 900 }
    }
    pairs = body.pairs
    await route.fulfill({ response: res, json: body })
  })
  let sent = null
  await app.route(/\/api\/currency\/forward-curve\/use-feed$/, async route => {
    sent = route.request().postDataJSON()
    removed = true
    await route.fulfill({ json: { ...pairs.find(p => p.pair === 'BTCUSD'), forward_curve: null, forward_points: null, removed: 1, removed_copies: 3 } })
  })
  await app.goto('/configurations/market-data/crypto')
  await app.locator('.crv-item', { hasText: 'BTCUSD' }).click()
  const box = app.getByTestId('use-feed')
  await expect(box).toContainText('BTCUSD prices on forward points saved in this account (MANUAL, 2026-10-28)')
  await box.getByRole('button', { name: "USE THE FEED'S FORWARDS" }).click()
  await expect(box).toContainText('Remove the saved BTCUSD points? This cannot be undone.')
  expect(sent, 'nothing is removed on the first click').toBeNull()
  await box.getByRole('button', { name: 'KEEP THEM' }).click()
  await expect(box.getByRole('button', { name: "USE THE FEED'S FORWARDS" })).toBeVisible()
  await box.getByRole('button', { name: "USE THE FEED'S FORWARDS" }).click()
  const reloaded = app.waitForResponse(r => /\/api\/currency\/pairs/.test(r.url()))
  await box.getByRole('button', { name: 'REMOVE AND USE THE FEED' }).click()
  await expect(app.getByText(/BTCUSD: 1 saved curve removed/)).toBeVisible()
  expect(sent).toEqual({ pair: 'BTCUSD' })
  await reloaded
  await expect(app.getByTestId('use-feed')).toHaveCount(0)               // nothing saved any more: the offer is gone
  // a pair on the feed, or an FX pair, is never offered it
  await app.locator('.crv-item', { hasText: 'EURUSD' }).click()
  await expect(app.getByTestId('use-feed')).toHaveCount(0)
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

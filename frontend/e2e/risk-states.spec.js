// Unknown is not zero, and "no limit" is not "within limits". The Collateral tab reads its positions from the latest
// stored credit run; with none stored it showed $0 in every total while the Counterparty Credit tab, which had
// computed a run for the look and not kept it, showed the collateral held. And that tab said WITHIN LIMITS beside
// "LIMITS 0" (Marco, 15 November 2026). Each state is given to the page by changing the API's own answer.
import { test, expect, expectClean } from './fixtures.js'

const patch = (app, path, change) => app.route(path, async route => {
  if (route.request().method() !== 'GET') return route.continue()
  const res = await route.fetch(); const json = await res.json()
  await route.fulfill({ response: res, json: change(json) ?? json })
})
const csa = (r) => !['NO_CSA', 'NONE', ''].includes(String(r.csa_type || 'NO_CSA').toUpperCase())

test('the Collateral tab says a position is not known where no credit run is stored, and never $0', async ({ app, problems }) => {
  // no run stored for anyone
  await patch(app, '**/api/collateral/book*', (b) => {
    for (const r of b.counterparties) Object.assign(r, { has_run: false, vm_held_usd: 0, vm_posted_usd: 0, im_usd: 0, carry_per_year_usd: 0, posted: [], held: [], note: 'no stored credit run for this counterparty: positions unknown until Risk → Counterparty credit runs' })
    Object.assign(b.totals, { vm_held_usd: 0, vm_posted_usd: 0, im_usd: 0, carry_per_year_usd: 0, on_chain_share: null }); b.date = null
    if (!b.counterparties.some(csa)) b.counterparties[0].csa_type = 'VM_IM'
  })
  await app.goto('/risk/collateral')
  const cards = app.locator('.pnl-cards').first()
  await expect(app.getByTestId('col-unknown')).toHaveText('no credit run is stored: positions not known', { timeout: 30_000 })
  for (const label of ['VM HELD', 'VM POSTED', 'INITIAL MARGIN', 'CARRY PER YEAR']) {
    const card = cards.locator('.pnl-card', { hasText: label })
    await expect(card.locator('.pnl-card-b'), `${label} is a dash, not $0`).toHaveText('—')
    await expect(card.locator('.pnl-card-s')).toHaveText('not known: no credit run is stored')
  }
  await expect(cards).not.toContainText('$0')
  await cards.screenshot({ path: 'e2e/.out/shots/collateral-unknown.png' })
  // the way to make it known is one press away
  await app.getByRole('button', { name: 'RUN ONE →' }).click()
  await expect(app).toHaveURL(/\/risk\/ccr/)

  // one of the CSA counterparties has a run: a total, and how many it leaves out
  await app.unroute('**/api/collateral/book*')
  await patch(app, '**/api/collateral/book*', (b) => {
    while (b.counterparties.filter(csa).length < 2) b.counterparties.push({ ...b.counterparties.find(csa) || b.counterparties[0], counterparty_id: `x${b.counterparties.length}`, counterparty: 'SECOND BANK', csa_type: 'VM' })
    const [a, c] = b.counterparties.filter(csa)
    Object.assign(a, { has_run: true, vm_held_usd: 301078, vm_posted_usd: 0, im_usd: 0, note: null })
    Object.assign(c, { has_run: false, vm_held_usd: 0, vm_posted_usd: 0, im_usd: 0 })
    for (const r of b.counterparties.filter(csa).slice(2)) r.has_run = true
    Object.assign(b.totals, { vm_held_usd: 301078, vm_posted_usd: 0, im_usd: 0 })
  })
  await app.goto('/risk/collateral')
  const held = app.locator('.pnl-cards').first().locator('.pnl-card', { hasText: 'VM HELD' })
  await expect(held.locator('.pnl-card-b')).toHaveText(/301,078/, { timeout: 30_000 })
  await expect(held.locator('.pnl-card-s')).toContainText('1 counterparty not yet run')
  await expect(app.getByTestId('col-unknown')).toContainText(/^1 of \d+ with a CSA not yet run$/)
  await app.locator('.pnl-cards').first().screenshot({ path: 'e2e/.out/shots/collateral-partly-known.png' })
  expectClean(problems)
})

test('a page with no limit set says so, and says WITHIN LIMITS only where one was tested', async ({ app, problems }) => {
  await patch(app, '**/api/ccr/report*', (r) => { r.limits = []; r.breaches = 0; r.from_store = false })
  await app.goto('/risk/ccr')
  const chip = app.getByTestId('ccr-standing')
  await expect(chip).toHaveText('NO LIMITS SET', { timeout: 60_000 })
  await expect(chip).not.toHaveClass(/\bok\b/)
  // a run computed for this look is said not to be kept
  await expect(app.getByTestId('ccr-not-stored')).toHaveText('computed now, not stored · RUN NOW stores it')
  await app.locator('.pnl-bar').first().screenshot({ path: 'e2e/.out/shots/ccr-no-limits.png' })

  await app.unroute('**/api/ccr/report*')
  await patch(app, '**/api/ccr/report*', (r) => {
    const cp = r.counterparties.find(c => !c.empty)?.counterparty || 'X'
    r.limits = [{ id: 'l1', metric: `PFE_PEAK:${cp}`, scope: 'ALL', limit: 1e12, warn_pct: 80, value: 1, utilisation_pct: 0, status: 'OK' }]; r.breaches = 0; r.from_store = true; r.stored_at = r.stored_at || new Date().toISOString()
  })
  await app.goto('/risk/ccr')
  await expect(chip).toHaveText('WITHIN LIMITS', { timeout: 60_000 })
  await expect(chip).toHaveClass(/\bok\b/)
  await expect(app.getByTestId('ccr-not-stored')).toHaveCount(0)

  // the Market Risk page: every curve has a standard limit from its first trade, so its chip has something to say
  await app.goto('/risk')
  await expect(app.getByTestId('rk-standing')).toHaveText(/WITHIN LIMITS|\d+ (BREACH(ES)?|WARNINGS?)/, { timeout: 60_000 })
  expectClean(problems)
})

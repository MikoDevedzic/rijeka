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
// Whether a thing comes to be on the page: waits for it, and says in the report when a part of a journey had nothing to look at.
const shown = async (loc, what = '') => loc.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true, () => { test.info().annotations.push({ type: 'not on this stack', description: what || String(loc) }); return false })
// The names and figures of a row of cards that are set in brass (the accent), by computed colour.
const inBrass = (app, cards) => cards.locator('.pnl-card-l, .pnl-card-b').evaluateAll(els => {
  const p = document.createElement('i'); p.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); document.body.append(p)
  const brass = getComputedStyle(p).color; p.remove()
  return els.filter(el => getComputedStyle(el).color === brass).map(el => el.textContent)
})
const csa = (r) => !['NO_CSA', 'NONE', ''].includes(String(r.csa_type || 'NO_CSA').toUpperCase())

const SUBS = { 'VM HELD': 'their variation margin we hold today', 'VM POSTED': 'our variation margin they hold', 'INITIAL MARGIN': 'posted and received alike, where the CSA exchanges it', 'CARRY PER YEAR': 'what the margin earns over cash at OIS' }
const blank = (r) => Object.assign(r, { has_run: false, trades: null, vm_held_usd: 0, vm_posted_usd: 0, im_usd: 0, carry_per_year_usd: 0, posted: [], held: [] })
const two = (b) => { while (b.counterparties.filter(csa).length < 2) b.counterparties.push({ ...(b.counterparties.find(csa) || b.counterparties[0]), counterparty_id: `x${b.counterparties.length}`, counterparty: 'SECOND BANK', csa_type: 'VM' }); return b.counterparties.filter(csa) }

test('the Collateral tab says a position is not known where it is not, and never $0 for it', async ({ app, problems }) => {
  // 1. no run is stored at all: every total is a dash, the reason is said once, in the bar, and the way to a run is beside it
  await patch(app, '**/api/collateral/book*', (b) => {
    if (!b.counterparties.some(csa)) b.counterparties[0].csa_type = 'VM_IM'
    b.counterparties.forEach(blank)
    Object.assign(b.totals, { vm_held_usd: 0, vm_posted_usd: 0, im_usd: 0, carry_per_year_usd: 0, on_chain_share: null }); b.date = null; b.stored_at = null
  })
  await app.goto('/risk/collateral')
  const cards = app.locator('.pnl-cards').first()
  await expect(app.getByTestId('col-unknown')).toHaveText('no credit run is stored: positions not known', { timeout: 30_000 })
  for (const [label, sub] of Object.entries(SUBS)) {
    const card = cards.locator('.pnl-card', { hasText: label })
    await expect(card.locator('.pnl-card-b'), `${label} is a dash, not $0`).toHaveText('—')
    await expect(card.locator('.pnl-card-s'), 'the card keeps its own words; the reason is in the bar').toHaveText(sub)
  }
  await expect(cards).not.toContainText('$0')
  // the cards are set as the Market Risk page's: the figure in the figures' face, larger than its name
  const card = cards.locator('.pnl-card').first()
  const [face, big, small] = await card.evaluate(el => { const b = getComputedStyle(el.querySelector('.pnl-card-b')), l = getComputedStyle(el.querySelector('.pnl-card-l')); return [b.fontFamily, parseFloat(b.fontSize), parseFloat(l.fontSize)] })
  expect(face).toMatch(/mono/i); expect(big).toBeGreaterThan(small + 4)
  // a counterparty's cell is its name over its terms, read to the end, in a row no taller than three lines
  const row = app.locator('.pnl-tree .pnl-tr.d1').first()
  expect((await row.boundingBox()).height, 'the row is not stretched by a reason in its first cell').toBeLessThan(80)
  await expect(row).not.toContainText('no stored credit run')
  await app.screenshot({ path: 'e2e/.out/shots/collateral-unknown.png' })
  // the way to make it known goes to the tab that stores a run; it is a way there, not an action here
  const go = app.getByRole('button', { name: 'COUNTERPARTY CREDIT →' })
  await expect(go).toHaveClass(/ghost/)
  await go.click()
  await expect(app).toHaveURL(/\/risk\/ccr/)

  // 2. a run is stored; it could not simulate one counterparty: a total, and what it leaves out
  await app.unroute('**/api/collateral/book*')
  await patch(app, '**/api/collateral/book*', (b) => {
    const [a, c, ...rest] = two(b)
    Object.assign(a, { has_run: true, trades: 3, vm_held_usd: 301078, vm_posted_usd: 0, im_usd: 0 })
    Object.assign(blank(c), { trades: 2 })                       // in the run, nothing simulated
    for (const r of rest) Object.assign(r, { has_run: true, trades: 1 })
    Object.assign(b.totals, { vm_held_usd: 301078, vm_posted_usd: 0, im_usd: 0 }); b.date = b.date || '2026-11-02'
  })
  await app.goto('/risk/collateral')
  const held = app.locator('.pnl-cards').first().locator('.pnl-card', { hasText: 'VM HELD' })
  await expect(held.locator('.pnl-card-b')).toHaveText(/301,078/, { timeout: 30_000 })
  await expect(app.getByTestId('col-unknown')).toHaveText(/^1 of \d+ with a CSA could not be simulated in the stored run: not in the totals$/)
  await app.screenshot({ path: 'e2e/.out/shots/collateral-partly-known.png' })

  // 3. a run is stored and a counterparty is not in it: it had no live trade, nothing is margined, and zero is true
  await app.unroute('**/api/collateral/book*')
  await patch(app, '**/api/collateral/book*', (b) => {
    const [a, c, ...rest] = two(b)
    Object.assign(a, { has_run: true, trades: 3, vm_held_usd: 301078 }); blank(c)
    for (const r of rest) Object.assign(r, { has_run: true, trades: 1 })
    Object.assign(b.totals, { vm_held_usd: 301078 }); b.date = b.date || '2026-11-02'
  })
  await app.goto('/risk/collateral')
  await expect(app.locator('.pnl-cards').first().locator('.pnl-card', { hasText: 'VM HELD' }).locator('.pnl-card-b')).toHaveText(/301,078/, { timeout: 30_000 })
  await expect(app.getByTestId('col-unknown')).toHaveCount(0)
  await expect(app.getByRole('button', { name: 'COUNTERPARTY CREDIT →' })).toHaveCount(0)
  expectClean(problems)
})

test('the cards of the XVA reserves and IPV pages are set as cards, hold a far larger figure, and name no spot01', async ({ app, problems }) => {
  await app.goto('/pnl/xva')
  const cards = app.locator('.pnl-cards').first()
  // (isVisible does not wait: a branch guarded by it is skipped on a page still loading, and the test passes on nothing)
  if (await shown(cards.locator('.pnl-card').first())) {
    const fig = cards.locator('.pnl-card-b').first()
    expect(await fig.evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/mono/i)
    // brass is an action or a seal, never a label or a figure
    expect(await inBrass(app, cards), 'a card\'s name or figure in brass on XVA reserves').toEqual([])
    for (const width of [1440, 1100]) {
      await app.setViewportSize({ width, height: 900 })
      await fig.evaluate(el => { el.textContent = '−1,234,567,890' })
      const over = await cards.locator('.pnl-card').evaluateAll(els => els.filter(el => el.scrollWidth - el.clientWidth > 1).length)
      expect(over, `a card wider than its column at ${width}px`).toBe(0)
      expect(await cards.evaluate(el => el.scrollWidth - el.clientWidth), `the cards run past the page at ${width}px`).toBeLessThanOrEqual(1)
    }
    await app.screenshot({ path: 'e2e/.out/shots/xva-cards-large.png' })
    await app.setViewportSize({ width: 1440, height: 900 })
  }
  await app.goto('/pnl/ipv')
  const inputs = app.locator('.pnl-tr', { hasText: '_SPOT' })
  if (await shown(inputs.first())) {
    await expect(inputs.first()).toContainText(/FX01|CRY01/)
    await inputs.first().click()                                          // its pillars: the header and the column name it too
    await expect(app.locator('.pnl-panel', { hasText: /VERIFY\s+BY PILLAR/ }).first()).toContainText(/(FX01|CRY01) per pillar/)
    expect(await inBrass(app, app.locator('.pnl-cards').first()), 'a card\'s name or figure in brass on IPV').toEqual([])
    await expect(app.locator('.pnl')).not.toContainText(/spot ?01/i)
    await app.screenshot({ path: 'e2e/.out/shots/ipv-names.png' })
    // the pillar table's last column (the status) is inside its panel, or the table scrolls to it: never cut off
    const panel = app.locator('.pnl-panel', { hasText: /VERIFY\s+BY PILLAR/ }).first()
    const cut = await panel.locator('[data-testid="ipv-pillar"]').first().evaluate(row => {
      const last = row.lastElementChild.getBoundingClientRect(), tree = row.parentElement
      const box = tree.getBoundingClientRect()
      return { beyond: last.right - box.right, scrolls: tree.scrollWidth - tree.clientWidth > 1 }
    })
    expect(cut.beyond <= 1 || cut.scrolls, `the status column ends ${cut.beyond}px beyond its panel and the table does not scroll`).toBe(true)
    // in the inputs table a state with the name of who decided it ends before the impact beside it begins
    // (a cell whose words are longer than its column cuts them, with the whole text in its title: it never lets them run on)
    const over = await app.locator('[data-testid="ipv-state"]').evaluateAll(els => els.filter(el => el.scrollWidth > el.clientWidth + 1 && (getComputedStyle(el).overflowX !== 'hidden' || !el.title)).length)
    expect(over, 'a state printed over the impact column').toBe(0)
    expect(await app.locator('[data-testid="ipv-state"]').count(), 'the inputs table has rows to measure').toBeGreaterThan(0)
    // an input's name, kind and pillar count are whole at this width: the count was cut ("24 pill…"), and with it what
    // was to be decided, which now stands beside the state
    const cutNames = await app.locator('.pnl-tr.trade .pnl-tn').evaluateAll(els => els.filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.textContent))
    expect(cutNames, 'an input\'s line cut by an ellipsis').toEqual([])
    // on a narrow page the pillar table scrolls inside its panel with every column still under its own head: the
    // stylesheet hides quiet cells at 1100px and below, which once left a row three cells short of its head
    await app.setViewportSize({ width: 1000, height: 900 })
    const narrow = await panel.locator('[data-testid="ipv-pillar"]').first().evaluate(row => {
      const seen = (el) => [...el.children].filter(c => getComputedStyle(c).display !== 'none').length
      const head = row.parentElement.querySelector('.pnl-tr.head'), tree = row.parentElement, box = tree.getBoundingClientRect()
      return { head: seen(head), row: seen(row), past: Math.max(0, tree.scrollWidth - tree.clientWidth), wider: box.right - document.documentElement.clientWidth }
    })
    expect(narrow.row, `a pillar row shows ${narrow.row} cells under a head of ${narrow.head}`).toBe(narrow.head)
    expect(narrow.wider, 'the pillar table runs past the page instead of scrolling inside its panel').toBeLessThanOrEqual(1)
    await panel.screenshot({ path: 'e2e/.out/shots/ipv-pillars-narrow.png' })
    await app.setViewportSize({ width: 1440, height: 900 })
  } else test.info().annotations.push({ type: 'not shown', description: 'the stack\'s IPV run has no spot input: the IPV tables were not measured' })
  // a digital asset's funding level is the forward basis's risk, named and signed as on the ticket and the Risk page
  const funding = app.locator('.pnl-tr', { hasText: /(BTC|ETH|SOL)_FUNDING/ })
  if (await shown(funding.first())) {
    await expect(funding.first()).toContainText('CRYBASIS01')
    await expect(funding.first()).not.toContainText('IR01')
    // the input itself is named as the ticket names it (IMPLIED BTC RATE), not "funding level", a third name
    await expect(funding.first()).toContainText(/implied (BTC|ETH|SOL) rate/)
    await expect(funding.first()).not.toContainText('funding level')
    // every row's kind is whole in its column: what gives way is what follows it (the pillar count), never the word
    for (const small of await app.locator('.pnl-tr.trade .pnl-tn small').all()) {
      const cut = await small.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el.firstChild); return Math.round(r.getBoundingClientRect().right - el.getBoundingClientRect().right) })
      expect(cut, `"${(await small.textContent()).slice(0, 40)}" is cut inside its kind`).toBeLessThanOrEqual(1)
    }
    await funding.first().click()
    const pillars = app.locator('.pnl-panel', { hasText: /VERIFY\s+BY PILLAR/ }).first()
    await expect(pillars).toContainText('CRYBASIS01 per pillar')
    await expect(app.getByTestId('ipv-basis-note')).toContainText('IMPACT = −CRYBASIS01 × SHIFT')
    await expect(pillars.locator('.pnl-tr.head')).toContainText('CRYBASIS01')
    await expect(pillars, 'no sentence on the panel says the impact is the figure times the shift without the turn').toContainText('with the sign turned on these rows')
    await pillars.screenshot({ path: 'e2e/.out/shots/ipv-basis.png' })
  } else test.info().annotations.push({ type: 'not shown', description: 'the stack\'s IPV run has no digital-asset funding input: the name is held by ipv-page.test.js alone' })
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

  // a limit is set, and could not be given a value (its counterparty has no run): nothing was tested
  await app.unroute('**/api/ccr/report*')
  await patch(app, '**/api/ccr/report*', (r) => { r.limits = [{ id: 'n', metric: 'PFE_PEAK:NOBODY', scope: 'ALL', limit: 1, warn_pct: 80, value: null, utilisation_pct: null, status: 'NA' }]; r.breaches = 0 })
  await app.goto('/risk/ccr')
  await expect(chip).toHaveText('NO LIMIT TESTED', { timeout: 60_000 })
  await expect(chip).not.toHaveClass(/\bok\b/)
  // a server without the credit tables cannot store a run, and the note does not say that it can
  await app.unroute('**/api/ccr/report*')
  await patch(app, '**/api/ccr/report*', (r) => { r.from_store = false; r.tables = false })
  await app.goto('/risk/ccr')
  await expect(app.getByTestId('ccr-not-stored')).toHaveText(/cannot store a run/, { timeout: 60_000 })

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

// Third walk (16 November 2026): a day signed at one figure and since moved showed three different figures and
// nothing to say which was signed; and the credit page listed each trade's value with no date and no word that it
// is the credit model's own value, which is not the pricer's mark.
test('a signed day that has since moved says so, and the credit page says whose value a trade stands at', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 900 })
  let day = null
  await patch(app, '**/api/pnl/report*', (r) => {
    day = Number(r.totals?.dod)
    r.tables = true
    r.signoffs = [{ role: 'TRADER', by: 'USER A', signer_user_id: 'someone-else', at: '2026-11-16T09:00:00Z', usd_signed: day - 1250, comment: '' }]
  })
  await app.goto('/pnl')
  const moved = app.getByTestId('pnl-signed-moved')
  if (await shown(moved, 'the stack has no P&L day to sign')) {
    await expect(moved).toContainText('The last signature is of a day')
    await expect(moved).toContainText('it has moved by +1,250')
    await expect(moved).toContainText('The signature stands for the day as it was signed')
    await moved.scrollIntoViewIfNeeded()
    await app.screenshot({ path: 'e2e/.out/shots/pnl-signed-moved.png' })
    // signed at the figure the day reads now: nothing is said
    await app.unroute('**/api/pnl/report*')
    await patch(app, '**/api/pnl/report*', (r) => { r.tables = true; r.signoffs = [{ role: 'TRADER', by: 'USER A', signer_user_id: 'someone-else', at: '2026-11-16T09:00:00Z', usd_signed: Number(r.totals?.dod), comment: '' }] })
    await app.goto('/pnl')
    await expect(app.locator('.pnl-sign')).toBeVisible({ timeout: 60_000 })
    await expect(moved).toHaveCount(0)
  }
  await app.unroute('**/api/pnl/report*')

  await app.goto('/risk/ccr')
  const note = app.getByTestId('ccr-trades-note')
  if (await shown(note, 'the stack has no netting set with trades')) {
    await expect(note).toHaveText(/^the credit model's value on \w+ \d+, \d{4}$/)
    await expect(app.getByText('MODEL VALUE · USD')).toBeVisible()
    await note.scrollIntoViewIfNeeded()
    await app.screenshot({ path: 'e2e/.out/shots/ccr-trades-note.png' })
  }
  expectClean(problems)
})

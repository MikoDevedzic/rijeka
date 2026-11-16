// The activity record from the browser's side, and the operator's Adoption panel (Configurations → SYSTEM).
//
// What the app says a person did: a page opened, PRICE pressed, and nothing for what the app reads by itself. The
// panel is the admin's alone. The stack's users are traders, so the profile is answered as an admin's here and the
// admin reads are answered with bodies in the API's shape (e2e/admin.js): e2e/adoption-body.json, whose keys
// backend/tests/test_activity.py holds to what the API returns, so a renamed field fails there.
import { test, expect, expectClean, expectNoHorizontalOverflow, API } from './fixtures.js'
import { ADOPTION, asAdmin } from './admin.js'

test('the app says a page was opened and PRICE was pressed, and nothing for what it reads by itself', async ({ app, problems }) => {
  const said = []
  app.on('request', r => { if (r.url() === `${API}/api/me/activity` && r.method() === 'POST') said.push(JSON.parse(r.postData())) })
  const answered = () => app.waitForResponse(r => r.url() === `${API}/api/me/activity`)
  let ok = answered()
  await app.goto('/blotter')
  expect((await ok).status()).toBe(202)
  await expect(app.getByText('+ NEW TRADE').first()).toBeVisible()
  expect(said).toEqual([{ event: 'view', route: '/blotter' }])
  // the blotter refreshes itself and the chat asks for news of its own accord: neither is a person opening a page
  await app.waitForTimeout(6000)
  expect(said, 'a page left alone says nothing more').toHaveLength(1)
  // another page is another opening
  ok = answered()
  await app.locator('.ab-link', { hasText: /^RISK/ }).first().click()
  await ok
  expect(said[1]).toEqual({ event: 'view', route: '/risk' })
  ok = answered()
  await app.locator('.ab-link', { hasText: /^BLOTTER/ }).first().click()
  await ok
  expect(said[2]).toEqual({ event: 'view', route: '/blotter' })              // the same page again, after another: a new opening
  // PRICE in a trade window says the ticket's asset class; typing in it says nothing
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await app.waitForTimeout(1500)
  expect(said.filter(s => s.event === 'priced'), 'an open ticket has not been priced by anyone').toHaveLength(0)
  ok = answered()
  await win.locator('[data-action="price"]').click()
  expect((await ok).status()).toBe(202)
  expect(said.filter(s => s.event === 'priced')).toEqual([{ event: 'priced', detail: 'crypto' }])
  // nothing of what was typed, and no address beyond the page's own, ever leaves in these messages
  for (const s of said) expect(Object.keys(s).sort().join()).toMatch(/^(event,route|detail,event)$/)
  expectClean(problems)
})

test('the admin reads who came, who used it, who came back and what they used', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 1000 })
  await asAdmin(app)
  await app.goto('/configurations/system')
  const panel = app.getByTestId('adoption')
  await expect(app.getByTestId('adoption-head')).toHaveText('3 accounts · activity recorded since 03 Nov 2026')
  await expect(app.getByTestId('adoption-unread')).toHaveCount(0)
  // the funnel: each step's accounts and their share of all accounts
  const tiles = app.getByTestId('adoption-funnel').locator('> div')
  await expect(tiles).toHaveCount(7)
  await expect(tiles.nth(0)).toHaveText(/CREATED\s*3$/)                                // the first step is the whole: no share
  await expect(tiles.nth(1)).toContainText('USED IT'); await expect(tiles.nth(2)).toContainText('CAME BACK'); await expect(tiles.nth(2)).toContainText('67%')
  await expect(tiles.nth(5)).toContainText('RAN XVA')
  await expect(panel).toContainText('From sign-up to the first booked trade: 26 h at the median (2 accounts)')
  // the newest week first
  const weeks = app.getByTestId('adoption-weeks').locator('.rk-row')
  await expect(weeks.nth(1)).toContainText('w/c 16 Nov'); await expect(weeks).toHaveCount(9)
  // a cohort's cell is a count and its share; a week that has not begun is a dash
  const cohorts = app.getByTestId('adoption-cohorts')
  await expect(cohorts.locator('.rk-row', { hasText: 'w/c 02 Nov' })).toContainText('1 · 100%')
  await expect(cohorts.locator('.rk-row', { hasText: 'w/c 16 Nov' }).locator('> span').nth(2)).toHaveText('—')
  // what was used: by accounts and by days, a page as its family
  const feats = app.getByTestId('adoption-features')
  await expect(feats.locator('.rk-row').nth(0)).toContainText('DAYS')
  await expect(feats.locator('.rk-row').nth(1)).toHaveText(/OPENED · blotter\s*3\s*5/)
  await expect(feats).toContainText('PRICED · crypto')
  // each account's row: a long address is cut, kept whole in its title, and pushes nothing out of the panel
  const rows = app.getByTestId('adoption-rows')
  await expect(rows.locator('.rk-row')).toHaveCount(4)
  await expect(rows.locator('.rk-row').nth(0)).toContainText('FIRST ACTIVE')
  await expect(rows.locator('[title^="a.very.long"]')).toBeVisible()
  await panel.scrollIntoViewIfNeeded()
  await expectNoHorizontalOverflow(app.locator('html'), 'the System page with the Adoption panel')
  const box = await panel.boundingBox(), last = await rows.locator('.rk-row').nth(2).locator('> span').last().boundingBox()
  expect(last.x + last.width, 'the last column is inside the panel').toBeLessThanOrEqual(box.x + box.width + 1)
  await panel.screenshot({ path: 'e2e/.out/shots/adoption.png' })
  // a narrow page: the accounts scroll inside the panel, the panel stays in the window
  // (the top bar is wider than a 1000px window by itself, an older fault; the panel is held to its own box)
  await app.setViewportSize({ width: 1000, height: 1400 })
  await expectNoHorizontalOverflow(panel, 'the Adoption panel at 1000px')
  const narrow = await panel.boundingBox()
  expect(narrow.x + narrow.width, 'the panel ends inside the window').toBeLessThanOrEqual(1000)
  await panel.screenshot({ path: 'e2e/.out/shots/adoption-narrow.png' })
  expectClean(problems)
})

test('what could not be read is said, and a phone is not pushed sideways', async ({ app, problems }) => {
  await app.setViewportSize({ width: 390, height: 844 })
  await asAdmin(app, { adoption: { ...ADOPTION, unread: ['activity'], tracking_since: null, dropped: 2 } })
  await app.goto('/configurations/system')
  const panel = app.getByTestId('adoption')
  await expect(app.getByTestId('adoption-head')).toHaveText('3 accounts · activity is recorded from now: nothing yet')
  await expect(app.getByTestId('adoption-unread')).toHaveText('Not read just now: activity. The figures below are short by that, not zero; reload to ask again.')
  await expect(panel).toContainText('2 counters could not be written since this API started.')
  // each account is two lines of its own: nothing to scroll sideways
  const rows = app.getByTestId('adoption-rows')
  await expect(rows.locator('.rk-row')).toHaveCount(0)
  await expect(rows).toContainText('ONE CAPITAL · created 03 Nov 2026 · last 17 Nov 2026 · 4 days of 28 · priced 1 d · booked 2 · XVA 1 d · confirmed 1')
  await expectNoHorizontalOverflow(rows, 'the accounts on a phone')
  const box = await rows.boundingBox()
  expect(box.x + box.width, 'the accounts end inside the phone').toBeLessThanOrEqual(390)
  await rows.screenshot({ path: 'e2e/.out/shots/adoption-phone.png' })
  expectClean(problems)
})

test('a trader is shown no Adoption panel, and its route is not asked', async ({ app, problems }) => {
  let asked = 0
  app.on('request', r => { if (r.url().includes('/api/ops/adoption')) asked += 1 })
  await app.goto('/configurations/system')
  await expect(app.getByText('SCHEDULED BATCHES', { exact: true })).toBeVisible()
  await app.waitForLoadState('networkidle').catch(() => {})
  await expect(app.getByTestId('adoption')).toHaveCount(0)
  expect(asked).toBe(0)
  expectClean(problems)
})

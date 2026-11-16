// The operator's Adoption panel (Configurations → SYSTEM): who came, who came back and what they used, per account.
// It is the admin's alone. The stack's users are traders, so the profile is answered as an admin's here and the two
// admin reads are answered with bodies in the API's shape (which backend/tests/integration/test_activity.py and
// tests/test_activity.py hold); for a trader the panel is not drawn and its route is never asked.
import { test, expect, expectClean, expectNoHorizontalOverflow, API, REST } from './fixtures.js'

const ADOPTION = {
  today: '2026-11-18', recording: true, tracking_since: '2026-11-03', accounts: 3, feature_days: 28, rows_total: 3,
  weeks: ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'].map((week, i) => (
    { week, created: [0, 0, 0, 0, 0, 1, 1, 1][i], active: [0, 0, 0, 0, 0, 1, 2, 2][i], returning: [0, 0, 0, 0, 0, 0, 1, 1][i] })),
  funnel: [{ step: 'created', accounts: 3, share: 1 }, { step: 'returned', accounts: 2, share: 2 / 3 }, { step: 'priced', accounts: 2, share: 2 / 3 },
    { step: 'booked', accounts: 2, share: 2 / 3 }, { step: 'xva', accounts: 1, share: 1 / 3 }, { step: 'confirmed', accounts: 1, share: 1 / 3 }],
  first_trade: { accounts: 2, median_hours: 25.5 },
  cohorts: ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'].map((week, i) => (
    { week, accounts: [0, 0, 0, 1, 1, 1][i], active_after: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [1, 1, null], [0, null, null], [null, null, null]][i] })),
  features: [{ event: 'booked', detail: '', accounts: 2, times: 3 }, { event: 'priced', detail: 'rates', accounts: 1, times: 6 },
    { event: 'priced', detail: 'crypto', accounts: 1, times: 3 }, { event: 'xva', detail: 'rates', accounts: 1, times: 2 }, { event: 'confirmed', detail: '', accounts: 1, times: 1 }],
  rows: [{ email: 'one@example.com', firm: 'ONE CAPITAL', created: '2026-11-03', last_active: '2026-11-17', days_active: 4, priced: 6, booked: 2, xva: 2, confirmed: 1 },
    { email: 'a.very.long.account.name.that.must.not.push.the.table@example-of-a-long-domain.com', firm: null, created: '2026-11-17', last_active: '2026-11-17', days_active: 1, priced: 0, booked: 0, xva: 0, confirmed: 0 },
    { email: 'two@example.com', firm: 'TWO', created: '2026-11-10', last_active: null, days_active: 0, priced: 0, booked: 0, xva: 0, confirmed: 0 }],
  note: 'Accounts are sign-ups, without test accounts and the platform\'s admins.',
}
const USAGE = { days: 14, from: '2026-11-05', to: '2026-11-18', series: [], totals: { visitors: 0, views: 0, signup_started: 0, signups: 0, trades: 0, confirms: 0, anchors: 0 }, hits_stored_in: 'usage_hits', note: '' }

async function asAdmin(app) {
  await app.route(/\/rest\/v1\/profiles/, async route => {
    const res = await route.fetch({ url: route.request().url().replace(/^https?:\/\/[^/]+\/rest\/v1/, REST) })
    const j = await res.json()
    const admin = (p) => ({ ...p, role: 'admin' })
    await route.fulfill({ response: res, json: Array.isArray(j) ? j.map(admin) : admin(j) })
  })
  await app.route(`${API}/api/ops/adoption`, route => route.fulfill({ json: ADOPTION }))
  await app.route(`${API}/api/ops/usage`, route => route.fulfill({ json: USAGE }))
}

test('the admin reads who came, who came back and what they used', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 1000 })
  await asAdmin(app)
  await app.goto('/configurations/system')
  const panel = app.getByTestId('adoption')
  await expect(app.getByTestId('adoption-head')).toHaveText('3 accounts · activity recorded since 03 Nov 2026')
  // the funnel: each step's accounts and their share of all accounts
  const funnel = app.getByTestId('adoption-funnel')
  await expect(funnel).toContainText('CAME BACK'); await expect(funnel).toContainText('RAN XVA')
  await expect(funnel.locator('> div').nth(1)).toContainText('67%')
  await expect(funnel.locator('> div').nth(0)).not.toContainText('%')                    // the first step is the whole
  await expect(panel).toContainText('From sign-up to the first booked trade: 26 h at the median (2 accounts)')
  // the newest week first
  const weeks = app.getByTestId('adoption-weeks').locator('.rk-row')
  await expect(weeks.nth(1)).toContainText('w/c 16 Nov'); await expect(weeks).toHaveCount(9)
  // a cohort's cell is a count and its share; a week that has not begun is blank
  const cohort = app.getByTestId('adoption-cohorts').locator('.rk-row', { hasText: 'w/c 02 Nov' })
  await expect(cohort).toContainText('1 · 100%')
  await expect(app.getByTestId('adoption-features')).toContainText('PRICED · crypto')
  // each account's row: a long address is cut, kept whole in its title, and pushes nothing out of the panel
  const rows = app.getByTestId('adoption-rows')
  await expect(rows.locator('.rk-row')).toHaveCount(4)
  await expect(rows.locator('.rk-row').nth(3)).toContainText('never')
  const long = rows.locator('[title^="a.very.long"]')
  await expect(long).toBeVisible()
  await panel.scrollIntoViewIfNeeded()
  await expectNoHorizontalOverflow(app.locator('html'), 'the System page with the Adoption panel')
  const box = await panel.boundingBox(), last = await rows.locator('.rk-row').nth(1).locator('> span').last().boundingBox()
  expect(last.x + last.width, 'the last column is inside the panel').toBeLessThanOrEqual(box.x + box.width + 1)
  await panel.screenshot({ path: 'e2e/.out/shots/adoption.png' })
  // a narrow page: the accounts scroll inside the panel, the page does not
  await app.setViewportSize({ width: 1000, height: 900 })
  // (the top bar is wider than a 1000px window by itself, an older fault; the panel is held to its own box)
  await expectNoHorizontalOverflow(panel, 'the Adoption panel at 1000px')
  const narrow = await panel.boundingBox()
  expect(narrow.x + narrow.width, 'the panel ends inside the window').toBeLessThanOrEqual(1000)
  await panel.screenshot({ path: 'e2e/.out/shots/adoption-narrow.png' })
  expectClean(problems)
})

test('a trader is shown no Adoption panel, and its route is not asked', async ({ app, problems }) => {
  let asked = 0
  app.on('request', r => { if (r.url().includes('/api/ops/adoption')) asked += 1 })
  await app.goto('/configurations/system')
  await expect(app.getByText('SCHEDULED BATCHES')).toBeVisible()
  await app.waitForLoadState('networkidle').catch(() => {})
  await expect(app.getByTestId('adoption')).toHaveCount(0)
  expect(asked).toBe(0)
  expectClean(problems)
})

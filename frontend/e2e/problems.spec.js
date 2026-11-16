// A problem a user hits reaches the operator with the account that hit it, and the admin reads who it was.
//
// The report a signed-in page sends carries its session (so the API can keep the account); one from a page that is
// not signed in carries none. The Problems panel (Configurations → SYSTEM) is the admin's alone: the stack's users
// are traders, so the profile is answered as an admin's here and the admin read is answered with a body in the
// API's shape, e2e/problems-body.json, whose keys backend/tests/test_health.py holds to what the API returns.
import { test, expect, expectClean, expectNoHorizontalOverflow, API } from './fixtures.js'
import { PROBLEMS, asAdmin } from './admin.js'

const reported = (page) => page.waitForRequest(r => r.url() === `${API}/api/ops/client-error` && r.method() === 'POST')
const boom = (page) => page.evaluate(() => { setTimeout(() => { throw new Error('a journey\'s own error, to see who hears of it') }, 0) })

test('a signed-in page\'s error report says whose it is', async ({ app }) => {
  await app.goto('/blotter')
  await expect(app.getByText('+ NEW TRADE').first()).toBeVisible()
  const sent = reported(app)
  await boom(app)
  const req = await sent
  expect(req.headers().authorization, 'the session travels in the header').toMatch(/^Bearer .+/)
  const body = JSON.parse(req.postData())
  expect(body.message).toContain('a journey\'s own error'); expect(body.route).toBe('/blotter')
  expect(JSON.stringify(body), 'and never in the report itself').not.toMatch(/Bearer|eyJ/)
  expect((await req.response()).status()).toBe(202)
})

test('a page that is not signed in reports the same error with nothing that says who', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('navigation', { name: 'Sign in or create a desk' })).toBeVisible()
  const sent = reported(page)
  await boom(page)
  const req = await sent
  expect(req.headers().authorization, 'no session, no header').toBeUndefined()
  expect(req.method()).toBe('POST')                                        // sent as a beacon, which carries no header at all
})

test('the admin reads what went wrong and for whom', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 1000 })
  await asAdmin(app)
  await app.goto('/configurations/system')
  const panel = app.getByTestId('problems')
  await expect(app.getByTestId('problems-head')).toHaveText('3 problems · 6 occurrences · the operator is told in the support room')
  const rows = app.getByTestId('problems-rows').locator('.rk-row')
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(1)).toContainText('On /risk: Failed to fetch dynamically imported module · 2 accounts and visitors not signed in, 4 times')
  await expect(rows.nth(1)).toContainText('IN THE BROWSER · boundary-load · 063bb5f')
  await expect(rows.nth(1).getByTestId('problems-who')).toHaveText('one@example.com, a.very.long.account.name.that.must.wrap@example-of-a-long-domain.com, a visitor not signed in')
  await expect(rows.nth(2)).toContainText('THE API ANSWERED AN ERROR'); await expect(rows.nth(2).getByTestId('problems-who')).toHaveText('one@example.com')
  await expect(rows.nth(3)).toContainText('A SLOW ANSWER'); await expect(rows.nth(3).getByTestId('problems-who')).toHaveText('a visitor not signed in')
  await expect(panel).toContainText('30 seconds or more'); await expect(panel).toContainText('Kept 30 days.')
  await panel.scrollIntoViewIfNeeded()
  await expectNoHorizontalOverflow(app.locator('html'), 'the System page with the Problems panel')
  await expectNoHorizontalOverflow(panel, 'the Problems panel')
  await panel.screenshot({ path: 'e2e/.out/shots/problems.png' })
  expectClean(problems)
})

test('the panel says when problems are not kept, when there are none, and with mail', async ({ app, problems }) => {
  await asAdmin(app, { problems: { ...PROBLEMS, recording: false, problems: [], occurrences: 0 } })
  await app.goto('/configurations/system')
  await expect(app.getByTestId('problems-head')).toHaveText('not kept: the health table is not applied, and nobody is alerted')
  await expect(app.getByTestId('problems-rows')).toHaveCount(0)
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  await asAdmin(app, { problems: { ...PROBLEMS, problems: [], occurrences: 0, mail: true } })
  await app.reload()
  await expect(app.getByTestId('problems-head')).toHaveText('none · the operator is told in the support room and by mail')
  await expect(app.getByTestId('problems')).toContainText('No browser reported a problem, and the API answered no request with an error or too slowly.')
  expectClean(problems)
})

test('a trader is shown no Problems panel, and its route is not asked', async ({ app, problems }) => {
  let asked = 0
  app.on('request', r => { if (r.url().includes('/api/ops/problems')) asked += 1 })
  await app.goto('/configurations/system')
  await expect(app.getByText('SCHEDULED BATCHES', { exact: true })).toBeVisible()
  await app.waitForLoadState('networkidle').catch(() => {})
  await expect(app.getByTestId('problems')).toHaveCount(0)
  expect(asked).toBe(0)
  expectClean(problems)
})

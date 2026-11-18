// Risk settings, the risk-factor history: the page says which rates curves hold rows the desk entered itself, shows
// a backfill's result when the run has finished (it used to say nothing), and replaces the desk's own rows only on
// a second, explicit press. The history's answers are played to the page here, so no market row of the shared local
// database is written; the backfill itself is tested on a database of its own (tests/integration/test_history_backfill.py).
import { test, expect, expectClean } from './fixtures.js'

const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
const SERIES = (own) => ({
  USD_SOFR: { observations: 529, from: '2024-11-18', to: '2026-11-17', own: 0 },
  CHF_SARON: { observations: 30, from: '2026-04-06', to: '2026-11-17', own },
  EURUSD_SPOT: { observations: 512, from: '2024-11-18', to: '2026-11-17' },
})

test('the risk-factor history: a desk\'s own rates rows are counted, kept by a backfill, and replaced only on a second press', async ({ app, problems }) => {
  const posts = []
  let state = { series: SERIES(30), backfill: { running: false, finished: 't0', result: null, error: null } }
  let allowed = false                                             // the account's own risk or admin role
  let pending = null                                              // the answer the run will end with, given after one "running"
  await app.route(/\/api\/risk\/settings$/, async r => {
    if (r.request().method() !== 'GET') return r.fallback()
    const real = await (await r.fetch()).json()
    return r.fulfill(json({ ...real, can_write: true }))
  })
  await app.route(/\/api\/risk\/history(\/backfill)?(\?.*)?$/, r => {
    const req = r.request()
    if (req.method() === 'POST') {
      posts.push(new URL(req.url()).search)
      const replace = /replace_own=true/.test(req.url())
      pending = { series: SERIES(replace ? 0 : 30), backfill: { running: false, finished: `t${posts.length}`, error: null,
        result: { start: '2024-11-18', end: '2026-11-17', written: { USD_SOFR: 529, ...(replace ? { CHF_SARON: 529 } : {}) },
          kept_own: replace ? {} : { CHF_SARON: 30 }, replaced_own: replace ? { CHF_SARON: 30 } : {} } } }
      state = { ...state, backfill: { running: true, finished: null } }
      return r.fulfill(json({ started: true, years: 2 }))
    }
    const now = state
    if (pending && state.backfill.running) { state = pending; pending = null }                 // the next read finds it finished
    return r.fulfill(json({ template: 'tpl', can_replace_own: allowed, ...now }))
  })

  await app.goto('/configurations/market-risk/var')
  const panel = app.locator('.pnl-panel', { hasText: 'RISK-FACTOR HISTORY' })
  await expect(panel.locator('[data-own="CHF_SARON"]')).toHaveText('30 own')
  await expect(panel.locator('[data-own="USD_SOFR"]')).toHaveText('')
  await expect(panel.locator('[data-own="EURUSD_SPOT"]')).toHaveText('')

  // a backfill keeps them, and the page says so when the run has finished
  await panel.getByRole('button', { name: 'BACKFILL TWO YEARS' }).click()
  const said = panel.locator('[data-backfill-note]')                    // in the panel, beside the button that asked
  await expect(said).toContainText('Kept as they are, the desk\'s own rows: CHF_SARON 30.', { timeout: 20_000 })
  await expect(said).toContainText('Rows written: USD_SOFR 529.')
  expect(posts, 'a plain backfill does not ask for the desk\'s rows').toEqual(['?years=2'])

  // without the risk or admin role the desk's rows are named and cannot be replaced
  const own = panel.locator('[data-own-rows]')
  await expect(own.getByRole('button', { name: /REPLACE THE DESK'S OWN RATES ROWS/ })).toBeDisabled()
  await expect(own).toContainText('It needs the risk or admin role.')
  allowed = true
  await app.reload()
  await expect(own.getByRole('button', { name: /REPLACE THE DESK'S OWN RATES ROWS/ })).toBeEnabled()

  // one press replaces nothing: it asks, and can be called off
  await own.getByRole('button', { name: /REPLACE THE DESK'S OWN RATES ROWS/ }).click()
  await expect(own.getByRole('button', { name: 'REPLACE 30 ROWS WITH THE SYNTHETIC MARKET' })).toBeVisible()
  await own.getByRole('button', { name: 'CANCEL' }).click()
  await expect(own.getByRole('button', { name: /REPLACE THE DESK'S OWN RATES ROWS/ })).toBeVisible()
  expect(posts.length, 'nothing was sent').toBe(1)

  // the second press does
  await own.getByRole('button', { name: /REPLACE THE DESK'S OWN RATES ROWS/ }).click()
  await own.getByRole('button', { name: 'REPLACE 30 ROWS WITH THE SYNTHETIC MARKET' }).click()
  await expect(said).toContainText('The desk\'s own rows replaced: CHF_SARON 30.', { timeout: 20_000 })
  expect(posts[1]).toBe('?years=2&replace_own=true')
  await expect(panel.locator('[data-own="CHF_SARON"]')).toHaveText('')
  await expect(own, 'with no row of the desk\'s own left, the action is not offered').toHaveCount(0)
  expectClean(problems)
})

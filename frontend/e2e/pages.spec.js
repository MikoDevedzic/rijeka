// Every page opens, signed in, without an uncaught error, a console error, a failed API call or the error
// boundary, and shows its own heading (not just the shell around it). This is the journey that would have caught
// "Can't find variable: modules" and "fit_details.map is not a function" before a user did.
import { test, expect, expectClean } from './fixtures.js'

// [url, what only this page renders, where to look: the page's own title element, or the body when it has none]
const TITLE = '.pnl-title, h1, h2'
const PAGES = [
  ['/command-center', /./, 'body'],
  ['/blotter', /\+ NEW TRADE/, 'body'],
  ['/pnl', /P&L · ATTRIBUTION/, TITLE],
  ['/pnl/xva', /XVA RESERVES/, TITLE],
  ['/pnl/ipv', /INDEPENDENT PRICE VERIFICATION/, TITLE],
  ['/risk', /MARKET RISK/, TITLE],
  ['/risk/ccr', /COUNTERPARTY CREDIT/, TITLE],
  ['/risk/capital', /CAPITAL regulatory stock/, TITLE],
  ['/risk/collateral', /THE BOOK UNDER REGIMES/, TITLE],
  ['/configurations/market-data/curves', /SOFR OIS/, 'body'],
  ['/configurations/market-data/swvol', /SWAPTION/i, 'body'],
  ['/configurations/market-data/capfloor', /CAP/i, 'body'],
  ['/configurations/market-data/crypto', /BTCUSD/, 'body'],
  ['/configurations/xva-parameters/hw1f', /HW1F/, 'body'],
  ['/configurations/market-risk/limits', /RISK LIMITS/, TITLE],
  ['/configurations/market-risk/var', /VAR SETTINGS/, TITLE],
  ['/configurations/market-risk/stress', /STRESS SCENARIOS/, TITLE],
  ['/configurations/org-hierarchy', /./, 'body'],
  ['/configurations/legal-entities', /LEGAL ENTITIES/, TITLE],
  ['/configurations/counterparties', /COUNTERPARTIES/, TITLE],
  ['/configurations/collateral/instruments', /COLLATERAL INSTRUMENTS/, TITLE],
  ['/configurations/pnl/defaults', /BOOKING DEFAULTS/, TITLE],
  ['/configurations/pnl/conventions', /P&L CONVENTIONS/, TITLE],
  ['/configurations/pnl/ipv-tolerances', /IPV TOLERANCES/, TITLE],
  ['/configurations/system', /SYSTEM scheduled batches/, TITLE],
  ['/methodology', /How the system is built/, TITLE],
  ['/methodology/12', /Currency and digital-asset forwards/, TITLE],
  ['/methodology/replications', /Excel replications/, TITLE],
  ['/roadmap', /PHASE 1 · RATES/, TITLE],
]

// the error boundaries' own words (PageBoundary, the trade window's) and the usual shapes of a render crash
const BOUNDARY = /this page hit an error|this window hit an error|something went wrong|is not a function|can't find variable|is not defined|cannot read propert/i

for (const [url, expected, where] of PAGES) {
  test(`opens ${url}`, async ({ app, problems }) => {
    await app.goto(url)
    await expect(app.locator(where).filter({ hasText: expected }).first()).toBeVisible()
    await app.waitForLoadState('networkidle').catch(() => {})          // the page's own fetches have answered
    await app.waitForTimeout(400)
    const text = await app.locator('body').innerText()
    expect(text, `${url} shows an error boundary`).not.toMatch(BOUNDARY)
    expect(app.url(), `${url} redirected away (signed out or a missing route)`).toContain(url)
    // ISDA SIMM is licensed and not computed here: a record's page does not name it as the margin's basis (the
    // local stack's counterparty carries the old default on purpose, and is read as MODEL)
    if (/counterparties|legal-entities/.test(url)) expect(text, `${url} names SIMM`).not.toMatch(/\bSIMM\b/)
    expectClean(problems)
  })
}

test('the home page\'s policy path is drawn inside its own box, with its labels inside the plot', async ({ app, problems }) => {
  await app.goto('/command-center')
  const plot = app.locator('.dh-plot').first()
  await expect(plot.locator('svg')).toBeVisible({ timeout: 30_000 })
  const fit = await plot.evaluate(el => {
    const box = el.getBoundingClientRect(), svg = el.querySelector('svg').getBoundingClientRect()
    const labels = [...el.querySelectorAll('svg text')].map(t => t.getBoundingClientRect())
    return { over: Math.round(svg.bottom - box.bottom), left: Math.round(Math.min(...labels.map(r => r.left)) - svg.left), right: Math.round(svg.right - Math.max(...labels.map(r => r.right))) }
  })
  expect(fit.over, 'the drawing ends where its box ends (it ran 24px into the decisions under it until 0.30.3)').toBeLessThanOrEqual(1)
  expect(fit.left, 'no label is cut at the left').toBeGreaterThanOrEqual(0)
  expect(fit.right, 'no label is cut at the right').toBeGreaterThanOrEqual(0)
  expectClean(problems)
})

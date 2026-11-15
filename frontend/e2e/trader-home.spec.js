// The home on a monitor is the trader's (components/home/TraderHome.jsx): where you stand and what needs you, the
// P&L as a statement, the risk as one stream for each factor along the tenor it sits at, the trades, and behind
// tabs what the old home showed in cards. The stack has one day of market data, so there is no history of moves:
// the first journey is the app as the stack answers it (each stream to its own scale); the second gives the
// report a history and limits, as a desk with a year of data has, to see the one scale and the rail.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, expectClean, expectNoHorizontalOverflow, bookedSwap } from './fixtures.js'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '.out', 'trader-home')
const shot = async (target, name) => { fs.mkdirSync(OUT, { recursive: true }); await target.screenshot({ path: path.join(OUT, `${name}.png`) }) }
const MONITOR = { width: 1440, height: 1000 }
// how many of a canvas's pixels are drawn on
const ink = (canvas) => canvas.evaluate(cv => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++; return n })

test('the home on a monitor: the statement, the risk by tenor, what needs you and the trades, read from the app as it is', async ({ app, problems }) => {
  test.setTimeout(180_000)
  await app.setViewportSize(MONITOR)
  await bookedSwap(app)
  await app.goto('/command-center')
  const home = app.getByTestId('trader-home')
  await expect(home).toBeVisible({ timeout: 30_000 })

  // band 2, left: the P&L reads as a statement
  const pnl = home.getByTestId('th-pnl')
  await expect(pnl.locator('.th-big')).toHaveText(/^([+−][\d,]+|0)$/, { timeout: 90_000 })
  await expect(pnl.locator('table tbody tr td:first-child')).toContainText(['Market', 'Trading', 'Clean'])
  await expect(pnl).toContainText(/\d+ TRADES/)

  // band 2, middle: one stream for each factor the book carries; a swap carries its curve's IR01
  const river = home.getByTestId('th-river')
  await expect(river.locator('.th-lane', { hasText: 'USD SOFR · IR01' })).toBeVisible({ timeout: 120_000 })
  await expect(river.locator('.th-lane .fig').first()).toHaveText(/^[+−][\d,]+$/)
  await expect.poll(() => ink(river.locator('canvas')), 'the streams are drawn').toBeGreaterThan(2000)
  // no history of moves on the stack, so no money scale; every curve has a limit (the standard one for its kind until
  // it is given its own), so the scale against the limit is offered
  await expect(river.getByTestId('th-mode').getByRole('button')).toHaveText(['OF ITS LIMIT', 'PER 01'])
  await expect(river).toContainText('each stream to its own scale')
  await expect(home.getByTestId('th-rail').locator('.th-rl-track .th-rl-m').first(), 'a mark for a curve\'s limit').toBeVisible()
  await expect(home.getByTestId('th-factors').locator('.th-row[data-factor="IR:USD_SOFR"]').getByTestId('th-gauge')).toBeVisible()
  await expect(river.locator('canvas')).toHaveAttribute('aria-label', /USD SOFR IR01 [+−][\d,]+ per bp/)

  // band 2, right: the factor and the VaR line (too little history says so; it does not print a figure)
  const side = home.getByTestId('th-factors')
  await expect(side.locator('.th-row', { hasText: 'USD SOFR' })).toBeVisible()
  await expect(side.getByTestId('th-var')).toContainText(/too few for a VaR|[\d,]+/)

  // the report shown holds the swap just booked: a stored one that did not was run again, once
  await expect(home.getByTestId('th-behind'), 'the report is the book as it stands').toHaveCount(0, { timeout: 120_000 })

  // band 1: where you stand, and the desk feed's actions on the right
  await expect(home.locator('.dh-strip'), 'the rates strip keeps its height').toBeVisible()
  expect((await home.locator('.dh-strip').boundingBox()).height).toBeGreaterThan(30)
  await expect(home.getByTestId('th-stand').locator('.th-w').first()).toBeVisible()
  await expect(home.getByTestId('th-needs')).toContainText('NEEDS YOU')
  await expect(home.getByTestId('th-needs').locator('.lf-list li').first()).toBeVisible({ timeout: 30_000 })

  // band 3: the trades, and the old cards behind tabs
  const trades = home.getByTestId('th-trades')
  await expect(trades.locator('tbody tr').first()).toContainText(/PENDING|CONFIRMED|LIVE/)
  const tabs = home.getByTestId('th-tabs')
  await expect(tabs.locator('.th-tabs > [role=tab]')).toHaveText(['FIXINGS', 'WHAT MOVED', 'ON CHAIN', 'RATES', 'WEEK AHEAD', 'NEWS', 'BRIEF'])
  // what resets next is the first thing shown: the swap just booked resets on its curve's fixing every business day
  await expect(tabs.getByRole('tab', { name: 'FIXINGS' })).toHaveAttribute('aria-selected', 'true')
  const fix = tabs.getByTestId('fixings')
  await expect(fix.locator('tbody tr').first()).toContainText('USD SOFR')
  await expect(fix.locator('tbody tr').first().locator('td').nth(2), 'the net notional that resets, in millions with its sign').toHaveText(/^[+−][\d,.]+m$/)
  await expect(fix.locator('tbody tr').first().locator('td').nth(3), 'and what 1bp on that fixing is worth').toHaveText(/^[+−][\d,]+(\.\d)?$/)
  await expectNoHorizontalOverflow(tabs, 'the fixings in their tab')
  await tabs.scrollIntoViewIfNeeded(); await shot(tabs, 'tab-fixings')
  await tabs.getByRole('tab', { name: 'WHAT MOVED' }).click()
  // what the old home's LIFECYCLE card listed: the latest confirmations, each with its proof or its state
  await tabs.getByRole('tab', { name: 'ON CHAIN' }).click()
  await expect(tabs.getByTestId('th-anchors').locator('li').first().or(tabs.locator('.dh-text'))).toBeVisible({ timeout: 30_000 })
  await expectNoHorizontalOverflow(tabs, 'the confirmations in their tab')
  await shot(tabs, 'tab-chain')
  await tabs.getByRole('tab', { name: 'RATES' }).click()
  await expect(tabs.locator('.dh-plot svg').first()).toBeVisible({ timeout: 30_000 })
  await expectNoHorizontalOverflow(tabs, 'the policy path in its tab')
  await tabs.scrollIntoViewIfNeeded(); await app.waitForTimeout(600); await shot(tabs, 'tab-rates')
  await tabs.getByRole('tab', { name: 'WEEK AHEAD' }).click()
  await expect(tabs.locator('.dh-week')).toBeVisible()
  await expectNoHorizontalOverflow(tabs, 'the week ahead in its tab')
  await app.waitForTimeout(600); await shot(tabs, 'tab-week')
  await tabs.getByRole('tab', { name: 'NEWS' }).click()
  await expect(tabs.locator('.dh-news')).toBeVisible()
  await shot(tabs, 'tab-news')
  await tabs.getByRole('tab', { name: 'BRIEF' }).click()
  await expect(tabs.locator('.bb')).toBeVisible()
  await expectNoHorizontalOverflow(tabs, 'the brief in its tab')
  await app.waitForTimeout(600); await shot(tabs, 'tab-brief')
  await tabs.getByRole('tab', { name: 'WHAT MOVED' }).click()

  await expect(home.getByTestId('th-chain')).toContainText('VERIFIER')
  await expectNoHorizontalOverflow(home, 'the home at 1440')
  await home.locator('.dh-strip').scrollIntoViewIfNeeded()
  await shot(app, 'stack-1440')
  await app.setViewportSize({ width: 1280, height: 900 })
  await expectNoHorizontalOverflow(home, 'the home at 1280')
  expect(await app.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'nothing is pushed sideways at 1280').toBe(true)
  await shot(app, 'stack-1280')
  await app.setViewportSize({ width: 1000, height: 900 })
  await expectNoHorizontalOverflow(home, 'the home in a narrow window, where the bands stack')
  expect(await home.evaluate(el => [...el.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > window.innerWidth + 1 && !x.closest('.dh-strip')).map(x => x.className || x.tagName).slice(0, 5)), 'nothing in the home is past the window\'s right edge').toEqual([])

  // a trade's row opens the blotter
  await app.setViewportSize(MONITOR)
  await trades.locator('tbody tr').first().click()
  await expect(app).toHaveURL(/\/blotter/)
  expectClean(problems)
})

test('with a history of moves and limits: the streams share one scale in money, and each limit stands on the rail', async ({ app, problems }) => {
  test.setTimeout(180_000)
  await app.setViewportSize(MONITOR)
  await bookedSwap(app)
  // the report as the API answers it, given what a desk with history and limits has: a usual daily move for each
  // bucket of each curve it carries, a second factor, and three limits (one clear, one close, one passed)
  // (the stored report is the one read from the API; a run asked for because a swap was booked since is answered
  // with the same report, so this journey starts no heavy run and leaves none in flight)
  let given = null
  await app.route(url => url.pathname.endsWith('/api/risk/report'), async route => {
    if (new URL(route.request().url()).search.includes('live=1') && given) return route.fulfill({ json: { ...given, generated_at: new Date().toISOString() } })
    const res = await route.fetch({ url: route.request().url().replace(/\?.*$/, '') }), j = await res.json()
    const stdev = {}
    for (const row of j.ladder?.ladder || []) stdev[row.curve] = { '0-1Y': 3.2, '1-5Y': 5.1, '5-10Y': 5.6, '10Y+': 5.0 }
    stdev.BTC_SPOT = { SPOT: 3.1 }
    j.ladder.spot01 = { ...(j.ladder.spot01 || {}), BTC: 22900 }          // a total with no row of its own: drawn at the near end
    j.moves = { stdev, observations: {}, unit: '', method: '' }
    j.var = { ...j.var, var_1d: 183800, enough: true, confidence: 0.99 }
    j.limits = [
      { id: 'l1', metric: 'VAR_99_1D', scope: 'ALL', limit: 250000, warn_pct: 80, value: 183800, utilisation_pct: 73.5, status: 'OK' },
      { id: 'l2', metric: 'SPOT01:BTC', scope: 'ALL', limit: 25000, warn_pct: 80, value: 22900, utilisation_pct: 91.6, status: 'WARN' },
      { id: 'l3', metric: 'IR01', scope: 'ALL', limit: 1000, warn_pct: 80, value: 1100, utilisation_pct: 110, status: 'BREACH' },
    ]
    // and one on a tenor bucket of the first curve the book carries, 80% used, on whichever side the book is
    const row = (j.ladder.ladder || []).find(r => Math.abs(r.buckets?.['1-5Y'] || 0) > 1)
    if (row) { const size = Math.abs(row.buckets['1-5Y']); j.limits.push({ id: 'l4', metric: `KR01:${row.curve}:1-5Y`, scope: 'ALL', limit: size / 0.8, warn_pct: 80, value: size, utilisation_pct: 80, status: 'WARN' }) }
    given = j
    await route.fulfill({ response: res, json: j })
  })
  await app.goto('/command-center')
  const home = app.getByTestId('trader-home'), river = home.getByTestId('th-river')
  await expect(river.locator('.th-lane', { hasText: 'BTC · CRY01' })).toBeVisible({ timeout: 120_000 })

  // one scale, in money, and the switch to the sensitivity itself; the choice is kept by the browser
  const mode = river.getByTestId('th-mode')
  await expect(mode.getByRole('button', { name: 'A USUAL DAY' })).toHaveAttribute('aria-pressed', 'true')
  await expect(river).toContainText('one scale for all')
  await expect.poll(() => ink(river.locator('canvas'))).toBeGreaterThan(2000)
  const box = await river.locator('.th-cv').boundingBox()
  await app.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.5)
  await expect(river.locator('.th-tip')).toContainText('TO 1Y')
  await expect(river.locator('.th-tip')).toContainText(/≈ [\d,]+ a day/)
  await shot(app, 'history-hover')
  await app.mouse.move(2, 2)
  await mode.getByRole('button', { name: 'PER 01' }).click()
  await expect(river).toContainText('each stream to its own scale')
  await app.reload()
  await expect(app.getByTestId('th-mode').getByRole('button', { name: 'PER 01' })).toHaveAttribute('aria-pressed', 'true', { timeout: 120_000 })
  await app.getByTestId('th-mode').getByRole('button', { name: 'A USUAL DAY' }).click()

  // where you stand: the words, the closest limit, and a mark for each limit
  const stand = app.getByTestId('th-stand')
  await expect(stand).toContainText('1 limit passed')
  await expect(stand).toContainText('2 close')
  await expect(stand).toContainText(/Closest: IR01, (long|short), at 110% of its limit\./)
  const rail = stand.getByTestId('th-rail')
  await expect(rail.locator('.th-rl-track .th-rl-m')).toHaveCount(4)
  await expect(rail.locator('.th-rl-track .th-rl-m.BREACH')).toHaveCount(1)
  // a limit is read on two sides: flat in the middle, a long figure to the right of it; a VaR has no side and is a square
  await expect(rail).toContainText('FLAT'); await expect(rail).toContainText('SHORT · THE LIMIT'); await expect(rail).toContainText('LONG · THE LIMIT')
  await expect(rail.locator('.th-rl-track .th-rl-m.s[data-side="0"]'), 'the VaR').toHaveCount(1)
  const btcMark = rail.locator('.th-rl-track .th-rl-m.WARN[data-side="1"]').first()
  expect(parseFloat(await btcMark.evaluate(el => el.style.left)), 'a long figure stands right of the middle').toBeGreaterThan(50)
  await expect(app.getByTestId('th-limits').locator('.th-lim'), 'the two that are on no stream: the VaR and the book\'s IR01').toHaveCount(2)
  await expect(app.getByTestId('th-factors')).toContainText('OTHER LIMITS')
  // beside its factor: a gauge, the share of the limit used, the side and the room left
  const btc = app.getByTestId('th-factors').locator('.th-row', { hasText: /CRY01/ })
  await expect(btc.getByTestId('th-gauge')).toBeVisible()
  await expect(btc).toContainText('92% of 25,000 · long')
  await expect(btc).toContainText('2,100 of room')
  await expect(app.getByTestId('th-factors').locator('.th-row', { has: app.getByTestId('th-gauge') }).filter({ hasText: /80% of [\d,]+ · 1Y TO 5Y · (long|short)/ }), 'the curve whose bucket has a limit').toHaveCount(1)
  // the picture against the limits: a third scale, and the tip names the bucket's limit
  const scale = app.getByTestId('th-mode')
  await scale.getByRole('button', { name: 'OF ITS LIMIT' }).click()
  await expect(app.getByTestId('th-river')).toContainText('each bucket as the share of its limit it uses')
  await expect(app.getByTestId('th-river')).toContainText('A ruled line across a bucket is that bucket\'s limit')
  await expect.poll(() => ink(app.getByTestId('th-river').locator('canvas')), 'drawn again on the new scale').toBeGreaterThan(2000)
  const cvb = await app.getByTestId('th-river').locator('.th-cv').boundingBox()
  await app.mouse.move(cvb.x + cvb.width * 0.38, cvb.y + cvb.height * 0.4)
  await expect(app.getByTestId('th-river').locator('.th-tip')).toContainText(/80% of [\d,]+/)
  await shot(app, 'limits-of-its-limit')
  await app.mouse.move(2, 2)
  await scale.getByRole('button', { name: 'A USUAL DAY' }).click()
  await expect(app.getByTestId('th-var')).toContainText('183,800')
  await expectNoHorizontalOverflow(app.getByTestId('trader-home'), 'the home with limits')
  await shot(app, 'history-1440')
  expectClean(problems)
})

test('an empty book says how to begin, and a phone keeps the home it had', async ({ app, problems }) => {
  await app.setViewportSize(MONITOR)
  await app.route('**/api/trades/', route => route.fulfill({ json: [] }))
  await app.goto('/command-center')
  const home = app.getByTestId('trader-home')
  await expect(home.getByTestId('th-stand')).toContainText('No trades yet', { timeout: 30_000 })
  await expect(home.getByTestId('th-stand').locator('.dh-step')).toHaveCount(3)
  await expect(home.getByTestId('th-river')).toContainText('No risk yet')
  await expect(home.getByTestId('th-pnl').locator('.th-big')).toHaveText('—')
  await expect(home.getByTestId('th-factors')).toContainText('Nothing to measure yet.')
  await expect(home.getByTestId('th-tabs').locator('.th-tabs > [role=tab]')).toHaveText(['ON CHAIN', 'RATES', 'WEEK AHEAD', 'NEWS'])      // nothing that needs a book
  await shot(app, 'empty-1440')
  await app.setViewportSize({ width: 390, height: 844 })
  await expect(app.getByTestId('trader-home')).toHaveCount(0)
  await expect(app.locator('.dh-kpis').first()).toBeVisible({ timeout: 30_000 })
  expectClean(problems)
})

test('a stored report that misses a trade is run again once; where it cannot be, the page says what it lacks', async ({ app, problems }) => {
  test.setTimeout(180_000)
  await app.setViewportSize(MONITOR)
  await bookedSwap(app)
  const isStored = (url) => url.pathname.endsWith('/api/risk/report') && !url.search
  const isLive = (url) => url.pathname.endsWith('/api/risk/report') && url.search.includes('live=1')
  let real = null, lives = 0
  // the stored report as it would be had a trade been booked after it: made long ago, and one trade short
  let release
  const held = new Promise(r => { release = r })
  await app.route(isStored, async route => {
    const res = await route.fetch(); real = await res.json()
    await held                                                              // a slow read: the page is looked at while it waits
    await route.fulfill({ response: res, json: { ...real, generated_at: '2026-01-01T00:00:00+00:00', ladder_rows: (real.ladder_rows || []).slice(1) } })
  })
  await app.route(isLive, async route => { lives++; await route.fulfill({ status: 429, json: { detail: 'Too many live risk reports this minute.' } }) })
  await app.goto('/command-center')
  const home = app.getByTestId('trader-home')
  // while the report is on its way the page says so; it does not say the book carries no risk
  await expect(home.getByTestId('th-river')).toContainText('Measuring the book…', { timeout: 60_000 })
  await expect(home.getByTestId('th-stand')).toContainText('Measuring the book…')
  await expect(home.getByTestId('th-river')).not.toContainText('carries no risk')
  release()
  await expect(home.getByTestId('th-behind')).toContainText('It does not hold the trades booked or closed since, and could not be run again just now (it has been run too often this minute)', { timeout: 120_000 })
  await expect(home.getByTestId('th-river').locator('.th-lane').first(), 'the stored report is still drawn').toBeVisible()
  expect(lives, 'asked for once, not on every render').toBe(1)
  await shot(app, 'behind-1440')

  // and where it can be run: the live report takes the stored one's place, and nothing is said
  await app.unroute(isLive)
  await app.route(isLive, async route => { lives++; await route.fulfill({ json: { ...real, generated_at: new Date().toISOString() } }) })
  await app.reload()
  await expect(app.getByTestId('th-river').locator('.th-lane').first()).toBeVisible({ timeout: 120_000 })
  await expect(app.getByTestId('th-behind')).toHaveCount(0)
  expect(lives).toBe(2)
  expect(problems.filter(p => !/HTTP 429 GET .*live=1/.test(p)), 'nothing wrong but the refusal this journey made').toEqual([])
})

test('a curve has a limit from its first trade; its own is set on the Limits page and stands on the home at once', async ({ app, problems }) => {
  test.setTimeout(240_000)
  await app.setViewportSize(MONITOR)
  await bookedSwap(app)
  const num = (t) => Number(String(t).replace(/[^0-9.]/g, ''))
  const say = (n) => n.toLocaleString('en-US')
  await app.goto('/configurations/market-risk/limits')
  const every = app.getByTestId('every-curve'), row = every.locator('tr[data-metric="IR01:USD_SOFR"]')
  await expect(row, 'the curve the swap is on has a row').toBeVisible({ timeout: 120_000 })
  // as it starts: the standard size for a curve, as shipped
  const stdIr = app.getByTestId('standard-sizes').locator('label[data-kind="IR01"]'), chip = stdIr.locator('.pnl-chip')
  // (a run that stopped half way leaves its own limit or its own standard behind in the stack's database: put both back)
  if (await stdIr.getByRole('button', { name: 'AS SHIPPED', exact: true }).count()) { await stdIr.getByRole('button', { name: 'AS SHIPPED', exact: true }).click(); await expect(chip).toHaveText('AS SHIPPED', { timeout: 30_000 }) }
  if (await row.getByRole('button', { name: 'STANDARD', exact: true }).count()) { await row.getByRole('button', { name: 'STANDARD', exact: true }).click(); await expect(row.locator('.pnl-chip')).toHaveText('STANDARD', { timeout: 30_000 }) }
  await expect(chip).toHaveText('AS SHIPPED')
  const shipped = num(await stdIr.locator('b.fig').innerText())
  await expect(row).toContainText('STANDARD')
  await expect(row.locator('td').nth(2)).toHaveText(say(shipped))
  await shot(app, 'limits-page')

  // its own limit, sized so that the position uses about nine tenths of it
  const pos = num(await row.locator('td').nth(1).innerText())
  expect(pos, 'the swap carries IR01 on its curve').toBeGreaterThan(0)
  const own = Math.ceil(pos / 0.9 / 100) * 100
  await row.locator('input').fill(String(own))
  await row.getByRole('button', { name: 'SET', exact: true }).click()
  await expect(row).toContainText('ITS OWN', { timeout: 30_000 })
  await expect(row.locator('td').nth(2)).toHaveText(say(own))
  await expect(row).toHaveClass(/warn/)
  await shot(app, 'limits-page-own')

  // on the home at once, with no report run for it: the gauge beside the curve, the share and the room
  await app.goto('/command-center')
  const factor = app.getByTestId('th-factors').locator('.th-row[data-factor="IR:USD_SOFR"]')
  await expect(factor).toContainText(`of ${say(own)}`, { timeout: 120_000 })
  await expect(factor).not.toContainText('the standard')
  await expect(factor.getByTestId('th-gauge').locator('i')).toHaveClass(/WARN/)
  await expect(app.getByTestId('th-stand')).toContainText(/\d+ close/)
  await shot(app, 'home-own-limit')

  // back to the standard, and the standard size itself changed and put back
  await app.goto('/configurations/market-risk/limits')
  await expect(row).toContainText('ITS OWN', { timeout: 120_000 })
  await row.getByRole('button', { name: 'STANDARD', exact: true }).click()
  await expect(row).toContainText('STANDARD', { timeout: 30_000 })
  await expect(row.locator('td').nth(2)).toHaveText(say(shipped))
  await stdIr.locator('input').fill(String(shipped * 2))
  await stdIr.getByRole('button', { name: 'SET', exact: true }).click()
  await expect(chip).toHaveText(/^SET BY /, { timeout: 30_000 })
  await expect(row.locator('td').nth(2), 'a curve at the standard follows it').toHaveText(say(shipped * 2))
  await stdIr.getByRole('button', { name: 'AS SHIPPED', exact: true }).click()
  await expect(chip).toHaveText('AS SHIPPED', { timeout: 30_000 })
  await expect(row.locator('td').nth(2)).toHaveText(say(shipped))
  expectClean(problems)
})

test('the Market risk page lists what fixes, day by day: each index, the net that resets, the fixing 01, and the forwards that fix on a date', async ({ app, problems }) => {
  test.setTimeout(240_000)
  await app.setViewportSize(MONITOR)
  await bookedSwap(app)
  await app.goto('/risk')
  const panel = app.getByTestId('risk-fixings')
  await expect(panel).toContainText('FIXINGS · WHAT RESETS, DAY BY DAY', { timeout: 120_000 })
  // the stored report may be from before the fixings were part of it: run it, as the page's own button does
  if (!(await panel.getByTestId('fixings').count())) { await app.getByRole('button', { name: /RUN NOW|RECOMPUTE|RUN/ }).first().click() }
  const fix = panel.getByTestId('fixings')
  await expect(fix).toBeVisible({ timeout: 180_000 })
  // a picture an index, and the days as a table
  await expect(fix.locator('.fxg-ix[data-index="USD_SOFR"] svg rect').first()).toBeVisible()
  const rows = fix.locator('table').first().locator('tbody tr')
  await expect(rows.first()).toContainText(/(Mon|Tue|Wed|Thu|Fri) \d\d [A-Z][a-z]{2}/)
  expect(await rows.count(), 'the next ten business days, a row an index').toBeGreaterThanOrEqual(10)
  for (const h of ['FIXING', 'INDEX', 'RECEIVE', 'PAY', 'NET RESETTING', 'FIXING 01', 'TRADES']) await expect(fix.locator('table').first().locator('thead')).toContainText(h)
  // a day's net is what is received less what is paid, as written
  const cells = await rows.first().locator('td').allInnerTexts()
  const m = (t) => (t.startsWith('−') ? -1 : 1) * Number(t.replace(/[^0-9.]/g, '')) * (t.endsWith('m') ? 1 : 1e-6)
  expect(Math.abs(m(cells[2]) + m(cells[3]) - m(cells[4])), `${cells.slice(2, 5).join(' ')}`).toBeLessThanOrEqual(0.11)
  // every day of the horizon on request
  const more = fix.getByRole('button', { name: /^ALL \d+ DAYS$/ })
  const before = await rows.count()
  await more.click()
  expect(await rows.count()).toBeGreaterThan(before)
  await fix.getByRole('button', { name: 'FIRST 10 DAYS' }).click()
  expect(await rows.count()).toBe(before)
  await expect(fix).toContainText('a Friday\'s fixing counts for three days')
  await expectNoHorizontalOverflow(panel, 'the fixings on the Market risk page')
  await panel.scrollIntoViewIfNeeded(); await shot(panel, 'risk-fixings')
  expectClean(problems)
})

test('trader home: scrolled to its end, the last band is clear of the chat button', async ({ app, problems }) => {
  await app.goto('/command-center')
  const home = app.getByTestId('trader-home')
  await expect(home).toBeVisible()
  const launcher = app.locator('.ms-launcher')
  await expect(launcher).toBeVisible()
  // scroll whatever scrolls the home to its end
  await home.evaluate(el => {
    let n = el
    while (n && n !== document.documentElement) {
      if (n.scrollHeight > n.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) n.scrollTop = n.scrollHeight
      n = n.parentElement
    }
    window.scrollTo(0, document.documentElement.scrollHeight)
  })
  const last = home.locator('.th-two')
  await expect(last).toBeVisible()
  const [a, b] = [await last.boundingBox(), await launcher.boundingBox()]
  expect(a.y + a.height, 'the last band ends above the chat button').toBeLessThanOrEqual(b.y)
  await app.screenshot({ path: 'e2e/.out/shots/trader-home-end.png' })
  expectClean(problems)
})

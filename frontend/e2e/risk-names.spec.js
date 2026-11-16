// One sensitivity, one name and one sign. The home and the ticket call a spot delta FX01 on a currency and CRY01 on a
// digital asset, and the forward basis CRYBASIS01 (value for +1bp of basis). The Risk page's rows called the first
// SPOT01 and the second FUND01, with the other sign, and printed the second over the column beside it; the Limits
// page wrote "SPOT 01" (Marco, 15 November 2026). This holds the Risk screens to the home's names.
import { test, expect, expectClean } from './fixtures.js'

const whole = (n) => Math.round(Math.abs(n)).toLocaleString('en-US', { maximumFractionDigits: 0 })
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${whole(n)}`

test('the Risk page names a spot delta and a basis as the home does, with the home\'s sign', async ({ app, problems }) => {
  const answer = app.waitForResponse(r => /\/api\/risk\/report(\?|$)/.test(r.url()) && r.request().method() === 'GET' && r.ok(), { timeout: 60_000 })
  await app.goto('/risk')
  const rep = await (await answer).json()
  const rows = app.locator('.rk-rows .rk-row:not(.dim)')
  await expect(rows.first()).toBeVisible({ timeout: 60_000 })
  const page = app.locator('.rk-page')
  await expect(page).not.toContainText(/SPOT ?01|FUND01/)

  // a row with a basis: CRYBASIS01, the negative of the report's fund01, on a line of its own
  const based = rep.ladder_rows.filter(r => Math.abs(r.fund01_total || 0) >= 0.5)
  expect(based.length, 'the stack\'s book carries a digital-asset forward').toBeGreaterThan(0)
  for (const r of based.slice(0, 3)) {
    const row = rows.filter({ hasText: r.trade_ref }).first()
    await expect(row.getByTestId('rk-trade-rates')).toContainText(`${signed(0 - r.fund01_total)} CRYBASIS01`)
    for (const [asset, x] of Object.entries(r.spot01 || {})) await expect(row.getByTestId('rk-trade-spot')).toContainText(`${asset} ${signed(x)} CRY01`)
  }
  // a currency's spot delta is FX01
  const fx = rep.ladder_rows.find(r => Object.keys(r.spot01 || {}).includes('EUR'))
  if (fx) await expect(rows.filter({ hasText: fx.trade_ref }).first().getByTestId('rk-trade-spot')).toContainText(`EUR ${signed(fx.spot01.EUR)} FX01`)
  // the card over the ladder says the book's basis under the same name and sign
  if (Math.abs(rep.ladder.fund01_usd || 0) >= 0.5) await expect(page.locator('.rk-cards')).toContainText(`CRYBASIS01 ${signed(0 - rep.ladder.fund01_usd)}`)

  await app.screenshot({ path: 'e2e/.out/shots/risk-names-page.png', fullPage: true })
  // no figure is printed over the column beside it, on a monitor, a narrow window or a phone
  for (const width of [1440, 1000, 390]) {
    await app.setViewportSize({ width, height: 900 })
    const over = await rows.evaluateAll(els => els.flatMap(el => [...el.querySelectorAll('.pnl-tv')].filter(c => c.scrollWidth - c.clientWidth > 1).map(c => `${el.querySelector('.rk-ref')?.firstChild?.textContent}: ${c.textContent}`)))
    expect(over, `figures wider than their cell at ${width}px`).toEqual([])
    expect(await app.locator('.rk-rows').first().evaluate(el => el.scrollWidth - el.clientWidth), `the rows are wider than the panel at ${width}px`).toBeLessThanOrEqual(1)
    await app.locator('.rk-rows').first().screenshot({ path: `e2e/.out/shots/risk-by-trade-${width}.png` })
  }
  await app.setViewportSize({ width: 1440, height: 900 })
  // a limit is named as the home names it, not by the key it is stored under
  await expect(page.locator('.rk-limits')).not.toContainText(/SPOT01:|CRYBASIS01:|IR01:/)

  // the Limits page: the same names for the same factors
  await app.goto('/configurations/market-risk/limits')
  const limits = app.locator('.rk-page, .pnl').first()
  await expect(limits).toContainText('CRYBASIS01', { timeout: 30_000 })
  await expect(limits).not.toContainText(/SPOT ?01|spot 01|FUND01/)
  await expect(limits).toContainText(/CRY01/)
  await expect(app.locator('select option[value^="SPOT01:"]').first(), 'the picker names a spot limit as the home does').toHaveText(/ (FX01|CRY01)$/)
  await app.screenshot({ path: 'e2e/.out/shots/limits-names.png' })
  expectClean(problems)
})

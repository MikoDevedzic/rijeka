// One book, one set of numbers. The home a phone keeps (and the one a role without a home of its own sees) shows
// the book in four figures. They are the risk report's: the Risk page's own ladder, on its date. They used to be
// the brief's fact sheet, the book valued today on each pricer's own figures, and a visitor who looked at both
// screens saw two IR01s and two NPVs for one book (Marco, 15 November 2026).
import { test, expect, expectClean } from './fixtures.js'

const whole = (n) => Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

test('the home\'s four figures are the risk report\'s, to the dollar', async ({ app, problems }) => {
  await app.setViewportSize({ width: 390, height: 844 })
  const asked = app.waitForResponse(r => /\/api\/risk\/report(\?|$)/.test(r.url()) && r.request().method() === 'GET')
  await app.goto('/command-center')
  const rep = await (await asked).json()
  expect(rep.date, 'the stack has a risk report to read').toBeTruthy()
  const strip = app.getByTestId('rk')
  await expect(strip).toHaveAttribute('data-from', 'risk-report')
  const rows = rep.ladder_rows.filter(r => r.usd_rate != null)
  const npv = rows.reduce((a, r) => a + (Number(r.npv) || 0) * r.usd_rate, 0)
  const ir01 = rep.ladder.ladder.reduce((a, c) => a + (Number(c.total) || 0), 0)
  await expect(app.getByTestId('rk-npv')).toHaveText(`USD ${whole(npv)}`)
  await expect(app.getByTestId('rk-ir01')).toHaveText(whole(ir01))
  for (const [asset, v] of Object.entries(rep.ladder.spot01 || {})) if (Math.abs(v) >= 0.5) await expect(app.getByTestId('rk-spot01')).toContainText(`${asset} ${whole(v)}`)
  // and its date is the report's, as the Risk page's is
  const [y, m, d] = String(rep.date).slice(0, 10).split('-').map(Number)
  const day = new Date(y, m - 1, d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
  await expect(strip).toContainText(`ON ${day}`)
  await strip.screenshot({ path: 'e2e/.out/shots/home-strip-phone.png' })
  expectClean(problems)
})

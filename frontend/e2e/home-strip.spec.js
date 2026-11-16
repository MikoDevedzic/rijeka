// One book, one set of numbers. The home a phone keeps shows the book in four figures. They are the risk report's: the Risk page's own ladder, on its date. They used to be
// the brief's fact sheet, the book valued today on each pricer's own figures, and a visitor who looked at both
// screens saw two IR01s and two NPVs for one book (Marco, 15 November 2026).
import { test, expect, expectClean } from './fixtures.js'

const whole = (n) => Math.round(n).toLocaleString('en-US', { maximumFractionDigits: 0 })

test('the home\'s four figures are the risk report\'s, to the dollar', async ({ app, problems }) => {
  await app.setViewportSize({ width: 390, height: 844 })
  // the home reads the stored report at once and, where a trade was booked since, the live one once: the strip is
  // held to whichever the home was last given, as the trader's home on a monitor would be
  const answers = []
  app.on('response', r => { if (/\/api\/risk\/report(\?|$)/.test(r.url()) && r.request().method() === 'GET' && r.ok()) answers.push(r) })
  await app.goto('/command-center')
  const strip = app.getByTestId('rk')
  await expect(strip).toHaveAttribute('data-from', 'risk-report', { timeout: 30_000 })
  const bare = (v) => Math.round(v) === 0 ? '0' : `${v < 0 ? '−' : ''}${whole(Math.abs(v))}`      // a true minus; the currency is in the label
  const sums = (rep) => ({
    npv: rep.ladder_rows.filter(r => r.usd_rate != null).reduce((a, r) => a + (Number(r.npv) || 0) * r.usd_rate, 0),
    ir01: rep.ladder.ladder.reduce((a, c) => a + (Number(c.total) || 0), 0),
  })
  let rep = null
  await expect.poll(async () => {
    rep = await answers[answers.length - 1].json()
    const want = sums(rep)
    return [await app.getByTestId('rk-npv').textContent(), await app.getByTestId('rk-ir01').textContent()].join(' | ') === [bare(want.npv), bare(want.ir01)].join(' | ')
  }, { message: 'the strip shows the NPV and the IR01 of the report the home was last given', timeout: 30_000 }).toBe(true)
  expect(rep.date, 'the stack has a risk report to read').toBeTruthy()
  for (const [asset, v] of Object.entries(rep.ladder.spot01 || {})) if (Math.abs(v) >= 0.5) await expect(app.getByTestId('rk-spot01')).toContainText(`${asset} ${bare(v)}`)
  // its date is the report's, as the Risk page's is, and its currency is said with each figure's name
  const [y, m, d] = String(rep.date).slice(0, 10).split('-').map(Number)
  const day = new Date(y, m - 1, d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()
  await expect(strip).toContainText(`ON ${day}`)
  for (const name of ['BOOK NPV · USD', 'IR01 · USD', 'FX01/CRY01 · USD', 'THETA · USD']) await expect(strip).toContainText(name)
  // nothing in the strip is pushed past its cell on a phone
  expect(await strip.evaluate(el => el.scrollWidth - el.clientWidth), 'the strip is wider than the screen').toBeLessThanOrEqual(1)
  await strip.screenshot({ path: 'e2e/.out/shots/home-strip-phone.png' })
  expectClean(problems)
})

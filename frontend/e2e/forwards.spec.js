// A forward curve to ten years (0.22.0), as a desk uses it: points typed for four tenors of a pair, a row for every
// tenor to 10Y, each row saying whether its forward is quoted or implied and how; a tenor switched off and on; and
// the ticket marking a forward beyond the quotes as implied. The pair is SOLUSD, which no other journey prices.
import { test, expect, expectClean } from './fixtures.js'

const QUOTES = { '3M': '1.10', '6M': '2.35', '1Y': '5.10', '2Y': '11.40' }
const ALL = ['1W', '2W', '1M', '2M', '3M', '6M', '9M', '1Y', '18M', '2Y', '3Y', '4Y', '5Y', '7Y', '10Y']
const num = t => Number(String(t).replace(/,/g, ''))

test('a forward curve to ten years: quoted and implied rows, a tenor switched off, and the ticket says implied', async ({ app, problems }) => {
  test.setTimeout(120_000)
  await app.goto('/configurations/market-data/crypto')
  await app.locator('.crv-item', { hasText: 'SOLUSD' }).click()
  const table = app.getByTestId('fwd-table')
  await expect(table).toBeVisible({ timeout: 30_000 })
  const save = async () => { await app.getByRole('button', { name: /SAVE TO DB \(MANUAL\)/ }).click(); await expect(app.getByText(/SOLUSD forward curve saved/)).toBeVisible() }
  const outright = t => app.getByTestId(`fwd-outright-${t}`)
  const src = t => app.getByTestId(`fwd-src-${t}`)

  // every tenor to ten years has a row; four are quoted by the desk, the rest left empty, all four switched on
  for (const t of ALL) await expect(app.getByLabel(`${t} points`, { exact: true })).toBeVisible()
  for (const t of ALL) await app.getByLabel(`${t} points`, { exact: true }).fill(QUOTES[t] || '')
  for (const t of Object.keys(QUOTES)) { const box = app.getByTestId(`fwd-use-${t}`); if (!(await box.isChecked())) await box.click() }
  await expect(app.getByTestId('fwd-use-5Y'), 'a tenor with no points cannot be switched').toBeDisabled()
  await save()

  // a quoted row names its source; beyond the last quote the row is implied, in italics, and says how
  await expect(src('2Y')).toHaveText('MANUAL')
  await expect(src('5Y').locator('.pill')).toHaveText('IMPLIED', { timeout: 20_000 })
  await expect(src('5Y').locator('.pill')).toHaveAttribute('title', /parity plus the 2Y basis held flat as a rate/)
  await expect(outright('5Y')).toHaveAttribute('data-kind', 'IMPLIED')
  expect(await outright('5Y').evaluate(el => getComputedStyle(el).fontStyle), 'a figure that is not a quote is in italics').toBe('italic')
  expect(await outright('2Y').evaluate(el => getComputedStyle(el).fontStyle)).toBe('normal')
  const two = num(await outright('2Y').textContent()), five = num(await outright('5Y').textContent()), ten = num(await outright('10Y').textContent())
  expect(five, 'the five-year forward is not the two-year one held flat').toBeGreaterThan(two + 5)
  expect(ten).toBeGreaterThan(five)
  await expect(src('9M').locator('.pill'), 'a date between two quotes is interpolated').toHaveText('INTERPOLATED')
  await expect(app.getByTestId('fwd-implied-note')).toContainText('parity plus the 2Y basis held flat as a rate')
  await expect(app.getByTestId('fwd-implied-note')).toContainText('model')
  await app.screenshot({ path: 'e2e/.out/shots/forwards-10y.png' })

  // a quoted figure and an implied one are set alike but for what says which is which: italics on the implied one
  expect(await app.getByLabel('5Y points', { exact: true }).evaluate(el => getComputedStyle(el, '::placeholder').fontStyle), 'an implied point is shown in italics in its field').toBe('italic')
  await expect(app.getByLabel('2Y points', { exact: true }), 'saved points are shown to the pair\'s decimals').toHaveValue('11.40')
  expect(await app.getByTestId('fwd-outright-1W').textContent(), 'zero is not minus zero').not.toMatch(/^-0\.0+$/)

  // the two-year switched off: until it is saved the row says so, and shows no figure of the old curve
  await app.getByTestId('fwd-use-2Y').click()
  await expect(src('2Y').locator('.pill')).toHaveText('NOT SAVED')
  await expect(outright('2Y')).toHaveText('—')
  expect(await app.getByLabel('2Y points', { exact: true }).evaluate(el => getComputedStyle(el).textDecorationLine), 'a point switched off is struck through').toBe('line-through')
  // saved: its points stay on the row, its date is implied from the one-year, and it survives a reload
  await save()
  await expect(src('2Y').locator('.pill')).toHaveText('IMPLIED', { timeout: 20_000 })
  await expect(src('2Y').locator('.pill')).toHaveAttribute('title', /parity plus the 1Y basis held flat as a rate/)
  await expect(app.getByLabel('2Y points', { exact: true })).toHaveValue('11.40')
  await app.reload()
  await app.locator('.crv-item', { hasText: 'SOLUSD' }).click()
  await expect(app.getByTestId('fwd-use-2Y')).not.toBeChecked()
  await expect(app.getByLabel('2Y points', { exact: true })).toHaveValue('11.40')
  await expect(app.getByTestId('fwd-use-1Y')).toBeChecked()
  // and back on
  await app.getByTestId('fwd-use-2Y').click()
  await save()
  await expect(src('2Y')).toHaveText('MANUAL')

  // the ticket: a five-year forward on the pair is priced, and marked as implied beyond the quotes; a six-month one is not
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'SOLUSD' }) }).first().selectOption('SOLUSD')
  const tenor = win.getByTestId('fx-tenor')
  await expect(tenor.locator('option', { hasText: /^10Y$/ })).toHaveCount(1)
  await tenor.selectOption('5Y')
  const kind = win.getByTestId('fx-forward-kind')
  await expect(kind).toBeVisible({ timeout: 30_000 })
  await expect(kind).toHaveAttribute('data-kind', 'beyond-quotes')
  await expect(kind).toContainText('implied, not quoted')
  await expect(kind).toContainText('2Y basis held flat as a rate')
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  // the scenario tab starts from the engine's own forward: with nothing moved, nothing has changed
  await win.getByRole('button', { name: 'CURVE SCENARIO', exact: true }).click()
  await expect(win.getByTestId('fx-scenario-change')).toBeVisible({ timeout: 20_000 })
  expect(Math.abs(num((await win.getByTestId('fx-scenario-change').textContent()).replace(/[^0-9.,-]/g, '')) || 0), 'no shock, no change').toBeLessThan(0.01)
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  // a ticket at the two-year tenor is the two-year quote, though its date is a few days past the tenor's 730
  await tenor.selectOption('2Y')
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await expect(kind, 'a quoted tenor is not called implied').toHaveCount(0, { timeout: 30_000 })
  await tenor.selectOption('6M')
  await expect(kind, 'a forward inside the quotes carries no mark').toHaveCount(0, { timeout: 30_000 })
  // an option on a digital asset still stops at its last vol tenor
  await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click()
  await expect(win.getByTestId('fx-tenor').locator('option', { hasText: /^3Y$/ })).toHaveCount(0)
  await expect(win.getByTestId('fx-tenor').locator('option', { hasText: /^2Y$/ })).toHaveCount(1)
  await win.locator('.tbw-light-r').click()
  expectClean(problems)
})

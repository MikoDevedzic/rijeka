// A swaption's expiry on the ticket: a tenor out to ten years or a date typed in, the date always shown, and the
// swap the option delivers into said in words. (The field was a list of seven tenors to five years and took no
// date.) The request the ticket sends carries the option's time from the date and the delivered swap's own dates.
import { test, expect, expectClean } from './fixtures.js'

const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)

test('a swaption expires on a tenor to ten years or on a typed date, and says which swap it delivers', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.getByRole('button', { name: /^IR SWAPTION$/i }).click()
  const tenor = win.getByTestId('swaption-expiry-tenor'), date = win.getByTestId('swaption-expiry-date'), under = win.getByTestId('swaption-underlying')
  await expect(tenor.locator('option')).toHaveText(['1M', '3M', '6M', '9M', '1Y', '2Y', '3Y', '4Y', '5Y', '7Y', '10Y'])
  await expect(tenor).toHaveValue('1Y')
  await expect(date, 'the expiry\'s date is shown, not only its tenor').toHaveValue(/^\d{4}-\d{2}-\d{2}$/)
  await expect(under).toContainText(/Exercise into the swap from \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/)

  const price = async () => {
    const sent = app.waitForResponse(r => /\/api\/price\/swaption/.test(r.url()) && r.request().method() === 'POST' && r.ok(), { timeout: 90_000 })
    await win.getByRole('button', { name: '▶ PRICE' }).click()
    const r = await sent
    return { body: r.request().postDataJSON(), quote: await r.json() }
  }

  // one year: the option's time is the days to the date over 365, and the swap delivered runs five whole years
  let { body, quote } = await price()
  const expiry1 = await date.inputValue()
  expect(body.expiry_y).toBeCloseTo(days(body.valuation_date, expiry1) / 365, 9)
  expect(days(body.valuation_date, expiry1), 'a year on by the calendar').toBeGreaterThanOrEqual(365)
  expect(Number(body.maturity_date.slice(0, 4)) - Number(body.effective_date.slice(0, 4)), 'five years').toBe(5)
  expect(body.maturity_date.slice(5), 'to the day of the month it starts on').toBe(body.effective_date.slice(5))
  await expect(under).toContainText(`from ${body.effective_date} to ${body.maturity_date}`)
  const oneYear = quote.npv
  expect(oneYear).toBeGreaterThan(0)

  // ten years: offered, priced
  await tenor.selectOption('10Y')
  ;({ body, quote } = await price())
  expect(body.expiry_y).toBeGreaterThan(9.99)
  expect(body.expiry_y).toBeLessThan(10.03)
  expect(quote.npv, 'a longer option on the same swap is worth more').toBeGreaterThan(oneYear)
  expect(Number((await date.inputValue()).slice(0, 4)) - Number(body.valuation_date.slice(0, 4))).toBe(10)

  // a date typed in: the select says DATE, the request carries that date's time and the swap starting after it
  const typed = new Date(Date.parse(body.valuation_date) + 200 * 86400000)
  while ([0, 6].includes(typed.getUTCDay())) typed.setUTCDate(typed.getUTCDate() + 1)
  const iso = typed.toISOString().slice(0, 10)
  await date.fill(iso)
  await expect(tenor).toHaveValue('DATE')
  ;({ body, quote } = await price())
  expect(body.expiry_y).toBeCloseTo(days(body.valuation_date, iso) / 365, 9)
  expect(days(iso, body.effective_date), 'the swap starts the spot lag after the expiry').toBeGreaterThanOrEqual(0)
  expect(days(iso, body.effective_date)).toBeLessThanOrEqual(5)
  expect(quote.npv).toBeGreaterThan(0)
  expect(quote.npv).toBeLessThan(oneYear)

  // back to a tenor: the DATE entry goes, the date follows the tenor
  await tenor.selectOption('3M')
  await expect(tenor.locator('option', { hasText: 'DATE' })).toHaveCount(0)
  await expect(date).not.toHaveValue(iso)

  // a Bermudan takes a tenor only, and says why
  await win.getByRole('button', { name: /^BERMUDAN$/i }).click()
  await expect(date).toBeDisabled()
  await expect(under).toContainText('Bermudan: a tenor only')
  expectClean(problems)
})

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

  // a date that is not after the valuation date is not priced: the field says so and the footer gives the reason
  const before = app.waitForResponse(r => /\/api\/price\/swaption/.test(r.url()), { timeout: 4000 }).then(() => 'sent', () => 'nothing sent')
  await date.fill('2020-01-15')
  await expect(win.getByTestId('swaption-expiry-problem')).toHaveText('not after the valuation date')
  await expect(under, 'no swap is named for an expiry that is refused').toHaveCount(0)
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await expect(win.getByTestId('tbw-footer-error')).toContainText('The expiry 2020-01-15 is not after the valuation date')
  expect(await before, 'no request for an option that has expired').toBe('nothing sent')

  // a Bermudan takes a tenor only, and says why
  await tenor.selectOption('2Y')
  await win.getByRole('button', { name: /^BERMUDAN$/i }).click()
  await expect(date).toBeDisabled()
  await expect(under).toContainText('Bermudan: a tenor only')
  expectClean(problems)
})

test('a booked swaption opened from the blotter shows the dates its legs were booked with', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.getByRole('button', { name: /^IR SWAPTION$/i }).click()
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  // a date typed in, so the booking is one no tenor's rule would make
  const today = new Date().toISOString().slice(0, 10)
  const typed = new Date(Date.parse(today) + 500 * 86400000)
  while ([0, 6].includes(typed.getUTCDay())) typed.setUTCDate(typed.getUTCDate() + 1)
  const expiry = typed.toISOString().slice(0, 10)
  await win.getByTestId('swaption-expiry-date').fill(expiry)
  const priced = app.waitForResponse(r => /\/api\/price\/swaption/.test(r.url()) && r.request().method() === 'POST' && r.ok(), { timeout: 90_000 })
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const sent = (await priced).request().postDataJSON()
  const booked = app.waitForResponse(r => r.url().includes('/api/book/trade') && r.request().method() === 'POST', { timeout: 90_000 })
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  const res = await booked
  expect(res.ok(), 'the swaption is booked').toBe(true)
  const body = res.request().postDataJSON(), trade = (await res.json()).trade
  expect(body.terms).toMatchObject({ expiry_date: expiry, expiry_tenor: null })
  const fixed = body.legs.find(l => l.leg_type === 'FIXED')
  expect([fixed.effective_date, fixed.maturity_date], 'the legs are the swap the ticket priced').toEqual([sent.effective_date, sent.maturity_date])

  // opened again from the blotter: the same expiry and the same swap, read from the booking
  expect(trade.id, 'the booking answers with the trade').toBeTruthy()
  await app.goto(`/blotter?trade=${trade.id}`)
  const again = app.locator('.tbw-window')
  await again.waitFor({ timeout: 60_000 })
  await expect(again.getByTestId('swaption-expiry-date')).toHaveValue(expiry)
  await expect(again.getByTestId('swaption-expiry-date')).toBeDisabled()
  await expect(again.getByTestId('swaption-expiry-tenor')).toHaveValue('DATE')
  await expect(again.getByTestId('swaption-underlying')).toContainText(`from ${fixed.effective_date} to ${fixed.maturity_date}`)
  expectClean(problems)
})

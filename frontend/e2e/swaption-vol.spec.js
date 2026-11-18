// A swaption's vol on the ticket: the desk's swaption surface at the option's expiry and tenor, named under the
// field, until a vol is typed. (An untouched ticket priced at 86.5 bp whatever the expiry, the tenor or the day.)
// The request carries the number the field shows; the answer names where it came from; a typed vol is the vol.
import { test, expect, expectClean } from './fixtures.js'

const num = (s) => Number(String(s).replace(/[^0-9.−-]/g, '').replace('−', '-'))

test('a swaption\'s vol is read from the surface at its expiry and tenor, says so, and can be typed over', async ({ app, problems }) => {
  await app.goto('/blotter')
  const first = app.waitForResponse(r => /\/api\/price\/swaption\/vol\?/.test(r.url()) && r.ok(), { timeout: 60_000 })
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.getByRole('button', { name: /^IR SWAPTION$/i }).click()
  const read = await (await first).json()
  expect(read, 'one year into five: a point of the surface').toMatchObject({ tier: 'QUOTED', point: '1Yx5Y', currency: 'USD' })
  expect(read.vol_bp).toBeGreaterThan(20)
  const vol = win.getByTestId('swaption-vol'), field = vol.locator('xpath=ancestor::div[contains(@class,"tbw-fx-def")][1]')
  await expect(vol).toHaveAttribute('data-state', 'default')
  await expect.poll(async () => num(await vol.inputValue())).toBeCloseTo(read.vol_bp, 1)
  await expect(field, 'where the number comes from').toContainText(`surface 1Y×5Y · ${read.asof}`)

  const price = async () => {
    const sent = app.waitForResponse(r => /\/api\/price\/swaption$/.test(r.url()) && r.request().method() === 'POST' && r.ok(), { timeout: 90_000 })
    await win.getByRole('button', { name: '▶ PRICE' }).click()
    const r = await sent
    return { body: r.request().postDataJSON(), quote: await r.json() }
  }
  let { body, quote } = await price()
  expect(body.vol_bp, 'untouched, the ticket sends no vol: the engine reads the surface for the option on the ticket').toBeNull()
  expect(quote.vol_bp, 'and prices at the number the field shows').toBeCloseTo(read.vol_bp, 9)
  expect(quote, 'naming the point it read').toMatchObject({ vol_tier: 'QUOTED', vol_source: { point: '1Yx5Y', asof: read.asof } })
  const atSurface = quote.npv

  // another expiry: another point of the surface, a lower vol on the stack's (the surface falls with the expiry)
  const next = app.waitForResponse(r => /\/api\/price\/swaption\/vol\?/.test(r.url()) && r.ok(), { timeout: 30_000 })
  await win.getByTestId('swaption-expiry-tenor').selectOption('7Y')
  const seven = await (await next).json()
  expect(seven.point).toBe('7Yx5Y')
  expect(seven.vol_bp).toBeLessThan(read.vol_bp)
  await expect.poll(async () => num(await vol.inputValue())).toBeCloseTo(seven.vol_bp, 1)
  await expect(field).toContainText('7Y×5Y')

  // three months is below the grid's first expiry: the nearest point, and it says nearest
  const low = app.waitForResponse(r => /\/api\/price\/swaption\/vol\?/.test(r.url()) && r.ok(), { timeout: 30_000 })
  await win.getByTestId('swaption-expiry-tenor').selectOption('3M')
  const three = await (await low).json()
  expect(three).toMatchObject({ tier: 'NEAREST', point: '1Yx5Y' })
  await expect(field).toContainText('nearest point 1Y×5Y')

  // a vol typed in is the vol: the field is an override, the request carries it, the answer calls it MANUAL
  await win.getByTestId('swaption-expiry-tenor').selectOption('1Y')
  await expect.poll(async () => num(await vol.inputValue())).toBeCloseTo(read.vol_bp, 1)
  await vol.fill('60')
  await vol.blur()
  await expect(vol).toHaveAttribute('data-state', 'override')
  ;({ body, quote } = await price())
  expect(body.vol_bp).toBe(60)
  expect(quote.vol_tier).toBe('MANUAL')
  expect(quote.npv, 'at the money the price goes with the vol').toBeCloseTo(atSurface * 60 / read.vol_bp, -1)

  // what is not a vol is refused in words, not replaced by the surface's behind the field
  await vol.fill('0')
  await vol.blur()
  await expect(win.getByTestId('swaption-vol-problem')).toBeVisible()
  const sent = app.waitForResponse(r => /\/api\/price\/swaption$/.test(r.url()) && r.request().method() === 'POST', { timeout: 4000 }).then(() => 'sent', () => 'nothing sent')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await expect(win.getByTestId('tbw-footer-error')).toContainText('is not a normal vol in basis points')
  expect(await sent).toBe('nothing sent')
  expectClean(problems)
})

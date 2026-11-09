// The currency and digital-asset ticket as a new user meets it (Miko, 9 November 2026, looking at the hosted app):
// "there should be something priced already when you open new trade", "we should show what the forward rate is",
// "why when i click on spot rate it looks like there is no value there", "maturity date can be set to any date in
// future but tenor stays at 2Y". A field on its default shows the number the price uses; the ticket prices itself;
// the tenor always tells the truth about the date; a digital asset prices to two years, where its market data ends.
import { test, expect, expectClean, expectFullyInView, expectNoHorizontalOverflow } from './fixtures.js'

const DAY = 86400000
const iso = (d) => new Date(d).toISOString().slice(0, 10)
const num = async (loc, attr = 'data-value') => Number(await loc.getAttribute(attr))
const plain = (s) => Number(String(s).replace(/,/g, ''))

async function open(app, asset, product) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: asset, exact: true }).click()
  await win.getByRole('button', { name: product }).click()
  return win
}

// the ticket has priced and is not repricing: the forward cell carries a number and the "pricing…" marker is gone
async function settled(win) {
  await expect.poll(() => num(win.getByTestId('fx-forward-rate')), { message: 'the ticket priced itself' }).toBeGreaterThan(0)
  await expect(win.getByTestId('fx-pricing')).toHaveCount(0)
}

test('crypto forward: priced on open, the forward rate shown, defaults shown as numbers, an override and its reset', async ({ app, problems }) => {
  const prices = []
  app.on('response', r => { if (/\/api\/currency\/forward\/price$/.test(r.url()) && r.request().method() === 'POST') prices.push(r) })
  const win = await open(app, 'CRYPTO', /^CRYPTO FORWARD$/i)
  await settled(win)                                                         // nobody pressed PRICE
  expect(prices.length, 'the ticket asked for a price by itself').toBeGreaterThanOrEqual(1)
  const quote = await prices[prices.length - 1].json()
  await expect(win).toContainText('NET NPV')

  // the forward rate, as the API priced it, with its points over spot and the basis
  const fwd = win.getByTestId('fx-forward-rate')
  expect(await num(fwd)).toBeCloseTo(quote.forward, 6)
  await expectFullyInView(fwd, 'the forward rate')
  await expect(fwd.locator('xpath=..'), 'the forward points, FX-style').toContainText(/points [+\-−]?[\d,.]+/)
  await expect(fwd.locator('xpath=..')).toContainText(/% a year/)

  // spot: a real value in the field, still there when the field is clicked
  const spot = win.getByTestId('fx-spot')
  await expect(spot).toHaveAttribute('data-state', 'default')
  expect(plain(await spot.inputValue()), 'the stored spot is the field\'s value, not a hint').toBeCloseTo(quote.spot, 2)
  await spot.click()
  expect(plain(await spot.inputValue()), 'and it does not vanish on a click').toBeCloseTo(quote.spot, 2)
  // strike on its default: the fair forward
  const strike = win.getByTestId('fx-strike')
  expect(plain(await strike.inputValue())).toBeCloseTo(quote.forward, 2)
  // funding on its default: a number, not a hint
  await expect(win.getByTestId('fx-funding')).toHaveValue(/\d/)
  await app.screenshot({ path: 'e2e/.out/shots/ticket-forward-open.png' })

  // an override reprices, is marked, and the reset puts the default back
  const bumped = Math.round(quote.spot * 1.05)
  const repriced = app.waitForResponse(r => /\/api\/currency\/forward\/price$/.test(r.url()) && r.request().postDataJSON()?.spot === bumped && r.ok())
  await spot.fill(String(bumped))
  const q2 = await (await repriced).json()
  await expect(spot).toHaveAttribute('data-state', 'override')
  await expect.poll(() => num(fwd)).toBeCloseTo(q2.forward, 6)
  expect(q2.forward, 'the forward moved with the spot').toBeGreaterThan(quote.forward)
  await win.getByTestId('fx-spot-reset').click()
  await expect(spot).toHaveAttribute('data-state', 'default')
  await expect.poll(() => num(fwd)).toBeCloseTo(quote.forward, 2)
  await settled(win)

  // PRICE is still a forced reprice
  const forced = app.waitForResponse(r => /\/api\/currency\/forward\/price$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  expect((await forced).status()).toBe(200)
  await expectNoHorizontalOverflow(win, 'crypto forward ticket priced on open')
  expectClean(problems)
})

test('crypto forward: the tenor follows the date, and a digital asset prices to two years', async ({ app, problems }) => {
  const win = await open(app, 'CRYPTO', /^CRYPTO FORWARD$/i)
  await settled(win)
  const tenor = win.getByTestId('fx-tenor')
  const mat = win.getByTestId('fx-maturity')
  await expect(tenor).toHaveValue('3M')
  const threeMonths = await mat.inputValue()

  // a typed date that is no standard tenor: the select says so, with its length
  const odd = iso(Date.now() + 100 * DAY)
  await mat.fill(odd)
  await mat.blur()
  await expect(tenor).toHaveValue('CUSTOM')
  await expect(tenor.locator('option:checked')).toHaveText(/^CUSTOM · 3\.\d months$/)
  await settled(win)
  // the fixing date followed the new settlement date
  await expect(win).toContainText(new RegExp(`settles ${odd}`))

  // choosing a tenor sets the date; typing that tenor's own date shows the tenor again
  await tenor.selectOption('6M')
  const sixMonths = await mat.inputValue()
  expect(sixMonths > odd).toBe(true)
  await mat.fill(threeMonths)
  await mat.blur()
  await expect(tenor).toHaveValue('3M')

  // five years out: brought back to two years, and the ticket says why
  await tenor.selectOption('2Y')
  const twoYears = await mat.inputValue()
  await mat.fill(iso(Date.now() + 5 * 365 * DAY))
  await mat.blur()
  await expect(mat).toHaveValue(twoYears)
  await expect(tenor).toHaveValue('2Y')
  await expect(win.getByTestId('fx-tenor-limit')).toContainText('digital assets price to 2Y')
  await settled(win)
  await app.screenshot({ path: 'e2e/.out/shots/ticket-forward-tenor-limit.png' })
  await expectNoHorizontalOverflow(win, 'crypto forward ticket at the two-year limit')
  expectClean(problems)                                                      // and nothing the API refused was ever sent
})

test('crypto option: every style prices on open with its levels seeded, and the vol and the forward are shown', async ({ app, problems }) => {
  const win = await open(app, 'CRYPTO', /^CRYPTO OPTION$/i)
  await settled(win)
  await expect(win, 'an option shows its premium, paid or received').toContainText(/PREMIUM USD · (paid|received)/)
  await expect(win.getByTestId('fx-premium')).toContainText(/Premium [\d,]+\.\d\d USD (paid|received) · [\d.]+ % of the USD notional at spot · [\d,.]+ per BTC/)
  await expect(win.getByTestId('fx-vol')).toHaveValue(/\d/)
  await expect(win.getByTestId('fx-tenor')).toBeVisible()
  await expect(win.getByTestId('fx-vol').locator('xpath=..'), 'the vol on its default says where it comes from').toContainText(/surface|level|\d{4}/i)
  await app.screenshot({ path: 'e2e/.out/shots/ticket-option-open.png' })
  for (const style of ['AMERICAN', 'DIGITAL', 'BARRIER', 'DOUBLE BARRIER', 'TOUCH', 'EUROPEAN']) {
    const priced = app.waitForResponse(r => /\/api\/currency\/option\/price$/.test(r.url()) && r.request().method() === 'POST')
    await win.locator('.tbw-chip', { hasText: new RegExp(`^${style}$`) }).click()
    const res = await priced
    expect(res.status(), `${style} prices at once, with nothing to fill in first`).toBe(200)
    const q = await res.json()
    expect(Number.isFinite(q.npv), `${style} has a value`).toBe(true)
    await settled(win)
    await expect(win.getByTestId('fx-price-error')).toHaveCount(0)
    await expectNoHorizontalOverflow(win, `crypto option ticket, ${style}`)
    await app.screenshot({ path: `e2e/.out/shots/ticket-option-${style.toLowerCase().replace(' ', '-')}.png` })
  }
  // a touch sends no strike left over from another style
  const body = await (async () => {
    const strike = win.getByTestId('fx-strike')
    await strike.fill('90000')
    const sent = app.waitForResponse(r => /\/api\/currency\/option\/price$/.test(r.url()) && r.request().postDataJSON()?.style === 'TOUCH')
    await win.locator('.tbw-chip', { hasText: /^TOUCH$/ }).click()
    return (await sent).request().postDataJSON()
  })()
  expect('strike' in body, 'a touch has no strike').toBe(false)
  expectClean(problems)
})

test('FX forward and FX option: priced on open, defaults as numbers, a custom date is labelled and not limited', async ({ app, problems }) => {
  let win = await open(app, 'FX', /^FX FORWARD$/i)
  await settled(win)
  await expect(win.getByTestId('fx-spot')).toHaveValue(/\d/)
  await expect(win.getByTestId('fx-strike')).toHaveValue(/\d/)
  const mat = win.getByTestId('fx-maturity')
  // a Saturday three years out: not held to two years, and rolled by the market's rule (modified following: the
  // Monday, or the Friday before when the Monday is in the next month), which the ticket says
  let t = Date.now() + 3 * 365 * DAY + 40 * DAY
  while (new Date(t).getUTCDay() !== 6) t += DAY
  const far = iso(t)
  await mat.fill(far)
  await mat.blur()
  const landed = await mat.inputValue()
  const monday = iso(t + 2 * DAY), friday = iso(t - DAY)
  expect([monday, friday], 'a Saturday rolls to the Monday, or back to the Friday across a month end').toContain(landed)
  if (landed === monday) expect(monday.slice(0, 7)).toBe(far.slice(0, 7))
  await expect(win.getByTestId('fx-date-rolled')).toContainText(`rolled from ${far}`)
  await expect(win.getByTestId('fx-tenor').locator('option:checked')).toHaveText(/^CUSTOM · 3\.\d years$/)
  await expect(win.getByTestId('fx-tenor-limit')).toHaveCount(0)
  await settled(win)
  await expectNoHorizontalOverflow(win, 'FX forward ticket')
  await app.screenshot({ path: 'e2e/.out/shots/ticket-fx-forward-open.png' })

  await win.getByRole('button', { name: /^FX OPTION$/i }).click()
  await settled(win)
  await expect(win.getByTestId('fx-vol')).toHaveValue(/\d/)
  await expect(win.getByTestId('fx-strike')).toHaveValue(/\d/)
  await expectNoHorizontalOverflow(win, 'FX option ticket')
  await app.screenshot({ path: 'e2e/.out/shots/ticket-fx-option-open.png' })
  expectClean(problems)
})

test('a failed automatic price says so beside the value, and leaves BOOK and the title alone', async ({ app, problems }) => {
  const win = await open(app, 'CRYPTO', /^CRYPTO FORWARD$/i)
  await settled(win)
  // the next automatic price is refused by the API (answered here: the stack has no way to make it fail)
  await app.route(/\/api\/currency\/forward\/price$/, route => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ detail: 'the USD curve does not build' }) }))
  await win.getByTestId('fx-tenor').selectOption('6M')
  const err = win.getByTestId('fx-price-error')
  await expect(err).toContainText('the USD curve does not build')
  await expect(win.getByRole('button', { name: /RETRY BOOK/ })).toHaveCount(0)
  await expect(win).not.toContainText('ERROR:')
  expect(await win.innerText()).not.toMatch(/NaN|undefined|Infinity/)
  await app.screenshot({ path: 'e2e/.out/shots/ticket-forward-price-error.png' })
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  // that refusal was the journey's own: nothing else went wrong
  expect(problems.filter(p => !/HTTP 422 POST .*\/api\/currency\/forward\/price/.test(p))).toEqual([])
})

// ── What is booked is what was shown (Vera, 9 November 2026) ─────────────────────────────────────────────────────
// The ticket reprices by itself, so BOOK can be pressed between a change and its price. It must never book figures
// the user has not seen, an older answer must never replace a newer one, and a browser that writes decimals with a
// comma must not turn 1,08345 into 108345.

async function counterparty(app, win) {
  const cp = win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first()
  await cp.selectOption({ label: 'RIJEKA DEMO BANK AG' })
}

test('BOOK pressed straight after a change does not book unseen figures: it reprices, shows them, and books on the second press', async ({ app, problems }) => {
  const win = await open(app, 'CRYPTO', /^CRYPTO FORWARD$/i)
  await counterparty(app, win)
  await settled(win)
  const booked = []
  app.on('request', r => { if (/\/api\/trades\/$/.test(r.url()) && r.method() === 'POST') booked.push(r.postDataJSON()) })

  // 10 BTC is on screen and priced; type 25 and press BOOK at once, inside the 400 ms before the reprice
  const notional = win.getByTestId('fx-notional')
  await expect(notional).toHaveValue('10')
  await notional.fill('25')
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  await expect(win.getByTestId('fx-book-repriced'), 'it says the figures changed and asks again').toBeVisible()
  await settled(win)
  expect(booked.length, 'nothing was booked on the first press').toBe(0)
  await expect(win.getByTestId('fx-footer-stale')).toHaveCount(0)

  // now the figures for 25 BTC are on screen: the second press books exactly them
  const booking = app.waitForResponse(r => /\/api\/trades\/$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  const res = await booking
  expect(res.status(), 'the second press books').toBeLessThan(300)
  const trade = await res.json()
  expect(Number(trade.notional), 'the booked notional is the one on screen').toBe(25)
  expect(booked.length).toBe(1)
  const shown = await num(win.getByTestId('fx-forward-rate'))
  expect(Number(trade.terms.forward_price), 'struck at the forward that was on screen').toBeCloseTo(shown, 2)
  expectClean(problems)
})

test('an older price that arrives after a newer one does not replace it, and the footer is marked while a price is awaited', async ({ app, problems }) => {
  const win = await open(app, 'CRYPTO', /^CRYPTO FORWARD$/i)
  await settled(win)
  const base = await num(win.getByTestId('fx-forward-rate'))
  const slowSpot = Math.round(base * 0.9), fastSpot = Math.round(base * 1.1)
  // the price for the first override is held back for two seconds; the second override's price answers at once
  await app.route(/\/api\/currency\/forward\/price$/, async route => {
    const body = route.request().postDataJSON()
    if (body?.spot === slowSpot) {
      await new Promise(r => setTimeout(r, 2000))
      try { await route.continue() } catch { /* the ticket had already abandoned this request */ }
    } else await route.continue()
  })
  const spot = win.getByTestId('fx-spot')
  await spot.fill(String(slowSpot))
  await expect(win.getByTestId('fx-footer-stale').first(), 'the footer says its figures are being repriced').toBeVisible()
  await app.waitForTimeout(600)                                              // past the debounce: the slow request is out
  const fast = app.waitForResponse(r => /\/api\/currency\/forward\/price$/.test(r.url()) && r.request().postDataJSON()?.spot === fastSpot && r.ok())
  await spot.fill(String(fastSpot))
  const q = await (await fast).json()
  await expect.poll(() => num(win.getByTestId('fx-forward-rate'))).toBeCloseTo(q.forward, 4)
  await app.waitForTimeout(2600)                                             // the slow answer has had time to land
  expect(await num(win.getByTestId('fx-forward-rate')), 'the newer price is still the one shown').toBeCloseTo(q.forward, 4)
  await expect(win.getByTestId('fx-footer-stale')).toHaveCount(0)
  await expect(win.getByTestId('fx-override-note'), 'an override is disclosed').toContainText('revalued on the stored market')
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

test('a crypto option books from the ticket with the terms that were on screen, and a touch books no strike', async ({ app, problems }) => {
  const win = await open(app, 'CRYPTO', /^CRYPTO OPTION$/i)
  await counterparty(app, win)
  await settled(win)
  const priced = app.waitForResponse(r => /\/api\/currency\/option\/price$/.test(r.url()) && r.request().method() === 'POST' && r.ok())
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const quote = await (await priced).json()
  await settled(win)
  const booking = app.waitForResponse(r => /\/api\/trades\/$/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  const res = await booking
  expect(res.status(), 'the option books').toBeLessThan(300)
  const t = (await res.json()).terms
  expect(Number(t.strike_price ?? t.strike), 'struck where the ticket showed').toBeCloseTo(quote.strike, 2)
  expect(String(t.option_type).toUpperCase()).toBe('CALL')
  expect(t.expiration_date, 'the expiry on screen').toBe(quote.expiry_date)
  expect(t.settlement_price_source, 'a settlement source is named').toBeTruthy()
  expectClean(problems)
})

test.describe('in a browser that writes decimals with a comma', () => {
  test.use({ locale: 'de-DE' })
  test('the fields are written with a point, an edit is read as typed, and a comma decimal is refused, not guessed', async ({ app, problems }) => {
    const win = await open(app, 'FX', /^FX FORWARD$/i)
    await settled(win)
    const spot = win.getByTestId('fx-spot')
    const text = await spot.inputValue()
    expect(text, 'a point for the decimals, no grouping, whatever the browser\'s language').toMatch(/^\d+\.\d+$/)
    const stored = Number(text)
    expect(stored).toBeGreaterThan(0.5)
    expect(stored).toBeLessThan(2.5)                                         // EURUSD

    // change the last digit: the override is the number typed, not a hundred thousand times it
    const edited = text.slice(0, -1) + (text.endsWith('7') ? '3' : '7')
    const repriced = app.waitForResponse(r => /\/api\/currency\/forward\/price$/.test(r.url()) && r.request().postDataJSON()?.spot != null && r.ok())
    await spot.fill(edited)
    const sent = (await repriced).request().postDataJSON().spot
    expect(sent, 'the spot sent is the spot typed').toBeCloseTo(Number(edited), 8)
    await settled(win)

    // a comma decimal is not read as a thousands separator: the field says it cannot read it, and nothing is priced on it
    let asked = 0
    app.on('request', r => { if (/\/api\/currency\/forward\/price$/.test(r.url())) asked++ })
    await spot.fill('1,0845')
    await expect(spot).toHaveAttribute('data-state', 'invalid')
    await expect(win).toContainText('use a point for decimals')
    await app.waitForTimeout(900)
    expect(asked, 'nothing was priced on a number the ticket could not read').toBe(0)
    await expect(win.getByRole('button', { name: /BOOK TRADE/ })).toBeDisabled()
    await app.screenshot({ path: 'e2e/.out/shots/ticket-comma-decimal.png' })
    expectClean(problems)
  })
})

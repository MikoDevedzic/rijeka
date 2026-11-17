// An amendment from the ticket. A booked trade's terms are locked on TRADE; they are changed from the CONFIRM tab:
// a pending booking is corrected, a confirmed trade amended. On this stack there is no chain, so the booking changes
// and the ticket says no record on a chain was signed for it.
import { test, expect, expectClean, expectNoHorizontalOverflow, bookedSwap } from './fixtures.js'

const num = (s) => Number(String(s).replace(/,/g, ''))

test('a pending swap is corrected and a confirmed one amended from the CONFIRM tab: the terms now, the new ones, and the ticket reopened on them', async ({ app, problems }) => {
  const win = await bookedSwap(app)                       // pending, on the CONFIRM tab
  const block = win.getByTestId('amend-terms')
  await expect(block).toBeVisible()
  await expect(win.getByTestId('amend-open')).toHaveText('◆ CORRECT THE BOOKING')
  await win.getByTestId('amend-open').click()
  await expect(win.getByTestId('amend-what')).toContainText('recorded as a correction')
  await expect(win.getByTestId('amend-what')).toContainText('keeps its reference and its UTI')
  const nowOf = async key => num((await win.getByTestId(`amend-term-${key}`).innerText()).match(/now\s+(-?[\d,.]+)/)[1])
  const [n0, c0] = [await nowOf('notional'), await nowOf('fixed_rate')]
  expect(n0, 'the form says what the notional is now').toBeGreaterThan(0)
  expect(c0, 'and the coupon, in percent').toBeGreaterThan(0)

  // what cannot be: nothing typed, a notional that goes down, a coupon that is not a number
  const submit = win.getByTestId('amend-submit')
  await expect(submit).toBeDisabled()
  await win.getByTestId('amend-notional').fill(String(n0 / 2))
  await expect(win.getByTestId('amend-problem')).toContainText('partially terminate')
  await expect(submit).toBeDisabled()
  await win.getByTestId('amend-notional').fill('')
  await win.getByTestId('amend-fixed_rate').fill('3,5x')
  await expect(win.getByTestId('amend-problem')).toContainText('is a number')

  // the coupon was mistyped: a quarter point more
  const c1 = Math.round((c0 + 0.25) * 1e6) / 1e6
  await win.getByTestId('amend-fixed_rate').fill(String(c1))
  await win.getByTestId('amend-reason').fill('coupon mistyped')
  await expect(win.getByTestId('amend-problem')).toHaveCount(0)
  await expectNoHorizontalOverflow(block, 'the amend form')
  await app.screenshot({ path: 'e2e/.out/shots/amend-form.png' })
  let sent = app.waitForResponse(r => r.url().includes('/api/chain/amend-terms/') && r.request().method() === 'POST')
  await submit.click()
  let res = await sent
  expect(res.status()).toBe(201)
  expect(res.request().postDataJSON()).toEqual({ terms: { fixed_rate: String(c1) }, reason: 'coupon mistyped' })
  let j = await res.json()
  expect(j.amendment).toMatchObject({ kind: 'CORRECTION', anchored: false, reason: 'coupon mistyped' })
  expect(j.trade.status).toBe('PENDING')
  expect(num(j.legs.find(l => l.leg_type === 'FIXED').fixed_rate)).toBeCloseTo(c1 / 100, 8)

  // the ticket is opened again on the trade as it now stands, on this tab, and says what was done
  const done = win.getByTestId('amend-done')
  await expect(done).toContainText(`Corrected: FIXED RATE ${c0} → ${c1} %`)
  await expect(done).toContainText('no record on a chain was signed for it')
  await expect(done).toContainText('coupon mistyped')
  await expect(app.locator('.tbw-window'), 'one ticket, not two').toHaveCount(1)
  await app.screenshot({ path: 'e2e/.out/shots/amend-done.png' })
  // its own fields are the corrected trade's, and still locked
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  await expect(win.getByTestId('tbw-terms')).toHaveJSProperty('disabled', true)
  const typed = await win.locator('input').evaluateAll(els => els.map(e => Number(String(e.value).replace(/,/g, ''))))
  expect(typed.some(v => Math.abs(v - c1) < 1e-6), 'the TRADE tab shows the corrected coupon').toBe(true)
  expect(typed.some(v => Math.abs(v - c0) < 1e-6), 'and not the one before').toBe(false)

  // confirmed (this stack signs both sides, on no chain): the same control is an amendment, and the notional goes up
  await win.getByRole('button', { name: '◆ CONFIRM' }).click()
  const confirmed = app.waitForResponse(r => r.url().includes('/api/chain/confirm/'), { timeout: 60_000 })
  await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click()
  expect([201, 202]).toContain((await confirmed).status())
  await expect(win).toContainText('TRADE HASH', { timeout: 60_000 })
  await expect(win.getByTestId('amend-open')).toHaveText('◆ AMEND')
  await win.getByTestId('amend-open').click()
  await expect(win.getByTestId('amend-what')).toContainText('no record anchored on a chain')
  expect(await nowOf('fixed_rate'), 'the form reads the trade as it now stands').toBeCloseTo(c1, 6)
  const n1 = n0 * 1.5
  await win.getByTestId('amend-notional').fill(n1.toLocaleString('en-US'))
  sent = app.waitForResponse(r => r.url().includes('/api/chain/amend-terms/') && r.request().method() === 'POST')
  await win.getByTestId('amend-submit').click()
  res = await sent
  expect(res.status()).toBe(201)
  expect(res.request().postDataJSON()).toEqual({ terms: { notional: String(n1) } })
  j = await res.json()
  expect(j.amendment).toMatchObject({ kind: 'AMENDMENT', anchored: false, increase: true })
  expect(num(j.trade.notional)).toBe(n1)
  for (const leg of j.legs) expect(num(leg.notional), 'every leg moved with the trade').toBe(n1)
  await expect(win.getByTestId('amend-done')).toContainText(`Amended: NOTIONAL ${n0.toLocaleString('en-US')} → ${n1.toLocaleString('en-US')}`)
  await expect(win.getByTestId('amend-done')).toContainText('(an increase)')
  await expect(win, 'the record that was signed is still shown').toContainText('TRADE HASH')
  await expect(app.locator('.tbw-window')).toHaveCount(1)
  // the blotter reads the booking
  await win.getByTestId('tbw-close').click()
  await expect(app.locator('.bl-root tbody tr', { hasText: j.trade.trade_ref }).first()).toContainText(n1.toLocaleString('en-US'))
  expectClean(problems)
})

// A partial termination from the ticket. On this stack there is no chain, so the booking is reduced and the ticket
// says no record on a chain was signed for it; the anchored case is e2e/chain/partial-anchored.spec.js.
import { test, expect, expectClean, expectNoHorizontalOverflow, bookedSwap } from './fixtures.js'

const num = (s) => Number(String(s).replace(/,/g, ''))

test('a booked swap is partially terminated from its CONFIRM tab: the notional that remains, an unwind fee, and the booking reduced', async ({ app, problems }) => {
  const win = await bookedSwap(app)                       // pending, on the CONFIRM tab
  const block = win.getByTestId('partial-termination')
  await expect(block).toBeVisible()
  await win.getByTestId('partial-open').click()
  const now = num((await block.innerText()).match(/now\s+([\d,.]+)/)[1])
  expect(now, 'the block says what the notional is now').toBeGreaterThan(0)

  // what cannot be: the whole notional or more is refused in words before anything is sent
  const submit = win.getByTestId('partial-submit')
  await expect(submit).toBeDisabled()
  await win.getByTestId('partial-remaining').fill(String(now))
  await expect(win.getByTestId('partial-problem')).toContainText("below the trade's")
  await expect(submit).toBeDisabled()
  await win.getByTestId('partial-remaining').fill('0')
  await expect(win.getByTestId('partial-problem')).toContainText('above zero')

  // 40 % remains, and we receive a fee for the unwind
  const remains = now * 0.4
  await win.getByTestId('partial-remaining').fill(remains.toLocaleString('en-US'))
  await win.getByTestId('partial-fee-receive').click()
  await win.getByTestId('partial-fee-amount').fill('12,500')
  await expect(win.getByTestId('partial-problem')).toHaveCount(0)
  await expectNoHorizontalOverflow(block, 'the partial termination form')
  await app.screenshot({ path: 'e2e/.out/shots/partial-termination-form.png' })
  const sent = app.waitForResponse(r => r.url().includes('/api/chain/partial-terminate/') && r.request().method() === 'POST')
  await submit.click()
  const res = await sent
  expect(res.status()).toBe(201)
  const body = res.request().postDataJSON()
  expect(body).toEqual({ new_notional: String(remains), fee: { direction: 'RECEIVE', amount: 12500, date: new Date().toISOString().slice(0, 10) } })
  const j = await res.json()
  expect(num(j.trade.notional)).toBe(remains)
  for (const leg of j.legs) expect(num(leg.notional), 'every leg moved with the trade').toBe(remains)
  expect(j.trade.status).toBe('PENDING')
  expect(j.partial_termination.anchored).toBe(false)
  const fee = j.trade.terms.fees.at(-1)
  expect([fee.type, fee.direction, fee.amount]).toEqual(['UNWIND', 'RECEIVE', 12500])

  // the ticket is opened again on the trade as it now stands, on this tab, and says what was done
  const done = win.getByTestId('partial-done')
  await expect(done).toContainText(`Reduced from ${now.toLocaleString('en-US')} to ${remains.toLocaleString('en-US')}`)
  await expect(done).toContainText('unwind fee received 12,500')
  await expect(done).toContainText('no record on a chain was signed for it')
  await expect(app.locator('.tbw-window'), 'one ticket, not two').toHaveCount(1)
  await win.getByTestId('partial-open').click()
  await expect(win.getByTestId('partial-now')).toContainText(`now ${remains.toLocaleString('en-US')}`)
  await app.screenshot({ path: 'e2e/.out/shots/partial-termination-done.png' })
  // and its own fields and figures are the reduced trade's: the notional on TRADE, and a value that is 40 % of what it was
  await win.getByRole('button', { name: 'TRADE', exact: true }).click()
  const typed = await win.locator('input').evaluateAll(els => els.map(e => e.value))
  expect(typed, 'the TRADE tab shows the notional that remains').toContain(remains.toLocaleString('en-US'))
  expect(typed, 'and not the one before').not.toContain(now.toLocaleString('en-US'))
  await app.screenshot({ path: 'e2e/.out/shots/partial-termination-trade-tab.png' })
  expectClean(problems)
})

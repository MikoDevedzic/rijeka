// What can be pressed, typed into or pointed at looks like it (docs/design.md, "Buttons, fields, rows"): a
// button is raised, a field is a lighter well with a brass ring while it is typed in, a row answers the pointer.
// Read from the computed style, on the ticket, the blotter and a page of each other family of button.
import { test, expect, expectClean } from './fixtures.js'

const selectDemoBank = (app, win) => win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
const css = (loc, prop) => loc.evaluate((el, p) => getComputedStyle(el)[p], prop)
const RAISED = 'rgb(33, 73, 63)', WELL = 'rgb(26, 58, 51)', WELL_FOCUS = 'rgb(34, 74, 65)', BAND = 'rgb(27, 61, 53)', BRASS_HI = 'rgb(241, 212, 136)'

test('buttons are raised, fields are wells with a ring in focus, and the row under the pointer is lit', async ({ app, problems }) => {
  // the blotter: the trade under the pointer is a band with a rule at its edge; the search box is a well
  await app.goto('/blotter')
  const row = app.locator('.bl-row').first()                // the seed's own trade: a fresh stack may have no second one yet
  await expect(row).toBeVisible()
  expect(await css(row, 'backgroundColor'), 'a row at rest has no band').not.toBe(BAND)
  await row.hover()
  await expect.poll(() => css(row, 'backgroundColor')).toBe(BAND)
  expect(await css(row.locator('td').first(), 'boxShadow'), 'and a rule at the edge of its first cell').toMatch(/inset/)
  expect(await css(app.locator('.bl-search'), 'backgroundColor')).toBe(WELL)

  // the ticket: the legs' buttons are raised and go down when pressed; a strike is a well, ringed in brass while typed in
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value')), { timeout: 30_000 }).toBeGreaterThan(0)
  expect(await css(win.locator('select').first(), 'backgroundColor'), 'a choice on TRADE is a well').toBe(WELL)
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  const add = win.getByTestId('fx-legs-add')
  expect(await css(add, 'backgroundColor')).toBe(RAISED)
  expect(await css(add, 'boxShadow'), 'it stands on a foot').not.toBe('none')
  // a button that cannot be pressed is flat: BOOK on a ticket with no counterparty is not this case (it is brass),
  // so the rule is read where it is: a disabled raised button has no face
  expect(await win.locator('.tbw-btn-price').evaluate(el => { const c = el.cloneNode(true); c.disabled = true; el.parentNode.appendChild(c); const s = getComputedStyle(c); const out = [s.backgroundColor, s.boxShadow]; c.remove(); return out })).toEqual(['rgba(0, 0, 0, 0)', 'none'])
  await add.hover()
  await expect.poll(() => css(add, 'backgroundColor'), { message: 'it lifts under the pointer' }).not.toBe(RAISED)
  await add.click()
  const strike = win.getByTestId('fx-leg').nth(0).getByLabel('Strike of leg 2')
  await app.mouse.move(5, 5)
  await expect.poll(() => css(strike, 'backgroundColor')).toBe(WELL)
  await strike.focus()
  await expect.poll(() => css(strike, 'backgroundColor')).toBe(WELL_FOCUS)
  await expect.poll(() => css(strike, 'outlineColor')).toBe(BRASS_HI)
  expect(await css(strike, 'outlineStyle')).toBe('solid')
  // the row of a leg answers the pointer too
  const leg = win.getByTestId('fx-leg').nth(0)
  await leg.hover()
  await expect.poll(() => css(leg, 'backgroundColor')).toBe(BAND)
  // brass is still the one action, and PRICE is an ordinary button
  expect(await css(win.locator('.tbw-btn-book'), 'backgroundColor')).toBe('rgb(217, 178, 92)')
  expect(await css(win.locator('.tbw-btn-price'), 'backgroundColor')).toBe(RAISED)
  await win.locator('.tbw-light-r').click()

  // the other families: a P&L button, a workbook button, the methodology's own
  await app.goto('/pnl')
  const pnl = app.locator('.pnl-btn:not(.ghost):not(:disabled)').first()
  await expect(pnl).toBeVisible()
  expect(await css(pnl, 'backgroundColor')).toBe(RAISED)
  // one that cannot be pressed just now is flat
  const off = app.locator('.pnl-btn:not(.ghost):disabled').first()
  if (await off.count()) expect(await css(off, 'boxShadow')).toBe('none')
  await app.goto('/methodology/replications')
  const doc = app.locator('.doc-btn').first()
  await expect(doc).toBeVisible({ timeout: 20_000 })
  expect(await css(doc, 'backgroundColor')).toBe(RAISED)
  expect(await css(app.locator('.mr-btn').first(), 'backgroundColor')).toBe(RAISED)
  expectClean(problems)
})

// Reported by the owner on 11 November 2026: on the new trade's front page BUY and SELL were the same colour, and
// the same as CALL and PUT. A side has a colour (selling or paying coral, buying or receiving green); a type has
// none; and the chip that is selected is told from the one that is not by more than a shade.
test('a side has its colour, a type has none, and the selected chip stands out', async ({ app, problems }) => {
  const UP = 'rgb(143, 224, 174)', DOWN = 'rgb(240, 130, 140)'
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'CRYPTO', exact: true }).click()
  await win.getByRole('button', { name: /^CRYPTO OPTION$/i }).click()
  const buy = win.getByRole('button', { name: /^Buy /i }).first(), sell = win.getByRole('button', { name: /^Sell /i }).first()
  const call = win.getByRole('button', { name: 'CALL', exact: true }), put = win.getByRole('button', { name: 'PUT', exact: true })
  await app.mouse.move(5, 5)
  await expect(buy).toHaveClass(/is-on/)
  await expect.poll(() => css(buy, 'color'), { message: 'buying is green' }).toBe(UP)
  expect(await css(sell, 'color'), 'the side not chosen has no colour').not.toBe(DOWN)
  await sell.click()
  await app.mouse.move(5, 5)
  await expect.poll(() => css(sell, 'color'), { message: 'selling is coral' }).toBe(DOWN)
  expect(await css(buy, 'color')).not.toBe(UP)
  // a type is not a side: the selected one is lit and ruled, in no colour of a sign
  await expect(call).toHaveClass(/is-on/)
  const [onFace, offFace] = [await css(call, 'backgroundColor'), await css(put, 'backgroundColor')]
  expect(onFace, 'the selected type has a face of its own').not.toBe(offFace)
  expect(await css(call, 'boxShadow'), 'and a rule under it').toMatch(/inset/)
  expect(await css(put, 'boxShadow')).not.toMatch(/inset/)
  for (const c of [UP, DOWN]) expect(await css(call, 'color')).not.toBe(c)
  await win.locator('.tbw-light-r').click()

  // the swap's direction: paying coral, receiving green
  await app.getByText('+ NEW TRADE').first().click()
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.getByRole('button', { name: /^IR SWAP$/i }).click()
  const pay = win.getByRole('button', { name: /^PAY/ }).first(), rec = win.getByRole('button', { name: /^RECEIVE/ }).first()
  await app.mouse.move(5, 5)
  await expect.poll(() => css(pay, 'color')).toBe(DOWN)
  await rec.click()
  await app.mouse.move(5, 5)
  await expect.poll(() => css(rec, 'color')).toBe(UP)
  expect(await css(pay, 'color')).not.toBe(DOWN)
  expectClean(problems)
})

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
  // The page's buttons read WORKING… and cannot be pressed until the day's attribution is back. On the journeys'
  // shared database, which keeps every run's trades (390 of them on 17 November 2026), that took more than the
  // default twenty seconds in three full runs of four; a fresh database, as in CI, answers in a few.
  const t0 = Date.now()
  await expect(pnl).toBeVisible({ timeout: 120_000 })
  console.log(`P&L buttons pressable after ${Math.round((Date.now() - t0) / 1000)} s`)
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
// none; and the chip that is selected is told from the one that is not by more than a shade. Since 0.66.3 a chosen
// side is a solid face in its colour with the page's dark for its word (the owner, 23 November 2026: the tint was
// too faint): the colour is read from the face of a chip, and still from the word of a leg's own toggle.
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
  await expect.poll(() => css(buy, 'backgroundColor'), { message: 'buying is green' }).toBe(UP)
  expect(await css(buy, 'color'), 'its word is the dark of the page, read on the green').toBe('rgb(11, 29, 26)')
  for (const prop of ['backgroundColor', 'color']) expect(await css(sell, prop), 'the side not chosen has no colour').not.toBe(DOWN)
  await sell.click()
  await app.mouse.move(5, 5)
  await expect.poll(() => css(sell, 'backgroundColor'), { message: 'selling is coral' }).toBe(DOWN)
  for (const prop of ['backgroundColor', 'color']) expect(await css(buy, prop)).not.toBe(UP)
  // a type is not a side: the selected one is lit and ruled, in no colour of a sign
  await expect(call).toHaveClass(/is-on/)
  const [onFace, offFace] = [await css(call, 'backgroundColor'), await css(put, 'backgroundColor')]
  expect(onFace, 'the selected type has a face of its own').not.toBe(offFace)
  expect(await css(call, 'boxShadow'), 'and a rule under it').toMatch(/inset/)
  expect(await css(put, 'boxShadow')).not.toMatch(/inset/)
  for (const c of [UP, DOWN]) for (const prop of ['color', 'backgroundColor']) expect(await css(call, prop)).not.toBe(c)
  await win.locator('.tbw-light-r').click()

  // the swap's direction: paying coral, receiving green
  await app.getByText('+ NEW TRADE').first().click()
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.getByRole('button', { name: /^IR SWAP$/i }).click()
  const pay = win.getByRole('button', { name: /^PAY/ }).first(), rec = win.getByRole('button', { name: /^RECEIVE/ }).first()
  await app.mouse.move(5, 5)
  await expect.poll(() => css(pay, 'backgroundColor')).toBe(DOWN)
  await rec.click()
  await app.mouse.move(5, 5)
  await expect.poll(() => css(rec, 'backgroundColor')).toBe(UP)
  expect(await css(pay, 'backgroundColor')).not.toBe(DOWN)
  await win.locator('.tbw-light-r').click()

  // a leg's side on DETAILS takes the same two colours
  await app.getByText('+ NEW TRADE').first().click()
  await win.waitFor()
  await win.getByRole('button', { name: 'DETAILS', exact: true }).click()
  await win.getByTestId('fx-legs-add').click()
  const side = win.getByLabel('Side of leg 2')
  const first = await css(side, 'color')
  expect([UP, DOWN], 'a leg is bought or sold, in that colour').toContain(first)
  await side.click()
  await expect.poll(() => css(side, 'color')).toBe(first === UP ? DOWN : UP)
  expectClean(problems)
})

// Reported by the owner on 11 November 2026: on the forwards page the points typed in looked a different size from
// the outright beside them, and the page's figures were not set like the ticket's. A figure is mono at 12.5px
// wherever it is, and a field is set like the figure beside it (docs/design.md, "Figures").
test('a figure is set one way: the forwards page, the ticket, and a field like the figure beside it', async ({ app, problems }) => {
  const face = loc => loc.evaluate(el => { const s = getComputedStyle(el); return [s.fontFamily.split(',')[0].replace(/["']/g, '').trim(), s.fontSize] })
  await app.goto('/configurations/market-data/crypto')
  const table = app.getByTestId('fwd-table')
  await expect(table).toBeVisible({ timeout: 30_000 })
  await app.getByRole('button', { name: 'FILL FROM PARITY' }).click()
  const cells = table.locator('> div')
  const points = table.locator('input.qi').first()
  await expect(points).not.toHaveValue('')
  // nine columns since 0.22.0 (the switch first): the first tenor's row starts at cell 9
  const outright = app.getByTestId('fwd-outright-1W'), parity = cells.nth(9 + 6), tenor = cells.nth(9 + 1)
  await expect(outright).toHaveText(/\d/)
  expect(await face(points), 'the points typed in are set like the outright').toEqual(await face(outright))
  expect(await face(outright)).toEqual(['DM Mono', '12.5px'])
  expect(await face(parity)).toEqual(['DM Mono', '12.5px'])
  expect(await face(tenor)).toEqual(['DM Mono', '12.5px'])
  expect(await css(parity, 'color'), 'what parity implies is not the blue of a chart').not.toBe('rgb(143, 193, 230)')
  expect(await css(tenor, 'color'), 'a tenor is not brass').not.toBe('rgb(217, 178, 92)')
  // the size of type does not depend on the width of the window
  const at = await app.evaluate(() => getComputedStyle(document.documentElement).fontSize)
  await app.setViewportSize({ width: 2400, height: 1200 })
  expect(await app.evaluate(() => getComputedStyle(document.documentElement).fontSize)).toBe(at)
  await app.setViewportSize({ width: 1440, height: 900 })

  // the ticket: a date is set in the face of the notional beside it
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  const notional = win.getByTestId('fx-notional'), date = win.locator('input[type="date"]').first()
  expect((await face(date))[0], 'a date is a figure').toBe((await face(notional))[0])
  expect((await face(date))[0]).toBe('DM Mono')
  expectClean(problems)
})

// 0.66.3. The owner, of the ticket the night before the launch: the chosen side too faint, the rest dull. The
// brass follows the next step (PRICE until a price is held, then BOOK TRADE, never both); a chosen side is a solid
// face; a selected chip and the selected tab carry the brass rule; a section's heading has its bar.
test('on a ticket the brass is the next step, a chosen side is solid, and what is selected is ruled in brass', async ({ app, problems }) => {
  const BRASS = 'rgb(217, 178, 92)', BRASS_DIM = 'rgb(125, 103, 49)', UP = 'rgb(143, 224, 174)', DOWN = 'rgb(240, 130, 140)', INK = 'rgb(11, 29, 26)'
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  const rates = win.getByRole('button', { name: 'RATES', exact: true })
  await rates.click()
  const price = win.locator('.tbw-btn-price'), book = win.locator('.tbw-btn-book')

  // no price yet: PRICE is the one lit button, BOOK is not
  await expect(price).toHaveClass(/is-next/)
  await app.mouse.move(5, 5)
  await expect.poll(() => css(price, 'backgroundColor'), { message: 'PRICE is the action of an unpriced ticket' }).toBe(BRASS)
  expect(await css(book, 'backgroundColor'), 'and BOOK is not lit beside it').not.toBe(BRASS)

  // what is selected: the instrument's chip and the tab, in the brass of a selection; a heading has its bar
  expect(await css(rates, 'borderTopColor'), 'a selected chip has a brass edge').toBe(BRASS_HI)
  expect(await css(rates, 'boxShadow'), 'and a brass rule under it').toContain(BRASS)
  const tab = win.locator('.tbw-tab.is-active')
  expect(await css(tab, 'color')).toBe(BRASS_HI)
  expect(await css(tab, 'borderBottomColor')).toBe(BRASS)
  const heading = win.locator('.tbw-sec > .tbw-lbl:first-child, .tbw-sec > .tbw-sec-header > .tbw-lbl').first()
  expect(await css(heading, 'borderLeftColor'), 'a section heading carries a bar').toBe(BRASS_DIM)
  expect(await css(heading, 'color'), 'and its words are not brass').not.toBe(BRASS)

  // a chosen side is a solid face in its colour, its word in the page's dark; the other side is plain
  const sides = win.locator('.tbw-chip.tbw-chip-dir-pay, .tbw-chip.tbw-chip-dir-rec')
  const on = sides.locator('xpath=self::*[contains(@class,"is-on")]').first()
  await expect(on).toBeVisible()
  const isPay = await on.evaluate(el => el.classList.contains('tbw-chip-dir-pay'))
  expect(await css(on, 'backgroundColor'), 'the chosen side is filled').toBe(isPay ? DOWN : UP)
  expect(await css(on, 'color')).toBe(INK)
  const off = win.locator('.tbw-chip.tbw-chip-dir-pay:not(.is-on), .tbw-chip.tbw-chip-dir-rec:not(.is-on)').first()
  expect(await css(off, 'backgroundColor'), 'the side not chosen has no fill').not.toBe(isPay ? UP : DOWN)

  // priced, no counterparty: PRICE is an ordinary button again; BOOK is where the ticket is going, outlined in brass
  await price.click()
  await app.mouse.move(5, 5)                                    // off the button: its face at rest is what is read
  await expect(book, 'priced, and waiting for a counterparty').toHaveClass(/is-waiting/, { timeout: 60_000 })
  await expect(price).not.toHaveClass(/is-next/)
  await expect.poll(() => css(price, 'backgroundColor'), { message: 'PRICE is an ordinary button once a price is held' }).toBe(RAISED)   // the face fades over 120 ms
  expect(await css(book, 'color')).toBe(BRASS)
  expect(await css(book, 'borderTopColor')).toBe(BRASS_DIM)
  expect(await css(book, 'backgroundColor'), 'it cannot be pressed, so it has no face').not.toBe(BRASS)

  // a counterparty chosen: BOOK TRADE takes the brass, and PRICE does not have it
  await selectDemoBank(app, win)
  await app.mouse.move(5, 5)
  await expect(book).toBeEnabled({ timeout: 60_000 })
  await expect.poll(() => css(book, 'backgroundColor'), { message: 'BOOK TRADE is the action of a priced ticket' }).toBe(BRASS)
  expect(await css(price, 'backgroundColor')).not.toBe(BRASS)
  await win.locator('.tbw-light-r').click()
  expectClean(problems)
})

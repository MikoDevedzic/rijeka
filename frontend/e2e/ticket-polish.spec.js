// The ticket read at a glance: tabs that look like something to press; a figure's note behind a small mark until
// it is asked for, or all written out with NOTES; one type rule on every tab; the forward's CASHFLOWS as an Excel
// workbook; and the XVA tab with nothing scrolling inside it, its results one table in one dress.
import { test, expect, expectClean, expectFullyInView } from './fixtures.js'

const selectDemoBank = (app, win) => win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
const css = (loc, prop) => loc.evaluate((el, p) => getComputedStyle(el)[p], prop)

test('tabs with an edge, notes behind their marks, one type rule, the cashflows as a workbook', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)

  // the tabs are one control with an edge; the selected one is a lighter panel over the brass rule
  expect(await css(win.locator('.tbw-tabs'), 'borderTopWidth')).toBe('1px')
  const trade = win.getByRole('button', { name: 'TRADE', exact: true }), details = win.getByRole('button', { name: 'DETAILS', exact: true })
  expect(await css(trade, 'backgroundColor'), 'the selected tab is filled').not.toBe(await css(details, 'backgroundColor'))
  await expect(trade).toHaveAttribute('aria-current', 'page')

  // DETAILS is set as TRADE is: words in the interface face, numbers in mono, the size of a field's value
  const fieldSize = await css(win.locator('.tbw-fieldset input').first(), 'fontSize')
  await details.click()
  const value = (label) => win.getByText(label, { exact: true }).locator('xpath=following-sibling::div[1]/div[1]')
  expect(await css(value('INSTRUMENT'), 'fontFamily')).toMatch(/Instrument Sans/)
  expect(await css(value('NOTIONAL'), 'fontFamily')).toMatch(/DM Mono/)
  expect(await css(value('NOTIONAL'), 'fontSize')).toBe(fieldSize)
  expect(await css(value('INSTRUMENT'), 'fontSize')).toBe(fieldSize)

  // CASHFLOWS: a note is not on the page until its mark is hovered or focused
  await win.getByRole('button', { name: 'CASHFLOWS', exact: true }).click()
  const leg = win.getByTestId('fx-cf-leg-base')
  const note = leg.locator('.rj-note')
  await expect(note.locator('.rj-note-body')).toBeHidden()
  await expect(note.locator('.rj-note-mark')).toBeVisible()
  await note.hover()
  await expect(note.locator('.rj-note-body')).toBeVisible()
  await expect(note.locator('.rj-note-body')).toContainText('at the fixing')
  const box = await note.locator('.rj-note-body').boundingBox(), vp = app.viewportSize()
  expect(box.x >= 0 && box.x + box.width <= vp.width && box.y >= 0 && box.y + box.height <= vp.height, 'the note is inside the browser').toBe(true)
  await app.mouse.move(2, 2)
  await expect(note.locator('.rj-note-body')).toBeHidden()
  await note.focus()                                   // the keyboard reaches it too
  await expect(note.locator('.rj-note-body')).toBeVisible()
  await app.keyboard.press('Tab')

  // NOTES writes every note out where it stands, and is remembered
  const toggle = win.getByTestId('notes-toggle')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(note.locator('.rj-note-body')).toBeVisible()
  await expect(note.locator('.rj-note-mark')).toBeHidden()
  expect(await app.evaluate(() => window.localStorage.getItem('rj.notes'))).toBe('1')
  await app.screenshot({ path: 'e2e/.out/shots/polish-cashflows-notes-on.png' })
  await toggle.click()
  await expect(note.locator('.rj-note-body')).toBeHidden()

  // the legs, their net and the market, as a workbook
  const download = app.waitForEvent('download')
  await win.getByTestId('fx-cf-export').click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/^rijeka_BTCUSD_\d{4}-\d{2}-\d{2}_cashflows\.xlsx$/)
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(await file.path())
  const ws = wb.getWorksheet('CASHFLOWS')
  const firsts = []
  ws.eachRow(r => firsts.push(String(r.getCell(1).value ?? '')))
  for (const name of ['RIJEKA', 'BTC LEG', 'USD LEG', 'NET CASH SETTLEMENT', 'MARKET IT WAS PRICED ON']) expect(firsts, name).toContain(name)
  await app.screenshot({ path: 'e2e/.out/shots/polish-cashflows.png' })
  expectClean(problems)
})

test('XVA: nothing scrolls inside the tab, every assumption is in view, and the run and the on-chain row are set alike', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  const show = win.getByRole('button', { name: /SHOW MODEL INPUTS/ })
  if (await show.count()) await show.click()
  await win.getByRole('button', { name: /SIMULATE/ }).click()
  await expect(win.getByTestId('va-on-chain')).toBeVisible({ timeout: 90_000 })

  // the inputs column is as tall as its inputs: no scroll bar of its own
  const left = win.getByTestId('xva-left')
  expect(await left.evaluate(el => el.scrollHeight - el.clientHeight), 'the inputs column does not scroll inside itself').toBeLessThanOrEqual(1)
  // the curves and the assumptions the run was made on, under the results, in view without scrolling
  await expectFullyInView(win.getByTestId('xva-outputs'), 'the XVA results')
  await expectFullyInView(win.getByTestId('xva-assumptions'), 'the spread curves and the assumptions')
  await expect(win.getByTestId('xva-assumptions')).toContainText('SPREAD CURVES')
  await expect(win.getByTestId('xva-assumptions')).toContainText('ASSUMPTIONS')

  // this run and the on-chain run: the same face, size and weight, and a figure the colour of its sign
  const run = win.getByTestId('va-run').locator('div').nth(2), chain = win.getByTestId('va-on-chain').locator(':scope > div').nth(2)
  for (const p of ['fontFamily', 'fontSize', 'fontWeight']) expect(await css(run, p), p).toBe(await css(chain, p))
  const cells = await win.getByTestId('va-run').locator(':scope > div').evaluateAll(els => els.slice(1).map(e => ({ t: e.innerText.trim(), c: getComputedStyle(e).color })))
  const up = await app.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--up)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c })
  const down = await app.evaluate(() => { const d = document.createElement('i'); d.style.color = 'var(--down)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c })
  for (const { t, c } of cells) {
    if (/^\+/.test(t)) expect(c, `${t} is the colour of a positive`).toBe(up)
    else if (/^[-−]/.test(t)) expect(c, `${t} is the colour of a negative`).toBe(down)
    else expect([up, down], `${t} is a zero: no sign, no colour`).not.toContain(c)
  }
  expect(cells.some(x => /^[-−]/.test(x.t)) && cells.some(x => /^\+/.test(x.t)), 'the run has a cost and a benefit').toBe(true)
  // no figure is cut: each money cell holds the whole of its text
  for (const row of ['va-run', 'va-on-chain', 'va-change']) {
    const cut = await win.getByTestId(row).locator(':scope > div').evaluateAll(els => els.slice(1).filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.innerText))
    expect(cut, `${row}: figures that do not fit their cell`).toEqual([])
  }
  // NOTES on: the on-chain note is a line under the rows, and the table keeps its columns
  const nameWidth = () => win.getByTestId('va-on-chain').locator(':scope > div').first().evaluate(el => Math.round(el.getBoundingClientRect().height))
  const before = await nameWidth()
  await win.getByTestId('notes-toggle').click()
  await expect(win.locator('.rj-notes-only')).toBeVisible()
  await expect(win.locator('.rj-notes-only')).toContainText('same seed')
  expect(await nameWidth(), 'the on-chain row keeps its height with the notes written out').toBe(before)
  await win.getByTestId('notes-toggle').click()
  await expect(win.locator('.rj-notes-only')).toBeHidden()
  // the unit is said once, in the row's name
  await expect(win.getByTestId('va-bp')).toContainText('BP OF NOTIONAL')
  expect((await win.getByTestId('va-bp').innerText()).match(/bp/gi).length).toBe(1)
  await app.screenshot({ path: 'e2e/.out/shots/polish-xva.png' })
  expectClean(problems)
})

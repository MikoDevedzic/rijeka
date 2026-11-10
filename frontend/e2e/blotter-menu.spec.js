// The blotter row's right-click menu (open, copy an identifier, narrow the blotter to trades like it, tick), worked
// by the pointer and by the keyboard; and the rail's ALL button showing every trade again after a filter.
import { test, expect, expectClean } from './fixtures.js'

const selectDemoBank = (app, win) => win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })

test('right-click a trade: open it, copy its reference, show only trades like it; ALL shows every trade again', async ({ app, problems }) => {
  await app.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await app.goto('/blotter')
  // a trade of our own to work on
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await selectDemoBank(app, win)
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  await expect(win.locator('.tbw-title')).not.toHaveText('NEW TRADE', { timeout: 30_000 })
  await win.locator('.tbw-light-r').click()
  await expect(win).toHaveCount(0)

  const rows = app.locator('.bl-row')
  await expect(rows.first()).toBeVisible()
  const all = await rows.count()
  const row = rows.first()
  const ref = (await row.locator('.bl-td-ref').innerText()).trim()
  const menu = app.getByTestId('context-menu')

  // the menu opens at the pointer, inside the window, and Escape puts it away
  await row.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await expect(menu).toHaveAttribute('role', 'menu')
  await expect(menu.getByRole('menuitem', { name: /^Open/ })).toBeVisible()
  for (const word of [/confirm/i, /terminate/i, /cancel/i]) await expect(menu.getByRole('menuitem', { name: word }), 'nothing on the menu changes a trade').toHaveCount(0)
  const box = await menu.boundingBox(), vp = app.viewportSize()
  expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height, 'the menu is inside the window').toBe(true)
  await app.screenshot({ path: 'e2e/.out/shots/blotter-menu.png' })
  await app.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(app.locator('.tbw-window'), 'Escape opened nothing').toHaveCount(0)

  // copy the reference
  await row.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: /^Copy reference/ }).click()
  await expect(menu).toHaveCount(0)
  expect(await app.evaluate(() => navigator.clipboard.readText())).toBe(ref)

  // show only this status, then the rail's ALL shows every trade again (it used to hide them all)
  const status = (await row.locator('.bl-status-txt').innerText()).trim()
  await row.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: new RegExp(`^${status}`) }).click()
  await expect(app.locator('.bl-left .bl-filter-btn.active', { hasText: status })).toBeVisible()
  for (const s of await app.locator('.bl-row .bl-status-txt').allInnerTexts()) expect(s.trim()).toBe(status)
  await app.locator('.bl-left .bl-filter-btn', { hasText: 'ALL STATUS' }).click()
  await expect(rows).toHaveCount(all)
  // and from the menu itself
  await row.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'RIJEKA DEMO BANK AG' }).click()
  await expect(app.getByPlaceholder(/Search/)).toHaveValue('RIJEKA DEMO BANK AG')
  await rows.first().click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Show every trade again' }).click()
  await expect(app.getByPlaceholder(/Search/)).toHaveValue('')
  await expect(rows).toHaveCount(all)

  // the keyboard: down to the tick, Enter; then Open with Enter on the first item
  await row.click({ button: 'right' })
  await app.keyboard.press('End')
  await app.keyboard.press('Enter')
  await expect(row.locator('input[type=checkbox]')).toBeChecked()
  await row.click({ button: 'right' })
  await expect(menu.getByRole('menuitem', { name: 'Untick this trade' })).toBeVisible()
  await app.keyboard.press('Enter')                       // the first item: Open
  await expect(app.locator('.tbw-window')).toHaveCount(1)
  await expect(app.locator('.tbw-window .tbw-title')).toContainText(ref)
  expectClean(problems)
})

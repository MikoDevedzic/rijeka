// The desk without a mouse, and for a reader who does not see the page (first read 16 November 2026): a blotter row
// and a NEEDS YOU item were pressed by pointer only; the ticket was not a dialog to a screen reader and a dozen of
// its fields had no name; no page said in a heading which page it was, nor marked its main content.
import { test, expect, expectClean } from './fixtures.js'

// every field on screen inside `root` that a screen reader would announce with no name
const unnamed = (root) => root.evaluate(el => [...el.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(c => {
  const r = c.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false
  const by = (c.getAttribute('aria-labelledby') || '').split(/\s+/).map(i => document.getElementById(i)?.textContent?.trim()).filter(Boolean).join(' ')
  return !(c.getAttribute('aria-label') || by || (c.id && document.querySelector(`label[for="${CSS.escape(c.id)}"]`)) || c.closest('label'))
}).map(c => `${c.tagName.toLowerCase()}${c.type ? `[${c.type}]` : ''} near "${(c.parentElement?.textContent || '').trim().slice(0, 30)}"`))

test('the blotter by keyboard: a row opens its trade, a column sorts, every box has a name, the page says what it is', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 900 })
  await app.goto('/blotter')
  const rows = app.locator('.bl-root tbody tr.bl-row')
  await expect(rows.first()).toBeVisible({ timeout: 30_000 })
  await expect(app.getByRole('main')).toHaveCount(1)
  await expect(app.getByRole('heading', { level: 1, name: 'Blotter' })).toHaveCount(1)
  // names: the search field, the box that selects all, and each row's own
  await expect(app.getByRole('textbox', { name: 'Search the blotter' })).toBeVisible()
  await expect(app.getByRole('checkbox', { name: 'Select every trade shown' })).toBeVisible()
  const ref = (await rows.first().locator('td').nth(1).textContent()).trim()
  await expect(app.getByRole('checkbox', { name: `Select ${ref}` })).toHaveCount(1)
  expect(await unnamed(app.locator('.bl-root')), 'fields with no name on the blotter').toEqual([])

  // the app's ring on a button is two pixels
  const nav = app.locator('.ab-link', { hasText: /^P&L/ }).first()
  await nav.focus(); await app.keyboard.press('Shift+Tab'); await app.keyboard.press('Tab')          // by the keyboard, so the ring shows
  expect(await nav.evaluate(el => getComputedStyle(el).outlineWidth), 'the ring on a focused button').toBe('2px')
  await app.screenshot({ path: 'e2e/.out/shots/keyboard-button-ring.png', clip: { x: 0, y: 0, width: 760, height: 60 } })

  // a column sorts by Enter and says which way
  const date = app.locator('.bl-root thead th', { hasText: /^DATE/ })
  await expect(date).toHaveAttribute('aria-sort', 'descending')
  await date.focus(); await app.keyboard.press('Enter')
  await expect(date).toHaveAttribute('aria-sort', 'ascending')
  await app.keyboard.press(' ')
  await expect(date).toHaveAttribute('aria-sort', 'descending')

  // a row is a stop on the way through the page, shows where the focus is, and Enter opens its trade
  const row = rows.first()
  await row.focus()
  await expect(row).toBeFocused()
  const ring = await row.evaluate(el => { const s = getComputedStyle(el); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 })
  expect(ring, 'the focused row shows a ring').toBe(true)
  await app.screenshot({ path: 'e2e/.out/shots/keyboard-blotter-row.png' })
  await app.keyboard.press('Enter')
  const win = app.getByRole('dialog', { name: `Trade ${ref}` })
  await expect(win, 'the ticket is a dialog named for its trade').toBeVisible({ timeout: 30_000 })
  // the ticket has the keyboard: Tab goes on inside it, not through the rows behind it
  expect(await app.evaluate(() => !!document.activeElement?.closest('.tbw-window')), 'the focus is in the ticket').toBe(true)
  for (let i = 0; i < 6; i++) await app.keyboard.press('Tab')
  expect(await app.evaluate(() => !!document.activeElement?.closest('.tbw-window')), 'six Tabs later it still is').toBe(true)
  // Escape closes a booked trade's ticket (not from inside a field), and the focus is back on its row
  await win.locator('.tbw-title').click()
  await app.keyboard.press('Escape')
  await expect(app.locator('.tbw-window')).toHaveCount(0)
  await row.focus(); await app.keyboard.press('Enter')
  await expect(win).toBeVisible({ timeout: 30_000 })
  await win.getByTestId('tbw-close').click()
  await expect(app.locator('.tbw-window')).toHaveCount(0)
  await expect(row, 'the focus is back on the row that opened it').toBeFocused()
  // Space on the row's own box ticks the box and opens nothing more
  await app.getByRole('checkbox', { name: `Select ${ref}` }).focus(); await app.keyboard.press(' ')
  await expect(app.getByRole('checkbox', { name: `Select ${ref}` })).toBeChecked()
  await expect(app.locator('.tbw-window')).toHaveCount(0)
  expectClean(problems)
})

test('a new ticket is a named dialog and every field in it has a name', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.getByRole('dialog', { name: 'New trade' })
  await expect(win).toBeVisible()
  // a new ticket takes the focus too, and Escape does not close it: an unbooked ticket is not lost to a key
  expect(await app.evaluate(() => !!document.activeElement?.closest('.tbw-window')), 'the focus is in the new ticket').toBe(true)
  await app.keyboard.press('Escape')
  await expect(win).toBeVisible()
  const found = {}
  for (const [asset, product] of [['RATES', null], ['RATES', /^IR SWAPTION$/i], ['RATES', /^INTEREST RATE CAP$/i], ['RATES', /^INTEREST RATE COLLAR$/i],
    ['FX', /^FX SPOT$/i], ['FX', /^FX FORWARD$/i], ['FX', /^NDF$/i], ['FX', /^FX OPTION$/i], ['CRYPTO', /^CRYPTO FORWARD$/i], ['CRYPTO', /^CRYPTO OPTION$/i]]) {
    await win.getByRole('button', { name: asset, exact: true }).click()
    if (product) await win.getByRole('button', { name: product }).click()
    await app.waitForTimeout(800)
    const u = await unnamed(win)
    if (u.length) found[`${asset}${product ? ' ' + product : ''}`] = u
  }
  // the other tabs of one ticket: XVA and the scenario
  await win.getByRole('button', { name: 'FX', exact: true }).click(); await win.getByRole('button', { name: /^FX FORWARD$/i }).click()
  await app.waitForTimeout(3000)
  for (const tab of ['XVA', 'CURVE SCENARIO', 'DETAILS', 'CASHFLOWS']) {
    await win.getByRole('button', { name: tab, exact: true }).click()
    await app.waitForTimeout(1500)
    const u = await unnamed(win)
    if (u.length) found[`FX FORWARD · ${tab}`] = u
  }
  // and the rates ticket's XVA tab, with its model inputs shown
  await win.getByRole('button', { name: /^TRADE$/ }).click()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await app.waitForTimeout(1500)
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  const toggle = win.getByTestId('xva-view-toggle')
  if (await toggle.count() && /SHOW/.test(await toggle.textContent())) await toggle.click()
  await app.waitForTimeout(1000)
  const ux = await unnamed(win)
  if (ux.length) found['RATES · XVA with model inputs'] = ux
  await win.getByRole('button', { name: /^TRADE$/ }).click()
  expect(found, 'fields with no name on a ticket').toEqual({})
  // a caption is the name of the field under it
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await expect(win.getByRole('combobox', { name: /COUNTERPARTY/ }).first()).toBeVisible()
  await expect(win.getByRole('textbox', { name: /NOTIONAL/ }).first()).toBeVisible()
  expectClean(problems)
})

test('the home says what it is, and what needs you is pressed by keyboard', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 900 })
  await app.goto('/')
  await expect(app.getByRole('main')).toHaveCount(1)
  await expect(app.getByRole('heading', { level: 1, name: 'Home' })).toHaveCount(1)
  const items = app.getByTestId('th-needs').locator('.lf-list li.go')
  await expect(items.first()).toBeVisible({ timeout: 30_000 })
  const n = await items.count()
  for (let i = 0; i < n; i++) { await expect(items.nth(i)).toHaveAttribute('tabindex', '0'); await expect(items.nth(i)).toHaveAttribute('role', 'button') }
  // the first that leads to a page: Enter goes there
  const before = app.url()
  await expect(app.locator('.ms-window'), 'the messenger is closed to begin with').toHaveCount(0)
  await items.first().focus(); await expect(items.first()).toBeFocused()
  await app.keyboard.press('Enter')
  await expect.poll(async () => app.url() !== before || (await app.locator('.ms-window').count()) > 0, { message: 'Enter on the item did what a click does' }).toBe(true)
  expectClean(problems)
})

test('the Risk, P&L and Configurations pages each have one main and say which page they are', async ({ app, problems }) => {
  for (const [path, name] of [['/risk', 'Risk'], ['/pnl', 'P&L'], ['/configurations/market-data/curves', 'Configurations']]) {
    await app.goto(path)
    await expect(app.getByRole('heading', { level: 1, name }), `${path} has its heading`).toHaveCount(1, { timeout: 30_000 })
    await expect(app.getByRole('main'), `${path} has one main`).toHaveCount(1)
    expect(await app.locator('h1').count(), `${path} has one first heading`).toBe(1)
  }
  expectClean(problems)
})

// The desk's function keys (src/lib/shortcuts.js): each key does what its button does, the button shows its key,
// and a key with nothing to act on is left alone. F1 Home · F2 Blotter · F3 New trade · F4 Price · F5 XVA, and
// again to simulate · F6 Confirm · F8 Methodology · Ctrl+Enter books.
import { test, expect, expectClean, API } from './fixtures.js'

test('function keys: pages, a new ticket, price, XVA, simulate, book, confirm', async ({ app, problems }) => {
  await app.goto('/roadmap')
  await expect(app.getByRole('heading', { name: 'ROADMAP' })).toBeVisible()
  // a ticket key with no ticket open does nothing here
  await app.keyboard.press('F4')
  await expect(app.locator('.tbw-window')).toHaveCount(0)

  // pages: the key, and the keycap on the button that does the same
  await app.keyboard.press('F2')
  await expect(app).toHaveURL(/\/blotter$/)
  const nav = app.getByRole('button', { name: 'BLOTTER', exact: true })          // the keycap is not part of the name
  await expect(nav).toHaveAttribute('aria-keyshortcuts', 'F2')
  await expect(nav.locator('.kc')).toHaveText('F2')
  await expect(app.getByRole('button', { name: '+ NEW TRADE' }).locator('.kc')).toHaveText('F3')

  // F3 opens a ticket from anywhere
  await app.keyboard.press('F3')
  const win = app.locator('.tbw-window')
  await expect(win).toHaveCount(1)
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  await expect(win.getByRole('button', { name: '▶ PRICE' }).locator('.kc')).toHaveText('F4')

  // F4 prices, with the focus in a field (the key is not typed into it)
  const notional = win.locator('.tbw-sec input').first()
  await notional.focus()
  const before = await notional.inputValue()
  const priced = app.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith('/price/preview') && r.request().method() === 'POST')
  await app.keyboard.press('F4')
  expect((await priced).status()).toBe(200)
  expect(await notional.inputValue()).toBe(before)
  await expect(win.getByRole('button', { name: '▶ PRICE' })).toBeEnabled()
  await app.screenshot({ path: 'e2e/.out/shots/shortcuts-ticket.png' })

  // F5 opens XVA; pressed again it simulates
  await app.keyboard.press('F5')
  await expect(win.locator('.tbw-tab.is-active')).toHaveAttribute('data-tab', 'XVA')
  await expect(app, 'F5 on a ticket is not the browser\'s reload').toHaveURL(/\/blotter$/)
  await win.getByRole('button', { name: 'BILATERAL', exact: true }).click()
  const simulated = app.waitForResponse(r => r.url().endsWith('/api/xva/simulate') && r.request().method() === 'POST', { timeout: 90_000 })
  await app.keyboard.press('F5')
  expect((await simulated).status()).toBe(200)
  await expect(win.getByTestId('va-strip')).toContainText('CVA', { timeout: 90_000 })
  await app.screenshot({ path: 'e2e/.out/shots/shortcuts-xva.png' })

  // Enter alone books nothing; the chord does
  await app.keyboard.press('Enter')
  await expect(win.getByRole('button', { name: /BOOK TRADE/ })).toBeVisible()
  const booked = app.waitForResponse(r => r.url().includes('/api/book/trade'))
  await app.keyboard.press('Control+Enter')
  expect((await booked).status()).toBe(201)
  await expect(win.getByRole('button', { name: /BOOKED/ })).toBeVisible()

  // F6 opens CONFIRM
  await app.keyboard.press('F6')
  await expect(win.locator('.tbw-tab.is-active')).toHaveAttribute('data-tab', '◆ CONFIRM')
  await expect(win).toContainText('PENDING')

  // the ticket stays open across pages
  await app.keyboard.press('F8')
  await expect(app).toHaveURL(/\/methodology$/)
  await app.keyboard.press('F1')
  await expect(app).toHaveURL(/\/command-center$/)
  await expect(app.locator('.cc-nav-btn', { hasText: 'HOME' }).locator('.kc')).toHaveText('F1')
  await expect(win).toHaveCount(1)
  expectClean(problems)
})

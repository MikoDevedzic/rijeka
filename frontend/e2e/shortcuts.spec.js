// The desk's function keys (src/lib/shortcuts.js): each key does what its button does, the button shows its key,
// and a key with nothing to act on is left to the browser. F1 Home · F2 Blotter · F3 New trade · F4 Price ·
// F5 XVA, and again to simulate · F6 Confirm · F8 Methodology · Ctrl+Enter books the ticket that holds the focus.
import { test, expect, expectClean, API } from './fixtures.js'

// Whether the app took the last key from the browser. Playwright's F5 does not reload a page, so the URL cannot
// show it: a listener of the journey's own reads defaultPrevented once the event has been through every handler.
async function watchKeys(app) {
  await app.evaluate(() => {
    window.__keys = []
    window.addEventListener('keydown', e => { const rec = { key: e.key, ctrl: e.ctrlKey, taken: null }; window.__keys.push(rec); setTimeout(() => { rec.taken = e.defaultPrevented }, 0) }, true)
  })
}
const lastKey = async (app) => { await app.waitForFunction(() => window.__keys.length && window.__keys[window.__keys.length - 1].taken !== null); return app.evaluate(() => window.__keys[window.__keys.length - 1]) }
const selectDemoBank = (app, win) => win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
const activeTab = (win) => win.locator('.tbw-tab.is-active')

test('function keys: pages, a new ticket, price, XVA, simulate, book, confirm', async ({ app, problems }) => {
  await app.goto('/roadmap')
  await expect(app.getByRole('heading', { name: 'ROADMAP' })).toBeVisible()
  await watchKeys(app)
  // a ticket key with no ticket open is the browser's (F5 reloads, as anywhere)
  for (const k of ['F4', 'F5', 'F6']) {
    await app.keyboard.press(k)
    expect(await lastKey(app), `${k} with no ticket open`).toMatchObject({ key: k, taken: false })
  }
  await expect(app.locator('.tbw-window')).toHaveCount(0)
  // a function key held with a modifier is the browser's too (Ctrl+F5 stays the hard reload)
  await app.keyboard.press('Control+F2')
  expect(await lastKey(app)).toMatchObject({ key: 'F2', ctrl: true, taken: false })
  await expect(app).toHaveURL(/\/roadmap$/)

  // pages: the key, and the keycap on the button that does the same
  await app.keyboard.press('F2')
  expect(await lastKey(app)).toMatchObject({ key: 'F2', taken: true })
  await expect(app).toHaveURL(/\/blotter$/)
  const nav = app.getByRole('button', { name: 'BLOTTER', exact: true })          // the keycap is not part of the name
  await expect(nav).toHaveAttribute('aria-keyshortcuts', 'F2')
  await expect(nav.locator('.kc')).toHaveText('F2')
  await expect(app.getByRole('button', { name: 'METHODOLOGY', exact: true }).locator('.kc')).toHaveText('F8')
  await expect(app.getByRole('button', { name: '+ NEW TRADE' }).locator('.kc')).toHaveText('F3')

  // F3 opens a ticket from anywhere
  await app.keyboard.press('F3')
  const win = app.locator('.tbw-window')
  await expect(win).toHaveCount(1)
  await selectDemoBank(app, win)
  await expect(win.getByRole('button', { name: '▶ PRICE' }).locator('.kc')).toHaveText('F4')
  await expect(win.getByRole('button', { name: 'XVA', exact: true }).locator('.kc')).toHaveText('F5')
  await expect(win.getByRole('button', { name: '◆ CONFIRM' }).locator('.kc')).toHaveText('F6')
  await expect(win.getByRole('button', { name: /BOOK TRADE/ }).locator('.kc'), 'nothing to book yet: no key on the button').toHaveCount(0)

  // F4 prices, with the focus in a field of the ticket
  await win.locator('.tbw-sec input').first().focus()
  const priced = app.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith('/price/preview') && r.request().method() === 'POST')
  await app.keyboard.press('F4')
  expect((await priced).status()).toBe(200)
  expect(await lastKey(app)).toMatchObject({ key: 'F4', taken: true })
  await expect(win.getByRole('button', { name: /BOOK TRADE/ }).locator('.kc')).toHaveText(/↵/)
  await app.screenshot({ path: 'e2e/.out/shots/shortcuts-ticket.png' })

  // F5 opens XVA and is taken from the browser; pressed again it simulates
  await app.keyboard.press('F5')
  expect(await lastKey(app), 'F5 on a ticket is not the browser\'s reload').toMatchObject({ key: 'F5', taken: true })
  await expect(activeTab(win)).toHaveAttribute('data-tab', 'XVA')
  await win.getByRole('button', { name: 'BILATERAL', exact: true }).click()
  await expect(win.getByRole('button', { name: /SIMULATE/ }).locator('.kc')).toHaveText('F5')
  const simulated = app.waitForResponse(r => r.url().endsWith('/api/xva/simulate') && r.request().method() === 'POST', { timeout: 90_000 })
  await app.keyboard.press('F5')
  expect((await simulated).status()).toBe(200)
  await expect(win.getByTestId('va-strip')).toContainText('CVA', { timeout: 90_000 })
  await app.screenshot({ path: 'e2e/.out/shots/shortcuts-xva.png' })

  // The chord books only the ticket that holds the focus. Typed in a field outside it (the blotter's search here;
  // the messenger's box is the same case) it books nothing and is left to that field.
  let bookings = 0
  app.on('request', r => { if (r.url().includes('/api/book/trade')) bookings++ })
  await app.locator('.bl-search').focus()
  await app.keyboard.press('Control+Enter')
  expect(await lastKey(app)).toMatchObject({ key: 'Enter', ctrl: true, taken: false })
  await app.keyboard.press('Enter')                                      // Enter alone is never a shortcut
  await app.waitForTimeout(400)
  expect(bookings, 'nothing was booked from outside the ticket').toBe(0)
  await expect(win.getByRole('button', { name: /BOOK TRADE/ })).toBeEnabled()
  // with the focus in the ticket it books, once
  await win.locator('input:visible, select:visible').first().focus()
  expect(await app.evaluate(() => !!document.activeElement?.closest('.tbw-window'))).toBe(true)
  const booked = app.waitForResponse(r => r.url().includes('/api/book/trade'))
  await app.keyboard.press('Control+Enter')
  expect((await booked).status()).toBe(201)
  expect(await lastKey(app)).toMatchObject({ key: 'Enter', ctrl: true, taken: true })
  await expect(win.getByRole('button', { name: /BOOKED/ })).toBeVisible()
  await app.keyboard.press('Control+Enter')
  await app.waitForTimeout(400)
  expect(bookings, 'a booked ticket is not booked again').toBe(1)

  // F6 opens CONFIRM
  await app.keyboard.press('F6')
  await expect(activeTab(win)).toHaveAttribute('data-tab', '◆ CONFIRM')
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

test('function keys with two tickets open: the newest, then the one last touched; never the one left behind', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.keyboard.press('F3')
  const first = app.locator('.tbw-window').nth(0)
  await selectDemoBank(app, first)
  await first.locator('.tbw-sec input').first().focus()                  // the focus is in a field of the first ticket
  await app.keyboard.press('F3')                                         // a second ticket opens over it
  const second = app.locator('.tbw-window').nth(1)
  await expect(second).toBeVisible()
  expect(await app.evaluate(() => !!document.activeElement?.closest('.tbw-window')), 'the focus is not left in the covered ticket').toBe(false)
  // a key now means the ticket in front
  await app.keyboard.press('F5')
  await expect(activeTab(second)).toHaveAttribute('data-tab', 'XVA')
  await expect(activeTab(first)).toHaveAttribute('data-tab', 'TRADE')
  // touching the first ticket (its title bar, as one does to drag it) makes it the one a key means
  await first.locator('.tbw-title').click()
  await app.keyboard.press('F6')
  await expect(activeTab(first)).toHaveAttribute('data-tab', '◆ CONFIRM')
  await expect(activeTab(second)).toHaveAttribute('data-tab', 'XVA')
  // and a ticket opened after that touch is again the one in front
  await app.keyboard.press('F3')
  const third = app.locator('.tbw-window').nth(2)
  await expect(third).toBeVisible()
  await app.keyboard.press('F5')
  await expect(activeTab(third)).toHaveAttribute('data-tab', 'XVA')
  await expect(activeTab(first)).toHaveAttribute('data-tab', '◆ CONFIRM')
  expectClean(problems)
})

test('function keys: off where the page is not the desk, and no keycap pushes the top bar off a laptop screen', async ({ app, problems }) => {
  await app.goto('/terms')
  await expect(app.locator('.legal')).toBeVisible()
  await watchKeys(app)
  for (const k of ['F3', 'F2', 'F8']) {
    await app.keyboard.press(k)
    expect(await lastKey(app), `${k} on a legal page`).toMatchObject({ key: k, taken: false })
  }
  await expect(app).toHaveURL(/\/terms$/)
  await expect(app.locator('.tbw-window')).toHaveCount(0)

  // 1366 wide: the nav shows no keycaps (the keys still work, the tooltip names them) and the page does not scroll sideways
  await app.setViewportSize({ width: 1366, height: 768 })
  await app.goto('/blotter')
  const nav = app.getByRole('button', { name: 'BLOTTER', exact: true })
  await expect(nav.locator('.kc')).toBeHidden()
  await expect(nav).toHaveAttribute('title', /\(F2\)/)
  expect(await app.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 1366').toBe(true)
  await app.keyboard.press('F8')
  await expect(app).toHaveURL(/\/methodology$/)
  // 1440 and wider: the keycaps are shown
  await app.setViewportSize({ width: 1440, height: 900 })
  await expect(app.getByRole('button', { name: 'METHODOLOGY', exact: true }).locator('.kc')).toBeVisible()
  expectClean(problems)
})

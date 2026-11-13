// The phone view (390 by 844): what a phone offers and that it can be used there. The home, the trades as cards,
// a trade booked, costed and confirmed through the trade window, chat, news; nothing wider than the screen on any
// of them. It runs on Chromium with the other journeys and on WebKit (an iPhone's engine) under `npm run e2e:engines`.
import { test, expect, expectClean, API } from './fixtures.js'

test.use({ viewport: { width: 390, height: 844 } })

// nothing runs past the right edge of the screen, and nothing has to be pushed sideways to be read: no box on a
// phone's screen scrolls across (the owner, 12 November 2026: "either fit on one screen or scroll down to see it")
const pastEdge = (page) => page.evaluate(() => {
  const vw = window.innerWidth, out = []
  const inScroller = (e) => { for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true } return false }
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect()
    if (r.width > 0 && r.height > 0 && r.right > vw + 1 && r.left < vw && !inScroller(e)) out.push(`${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className).split(' ')[0]} +${Math.round(r.right - vw)}`)
  }
  const sideways = []
  for (const e of document.querySelectorAll('body *')) {
    const o = getComputedStyle(e).overflowX, r = e.getBoundingClientRect()
    if ((o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 2 && r.width > 0 && r.height > 0) sideways.push(`${e.dataset.testid || ''} ${e.tagName.toLowerCase()}.${String(e.className?.baseVal ?? e.className).split(' ')[0]} +${e.scrollWidth - e.clientWidth}`)
  }
  return { across: document.documentElement.scrollWidth - vw, out: out.slice(0, 5), sideways }
})
const fits = async (page, what) => {
  const m = await pastEdge(page)
  expect(m.across, `${what} scrolls sideways`).toBeLessThanOrEqual(0)
  expect(m.out, `${what}: wider than the screen`).toEqual([])
  expect(m.sideways, `${what}: a box that has to be pushed sideways`).toEqual([])
}
// every tab of the trade window, all in view at once: two rows of three, none to scroll to
const tabsInView = async (win) => {
  const boxes = await win.locator('.tbw-tab').evaluateAll(els => els.map(e => e.getBoundingClientRect()).filter(r => r.width > 0).map(r => [Math.round(r.left), Math.round(r.right)]))
  expect(boxes.length, 'six tabs (no CAPITAL)').toBe(6)
  for (const [l, r] of boxes) { expect(l, 'a tab starts on the screen').toBeGreaterThanOrEqual(0); expect(r, 'and ends on it').toBeLessThanOrEqual(390) }
}
const shot = (page, name) => page.screenshot({ path: `e2e/.out/shots/phone-${name}.png` })

test('a phone: the home, the trades, chat and news, each within the screen, from the bar at the foot', async ({ app, problems }) => {
  await app.goto('/command-center')
  const nav = app.getByRole('navigation', { name: 'Rijeka' })
  await expect(nav).toBeVisible()
  await expect(nav.getByRole('button')).toHaveCount(5)
  // a phone's home is a few things: the book and the chain; the policy path, the calendar and the clocks are a monitor's
  await expect(app.locator('.dh-kpis').first()).toBeVisible({ timeout: 30_000 })
  for (const gone of ['.dh-hero', '.dh-clocks', '.dg-wrap', '.dh-ladder']) await expect(app.locator(gone).first(), `${gone} is not on a phone's home`).toBeHidden()
  const tall = await app.evaluate(() => document.querySelector('.cc-root').scrollHeight)
  expect(tall, `the home is at most about two screens (it is ${tall}px)`).toBeLessThanOrEqual(1900)
  await expect(app.locator('.ms-launcher'), 'chat is in the bar, not a floating button').toBeHidden()
  await fits(app, 'the home')
  await shot(app, 'home')

  await nav.getByRole('button', { name: /TRADES/ }).click()
  await expect(app).toHaveURL(/\/blotter$/)
  const rows = app.locator('.bl-row')
  await expect(rows.first()).toBeVisible()
  const card = await rows.first().boundingBox()
  expect(card.width, 'a trade is a card as wide as the screen').toBeLessThanOrEqual(390)
  expect(card.height, 'with its three lines').toBeGreaterThan(50)
  await fits(app, 'the trades')
  await shot(app, 'trades')

  await nav.getByRole('button', { name: /NEWS/ }).click()
  await expect(app).toHaveURL(/\/news$/)
  await expect(app.getByTestId('news-page')).toBeVisible()
  await expect(app.getByTestId('news-page')).not.toContainText('Loading the headlines')
  await fits(app, 'the news')

  await nav.getByRole('button', { name: /CHAT/ }).click()
  const chat = app.locator('.ms-window')
  await expect(chat).toBeVisible()
  const box = await chat.boundingBox(), bar = await nav.boundingBox()
  expect(Math.round(box.width), 'chat takes the width').toBe(390)
  expect(box.y + box.height, 'and stops above the bar').toBeLessThanOrEqual(bar.y + 1)
  await fits(app, 'chat')
  await shot(app, 'chat')
  await nav.getByRole('button', { name: /HOME/ }).click()
  await expect(chat, 'the bar closes chat when it goes somewhere').toHaveCount(0)
  await expect(app).toHaveURL(/\/command-center$/)
  expectClean(problems)
})

test('a phone: a trade is priced, booked, costed and confirmed in the trade window, which is the whole screen', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByRole('navigation', { name: 'Rijeka' }).getByRole('button', { name: 'New trade' }).click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  const frame = await win.boundingBox()
  expect([Math.round(frame.x), Math.round(frame.y), Math.round(frame.width), Math.round(frame.height)], 'the trade window is the screen').toEqual([0, 0, 390, 844])
  await expect(win.locator('.tbw-tab[data-tab="CAPITAL"]'), 'no CAPITAL tab on a phone').toBeHidden()
  await tabsInView(win)
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  // a field is wide enough to read what is in it: two across, not six
  const pair = await win.locator('.tbw-fx-grid-6 select').first().boundingBox()
  expect(pair.width, 'a field on the TRADE tab').toBeGreaterThan(120)
  await fits(app, 'the TRADE tab')
  await shot(app, 'ticket-trade')

  // the foot: PRICE and BOOK in view and a thumb high
  const price = win.getByRole('button', { name: /PRICE/ }), book = win.getByRole('button', { name: /BOOK TRADE/ })
  for (const b of [price, book]) { const r = await b.boundingBox(); expect(r.y + r.height, 'in view').toBeLessThanOrEqual(844); expect(r.height, 'a thumb high').toBeGreaterThanOrEqual(40) }

  // the tabs between: the legs, the cashflows and the scenario's results and ladder are read down the screen
  await win.getByRole('button', { name: /PRICE/ }).click()
  await expect(win.getByTestId('fx-footer-stale')).toHaveCount(0)
  for (const tab of ['DETAILS', 'CASHFLOWS', 'CURVE SCENARIO']) {
    await win.locator(`.tbw-tab[data-tab="${tab}"]`).click()
    await app.waitForTimeout(400)
    await fits(app, `the ${tab} tab`)
  }
  await expect(win.getByTestId('fx-scn-ladder')).toBeVisible()
  const rung = await win.getByTestId('fx-scenario-base').boundingBox()
  expect(rung.x + rung.width, "the ladder's scenario row is on the screen").toBeLessThanOrEqual(390)
  await win.locator('.tbw-tab[data-tab="CASHFLOWS"]').click()
  await expect(win.locator('[data-testid="fx-cf-leg-base"] td[data-label]').first(), 'a cashflow cell carries its heading').toBeVisible()

  // XVA: the inputs, then the results under them, the same run as on a monitor
  await win.getByRole('button', { name: 'XVA', exact: false }).first().click()
  const asked = app.waitForResponse(r => r.url().includes('/api/xva/currency') && r.request().method() === 'POST', { timeout: 120_000 })
  await win.getByRole('button', { name: /SIMULATE/ }).click()
  expect((await asked).status()).toBe(200)
  await expect(win.getByTestId('va-strip')).toBeVisible()
  const left = await win.getByTestId('xva-left').boundingBox(), strip = await win.getByTestId('va-strip').boundingBox()
  expect(strip.y, 'the results are under the inputs, not beside them').toBeGreaterThan(left.y + left.height - 2)
  await fits(app, 'the XVA tab after a run')
  // every adjustment is a line: ALL-IN is on the screen without a push sideways
  const allIn = await win.getByTestId('va-run').locator('> *').last().boundingBox()
  expect(allIn.x, 'ALL-IN starts on the screen').toBeGreaterThanOrEqual(0)
  expect(allIn.x + allIn.width, 'and ends on it').toBeLessThanOrEqual(390)
  await win.getByTestId('va-strip').scrollIntoViewIfNeeded()
  await shot(app, 'ticket-xva')

  // book it, then confirm it (the local stack signs both sides)
  await win.locator('.tbw-tab[data-tab="TRADE"]').click()
  const booked = app.waitForResponse(r => r.url() === `${API}/api/trades/` && r.request().method() === 'POST')
  await book.click()
  expect((await booked).ok(), 'the trade is booked').toBe(true)
  await expect(win).toContainText('BOOKED')
  await win.locator('.tbw-tab[data-tab="◆ CONFIRM"]').scrollIntoViewIfNeeded()
  await win.locator('.tbw-tab[data-tab="◆ CONFIRM"]').click()
  const confirmed = app.waitForResponse(r => r.url().includes('/api/chain/confirm/'), { timeout: 60_000 })
  await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click()
  expect([201, 202]).toContain((await confirmed).status())
  await expect(win).toContainText('CONFIRMED', { timeout: 60_000 })
  await fits(app, 'the CONFIRM tab')
  await shot(app, 'ticket-confirmed')

  // closing it: one button, a thumb wide, and the trade is a card in the list
  const close = win.locator('.tbw-light-r')
  expect((await close.boundingBox()).width, 'the close button').toBeGreaterThanOrEqual(32)
  await close.click()
  await expect(win).toHaveCount(0)
  await expect(app.locator('.bl-row').first()).toContainText('CONFIRMED')
  expectClean(problems)
})

test('a phone: a swap, tab by tab, with nothing to push sideways', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByRole('navigation', { name: 'Rijeka' }).getByRole('button', { name: 'New trade' }).click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  const priced = app.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith('/price/preview') && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  expect((await priced).status()).toBe(200)
  await tabsInView(win)
  await fits(app, "the swap's TRADE tab")
  for (const tab of ['DETAILS', 'CASHFLOWS', 'CURVE SCENARIO']) {
    await win.locator(`.tbw-tab[data-tab="${tab}"]`).click()
    await app.waitForLoadState('networkidle').catch(() => {})
    await app.waitForTimeout(600)
    await fits(app, `the swap's ${tab} tab`)
  }
  await win.locator('.tbw-tab[data-tab="XVA"]').click()
  const asked = app.waitForResponse(r => r.url().includes('/api/xva/') && r.request().method() === 'POST', { timeout: 120_000 })
  await win.getByRole('button', { name: /SIMULATE/ }).first().click()
  expect((await asked).status()).toBe(200)
  await expect(win.getByTestId('va-strip')).toBeVisible()
  await fits(app, "the swap's XVA tab after a run")
  await shot(app, 'swap-xva')
  expectClean(problems)
})

// the door on a phone: the button that puts Rijeka on the home screen, and the app as it opens from its icon
const signedOut = (page) => page.route(/stack\.local\/auth\/v1/, r => r.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"msg":"no session"}' }))

test('a phone: the door offers the home screen, says how, and still fits one screen', async ({ page, problems }) => {
  await signedOut(page)
  await page.goto('/login')
  const add = page.getByTestId('add-to-home')
  await expect(add).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const at = await page.evaluate(() => ({ down: document.documentElement.scrollHeight - window.innerHeight, across: document.documentElement.scrollWidth - window.innerWidth }))
  expect(at.down, 'the door with its button is one screen').toBeLessThanOrEqual(0)
  expect(at.across).toBeLessThanOrEqual(0)
  expect((await add.boundingBox()).height, 'a thumb high').toBeGreaterThanOrEqual(40)
  // an iPhone enlarges the page for a field with type under 16px and leaves it enlarged after sign-in
  for (const label of ['Email', 'Password']) expect(await page.getByLabel(label).evaluate(e => parseFloat(getComputedStyle(e).fontSize)), `${label} is typed at 16px or more`).toBeGreaterThanOrEqual(16)
  await add.click()
  const sheet = page.getByRole('dialog', { name: 'Add Rijeka to your home screen' })
  await expect(sheet).toBeVisible()
  await expect(sheet).toContainText('Open Rijeka from its icon')
  await page.screenshot({ path: 'e2e/.out/shots/phone-add-to-home.png' })
  await sheet.getByRole('button', { name: 'GOT IT' }).click()
  await expect(sheet).toHaveCount(0)
  expectClean(problems)
})

test('opened from its icon the mark comes alive once, the door has no install button, and then the app is there', async ({ page, problems }) => {
  await signedOut(page)
  await page.emulateMedia({ reducedMotion: 'no-preference' })       // the journeys ask for less motion; this one watches the opening
  await page.addInitScript(() => { Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true }) })
  await page.goto('/login')
  const mark = page.getByTestId('launch-mark')
  await expect(mark).toBeVisible()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'e2e/.out/shots/phone-launch.png' })
  await expect(mark, 'it leaves by itself').toHaveCount(0, { timeout: 6000 })
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByTestId('add-to-home'), 'already on the home screen').toHaveCount(0)
  await page.reload()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(mark, 'once per launch, not on every page').toHaveCount(0)
  expectClean(problems)
})

test('a visitor who asks for less motion is not shown the opening', async ({ page, problems }) => {
  await signedOut(page)
  await page.addInitScript(() => { Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true }) })
  await page.goto('/login')
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByTestId('launch-mark')).toHaveCount(0)
  expectClean(problems)
})

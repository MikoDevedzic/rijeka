// A guest: a visitor with no account (src/lib/guest.js, backend/middleware/guest.py). From the door to a priced
// trade and its XVA with nothing signed up; the account is asked for at BOOK and at the Excel, and nowhere before.
// No sign-in exists in this journey at all: whatever the page reads, it reads with the guest's pass.
import { test, expect, expectClean, simulateWithComparison, API } from './fixtures.js'

// no session: the auth host answers that nobody is signed in
const signedOut = async (page) => {
  await page.route(/stack\.local\/auth\/v1/, r => r.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"msg":"no session"}' }))
}
const SHOTS = 'e2e/.out/guest'

test('a guest prices a swap and runs its XVA with no account, and is asked for one only to book or to take the Excel', async ({ page, problems }) => {
  test.setTimeout(180_000)
  await signedOut(page)
  const refused = []
  page.on('response', r => { if (r.url().startsWith(API) && r.status() === 403) refused.push(`${r.request().method()} ${new URL(r.url()).pathname}`) })
  // nothing is asked of the database's own interface in a guest's name
  const direct = []
  page.on('request', r => { if (/stack\.local\/(rest|realtime)\//.test(r.url())) direct.push(r.url()) })

  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  const door = page.getByTestId('guest-door')
  await expect(door, 'the door offers the way in with no account').toBeVisible()
  await page.waitForTimeout(1800)                       // the door draws itself in
  await page.screenshot({ path: `${SHOTS}/1-door.png` })
  await door.locator('[data-action="guest-enter"]').click()

  await expect(page).toHaveURL(/\/guest$/)
  const win = page.locator('.tbw-window')
  await win.waitFor()
  await expect(page.locator('.gst-tag')).toHaveText('GUEST')
  const nav = page.locator('header.ab-bar nav')
  await expect(nav).toContainText('PRICE A TRADE'); await expect(nav).toContainText('METHODOLOGY'); await expect(nav).toContainText('ROADMAP')
  for (const gone of ['BLOTTER', 'HOME', 'CONFIGURATIONS']) await expect(nav, `${gone} is an account's`).not.toContainText(gone)
  await expect(page.getByRole('button', { name: /CHAT/ }), 'the messenger is an account\'s').toHaveCount(0)

  // a swap, priced
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  const cp = win.locator('select').filter({ has: page.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first()
  await expect(cp.locator('option:checked'), 'the guest desk\'s one counterparty is already chosen').toHaveText('RIJEKA DEMO BANK AG')
  const priced = page.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith('/price/preview') && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const quote = await priced
  expect(quote.status(), 'a guest prices').toBe(200)
  expect((await quote.json()).npv).toEqual(expect.any(Number))
  await page.screenshot({ path: `${SHOTS}/2-priced.png` })

  // its XVA
  await win.getByRole('button', { name: 'XVA', exact: true }).click()
  const one = await simulateWithComparison(page, win, '/api/xva/simulate')
  expect(one.run.xva.all_in, 'the run has an all-in').toEqual(expect.any(Number))
  await expect(win.getByTestId('va-strip')).toContainText('CVA')
  await page.screenshot({ path: `${SHOTS}/3-xva.png` })

  // BOOK asks for the account, and books nothing
  const booked = []
  page.on('request', r => { if (/\/api\/book\//.test(r.url())) booked.push(r.url()) })
  await win.locator('[data-action="book"]').click()
  const ask = page.getByTestId('guest-ask')
  await expect(ask).toBeVisible()
  await expect(ask).toHaveAttribute('data-asked', 'book')
  await expect(ask).toContainText('Create an account to book this trade')
  await page.screenshot({ path: `${SHOTS}/4-book-asks.png` })
  expect(booked, 'nothing was sent to be booked').toEqual([])
  await ask.locator('[data-action="guest-ask-stay"]').click()
  await expect(ask).toHaveCount(0)
  await expect(win, 'the ticket is still there, with its price').toBeVisible()

  await win.getByTestId('tbw-close').click()
  await expect(win).toHaveCount(0)
  await expect(page.locator('[data-action="guest-new-trade"]'), 'with the ticket closed the page offers another').toBeVisible()
  await page.screenshot({ path: `${SHOTS}/5-guest-page.png` })

  // the methodology is read; its Excel asks, and nothing is built
  const built = []
  page.on('request', r => { if (/replication\.xlsx/.test(r.url())) built.push(r.url()) })
  await page.locator('header.ab-bar nav').getByRole('button', { name: /^METHODOLOGY/ }).first().click()
  await expect(page).toHaveURL(/\/methodology/)
  await expect(page.getByTestId('mr'), 'a guest reads the methodology').toBeVisible({ timeout: 30_000 })
  await page.goto('/methodology/replications')
  const excel = page.getByRole('button', { name: /EXPORT EXCEL REPLICATION/ }).first()
  await expect(excel, 'the workbooks are listed for a guest to see').toBeVisible({ timeout: 30_000 })
  await excel.click()
  await expect(page.getByTestId('guest-ask')).toHaveAttribute('data-asked', 'excel')
  await page.screenshot({ path: `${SHOTS}/6-excel-asks.png` })
  expect(built, 'no workbook was asked for').toEqual([])
  await page.getByTestId('guest-ask').locator('[data-action="guest-ask-signup"]').click()
  await expect(page, 'the question leads to the ordinary sign-up').toHaveURL(/\/signup$/)

  // an account's page sends a guest back to its own
  await page.goto('/blotter')
  await expect(page).toHaveURL(/\/guest$/)
  await page.goto('/configurations/users')
  await expect(page).toHaveURL(/\/guest$/)

  expect(direct, 'no table was read or watched in a guest\'s name').toEqual([])
  expect(refused, 'the app asked the API for nothing a guest is refused').toEqual([])
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

// A phone (390 by 844, and the door at two smaller ones): the way in is the door's button, the guest's page is one
// column, the ticket is the whole screen, the bar at the foot has a guest's three things, and nothing is pushed sideways.
const scrolls = (page) => page.evaluate(() => ({ down: document.documentElement.scrollHeight - window.innerHeight, across: document.documentElement.scrollWidth - window.innerWidth }))

test('a guest on a phone: in from the door, a trade priced in a ticket that is the whole screen, and the account asked for at BOOK', async ({ page, problems }) => {
  test.setTimeout(180_000)
  await signedOut(page)
  await page.setViewportSize({ width: 390, height: 844 })
  const refused = []
  page.on('response', r => { if (r.url().startsWith(API) && r.status() === 403) refused.push(`${r.request().method()} ${new URL(r.url()).pathname}`) })
  await page.goto('/login')
  const enter = page.locator('[data-action="guest-enter"]')
  await expect(enter, 'a phone\'s door offers the way in').toBeVisible()
  await page.waitForTimeout(1800)
  const door = await scrolls(page)
  expect(door.down, `a phone's door is one screen with the guest's button on it (it is ${door.down}px taller)`).toBeLessThanOrEqual(0)
  expect(door.across).toBeLessThanOrEqual(0)
  expect((await enter.boundingBox()).height, 'a thumb high').toBeGreaterThanOrEqual(38)
  await page.screenshot({ path: `${SHOTS}/phone-1-door.png` })
  await enter.click()

  await expect(page).toHaveURL(/\/guest$/)
  const win = page.locator('.tbw-window')
  await win.waitFor()
  const frame = await win.boundingBox()
  expect([Math.round(frame.x), Math.round(frame.y), Math.round(frame.width), Math.round(frame.height)], 'the ticket is the screen').toEqual([0, 0, 390, 844])
  // the guest desk's one counterparty is already chosen: nothing stands between a guest and PRICE, or BOOK and its question
  const cp = win.locator('select').filter({ has: page.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first()
  await expect(cp.locator('option:checked')).toHaveText('RIJEKA DEMO BANK AG')
  await expect.poll(async () => Number(await win.getByTestId('fx-forward-rate').getAttribute('data-value'))).toBeGreaterThan(0)
  const priced = page.waitForResponse(r => /\/api\/(currency|crypto)\/.*price/.test(r.url()) && r.request().method() === 'POST')
  await win.getByRole('button', { name: /PRICE/ }).click()
  expect((await priced).status(), 'a guest prices on a phone').toBe(200)
  await expect(win).toContainText('NET NPV')
  await page.screenshot({ path: `${SHOTS}/phone-2-priced.png` })

  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  const ask = page.getByTestId('guest-ask')
  await expect(ask).toHaveAttribute('data-asked', 'book')
  const box = await ask.boundingBox()
  expect(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0 && box.y + box.height <= 844, 'the question is within the screen').toBe(true)
  await page.screenshot({ path: `${SHOTS}/phone-3-book-asks.png` })
  await ask.locator('[data-action="guest-ask-stay"]').click()
  await win.getByTestId('tbw-close').click()
  await expect(win).toHaveCount(0)

  // the guest's page and the bar at the foot
  await expect(page.getByTestId('guest-desk')).toBeVisible()
  const foot = page.getByRole('navigation', { name: 'Rijeka' })
  await expect(foot.getByRole('button')).toHaveText([/GUEST/, /NEW/, /ACCOUNT/])
  await expect(page.getByRole('button', { name: 'READ THE METHODOLOGY' }), 'the methodology is laid out for a monitor').toBeHidden()
  const at = await scrolls(page)
  expect(at.across, 'nothing on a phone is pushed sideways').toBeLessThanOrEqual(0)
  const cta = await page.locator('[data-action="guest-signup"]').boundingBox()
  expect(cta.y + cta.height, 'the way to an account is above the bar at the foot').toBeLessThanOrEqual(844 - 56)
  await page.screenshot({ path: `${SHOTS}/phone-4-guest-page.png` })
  await foot.getByRole('button', { name: 'New trade' }).click()
  await expect(page.locator('.tbw-window')).toBeVisible()
  await page.locator('.tbw-window').getByTestId('tbw-close').click()
  await foot.locator('[data-action="guest-phone-signup"]').click()
  await expect(page).toHaveURL(/\/signup$/)

  expect(refused, 'the app asked the API for nothing a guest is refused').toEqual([])
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

for (const [width, height, shown] of [[375, 667, true], [320, 568, false]]) {
  test(`the door at ${width} by ${height} is one screen, ${shown ? 'with the guest\'s button' : 'as it was: the shortest phones have no room for the guest\'s button'}`, async ({ page }) => {
    await signedOut(page)
    await page.setViewportSize({ width, height })
    await page.goto('/login')
    await expect(page.getByLabel('Email')).toBeVisible()
    await page.waitForTimeout(1800)
    if (shown) await expect(page.locator('[data-action="guest-enter"]')).toBeVisible()
    else await expect(page.getByTestId('guest-door')).toBeHidden()
    const at = await scrolls(page)
    expect(at.down, `the door is ${at.down}px taller than the screen`).toBeLessThanOrEqual(0)
    expect(at.across).toBeLessThanOrEqual(0)
    await page.screenshot({ path: `${SHOTS}/phone-door-${width}.png` })
  })
}

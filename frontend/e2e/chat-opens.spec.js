// Once after a sign-in the messenger says it is there. Prometheus and the rooms were behind one bare star at the
// corner of the screen, which a newcomer did not find; the whole window opened by itself stood over the page it
// opened on (the home's right-hand column, half the blotter's rows). So it greets as a small card above the corner
// button: a way to Prometheus, a way to the support room, and a cross; two lines and no more. The window itself
// opens only when asked, where it was last left; it moves by its title bar; the button at the corner says CHAT.
import { test, expect, expectClean } from './fixtures.js'

const fresh = (app) => app.addInitScript(() => { try { if (!window.sessionStorage.getItem('rijeka.greet-test')) { window.sessionStorage.removeItem('rijeka.messenger.greeted'); window.sessionStorage.setItem('rijeka.greet-test', '1') } } catch { /* a private window: the app greets every time */ } })
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

test('after a sign-in a small card greets; it leads into the messenger, which moves by its title bar and once closed stays closed', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 900 })
  await fresh(app)                                                          // this tab has not been greeted for this sign-in
  await app.goto('/')
  const card = app.getByTestId('ms-greet'), win = app.locator('.ms-window')
  await expect(card, 'the card came by itself').toBeVisible()
  await expect(win, 'and the window did not').toHaveCount(0)
  await expect(card).toContainText('Prometheus')
  await expect(card).toContainText('Rijeka Support')
  // it is two lines above the button: what needs you and the head of the risk column are clear of it. (Something
  // lower on the page is under it, as under the button itself; the page's last band ends clear of both.)
  const c = await card.boundingBox()
  expect(c.width, 'a card, not a window').toBeLessThanOrEqual(284)
  expect(c.height, 'two lines').toBeLessThanOrEqual(80)
  expect(c.y, 'in the bottom of the window, over the button').toBeGreaterThan(900 - 96 - 80 - 2)
  const side = app.getByTestId('th-factors')
  await expect(side.locator('.th-row').first()).toBeVisible({ timeout: 120_000 })
  expect(overlap(c, await side.locator('.th-row').first().boundingBox()), 'the first factor is not covered').toBe(0)
  expect(overlap(c, await app.getByTestId('th-needs').boundingBox()), 'nor what needs you').toBe(0)
  // nothing in it is cut short
  for (const says of await card.locator('.ms-greet-says').all()) expect(await says.evaluate(el => el.scrollWidth - el.clientWidth), 'a line of the card is whole').toBeLessThanOrEqual(1)
  // the button at the corner says what it is
  const launcher = app.locator('.ms-launcher')
  await expect(launcher).toContainText('CHAT')
  await app.screenshot({ path: 'e2e/.out/shots/chat-greets-home.png' })

  // on the blotter the rows keep their figures: the card is over the last of them at most
  await app.getByRole('button', { name: /^BLOTTER/ }).first().click()                // the home's own bar
  await expect(card, 'it is still there on the next page').toBeVisible()
  await app.screenshot({ path: 'e2e/.out/shots/chat-greets-blotter.png' })

  // a row of the card is a way in: the messenger opens at that conversation and the card has done its work
  await card.getByRole('button', { name: /Prometheus/ }).click()
  await expect(win).toBeVisible()
  await expect(card).toHaveCount(0)
  await expect(win).toContainText('Prometheus')
  await app.screenshot({ path: 'e2e/.out/shots/chat-opens.png' })

  // it moves by its title bar, and is where it was left after a reload
  const bar = win.locator('.ms-titlebar .ms-brand')
  const from = await win.boundingBox(), grip = await bar.boundingBox()
  await app.mouse.move(grip.x + 10, grip.y + 6)
  await app.mouse.down(); await app.mouse.move(grip.x - 240, grip.y - 60, { steps: 8 }); await app.mouse.up()
  const to = await win.boundingBox()
  expect(Math.round(from.x - to.x), 'moved left with the pointer').toBeGreaterThan(200)
  expect(Math.round(from.y - to.y), 'and up').toBeGreaterThan(40)

  // closed by the user: another page and a reload bring back neither the window nor the card in this sign-in
  await launcher.click()
  await expect(win).toHaveCount(0)
  await app.locator('.ab-link', { hasText: /^P&L/ }).first().click()
  await expect(win).toHaveCount(0)
  await app.reload()
  await expect(app.locator('.ms-launcher')).toBeVisible()
  await app.waitForTimeout(1200)                                            // the greeting would have come by now
  await expect(win, 'it stays closed after a reload').toHaveCount(0)
  await expect(card, 'and it does not greet twice').toHaveCount(0)
  // opened again by the button, it is where it was moved to
  await app.locator('.ms-launcher').click()
  await expect(win).toBeVisible()
  const again = await win.boundingBox()
  expect(Math.abs(again.x - to.x), 'where it was left').toBeLessThanOrEqual(2)
  expectClean(problems)
})

test('the support room is a way in too; the button under the card opens the messenger at the list and the card is gone', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 900 })
  await fresh(app)
  await app.goto('/blotter')
  const card = app.getByTestId('ms-greet'), win = app.locator('.ms-window')
  await expect(card).toBeVisible()
  await app.locator('.ms-launcher').click()
  await expect(win).toBeVisible()
  await expect(card, 'the button opened the messenger: the card has done its work').toHaveCount(0)
  await app.locator('.ms-launcher').click()
  await expect(win).toHaveCount(0)
  await expect(card, 'and closing the messenger does not bring it back').toHaveCount(0)
  expectClean(problems)
})

test('the card\'s support line opens the support room', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 900 })
  await fresh(app)
  await app.goto('/blotter')
  const card = app.getByTestId('ms-greet'), win = app.locator('.ms-window')
  await card.getByRole('button', { name: /Rijeka Support/ }).click()
  await expect(win).toBeVisible()
  await expect(card).toHaveCount(0)
  await expect(win.locator('.ms-thread-head').first(), 'the open conversation is the support room').toContainText(/Support/i)
  expectClean(problems)
})

test('the cross puts the card away for this sign-in; the button still opens the messenger', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 900 })
  await fresh(app)
  await app.goto('/blotter')
  const card = app.getByTestId('ms-greet'), win = app.locator('.ms-window')
  await expect(card).toBeVisible()
  await card.getByTitle('Close').click()
  await expect(card).toHaveCount(0)
  await expect(win).toHaveCount(0)
  await app.reload()
  await expect(app.locator('.ms-launcher')).toBeVisible()
  await app.waitForTimeout(1200)
  await expect(card, 'put away, it does not come back').toHaveCount(0)
  await app.locator('.ms-launcher').click()
  await expect(win).toBeVisible()
  expectClean(problems)
})

test('a trade window opened under the open messenger is in front of it; the button brings the messenger forward', async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 900 })
  await app.goto('/blotter')
  const chat = app.locator('.ms-window')
  await app.locator('.ms-launcher').click()                                 // the messenger, opened by its button
  await expect(chat).toBeVisible()
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  const a = await chat.boundingBox(), b = await win.boundingBox()
  // a point both windows cover
  const x = Math.round((Math.max(a.x, b.x) + Math.min(a.x + a.width, b.x + b.width)) / 2)
  const y = Math.round((Math.max(a.y, b.y) + Math.min(a.y + a.height, b.y + b.height)) / 2)
  expect(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), 'the two overlap at their default places').toBeGreaterThan(40)
  const top = () => app.evaluate(([px, py]) => { const el = document.elementFromPoint(px, py); return el?.closest('.tbw-window') ? 'ticket' : el?.closest('.ms-window') ? 'chat' : 'other' }, [x, y])
  expect(await top(), 'the ticket, opened last, is in front').toBe('ticket')
  await app.screenshot({ path: 'e2e/.out/shots/chat-under-ticket.png' })
  // the button at the corner stays above both: pressed, it brings the open messenger forward (it does not close a
  // window the user cannot see); the ticket pressed, the ticket is in front again
  await app.locator('.ms-launcher').click()
  await expect(chat).toBeVisible()
  expect(await top(), 'the button brings the messenger forward').toBe('chat')
  await app.mouse.click(Math.round(b.x + 60), Math.round(b.y + 14))
  expect(await top(), 'and the ticket is in front again when it is pressed').toBe('ticket')
  expectClean(problems)
})

test('on a phone the messenger does not greet: neither the window, which would be the whole screen, nor the card', async ({ app, problems }) => {
  await app.setViewportSize({ width: 390, height: 844 })
  await fresh(app)
  await app.goto('/blotter')
  await expect(app.locator('.bl-root, .ph-root, #root > *').first()).toBeVisible()
  await app.waitForTimeout(1200)                                            // the greeting would have come by now
  await expect(app.locator('.ms-window')).toHaveCount(0)
  await expect(app.getByTestId('ms-greet')).toHaveCount(0)
  expectClean(problems)
})

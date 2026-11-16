// The messenger opens by itself once after a sign-in. Prometheus and the rooms were behind one bare star at the
// corner of the screen, which a newcomer did not find. The window is where it was last left, moves by its title
// bar, and once closed stays closed until the next sign-in; the button at the corner says CHAT under its star.
import { test, expect, expectClean } from './fixtures.js'

const fresh = (app) => app.addInitScript(() => { window.__greetMe = true; try { if (!window.sessionStorage.getItem('rijeka.greet-test')) { window.sessionStorage.removeItem('rijeka.messenger.greeted'); window.sessionStorage.setItem('rijeka.greet-test', '1') } } catch { /* no storage */ } })

test('after a sign-in the messenger is open, moves by its title bar, and once closed stays closed', async ({ app, problems }) => {
  await fresh(app)                                                          // this tab has not been greeted for this sign-in
  await app.goto('/blotter')
  const win = app.locator('.ms-window')
  await expect(win, 'the messenger opened by itself').toBeVisible()
  await expect(win).toContainText('Prometheus')
  // the button at the corner says what it is
  const launcher = app.locator('.ms-launcher')
  await expect(launcher).toContainText('CHAT')
  await app.screenshot({ path: 'e2e/.out/shots/chat-opens.png' })

  // it moves by its title bar, and is where it was left after a reload
  const bar = win.locator('.ms-titlebar .ms-brand')
  const from = await win.boundingBox(), grip = await bar.boundingBox()
  await app.mouse.move(grip.x + 10, grip.y + 6)
  await app.mouse.down(); await app.mouse.move(grip.x - 240, grip.y - 60, { steps: 8 }); await app.mouse.up()
  const to = await win.boundingBox()
  expect(Math.round(from.x - to.x), 'moved left with the pointer').toBeGreaterThan(200)
  expect(Math.round(from.y - to.y), 'and up').toBeGreaterThan(40)

  // closed by the user: another page and a reload do not open it again in this sign-in
  await launcher.click()
  await expect(win).toHaveCount(0)
  await app.locator('.ab-link', { hasText: /^P&L/ }).first().click()
  await expect(win).toHaveCount(0)
  await app.reload()
  await expect(app.locator('.ms-launcher')).toBeVisible()
  await expect(win, 'it stays closed after a reload').toHaveCount(0)
  // opened again by the button, it is where it was moved to
  await app.locator('.ms-launcher').click()
  await expect(win).toBeVisible()
  const again = await win.boundingBox()
  expect(Math.abs(again.x - to.x), 'where it was left').toBeLessThanOrEqual(2)
  expectClean(problems)
})

test('on a phone the messenger does not open by itself: it would be the whole screen', async ({ app, problems }) => {
  await app.setViewportSize({ width: 390, height: 844 })
  await fresh(app)
  await app.goto('/blotter')
  await expect(app.locator('.bl-root, .ph-root, #root > *').first()).toBeVisible()
  await app.waitForTimeout(1200)                                            // the greeting would have come by now
  await expect(app.locator('.ms-window')).toHaveCount(0)
  expectClean(problems)
})

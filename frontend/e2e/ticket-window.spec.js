// A ticket in a browser window of its own (/ticket): the green light of the trade window opens it, so a ticket can
// sit on another screen while the blotter stays where it is. A stored trade moves to its window; a new ticket
// opens blank there and the one being typed stays.
import { test, expect, expectClean, watchPage } from './fixtures.js'

async function fills(popup) {
  const solo = popup.locator('.tbw-window')
  await solo.waitFor()
  const box = await solo.boundingBox()
  const vp = popup.viewportSize() || await popup.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  expect([Math.round(box.x), Math.round(box.y)], 'the ticket starts at the window\'s corner').toEqual([0, 0])
  expect(Math.round(box.width), 'and is as wide as the window').toBe(vp.width)
  await expect(popup.getByTestId('tbw-popout'), 'a ticket in its own window offers no second window').toHaveCount(0)
  await expect(popup.locator('.ms-launcher'), 'the chat button is the main window\'s').toBeHidden()
  return solo
}

test('a new ticket opens in a window of its own, fills it and prices; the one being typed stays', async ({ app, problems, browserName }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await expect(win.getByTestId('tbw-popout'), 'the green light says what it does').toHaveAttribute('aria-label', /new ticket in its own window/)
  // the control with its name on it, on the tab bar
  const button = win.getByTestId('tbw-popout-btn')
  await expect(button).toHaveText(/OWN WINDOW/)
  await win.locator('.tbw-header').screenshot({ path: 'e2e/.out/shots/ticket-own-window-lights.png' })
  await win.locator('.tbw-tabbar').screenshot({ path: 'e2e/.out/shots/ticket-own-window-button.png' })
  const [popup] = await Promise.all([app.context().waitForEvent('page'), button.click()])
  watchPage(popup, problems, browserName)
  await popup.waitForLoadState()
  await expect(popup).toHaveURL(/\/ticket$/)
  const solo = await fills(popup)
  await expect(solo).toContainText('NEW TRADE')
  await expect(popup.getByTestId('tbw-popout-btn'), 'nor its named control').toHaveCount(0)
  // the page keys do nothing in a ticket's window: no second ticket over this one, and the window stays a ticket
  await popup.keyboard.press('F3')
  await popup.keyboard.press('F2')
  await expect(popup.locator('.tbw-window')).toHaveCount(1)
  await expect(popup).toHaveURL(/\/ticket$/)
  await expect(win, 'the ticket being typed is still in the main window').toBeVisible()
  const priced = popup.waitForResponse(r => /\/price/.test(r.url()) && r.request().method() === 'POST')
  await solo.getByRole('button', { name: '▶ PRICE' }).click()
  expect((await priced).status()).toBe(200)
  await popup.screenshot({ path: 'e2e/.out/shots/ticket-own-window.png' })
  // closing the ticket closes its window
  const closed = popup.waitForEvent('close')
  await solo.locator('.tbw-light-r').click()
  await closed
  expectClean(problems)
})

test('a stored trade moves to a window of its own, a second ask brings it forward as it is, and an unknown trade says so', async ({ app, problems, browserName }) => {
  await app.goto('/blotter')
  const row = app.locator('.bl-row').first()
  await row.waitFor()
  await row.click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  const title = (await win.locator('.tbw-title').innerText()).trim()
  const light = win.getByTestId('tbw-popout')
  await expect(light).toHaveAttribute('title', /this trade in its own window/)
  const [popup] = await Promise.all([app.context().waitForEvent('page'), light.click()])
  watchPage(popup, problems, browserName)
  await popup.waitForLoadState()
  await expect(popup).toHaveURL(/\/ticket\?trade=[0-9a-f-]{36}$/)
  const solo = await fills(popup)
  await expect(solo.locator('.tbw-title')).toContainText(title.split(' · ')[0])
  await expect(win, 'the trade left the main window').toHaveCount(0)
  await popup.screenshot({ path: 'e2e/.out/shots/ticket-own-window-trade.png' })
  // asked for again from the main window: the same window, as it is (not a second one, and not loaded afresh)
  await popup.evaluate(() => { window.__asItWas = true })
  await row.click()
  await win.waitFor()
  const windows = app.context().pages().length
  await win.getByTestId('tbw-popout').click()
  await expect(win, 'the trade leaves the main window again').toHaveCount(0)
  expect(app.context().pages().length, 'no second window for the same trade').toBe(windows)
  expect(await popup.evaluate(() => window.__asItWas), 'and the open one was not loaded again').toBe(true)
  // a trade that is not in the book
  await popup.goto('/ticket?trade=00000000-0000-4000-8000-000000000000')
  await expect(popup.getByTestId('ticket-window')).toHaveAttribute('data-state', 'missing')
  await expect(popup.getByText('This trade is not in your book.')).toBeVisible()
  await popup.close()
  expectClean(problems)
})

// A ticket in a browser window of its own (/ticket): the green light of the trade window opens it, so a ticket can
// sit on another screen while the blotter stays where it is. A stored trade moves to its window; a new ticket
// opens blank there and the one being typed stays.
import { test, expect, expectClean } from './fixtures.js'

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

test('a new ticket opens in a window of its own, fills it and prices; the one being typed stays', async ({ app, problems }) => {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  const light = win.getByTestId('tbw-popout')
  await expect(light).toHaveAttribute('title', /new ticket in its own window/)
  const [popup] = await Promise.all([app.context().waitForEvent('page'), light.click()])
  await popup.waitForLoadState()
  await expect(popup).toHaveURL(/\/ticket$/)
  const solo = await fills(popup)
  await expect(solo).toContainText('NEW TRADE')
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

test('a stored trade moves to a window of its own, and an unknown trade says so', async ({ app, problems }) => {
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
  await popup.waitForLoadState()
  await expect(popup).toHaveURL(/\/ticket\?trade=[0-9a-f-]{36}$/)
  const solo = await fills(popup)
  await expect(solo.locator('.tbw-title')).toContainText(title.split(' · ')[0])
  await expect(win, 'the trade left the main window').toHaveCount(0)
  await popup.screenshot({ path: 'e2e/.out/shots/ticket-own-window-trade.png' })
  // a trade that is not in the book
  await popup.goto('/ticket?trade=00000000-0000-4000-8000-000000000000')
  await expect(popup.getByTestId('ticket-window')).toHaveAttribute('data-state', 'missing')
  await expect(popup.getByText('This trade is not in your book.')).toBeVisible()
  await popup.close()
  expectClean(problems)
})

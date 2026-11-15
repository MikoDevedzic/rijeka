// Chat: a message is on the sender's screen as it is sent; one from another person reaches a window whose live
// stream is not delivering (the stack's realtime delivers nothing, which is that case) by a fetch a few seconds
// later; it blinks the messenger button; and the alert settings are kept by the browser.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, expectClean, expectNoHorizontalOverflow, sessions, API } from './fixtures.js'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '.out', 'chat-alerts')
const shot = async (target, name) => { fs.mkdirSync(OUT, { recursive: true }); await target.screenshot({ path: path.join(OUT, `${name}.png`) }) }
const as = (who) => ({ Authorization: `Bearer ${sessions()[who].access_token}`, 'Content-Type': 'application/json' })

async function directRoom(request) {
  const r = await request.post(`${API}/api/chat/rooms/direct`, { headers: as('USER.A'), data: { user_id: sessions()['USER.B'].user.id } })
  expect(r.status(), await r.text()).toBe(201)
  return (await r.json()).id
}
const say = async (request, who, room, body) => {
  const r = await request.post(`${API}/api/chat/rooms/${room}/messages`, { headers: as(who), data: { body } })
  expect(r.status(), await r.text()).toBe(201)
}

test('chat alerts: the settings are found in the messenger, do what they say, and are kept', async ({ app, problems }) => {
  await app.goto('/command-center')
  await app.locator('.ms-launcher').click()
  const win = app.locator('.ms-window')
  await win.getByRole('button', { name: /^Chat alerts/ }).click()
  const panel = win.locator('.ms-alerts')
  await expect(panel.getByText('Chat alerts', { exact: true })).toBeVisible()

  // as it starts: a sound, the blink and the tab's title, for people, Prometheus and trade events; not the news
  const sw = (name) => panel.getByRole('switch', { name })
  for (const name of [/Play a sound/, /Blink the messenger button/, /Flash the browser tab/, /Messages from people/, /Prometheus/, /Signatures and confirmations/]) await expect(sw(name)).toHaveAttribute('aria-checked', 'true')
  for (const name of [/Desktop notification/, /Market news/]) await expect(sw(name)).toHaveAttribute('aria-checked', 'false')
  await expect(panel.getByRole('button', { name: 'CHIME' })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByRole('button', { name: 'NORMAL' })).toHaveAttribute('aria-pressed', 'true')
  await expectNoHorizontalOverflow(panel, 'the alert settings')
  await shot(win, 'settings')

  await panel.getByRole('button', { name: "SHIP'S BELL" }).click()
  await panel.getByRole('button', { name: 'QUIET' }).click()
  await sw(/Market news/).click()
  await sw(/Blink the messenger button/).click()
  await expect(sw(/Blink the messenger button/)).toHaveAttribute('aria-checked', 'false')
  // a sound switched off takes its choices with it
  await sw(/Play a sound/).click()
  await expect(panel.getByRole('button', { name: "SHIP'S BELL" })).toBeDisabled()
  await sw(/Play a sound/).click()
  // off altogether: nothing can be pressed but ON
  await panel.getByRole('button', { name: 'OFF', exact: true }).click()
  await expect(sw(/Play a sound/)).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'TEST' })).toBeDisabled()
  await expect(win.getByRole('button', { name: /^Chat alerts/ })).toHaveClass(/off/)
  await shot(win, 'settings-off')
  await panel.getByRole('button', { name: 'ON', exact: true }).click()
  await expect(sw(/Play a sound/)).toBeEnabled()

  // kept by this browser
  await app.reload()
  await app.locator('.ms-launcher').click()
  await app.locator('.ms-window').getByRole('button', { name: /^Chat alerts/ }).click()
  const again = app.locator('.ms-alerts')
  await expect(again.getByRole('button', { name: "SHIP'S BELL" })).toHaveAttribute('aria-pressed', 'true')
  await expect(again.getByRole('button', { name: 'QUIET' })).toHaveAttribute('aria-pressed', 'true')
  await expect(again.getByRole('switch', { name: /Market news/ })).toHaveAttribute('aria-checked', 'true')
  await expect(again.getByRole('switch', { name: /Blink the messenger button/ })).toHaveAttribute('aria-checked', 'false')
  // the same button closes the settings
  await app.locator('.ms-window').getByRole('button', { name: /^Chat alerts/ }).click()
  await expect(again).toHaveCount(0)
  expectClean(problems)
})

test('chat: a sent message shows at once, a reply arrives without the live stream, and a message for a closed messenger blinks its button', async ({ app, request, problems }) => {
  test.setTimeout(120_000)
  const room = await directRoom(request)
  await app.goto('/command-center')
  await app.locator('.ms-launcher').click()
  const win = app.locator('.ms-window')
  await win.locator(`.ms-conv`, { hasText: 'User B' }).first().click()
  const thread = win.locator('.ms-thread')

  // the message box: one line with its hint on that line, as high as what is typed, one line again once sent
  const box = win.locator('.ms-compose textarea')
  const height = async () => Math.round((await box.boundingBox()).height)
  const oneLine = await height()
  expect(oneLine, 'one line high when empty').toBeLessThanOrEqual(42)
  expect(await box.evaluate(el => { const p = getComputedStyle(el, '::placeholder'); return p.whiteSpace }), 'the hint does not wrap').toBe('nowrap')
  await shot(win, 'room')
  await box.fill('one line\nand a second\nand a third, typed to see the box grow with its text')
  expect(await height(), 'the box grows with what is typed').toBeGreaterThan(oneLine + 25)
  expect(await box.evaluate(el => el.scrollHeight <= el.clientHeight + 1), 'and shows all of it').toBe(true)
  await expectNoHorizontalOverflow(win.locator('.ms-compose'), 'the message box')
  await shot(win, 'room-typing')
  await box.fill('')
  expect(await height()).toBe(oneLine)

  // on the screen as it is sent; the box is free for the next message at once
  const text = `from A ${Date.now()}`
  await win.locator('.ms-compose textarea').fill(text)
  await win.locator('.ms-compose textarea').press('Enter')
  await expect(win.locator('.ms-compose textarea')).toHaveValue('')
  await expect(thread.locator('.ms-msg.mine', { hasText: text })).toBeVisible()
  await expect(thread.locator('.ms-msg.mine.sending'), 'and the server\'s copy has taken its place').toHaveCount(0)
  await expect(thread.locator('.ms-msg.mine', { hasText: text })).toHaveCount(1)

  // the other person answers; this window's stream says nothing, so the message comes by the fetch
  const reply = `from B ${Date.now()}`
  await say(request, 'USER.B', room, reply)
  await expect(thread.locator('.ms-msg', { hasText: reply }), 'within the fetch\'s few seconds, without a reload').toBeVisible({ timeout: 20_000 })
  await expect(app.locator('.ms-launcher.alert'), 'no alert for the conversation being looked at').toHaveCount(0)

  // the stream is not delivering, and the settings say so (the stack's realtime never completes a join, so it is
  // "down" here; a stream that joins and stays silent is the unit tests': useChatStore.test.js)
  await win.getByRole('button', { name: /^Chat alerts/ }).click()
  await expect(win.locator('.ms-alerts-stream')).toHaveAttribute('data-stream', /^(down|silent)$/, { timeout: 15_000 })
  await expect(win.locator('.ms-alerts-stream')).toContainText('fetched every few seconds')
  await win.locator('.ms-alerts .ms-thread-head').getByRole('button', { name: '✕' }).click()

  // the messenger closed: the next message blinks its button, and looking stops the blink
  await win.locator('.ms-titlebar').getByRole('button', { name: '✕' }).click()
  await expect(win).toHaveCount(0)
  await say(request, 'USER.B', room, `again ${Date.now()}`)
  const launcher = app.locator('.ms-launcher')
  await expect(launcher).toHaveClass(/alert/, { timeout: 30_000 })
  await expect(launcher.locator('.ms-launcher-badge')).toBeVisible()
  await shot(app, 'blink')
  await launcher.click()
  await expect(launcher).not.toHaveClass(/alert/)
  expectClean(problems)
})

test('a phone: the alert settings fit the screen, and CHAT in the bar blinks', async ({ app, request, problems }) => {
  test.setTimeout(90_000)
  const room = await directRoom(request)
  await app.setViewportSize({ width: 390, height: 844 })
  const listed = app.waitForResponse(r => r.url().endsWith('/api/chat/rooms') && r.status() === 200)      // what is there when the chat loads is not news
  await app.goto('/command-center')
  await listed
  const nav = app.locator('.ph-nav')
  await say(request, 'USER.B', room, `to a phone ${Date.now()}`)
  await expect(nav.getByRole('button', { name: /CHAT/ })).toHaveClass(/alert/, { timeout: 60_000 })
  await shot(app, 'phone-blink')
  await nav.getByRole('button', { name: /CHAT/ }).click()
  await expect(nav.getByRole('button', { name: /CHAT/ })).not.toHaveClass(/alert/)
  const win = app.locator('.ms-window')
  await win.getByRole('button', { name: /^Chat alerts/ }).click()
  await expect(win.locator('.ms-alerts')).toBeVisible()
  await expectNoHorizontalOverflow(win.locator('.ms-alerts'), 'the alert settings on a phone')
  expect(await app.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'nothing is pushed sideways').toBe(true)
  await shot(app, 'phone-settings')
  expectClean(problems)
})

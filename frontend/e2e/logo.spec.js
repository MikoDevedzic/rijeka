// The logo, where it lives in the app: in the top bar (a river of simulated paths running into the ringed R that
// begins the name), and as the picture of a confirmation: the river runs while a trade is being signed and
// anchored, the R is drawn when the trade is confirmed, and its ring only when the record is anchored on a chain.
// A confirmation that fails never draws the letter, and nothing carries over to the next trade.
import { test, expect, expectClean, API } from './fixtures.js'

// how much of a canvas is drawn at full strength, in its left part (the river) and its right part (the letter and
// ring), and a number that changes when the drawing does (`shape`: where the ink is, not only how much). The
// waiting outline of the letter is faint and is not counted.
const ink = (canvas) => canvas.evaluate(cv => {
  const { width: w, height: h } = cv, d = cv.getContext('2d').getImageData(0, 0, w, h).data
  let river = 0, letter = 0, shape = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 150) { if (x < w * 0.62) river++; else letter++; shape = (shape * 31 + y * w + x) % 2147483647 }
  return { river, letter, shape }
})

test('the top bar carries the logo: drawn, named, and a way home', async ({ app, problems }) => {
  await app.goto('/blotter')
  const logo = app.getByTestId('rijeka-logo')
  await expect(logo).toBeVisible()
  await expect(logo).toHaveAttribute('aria-label', /Rijeka/)
  // the journeys ask for less motion: the logo is drawn complete at once, and does not move
  await expect.poll(async () => (await ink(logo)).letter, { timeout: 5000 }).toBeGreaterThan(150)
  await app.evaluate(() => document.fonts.ready)      // the name is set again, once, when its face has loaded: that is not motion
  await app.waitForTimeout(400)
  const calm = await ink(logo)
  expect(calm.river, 'the river is drawn').toBeGreaterThan(40)
  await app.waitForTimeout(600)
  expect(await ink(logo), 'with less motion asked for, it does not move').toEqual(calm)
  // with motion allowed it runs once (under four seconds): the R and its ring come last, and then it holds
  await app.emulateMedia({ reducedMotion: 'no-preference' })
  await app.reload()
  await expect(logo).toBeVisible()
  await app.waitForTimeout(900)
  const early = await ink(logo)
  await app.waitForTimeout(3900)
  const done = await ink(logo)
  // in the bar the left part holds the river and the ringed R, the right part the rest of the name (set from the start)
  expect(early.river, 'a second in, the river is still growing and the ringed R is not drawn').toBeLessThan(done.river * 0.8)
  expect(early.letter, 'the rest of the name is there from the first frame').toBe(done.letter)
  expect(done.letter, 'the rest of the name is drawn').toBeGreaterThan(150)
  await app.waitForTimeout(700)
  expect(await ink(logo), 'it holds still after its run').toEqual(done)
  const box = await logo.boundingBox()
  expect(box.height, 'it fits the bar').toBeLessThanOrEqual(44)
  expect(box.width, 'the name is not squeezed').toBeGreaterThan(110)
  await app.screenshot({ path: 'e2e/.out/shots/logo-bar.png', clip: { x: 0, y: 0, width: 700, height: 60 } })
  // the keyboard reaches it, and it leads home
  await logo.focus()
  await app.keyboard.press('Enter')
  await expect(app).toHaveURL(/command-center/)
  await expect(app.getByTestId('rijeka-logo')).toBeVisible()
  expectClean(problems)
})

// a swap against the demo bank, priced and booked, with its CONFIRM tab open
async function bookedSwap(app) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  const priced = app.waitForResponse(r => r.url().startsWith(API) && r.url().endsWith('/price/preview') && r.request().method() === 'POST')
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  await priced
  const booked = app.waitForResponse(r => r.url().includes('/api/book/trade'))
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  expect((await booked).status()).toBe(201)
  await win.getByRole('button', { name: '◆ CONFIRM' }).click()
  await expect(win).toContainText('PENDING')
  return win
}

test('a confirmation is the logo being drawn: the river while it is in progress, the R when it is confirmed', async ({ app, problems }) => {
  await app.emulateMedia({ reducedMotion: 'no-preference' })      // this journey watches the drawing move
  const win = await bookedSwap(app)
  const mark = win.getByTestId('confirm-mark'), caption = win.getByTestId('confirm-mark-caption')
  await expect(mark, 'nothing is drawn before a confirmation is asked for').toHaveCount(0)

  // 1. a confirmation that fails: the river ran, the letter is never drawn, and the page says so
  await app.route(`${API}/api/chain/confirm/**`, async route => {
    await new Promise(r => setTimeout(r, 1500))
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: 'the journey refused this confirmation' }) })
  }, { times: 1 })
  await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click()
  await expect(mark).toHaveAttribute('data-phase', 'running')
  await expect(caption).toHaveText('SIGNING AND ANCHORING')
  await expect(mark).toHaveAttribute('data-phase', 'failed', { timeout: 10_000 })
  await expect(caption).toHaveText('NOT CONFIRMED')
  await app.waitForTimeout(1200)
  expect((await ink(mark)).letter, 'a failed confirmation draws no letter').toBeLessThan(20)
  await expect(win).toContainText('PENDING')
  // that refusal was this journey's own doing: it is the one problem expected, and it is taken off the record
  const refused = problems.findIndex(p => /HTTP 500 POST .*\/api\/chain\/confirm\//.test(p))
  expect(refused, 'the refused confirmation was seen').toBeGreaterThanOrEqual(0)
  problems.splice(refused, 1)

  // 2. the confirmation, held for three seconds so its progress can be looked at
  await app.route(`${API}/api/chain/confirm/**`, async route => {
    await new Promise(r => setTimeout(r, 3000))
    await route.fulfill({ response: await route.fetch() })
  }, { times: 1 })
  await win.getByRole('button', { name: /RETRY CONFIRM|CONFIRM ON-CHAIN/ }).click()
  await expect(mark).toHaveAttribute('data-phase', 'running')
  await expect(mark).toHaveAttribute('aria-label', /in progress/)
  await app.waitForTimeout(2400)
  const running = await ink(mark)
  expect(running.river, 'the river is running').toBeGreaterThan(300)
  expect(running.letter, 'the letter is only an outline while the trade is not confirmed').toBeLessThan(20)
  await app.waitForTimeout(300)
  expect((await ink(mark)).shape, 'and it is moving').not.toBe(running.shape)
  await app.screenshot({ path: 'e2e/.out/shots/confirm-mark-running.png' })

  await expect(win).toContainText('CONFIRMED', { timeout: 60_000 })
  await expect(mark, 'the same drawing completes: it is not replaced').toHaveAttribute('data-phase', 'done')
  // the stack has no chain: the trade is confirmed and its record is signed, not anchored. The R is drawn; the ring,
  // which is the seal on chain, stays an outline, and the words say which it is
  await expect(caption).toHaveText('CONFIRMED · NOT ANCHORED')
  await expect(mark).toHaveAttribute('data-sealed', 'no')
  await expect(mark).toHaveAttribute('aria-label', /signed and not anchored/)
  await expect.poll(async () => (await ink(mark)).letter, { timeout: 6000, message: 'the R is drawn once the trade is confirmed' }).toBeGreaterThan(90)
  await app.waitForTimeout(4200)
  const held = await ink(mark)
  expect(held.letter, 'the ring is not drawn for a record that is not on a chain').toBeLessThan(330)
  await app.waitForTimeout(500)
  expect(await ink(mark), 'the finished drawing holds still').toEqual(held)
  await expect(win.getByTestId('confirm-certificate'), 'the certificate and its seal are there as before').toBeVisible()
  await app.screenshot({ path: 'e2e/.out/shots/confirm-mark-done.png' })
  // the next trade in the same ticket starts with no picture: nothing carries over
  await win.getByRole('button', { name: 'NEW TRADE', exact: true }).click()
  await expect(win.getByTestId('confirm-mark')).toHaveCount(0)
  await win.getByRole('button', { name: '◆ CONFIRM' }).click()
  await expect(win).toContainText('Nothing to confirm yet')
  await expect(win.getByTestId('confirm-mark'), 'a new ticket has no confirmation in progress').toHaveCount(0)
  expectClean(problems)
})

test('the ring is the seal: it is drawn when the record is anchored on a chain', async ({ app, problems }) => {
  await app.emulateMedia({ reducedMotion: 'no-preference' })
  const win = await bookedSwap(app)
  // The stack has no chain, so this journey says the record was anchored, to look at what an anchored confirmation
  // draws: the attestation the ticket reads is the stack's own, with its anchor marked as taken by a block.
  await app.route(`${API}/api/chain/attestation/**`, async route => {
    const resp = await route.fetch(), body = await resp.json()
    if (body?.attestation) body.attestation.anchor = { ...(body.attestation.anchor || {}), anchored: true, chain_id: 11155111, block_number: 12112656, tx_hash: '0x' + 'ab'.repeat(32) }
    await route.fulfill({ response: resp, json: body })
  })
  const mark = win.getByTestId('confirm-mark'), caption = win.getByTestId('confirm-mark-caption')
  await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click()
  await expect(mark).toHaveAttribute('data-phase', 'running')
  await expect(win).toContainText('CONFIRMED', { timeout: 60_000 })
  await expect(mark).toHaveAttribute('data-phase', 'done')
  await expect(mark).toHaveAttribute('data-sealed', 'yes', { timeout: 15_000 })
  await expect(caption).toHaveText('CONFIRMED ON CHAIN')
  await expect(mark).toHaveAttribute('aria-label', /Confirmed on chain/)
  await expect.poll(async () => (await ink(mark)).letter, { timeout: 8000, message: 'the R and its ring are both drawn for an anchored record' }).toBeGreaterThan(380)
  await app.screenshot({ path: 'e2e/.out/shots/confirm-mark-sealed.png' })
  expectClean(problems)
})

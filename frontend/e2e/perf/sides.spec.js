// Pictures of the ticket's two-way choices (a side, an option's type), each way selected. Not a journey: read
// e2e/.out/look/sides-*.png. Run: SIDES_TAG=after npx playwright test -c playwright.perf.config.js sides.spec.js
import { test } from '../fixtures.js'

test.use({ viewport: { width: 1440, height: 900 } })
const TAG = process.env.SIDES_TAG || 'now'

async function ticket(app, asset, product) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  if (asset) {
    await win.getByRole('button', { name: asset, exact: true }).click()
    await win.getByRole('button', { name: product }).click()
  }
  return win
}
const strip = async (app, win, name) => {
  await app.mouse.move(5, 5)                       // nothing under the pointer
  await app.waitForTimeout(250)
  const box = await win.boundingBox()
  await app.screenshot({ path: `e2e/.out/look/sides-${TAG}-${name}.png`, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 660) } })
}

test('the default ticket, the FX forward, the options', async ({ app }) => {
  test.setTimeout(240_000)
  let win = await ticket(app)
  await strip(app, win, 'default')
  win = await ticket(app, 'RATES', /^IR SWAP$/i)
  await strip(app, win, 'rates-pay')
  await win.getByRole('button', { name: /^RECEIVE/ }).first().click()
  await strip(app, win, 'rates-receive')
  win = await ticket(app, 'FX', /^FX FORWARD$/i)
  await strip(app, win, 'fx-buy')
  await win.getByRole('button', { name: /^Sell /i }).first().click()
  await strip(app, win, 'fx-sell')
  win = await ticket(app, 'CRYPTO', /^CRYPTO OPTION$/i)
  await strip(app, win, 'option-buy-call')
  await win.getByRole('button', { name: /^Sell /i }).first().click()
  await win.getByRole('button', { name: 'PUT', exact: true }).click()
  await strip(app, win, 'option-sell-put')
})

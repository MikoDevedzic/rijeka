// Every tab of the ticket, one product at a time: a picture of each (read by a person afterwards), what it costs to
// draw at rest and under a moving pointer, and what is written to the page meanwhile. A tab that draws or writes
// while nothing is happening is a tab that never rests; a pointer sweep that writes hundreds of attributes is a
// handler that sets state on every move. CAPITAL is left out: it is not part of the Phase 1 launch.
import { test, simulateWithComparison } from '../fixtures.js'
import fs from 'node:fs'
import { traced, sweep, idle, writesDuring, saver } from './trace.js'

test.use({ viewport: { width: 1728, height: 1117 }, deviceScaleFactor: 2 })

const out = {}
const save = saver('e2e/.out/tabs.json', out)
const SHOTS = 'e2e/.out/tabs'

async function open(app, asset, product) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  if (asset) {
    await win.getByRole('button', { name: asset, exact: true }).click()
    await win.getByRole('button', { name: product }).click()
  }
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  return win
}

function ticket(name, { asset, product, price, xva, book }) {
  test(`${name}: every tab`, async ({ app, browser, problems }) => {
    test.setTimeout(600_000)
    app.setDefaultTimeout(20_000)
    fs.mkdirSync(SHOTS, { recursive: true })
    const step = async (label, fn) => { try { await fn() } catch (e) { out[`${name} · ${label} FAILED`] = String(e.message || e).split('\n')[0]; save() } }
    const win = await open(app, asset, product)
    const tab = (t) => win.getByRole('button', { name: t, exact: true }).click()
    const measure = async (label) => {
      await app.waitForLoadState('networkidle').catch(() => {})
      await app.waitForTimeout(2500)
      const file = `${SHOTS}/${name}-${label}`.replace(/[ ◆]+/g, '-').toLowerCase() + '.png'
      await win.screenshot({ path: file, scale: 'css' })
      const box = await win.boundingBox()
      await app.mouse.move(box.x + box.width / 2, box.y + 14)                          // off the content, on the header
      const atRest = await writesDuring(win, () => traced(browser, app, () => idle(app)))
      const moving = await writesDuring(win, () => traced(browser, app, () => sweep(app, box)))
      out[`${name} · ${label}`] = {
        shot: file,
        idle: { ...atRest.result, writes: atRest.writes, top: atRest.top },
        pointer: { ...moving.result, writes: moving.writes, top: moving.top },
        canvases: await win.locator('canvas:visible').count(),
      }
      save()
    }

    await step('TRADE', async () => {
      const priced = app.waitForResponse(r => price.test(r.url()) && r.request().method() === 'POST', { timeout: 60_000 })
      await win.getByRole('button', { name: '▶ PRICE' }).click()
      await priced
      await measure('TRADE')
    })
    await step('DETAILS', async () => { await tab('DETAILS'); await measure('DETAILS') })
    await step('CASHFLOWS', async () => { await tab('CASHFLOWS'); await measure('CASHFLOWS') })
    await step('XVA', async () => {
      await tab('XVA')
      await win.getByRole('button', { name: 'BILATERAL', exact: true }).click()
      await simulateWithComparison(app, win, xva)
      await measure('XVA')
    })
    await step('CURVE SCENARIO', async () => { await tab('CURVE SCENARIO'); await measure('CURVE SCENARIO') })
    await step('CONFIRM', async () => {
      await tab('TRADE')
      const booked = app.waitForResponse(r => book.test(r.url()) && r.request().method() === 'POST', { timeout: 60_000 })
      await win.getByRole('button', { name: /BOOK TRADE/ }).click()
      let res = await booked
      if (res.status() >= 300) throw new Error(`booking answered ${res.status()}`)
      await tab('◆ CONFIRM')
      await measure('CONFIRM pending')
      const confirmed = app.waitForResponse(r => r.url().includes('/api/chain/confirm/'), { timeout: 60_000 })
      await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click()
      res = await confirmed
      await win.getByText('CONFIRMED').first().waitFor({ timeout: 60_000 })
      await measure('CONFIRM confirmed')
    })
    // after booking: the tabs of a booked trade are the same components fed from the stored record
    await step('booked DETAILS', async () => { await tab('DETAILS'); await measure('booked DETAILS') })
    await step('booked CASHFLOWS', async () => { await tab('CASHFLOWS'); await measure('booked CASHFLOWS') })
    out[`${name} · console and network`] = { errors: problems.length, first: problems.slice(0, 5).map(p => String(p).slice(0, 200)) }
    save()
  })
}

ticket('rates swap', { price: /\/price\/preview$/, xva: '/api/xva/simulate', book: /\/api\/book\/trade/ })
ticket('crypto forward', { asset: 'CRYPTO', product: /^CRYPTO FORWARD$/i, price: /\/api\/currency\/.*price/, xva: '/api/xva/currency', book: /\/api\/trades\/$/ })
ticket('crypto option', { asset: 'CRYPTO', product: /^CRYPTO OPTION$/i, price: /\/api\/currency\/.*price/, xva: '/api/xva/currency-option', book: /\/api\/trades\/$/ })
ticket('FX forward', { asset: 'FX', product: /^FX FORWARD$/i, price: /\/api\/currency\/.*price/, xva: '/api/xva/currency', book: /\/api\/trades\/$/ })

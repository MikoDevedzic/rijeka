// The app at the size of a phone (390 by 844), for a person to read after a change to the phone view: one picture
// of every screen the phone offers, and how far each runs past the screen's edge. Not a journey and not a gate:
//   PHONE_TAG=before npx playwright test -c playwright.perf.config.js phone.spec.js
// Pictures in e2e/.out/phone/, measurements in e2e/.out/phone/measure.json. The gate is e2e/phone.spec.js.
import fs from 'node:fs'
import { test } from '../fixtures.js'

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: false })
const TAG = process.env.PHONE_TAG ? `-${process.env.PHONE_TAG}` : ''
const DIR = 'e2e/.out/phone'
const out = {}
const note = async (app, name) => {
  fs.mkdirSync(DIR, { recursive: true })
  out[name] = await app.evaluate(() => {
    const vw = window.innerWidth, wide = []
    // what runs past the right edge and is not inside something that scrolls sideways on purpose
    const scrolls = (e) => { for (let x = e.parentElement; x && x !== document.body; x = x.parentElement) { const o = getComputedStyle(x).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true } return false }
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && r.right > vw + 1 && r.left < vw && !scrolls(e)) wide.push([Math.round(r.right - vw), (e.dataset.testid ? `[${e.dataset.testid}]` : '') + '.' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).split(' ')[0] + ':' + e.tagName.toLowerCase()])
    }
    wide.sort((a, b) => b[0] - a[0])
    return { across: document.documentElement.scrollWidth - vw, down: document.documentElement.scrollHeight - window.innerHeight, pastEdge: wide.length, worst: wide.slice(0, 6) }
  })
  await app.screenshot({ path: `${DIR}/${name}${TAG}.png` })
  fs.writeFileSync(`${DIR}/measure${TAG}.json`, JSON.stringify(out, null, 1))
}

test('the phone: home, trades, a ticket tab by tab, chat', async ({ app }) => {
  test.setTimeout(240_000)
  await app.goto('/command-center'); await app.waitForTimeout(2500); await note(app, 'home')
  await app.goto('/blotter'); await app.waitForTimeout(1500); await note(app, 'trades')
  const plus = app.getByRole('navigation', { name: 'Rijeka' }).getByRole('button', { name: 'New trade' })
  if (await plus.count()) await plus.click(); else await app.getByText('+ NEW TRADE').first().click({ force: true }).catch(() => {})
  const win = app.locator('.tbw-window')
  if (await win.count()) {
    await app.waitForTimeout(2500); await note(app, 'ticket-trade')
    for (const tab of ['DETAILS', 'CASHFLOWS', 'XVA', 'CURVE SCENARIO', '◆ CONFIRM']) {
      const b = win.getByRole('button', { name: tab, exact: tab !== 'XVA' && tab !== '◆ CONFIRM' ? true : false }).first()
      if (await b.count()) { await b.click({ force: true }).catch(() => {}); await app.waitForTimeout(1200); await note(app, `ticket-${tab.replace(/[^A-Z]+/g, '-').toLowerCase().replace(/^-|-$/g, '')}`) }
    }
  } else out['ticket'] = 'the trade window did not open'
  await app.goto('/blotter'); await app.waitForTimeout(800)
  const nav = app.getByRole('navigation', { name: 'Rijeka' })
  if (await nav.count()) {
    await nav.getByRole('button', { name: /NEWS/ }).click(); await app.waitForTimeout(1200); await note(app, 'news')
    await nav.getByRole('button', { name: /CHAT/ }).click(); await app.waitForTimeout(1200); await note(app, 'chat')
  } else {
    const chat = app.locator('.ms-launcher')
    if (await chat.count()) { await chat.click({ force: true }).catch(() => {}); await app.waitForTimeout(1200); await note(app, 'chat') }
  }
})

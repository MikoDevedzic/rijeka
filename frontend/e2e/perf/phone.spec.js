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
    // what a thumb has to push sideways to read: a box that scrolls across and holds more than it shows
    const name = (e) => (e.dataset.testid ? `[${e.dataset.testid}]` : '') + '.' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).split(' ')[0] + ':' + e.tagName.toLowerCase()
    const sideways = []
    for (const e of document.querySelectorAll('body *')) {
      const o = getComputedStyle(e).overflowX, r = e.getBoundingClientRect()
      if ((o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 2 && r.width > 0 && r.height > 0) sideways.push(`${name(e)} +${e.scrollWidth - e.clientWidth}`)
    }
    return { across: document.documentElement.scrollWidth - vw, down: document.documentElement.scrollHeight - window.innerHeight, pastEdge: wide.length, worst: wide.slice(0, 6), sideways }
  })
  await app.screenshot({ path: `${DIR}/${name}${TAG}.png` })
  fs.writeFileSync(`${DIR}/measure${TAG}.json`, JSON.stringify(out, null, 1))
}

test('the phone: home, trades, a ticket tab by tab (priced, costed, booked, confirmed), news, chat', async ({ app }) => {
  test.setTimeout(420_000)
  await app.goto('/command-center'); await app.waitForTimeout(3000); await note(app, 'home')
  await app.evaluate(() => window.scrollTo(0, 560)); await app.waitForTimeout(400); await note(app, 'home-2')
  await app.evaluate(() => window.scrollTo(0, 99999)); await app.waitForTimeout(400); await note(app, 'home-3')
  await app.goto('/blotter'); await app.waitForTimeout(1500); await note(app, 'trades')
  const nav = app.getByRole('navigation', { name: 'Rijeka' })
  await nav.getByRole('button', { name: 'New trade' }).click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  const tab = async (name, file, wait = 1500) => {
    const b = win.locator(`.tbw-tab[data-tab="${name}"]`)
    if (!(await b.count())) { out[file] = 'no such tab'; return }
    await b.scrollIntoViewIfNeeded(); await b.click(); await app.waitForTimeout(wait); await note(app, file)
    // and the foot of the tab, where it is longer than the screen
    const more = await win.evaluate(el => { let m = 0, box = null; for (const e of [el, ...el.querySelectorAll('*')]) { const d = e.scrollHeight - e.clientHeight; if (d > m && e.clientHeight > 200 && getComputedStyle(e).overflowY !== 'visible' && getComputedStyle(e).overflowY !== 'hidden') { m = d; box = e } } if (box) box.scrollTop = box.scrollHeight; return m })
    out[`${file}-more`] = more
    if (more > 60) { await app.waitForTimeout(300); await note(app, `${file}-foot`) }
  }
  await note(app, 'ticket-empty')
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  await app.waitForTimeout(2500)
  await win.getByRole('button', { name: /PRICE/ }).click().catch(() => {})
  await app.waitForTimeout(3500)
  await tab('TRADE', 'ticket-trade')
  await tab('DETAILS', 'ticket-details')
  await tab('CASHFLOWS', 'ticket-cashflows')
  await tab('CURVE SCENARIO', 'ticket-scenario')
  await tab('XVA', 'ticket-xva-before')
  const asked = app.waitForResponse(r => r.url().includes('/api/xva/') && r.request().method() === 'POST', { timeout: 120_000 }).catch(() => null)
  await win.getByRole('button', { name: /SIMULATE/ }).click().catch(() => {})
  await asked; await app.waitForTimeout(2500)
  await tab('XVA', 'ticket-xva')
  await win.locator('.tbw-tab[data-tab="TRADE"]').scrollIntoViewIfNeeded(); await win.locator('.tbw-tab[data-tab="TRADE"]').click()
  await win.getByRole('button', { name: /BOOK TRADE/ }).click().catch(() => {})
  await app.waitForTimeout(3500); await note(app, 'ticket-booked')
  await tab('DETAILS', 'ticket-booked-details')
  await tab('◆ CONFIRM', 'ticket-confirm')
  const done = app.waitForResponse(r => r.url().includes('/api/chain/confirm/'), { timeout: 60_000 }).catch(() => null)
  await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click().catch(() => {})
  await done; await app.waitForTimeout(6000)
  await tab('◆ CONFIRM', 'ticket-confirmed')
  await win.locator('.tbw-light-r').click().catch(() => {})
  await app.waitForTimeout(1200); await note(app, 'trades-after')
  await nav.getByRole('button', { name: /NEWS/ }).click(); await app.waitForTimeout(1500); await note(app, 'news')
  await nav.getByRole('button', { name: /CHAT/ }).click(); await app.waitForTimeout(1500); await note(app, 'chat')
})

// The other tickets a visitor will open: a swap, an FX forward, an option. Each tab, top and foot, priced.
for (const [kind, pick] of [['rates', ['RATES']], ['fx', ['FX']], ['option', ['CRYPTO OPTION']], ['fxoption', ['FX', 'FX OPTION']]]) {
  test(`the phone: a ${kind} ticket tab by tab`, async ({ app }) => {
    test.setTimeout(300_000)
    await app.goto('/blotter')
    await app.getByRole('navigation', { name: 'Rijeka' }).getByRole('button', { name: 'New trade' }).click()
    const win = app.locator('.tbw-window')
    await win.waitFor()
    for (const b of pick) { await win.getByRole('button', { name: b, exact: true }).first().click().catch(() => { out[`${kind}-pick-${b}`] = 'no such button' }); await app.waitForTimeout(600) }
    await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' }).catch(() => {})
    await app.waitForTimeout(2500)
    await win.getByRole('button', { name: /PRICE/ }).first().click().catch(() => {})
    await app.waitForTimeout(5000)
    const tabs = await win.locator('.tbw-tab').evaluateAll(els => els.filter(e => e.getBoundingClientRect().width > 0).map(e => e.dataset.tab))
    out[`${kind}-tabs`] = tabs
    for (const name of tabs) {
      const b = win.locator(`.tbw-tab[data-tab="${name}"]`)
      await b.scrollIntoViewIfNeeded(); await b.click(); await app.waitForTimeout(1500)
      const file = `${kind}-${name.replace(/[^A-Z]+/g, '-').toLowerCase().replace(/^-|-$/g, '')}`
      if (name === 'XVA') {
        const asked = app.waitForResponse(r => r.url().includes('/api/xva/') && r.request().method() === 'POST', { timeout: 120_000 }).catch(() => null)
        await win.getByRole('button', { name: /SIMULATE/ }).first().click().catch(() => {})
        await asked; await app.waitForTimeout(2500)
      }
      await note(app, file)
      // the blocks a phone turns on their side, each brought to the top of the screen
      for (const [id, tag] of [['va-strip', 'strip'], ['va-on-chain', 'onchain'], ['fx-scn-results', 'results'], ['fx-scn-ladder', 'ladder']]) {
        const el = win.getByTestId(id).first()
        if (await el.count() && await el.isVisible()) { await el.evaluate(e => e.scrollIntoView({ block: 'start' })); await app.waitForTimeout(300); await note(app, `${file}-${tag}`) }
      }
      const more = await win.evaluate(el => { let m = 0, box = null; for (const e of [el, ...el.querySelectorAll('*')]) { const d = e.scrollHeight - e.clientHeight; if (d > m && e.clientHeight > 200 && getComputedStyle(e).overflowY !== 'visible' && getComputedStyle(e).overflowY !== 'hidden') { m = d; box = e } } if (box) box.scrollTop = box.scrollHeight / 2; return m })
      if (more > 500) { await app.waitForTimeout(300); await note(app, `${file}-mid`) }
      if (more > 60) { await win.evaluate(el => { for (const e of [el, ...el.querySelectorAll('*')]) if (e.scrollHeight - e.clientHeight > 60 && e.clientHeight > 200 && getComputedStyle(e).overflowY !== 'visible' && getComputedStyle(e).overflowY !== 'hidden') e.scrollTop = e.scrollHeight }); await app.waitForTimeout(300); await note(app, `${file}-foot`) }
    }
  })
}

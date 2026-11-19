// The footer of a ticket that carries a fee: the value first, then what the fees are worth today and the value net of
// them, then the sensitivities, in the same three places on every instrument. (The net stood only at the right of
// the FEES block: an option with its premium entered showed its own value in the footer and nothing else.) A ticket
// with no fee shows neither figure. The figures stay when another tab is opened, and the strip stays one line.
import { test, expect, expectClean, API } from './fixtures.js'

const DAY = 86400000
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)
const num = (s) => Number(String(s).replace(/[^0-9.−-]/g, '').replace('−', '-'))
const SHOTS = process.env.FOOTER_SHOTS || ''                      // a folder for a picture of each footer, when looking at them side by side

// [asset class, product button, the first figure's name, the response that carries the price, a step before PRICE]
// A swap with a cap sold on its floating leg has the longest strip of all: two legs, the option's value and vega.
const capped = async (win) => { await win.getByRole('button', { name: '+ CAP' }).first().click(); const k = win.getByLabel('Strike of the embedded cap').first(); await k.fill('4.5'); await k.blur() }
const TICKETS = [
  ['RATES', 'IR SWAP', /^NET NPV/, /\/price\/preview/],
  ['RATES', 'IR SWAP', /^NET NPV/, /\/price\/preview/, capped, 'with-a-cap'],
  ['RATES', 'IR SWAPTION', /^OPTION NPV/, /\/api\/price\/swaption/],
  ['RATES', 'INTEREST RATE CAP', /^OPTION NPV/, /\/api\/price\/cap/],
  ['RATES', 'INTEREST RATE FLOOR', /^OPTION NPV/, /\/api\/price\/floor/],
  ['RATES', 'INTEREST RATE COLLAR', /^NET NPV/, /\/api\/price\/collar/, async (win) => { await win.getByTestId('cap-rate').fill('4.5'); await win.getByTestId('floor-rate').fill('3.0') }],   // a collar's strikes are typed
  ['FX', 'FX FORWARD', /^NET NPV/, /\/api\/currency\/forward\/price/],
  ['FX', 'FX OPTION', /^PREMIUM/, /\/api\/currency\/option\/price/],
  ['CRYPTO', 'CRYPTO FORWARD', /^NET NPV/, /\/api\/currency\/forward\/price/],
  ['CRYPTO', 'CRYPTO OPTION', /^PREMIUM/, /\/api\/currency\/option\/price/],
  // the two longest strips again in a 1280 by 720 window, where the ticket is narrower
  ['RATES', 'IR SWAP', /^NET NPV/, /\/price\/preview/, capped, 'with-a-cap-at-1280', [1280, 720]],
  ['FX', 'FX OPTION', /^PREMIUM/, /\/api\/currency\/option\/price/, null, 'at-1280', [1280, 720]],
  // a sold option: its value is negative, the premium received; the three figures still add up
  ['FX', 'FX OPTION', /^PREMIUM/, /\/api\/currency\/option\/price/, async (win) => { await win.getByRole('button', { name: /^Sell /i }).first().click() }, 'sold'],
]

for (const [cls, product, first, route, prepare, tag, size] of TICKETS) {
  test(`${product}${tag ? ' ' + tag.replace(/-/g, ' ') : ''}: with a fee the footer reads value, fees, net, in that order`, async ({ app, problems }) => {
    if (size) await app.setViewportSize({ width: size[0], height: size[1] })
    await app.goto('/blotter')
    await app.getByText('+ NEW TRADE').first().click()
    const win = app.locator('.tbw-window')
    await win.waitFor()
    await win.getByRole('button', { name: cls, exact: true }).click()
    await win.getByRole('button', { name: new RegExp(`^${product}$`, 'i') }).click()
    if (prepare) await prepare(win)
    const priced = app.waitForResponse(r => route.test(r.url()) && r.request().method() === 'POST' && r.ok(), { timeout: 90_000 })
    await win.getByRole('button', { name: '▶ PRICE' }).click()
    const quote = await (await priced).json()
    const value = Number(quote.npv ?? quote.net_npv)
    const strip = win.locator('.tbw-footer-metrics'), figures = strip.locator('.tbw-footer-metric')
    const figureAt = async (i) => num(await figures.nth(i).locator('span').last().innerText())
    await expect(figures.first()).toContainText(first, { timeout: 30_000 })
    await expect(strip.getByTestId('footer-fees-pv'), 'no fee, no fee figure').toHaveCount(0)
    const before = await figures.count()

    const block = win.getByTestId('fees-block')
    await block.scrollIntoViewIfNeeded()
    await block.getByTestId('fee-add').click()
    const n = await block.getByTestId('fee-row').count()
    await block.getByRole('button', { name: `Fee ${n}: we pay` }).click()
    const answer = app.waitForResponse(r => r.url() === `${API}/api/price/fees` && r.request().method() === 'POST' && r.ok())
    await block.getByLabel(`Fee ${n} amount`).fill('12500')
    await block.getByLabel(`Fee ${n} date`).fill(iso(Date.now() + 31 * DAY))
    const pv = (await (await answer).json()).pv
    expect(pv).toBeLessThan(-12000)

    // the same three places on every instrument: the value, what the fees are worth, the value net of them
    // a swap's leg split gives way to the fees' two figures (CASHFLOWS has it); every other figure stays
    const legs = product === 'IR SWAP' ? 2 : 0
    await expect(strip.locator('.tbw-footer-metric', { hasText: /(FIXED|FLOAT) PV/ })).toHaveCount(0)
    await expect(figures).toHaveCount(before + 2 - legs)
    // an option on a currency pair or a digital asset names its premium, unsigned, while it carries no fee; with
    // one its first figure is its value with its sign, so the three add up whichever side was taken
    await expect(figures.nth(0)).toContainText(first.source === '^PREMIUM' ? /^OPTION NPV/ : first)
    expect(Math.abs(await figureAt(0) - value), 'the first figure is the value, signed').toBeLessThanOrEqual(1)
    await expect(figures.nth(1)).toHaveAttribute('data-testid', 'footer-fees-pv')
    await expect(figures.nth(1)).toContainText('PV OF FEES')
    await expect(figures.nth(2)).toHaveAttribute('data-testid', 'footer-fees-net')
    await expect(figures.nth(2)).toContainText('NET OF FEES')
    const shown = async (id) => num(await strip.getByTestId(id).locator('span').last().innerText())
    expect(Math.abs(await shown('footer-fees-pv') - pv), 'the fees as the FEES block values them').toBeLessThanOrEqual(1)
    expect(Math.abs(await shown('footer-fees-net') - (value + pv)), 'the value and its fees, added').toBeLessThanOrEqual(1)
    expect(Math.abs(num(await block.getByTestId('fees-net').innerText()) - (value + pv)), 'and the block says the same').toBeLessThanOrEqual(1)

    // one line, inside the window, clear of the buttons beside it
    const foot = win.locator('.tbw-footer')
    const box = await strip.evaluate(el => { const a = el.getBoundingClientRect(), last = el.lastElementChild.getBoundingClientRect(), acts = el.parentElement.querySelector('.tbw-footer-actions').getBoundingClientRect(), tops = [...el.children].map(c => Math.round(c.getBoundingClientRect().top)); return { right: last.right, actions: acts.left, tops, left: a.left } })
    expect(new Set(box.tops).size, 'the figures stand on one line').toBe(1)
    const lines = await strip.locator('.tbw-footer-metric .tbw-lbl').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)))
    expect(Math.max(...lines), 'and no name of a figure runs onto a second line').toBeLessThanOrEqual(20)
    expect(box.right, 'the last figure ends before STRUCTURE and the buttons').toBeLessThanOrEqual(box.actions + 1)
    if (SHOTS) await foot.screenshot({ path: `${SHOTS}/${cls}-${product.replace(/ /g, '-')}${tag ? '-' + tag : ''}.png` })

    // the footer is the window's, not the TRADE tab's: the figures stay on another tab
    await win.getByRole('button', { name: /^DETAILS/ }).first().click()
    await expect(strip.getByTestId('footer-fees-net')).toBeVisible()
    expectClean(problems.filter(p => !/A fee on the TRADE tab/.test(p)))
  })
}

// The confirmation of an option on a rate says it is an option (0.61.0, from a walk of CONFIRM on this stack).
// A swaption's signed record was the swap it delivers and nothing else: no buyer or seller, no expiry, no premium,
// the ticket's dates as the trade's, and a sold one's legs naming the wrong payer; its paper was a swap's. A cap's
// paper printed its options as the record's JSON under "floating leg, leverage 0". Here each is priced, booked,
// signed and anchored on the stack's own chain, and the record and the paper are read against the ticket.
import { test, expect, expectClean, expectNoHorizontalOverflow, API } from '../fixtures.js'

const SHOTS = 'e2e/.out/shots'
async function confirmed(app, product, route, setup) {
  await app.goto('/blotter')
  await app.getByText('+ NEW TRADE').first().click()
  const win = app.locator('.tbw-window')
  await win.waitFor()
  await win.getByRole('button', { name: 'RATES', exact: true }).click()
  await win.getByRole('button', { name: new RegExp(`^${product}$`, 'i') }).click()
  await win.locator('select').filter({ has: app.locator('option', { hasText: 'RIJEKA DEMO BANK AG' }) }).first().selectOption({ label: 'RIJEKA DEMO BANK AG' })
  await setup(win)
  const priced = app.waitForResponse(r => r.url() === `${API}${route}` && r.request().method() === 'POST' && r.ok(), { timeout: 90_000 })
  await win.getByRole('button', { name: '▶ PRICE' }).click()
  const quote = await (await priced).json()
  const booking = app.waitForResponse(r => r.url().includes('/api/book/trade') && r.request().method() === 'POST', { timeout: 60_000 })
  await win.getByRole('button', { name: /BOOK TRADE/ }).click()
  const sent = (await booking).request().postDataJSON()
  await win.getByRole('button', { name: '◆ CONFIRM' }).click()
  await expect(win).toContainText('PENDING')
  const record = app.waitForResponse(async r => r.url().startsWith(`${API}/api/chain/attestation/`) && r.ok() && !!(await r.json().catch(() => null))?.attestation?.anchor, { timeout: 90_000 })
  await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click()
  const att = (await (await record).json()).attestation
  await expect(win).toContainText('CONFIRMED', { timeout: 60_000 })
  const cert = win.getByTestId('confirm-certificate')
  const verified = app.waitForResponse(r => r.url().startsWith(`${API}/api/chain/verify/`), { timeout: 60_000 })
  await cert.getByRole('button', { name: /VERIFY/ }).click()
  const verify = await (await verified).json()
  await cert.getByTestId('paper-open').click()
  const sheet = app.getByTestId('paper-confirmation')
  await expect(sheet).toBeVisible()
  return { win, quote, sent, att, verify, sheet }
}

test('a sold swaption confirmed on a chain: the record names who bought it, its expiry, strike and premium, and the paper reads as an option', async ({ app, problems }) => {
  const { quote, sent, att, verify, sheet } = await confirmed(app, 'IR SWAPTION', '/api/price/swaption', async (win) => {
    await win.getByRole('button', { name: 'SELL', exact: true }).first().click()
    await expect(win.getByTestId('swaption-underlying')).toBeVisible()
  })
  expect(quote.npv, 'a sold option is worth less than nothing to its seller').toBeLessThan(0)
  expect(sent.terms.premium_amount, 'no premium typed: booked at the price, as its buyer pays it').toBeCloseTo(-quote.npv, 2)
  expect(att.schema_version).toBe(3)
  expect(att.anchor.anchored).toBe(true)
  expect(verify.hash_matches).toBe(true); expect(verify.on_chain_confirmed).toBe(true)
  const rec = verify.canonical, booker = att.parties.own.lei, bank = att.parties.counterparty.lei
  expect(rec.option).toMatchObject({ type: 'SWAPTION', buyer: bank, seller: booker, right: 'PAYER', exercise_style: 'EUROPEAN', settlement: 'PHYSICAL',
    expiry_date: sent.terms.expiry_date, premium_currency: 'USD' })
  expect(Number(rec.option.strike)).toBeCloseTo(quote.strike, 8)
  expect(Number(rec.option.premium_amount)).toBeCloseTo(-quote.npv, 2)
  const fixed = rec.legs.find(l => l.leg_type === 'FIXED')
  expect(fixed.payer, 'if the buyer exercises a payer swaption, the buyer pays the fixed rate').toBe(bank)
  expect(fixed.effective_date > rec.option.expiry_date, 'the swap delivered starts after the option expires').toBe(true)
  expect(rec.trade.effective_date, 'the trade block holds no date of the ticket that is neither the option\'s nor the swap\'s').toBeUndefined()

  // the paper: an option, not a swap
  await expect(sheet).toContainText('Interest rate swaption')
  const parties = sheet.locator('.paper-party .cert-caps')
  await expect(parties.nth(0)).toContainText('Party A · Seller'); await expect(parties.nth(2)).toContainText('Party B · Buyer')
  for (const words of ['Option · Party B buys from Party A', 'Payer swaption: the right to pay the fixed rate', 'Expiry date', 'Premium paid by', 'Party B to Party A',
    'Swap delivered on exercise · fixed leg · Party B pays Party A', 'record schema v3']) await expect(sheet).toContainText(words)
  await expect(sheet).not.toContainText('Pays fixed')
  await expect(app.getByTestId('paper-gap')).toHaveCount(0)
  await expectNoHorizontalOverflow(sheet, 'the paper')
  await sheet.screenshot({ path: `${SHOTS}/paper-swaption.png` })
  expectClean(problems)
})

test('a collar confirmed on a chain: each option with its buyer and strike, the premium and who pays it, and nothing of the record\'s JSON on the paper', async ({ app, problems }) => {
  const { quote, att, verify, sheet } = await confirmed(app, 'INTEREST RATE COLLAR', '/api/price/collar', async (win) => {
    await expect(win.locator('input[type=date]').nth(2)).not.toHaveValue('')
    await win.getByTestId('cap-rate').fill('4.5'); await win.getByTestId('floor-rate').fill('3.0')
  })
  expect(att.schema_version).toBe(3)
  expect(verify.hash_matches).toBe(true); expect(verify.on_chain_confirmed).toBe(true)
  const rec = verify.canonical, booker = att.parties.own.lei, bank = att.parties.counterparty.lei
  const net = quote.net_npv
  expect(rec.option).toMatchObject({ type: 'COLLAR', buyer: booker, seller: bank, premium_payer: net >= 0 ? booker : bank, premium_receiver: net >= 0 ? bank : booker })
  expect(Number(rec.option.premium_amount)).toBeCloseTo(Math.abs(net), 2)
  const options = rec.legs[0].embedded_options
  expect(options.find(o => o.type === 'CAP')).toMatchObject({ default_strike: '0.045', buyer: booker, seller: bank })
  expect(options.find(o => o.type === 'FLOOR')).toMatchObject({ default_strike: '0.03', buyer: bank, seller: booker })
  await expect(sheet).toContainText('Interest rate collar')
  for (const words of ['Party A · Buys the cap, sells the floor', 'Cap · Party A buys from Party B', 'Floor · Party B buys from Party A', 'The rate and its periods', 'Premium paid by'])
    await expect(sheet).toContainText(words)
  const text = await sheet.innerText()
  expect(text, 'a strike is a percentage on the sheet').toMatch(/Strike\s+4\.5 %/)
  expect(text).toMatch(/Strike\s+3 %/)
  expect(text, 'nothing of the record\'s JSON').not.toMatch(/[{}[\]"]/)
  expect(text).not.toMatch(/Leverage|pays floating/i)
  await expectNoHorizontalOverflow(sheet, 'the paper')
  await sheet.screenshot({ path: `${SHOTS}/paper-collar.png` })
  expectClean(problems)
})

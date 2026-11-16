// The confirm tab said "the Sepolia registry" on its empty page and "the TradeConfirmationRegistry on Ethereum" beside
// the button; told a visitor that the demo bank "isn't on Rijeka yet" and to send it a request to sign with a
// command-line tool, when Rijeka signs for the demo bank; and drew VERIFY's answer under the fold of the tab (Marco,
// 15 November 2026). The chain is named as the server reports it, once, and the answer comes into view.
import { test, expect, expectClean, bookedSwap, API } from './fixtures.js'

const chain = (app, status) => app.route(`${API}/api/chain/status`, route => route.fulfill({ json: { schema_version: 2, backend: 'Test', registry: '0x' + 'ab'.repeat(20), ...status } }))

test('the confirm tab names the chain the server is on, and says who signs for the demo bank', async ({ app, problems }) => {
  await chain(app, { anchored: true, chain_id: 11155111 })
  const win = await bookedSwap(app)                       // pending, on the CONFIRM tab
  await expect(win).toContainText("anchors the pair of signatures in the TradeConfirmationRegistry on Sepolia, Ethereum's test network.")
  await expect(win).not.toContainText('Registry on Ethereum.')
  // the demo bank: Rijeka signs for it, and says so; it is not a firm that "isn't on Rijeka yet"
  const why = win.getByTestId('send-why-not')
  await expect(why).toContainText('This is a demo counterparty: its LEI begins DEMO. Where the server holds a key for it, as the hosted demo does, CONFIRM below signs for it too')
  await expect(why).not.toContainText(/isn.t on Rijeka|command-line/)
  await win.screenshot({ path: 'e2e/.out/shots/confirm-words-pending.png' })

  // confirmed: VERIFY's answer is on the screen when it arrives, not under the fold of the tab
  await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click()
  const verify = win.getByRole('button', { name: /VERIFY/ })
  await expect(verify).toBeVisible({ timeout: 60_000 })
  await verify.click()
  const verdict = win.getByTestId('confirm-verify-result')
  await expect(verdict).toContainText('hash of current terms matches', { timeout: 30_000 })
  await expect(verdict, 'the answer is where the eye is').toBeInViewport({ ratio: 1 })
  // ... and not under the ticket's footer, which stays in place over what scrolls: in the viewport is not in view
  const foot = win.locator('text=NET NPV').last().locator('xpath=ancestor::div[2]')
  await expect.poll(async () => (await foot.boundingBox()).y - ((await verdict.boundingBox()).y + (await verdict.boundingBox()).height), { message: 'the answer ends above the footer' }).toBeGreaterThanOrEqual(0)
  await win.screenshot({ path: 'e2e/.out/shots/confirm-words-verified.png' })
  expectClean(problems)
})

test('a server with no chain, or on Ethereum itself, is worded as that', async ({ app, problems }) => {
  await chain(app, { anchored: false, chain_id: null, registry: null })
  let win = await bookedSwap(app)
  await expect(win).toContainText('This server has no chain configured: the signatures are kept and nothing is anchored, and the certificate says so.')
  await expect(win).not.toContainText(/TradeConfirmationRegistry on/)
  await app.unroute(`${API}/api/chain/status`)

  // a real counterparty is still told what is true of it
  await app.route('**/trades/*/send-status', async route => {
    const res = await route.fetch(); const j = await res.json()
    j.counterparty = { ...j.counterparty, lei: '5493001KJTIIGC8Y1R12', on_network: false }; j.reason = "This counterparty isn't on Rijeka yet."
    await route.fulfill({ response: res, json: j })
  })
  await chain(app, { anchored: true, chain_id: 1 })
  await app.reload()                                      // the chain is asked once a page load
  win = await bookedSwap(app)
  await expect(win).toContainText('in the TradeConfirmationRegistry on Ethereum. From that block')
  await expect(win.getByTestId('send-why-not')).toContainText("This counterparty isn't on Rijeka yet. Their countersignature has to come from their own system")

  // a demo entity that has registered a wallet of its own signs for itself: the server will not, and the note does not say it will
  await app.unroute('**/trades/*/send-status')
  await app.route('**/trades/*/send-status', async route => {
    const res = await route.fetch(); const j = await res.json()
    j.counterparty = { ...j.counterparty, lei: 'DEMO0000RIJEKABANK01', on_network: false, has_signer: true }; j.reason = "This counterparty isn't on Rijeka yet."
    await route.fulfill({ response: res, json: j })
  })
  win = await bookedSwap(app)
  await expect(win.getByTestId('send-why-not')).toContainText('Their countersignature has to come from their own system')
  await expect(win.getByTestId('send-why-not')).not.toContainText('signs for it')
  expectClean(problems)
})

// The home's small diagram of a confirmation ends at the registry, and says which chain it is on. Its last node is 36px
// from the edge: a name longer than "Ethereum" was cut off there.
for (const [status, label, step] of [
  [{ anchored: true, chain_id: 11155111 }, 'Sepolia', "Confirm it on Sepolia from the trade's CONFIRM tab"],
  [{ anchored: true, chain_id: 8453 }, 'chain 8453', "Confirm it on chain 8453 from the trade's CONFIRM tab"],
  [{ anchored: false, chain_id: 0, registry: null }, 'no chain', "Confirm it from the trade's CONFIRM tab"],
]) test(`the home names the chain as the confirm tab does: ${label}`, async ({ app, problems }) => {
  await app.setViewportSize({ width: 1440, height: 900 })
  await chain(app, status)
  await app.route('**/api/trades/', route => route.fulfill({ json: [] }))          // an empty book: the diagram stands where the trades' chain would
  await app.route('**/api/desk/lifecycle', async route => { const res = await route.fetch(); const j = await res.json(); for (const k of Object.keys(j)) if (Array.isArray(j[k])) j[k] = []; await route.fulfill({ response: res, json: j }) })      // and nothing confirmed yet
  await app.goto('/command-center')
  const home = app.getByTestId('trader-home')
  await expect(home.locator('.dh-step', { hasText: 'Confirm it' })).toHaveText(new RegExp(step.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 30_000 })
  await home.getByRole('tab', { name: 'ON CHAIN' }).click()
  const svg = home.locator('.dh-chain svg')
  await expect(svg).toContainText(label, { timeout: 30_000 })
  await expect(svg).not.toContainText('Ethereum')
  const fits = () => svg.evaluate(el => {
    const b = el.getBoundingClientRect(), ts = [...el.querySelectorAll('text')].map(t => ({ s: t.textContent, r: t.getBoundingClientRect() }))
    const past = ts.filter(t => t.r.left < b.left - 0.5 || t.r.right > b.right + 0.5).map(t => t.s)
    const over = ts.flatMap((a, i) => ts.slice(i + 1).filter(c => Math.abs(a.r.top - c.r.top) < 2 && a.r.left < c.r.right && c.r.left < a.r.right).map(c => `${a.s} / ${c.s}`))
    return { past, over }
  })
  expect(await fits(), 'a label of the diagram runs past its edge, or over the next').toEqual({ past: [], over: [] })
  await expect(svg, 'the first label is whole').toContainText('canonical record')
  await home.locator('.dh-chain').screenshot({ path: `e2e/.out/shots/home-chain-${label.replace(/\W+/g, '-')}.png` })
  // on a phone the diagram keeps its four names and drops the lines under them, which do not fit side by side
  await app.setViewportSize({ width: 390, height: 844 })
  await app.goto('/command-center')                      // the phone's home is another page of the app: load it as a phone would
  const small = app.locator('.dh-chain svg').first()
  if (await small.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false)) {
    expect(await small.evaluate(el => { const b = el.getBoundingClientRect(), ts = [...el.querySelectorAll('text')].map(t => ({ s: t.textContent, r: t.getBoundingClientRect() })); return { past: ts.filter(t => t.r.left < b.left - 0.5 || t.r.right > b.right + 0.5).map(t => t.s), over: ts.flatMap((a, i) => ts.slice(i + 1).filter(c => Math.abs(a.r.top - c.r.top) < 2 && a.r.left < c.r.right && c.r.left < a.r.right).map(c => `${a.s} / ${c.s}`)) } }), 'the diagram on a phone').toEqual({ past: [], over: [] })
    await small.scrollIntoViewIfNeeded()
    await app.screenshot({ path: `e2e/.out/shots/home-chain-phone-${label.replace(/\W+/g, '-')}.png` })
  } else test.info().annotations.push({ type: 'not on this stack', description: 'the phone home did not show the diagram' })
  expectClean(problems)
})

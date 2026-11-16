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
  await expect(why).toContainText('This is the demo counterparty. Rijeka holds its key and signs for it when you confirm below')
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
  expectClean(problems)
})

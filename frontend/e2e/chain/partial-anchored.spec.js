// A partial termination of a trade whose confirmation is anchored. The registry holds the hash of the terms both
// parties signed, so reducing the notional supersedes that record: both sign the new one, one transaction, and the
// journey asks the node itself what it now holds (this stack runs anvil with the registry: e2e/serve.sh under
// RIJEKA_E2E_CHAIN=1).
import { test, expect, expectClean, API, bookedSwap } from '../fixtures.js'

const RPC = 'http://127.0.0.1:8546'
const num = (s) => Number(String(s).replace(/,/g, ''))

const ask = async (request, method, params = []) => {
  const r = await request.post(RPC, { data: { jsonrpc: '2.0', id: 1, method, params } })
  const body = await r.json()
  expect(body.error, `${method}: ${JSON.stringify(body.error)}`).toBeUndefined()
  return body.result
}
const keccak = (request, signature) => ask(request, 'web3_sha3', ['0x' + Buffer.from(signature).toString('hex')])

test('an anchored trade is partially terminated: the record is superseded on the chain, and the registry holds the reduced one', async ({ app, problems, request }) => {
  const win = await bookedSwap(app)
  const first = app.waitForResponse(async r => r.url().startsWith(`${API}/api/chain/attestation/`) && r.ok() && !!(await r.json().catch(() => null))?.attestation?.anchor)
  await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click()
  const before = (await (await first).json()).attestation
  expect(before.anchor.anchored).toBe(true)
  await expect(win).toContainText('CONFIRMED', { timeout: 60_000 })

  // reduce it to a quarter, paying a fee
  const block = win.getByTestId('partial-termination')
  await win.getByTestId('partial-open').click()
  await expect(block).toContainText('superseded on-chain')
  const now = num((await block.innerText()).match(/now\s+([\d,.]+)/)[1])
  await win.getByTestId('partial-remaining').fill(String(now / 4))
  await win.getByTestId('partial-fee-amount').fill('900')
  const sent = app.waitForResponse(r => r.url().includes('/api/chain/partial-terminate/') && r.request().method() === 'POST')
  // the record the ticket reads next: a new hash, whose parent is the one that was signed first
  const reread = app.waitForResponse(async r => r.url().startsWith(`${API}/api/chain/attestation/`) && r.ok() && !!(await r.json().catch(() => null))?.attestation?.prev_hash)
  await win.getByTestId('partial-submit').click()
  const res = await sent
  expect(res.status(), await res.text()).toBe(201)
  const j = await res.json()
  expect(num(j.trade.notional)).toBe(now / 4)
  expect(j.trade.status).toBe('CONFIRMED')
  expect(j.partial_termination.anchored).toBe(true)
  await expect(win.getByTestId('partial-done')).toContainText('the signed record was superseded on-chain')

  const att = (await (await reread).json()).attestation
  expect(att.trade_hash).not.toBe(before.trade_hash)
  expect(att.prev_hash).toBe(before.trade_hash)
  expect(att.anchor.anchored).toBe(true)

  // the chain itself: the amending transaction succeeded and raised Amended(prev, new); the registry no longer holds
  // the first record as confirmed and holds the reduced one
  const receipt = await ask(request, 'eth_getTransactionReceipt', [att.anchor.tx_hash])
  expect(receipt.status).toBe('0x1')
  const topic = await keccak(request, 'Amended(bytes32,bytes32,address,address,uint64)')
  const event = receipt.logs.find(l => l.topics[0] === topic)
  expect(event, 'the registry raised Amended').toBeTruthy()
  expect(event.topics[1]).toBe(before.trade_hash)
  expect(event.topics[2]).toBe(att.trade_hash)
  const isConfirmed = (await keccak(request, 'isConfirmed(bytes32)')).slice(0, 10)
  const held = (h) => ask(request, 'eth_call', [{ to: att.anchor.registry, data: isConfirmed + h.slice(2) }, 'latest'])
  expect(BigInt(await held(att.trade_hash)), 'the reduced record is confirmed').toBe(1n)
  expect(BigInt(await held(before.trade_hash)), 'the first record is superseded').toBe(0n)

  // VERIFY, as a counterparty would press it: the reduced booking hashes to what the registry holds
  const verified = app.waitForResponse(r => r.url().startsWith(`${API}/api/chain/verify/`))
  await win.getByTestId('confirm-certificate').getByRole('button', { name: /VERIFY/ }).click()
  const v = await (await verified).json()
  expect(v.hash_matches).toBe(true)
  expect(v.on_chain_confirmed).toBe(true)
  expectClean(problems)
})

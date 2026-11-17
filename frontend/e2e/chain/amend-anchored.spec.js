// An amendment of a trade whose confirmation is anchored. The registry holds the hash of the terms both parties
// signed, so a new coupon supersedes that record: both sign the new one, one transaction, and the journey asks the
// node itself what it now holds (this stack runs anvil with the registry: e2e/serve.sh under RIJEKA_E2E_CHAIN=1).
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

test('an anchored trade is amended: the record is superseded on the chain, and the registry holds the amended one', async ({ app, problems, request }) => {
  const win = await bookedSwap(app)
  const first = app.waitForResponse(async r => r.url().startsWith(`${API}/api/chain/attestation/`) && r.ok() && !!(await r.json().catch(() => null))?.attestation?.anchor)
  await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click()
  const before = (await (await first).json()).attestation
  expect(before.anchor.anchored).toBe(true)
  await expect(win).toContainText('CONFIRMED', { timeout: 60_000 })

  // the coupon goes up a quarter point and the notional by half: an amendment, both parties signing
  await expect(win.getByTestId('amend-open')).toHaveText('◆ AMEND')
  await win.getByTestId('amend-open').click()
  await expect(win.getByTestId('amend-what')).toContainText('replaced on-chain')
  const nowOf = async key => num((await win.getByTestId(`amend-term-${key}`).innerText()).match(/now\s+(-?[\d,.]+)/)[1])
  const [n0, c0] = [await nowOf('notional'), await nowOf('fixed_rate')]
  const c1 = Math.round((c0 + 0.25) * 1e6) / 1e6, n1 = n0 * 1.5
  await win.getByTestId('amend-fixed_rate').fill(String(c1))
  await win.getByTestId('amend-notional').fill(String(n1))
  const sent = app.waitForResponse(r => r.url().includes('/api/chain/amend-terms/') && r.request().method() === 'POST')
  // the record the ticket reads next: a new hash, whose parent is the one that was signed first
  const reread = app.waitForResponse(async r => r.url().startsWith(`${API}/api/chain/attestation/`) && r.ok() && !!(await r.json().catch(() => null))?.attestation?.prev_hash)
  await win.getByTestId('amend-submit').click()
  const res = await sent
  expect(res.status(), await res.text()).toBe(201)
  const j = await res.json()
  expect(num(j.trade.notional)).toBe(n1)
  expect(num(j.legs.find(l => l.leg_type === 'FIXED').fixed_rate)).toBeCloseTo(c1 / 100, 8)
  expect(j.trade.status).toBe('CONFIRMED')
  expect(j.amendment).toMatchObject({ kind: 'AMENDMENT', anchored: true, increase: true })
  await expect(win.getByTestId('amend-done')).toContainText('the signed record was replaced on-chain')

  const att = (await (await reread).json()).attestation
  expect(att.trade_hash).not.toBe(before.trade_hash)
  expect(att.prev_hash).toBe(before.trade_hash)
  expect(att.anchor.anchored).toBe(true)

  // the chain itself: the amending transaction succeeded and raised Amended(prev, new); the registry no longer holds
  // the first record as confirmed and holds the amended one
  const receipt = await ask(request, 'eth_getTransactionReceipt', [att.anchor.tx_hash])
  expect(receipt.status).toBe('0x1')
  const topic = await keccak(request, 'Amended(bytes32,bytes32,address,address,uint64)')
  const event = receipt.logs.find(l => l.topics[0] === topic)
  expect(event, 'the registry raised Amended').toBeTruthy()
  expect(event.topics[1]).toBe(before.trade_hash)
  expect(event.topics[2]).toBe(att.trade_hash)
  const isConfirmed = (await keccak(request, 'isConfirmed(bytes32)')).slice(0, 10)
  const held = (h) => ask(request, 'eth_call', [{ to: att.anchor.registry, data: isConfirmed + h.slice(2) }, 'latest'])
  expect(BigInt(await held(att.trade_hash)), 'the amended record is confirmed').toBe(1n)
  expect(BigInt(await held(before.trade_hash)), 'the first record is superseded').toBe(0n)

  // our half for a counterparty that signs for itself: the request names the same new hash only for the same terms,
  // and nothing is written by asking
  const asked = await app.evaluate(async ([url]) => {
    const session = JSON.parse(sessionStorage.getItem('sb-stack-auth-token') || '{}')
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ terms: { spread: '5' } }) })
    return { status: r.status, body: await r.json().catch(() => null) }
  }, [`${API}/api/chain/amend-terms-request/${j.trade.id}`])
  expect(asked.status, JSON.stringify(asked.body)).toBe(200)
  const ask2 = asked.body
  expect(ask2.prev_hash, 'the request starts from the record the registry now holds').toBe(att.trade_hash)
  expect(ask2.new_hash).not.toBe(att.trade_hash)
  expect(ask2.amendment.terms.map(t => t.key)).toEqual(['spread'])
  expect(ask2.from.signature).toMatch(/^0x[0-9a-f]{130}$/)

  // VERIFY, as a counterparty would press it: the amended booking hashes to what the registry holds (the request above wrote nothing)
  const verified = app.waitForResponse(r => r.url().startsWith(`${API}/api/chain/verify/`))
  await win.getByTestId('confirm-certificate').getByRole('button', { name: /VERIFY/ }).click()
  const v = await (await verified).json()
  expect(v.hash_matches).toBe(true)
  expect(v.on_chain_confirmed).toBe(true)
  expectClean(problems)
})

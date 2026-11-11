// A confirmation that is really anchored. This stack runs Foundry's anvil with the registry deployed to it
// (e2e/serve.sh under RIJEKA_E2E_CHAIN=1), so CONFIRM ON-CHAIN signs the terms, sends the transaction and reads its
// receipt, as the hosted instance does. The other journeys run with no chain: there a record is signed and not
// anchored, and logo.spec.js can only say a record was anchored to look at what that draws. Here nothing is said
// for the chain: the journey asks the node itself what it holds.
import { test, expect, expectClean, API, bookedSwap, ink } from '../fixtures.js'

const RPC = 'http://127.0.0.1:8546'
const LOCAL_CHAIN = 31337

const ask = async (request, method, params = []) => {
  const r = await request.post(RPC, { data: { jsonrpc: '2.0', id: 1, method, params } })
  const body = await r.json()
  expect(body.error, `${method}: ${JSON.stringify(body.error)}`).toBeUndefined()
  return body.result
}
// the node hashes a signature for us (keccak-256): an event's topic is the whole hash, a function's selector its first four bytes
const keccak = (request, signature) => ask(request, 'web3_sha3', ['0x' + Buffer.from(signature).toString('hex')])

test('a trade confirmed on a chain: signed, sent, anchored, drawn with its ring, and found on the chain and in the register', async ({ app, problems, request }, testInfo) => {
  await app.emulateMedia({ reducedMotion: 'no-preference' })      // this journey watches the drawing complete
  expect(Number(await ask(request, 'eth_chainId')), 'the stack has its own test chain').toBe(LOCAL_CHAIN)
  const blockBefore = Number(await ask(request, 'eth_blockNumber'))

  const win = await bookedSwap(app)
  const ref = (await win.locator('.tbw-title').innerText()).match(/TRD-\d+/)?.[0]
  expect(ref, 'the booked trade has a reference').toBeTruthy()
  const mark = win.getByTestId('confirm-mark'), caption = win.getByTestId('confirm-mark-caption')
  await expect(mark, 'nothing is drawn before a confirmation is asked for').toHaveCount(0)

  // 1. the confirmation: one request, and then the record the ticket reads carries an anchor on this chain. The
  //    request is held a second and a half so its progress can be read: a local chain answers faster than a look
  await app.route(`${API}/api/chain/confirm/**`, async route => {
    await new Promise(r => setTimeout(r, 1500))
    await route.fulfill({ response: await route.fetch() })
  }, { times: 1 })
  const confirmed = app.waitForResponse(r => r.url().startsWith(`${API}/api/chain/confirm/`) && r.request().method() === 'POST')
  const record = app.waitForResponse(async r => r.url().startsWith(`${API}/api/chain/attestation/`) && r.ok() && !!(await r.json().catch(() => null))?.attestation?.anchor)
  await win.getByRole('button', { name: /CONFIRM ON-CHAIN/ }).click()
  await expect(mark).toHaveAttribute('data-phase', 'running')
  await expect(caption).toHaveText('SIGNING AND ANCHORING')
  expect((await confirmed).status()).toBe(201)
  const att = (await (await record).json()).attestation
  expect(att.anchor.anchored, 'the record is anchored').toBe(true)
  expect(att.anchor.chain_id).toBe(LOCAL_CHAIN)
  expect(att.anchor.tx_hash).toMatch(/^0x[0-9a-f]{64}$/)
  expect(att.trade_hash).toMatch(/^0x[0-9a-f]{64}$/)

  // 2. what the ticket shows: confirmed, the R and its ring drawn, and the words say it is on a chain
  await expect(win).toContainText('CONFIRMED', { timeout: 60_000 })
  await expect(mark).toHaveAttribute('data-phase', 'done')
  await expect(mark).toHaveAttribute('data-sealed', 'yes', { timeout: 15_000 })
  await expect(caption).toHaveText('CONFIRMED ON CHAIN')
  await expect(mark).toHaveAttribute('aria-label', /Confirmed on chain/)
  await expect.poll(async () => (await ink(mark)).letter, { timeout: 8000, message: 'the R and its ring are both drawn for an anchored record' }).toBeGreaterThan(380)
  const cert = win.getByTestId('confirm-certificate')
  await expect(cert).toBeVisible()
  await expect(cert).toContainText('The terms are signed and anchored')
  await expect(cert).toContainText('CONFIRMED ON LOCAL TEST CHAIN')
  await expect(cert, 'the certificate names the transaction').toContainText(att.anchor.tx_hash)
  await expect(cert, 'and the hash that was signed').toContainText(att.trade_hash)
  await expect(cert).not.toContainText('NOT ANCHORED')
  await app.screenshot({ path: 'e2e/.out/shots/confirm-anchored.png' })

  // 3. the chain itself, asked without the app: the transaction succeeded, went to the registry the certificate
  //    names, in the block it names, and raised the registry's event for this hash; the registry says it is confirmed
  const receipt = await ask(request, 'eth_getTransactionReceipt', [att.anchor.tx_hash])
  expect(receipt, 'the node knows the transaction').toBeTruthy()
  expect(receipt.status, 'the transaction succeeded').toBe('0x1')
  expect(receipt.to.toLowerCase(), 'it went to the registry the certificate names').toBe(att.anchor.registry.toLowerCase())
  expect(Number(receipt.blockNumber)).toBe(att.anchor.block_number)
  expect(Number(receipt.blockNumber), 'a block mined for this confirmation').toBeGreaterThan(blockBefore)
  const topic = await keccak(request, 'Confirmed(bytes32,address,address,uint64)')
  const event = receipt.logs.find(l => l.topics[0] === topic)
  expect(event, 'the registry raised Confirmed').toBeTruthy()
  expect(event.address.toLowerCase()).toBe(att.anchor.registry.toLowerCase())
  expect(event.topics[1], 'for the hash on the certificate').toBe(att.trade_hash)
  const isConfirmed = (await keccak(request, 'isConfirmed(bytes32)')).slice(0, 10)
  const held = await ask(request, 'eth_call', [{ to: att.anchor.registry, data: isConfirmed + att.trade_hash.slice(2) }, 'latest'])
  expect(BigInt(held), 'the registry holds the hash as confirmed').toBe(1n)
  const never = await ask(request, 'eth_call', [{ to: att.anchor.registry, data: isConfirmed + 'ab'.repeat(32) }, 'latest'])
  expect(BigInt(never), 'and does not hold a hash nobody confirmed').toBe(0n)

  // 4. VERIFY, as a counterparty would press it: the stored terms still hash to what was signed, and the registry agrees
  const verified = app.waitForResponse(r => r.url().startsWith(`${API}/api/chain/verify/`))
  await cert.getByRole('button', { name: /VERIFY/ }).click()
  const v = await (await verified).json()
  expect(v.hash_matches).toBe(true)
  expect(v.on_chain_confirmed).toBe(true)
  await expect(win).toContainText('hash of current terms matches the signed hash')
  await expect(win).toContainText('registry status: Confirmed')

  // 5. the public register lists it: the hash, the transaction, the chain, and nothing but shapes
  //    (the API keeps the register's answer a minute for each size asked for: a second attempt asks for another size)
  const register = await (await request.get(`${API}/api/public/confirmations?limit=${49 - testInfo.retry}`)).json()
  const row = register.confirmations.find(c => c.trade_hash === att.trade_hash)
  expect(row, 'the register has the confirmation').toBeTruthy()
  expect(row.tx_hash).toBe(att.anchor.tx_hash)
  expect(row.chain_id).toBe(LOCAL_CHAIN)
  expect(row.block_number).toBe(att.anchor.block_number)
  expect(row.registry.toLowerCase()).toBe(att.anchor.registry.toLowerCase())
  expect(row.parties, 'two LEIs, twenty characters each').toHaveLength(2)
  for (const lei of row.parties) expect(lei).toMatch(/^[A-Z0-9]{20}$/)

  // 6. the blotter shows this trade, found by its own reference, confirmed
  await win.locator('.tbw-light-r').click()
  await app.getByPlaceholder(/Search/).fill(ref)
  const rows = app.locator('.bl-row')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(ref)
  await expect(rows.first()).toContainText('CONFIRMED')
  await app.unrouteAll({ behavior: 'ignoreErrors' })
  expectClean(problems)
})

// trade-window/booking.anchoring.test.js
// The 202 contract of POST /api/chain/confirm (backend chain/pending.py): the transaction is sent
// but not mined within the API's wait, confirmTradeOnChain resolves pending with the transaction
// and the still-PENDING trade, and reconcileAnchor is the poll. Run: npm test.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/session', () => ({ getSessionMaybe: async () => ({ access_token: 'jwt' }) }))

import { confirmTradeOnChain, reconcileAnchor } from './booking'

const reply = (status, body) => ({ ok: status < 400, status, json: async () => body })

beforeEach(() => { vi.restoreAllMocks(); globalThis.crypto ||= {}; globalThis.crypto.randomUUID ||= () => '00000000-0000-4000-8000-000000000000' })

describe('confirmTradeOnChain', () => {
  it('resolves pending with the transaction on 202 and keeps the trade PENDING', async () => {
    const fetch = vi.fn(async () => reply(202, {
      pending: true, tx_hash: '0xabc', explorer_tx: 'https://sepolia.etherscan.io/tx/0xabc', note: 'sent; waiting',
      submitted_at: '2026-11-03T10:00:00+00:00', trade: { id: 't1', status: 'PENDING' }, legs: [], event_id: null,
    }))
    vi.stubGlobal('fetch', fetch)
    const r = await confirmTradeOnChain('t1')
    expect(r).toEqual({ pending: true, tx_hash: '0xabc', explorer_tx: 'https://sepolia.etherscan.io/tx/0xabc', note: 'sent; waiting',
      submitted_at: '2026-11-03T10:00:00+00:00', trade: { id: 't1', status: 'PENDING' }, legs: [], eventId: null, idempotentReplay: false })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toMatch(/\/api\/chain\/confirm\/t1$/)
    expect(init.method).toBe('POST')
    expect(init.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('keeps the synchronous shape on 201', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(201, { trade: { id: 't1', status: 'CONFIRMED' }, legs: [{ id: 'l1' }], event_id: 'e1', idempotent_replay: false })))
    const r = await confirmTradeOnChain('t1')
    expect(r).toEqual({ pending: false, trade: { id: 't1', status: 'CONFIRMED' }, legs: [{ id: 'l1' }], eventId: 'e1', idempotentReplay: false })
  })

  it('throws the API detail with the status on an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(502, { detail: 'Chain anchoring failed. The detail is in the server log.' })))
    await expect(confirmTradeOnChain('t1')).rejects.toMatchObject({ message: /Chain anchoring failed/, status: 502 })
  })
})

describe('reconcileAnchor', () => {
  it('posts to the reconcile route and returns its body', async () => {
    const fetch = vi.fn(async () => reply(200, { pending: false, applied: true, status: 'CONFIRMED', trade: { id: 't1', status: 'CONFIRMED' } }))
    vi.stubGlobal('fetch', fetch)
    const r = await reconcileAnchor('t1')
    expect(r.applied).toBe(true)
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/chain\/reconcile\/t1$/)
    expect(fetch.mock.calls[0][1].method).toBe('POST')
  })
})

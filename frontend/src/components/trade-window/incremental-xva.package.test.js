// The netting-set charge of a package: every leg's body goes in `trades`; one trade, or a stored one, as before.
import { describe, it, expect } from 'vitest'
import { buildRequest } from './incremental-xva'

const A = { instrument_type: 'CRYPTO_FORWARD' }, B = { instrument_type: 'CRYPTO_OPTION' }

describe('incremental XVA request for a package', () => {
  it('sends every leg and no single trade', () => {
    const r = buildRequest({ counterpartyId: 'cp', tradeId: null, buildTrade: () => A, buildTrades: () => [A, B] })
    expect(r.trades).toEqual([A, B])
    expect(r.trade).toBe(null)
    expect(r.counterparty_id).toBe('cp')
  })
  it('is the one trade when there are no further legs, or a leg has no body yet', () => {
    expect(buildRequest({ counterpartyId: 'cp', buildTrade: () => A, buildTrades: () => [A] })).toMatchObject({ trade: A })
    expect(buildRequest({ counterpartyId: 'cp', buildTrade: () => A, buildTrades: () => [A] }).trades).toBeUndefined()
    expect(buildRequest({ counterpartyId: 'cp', buildTrade: () => A, buildTrades: () => [A, null] })).toMatchObject({ trade: A })
    expect(buildRequest({ counterpartyId: 'cp', buildTrade: () => A })).toMatchObject({ trade: A })
  })
  it('a stored trade is asked for by its id alone', () => {
    const r = buildRequest({ counterpartyId: 'cp', tradeId: 't1', buildTrade: () => A, buildTrades: () => [A, B] })
    expect(r).toMatchObject({ trade: null, trade_id: 't1' })
    expect(r.trades).toBeUndefined()
  })
})

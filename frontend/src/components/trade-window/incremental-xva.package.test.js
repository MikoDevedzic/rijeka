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

// Wrong-way risk: the line under the results says what the link did to CVA, and only when a link was run.
import { wrongWayLine, assumptionsAreDefault, HIDDEN_INPUT_DEFAULTS, CREDIT_LINKS } from './xva-shared'

describe('wrong-way risk on the XVA tab', () => {
  it('has a line only for a run with the counterparty linked', () => {
    expect(wrongWayLine(null)).toBe(null)
    expect(wrongWayLine({ xva: { cva: -100 }, wwr: null })).toBe(null)
    expect(wrongWayLine({ xva: { cva: -100 }, wwr: { cp_hazard_if_halves: 1, own_hazard_if_halves: 2, cva_independent: -100 } })).toBe(null)
    expect(wrongWayLine({ xva: { cva: -250 }, wwr: { cp_hazard_if_halves: 3, cva_independent: -100 } })).toEqual({ cva: -250, independent: -100, k: 3, wrong: true, change: -150 })
    expect(wrongWayLine({ xva: { cva: -40 }, wwr: { cp_hazard_if_halves: 3, cva_independent: -100 } }).wrong).toBe(false)
  })
  it('a link is one of the assumptions the simple view names as the desk\'s own', () => {
    const D = HIDDEN_INPUT_DEFAULTS
    expect(assumptionsAreDefault({ ...D })).toBe(true)
    expect(assumptionsAreDefault({ ...D, cpLink: '1', ownLink: '1' })).toBe(true)
    expect(assumptionsAreDefault({ ...D, cpLink: '3' })).toBe(false)
    expect(assumptionsAreDefault({ ...D, ownLink: '0.5' })).toBe(false)
    expect(CREDIT_LINKS[0][0]).toBe('1')
    expect(CREDIT_LINKS.every(([k]) => Number(k) >= 0.1 && Number(k) <= 20)).toBe(true)
  })
})

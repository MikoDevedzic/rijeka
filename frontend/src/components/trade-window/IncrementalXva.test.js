// trade-window/IncrementalXva.test.js
// The pure helpers behind the incremental-XVA block on the XVA tab
// (incremental-xva.js): the signed currency format, the result rows from a
// /api/xva/incremental response, the request body, and why the RUN button is
// disabled. Run: npm test.
import { describe, it, expect, vi } from 'vitest'

// The component imports the session helper, whose supabase client needs env
// vars at import time; the helpers under test never call it.
vi.mock('../../lib/session', () => ({ getSessionMaybe: async () => null }))

import { fmtSigned, buildRows, disabledReason, buildRequest, errorMessage, eePoints, mockResponse } from './incremental-xva'

const response = {
  counterparty: 'RIJEKA DEMO BANK AG', counterparty_id: 'cp-1', asof: '2026-11-02',
  csa: { preset: 'BILATERAL', collateralised: true, threshold_usd: 0, mta_usd: 0, mpor_days: 10, im_exchanged: true },
  measure: 'RISK_NEUTRAL', n_paths: 2000, months: 24, other_trades: 3,
  without: { cva: -1234.5, dva: 456.7, fva: -89.0, fba: 12.0, kva: -300.0, mva: -150.0, total: -1304.8 },
  with:    { cva: -1810.2, dva: 601.3, fva: -131.4, fba: 19.5, kva: -412.8, mva: -221.0, total: -1954.6 },
  incremental: { cva: -575.7, dva: 144.6, fva: -42.4, fba: 7.5, kva: -112.8, mva: -71.0, total: -649.8 },
  ee: { grid: ['2026-12-02', '2027-01-02'], without: [100, 200], with: [150, 260] },
  notes: ['common random numbers: both runs use the same paths'], seconds: 3.2,
}

describe('mockResponse', () => {
  it('has the route\'s shape: with − without = incremental, one EE grid for both lines', () => {
    const m = mockResponse({ counterpartyId: 'cp-1', counterpartyName: 'X', tradeId: null })
    for (const k of ['cva', 'dva', 'fva', 'fba', 'kva', 'mva', 'total']) expect(m.incremental[k]).toBeCloseTo(m.with[k] - m.without[k], 6)
    expect(m.ee.grid.length).toBe(m.months)
    expect(m.ee.without.length).toBe(m.ee.with.length)
  })
})

describe('fmtSigned', () => {
  it('signs, rounds and prefixes the currency symbol as the ticket does', () => {
    expect(fmtSigned(-1234.6)).toBe('−$1,235')
    expect(fmtSigned(456.7, 'USD')).toBe('+$457')
    expect(fmtSigned(0)).toBe('$0')
    expect(fmtSigned(-89, 'EUR')).toBe('−€89')
    expect(fmtSigned(12345.6, 'CHF')).toBe('+CHF 12,346')
  })
  it('shows a dash for nothing', () => {
    expect(fmtSigned(null)).toBe('—')
    expect(fmtSigned(undefined)).toBe('—')
    expect(fmtSigned('x')).toBe('—')
  })
})

describe('buildRows', () => {
  it('builds CVA…MVA and TOTAL with WITHOUT, WITH and INCREMENTAL from the response', () => {
    const rows = buildRows(response)
    expect(rows.map(r => r.label)).toEqual(['CVA', 'DVA', 'FVA', 'FBA', 'KVA', 'MVA', 'TOTAL'])
    expect(rows[0]).toEqual({ key: 'cva', label: 'CVA', without: -1234.5, with: -1810.2, incremental: -575.7, total: false })
    const total = rows[6]
    expect(total.total).toBe(true)
    expect(total.incremental).toBe(-649.8)
  })
  it('falls back to with − without when the server omits an incremental key, and to nothing when it cannot', () => {
    const rows = buildRows({ without: { cva: -100 }, with: { cva: -160 } })
    expect(rows[0].incremental).toBeCloseTo(-60)
    expect(rows[1]).toMatchObject({ key: 'dva', without: null, with: null, incremental: null })
    expect(buildRows(null)).toEqual([])
  })
})

describe('disabledReason', () => {
  const trade = () => ({ instrument_type: 'IR_SWAP' })
  it('wants a counterparty, then a price, then a buildable trade', () => {
    expect(disabledReason({ counterpartyId: null, priced: true, buildTrade: trade })).toBe('select a counterparty first')
    expect(disabledReason({ counterpartyId: 'cp-1', priced: false, buildTrade: trade })).toBe('price the trade first')
    expect(disabledReason({ counterpartyId: 'cp-1', priced: true, buildTrade: () => null })).toBe('price the trade first')
    expect(disabledReason({ counterpartyId: 'cp-1', priced: true, buildTrade: trade })).toBeNull()
  })
  it("shows the booking builder's own message when it throws (a blank swaption strike)", () => {
    const throwing = () => { throw new Error('Strike is blank (ATM): price the swaption first so the ATM forward is known.') }
    expect(disabledReason({ counterpartyId: 'cp-1', priced: true, buildTrade: throwing }))
      .toBe('Strike is blank (ATM): price the swaption first so the ATM forward is known.')
  })
  it('a stored trade needs no price and no body, only a counterparty', () => {
    expect(disabledReason({ counterpartyId: 'cp-1', priced: false, buildTrade: null, tradeId: 't-1' })).toBeNull()
    expect(disabledReason({ counterpartyId: null, priced: false, buildTrade: null, tradeId: 't-1' })).toBe('this trade has no counterparty')
  })
})

describe('buildRequest and errors', () => {
  it('sends the hypothetical trade for a new ticket and only the id for a stored one', () => {
    const body = { instrument_type: 'FX_FORWARD', notional: 1e7 }
    expect(buildRequest({ counterpartyId: 'cp-1', tradeId: null, buildTrade: () => body }))
      .toEqual({ counterparty_id: 'cp-1', trade: body, trade_id: null, n_paths: null })
    expect(buildRequest({ counterpartyId: 'cp-1', tradeId: 't-9', buildTrade: () => body }))
      .toEqual({ counterparty_id: 'cp-1', trade: null, trade_id: 't-9', n_paths: null })
  })
  it('reads the route\'s detail, and 429 as the rate limit', () => {
    expect(errorMessage(429, { detail: 'slow down' })).toBe('too many runs — wait a minute')
    expect(errorMessage(422, { detail: 'notional must be positive' })).toBe('notional must be positive')
    expect(errorMessage(500, {})).toBe('incremental xva 500')
  })
  it('scales both EE lines to one shared range', () => {
    expect(eePoints([0, 100], 0, 100, 1000, 100)).toBe('0.0,100.0 1000.0,0.0')
    expect(eePoints([], 0, 1)).toBe('')
  })
})

// trade-window/capital.test.js — the pure helpers behind the CAPITAL tab (capital.js). Run: npm test.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/session', () => ({ getSessionMaybe: async () => null }))

import { buildGrid, buildRequest, cellValue, derivation, fmtBp, fmtCell, mockResponse, quoteCells, regimeNames, typeKeys, METRIC_ROWS, PRESETS } from './capital'

const res = mockResponse()

describe('mockResponse', () => {
  it('has the route\'s shape: regimes × types × sets', () => {
    expect(regimeNames(res)).toEqual(PRESETS)
    expect(typeKeys(res)).toEqual(['CORPORATE·UNRATED', 'BANK·A', 'FUND·UNRATED'])
    for (const rg of PRESETS) for (const t of typeKeys(res)) expect(res.cells[rg][t].with.ead).toBeGreaterThanOrEqual(0)
  })
})

describe('buildGrid', () => {
  it('one row per metric plus the cost row, one cell per regime, for the chosen type and view', () => {
    const g = buildGrid(res, 'BANK·A', 'INCREMENTAL')
    expect(g.length).toBe(METRIC_ROWS.length + 1)
    expect(Object.keys(g[0].cells)).toEqual(PRESETS)
    const ead = g.find(r => r.key === 'ead')
    expect(ead.cells.PLUS_STABLECOIN).toBeGreaterThan(ead.cells.CASH_GOVT)
    expect(ead.cells.PLUS_TOKENISED_SOVEREIGN).toBeLessThan(ead.cells.CASH_GOVT)
    const rwa = g.find(r => r.key === 'rwa')
    expect(rwa.cells.CASH_GOVT).toBeCloseTo(ead.cells.CASH_GOVT * 0.3, 6)
  })
  it('the cost row is minus the sum of the four costs', () => {
    const c = res.cells.CASH_GOVT['CORPORATE·UNRATED'].with
    expect(cellValue(c, 'cost')).toBeCloseTo(-(c.cva + c.fva + c.kva + c.mva), 6)
    expect(cellValue(null, 'ead')).toBeNull()
  })
  it('standalone falls back to the set with the trade and an empty response gives no rows', () => {
    expect(buildGrid(res, 'BANK·A', 'STANDALONE').find(r => r.key === 'im').cells.CASH_GOVT).toBe(res.cells.CASH_GOVT['BANK·A'].standalone.im)
    expect(buildGrid(null, 'BANK·A')).toEqual([])
  })
})

describe('formats', () => {
  it('money and bp', () => {
    expect(fmtCell(1234.6, 'ead')).toBe('$1,235')
    expect(fmtCell(-500, 'kva')).toBe('−$500')
    expect(fmtCell(null, 'ead')).toBe('—')
    expect(fmtBp(3.26)).toBe('+3.3 bp')
    expect(fmtBp(-0.04)).toBe('−0.0 bp')
    expect(fmtBp(undefined)).toBe('—')
  })
})

describe('buildRequest', () => {
  it('a new trade travels as its booking body, a stored one by id; hurdle in decimals', () => {
    const b = buildRequest({ counterpartyId: 'cp', tradeId: null, buildTrade: () => ({ instrument_type: 'IR_SWAP' }), regimes: ['CASH_GOVT'],
      types: [{ type: 'BANK', rating: 'A' }], hurdle: '10', paths: 1000 })
    expect(b.trade.instrument_type).toBe('IR_SWAP')
    expect(b.trade_id).toBeNull()
    expect(b.hurdle).toBeCloseTo(0.10, 9)
    expect(b.counterparty_types[0]).toEqual({ type: 'BANK', rating: 'A', sector: null, rw_override: null, label: null })
    expect(b.n_paths).toBe(1000)
    const s = buildRequest({ counterpartyId: 'cp', tradeId: 't1', buildTrade: () => ({}), regimes: [], types: [], hurdle: 'x' })
    expect(s.trade).toBeNull()
    expect(s.trade_id).toBe('t1')
    expect(s.regimes).toBeNull()
    expect(s.hurdle).toBe(0.12)
  })
})

describe('derivation', () => {
  it('names the formula, the regime, the two CSAs and the counterparty inputs', () => {
    const lines = derivation(res, 'PLUS_STABLECOIN', 'BANK·A', 'ead')
    const heads = lines.map(l => l.h)
    expect(heads).toContain('FORMULA')
    expect(heads).toContain('ECONOMIC CSA')
    expect(heads).toContain('REGULATORY CSA')
    expect(heads).toContain('COUNTERPARTY')
    expect(lines.find(l => l.h === 'REGULATORY CSA').t).toMatch(/unmargined/)
    expect(derivation(null, 'X', 'Y', 'ead')).toEqual([])
  })
  it('quote cells follow the regimes', () => {
    expect(Object.keys(quoteCells(res, 'BANK·A'))).toEqual(PRESETS)
  })
})

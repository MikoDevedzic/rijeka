// pnl/ipv-page.test.js — the pure helpers behind P&L → IPV (ipv-page.js). Run: npm test.
import { describe, it, expect } from 'vitest'
import { counts, fmt, fmtShift, fmtSigned, fxGrid, inputRows, isBasis, pillarRows, sensLabel, sensValue, surfaceGrid, waterfall } from './ipv-page'

const run = {
  date: '2026-11-03', scope_key: 'GLOBAL', status: 'OPEN', flash_usd: 184320, first_order_usd: -21450, second_order_usd: null, xva_usd: -6180, official_usd: 156690, applied_at: null,
  inputs: [
    { curve_id: 'USD_SOFR', kind: 'RATES', unit: 'bp', trades: 612, state: 'OVERRIDDEN', sensitivity_total: -41250, desk_snapshot_date: '2026-11-03', has_independent: true, independent_source: 'UPLOAD · 2026-11-03',
      review: 1, overridden: 2, first_order: -19800, pillars: [
        { key: '5Y', tenor: '5Y', quote_type: '', desk: 3.77, independent: 3.78, gap: 1.0, sensitivity: -9800, tol: 1.0, material: true, override: 3.78, shift: 1.0, impact: -9800, status: 'OVERRIDDEN' },
        { key: '10Y', tenor: '10Y', quote_type: '', desk: 3.90, independent: 3.921, gap: 2.1, sensitivity: -11200, tol: 1.0, material: true, override: null, shift: null, impact: 0, status: 'REVIEW' },
      ] },
    { curve_id: 'USD_SWVOL_ATM', kind: 'SWAPTION_VOL', unit: 'vol_bp', trades: 88, state: 'PENDING', sensitivity_total: 8400, has_independent: false, pillars: [
        { key: '1Yx5Y', tenor: '1Yx5Y', quote_type: '', desk: 89.5, sensitivity: 1240, status: 'UNVERIFIED', material: true },
        { key: '5Yx10Y', tenor: '5Yx10Y', quote_type: '', desk: 78.4, sensitivity: 740, status: 'UNVERIFIED', material: true },
        { key: '1Yx10Y', tenor: '1Yx10Y', quote_type: '', desk: 82.0, sensitivity: 410, status: 'UNVERIFIED', material: true },
      ] },
    { curve_id: 'EURUSD_VOL', kind: 'FX_VOL', unit: 'vol_pt', trades: 41, state: 'VERIFIED', sensitivity_total: 3900, has_independent: true, independent_source: 'UPLOAD', pillars: [
        { key: '1Y|ATM', tenor: '1Y', quote_type: 'ATM', desk: 7.2, status: 'OK', sensitivity: 3000, material: true }, { key: '1Y|RR25', tenor: '1Y', quote_type: 'RR25', desk: -0.4, status: 'OK', sensitivity: 900, material: true },
        { key: '1M|ATM', tenor: '1M', quote_type: 'ATM', desk: 6.9, status: 'OK', sensitivity: 0, material: false },
      ] },
  ],
  unvalued: [{ trade_ref: 'X', reason: 'no curve' }],
}

describe('inputRows and counts', () => {
  it('one row per input with the counts the controller reads first', () => {
    const rows = inputRows(run)
    expect(rows.length).toBe(3)
    expect(rows[0]).toMatchObject({ curve_id: 'USD_SOFR', kindLabel: 'rate curve', state: 'OVERRIDDEN', review: 1, overridden: 2, impact: -19800 })
    expect(rows[0].sens).toBe('IR01 −$41,250/bp')
    expect(rows[1].independent).toBe('none · model IPV only')
    expect(counts(run)).toEqual({ inputs: 3, settled: 2, pending: 1, review: 1, overridden: 2, unvalued: 1 })
    expect(inputRows(null)).toEqual([])
  })
})

describe('the name of an input\'s sensitivity', () => {
  it('is the desk\'s: FX01 on a currency pair, CRY01 where a side is a digital asset, never spot01', () => {
    expect(sensLabel('SPOT', 'EURUSD_SPOT')).toBe('FX01')
    expect(sensLabel('SPOT', 'USDJPY_SPOT')).toBe('FX01')
    expect(sensLabel('SPOT', 'BTCUSD_SPOT')).toBe('CRY01')
    expect(sensLabel('SPOT', 'solusd_spot')).toBe('CRY01')
    expect(sensLabel('SPOT')).toBe('FX01')
    expect(sensLabel('RATES', 'USD_SOFR')).toBe('IR01')
    expect(sensLabel('FX_VOL', 'EURUSD_VOL')).toBe('vega')
    expect(inputRows({ inputs: [{ curve_id: 'BTCUSD_SPOT', kind: 'SPOT', unit: 'pct', sensitivity_total: 124564 }] })[0].sens).toBe('CRY01 +$124,564/%')
  })
})

describe('a digital asset\'s funding level: one name and one sign with the rest of the app', () => {
  it('is CRYBASIS01, never IR01; a currency\'s flat rate and a rate curve stay IR01', () => {
    expect(sensLabel('FUNDING', 'BTC_FUNDING')).toBe('CRYBASIS01')
    expect(sensLabel('FUNDING', 'eth_funding')).toBe('CRYBASIS01')
    expect(sensLabel('FUNDING', 'SOL_FUNDING')).toBe('CRYBASIS01')
    expect(sensLabel('FUNDING', 'EUR_FLAT')).toBe('IR01')                    // a currency's flat rate is a rate
    expect(sensLabel('FUNDING', 'EUR_FUNDING')).toBe('IR01')                 // and so is a currency's funding level
    expect(sensLabel('RATES', 'BTC_FUNDING')).toBe('IR01')                   // the kind decides, not the name alone
    expect(isBasis('FUNDING', 'BTC_FUNDING')).toBe(true); expect(isBasis('FUNDING')).toBe(false); expect(isBasis('SPOT', 'BTCUSD_SPOT')).toBe(false)
  })
  it('carries the desk\'s sign: the engine\'s figure for +1 bp of the level, turned', () => {
    expect(sensValue('FUNDING', 'BTC_FUNDING', -38.25)).toBe(38.25)
    expect(sensValue('FUNDING', 'BTC_FUNDING', 0)).toBe(0); expect(Object.is(sensValue('FUNDING', 'BTC_FUNDING', 0), -0)).toBe(false)
    expect(sensValue('FUNDING', 'BTC_FUNDING', null)).toBe(null)
    expect(sensValue('FUNDING', 'EUR_FLAT', -38.25)).toBe(-38.25)
    expect(sensValue('RATES', 'USD_SOFR', 12)).toBe(12)
  })
  it('on the inputs table and on each pillar, with the shift and the impact left as the level\'s own', () => {
    const run = { inputs: [{ curve_id: 'BTC_FUNDING', kind: 'FUNDING', unit: 'bp', trades: 2, state: 'REVIEW', sensitivity_total: -38.25, first_order: -382.5,
      pillars: [{ key: '1M', desk: 5.2, independent: 5.3, gap: 10, sensitivity: -38.25, shift: 10, impact: -382.5, status: 'REVIEW' }] }] }
    const row = inputRows(run)[0]
    expect(row.sens).toBe('CRYBASIS01 +$38/bp'); expect(row.sensitivity).toBe(38.25); expect(row.impact).toBe(-382.5)
    const p = pillarRows(run.inputs[0])[0]
    expect(p.sensitivity).toBe(38.25); expect(p.shift).toBe(10); expect(p.impact).toBe(-382.5)
    expect(p.impact).toBeCloseTo(-p.sensitivity * p.shift, 9)                // IMPACT = -CRYBASIS01 x SHIFT, as the page says
  })
})

describe('pillars and grids', () => {
  it('pillar rows keep the override and its impact', () => {
    const p = pillarRows(run.inputs[0])
    expect(p[0]).toMatchObject({ key: '5Y', override: 3.78, impact: -9800, status: 'OVERRIDDEN' })
    expect(p[1].status).toBe('REVIEW')
  })
  it('a swaption surface becomes expiry × tenor', () => {
    const g = surfaceGrid(run.inputs[1])
    expect(g.expiries).toEqual(['1Y', '5Y'])
    expect(g.tenors).toEqual(['5Y', '10Y'])
    expect(g.cell('1Y', '5Y').sensitivity).toBe(1240)
    expect(g.cell('5Y', '5Y')).toBeNull()
  })
  it('an FX surface becomes tenor × quote type', () => {
    const g = fxGrid(run.inputs[2])
    expect(g.tenors).toEqual(['1M', '1Y'])
    expect(g.types).toEqual(['ATM', 'RR25'])
    expect(g.cell('1Y', 'RR25').desk).toBe(-0.4)
  })
})

describe('waterfall and formats', () => {
  it('flash, one line per input with an impact, second order, XVA, official', () => {
    const w = waterfall(run)
    expect(w.map(x => x.key)).toEqual(['FLASH', 'IPV·USD_SOFR', 'SECOND', 'XVA', 'OFFICIAL'])
    expect(w[2].value).toBeNull()
    expect(w[4].value).toBe(156690)
    expect(waterfall(null)).toEqual([])
    expect(fmt(1234.4)).toBe('$1,234')
    expect(fmtSigned(-19800)).toBe('−$19,800')
    expect(fmtShift(2.06, 'bp')).toBe('+2.1 bp')
    expect(fmtShift(-0.3, 'vol_pt')).toBe('-0.3 pt')
  })
})

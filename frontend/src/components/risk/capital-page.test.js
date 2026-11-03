// risk/capital-page.test.js — the pure helpers behind Risk → CAPITAL (capital-page.js). Run: npm test.
import { describe, it, expect } from 'vitest'
import { COLUMNS, METRICS, bars, fmt, fmtBp, fmtPct, fmtSigned, tableRows, totalsRow, waterfall } from './capital-page'

const m = (ead, extra = {}) => ({ im: 100, ead, rwa: ead * 0.3, k_ccr: ead * 0.024, k_cva: 5, kva: -10, cva: -20, fva: -3, mva: -2, cost: 35, leverage: ead * 1.4, hqla_im: 100, ...extra })
const steps = [
  { key: 'BASELINE', delta: {} },
  { key: 'THRESHOLD_MTA', state: 'CURRENT', delta: { ead: -200, cost: -5 }, source: 'CRE52.18' },
  { key: 'MARGIN_FREQUENCY', state: 'CURRENT', delta: { ead: -50, cost: -1 } },
  { key: 'DISPUTES', state: 'CURRENT', delta: { ead: 0, cost: 0 } },
  { key: 'COLLATERAL', state: 'CURRENT', delta: { ead: 0, cost: 0 } },
  { key: 'IM_ELIGIBILITY', state: 'CURRENT', delta: { ead: 0, cost: -1 } },
  { key: 'MPOR_RELIEF', state: 'FORWARD', delta: { ead: -300, cost: -4 } },
  { key: 'TOKENISED_IM', state: 'FORWARD', delta: { ead: 0, cost: -2 } },
  { key: 'HQLA_L1', state: 'FORWARD', delta: { ead: 0, cost: 0 } },
]
const rep = {
  columns: COLUMNS, totals: { BASELINE: m(2000), ON_CHAIN_CURRENT: m(1750), ON_CHAIN_FORWARD: m(1450) },
  quote: { BASELINE: { running_bp: 0, upfront_bp: 0 }, ON_CHAIN_CURRENT: { running_bp: 1.2, upfront_bp: 4.1 }, ON_CHAIN_FORWARD: { running_bp: 2.0, upfront_bp: 7.0 } },
  counterparties: [
    { counterparty_id: 'a', counterparty: 'A', trades: 3, simulated: 3, columns: { BASELINE: m(1000), ON_CHAIN_CURRENT: m(750), ON_CHAIN_FORWARD: m(450) }, steps, quote: {}, record: {}, inputs: {} },
    { counterparty_id: 'b', counterparty: 'B', trades: 1, empty: true, skipped: [{ trade_ref: 'X', reason: 'not simulated' }] },
  ],
}

describe('tableRows and totalsRow', () => {
  it('one row per counterparty with the three columns and the change from the baseline', () => {
    const rows = tableRows(rep, 'ead')
    expect(rows.length).toBe(2)
    expect(rows[0].values).toEqual({ BASELINE: 1000, ON_CHAIN_CURRENT: 750, ON_CHAIN_FORWARD: 450 })
    expect(rows[0].change.ON_CHAIN_FORWARD).toBe(-550)
    expect(rows[1].empty).toBe(true)
    expect(rows[1].note).toMatch(/not simulated/)
    const t = totalsRow(rep, 'rwa')
    expect(t.values.BASELINE).toBeCloseTo(600, 6)
    expect(t.change.ON_CHAIN_CURRENT).toBeCloseTo(-75, 6)
    expect(tableRows(null, 'ead')).toEqual([])
    expect(METRICS.map(x => x[1])).toContain('cost')
  })
})

describe('waterfall and bars', () => {
  it('baseline, one delta per step, the two column levels; the deltas run from the previous level', () => {
    const w = waterfall(steps, rep.counterparties[0].columns, 'ead')
    expect(w[0]).toMatchObject({ kind: 'level', value: 1000 })
    expect(w[1]).toMatchObject({ key: 'THRESHOLD_MTA', kind: 'delta', from: 1000, to: 800 })
    const cur = w.find(x => x.key === 'ON_CHAIN_CURRENT')
    expect(cur.value).toBe(750)
    expect(w[w.length - 1]).toMatchObject({ key: 'ON_CHAIN_FORWARD', value: 450 })
    const b = bars(w, 1000, 160)
    expect(b.length).toBe(w.length)
    expect(b.every(x => x.h >= 1 && x.w > 0)).toBe(true)
    expect(b[0].y).toBeLessThan(b[0].zero)                     // a positive level rises above zero
    expect(waterfall(null, null, 'ead')).toEqual([])
  })
})

describe('formats', () => {
  it('money, signed, bp, percent', () => {
    expect(fmt(1234.4)).toBe('$1,234')
    expect(fmt(-5)).toBe('$5 (−)')
    expect(fmtSigned(-5)).toBe('−$5')
    expect(fmtBp(1.26)).toBe('+1.3 bp')
    expect(fmtPct(750, 1000)).toBe('-25 %')
    expect(fmtPct(1, 0)).toBe('—')
  })
})

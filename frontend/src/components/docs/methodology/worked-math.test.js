import { describe, expect, it } from 'vitest'
import { cvaLine, ndf, readNumber } from './worked-math'
import { healthCells, whenSaid, JOINS, PIECES, STEPS } from './architecture-data'

describe('the worked tables', () => {
  it('reads a number as typed, and nothing else', () => {
    expect(readNumber('100,000.00')).toBe(100000)
    expect(readNumber(' 4.00% ')).toBe(4)
    expect(readNumber('-3')).toBe(-3)
    for (const bad of ['', 'abc', '1,5', '1.2.3', '10 000', '1e5', null]) expect(readNumber(bad)).toBeNull()
  })
  it('the digital-asset forward of §12: F = S·exp((r_USD − r_c)·T), NPV = (F − K)·N·P', () => {
    const r = ndf({ S: 100000, rq: 4, rc: 3, days: 91, N: 10, K: 100300 })
    const T = 91 / 365
    expect(r.T).toBeCloseTo(T, 12)
    expect(r.F).toBeCloseTo(100000 * Math.exp(0.01 * T), 8)                 // 100,249.63
    expect(r.F).toBeCloseTo(100249.63, 2)
    expect(r.npv).toBeCloseTo((r.F - 100300) * 10 * Math.exp(-0.04 * T), 8)
    expect(Math.round(r.npv)).toBe(-499)
    expect(Math.round(r.cry01)).toBe(9925)
    // struck at the fair forward it is worth nothing
    expect(ndf({ S: 100000, rq: 4, rc: 3, days: 91, N: 10, K: r.F }).npv).toBeCloseTo(0, 8)
    for (const bad of [{ S: 0 }, { days: 0 }, { N: -1 }, { K: null }, { rq: NaN }]) expect(ndf({ S: 100000, rq: 4, rc: 3, days: 91, N: 10, K: 100300, ...bad })).toBeNull()
  })
  it('the first line of the waterfall with a flat exposure: LGD·Σ EE·ΔQ·D', () => {
    const r = cvaLine({ ee: 250000, s: 150, lgd: 60, yrs: 2, r: 4 })
    expect(r.h).toBeCloseTo(0.025, 12)                                       // 150 bp over 60 %
    expect(r.pd).toBeCloseTo(1 - Math.exp(-0.05), 12)
    // with no discounting the sum telescopes: LGD · EE · (1 − Q(T))
    expect(cvaLine({ ee: 250000, s: 150, lgd: 60, yrs: 2, r: 0 }).cva).toBeCloseTo(0.6 * 250000 * (1 - Math.exp(-0.05)), 6)
    expect(r.cva).toBeLessThan(0.6 * 250000 * (1 - Math.exp(-0.05)))
    expect(r.cva).toBeGreaterThan(0.6 * 250000 * (1 - Math.exp(-0.05)) * Math.exp(-0.08))
    for (const bad of [{ lgd: 101 }, { yrs: 31 }, { s: 0 }, { ee: null }]) expect(cvaLine({ ee: 250000, s: 150, lgd: 60, yrs: 2, r: 4, ...bad })).toBeNull()
  })
})

describe('how the system is built', () => {
  it('every step names pieces and joins that exist, and every join joins two pieces', () => {
    const pieces = new Set(PIECES.map(p => p.id)), joins = new Set(JOINS.map(j => j.id))
    for (const j of JOINS) { expect(pieces.has(j.a)).toBe(true); expect(pieces.has(j.b)).toBe(true) }
    for (const s of STEPS) { for (const p of s.pieces) expect(pieces.has(p), `${s.name}: ${p}`).toBe(true); for (const j of s.joins) expect(joins.has(j), `${s.name}: ${j}`).toBe(true) }
    expect(STEPS.map(s => s.k)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
  })
  it('says when a batch last ran in the health answer\'s own terms', () => {
    expect(whenSaid('2026-11-10T23:50:22.737093+00:00')).toBe('23:50 UTC')
    expect(whenSaid('2026-11-10')).toBe('10 Nov')
    expect(whenSaid(null)).toBe('—')
    expect(whenSaid('soon')).toBe('soon')
  })
  it('the strip is the health answer and nothing else: no answer, no cells', () => {
    expect(healthCells(null)).toEqual([])
    const cells = healthCells({ version: '0.19.1', commit: '663fc01491fc', migrations: { approved: 4, applied: 4, pending: 0, problems: 0 }, client_errors: { last_24h: 0 },
      checks: { news: { ok: true, last: '2026-11-10T23:50:22+00:00' }, pnl: { ok: false, last: '2026-11-07' } } })
    expect(cells.map(c => [c.label, c.value, c.state])).toEqual([
      ['VERSION', '0.19.1', null], ['COMMIT', '663fc01', null], ['MIGRATIONS', '4 of 4 applied', 'ok'], ['BROWSER ERRORS, 24H', '0', null],
      ['NEWS', '23:50 UTC', 'ok'], ['P&L', '7 Nov', 'stale'],
    ])
    expect(healthCells({ migrations: { approved: 5, applied: 4, pending: 1, problems: 0 } })[2]).toMatchObject({ value: '4 of 5 applied', state: 'stale' })
  })
})

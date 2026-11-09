// The arithmetic of the CURVE SCENARIO tab (fx-scenario.js). Every expected figure here is worked by hand from
// the rule in the comment beside it; the data is made up for the test.
import { describe, it, expect } from 'vitest'
import {
  TENOR_DAYS, SPOT_BOUND_PCT, FORWARD_FLOOR, interpPoints, daysBetween, spotLagDays, carryPoints, curveNodes,
  rippleWeights, tenorBounds, applyTenorDrag, clampSpotPct, spotPctFromDrag, shockedCurve, reprice, gk,
  settlementAmount, latestFixing, fixingSeries, valueRange, horizonDays, chartGeometry,
} from './fx-scenario'

describe('interpPoints: the backend rule (currencies.py interp_points)', () => {
  it('uses the backend tenor days', () => {
    expect(TENOR_DAYS).toEqual({ ON: 1, '1W': 7, '2W': 14, '1M': 30, '2M': 61, '3M': 91, '6M': 182, '9M': 273, '1Y': 365, '2Y': 730 })
  })
  const pts = { '1W': 14, '1M': 60, '3M': 182 }
  it.each([
    [-3, 0],          // before spot
    [0, 0],           // at spot
    [3, 6],           // 0 → 14 over 7 days: 14·3/7
    [7, 14],          // on a tenor
    [14, 28],         // 14 + (60 − 14)·(14 − 7)/(30 − 7) = 14 + 46·7/23
    [30, 60],
    [61, 122],        // 60 + (182 − 60)·(61 − 30)/(91 − 30) = 60 + 122·31/61
    [91, 182],
    [400, 182],       // flat beyond the last tenor
  ])('%i days → %f points', (days, want) => { expect(interpPoints(pts, days)).toBeCloseTo(want, 10) })
  it('one tenor: a line from spot, then flat', () => {
    expect(interpPoints({ '1M': 30 }, 15)).toBeCloseTo(15, 10)
    expect(interpPoints({ '1M': 30 }, 45)).toBe(30)
  })
  it('negative points', () => {
    expect(interpPoints({ '1M': -30, '2M': -61 }, 46)).toBeCloseTo(-46, 10)     // −30 + (−31)·16/31
  })
  it('no points: zero; an unknown tenor is not a point', () => {
    expect(interpPoints({}, 30)).toBe(0)
    expect(interpPoints(null, 30)).toBe(0)
    expect(interpPoints({ '1M': 30, '5Y': 999 }, 400)).toBe(30)
  })
  it('the order of the keys does not matter', () => {
    expect(interpPoints({ '3M': 182, '1W': 14, '1M': 60 }, 14)).toBeCloseTo(28, 10)
  })
})

describe('dates and the spot lag', () => {
  it('whole days between two ISO dates', () => {
    expect(daysBetween('2026-11-09', '2026-12-09')).toBe(30)
    expect(daysBetween('2026-11-09', '2026-10-10')).toBe(-30)
    expect(daysBetween('2026-11-09', null)).toBe(null)
  })
  it('a digital asset has no lag', () => {
    expect(spotLagDays({ points: { '1M': 30 }, settleDays: 20, marketPoints: 18, crypto: true })).toBe(0)
  })
  it('a pair: the lag at which the stored points give the quote back', () => {
    const points = { '1M': 30, '2M': 61 }                    // one point a day
    expect(spotLagDays({ points, settleDays: 47, marketPoints: 45, crypto: false })).toBe(2)
    expect(spotLagDays({ points, settleDays: 47, marketPoints: 46, crypto: false })).toBe(1)
  })
  it('two days when nothing tells the lags apart', () => {
    expect(spotLagDays({ points: { '1M': 0, '2M': 0 }, settleDays: 47, marketPoints: 0, crypto: false })).toBe(2)
    expect(spotLagDays({ points: null, settleDays: 47, marketPoints: null, crypto: false })).toBe(2)
  })
})

describe('the curve without quoted points', () => {
  it('carries spot to the forward at the same rate at every tenor', () => {
    const p = carryPoints({ spot: 100, forward: 110, days: 30, pip: 1 })
    expect(p['1M']).toBeCloseTo(10, 10)                               // the 30-day tenor is the forward itself
    expect(p['2M']).toBeCloseTo(100 * (Math.pow(1.1, 61 / 30) - 1), 10)
    expect(Object.keys(p)).toEqual(Object.keys(TENOR_DAYS))
  })
  it('is flat when the trade settles at spot', () => {
    expect(carryPoints({ spot: 100, forward: 100, days: 0, pip: 1 })['1Y']).toBe(0)
  })
  it('curveNodes orders the tenors and draws them from the spot date', () => {
    expect(curveNodes({ '1M': 5, '1W': 1 }, 2)).toEqual([
      { tenor: '1W', days: 7, x: 9, points: 1 }, { tenor: '1M', days: 30, x: 32, points: 5 },
    ])
  })
})

describe('the ripple', () => {
  const nodes = curveNodes({ '1W': 0, '1M': 0, '3M': 0, '1Y': 0 })
  const w = rippleWeights(nodes, 1)
  it('moves the dragged tenor in full and its neighbours by less, fading with distance', () => {
    expect(w[1]).toBe(1)
    // 1W: (√(30/365) − √(7/365))² = (0.28669 − 0.13848)² = 0.021965; exp(−0.021965 / 0.045) = 0.614
    expect(w[0]).toBeCloseTo(0.614, 3)
    // 3M: (√(91/365) − 0.28669)² = (0.49932 − 0.28669)² = 0.045210; exp(−0.045210 / 0.045) = 0.366
    expect(w[2]).toBeCloseTo(0.366, 3)
    expect(w[3]).toBeLessThan(0.001)                                 // a year away: untouched
    expect(w[0]).toBeGreaterThan(w[2])
  })
  it('a wider sigma carries further', () => {
    expect(rippleWeights(nodes, 1, 0.5)[3]).toBeGreaterThan(w[3])
  })
})

describe('the bounds', () => {
  const nodes = curveNodes({ '1M': 2, '3M': -70 })                    // forwards 102 and 30 on a spot of 100
  const bounds = tenorBounds(nodes, { spot: 100, pip: 1 })
  it('a tenor moves at most half of spot, and never to a forward under 1 % of spot', () => {
    expect(bounds[0]).toEqual({ lo: -50, hi: 50 })
    expect(bounds[1]).toEqual({ lo: -29, hi: 50 })                    // 30 − 29 = 1 = 1 % of 100
  })
  it('in pips for a currency pair', () => {
    const b = tenorBounds(curveNodes({ '1M': 20 }), { spot: 1.1, pip: 1e-4 })[0]
    expect(b.hi).toBeCloseTo(5500, 6)
    expect(b.lo).toBeCloseTo(-5500, 6)
  })
  it('a drag stops at the bound and its ripple stops with it', () => {
    const out = applyTenorDrag({ origin: [0, 0], weights: [1, 0.5], move: -80, bounds })
    expect(out).toEqual([-50, -29])
    expect(applyTenorDrag({ origin: [10, -5], weights: [1, 0.5], move: 20, bounds })).toEqual([30, 5])
  })
  it('every forward the bounds allow is positive, at the lowest spot shock too', () => {
    const moves = applyTenorDrag({ origin: [0, 0], weights: [1, 1], move: -1e9, bounds })
    const curve = shockedCurve({ spot: 100, pip: 1, nodes, moves, spotPct: -SPOT_BOUND_PCT, quoteBp: -200, baseBp: 200 })
    curve.forEach(c => expect(c.shocked).toBeGreaterThan(0))
  })
  it('the spot shock is held to its range', () => {
    expect(clampSpotPct(73)).toBe(50)
    expect(clampSpotPct(-73)).toBe(-50)
    expect(clampSpotPct(NaN)).toBe(0)
    expect(spotPctFromDrag({ originPct: 0, dPrice: 5, ref: 100 })).toBe(5)       // 5 on a spot of 100
    expect(spotPctFromDrag({ originPct: 2, dPrice: -1, ref: 50 })).toBe(0)
    expect(spotPctFromDrag({ originPct: 40, dPrice: 30, ref: 100 })).toBe(50)
  })
})

describe('the shocked curve', () => {
  const nodes = curveNodes({ '1M': 2, '1Y': 10 })
  it('is the base curve when nothing is moved', () => {
    const c = shockedCurve({ spot: 100, pip: 1, nodes, moves: [0, 0] })
    expect(c.map(p => [p.tenor, p.x, p.base, p.shocked])).toEqual([['SPOT', 0, 100, 100], ['1M', 30, 102, 102], ['1Y', 365, 110, 110]])
  })
  it('a spot shock scales every point; a tenor move adds its points first', () => {
    const c = shockedCurve({ spot: 100, pip: 1, nodes, moves: [3, 0], spotPct: 10 })
    expect(c[0].shocked).toBeCloseTo(110, 10)
    expect(c[1].shocked).toBeCloseTo(115.5, 10)                       // (100 + 2 + 3)·1.1
    expect(c[2].shocked).toBeCloseTo(121, 10)
    expect(c[1].base).toBe(102)
  })
  it('the rate shocks tilt it: exp((Δquote − Δbase)·T)', () => {
    const c = shockedCurve({ spot: 100, pip: 1, nodes, moves: [0, 0], quoteBp: 100, baseBp: 0 })
    expect(c[0].shocked).toBe(100)
    expect(c[2].shocked).toBeCloseTo(110 * Math.exp(0.01), 10)        // one year at +100bp
  })
})

describe('reprice: the closed form', () => {
  const fwd = { shape: 'NDF', direction: 'BUY', base_notional: 10, spot: 100, forward: 102, forward_rate: 101,
                df_quote: 0.98, df_base: 1, t: 0.5, forward_mode: 'MARKET', market_points: 2 }
  it('no shock: the quote itself', () => {
    const r = reprice(fwd)
    expect(r.forward).toBeCloseTo(102, 10)
    expect(r.npv).toBeCloseTo(9.8, 10)                                // 10·(102 − 101)·0.98
  })
  it('dragged points move the forward and the NPV: ±N·(F − K)·DF', () => {
    const r = reprice(fwd, { dPoints: 3, pip: 1 })
    expect(r.forward).toBeCloseTo(105, 10)
    expect(r.npv).toBeCloseTo(39.2, 10)                               // 10·(105 − 101)·0.98
    expect(reprice({ ...fwd, direction: 'SELL' }, { dPoints: 3, pip: 1 }).npv).toBeCloseTo(-39.2, 10)
  })
  it('the spot shock scales the dragged forward with the rest', () => {
    expect(reprice(fwd, { spotPct: 10, dPoints: 3, pip: 1 }).forward).toBeCloseTo(115.5, 10)   // (102 + 3)·1.1
  })
  it('agrees with the chart: the shocked curve at the settlement tenor is the repriced forward', () => {
    const q = { ...fwd, t: 30 / 365 }
    const nodes = curveNodes({ '1M': 2, '3M': 6 })
    const moves = [3, 1]
    const shocks = { spotPct: -7.5, quoteBp: 50, baseBp: -25 }
    const curve = shockedCurve({ spot: 100, pip: 1, nodes, moves, ...shocks })
    const r = reprice(q, { ...shocks, dPoints: interpPoints({ '1M': 3, '3M': 1 }, 30), pip: 1 })
    expect(r.forward).toBeCloseTo(curve[1].shocked, 9)
  })
  it('pips: one point is one pip of price', () => {
    const q = { ...fwd, spot: 1.1, forward: 1.102, forward_rate: 1.1, market_points: 20 }
    expect(reprice(q, { dPoints: 10, pip: 1e-4 }).forward).toBeCloseTo(1.103, 10)
  })
  it('parity mode and the rate shocks are as the panel always priced them', () => {
    const q = { ...fwd, forward_mode: 'IMPLIED', market_points: null, forward: 100 / 0.98 }
    const r = reprice(q, { quoteBp: 100, baseBp: 0 })
    const dfq = 0.98 * Math.exp(-0.005)
    expect(r.forward).toBeCloseTo(100 / dfq, 10)                      // S·DF_base'/DF_quote'
    expect(r.npv).toBeCloseTo(10 * (100 / dfq - 101) * dfq, 10)
  })
  it('never a forward at or below zero', () => {
    const r = reprice(fwd, { dPoints: -1000, pip: 1 })
    expect(r.forward).toBeCloseTo(FORWARD_FLOOR * 100, 10)
    expect(r.forward).toBeGreaterThan(0)
  })
  it('a European option: Black-76 on the moved forward', () => {
    const opt = { shape: 'OPTION', direction: 'BUY', option_type: 'CALL', base_notional: 2, spot: 100, forward: 100, strike: 100,
                  df_quote: 1, t_settle: 1, t_expiry: 1, vol_pct: 20 }
    const base = reprice(opt)
    // at the money, σ√T = 0.2: F·(Φ(0.1) − Φ(−0.1)) = 100·0.079656 = 7.9656 a unit
    expect(base.npv / 2).toBeCloseTo(7.9656, 3)
    const up = reprice(opt, { dPoints: 5, pip: 1 })
    expect(up.forward).toBeCloseTo(105, 10)
    expect(up.npv).toBeCloseTo(2 * gk(105, 100, 1, 0.2, true, 1), 10)
    expect(up.npv).toBeGreaterThan(base.npv)
    expect(reprice({ ...opt, option_type: 'PUT' }, { dPoints: 5, pip: 1 }).npv).toBeLessThan(base.npv)
    expect(reprice(opt, { volPts: 1 }).npv).toBeGreaterThan(base.npv)
  })
})

describe('the settlement amount', () => {
  const f = { shape: 'NDF', notional: 2, strike: 74000 }
  it('forward: ±N·(fixing − K)', () => {
    expect(settlementAmount({ ...f, direction: 'BUY', fixing: 75000 })).toBe(2000)
    expect(settlementAmount({ ...f, direction: 'SELL', fixing: 75000 })).toBe(-2000)
    expect(settlementAmount({ ...f, direction: 'BUY', fixing: 73500 })).toBe(-1000)
  })
  it('European call and put: the payoff, from the side of the trade', () => {
    const o = { shape: 'OPTION', notional: 2, strike: 74000 }
    expect(settlementAmount({ ...o, optionType: 'CALL', direction: 'BUY', fixing: 75000 })).toBe(2000)
    expect(settlementAmount({ ...o, optionType: 'CALL', direction: 'BUY', fixing: 73000 })).toBe(0)
    expect(settlementAmount({ ...o, optionType: 'PUT', direction: 'BUY', fixing: 73000 })).toBe(2000)
    expect(settlementAmount({ ...o, optionType: 'PUT', direction: 'SELL', fixing: 73000 })).toBe(-2000)
    expect(Object.is(settlementAmount({ ...o, optionType: 'PUT', direction: 'SELL', fixing: 75000 }), 0)).toBe(true)   // not -0
  })
  it('no amount without a positive fixing', () => {
    expect(settlementAmount({ ...f, direction: 'BUY', fixing: NaN })).toBe(null)
    expect(settlementAmount({ ...f, direction: 'BUY', fixing: 0 })).toBe(null)
    expect(settlementAmount({ ...f, direction: 'BUY', fixing: -5 })).toBe(null)
  })
})

describe('fixings', () => {
  const A = 'Source A reference rate', B = 'Source B delivery price'
  const rows = [
    { date: '2026-11-05', source: B, value: 101, origin: 'FEED', own: false },
    { date: '2026-11-06', source: B, value: 102, origin: 'FEED', own: false },
    { date: '2026-11-06', source: A, value: 102.5, origin: 'MANUAL', own: true },
    { date: '2026-11-07', source: B, value: 103, origin: 'FEED', own: false },
  ]
  it('the latest fixing is of exactly the named source', () => {
    expect(latestFixing(rows, A)).toMatchObject({ date: '2026-11-06', value: 102.5 })
    expect(latestFixing(rows, B)).toMatchObject({ date: '2026-11-07', value: 103 })
    expect(latestFixing(rows, 'Some other source')).toBe(null)
    expect(latestFixing(rows, null)).toBe(null)
  })
  it('a stored spot is not a fixing', () => {
    const spot = [{ date: '2026-11-07', source: 'stored spot (no fixing stored)', value: 99, origin: 'SPOT', time: null }]
    expect(latestFixing(spot, 'stored spot (no fixing stored)')).toBe(null)
    expect(fixingSeries(spot, A)).toEqual({ label: 'stored spot', spot: true, ownSource: false, rows: [{ date: '2026-11-07', value: 99 }] })
  })
  it('on one date the desk\'s own entry stands before the shared one', () => {
    const two = [{ date: '2026-11-06', source: A, value: 1, origin: 'FEED', own: false }, { date: '2026-11-06', source: A, value: 2, origin: 'MANUAL', own: true }]
    expect(latestFixing(two, A).value).toBe(2)
    expect(latestFixing([...two].reverse(), A).value).toBe(2)
    expect(fixingSeries([...two].reverse(), A).rows).toEqual([{ date: '2026-11-06', value: 2 }])
  })
  it('the chart draws the trade\'s source when it has fixings, otherwise the source with the most', () => {
    expect(fixingSeries(rows, A)).toEqual({ label: A, spot: false, ownSource: true, rows: [{ date: '2026-11-06', value: 102.5 }] })
    const other = fixingSeries(rows, 'Some other source')
    expect(other.label).toBe(B)
    expect(other.ownSource).toBe(false)
    expect(other.rows.map(r => r.value)).toEqual([101, 102, 103])
  })
  it('nothing usable: no series', () => {
    expect(fixingSeries([], A)).toBe(null)
    expect(fixingSeries([{ date: '2026-11-06', source: A, value: null, origin: 'FEED' }], A)).toBe(null)
    expect(fixingSeries(undefined, A)).toBe(null)
  })
})

describe('the chart scales', () => {
  it('the value axis holds every number on round gridlines', () => {
    const r = valueRange([98, 100, 104, NaN, undefined])
    expect(r.vMin).toBeLessThanOrEqual(98)
    expect(r.vMax).toBeGreaterThanOrEqual(104)
    expect(Math.abs(r.vMin / r.step - Math.round(r.vMin / r.step))).toBeLessThan(1e-9)
    const flat = valueRange([100, 100])
    expect(flat.vMax).toBeGreaterThan(flat.vMin)
  })
  it('the horizon is the first tenor comfortably past settlement', () => {
    const curve = [0, 1, 7, 14, 30, 61, 91, 182, 365, 730].map(x => ({ x }))
    expect(horizonDays(curve, 30)).toBe(61)            // 60 days at least
    expect(horizonDays(curve, 91)).toBe(182)           // 91·1.3 = 118.3
    expect(horizonDays(curve, 1000)).toBe(1050)        // past the last tenor: the settlement date still fits
    expect(horizonDays([], 0)).toBe(1)
  })
  it('today, the tenors and a price land where the journeys expect them', () => {
    const g = chartGeometry({ width: 870, height: 260, hasLeft: true, maxDays: 91, vMin: 90, vMax: 110 })
    expect(g.pxPerUnit).toBeCloseTo(10.5, 10)          // (260 − 24 − 26) / 20
    expect(g.xs(0)).toBeCloseTo(257.68, 6)             // 70 + 0.24·(870 − 88)
    expect(g.xs(-30)).toBeCloseTo(70, 6)
    expect(g.xs(-15)).toBeCloseTo(70 + 187.68 / 2, 6)
    expect(g.xs(91)).toBeCloseTo(852, 6)
    expect(g.xs(91 / 4)).toBeCloseTo(257.68 + (852 - 257.68) / 2, 6)   // square-root axis: a quarter of the time is half of the way
    expect(g.ys(100)).toBeCloseTo(129, 6)
    expect(g.ys(101) - g.ys(100)).toBeCloseTo(-g.pxPerUnit, 10)
  })
  it('without fixings today sits near the left edge', () => {
    const g = chartGeometry({ width: 870, height: 260, hasLeft: false, maxDays: 91, vMin: 90, vMax: 110 })
    expect(g.xs(0)).toBeCloseTo(70 + 0.05 * 782, 6)
  })
})

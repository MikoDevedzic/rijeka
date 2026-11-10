// The arithmetic of the CURVE SCENARIO tab (fx-scenario.js). Every expected figure here is worked by hand from
// the rule in the comment beside it; the data is made up for the test.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  TENOR_DAYS, SPOT_BOUND_PCT, FORWARD_FLOOR, interpPoints, daysBetween, spotLagDays, carryPoints, curveNodes,
  rippleWeights, tenorBounds, applyTenorDrag, clampSpotPct, spotPctFromDrag, carryFactor, shockedCurve, reprice, gk,
  settlementAmount, latestFixing, fixingSeries, fixingTime, settledState, settledFacts, styleTerms, provisionalReasons, chartLevels, chartStrike,
  tenorMap, niceStep, valueRange, horizonDays, chartGeometry,
  isoDate, addDays, axisDates, roundTo, signedChange, strikeAsBooked, modelWords,
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
  it('an empty curve is zero points, as the backend has it; an unknown tenor is not a point', () => {
    expect(interpPoints({}, 30)).toBe(0)
    expect(interpPoints({ '1M': 30, '5Y': 999 }, 400)).toBe(30)
  })
  it('a missing curve, a missing day count or a tenor without a number: null, not zero', () => {
    expect(interpPoints(null, 30)).toBe(null)
    expect(interpPoints(undefined, 30)).toBe(null)
    expect(interpPoints({ '1M': 30 }, NaN)).toBe(null)
    expect(interpPoints({ '1M': 30 }, null)).toBe(null)
    expect(interpPoints({ '1M': 30, '3M': null }, 45)).toBe(null)
    expect(interpPoints({ '1M': 30, '3M': 'abc' }, 45)).toBe(null)
  })
  it('reads the tenor map it is given (the API\'s tenor_days)', () => {
    expect(interpPoints({ '1M': 30 }, 16, { '1M': 32 })).toBeCloseTo(15, 10)        // 30·16/32
    expect(interpPoints({ '1M': 30 }, 16)).toBeCloseTo(16, 10)                      // 30·16/30 on this module's copy
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
  it('null, not a guessed lag, when nothing tells the lags apart or an input is missing', () => {
    expect(spotLagDays({ points: { '1M': 0, '2M': 0 }, settleDays: 47, marketPoints: 0, crypto: false })).toBe(null)
    expect(spotLagDays({ points: null, settleDays: 47, marketPoints: 45, crypto: false })).toBe(null)
    expect(spotLagDays({ points: { '1M': 30 }, settleDays: 47, marketPoints: null, crypto: false })).toBe(null)
    expect(spotLagDays({ points: { '1M': 30 }, settleDays: null, marketPoints: 45, crypto: false })).toBe(null)
    expect(spotLagDays()).toBe(null)
  })
  it('the engine\'s own lag, when its answer names it, stands before anything read back from the points', () => {
    const points = { '1M': 30, '2M': 61 }
    expect(spotLagDays({ points, settleDays: 47, marketPoints: 45, crypto: false, tSpot: 4 / 365 })).toBe(4)
    expect(spotLagDays({ points: null, settleDays: 47, marketPoints: null, crypto: false, tSpot: 3 / 365 })).toBe(3)
    expect(spotLagDays({ points: null, settleDays: 47, marketPoints: null, crypto: false, tSpot: 0 })).toBe(0)
    expect(spotLagDays({ points, settleDays: 47, marketPoints: 45, crypto: false, tSpot: null })).toBe(2)
    expect(spotLagDays({ points, settleDays: 47, marketPoints: 45, crypto: false, tSpot: -1 })).toBe(2)
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
  it('no curve without a spot, a forward, a pip and a day count', () => {
    expect(carryPoints({ spot: 100, forward: null, days: 30, pip: 1 })).toBe(null)       // a settled trade's body: forward null
    expect(carryPoints({ spot: null, forward: 110, days: 30, pip: 1 })).toBe(null)
    expect(carryPoints({ spot: 100, forward: 110, days: NaN, pip: 1 })).toBe(null)
    expect(carryPoints({ spot: 100, forward: 110, days: 30 })).toBe(null)
    expect(carryPoints()).toBe(null)
    expect(curveNodes(null)).toBe(null)
    expect(curveNodes({ '1M': null })).toBe(null)
    expect(curveNodes({ '1M': 5 }, NaN)).toBe(null)
  })
  it('the API\'s tenor map is used when it is whole; this module\'s copy stands in for an older answer', () => {
    const api = { ON: 1, '1W': 7, '1M': 31 }
    expect(tenorMap(api)).toEqual(api)
    expect(tenorMap(undefined)).toBe(TENOR_DAYS)
    expect(tenorMap({})).toBe(TENOR_DAYS)
    expect(tenorMap({ '1M': 'thirty' })).toBe(TENOR_DAYS)
    expect(curveNodes({ '1M': 5 }, 0, api)).toEqual([{ tenor: '1M', days: 31, x: 31, points: 5 }])
    expect(Object.keys(carryPoints({ spot: 100, forward: 110, days: 31, pip: 1, tenorDays: api }))).toEqual(['ON', '1W', '1M'])
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
  it('no weights without the dragged tenor or the curve', () => {
    expect(rippleWeights(nodes, 9)).toBe(null)
    expect(rippleWeights(null, 0)).toBe(null)
    expect(rippleWeights(nodes, 1, 0)).toBe(null)
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
  it('missing inputs give null, never a bound or a zero', () => {
    expect(tenorBounds(nodes, { spot: null, pip: 1 })).toBe(null)
    expect(tenorBounds(nodes, { spot: 100 })).toBe(null)
    expect(tenorBounds(null, { spot: 100, pip: 1 })).toBe(null)
    expect(applyTenorDrag({ origin: [0, 0], weights: [1, 0.5], move: NaN, bounds })).toBe(null)
    expect(applyTenorDrag({ origin: [0, 0], weights: [1], move: 1, bounds })).toBe(null)
    expect(applyTenorDrag({ origin: [0, NaN], weights: [1, 0.5], move: 1, bounds })).toBe(null)
    expect(applyTenorDrag()).toBe(null)
    expect(clampSpotPct(NaN)).toBe(null)
    expect(clampSpotPct(undefined)).toBe(null)
    expect(spotPctFromDrag({ originPct: 0, dPrice: 5, ref: 0 })).toBe(null)
    expect(spotPctFromDrag({ originPct: 0, dPrice: NaN, ref: 100 })).toBe(null)
    expect(spotPctFromDrag({ originPct: null, dPrice: 5, ref: 100 })).toBe(null)
    expect(carryFactor(10, 0, null)).toBe(null)
    expect(carryFactor(NaN, 0, 30)).toBe(null)
    expect(carryFactor(0, 0, 30)).toBe(1)
  })
  it('the spot shock is held to its range', () => {
    expect(clampSpotPct(73)).toBe(50)
    expect(clampSpotPct(-73)).toBe(-50)
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
  it('no curve without a spot, a pip, or a move for every tenor', () => {
    expect(shockedCurve({ spot: null, pip: 1, nodes, moves: [0, 0] })).toBe(null)
    expect(shockedCurve({ spot: 100, pip: null, nodes, moves: [0, 0] })).toBe(null)
    expect(shockedCurve({ spot: 100, pip: 1, nodes, moves: [0] })).toBe(null)
    expect(shockedCurve({ spot: 100, pip: 1, nodes })).toBe(null)
    expect(shockedCurve({ spot: 100, pip: 1, nodes, moves: [0, 0], spotPct: NaN })).toBe(null)
    expect(shockedCurve({ spot: 100, pip: 1, nodes: null, moves: [] })).toBe(null)
  })
  it('the rate shocks tilt it: exp((Δquote − Δbase)·τ)', () => {
    const c = shockedCurve({ spot: 100, pip: 1, nodes, moves: [0, 0], quoteBp: 100, baseBp: 0 })
    expect(c[0].shocked).toBe(100)
    expect(c[2].shocked).toBeCloseTo(110 * Math.exp(0.01), 10)        // one year at +100bp
  })
  it('the carry runs from the spot date: a tenor drawn three days later is tilted over its own days, not three more', () => {
    const lagged = curveNodes({ '1M': 2, '1Y': 10 }, 3)
    const c = shockedCurve({ spot: 100, pip: 1, nodes: lagged, moves: [0, 0], quoteBp: 100, baseBp: 0 })
    expect(c[2].x).toBe(368)
    expect(c[2].shocked).toBeCloseTo(110 * Math.exp(0.01), 12)        // 365 days of carry, drawn at day 368
    expect(c[1].shocked).toBeCloseTo(102 * Math.exp(0.01 * 30 / 365), 12)
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
  it('agrees with the chart on a pair whose spot settles in three days: both carry the rate shocks from the spot date', () => {
    const q = { ...fwd, t: 33 / 365, t_spot: 3 / 365 }
    const nodes = curveNodes({ '1M': 2, '3M': 6 }, 3)
    const shocks = { spotPct: 4, quoteBp: 100, baseBp: -50 }
    const curve = shockedCurve({ spot: 100, pip: 1, nodes, moves: [3, 1], ...shocks })
    const r = reprice(q, { ...shocks, dPoints: interpPoints({ '1M': 3, '3M': 1 }, 30), pip: 1 })
    expect(curve[1].x).toBe(33)
    expect(r.forward).toBeCloseTo(curve[1].shocked, 9)
    expect(r.forward).toBeCloseTo((102 + 3) * 1.04 * Math.exp(0.015 * 30 / 365), 12)
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
  it('an FX pair in parity mode: with no shock the forward and NPV are the engine\'s, not S·DF_base/DF_quote from today', () => {
    // the engine carries spot from the spot date, so its forward is not the ratio of the two today-to-settlement
    // discount factors the quote names: 1.0850 · 0.99200/0.98800 = 1.08939, the engine says 1.08928
    const q = { shape: 'FORWARD', direction: 'BUY', base_notional: 10_000_000, spot: 1.0850, forward: 1.08928, forward_rate: 1.08928,
                df_quote: 0.98800, df_base: 0.99200, t: 0.25, forward_mode: 'IMPLIED', market_points: null }
    expect(q.spot * q.df_base / q.df_quote).toBeCloseTo(1.08939, 5)
    const r = reprice(q)
    expect(r.forward).toBe(1.08928)
    expect(r.npv).toBe(0)                                             // struck at the fair forward: nothing, not about 1,100
    expect(reprice({ ...q, forward_rate: 1.08900 }).npv).toBeCloseTo(10_000_000 * 0.00028 * 0.98800, 6)
    // a shock moves that forward: +1 % spot is +1 % forward, +100 bp on the quote curve is exp(+0.01·τ), with τ
    // the time from the spot date to settlement; an answer that does not name its spot lag is carried from today
    expect(reprice(q, { spotPct: 1 }).forward).toBeCloseTo(1.08928 * 1.01, 12)
    expect(reprice(q, { quoteBp: 100 }).forward).toBeCloseTo(1.08928 * Math.exp(0.0025), 12)
    expect(reprice(q, { baseBp: 100 }).forward).toBeCloseTo(1.08928 * Math.exp(-0.0025), 12)
    const lagged = { ...q, t_spot: 3 / 365 }
    expect(reprice(lagged, { quoteBp: 100 }).forward).toBeCloseTo(1.08928 * Math.exp(0.01 * (0.25 - 3 / 365)), 14)
    expect(reprice(lagged, { baseBp: 100 }).forward).toBeCloseTo(1.08928 * Math.exp(-0.01 * (0.25 - 3 / 365)), 14)
    // the discount factor still runs from today: +100 bp on the quote curve takes exp(−0.01·T) off it
    const k = 1.08900, up = reprice({ ...lagged, forward_rate: k }, { quoteBp: 100 })
    expect(up.npv).toBeCloseTo(10_000_000 * (up.forward - k) * 0.98800 * Math.exp(-0.0025), 6)
  })
  it('an option\'s forward moves as a forward\'s does: the same carry from the spot date under the same shocks', () => {
    const o = { shape: 'OPTION', direction: 'BUY', base_notional: 1_000_000, spot: 1.0850, forward: 1.08928, strike: 1.09, option_type: 'CALL',
                df_quote: 0.98800, t_settle: 0.25, t_expiry: 0.2445, vol_pct: 7.5, t_spot: 3 / 365 }
    const f = { shape: 'FORWARD', direction: 'BUY', base_notional: 1_000_000, spot: 1.0850, forward: 1.08928, forward_rate: 1.09,
                df_quote: 0.98800, df_base: 0.99200, t: 0.25, t_spot: 3 / 365 }
    for (const shocks of [{}, { spotPct: 5 }, { quoteBp: 100 }, { baseBp: -75 }, { spotPct: -3, quoteBp: 40, baseBp: 15, dPoints: 2, pip: 1e-4 }])
      expect(reprice(o, shocks).forward).toBe(reprice(f, shocks).forward)
  })
  it('never a forward at or below zero', () => {
    const r = reprice(fwd, { dPoints: -1000, pip: 1 })
    expect(r.forward).toBeCloseTo(FORWARD_FLOOR * 100, 10)
    expect(r.forward).toBeGreaterThan(0)
  })
  it('the floor holds a finite shocked forward up; it never stands in for a forward that could not be worked out', () => {
    // the body of a fixed or settled trade as the API sends it: the pricing fields are null
    const settled = { ...fwd, forward: null, df_quote: null, df_base: null, t: null }
    expect(reprice(settled)).toBe(null)
    expect(reprice(settled, { spotPct: 5 })).toBe(null)
    for (const key of ['spot', 'forward', 'forward_rate', 'df_quote', 'df_base', 't', 'base_notional', 'direction']) {
      expect(reprice({ ...fwd, [key]: null }), key).toBe(null)
      expect(reprice({ ...fwd, [key]: undefined }), key).toBe(null)
    }
    expect(reprice({ ...fwd, t: NaN })).toBe(null)
    expect(reprice(null)).toBe(null)
    expect(reprice(fwd, { dPoints: NaN })).toBe(null)
    expect(reprice(fwd, { spotPct: null })).toBe(null)
    expect(reprice(fwd, { pip: 0 })).toBe(null)
  })
  it('an option without its strike, vol, times or type: null', () => {
    const opt = { shape: 'OPTION', direction: 'BUY', option_type: 'CALL', base_notional: 2, spot: 100, forward: 100, strike: 100,
                  df_quote: 1, t_settle: 1, t_expiry: 1, vol_pct: 20 }
    expect(reprice(opt)).not.toBe(null)
    for (const key of ['strike', 't_settle', 't_expiry', 'vol_pct', 'option_type', 'df_quote', 'forward', 'spot']) expect(reprice({ ...opt, [key]: null }), key).toBe(null)
    expect(gk(null, 100, 1, 0.2, true, 1)).toBe(null)
    expect(gk(100, 100, null, 0.2, true, 1)).toBe(null)
    expect(gk(100, 100, 1, 0.2, undefined, 1)).toBe(null)
    expect(gk(105, 100, 0, 0.2, true, 0.5)).toBeCloseTo(2.5, 10)                // at expiry: the discounted intrinsic
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
  it('no amount without a direction, a strike, a notional, a shape, or an option\'s type', () => {
    expect(settlementAmount({ ...f, fixing: 75000 })).toBe(null)
    expect(settlementAmount({ ...f, direction: 'BUY', fixing: 75000, strike: null })).toBe(null)
    expect(settlementAmount({ ...f, direction: 'BUY', fixing: 75000, notional: undefined })).toBe(null)
    expect(settlementAmount({ notional: 2, strike: 74000, direction: 'BUY', fixing: 75000 })).toBe(null)
    expect(settlementAmount({ shape: 'OPTION', notional: 2, strike: 74000, direction: 'BUY', fixing: 75000 })).toBe(null)
    expect(settlementAmount()).toBe(null)
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
  })
  it('no scale from nothing: null, not a default axis', () => {
    expect(horizonDays([], 0)).toBe(null)
    expect(horizonDays(null, 30)).toBe(null)
    expect(horizonDays([{ x: 0 }, { x: 30 }], null)).toBe(null)
    expect(valueRange([])).toBe(null)
    expect(valueRange([NaN, undefined, null])).toBe(null)
    expect(niceStep(0)).toBe(null)
    expect(niceStep(NaN)).toBe(null)
    const g = { width: 870, height: 260, hasLeft: true, maxDays: 91, vMin: 90, vMax: 110 }
    for (const key of ['width', 'height', 'maxDays', 'vMin', 'vMax']) expect(chartGeometry({ ...g, [key]: null }), key).toBe(null)
    expect(chartGeometry({ ...g, vMax: 90 })).toBe(null)
    expect(chartGeometry()).toBe(null)
  })
  it('without a curve the past takes most of the width', () => {
    const g = chartGeometry({ width: 870, height: 260, leftShare: 0.86, maxDays: 1, vMin: 90, vMax: 110 })
    expect(g.xs(0)).toBeCloseTo(70 + 0.86 * 782, 6)
    expect(g.xs(-30)).toBeCloseTo(70, 6)
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

describe('a fixed or settled trade', () => {
  it('the API names the state; nothing else is a settled trade', () => {
    expect(settledState({ state: 'FIXED' })).toBe('FIXED')
    expect(settledState({ state: 'SETTLED' })).toBe('SETTLED')
    expect(settledState({ state: 'LIVE', settled: true })).toBe(null)
    expect(settledState({ forward: 100, df_quote: 0.99 })).toBe(null)             // a ticket being priced
    expect(settledState(null)).toBe(null)
  })
  it('an answer without a state is read from the fields it has always carried', () => {
    expect(settledState({ settled: true })).toBe('SETTLED')
    expect(settledState({ settled: false, fixing_date: '2026-11-06', df_quote: null })).toBe('FIXED')
    expect(settledState({ settled: false, fixing_date: '2026-11-06' })).toBe('FIXED')
    expect(settledState({ settled: false, fixing_date: '2026-11-06', df_quote: 0.99 })).toBe(null)
  })
  it('why a figure is provisional', () => {
    expect(provisionalReasons({ provisional: false, fixing: null }, 'Source A')).toEqual([])
    expect(provisionalReasons({ provisional: true, fixing: null, fixing_date: '2026-11-06' }, 'Source A')).toEqual([{ kind: 'NO_FIXING', source: 'Source A', date: '2026-11-06' }])
    expect(provisionalReasons({ provisional: true, fixing: null, fixing_date: '2026-11-06', fixing_source: 'Source B' }, null)[0].source).toBe('Source B')
    expect(provisionalReasons({ provisional: true, fixing: { value: 1 }, provisional_reason: 'BARRIER_STATE_UNKNOWN' }, 'Source A')).toEqual([{ kind: 'BARRIER', ifTouched: null }])
    expect(provisionalReasons({ provisional: true, fixing: null, provisional_basis: 'knock state not recorded' }, 'Source A').map(r => r.kind)).toEqual(['NO_FIXING', 'BARRIER'])
    // the words settlement/rule.py uses today
    expect(provisionalReasons({ provisional: true, fixing: { value: 1 }, provisional_reason: 'knock state not recorded', provisional_basis: 'the barrier taken as never touched' }, 'Source A')).toEqual([{ kind: 'BARRIER', ifTouched: null }])
    expect(provisionalReasons({ provisional: true, fixing: null, fixing_date: '2026-11-06', provisional_reason: 'no fixing stored', provisional_basis: 'stored spot of 2026-11-06' }, 'Source A')).toEqual([{ kind: 'NO_FIXING', source: 'Source A', date: '2026-11-06' }])
    expect(provisionalReasons({ provisional: true, fixing: { value: 1 }, provisional_reason: 'holiday calendar pending' }, 'Source A')).toEqual([{ kind: 'OTHER', text: 'holiday calendar pending' }])
    expect(provisionalReasons({ provisional: true, fixing: { value: 1 } }, 'Source A')).toEqual([{ kind: 'OTHER', text: null }])
    expect(provisionalReasons(null)).toEqual([])
  })
  it('a source fixes at its own time', () => {
    const sources = [{ source: 'Source A', time: '16:00 London', auto: false }, { source: 'Source B', time: '08:00 UTC', auto: true }]
    expect(fixingTime(sources, 'Source B')).toBe('08:00 UTC')
    expect(fixingTime(sources, 'Source A')).toBe('16:00 London')
    expect(fixingTime(sources, 'Source C')).toBe(null)
    expect(fixingTime(null, 'Source A')).toBe(null)
    expect(fixingTime(sources, null)).toBe(null)
  })
})

// What DETAILS, CASHFLOWS and the settled view of CURVE SCENARIO print for a trade past its fixing date. The bodies
// are shaped as the API sends them (state, the facts, nulls for the pricing fields); the figures are made up.
describe('settledFacts: a fixed or settled trade as the API reported it', () => {
  const body = { state: 'FIXED', shape: 'NDF', pair: 'BTCUSD', direction: 'BUY', base_notional: 10, forward_rate: 100000, quote_currency: 'USD',
                 valuation_date: '2026-11-09', fixing_date: '2026-11-08', settlement_date: '2026-11-10', fixing_source: 'Source A',
                 forward: null, df_quote: null, t: null, provisional: false, provisional_reason: null, provisional_basis: null, model: null }
  const fixing = { source: 'Source A', date: '2026-11-08', time: '16:00 London', value: 107500.5, origin: 'MANUAL' }

  it('a live quote or a ticket has no settled facts', () => {
    expect(settledFacts({ state: 'LIVE', forward: 100 })).toBe(null)
    expect(settledFacts({ forward: 100, df_quote: 0.99 })).toBe(null)
    expect(settledFacts(null)).toBe(null)
  })
  it('a FIXED forward: the fixing, the amount as sent, both dates', () => {
    const f = settledFacts({ ...body, fixing, settlement_amount: 75005, settlement_price: 107500.5 })
    expect(f).toMatchObject({ state: 'FIXED', fixing: 107500.5, source: 'Source A', fixDate: '2026-11-08', time: '16:00 London', settlementDate: '2026-11-10',
                              amount: 75005, priceUsed: 107500.5, priceIsFixing: true, provisional: false, disputed: false, ifTouched: null,
                              strike: 100000, notional: 10, amountNote: 'due on the settlement date', reasons: [] })
  })
  it('the amount is the API\'s figure, not N × (fixing − K) worked out again', () => {
    // 10 × (107,500.5 − 100,000) is 75,005; the body says otherwise and the body is what is shown
    expect(settledFacts({ ...body, fixing, settlement_amount: 12345.67, settlement_price: 107500.5 }).amount).toBe(12345.67)
    expect(settledFacts({ ...body, fixing, settlement_amount: null, settlement_price: 107500.5 }).amount).toBe(null)
    expect(settledFacts({ ...body, fixing, settlement_amount: null }).amountNote).toBe('not reported for this trade')
  })
  it('a FIXED provisional forward with no fixing: the stored spot is the price used, and is not called a fixing', () => {
    const f = settledFacts({ ...body, fixing: null, settlement_amount: 82500, settlement_price: 108250, provisional: true,
                             provisional_reason: 'no fixing stored', provisional_basis: 'stored spot of 2026-11-08' })
    expect(f).toMatchObject({ fx: null, fixing: null, priceUsed: 108250, priceIsFixing: false, price: 108250, amount: 82500, provisional: true,
                              fixDate: '2026-11-08', source: 'Source A', amountNote: 'provisional: see below' })
    expect(f.reasons).toEqual([{ kind: 'NO_FIXING', source: 'Source A', date: '2026-11-08' }])
  })
  it('the source falls back to the terms, and its time to the pair\'s list, then the terms', () => {
    const terms = { settlement_price_source: 'Source B', valuation_time: '12:00 Tokyo' }
    const f = settledFacts({ ...body, fixing_source: null, fixing: null, provisional: true }, terms, [{ source: 'Source B', time: '08:00 UTC' }])
    expect(f.source).toBe('Source B')
    expect(f.time).toBe('08:00 UTC')
    expect(settledFacts({ ...body, fixing_source: null, fixing: null }, terms, []).time).toBe('12:00 Tokyo')
    expect(settledFacts({ ...body, fixing }, terms, [{ source: 'Source A', time: '08:00 UTC' }]).time).toBe('16:00 London')     // the fixing's own time first
  })
  it('a SETTLED option: the model words stand under the amount', () => {
    const q = { ...body, state: 'SETTLED', shape: 'OPTION', option_type: 'CALL', strike: 100000, style: 'EUROPEAN', forward_rate: undefined, expiry_date: '2026-11-08',
                fixing, settlement_amount: 75005, settlement_price: 107500.5, model: 'settled: the mark is zero from the settlement date; the amount is reported beside it' }
    const f = settledFacts(q)
    expect(f).toMatchObject({ state: 'SETTLED', strike: 100000, amount: 75005, model: q.model, amountNote: q.model })
    expect(settledFacts({ ...q, model: null }).amountNote).toBe('settled')
    expect(settledFacts({ ...q, model: '   ' }).amountNote).toBe('settled')
    expect(settledFacts({ ...q, model: 'paid at the hit: nothing is outstanding at expiry', settlement_amount: null }).amountNote).toBe('paid at the hit: nothing is outstanding at expiry')
  })
  it('a barrier whose knock state is not recorded: both amounts, as sent', () => {
    const q = { ...body, shape: 'OPTION', option_type: 'CALL', strike: 100000, style: 'BARRIER', fixing, settlement_amount: 75005, settlement_amount_if_touched: 0,
                provisional: true, provisional_reason: 'knock state not recorded', provisional_basis: 'the barrier taken as never touched' }
    const f = settledFacts(q)
    expect(f.ifTouched).toBe(0)                                       // zero is an amount, not a missing one
    expect(f.amount).toBe(75005)
    expect(f.reasons).toEqual([{ kind: 'BARRIER', ifTouched: 0 }])
    // the field alone says it, whatever the words
    expect(settledFacts({ ...q, provisional_reason: null, provisional_basis: null, settlement_amount_if_touched: 1500 }).reasons).toEqual([{ kind: 'BARRIER', ifTouched: 1500 }])
    expect(settledFacts({ ...body, fixing, settlement_amount: 75005 }).ifTouched).toBe(null)
  })
  it('a disputed fixing is flagged; anything but true is not', () => {
    expect(settledFacts({ ...body, fixing: { ...fixing, disputed: true }, settlement_amount: 75005 }).disputed).toBe(true)
    expect(settledFacts({ ...body, fixing: { ...fixing, disputed: false }, settlement_amount: 75005 }).disputed).toBe(false)
    expect(settledFacts({ ...body, fixing, settlement_amount: 75005 }).disputed).toBe(false)
    expect(settledFacts({ ...body, fixing: null, provisional: true }).disputed).toBe(false)
  })
  it('a fixing without a value is not a fixing', () => {
    const f = settledFacts({ ...body, fixing: { source: 'Source A', date: '2026-11-08', value: null }, settlement_price: 108250 })
    expect(f.fx).toBe(null)
    expect(f.priceIsFixing).toBe(false)
    expect(f.priceUsed).toBe(108250)
  })
})

describe('styleTerms: the style rows of the term sheet', () => {
  const o = { shape: 'OPTION', base_currency: 'BTC', quote_currency: 'USD' }
  it('a touch: what it pays and when, and its level', () => {
    expect(styleTerms({ ...o, style: 'TOUCH', touch_type: 'ONE_TOUCH', payout: 50000, payout_currency: 'QUOTE', pay_at_hit: true, barrier: 120000 }))
      .toEqual({ payout: { amount: 50000, currency: 'USD' }, when: 'at the hit', barrier: 120000, range: null })
    expect(styleTerms({ ...o, style: 'TOUCH', touch_type: 'NO_TOUCH', payout: 2, payout_currency: 'BASE', pay_at_hit: false, barrier: 90000 }))
      .toEqual({ payout: { amount: 2, currency: 'BTC' }, when: 'at expiry', barrier: 90000, range: null })
  })
  it('what the body does not carry is null, so the row or the words are left out', () => {
    expect(styleTerms({ ...o, style: 'TOUCH', touch_type: 'ONE_TOUCH', payout: null, pay_at_hit: null, barrier: null })).toEqual({ payout: null, when: null, barrier: null, range: null })
    expect(styleTerms({ ...o, style: 'BARRIER', barrier: null }).barrier).toBe(null)
    expect(styleTerms({ ...o, style: 'DOUBLE_BARRIER', lower: 80000, upper: null }).range).toBe(null)
    expect(styleTerms({ ...o, style: 'DIGITAL', payout: undefined }).payout).toBe(null)
  })
  it('a double has a range and no single level; a vanilla has neither', () => {
    expect(styleTerms({ ...o, style: 'DOUBLE_BARRIER', lower: 80000, upper: 120000, barrier: 99 })).toMatchObject({ barrier: null, range: { lower: 80000, upper: 120000 } })
    expect(styleTerms({ ...o, style: 'TOUCH', touch_type: 'DOUBLE_NO_TOUCH', lower: 80000, upper: 120000, pay_at_hit: false })).toMatchObject({ barrier: null, range: { lower: 80000, upper: 120000 }, when: 'at expiry' })
    expect(styleTerms({ ...o, style: 'BARRIER', barrier: 120000, payout: 5 })).toEqual({ payout: null, when: null, barrier: 120000, range: null })
    expect(styleTerms({ ...o, style: 'EUROPEAN', barrier: 120000 })).toEqual({ payout: null, when: null, barrier: null, range: null })
    expect(styleTerms({ shape: 'NDF' })).toEqual({ payout: null, when: null, barrier: null, range: null })
    expect(styleTerms({ ...o, style: 'DIGITAL', payout: 1000, payout_currency: 'QUOTE' }).payout).toEqual({ amount: 1000, currency: 'USD' })
  })
})

describe('the levels on the chart', () => {
  const o = { shape: 'OPTION', strike: 100, forward: 100 }
  it('a touch has no strike: its level is drawn instead', () => {
    expect(chartStrike({ ...o, style: 'TOUCH', barrier: 120 })).toBe(null)
    expect(chartLevels({ ...o, style: 'TOUCH', touch_type: 'ONE_TOUCH', barrier: 120 })).toEqual([{ label: 'TOUCH', value: 120 }])
    expect(chartLevels({ ...o, style: 'TOUCH', touch_type: 'DOUBLE_NO_TOUCH', lower: 80, upper: 120 })).toEqual([{ label: 'TOUCH', value: 80 }, { label: 'TOUCH', value: 120 }])
  })
  it('a barrier option: K and its barrier or barriers', () => {
    expect(chartStrike({ ...o, style: 'BARRIER', barrier: 120 })).toBe(100)
    expect(chartLevels({ ...o, style: 'BARRIER', barrier: 120 })).toEqual([{ label: 'BARRIER', value: 120 }])
    expect(chartLevels({ ...o, style: 'DOUBLE_BARRIER', lower: 80, upper: 120 })).toEqual([{ label: 'BARRIER', value: 80 }, { label: 'BARRIER', value: 120 }])
  })
  it('a vanilla option and a forward: K alone; a level the body does not carry is not drawn', () => {
    expect(chartLevels({ ...o, style: 'EUROPEAN' })).toEqual([])
    expect(chartLevels({ shape: 'NDF', forward_rate: 101 })).toEqual([])
    expect(chartStrike({ shape: 'NDF', forward_rate: 101 })).toBe(101)
    expect(chartLevels({ ...o, style: 'BARRIER', barrier: null })).toEqual([])
    expect(chartStrike({ shape: 'NDF', forward_rate: null })).toBe(null)
    expect(chartStrike(null)).toBe(null)
  })
})

// The backend writes these cases from its own functions (interp_points in api/routes/currencies.py and the
// settlement rule in settlement/rule.py): the browser must give the same numbers.
describe('shared vectors: backend/tests/vectors/fx_scenario.json', () => {
  const file = fileURLToPath(new URL('../../../../backend/tests/vectors/fx_scenario.json', import.meta.url))
  const vectors = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  const close = (got, want) => {
    if (want == null) return expect(got).toBe(null)
    expect(got).not.toBe(null)
    expect(Math.abs(got - want)).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(want)))
  }
  it.skipIf(vectors)('SKIPPED: backend/tests/vectors/fx_scenario.json is absent, so the browser is not checked against the backend here', () => {})
  it.skipIf(!vectors)('the file has cases of both kinds', () => {
    expect(vectors.interp_points.length).toBeGreaterThan(0)
    expect(vectors.settlement_amount.length).toBeGreaterThan(0)
  })
  it.skipIf(!vectors)('interpPoints gives the backend\'s interp_points on every case', () => {
    const tenorDays = vectors.tenor_days ? tenorMap(vectors.tenor_days) : TENOR_DAYS
    for (const c of vectors.interp_points) close(interpPoints(c.points, c.days, tenorDays), c.expected)
  })
  it.skipIf(!vectors)('settlementAmount gives the backend rule\'s amount on every case', () => {
    for (const c of vectors.settlement_amount) {
      const got = settlementAmount({ shape: c.kind === 'FORWARD' ? 'FORWARD' : 'OPTION', optionType: c.kind === 'FORWARD' ? undefined : c.kind,
                                     direction: c.direction, notional: c.notional, strike: c.strike, fixing: c.fixing })
      close(got, c.expected)
    }
  })
  // The engine prices a forward, then prices it again with the spot or the curves moved; `reprice` has the first
  // answer alone. In parity mode, which every case in the file is, it must give the engine's figures: with no
  // shock, under a spot shock and under a parallel rate shock (an FX spot settles on the spot date, and the
  // engine's answer says how far off that is: four of the six cases have that lag, of three and four days).
  it.skipIf(!vectors)('reprice with no shock is the engine\'s forward and NPV, spot lag or none', () => {
    expect(vectors.reprice.length).toBe(6)
    expect(vectors.reprice.filter(c => c.t_spot > 0).length).toBe(4)
    for (const c of vectors.reprice) {
      const r = reprice(c.quote, { pip: c.pip })
      close(r.forward, c.quote.forward)
      expect(Math.abs(r.npv - c.npv), c.name).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(c.npv)))
    }
  })
  it.skipIf(!vectors)('reprice under a spot shock is the engine priced again at the moved spot', () => {
    for (const c of vectors.reprice) for (const s of c.spot_shocks) {
      const r = reprice(c.quote, { spotPct: s.spot_pct, pip: c.pip })
      close(r.forward, s.forward)
      // the NPV is a small difference of large numbers at the fair forward: to a millionth of a unit of the notional's value
      expect(Math.abs(r.npv - s.npv), `${c.name} ${s.spot_pct}%`).toBeLessThanOrEqual(1e-9 * c.quote.base_notional * c.quote.forward)
    }
  })
  it.skipIf(!vectors)('reprice under a rate shock is the engine priced again on the moved curves, spot lag or none', () => {
    for (const c of vectors.reprice) {
      expect(c.quote.t_spot, c.name).toBe(c.t_spot)                   // the lag is in the engine's answer, where the tab reads it
      for (const s of c.rate_shocks) {
        const r = reprice(c.quote, { quoteBp: s.quote_bp, baseBp: s.base_bp, pip: c.pip })
        close(r.forward, s.forward)
        expect(Math.abs(r.npv - s.npv), `${c.name} ${s.quote_bp}/${s.base_bp}`).toBeLessThanOrEqual(1e-9 * c.quote.base_notional * c.quote.forward)
      }
    }
  })
  it.skipIf(!vectors)('without the lag the same shock is off by the carry over it: the answer\'s t_spot is what makes it exact', () => {
    const c = vectors.reprice.find(v => v.name === 'EURUSD 3M, spot in three days, at the fair forward')
    const s = c.rate_shocks.find(v => v.quote_bp === 100 && v.base_bp === 0)
    const blind = reprice({ ...c.quote, t_spot: undefined }, { quoteBp: 100, pip: c.pip })
    // exp(0.01 · 3/365) − 1 = 0.0000822 of the forward: 0.9 pips, and about 887 USD on 10 million
    expect(blind.forward / s.forward - 1).toBeCloseTo(Math.expm1(0.01 * 3 / 365), 12)
    expect(blind.npv - s.npv).toBeGreaterThan(880)
    expect(blind.npv - s.npv).toBeLessThan(895)
  })
})

describe('one date format: ISO everywhere the tabs print a date', () => {
  it('cuts a date or a timestamp to YYYY-MM-DD and gives nothing for anything else', () => {
    expect(isoDate('2027-02-09')).toBe('2027-02-09')
    expect(isoDate('2027-02-09T08:00:00Z')).toBe('2027-02-09')
    expect(isoDate('09 Feb 27')).toBe('')
    expect(isoDate('11/09/2026')).toBe('')
    expect(isoDate(null)).toBe('')
    expect(isoDate(undefined)).toBe('')
  })
  it('adds whole days across a month and a year end', () => {
    expect(addDays('2026-11-09', -30)).toBe('2026-10-10')
    expect(addDays('2026-12-25', 10)).toBe('2027-01-04')
    expect(addDays('2026-11-09', 0)).toBe('2026-11-09')
    expect(addDays('not a date', 1)).toBe('')
    expect(addDays('2026-11-09', NaN)).toBe('')
  })
  it('marks a dense axis MM-DD only when every date on it is in one year', () => {
    expect(axisDates(['2026-10-10', '2026-10-20', '2026-10-30', '2026-11-09'])).toEqual(['10-10', '10-20', '10-30', '11-09'])
    expect(axisDates(['2026-12-12', '2026-12-22', '2027-01-01', '2027-01-11'])).toEqual(['2026-12-12', '2026-12-22', '2027-01-01', '2027-01-11'])
    expect(axisDates(['2026-12-12', 'x', '2026-12-22'])).toEqual(['12-12', '', '12-22'])   // a tick that is not a date prints nothing
    expect(axisDates([])).toEqual([])
    expect(axisDates(null)).toEqual([])
  })
})

describe('signedChange: a change with its sign, and no sign on nothing', () => {
  it('signs a gain and a loss and groups thousands', () => {
    expect(signedChange(1234.4)).toBe('+1,234')
    expect(signedChange(-56.5)).toBe('-57')
    expect(signedChange(0.0312, 2)).toBe('+0.03')
  })
  it('prints a change that rounds to nothing as a plain zero, from either side', () => {
    expect(signedChange(0)).toBe('0')
    expect(signedChange(-0)).toBe('0')
    expect(signedChange(0.4)).toBe('0')
    expect(signedChange(-0.4)).toBe('0')
    expect(signedChange(-0.004, 2)).toBe('0.00')
  })
  it('a dash for what is not a number', () => {
    expect(signedChange(null)).toBe('—')
    expect(signedChange(NaN)).toBe('—')
    expect(signedChange(undefined)).toBe('—')
  })
})

describe('strikeAsBooked: K as the ticket will book it', () => {
  it('rounds to the nearest decimals and refuses what is not a number', () => {
    expect(roundTo(108466.3649, 2)).toBe(108466.36)
    expect(roundTo(108466.365, 2)).toBe(108466.37)
    expect(roundTo(1.0856789, 5)).toBe(1.08568)
    expect(roundTo(150.12349, 3)).toBe(150.123)
    expect(roundTo(NaN, 2)).toBe(null)
    expect(roundTo(1, 1.5)).toBe(null)
    expect(roundTo(1, -1)).toBe(null)
  })
  const fwd = { shape: 'NDF', forward_rate: 108466.3649, forward: 108466.3649 }
  it('takes the terms\' own level first, as a string, for a forward and for an option', () => {
    expect(strikeAsBooked(fwd, { forward_price: '108466.36' }, 2)).toBe(108466.36)
    expect(strikeAsBooked({ shape: 'FORWARD', forward_rate: 1.0856789 }, { forward_rate: '1.08568' }, 5)).toBe(1.08568)
    expect(strikeAsBooked({ shape: 'OPTION', style: 'EUROPEAN', strike: 110000.004 }, { strike_price: '110000' }, 2)).toBe(110000)
    expect(strikeAsBooked({ shape: 'OPTION', style: 'BARRIER', strike: 1.1 }, { strike: '1.10000' }, 5)).toBe(1.1)
  })
  it('rounds the quote\'s level to the pair\'s decimals when the terms carry none', () => {
    expect(strikeAsBooked(fwd, null, 2)).toBe(108466.36)
    expect(strikeAsBooked(fwd, {}, 2)).toBe(108466.36)
    expect(strikeAsBooked(fwd, { forward_price: null }, 2)).toBe(108466.36)
    expect(strikeAsBooked(fwd, { forward_price: 'abc' }, 2)).toBe(108466.36)          // an unreadable term is no term
    expect(strikeAsBooked({ shape: 'FORWARD', forward_rate: 1.0856789 }, null, 5)).toBe(1.08568)
    expect(strikeAsBooked({ shape: 'FORWARD', forward_rate: 150.12349 }, null, 3)).toBe(150.123)
    expect(strikeAsBooked({ shape: 'OPTION', style: 'EUROPEAN', strike: 110000.004 }, null, 2)).toBe(110000)
  })
  it('does not read a forward\'s field on an option or an option\'s on a forward', () => {
    expect(strikeAsBooked({ shape: 'OPTION', style: 'EUROPEAN', strike: 2 }, { forward_price: '5' }, 2)).toBe(2)
    expect(strikeAsBooked(fwd, { strike: '5' }, 2)).toBe(108466.36)
  })
  it('has no K for a touch, and none without a quote or a level', () => {
    expect(strikeAsBooked({ shape: 'OPTION', style: 'TOUCH', barrier: 120000 }, { strike_price: '110000' }, 2)).toBe(null)
    expect(strikeAsBooked(null, { forward_price: '1' }, 2)).toBe(null)
    expect(strikeAsBooked({ shape: 'NDF' }, null, 2)).toBe(null)
  })
})

describe('modelWords: the engine\'s method, with the forward named once', () => {
  it('leaves a method alone when it already names a forward', () => {
    expect(modelWords('Black-76 on the quoted forward (the basis in the points as the carry)')).toBe('Black-76 on the quoted forward (the basis in the points as the carry)')
    expect(modelWords('Black-76 on the forward to settlement')).toBe('Black-76 on the forward to settlement')
  })
  it('adds the forward to settlement to one that does not', () => {
    expect(modelWords('Garman–Kohlhagen')).toBe('Garman–Kohlhagen on the forward to settlement')
    expect(modelWords('Leisen–Reimer binomial tree')).toBe('Leisen–Reimer binomial tree on the forward to settlement')
  })
  it('falls back when the quote carries no method', () => {
    expect(modelWords(null)).toBe('Garman–Kohlhagen on the forward to settlement')
    expect(modelWords('  ', 'Black-76')).toBe('Black-76 on the forward to settlement')
  })
})

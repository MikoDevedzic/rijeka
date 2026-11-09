// The vol surface of the CURVE SCENARIO tab (fx-vol.js). The first half is worked by hand from the rule in the
// comment beside each figure; the second reads backend/tests/vectors/fx_scenario.json, which the backend writes
// from its own parse_surface, _interp, smile_vol, forward_delta and vol_at. Every surface here is made up.
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  TENOR_YEARS, READ_TOLERANCE_PTS, pillars, interpPillar, smileVol, erf, normCdf, forwardCallDelta, volAt, pricedOnThis, surfaceReading, expiryWhere,
  shockedVol, termCurve, smileCurve, deltaRange, volGeometry, VOL_PAD, STANDARD_VOL_TENORS, surfaceTenors,
} from './fx-vol'

// 1M: ATM 10, RR −1, BF 0.4.   3M: ATM 12, RR −2, BF 0.8.   In decimals 0.10/−0.01/0.004 and 0.12/−0.02/0.008.
const GRID = { '1M': { ATM: 10, RR25: -1, BF25: 0.4 }, '3M': { ATM: 12, RR25: -2, BF25: 0.8 } }
const Z75 = 0.6744897501960817            // Φ(Z75) = 0.75, so Φ(−Z75) = 0.25

describe('pillars: the backend\'s parse_surface', () => {
  it('uses the backend\'s tenor years, not the forward-points days', () => {
    expect(TENOR_YEARS['1M']).toBe(1 / 12)             // 30 days would be 0.0822
    expect(TENOR_YEARS['2W']).toBe(14 / 365)
    expect(TENOR_YEARS['3W']).toBe(21 / 365)
    expect(Object.keys(TENOR_YEARS)).toHaveLength(15)
  })
  it('one pillar per tenor with an ATM, in time order, in decimals', () => {
    const ps = pillars({ '3M': GRID['3M'], '1M': GRID['1M'] })
    expect(ps.map(p => p.tenor)).toEqual(['1M', '3M'])
    expect(ps[0]).toEqual({ tenor: '1M', t: 1 / 12, atm: 0.1, rr: -0.01, bf: 0.004, smile: true })
  })
  it('drops a tenor without an ATM, with a zero ATM, or that the map does not know', () => {
    const ps = pillars({ '1W': { RR25: 1, BF25: 1 }, '2W': { ATM: 0 }, '1M': { ATM: 9 }, '7M': { ATM: 9 }, '10Y': { ATM: 30 } })
    expect(ps.map(p => p.tenor)).toEqual(['1M'])
  })
  it('smile is true when an RR25 or a BF25 is quoted, and a missing one of the two reads as zero', () => {
    const [a, b, c] = pillars({ '1M': { ATM: 9 }, '3M': { ATM: 9, RR25: 0.5 }, '6M': { ATM: 9, BF25: 0.25 } })
    expect([a.smile, b.smile, c.smile]).toEqual([false, true, true])
    expect([b.rr, b.bf, c.rr, c.bf]).toEqual([0.005, 0, 0, 0.0025])
  })
  it('reads a number sent as a string, skips a quote that is not a number, and reads keys in either case', () => {
    expect(pillars({ '1m': { atm: '9.5', rr25: null, bf25: 'n/a' } })).toEqual([{ tenor: '1M', t: 1 / 12, atm: 0.095, rr: 0, bf: 0, smile: false }])
  })
  it('no grid: no pillars', () => {
    expect(pillars(null)).toEqual([])
    expect(pillars(undefined)).toEqual([])
    expect(pillars({})).toEqual([])
    expect(pillars({ '1M': null })).toEqual([])
  })
})

describe('surfaceTenors: the rows of the market-data page\'s vol grid', () => {
  it('no stored surface, or one on the standard tenors: the standard eight', () => {
    expect(surfaceTenors(null)).toEqual(STANDARD_VOL_TENORS)
    expect(surfaceTenors(undefined)).toEqual(['1W', '1M', '2M', '3M', '6M', '9M', '1Y', '2Y'])
    expect(surfaceTenors(['1M', '3M', '1Y'])).toEqual(STANDARD_VOL_TENORS)
  })
  it('a ten-tenor surface keeps its 2W and 3W, in time order', () => {
    expect(surfaceTenors(['1W', '2W', '3W', '1M', '2M', '3M', '6M', '9M', '1Y', '2Y'])).toEqual(['1W', '2W', '3W', '1M', '2M', '3M', '6M', '9M', '1Y', '2Y'])
  })
  it('a stored tenor outside the standard ones is merged in where it falls; one the map does not know goes last', () => {
    expect(surfaceTenors(['18m', 'ON', '7M', '3M'])).toEqual(['ON', '1W', '1M', '2M', '3M', '6M', '9M', '1Y', '18M', '2Y', '7M'])
  })
})

describe('interpPillar: the backend\'s _interp, linear in time and in vol', () => {
  const ps = pillars(GRID)
  it('halfway in time between 1M (1/12) and 3M (3/12), at 2/12: the mean of each quote', () => {
    // HAND 1. ATM (10 + 12)/2 = 11, RR (−1 − 2)/2 = −1.5, BF (0.4 + 0.8)/2 = 0.6
    const p = interpPillar(ps, 2 / 12)
    expect(p.atm).toBeCloseTo(0.11, 12)
    expect(p.rr).toBeCloseTo(-0.015, 12)
    expect(p.bf).toBeCloseTo(0.006, 12)
    expect(p.smile).toBe(true)
  })
  it('a quarter of the way: 1M + ¼·(3M − 1M)', () => {
    // T = 1/12 + ¼·(2/12) = 1.5/12 = 0.125: ATM 10 + ¼·2 = 10.5
    expect(interpPillar(ps, 0.125).atm).toBeCloseTo(0.105, 12)
  })
  it('in vol, not in variance', () => {
    // total variance linear in time would give sqrt((0.10²/12 + 0.12²·3/12)/2 / (2/12)) = sqrt(0.0022167/0.16667) = 11.53, not 11
    expect(Math.sqrt((0.01 / 12 + 0.0144 * 3 / 12) / 2 / (2 / 12))).toBeCloseTo(0.11533, 5)
    expect(interpPillar(ps, 2 / 12).atm).toBeCloseTo(0.11, 12)
  })
  it('on a pillar its own quotes; flat before the first and beyond the last', () => {
    expect(interpPillar(ps, 1 / 12)).toEqual({ t: 1 / 12, atm: 0.1, rr: -0.01, bf: 0.004, smile: true })
    expect(interpPillar(ps, 0)).toEqual({ t: 0, atm: 0.1, rr: -0.01, bf: 0.004, smile: true })
    expect(interpPillar(ps, 4)).toEqual({ t: 4, atm: 0.12, rr: -0.02, bf: 0.008, smile: true })
  })
  it('RR and BF skip a tenor that quotes an ATM alone', () => {
    // 1M smiled, 2M ATM only (ATM 20), 3M smiled. At 2M the ATM is the 2M's 20; the RR is halfway from 1M to 3M: −1.5
    const mixed = pillars({ ...GRID, '2M': { ATM: 20 } })
    const p = interpPillar(mixed, 2 / 12)
    expect(p.atm).toBeCloseTo(0.2, 12)
    expect(p.rr).toBeCloseTo(-0.015, 12)
    expect(p.bf).toBeCloseTo(0.006, 12)
  })
  it('no smiled tenor: an ATM and no skew', () => {
    expect(interpPillar(pillars({ '1M': { ATM: 9 }, '3M': { ATM: 11 } }), 2 / 12)).toEqual({ t: 2 / 12, atm: expect.closeTo(0.1, 12), rr: 0, bf: 0, smile: false })
  })
  it('no pillars or no time: null', () => {
    expect(interpPillar([], 0.5)).toBe(null)
    expect(interpPillar(null, 0.5)).toBe(null)
    expect(interpPillar(ps, NaN)).toBe(null)
    expect(interpPillar(ps, null)).toBe(null)
  })
})

describe('smileVol: σ(Δ) = ATM − 2·RR·(Δ − ½) + 16·BF·(Δ − ½)²', () => {
  it('gives back the three quotes at call deltas of ¼, ½ and ¾', () => {
    // HAND 2. At the 2M point above (ATM 11, RR −1.5, BF 0.6):
    //   Δ = ¼, the 25-delta call: 0.11 − 2·(−0.015)·(−0.25) + 16·0.006·0.0625 = 0.11 − 0.0075 + 0.006 = 0.1085  (ATM + BF + RR/2)
    //   Δ = ¾, the 25-delta put:  0.11 − 2·(−0.015)·(+0.25) + 0.006          = 0.11 + 0.0075 + 0.006 = 0.1235  (ATM + BF − RR/2)
    expect(smileVol(0.11, -0.015, 0.006, 0.5)).toBe(0.11)
    expect(smileVol(0.11, -0.015, 0.006, 0.25)).toBeCloseTo(0.1085, 12)
    expect(smileVol(0.11, -0.015, 0.006, 0.75)).toBeCloseTo(0.1235, 12)
  })
  it('the risk reversal is call minus put, the butterfly their mean over the ATM', () => {
    const c = smileVol(0.11, -0.015, 0.006, 0.25), p = smileVol(0.11, -0.015, 0.006, 0.75)
    expect(c - p).toBeCloseTo(-0.015, 12)
    expect((c + p) / 2 - 0.11).toBeCloseTo(0.006, 12)
  })
  it('extrapolates the quadratic beyond the wings as it stands', () => {
    // Δ = 0.1: 0.11 − 2·(−0.015)·(−0.4) + 16·0.006·0.16 = 0.11 − 0.012 + 0.01536 = 0.11336
    expect(smileVol(0.11, -0.015, 0.006, 0.1)).toBeCloseTo(0.11336, 12)
  })
  it('a missing input: null', () => {
    expect(smileVol(0.11, null, 0.006, 0.25)).toBe(null)
    expect(smileVol(0.11, -0.015, 0.006, NaN)).toBe(null)
  })
})

describe('forwardCallDelta: Φ(d1), as fx_option.forward_delta has it for a call', () => {
  it('erf and Φ at tabulated points', () => {
    expect(erf(0)).toBe(0)
    expect(erf(0.5)).toBeCloseTo(0.5204998778130465, 15)
    expect(erf(1)).toBeCloseTo(0.8427007929497149, 15)
    expect(erf(2)).toBeCloseTo(0.9953222650189527, 15)           // the continued fraction's side of 1.5
    expect(erf(-3)).toBeCloseTo(-0.9999779095030014, 15)
    expect(erf(40)).toBe(1)
    expect(erf(-40)).toBe(-1)
    expect(Number.isNaN(erf(NaN))).toBe(true)
    expect(normCdf(0)).toBe(0.5)
    expect(normCdf(Z75)).toBeCloseTo(0.75, 14)
    expect(normCdf(1.959963984540054)).toBeCloseTo(0.975, 14)
  })
  it('at the forward, one year, 20 vol: d1 = ½σ√T = 0.1', () => {
    // HAND 3. d1 = (ln 1 + ½·0.04·1)/(0.2·1) = 0.1 and Φ(0.1) = 0.539827837 (the normal table's 0.5398)
    expect(forwardCallDelta(100, 100, 1, 0.2)).toBeCloseTo(0.5398278372770290, 13)
  })
  it('is ½ at the strike K = F·exp(½σ²T), where d1 = 0', () => {
    expect(forwardCallDelta(100, 100 * Math.exp(0.5 * 0.04 * 1), 1, 0.2)).toBeCloseTo(0.5, 14)
  })
  it('is ¼ at the 25-delta call strike K = F·exp(Z·σ√T + ½σ²T)', () => {
    expect(forwardCallDelta(100, 100 * Math.exp(Z75 * 0.2 + 0.02), 1, 0.2)).toBeCloseTo(0.25, 13)
  })
  it('no time or no vol: 1 in the money, 0 otherwise', () => {
    expect(forwardCallDelta(100, 90, 0, 0.2)).toBe(1)
    expect(forwardCallDelta(100, 110, 0, 0.2)).toBe(0)
    expect(forwardCallDelta(100, 100, 0, 0.2)).toBe(0)
    expect(forwardCallDelta(100, 90, 1, 0)).toBe(1)
  })
  it('a missing or non-positive forward or strike: null', () => {
    expect(forwardCallDelta(null, 100, 1, 0.2)).toBe(null)
    expect(forwardCallDelta(100, 0, 1, 0.2)).toBe(null)
    expect(forwardCallDelta(100, 100, undefined, 0.2)).toBe(null)
    expect(forwardCallDelta(100, 100, 1, NaN)).toBe(null)
  })
})

describe('volAt: the fixed point σ = smile(Δ_call(σ))', () => {
  const ps = pillars(GRID)
  const T = 2 / 12                                           // ATM 11, RR −1.5, BF 0.6 (HAND 1)
  it('at the strike whose delta is ½ the vol is the ATM', () => {
    // K = F·exp(½·0.11²·T) = 100·exp(0.00100833) = 100.1009: d1 = 0 at σ = 0.11, so the first step already returns 0.11
    expect(volAt(ps, T, 100, 100 * Math.exp(0.5 * 0.11 * 0.11 * T))).toBeCloseTo(0.11, 12)
  })
  it('at the 25-delta call\'s own strike the vol is the quoted wing, 10.85; at the put\'s, 12.35', () => {
    // the strike at which a call priced at 10.85 has a delta of ¼: K = F·exp(Z·σ√T + ½σ²T) with σ = 0.1085 (HAND 2)
    const call = 100 * Math.exp(Z75 * 0.1085 * Math.sqrt(T) + 0.5 * 0.1085 ** 2 * T)
    const put = 100 * Math.exp(-Z75 * 0.1235 * Math.sqrt(T) + 0.5 * 0.1235 ** 2 * T)
    // eight steps from the ATM, as the backend takes: on this steep a skew they land within 1e-9 of the wing, not on it
    expect(volAt(ps, T, 100, call)).toBeCloseTo(0.1085, 8)
    expect(volAt(ps, T, 100, put)).toBeCloseTo(0.1235, 8)
  })
  it('no skew at the expiry: the ATM, whatever the strike', () => {
    const flat = pillars({ '1M': { ATM: 10, RR25: 0, BF25: 0 }, '3M': { ATM: 12, RR25: 0, BF25: 0 } })
    expect(volAt(flat, T, 100, 60)).toBeCloseTo(0.11, 12)
    expect(volAt(pillars({ '1M': { ATM: 10 }, '3M': { ATM: 12 } }), T, 100, 160)).toBeCloseTo(0.11, 12)
  })
  it('stops after the iterations it is given', () => {
    // no step: the ATM. One step from the ATM at the forward: Δ = Φ(½·0.11·√T) = Φ(0.022454) = 0.508957,
    // so σ = 0.11 + 0.03·0.008957 + 0.096·0.008957² = 0.110276
    expect(volAt(ps, T, 100, 100, 0)).toBeCloseTo(0.11, 12)
    expect(volAt(ps, T, 100, 100, 1)).toBeCloseTo(0.110276, 6)
  })
  it('a missing surface, forward or strike: null', () => {
    expect(volAt([], T, 100, 100)).toBe(null)
    expect(volAt(ps, T, null, 100)).toBe(null)
    expect(volAt(ps, T, 100, -5)).toBe(null)
    expect(volAt(ps, NaN, 100, 100)).toBe(null)
  })
})

describe('surfaceReading: what the VOL SURFACE block states', () => {
  const surface = { valuation_date: '2026-11-09', source: 'MANUAL', label: 'MANUAL surface 2026-11-09', grid: GRID }
  const T = 2 / 12
  const quote = (o = {}) => ({ shape: 'OPTION', style: 'EUROPEAN', forward: 100, strike: 104, t_expiry: T, vol_tier: 'SURFACE', vol_snapshot: '2026-11-09', ...o })
  const read = volAt(pillars(GRID), T, 100, 104)
  it('reads the surface at the expiry and at the strike, and agrees with a quote priced on it', () => {
    const r = surfaceReading(quote({ vol_pct: Math.round(read * 1e6) / 1e4 }), surface)        // the API rounds the vol to four places of a point
    expect(r.at.atm).toBeCloseTo(0.11, 12)
    expect(r.surfaceVol).toBe(read)
    expect(r.diffPts).toBeLessThan(1e-4)
    expect(r.differs).toBe(false)
    expect(r.override).toBe(false)
    expect(r.hasStrike).toBe(true)
    expect(r.sameSurface).toBe(true)
    // the dot sits on the curve: the smile at the strike's delta is the quote's vol
    expect(smileVol(r.at.atm, r.at.rr, r.at.bf, r.delta)).toBeCloseTo(r.quoteVol, 6)
  })
  it('says when the reading and the quote disagree by more than the tolerance', () => {
    expect(READ_TOLERANCE_PTS).toBe(0.05)
    expect(surfaceReading(quote({ vol_pct: read * 100 + 0.04 }), surface).differs).toBe(false)
    const r = surfaceReading(quote({ vol_pct: read * 100 + 0.2 }), surface)
    expect(r.differs).toBe(true)
    expect(r.diffPts).toBeCloseTo(0.2, 9)
  })
  it('an override is off the curve and is not a disagreement', () => {
    const r = surfaceReading(quote({ vol_pct: 25, vol_tier: 'OVERRIDE' }), surface)
    expect(r.override).toBe(true)
    expect(r.differs).toBe(false)
    expect(r.quoteVol).toBe(0.25)
    expect(r.delta).toBeCloseTo(forwardCallDelta(100, 104, T, 0.25), 15)
  })
  it('a quote that carries no strike is read at the forward', () => {
    const r = surfaceReading(quote({ style: 'TOUCH', strike: null, vol_pct: 11 }), surface)
    expect(r.hasStrike).toBe(false)
    expect(r.atForward).toBe(true)
    expect(r.K).toBe(100)
    expect(r.surfaceVol).toBe(volAt(pillars(GRID), T, 100, 100))
  })
  it('a touch priced with a strike away from the forward is read at that strike, as the engine reads it', () => {
    // T 0.4, forward 104,250, strike 125,100 (1.2 × the forward) on a surface with a positive skew: the engine's vol is the
    // surface at the strike, a point or so above the surface at the forward, and the quote carries the K it used
    const grid = { '3M': { ATM: 53.5, RR25: 0.4, BF25: 2.3 }, '6M': { ATM: 56.0, RR25: 1.9, BF25: 2.8 } }
    const ps = pillars(grid)
    const atStrike = volAt(ps, 0.4, 104250, 125100), atForward = volAt(ps, 0.4, 104250, 104250)
    expect(Math.abs(atStrike - atForward) * 100).toBeGreaterThan(0.5)                    // the two readings are far apart
    const r = surfaceReading({ shape: 'OPTION', style: 'TOUCH', forward: 104250, strike: 125100, t_expiry: 0.4, vol_pct: Math.round(atStrike * 1e6) / 1e4, vol_tier: 'SURFACE' }, { grid })
    expect(r.hasStrike).toBe(true)
    expect(r.atForward).toBe(false)
    expect(r.K).toBe(125100)
    expect(r.surfaceVol).toBe(atStrike)
    expect(r.differs).toBe(false)                                                        // no warning on a correct quote
    expect(r.delta).toBeCloseTo(forwardCallDelta(104250, 125100, 0.4, r.quoteVol), 15)   // and the dot at the strike's delta
    expect(smileVol(r.at.atm, r.at.rr, r.at.bf, r.delta)).toBeCloseTo(r.quoteVol, 6)
  })
  it('a touch priced without a strike comes back with K at the forward: read there, and named as the forward', () => {
    const r = surfaceReading(quote({ style: 'TOUCH', strike: 100, vol_pct: 11 }), surface)
    expect(r.hasStrike).toBe(true)
    expect(r.atForward).toBe(true)
    expect(surfaceReading(quote({ style: 'EUROPEAN', strike: 100, vol_pct: 11 }), surface).atForward).toBe(false)
  })
  it('null without a usable surface or without what the quote must carry', () => {
    expect(surfaceReading(quote({ vol_pct: 11 }), null)).toBe(null)
    expect(surfaceReading(quote({ vol_pct: 11 }), { grid: { '1M': { RR25: 1 } } })).toBe(null)
    expect(surfaceReading(null, surface)).toBe(null)
    for (const key of ['forward', 't_expiry', 'vol_pct']) expect(surfaceReading(quote({ vol_pct: 11, [key]: null }), surface), key).toBe(null)
    expect(surfaceReading(quote({ vol_pct: 11, t_expiry: 0 }), surface)).toBe(null)
  })
  it('expiryWhere: on a tenor, between two, or held flat outside them', () => {
    const ps = pillars({ '1W': { ATM: 9, RR25: 1 }, ...GRID, '1Y': { ATM: 13, BF25: 0.5 } })
    expect(expiryWhere(ps, 1 / 12)).toBe('the 1M quotes')
    expect(expiryWhere(ps, 7 / 365)).toBe('the 1W quotes')
    expect(expiryWhere(ps, 2 / 12)).toBe('interpolated between 1M and 3M')
    expect(expiryWhere(ps, 0.6)).toBe('interpolated between 3M and 1Y')
    expect(expiryWhere(ps, 3 / 365)).toBe('before the first quoted tenor, 1W: held flat')
    expect(expiryWhere(ps, 1.5)).toBe('beyond the last quoted tenor, 1Y: held flat')
    expect(expiryWhere(pillars({ '3M': { ATM: 9 } }), 0.1)).toBe('before the first quoted tenor, 3M: held flat')
    expect(expiryWhere(pillars({ '3M': { ATM: 9 } }), 0.25)).toBe('the 3M quotes')
    expect(surfaceReading(quote({ vol_pct: 11 }), surface).where).toBe('interpolated between 1M and 3M')
  })
  it('expiryWhere: says so when the skew is read between other tenors than the ATM', () => {
    // 2M quotes an ATM alone: at 1.5 months the ATM runs 1M to 2M, the risk reversal and butterfly 1M to 3M
    const ps = pillars({ ...GRID, '2M': { ATM: 11 } })
    expect(expiryWhere(ps, 1.5 / 12)).toBe('interpolated between 1M and 2M; the risk reversal and butterfly interpolated between 1M and 3M')
    expect(expiryWhere(ps, 2 / 12)).toBe('the 2M quotes; the risk reversal and butterfly interpolated between 1M and 3M')
    expect(expiryWhere(ps, 1 / 12)).toBe('the 1M quotes')
    expect(expiryWhere(ps, 1)).toBe('beyond the last quoted tenor, 3M: held flat')
    expect(expiryWhere(pillars({ '1M': { ATM: 9 }, '3M': { ATM: 10 } }), 0.1)).toBe('interpolated between 1M and 3M')      // no smile at all: only the ATM is read
  })
  it('expiryWhere: null without pillars or a time', () => {
    expect(expiryWhere([], 0.5)).toBe(null)
    expect(expiryWhere(null, 0.5)).toBe(null)
    expect(expiryWhere(pillars(GRID), NaN)).toBe(null)
    expect(expiryWhere([{ t: 0.5, atm: 0.1, rr: 0, bf: 0, smile: false }], 0.5)).toBe(null)       // a pillar with no tenor name
  })
  it('pricedOnThis: the same snapshot date and, for a venue, the same marks', () => {
    const venue = { valuation_date: '2026-11-09', source: 'DEMO · Venue marks · 2026-11-09 12:57 UTC · listed to one year' }
    expect(pricedOnThis({ vol_snapshot: '2026-11-09', vol_marks: 'Venue marks · 2026-11-09 12:57 UTC · listed to one year' }, venue)).toBe(true)
    expect(pricedOnThis({ vol_snapshot: '2026-11-09', vol_marks: 'Venue marks · 2026-11-09 12:47 UTC · listed to one year' }, venue)).toBe(false)
    expect(pricedOnThis({ vol_snapshot: '2026-11-08', vol_marks: null }, surface)).toBe(false)
    expect(pricedOnThis({ vol_snapshot: '2026-11-09', vol_marks: null }, surface)).toBe(true)
    expect(pricedOnThis({}, surface)).toBe(true)                     // an older answer that names neither: nothing says otherwise
    expect(pricedOnThis(null, surface)).toBe(false)
    expect(pricedOnThis({}, null)).toBe(false)
  })
})

describe('what the charts draw', () => {
  const ps = pillars(GRID)
  it('shockedVol: the quote\'s vol moved by the slider\'s points, floored where the repricing floors it', () => {
    expect(shockedVol(0.11, 2.5)).toBeCloseTo(0.135, 12)
    expect(shockedVol(0.11, -0.25)).toBeCloseTo(0.1075, 12)
    expect(shockedVol(0.03, -5)).toBe(0.0001)
    expect(shockedVol(null, 1)).toBe(null)
    expect(shockedVol(0.11, NaN)).toBe(null)
  })
  it('termCurve: from zero to the horizon, through every tenor and the expiry, with the two wings', () => {
    const c = termCurve(ps, 0.5, [0.2])
    expect(c[0].t).toBe(0)
    expect(c[c.length - 1].t).toBe(0.5)
    for (const t of [1 / 12, 0.25, 0.2]) expect(c.some(p => p.t === t), String(t)).toBe(true)
    expect(c.every((p, i) => i === 0 || p.t > c[i - 1].t)).toBe(true)
    const at2m = termCurve(ps, 0.5, [2 / 12]).find(p => p.t === 2 / 12)
    expect(at2m.atm).toBeCloseTo(0.11, 12)
    expect(at2m.call).toBeCloseTo(0.1085, 12)                      // HAND 2
    expect(at2m.put).toBeCloseTo(0.1235, 12)
    expect(termCurve([], 0.5)).toBe(null)
    expect(termCurve(ps, 0)).toBe(null)
  })
  it('termCurve leaves out a tenor beyond the horizon', () => {
    expect(termCurve(ps, 0.1).some(p => p.t > 0.1)).toBe(false)
  })
  it('smileCurve: the quadratic from the low delta to the high one', () => {
    const c = smileCurve({ atm: 0.11, rr: -0.015, bf: 0.006 })
    expect(c).toHaveLength(41)
    expect(c[0].delta).toBe(0.1)
    expect(c[40].delta).toBeCloseTo(0.9, 12)
    expect(c[20].delta).toBeCloseTo(0.5, 12)
    expect(c[20].vol).toBeCloseTo(0.11, 12)
    expect(c[0].vol).toBeCloseTo(0.11336, 12)
    expect(smileCurve(null)).toBe(null)
    expect(smileCurve({ atm: 0.11, rr: null, bf: 0 })).toBe(null)
  })
  it('deltaRange: 0.10 to 0.90, widened to hold a strike beyond the wings', () => {
    expect(deltaRange(0.4)).toEqual({ lo: 0.1, hi: 0.9 })
    expect(deltaRange(0.1)).toEqual({ lo: 0.1, hi: 0.9 })
    expect(deltaRange(0.07)).toEqual({ lo: 0.05, hi: 0.9 })
    expect(deltaRange(0.004)).toEqual({ lo: 0, hi: 0.9 })
    expect(deltaRange(0.93)).toEqual({ lo: 0.1, hi: 0.95 })
    expect(deltaRange(1)).toEqual({ lo: 0.1, hi: 1 })
    expect(deltaRange(null)).toEqual({ lo: 0.1, hi: 0.9 })
  })
  it('volGeometry: a square-root time axis from the left edge', () => {
    const g = volGeometry({ width: 462, height: 220, xMax: 1, vMin: 5, vMax: 15, sqrt: true })
    const cw = 462 - VOL_PAD.l - VOL_PAD.r
    expect(g.xs(0)).toBe(VOL_PAD.l)
    expect(g.xs(1)).toBe(VOL_PAD.l + cw)
    expect(g.xs(0.25)).toBeCloseTo(VOL_PAD.l + cw / 2, 9)          // √¼ = ½
    expect(g.xs(9)).toBe(g.xs(1))                                  // held at the edge
    expect(g.ys(5)).toBe(g.bottom)
    expect(g.ys(15)).toBe(g.top)
    expect(g.ys(10)).toBeCloseTo((g.top + g.bottom) / 2, 9)
  })
  it('volGeometry: the delta axis runs from the high delta on the left to the low one on the right', () => {
    const g = volGeometry({ width: 462, height: 220, xMin: 0.1, xMax: 0.9, vMin: 5, vMax: 15, reverse: true })
    expect(g.xs(0.9)).toBe(g.left)
    expect(g.xs(0.1)).toBe(g.right)
    expect(g.xs(0.5)).toBeCloseTo((g.left + g.right) / 2, 9)
    expect(g.xs(0.25)).toBeGreaterThan(g.xs(0.75))                 // the 25-delta call (a high strike) to the right of the put
  })
  it('volGeometry: null without a size or a range', () => {
    const ok = { width: 462, height: 220, xMax: 1, vMin: 5, vMax: 15 }
    for (const key of ['width', 'height', 'xMax', 'vMin', 'vMax']) expect(volGeometry({ ...ok, [key]: null }), key).toBe(null)
    expect(volGeometry({ ...ok, vMax: 5 })).toBe(null)
    expect(volGeometry({ ...ok, xMax: 0 })).toBe(null)
    expect(volGeometry()).toBe(null)
  })
})

describe('shared vectors: backend/tests/vectors/fx_scenario.json', () => {
  const file = fileURLToPath(new URL('../../../../backend/tests/vectors/fx_scenario.json', import.meta.url))
  const vectors = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
  const REL = 1e-9
  // to 1e-9 of the expected figure; an expected zero is a zero
  const close = (got, want, what) => {
    expect(typeof got, what).toBe('number')
    expect(Math.abs(got - want), `${what}: ${got} against ${want}`).toBeLessThanOrEqual(REL * Math.abs(want))
  }
  const surfaces = vectors ? Object.fromEntries(Object.entries(vectors.vol_surfaces).map(([name, grid]) => [name, pillars(grid, vectors.tenor_years)])) : {}

  it.skipIf(vectors)('SKIPPED: backend/tests/vectors/fx_scenario.json is absent, so the browser is not checked against the backend here', () => {})
  it.skipIf(!vectors)('the file has enough cases of each kind', () => {
    expect(vectors.vol_interp.length).toBeGreaterThanOrEqual(12)
    expect(vectors.vol_at.length).toBeGreaterThanOrEqual(12)
    expect(vectors.smile_vol.length).toBeGreaterThan(0)
    expect(vectors.forward_delta.length).toBeGreaterThan(0)
    expect(Object.keys(vectors.vol_surfaces).length).toBeGreaterThanOrEqual(5)
    expect(Object.values(vectors.vol_pillars).some(ps => ps.length === 10)).toBe(true)            // the ten-tenor surface with 2W and 3W
    expect(Object.values(vectors.vol_pillars).some(ps => ps.some(p => !p.smile) && ps.some(p => p.smile))).toBe(true)
  })
  it.skipIf(!vectors)('TENOR_YEARS is the backend\'s map, to the last bit', () => {
    expect(TENOR_YEARS).toEqual(vectors.tenor_years)
  })
  it.skipIf(!vectors)('pillars gives the backend\'s parse_surface on every surface', () => {
    for (const [name, want] of Object.entries(vectors.vol_pillars)) {
      const got = pillars(vectors.vol_surfaces[name])                                             // on this module's own tenor map
      expect(got.length, name).toBe(want.length)
      got.forEach((p, i) => {
        expect(p.t, name).toBe(want[i].t)
        expect(p.smile, name).toBe(want[i].smile)
        for (const key of ['atm', 'rr', 'bf']) close(p[key], want[i][key], `${name} ${p.tenor} ${key}`)
      })
    }
  })
  it.skipIf(!vectors)('interpPillar gives the backend\'s _interp on every case', () => {
    for (const c of vectors.vol_interp) {
      const got = interpPillar(surfaces[c.surface], c.t)
      expect(got.smile, c.surface).toBe(c.expected.smile)
      for (const key of ['atm', 'rr', 'bf']) close(got[key], c.expected[key], `${c.surface} at ${c.t} ${key}`)
    }
  })
  it.skipIf(!vectors)('smileVol gives the backend\'s smile_vol on every case', () => {
    for (const c of vectors.smile_vol) close(smileVol(c.atm, c.rr, c.bf, c.call_delta), c.expected, `smile at ${c.call_delta}`)
  })
  it.skipIf(!vectors)('forwardCallDelta gives the backend\'s forward_delta on every case', () => {
    // Φ is ½·(1 + erf): far out of the money the sum cancels, so a delta of 1e-15 is only good to the last bit of a
    // double near 1. An absolute bound is the honest one here; the vol read off it is held to 1e-9 relative below.
    for (const c of vectors.forward_delta) {
      const got = forwardCallDelta(c.forward, c.strike, c.t, c.vol)
      expect(Math.abs(got - c.expected), `delta of ${c.strike} on ${c.forward}`).toBeLessThanOrEqual(1e-14)
    }
  })
  it.skipIf(!vectors)('volAt gives the backend\'s vol_at on every case', () => {
    for (const c of vectors.vol_at) close(volAt(surfaces[c.surface], c.t, c.forward, c.strike), c.expected, `${c.surface} T ${c.t} K ${c.strike}`)
  })
})

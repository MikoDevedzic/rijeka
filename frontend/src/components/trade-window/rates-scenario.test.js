import { describe, it, expect } from 'vitest'
import { CURVE_BOUND_BP, LADDER, NO_SHOCK, capSmile, capTerm, curveIds, curvePoints, curveQuotes, figures, hasVol, isBermudan, horizon, isShocked, scenarioPayload, shockAtPoint, shockAtTime,
  shockSaid, spread, swaptionAcross, swaptionTerm, tenorYears, wanted, withFlat, withOwn } from './rates-scenario'

const QUOTES = [{ tenor: 'ON', quote_type: 'OISDeposit', rate: 3.88, enabled: true }, { tenor: '1Y', quote_type: 'OIS', rate: 3.7 }, { tenor: '3M', quote_type: 'OIS', rate: 3.85 },
  { tenor: '2Y', rate: 3.6 }, { tenor: '5Y', rate: 3.65 }, { tenor: '7Y', rate: 3.72 }, { tenor: '10Y', rate: 3.8 }, { tenor: '30Y', rate: 4.0 },
  { tenor: '4Y', rate: 3.62, enabled: false }, { tenor: '5Y', rate: 9.99 }, { tenor: 'IMM1', rate: 3.9 }, { tenor: '15Y', rate: null }]

describe('the points of a curve', () => {
  it('reads a tenor in years', () => {
    expect(tenorYears('ON')).toBeCloseTo(1 / 365); expect(tenorYears('1w')).toBeCloseTo(7 / 365); expect(tenorYears('18M')).toBe(1.5)
    expect(tenorYears(' 2Y ')).toBe(2); expect(tenorYears('IMM1')).toBe(null); expect(tenorYears(null)).toBe(null)
  })
  it('one quote a tenor, in order of time, without what is switched off, unreadable or said twice', () => {
    expect(curveQuotes(QUOTES).map(p => p.id)).toEqual(['ON', '3M', '1Y', '2Y', '5Y', '7Y', '10Y', '30Y'])
    expect(curveQuotes(QUOTES).find(p => p.id === '5Y').v).toBe(3.65)
  })
  it('shows a curve at the tenors a desk reads it at; one that quotes few of them, at every quote it has', () => {
    const dense = ['ON', '1W', '2W', '1M', '2M', '3M', '6M', '9M', '1Y', '18M', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '10Y'].map((tenor, i) => ({ tenor, rate: 3 + i / 100 }))
    expect(curveQuotes(dense).length).toBe(18)
    expect(curvePoints(dense).map(p => p.id)).toEqual(['ON', '1M', '3M', '6M', '1Y', '2Y', '3Y', '4Y', '5Y', '7Y', '10Y'])
    expect(curvePoints(dense, 5).map(p => p.id)).toEqual(['ON', '1M', '3M', '6M', '1Y', '2Y', '3Y', '4Y', '5Y', '7Y', '10Y'])
    expect(curvePoints(dense, 2).map(p => p.id)).toEqual(['ON', '1M', '3M', '6M', '1Y', '2Y', '3Y', '4Y'])
    const odd = ['2W', '2M', '9M', '18M', '6Y'].map((tenor, i) => ({ tenor, rate: 3 + i / 100 }))
    expect(curvePoints(odd).map(p => p.id)).toEqual(['2W', '2M', '9M', '18M', '6Y'])
  })
  it('carries a point\'s shock to the quotes around it, on the line to the next point', () => {
    const dense = ['1Y', '18M', '2Y', '3Y', '4Y', '5Y', '6Y', '7Y', '8Y', '10Y'].map((tenor, i) => ({ tenor, rate: 3 + i / 100 }))
    const all = curveQuotes(dense), shown = all.filter(p => ['1Y', '2Y', '5Y', '7Y', '10Y'].includes(p.id))
    expect(spread({ flat: 10, own: { '5Y': 6 } }, shown, all)).toEqual({ flat: 10, own: { '3Y': 2, '4Y': 4, '5Y': 6, '6Y': 3 } })
    expect(spread({ flat: 10, own: {} }, shown, all)).toEqual({ flat: 10, own: {} })
    expect(spread({ flat: 0, own: { '10Y': -4 } }, shown, all).own).toEqual({ '8Y': -1.333333, '10Y': -4 })
    expect(spread(NO_SHOCK, shown, all)).toEqual({ flat: 0, own: {} })
  })
  it('shows the points up to the trade\'s last date and the two after', () => {
    expect(curvePoints(QUOTES, 5).map(p => p.id)).toEqual(['ON', '3M', '1Y', '2Y', '5Y', '7Y', '10Y'])
    expect(curvePoints(QUOTES, 4).map(p => p.id)).toEqual(['ON', '3M', '1Y', '2Y', '5Y', '7Y', '10Y'])
    expect(curvePoints(QUOTES, 0.5).map(p => p.id)).toEqual(['ON', '3M', '1Y', '2Y', '5Y'])
    expect(curvePoints(QUOTES, 50).length).toBe(8)
    expect(curvePoints([], 5)).toEqual([]); expect(curvePoints(null)).toEqual([])
  })
})

const CAPS = [1, 2, 5].flatMap(t => [-100, 0, 100].map(s => ({ cap_tenor_y: t, strike_spread_bp: s, flat_vol_bp: 80 + t + Math.abs(s) / 50, is_atm: s === 0 })))
const SWVOL = [['1Yx1Y', 98.4], ['1Yx5Y', 93.0], ['2Yx5Y', 90.0], ['5Yx5Y', 82.5], ['1Yx10Y', 88.0], ['bad', 1], ['3Mx5Y', 95.5]].map(([tenor, rate]) => ({ tenor, rate, quote_type: 'SWVOL', enabled: true }))

describe('the points of a vol surface', () => {
  it('a cap surface: its at-the-money vols by maturity, and the smile at the maturity nearest the trade\'s', () => {
    expect(capTerm(CAPS)).toEqual([{ id: '1Y', t: 1, v: 81, label: '1Y' }, { id: '2Y', t: 2, v: 82, label: '2Y' }, { id: '5Y', t: 5, v: 85, label: '5Y' }])
    expect(capSmile(CAPS, 4).map(p => [p.label, p.v])).toEqual([['−100', 87], ['ATM', 85], ['+100', 87]])
    expect(capTerm([])).toEqual([]); expect(capSmile(CAPS, null)).toEqual([])
  })
  it('a swaption surface: across expiries at the swap tenor nearest the trade\'s, and across swap tenors at its expiry', () => {
    const term = swaptionTerm(SWVOL, 4)
    expect(term.tenor).toBe('5Y')
    expect(term.points.map(p => [p.id, p.t, p.v])).toEqual([['3M', 0.25, 95.5], ['1Y', 1, 93], ['2Y', 2, 90], ['5Y', 5, 82.5]])
    const across = swaptionAcross(SWVOL, 1.2)
    expect(across.expiry).toBe('1Y')
    expect(across.points.map(p => [p.id, p.v])).toEqual([['1Y', 98.4], ['5Y', 93], ['10Y', 88]])
    expect(swaptionTerm([], 5).points).toEqual([])
  })
})

describe('a shock', () => {
  const pts = [{ id: '1Y', t: 1 }, { id: '2Y', t: 2 }, { id: '5Y', t: 5 }]
  it('is the flat shock and the point\'s own; between two points it is read on the line between them', () => {
    const s = { flat: 10, own: { '2Y': 6, '5Y': -3 } }
    expect(shockAtPoint(s, pts[0])).toBe(10); expect(shockAtPoint(s, pts[1])).toBe(16)
    expect(shockAtTime(s, pts, 0.5)).toBe(10); expect(shockAtTime(s, pts, 1.5)).toBe(13); expect(shockAtTime(s, pts, 2)).toBe(16)
    expect(shockAtTime(s, pts, 3)).toBe(13); expect(shockAtTime(s, pts, 9)).toBe(7)
    expect(shockAtTime(NO_SHOCK, pts, 3)).toBe(0); expect(shockAtTime(s, [], 3)).toBe(10); expect(shockAtTime(s, pts, null)).toBe(10)
  })
  it('says what was done, and knows nothing from something', () => {
    expect(shockSaid(NO_SHOCK)).toBe('—'); expect(shockSaid({ flat: 10, own: {} })).toBe('+10bp'); expect(shockSaid({ flat: -2.5, own: { a: 1, b: 0 } })).toBe('−2.5bp · 1 point')
    expect(shockSaid({ flat: 0, own: { a: 1, b: -2 } })).toBe('2 points')
    expect(isShocked(NO_SHOCK)).toBe(false); expect(isShocked({ flat: 0, own: { a: 0 } })).toBe(false); expect(isShocked({ flat: 0, own: { a: 1 } })).toBe(true)
  })
  it('keeps the whole shock within the bound, and forgets a point moved back to nothing', () => {
    expect(withOwn({ flat: 250, own: {} }, '5Y', 100, CURVE_BOUND_BP)).toEqual({ flat: 250, own: { '5Y': 50 } })
    expect(withOwn({ flat: 0, own: { '5Y': 9 } }, '5Y', 0, CURVE_BOUND_BP)).toEqual({ flat: 0, own: {} })
    expect(withFlat({ flat: 0, own: { '5Y': 200 } }, 250, CURVE_BOUND_BP)).toEqual({ flat: 250, own: { '5Y': 50 } })
    expect(withFlat({ flat: 0, own: {} }, -999, CURVE_BOUND_BP)).toEqual({ flat: -300, own: {} })
  })
})

const SWAP = { legs: [{ maturity_date: '2031-11-04' }, { maturity_date: '2031-11-04' }], valuation_date: '2026-11-02', curves: [{ curve_id: 'USD_SOFR', quotes: [] }] }
const CAP = { notional: 1e7, tenor_y: 5, cap_rate: 0.04, curve_id: 'USD_SOFR', valuation_date: '2026-11-02' }
const SWPN = { notional: 1e7, expiry_y: 1, tenor_y: 5, vol_bp: 86.5, curve_id: 'USD_SOFR', valuation_date: '2026-11-02' }

describe('the request of a scenario', () => {
  it('with nothing shocked is the ticket\'s request, field for field', () => {
    expect(scenarioPayload('IR_SWAP', SWAP, {}, 0)).toEqual(SWAP)
    expect(scenarioPayload('RATES_CAP', CAP, { USD_SOFR: NO_SHOCK }, 0)).toEqual(CAP)
    expect(scenarioPayload('IR_SWAPTION', SWPN, { USD_SOFR: { flat: 0, own: { '5Y': 0 } } }, 0)).toEqual(SWPN)
  })
  it('carries a curve\'s shock to the curve it is on, and the vol\'s to the trade', () => {
    const shock = { flat: 10, own: { '5Y': 5, '7Y': 0 } }
    expect(scenarioPayload('IR_SWAP', SWAP, { USD_SOFR: shock }).curves).toEqual([{ curve_id: 'USD_SOFR', quotes: [], shift_flat_bp: 10, shift_bp: { '5Y': 5 } }])
    expect(scenarioPayload('RATES_CAP', CAP, { USD_SOFR: shock }, -3)).toEqual({ ...CAP, curve_flat_bp: 10, curve_shift_bp: { '5Y': 5 }, vol_shift_bp: -3 })
    expect(scenarioPayload('RATES_COLLAR', { ...CAP, floor_rate: 0.03 }, {}, 4).vol_shift_bp).toBe(4)
    expect(scenarioPayload('IR_SWAPTION', SWPN, {}, 4)).toEqual({ ...SWPN, vol_shift_bp: 4 })          // the vol as typed stays as typed
  })
  it('knows the trade: its curves, whether it has a vol, how far it runs', () => {
    expect(curveIds(SWAP)).toEqual(['USD_SOFR']); expect(curveIds(CAP)).toEqual(['USD_SOFR'])
    expect(curveIds({ curves: [{ curve_id: 'A' }, { curve_id: 'B' }, { curve_id: 'A' }] })).toEqual(['A', 'B'])
    expect(curveIds({ curve_id: 'EUR_ESTR', curves: [{ curve_id: 'USD_SOFR' }] })).toEqual(['EUR_ESTR'])          // an option names its own curve
    // a swaption's request that names no curve is shocked on the one the ticket sends with it
    const bare = { expiry_y: 1, tenor_y: 5, vol_bp: 86.5, curves: [{ curve_id: 'USD_SOFR', quotes: [] }] }
    expect(scenarioPayload('IR_SWAPTION', bare, { USD_SOFR: { flat: 10, own: {} } })).toMatchObject({ curve_flat_bp: 10, curve_shift_bp: {} })
    expect(hasVol('IR_SWAP')).toBe(false); expect(hasVol('RATES_FLOOR')).toBe(true); expect(hasVol('IR_SWAPTION')).toBe(true); expect(hasVol('FX_FORWARD')).toBe(false)
    // a Bermudan is an option too: its vol is the tree's own σ, shocked flat (isBermudan tells the tab which vol it is)
    expect(isBermudan('IR_SWAPTION', { structure: 'bermudan' })).toBe(true); expect(isBermudan('IR_SWAPTION', { structure: 'EUROPEAN' })).toBe(false); expect(isBermudan('RATES_CAP', { structure: 'BERMUDAN' })).toBe(false)
    expect(horizon('IR_SWAP', SWAP).through).toBeCloseTo(5.0, 1)
    expect(horizon('RATES_CAP', CAP)).toEqual({ through: 5, expiry: 5 })
    expect(horizon('IR_SWAPTION', SWPN)).toEqual({ through: 6, expiry: 1, tenor: 5 })
  })
  it('names an answer\'s figures one way, whichever route gave it', () => {
    expect(figures('IR_SWAP', { npv: 12.5, ir01: 4600 })).toMatchObject({ npv: 12.5, ir01: 4600, vega: null, vol: null })
    expect(figures('RATES_CAP', { npv: 232137, ir01: 2315, vega: 2578, vol_bp: 78.5 })).toMatchObject({ npv: 232137, vega: 2578, vol: 78.5 })
    expect(figures('RATES_COLLAR', { net_npv: -61702, net_ir01: 2067, net_vega: 900, cap_vol_bp: 80, floor_vol_bp: 90, npv: 1 })).toMatchObject({ npv: -61702, ir01: 2067, vega: 900, vol: null, capVol: 80, floorVol: 90 })
    expect(figures('IR_SWAPTION', { npv: 1, vol_bp: 86.5, sabr_vol_bp: 91.2, is_sabr_vol: true }).vol).toBe(91.2)          // away from the money: the surface's
    expect(figures('IR_SWAPTION', { npv: 1, vol_bp: 86.5, sabr_vol_bp: null, is_sabr_vol: false }).vol).toBe(86.5)
    expect(figures('RATES_CAP', null)).toBe(null)
  })
})

describe('the prices a scenario asks for', () => {
  const factors = [{ key: 'USD_SOFR', kind: 'curve' }, { key: 'vol', kind: 'vol' }]
  const volAt = (s) => (Number(s?.flat) || 0)
  it('with nothing shocked: the market, and a ladder around it; nothing asked twice', () => {
    const w = wanted('RATES_CAP', CAP, factors, {}, 'USD_SOFR', volAt)
    expect(w.bodies.market).toEqual(CAP)
    expect(w.same).toMatchObject({ all: 'market', 'only:USD_SOFR': 'market', 'only:vol': 'market' })
    expect(Object.keys(w.bodies).filter(k => k.startsWith('ladder:')).length).toBe(LADDER.curve.length - 1)
    expect(w.bodies['ladder:10']).toEqual({ ...CAP, curve_flat_bp: 10, curve_shift_bp: {} })
  })
  it('with the curve and the vol shocked: each alone, both together, and the ladder on top of both', () => {
    const shocks = { USD_SOFR: { flat: 10, own: {} }, vol: { flat: 5, own: {} } }
    const w = wanted('RATES_CAP', CAP, factors, shocks, 'vol', volAt)
    expect(w.bodies['only:USD_SOFR']).toEqual({ ...CAP, curve_flat_bp: 10, curve_shift_bp: {} })
    expect(w.bodies['only:vol']).toEqual({ ...CAP, vol_shift_bp: 5 })
    expect(w.bodies.all).toEqual({ ...CAP, curve_flat_bp: 10, curve_shift_bp: {}, vol_shift_bp: 5 })
    expect(w.bodies['ladder:-5']).toBe(undefined)          // the vol back at the market, the curve still moved: the curve-alone price, not asked again
    expect(w.bodies['ladder:10']).toEqual({ ...CAP, curve_flat_bp: 10, curve_shift_bp: {}, vol_shift_bp: 15 })
    expect(w.same['ladder:-5']).toBe('only:USD_SOFR')
  })
  it('a swap has no vol and one price a shock', () => {
    const w = wanted('IR_SWAP', SWAP, [{ key: 'USD_SOFR', kind: 'curve' }], { USD_SOFR: { flat: 25, own: {} } }, 'USD_SOFR', volAt)
    expect(w.same.all).toBe(undefined); expect(w.same['only:USD_SOFR']).toBe('all')
    expect(w.bodies.all.curves[0]).toMatchObject({ shift_flat_bp: 25 })
  })
})

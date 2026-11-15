// The trader's home: what it works out from the risk report, the trades and the P&L summary.
import { describe, expect, it } from 'vitest'
import { BUCKETS, maturityBucket, bucketReach, spotMeasure, factors, peak, lanes, canDay, heights, carry, staleness, limitLabel, limitMarks, standing, factorLimits, limitsOf, shownOn, against, scene, canLimit, columns, laneMarks, markFigure, MATERIAL, signedShort, laneFigures, figureAt, LIMIT_MAX, statement, moved, signed, MAX_LANES } from './trader-home'

const TRADES = [{ id: 't1', maturity_date: '2027-02-13' }, { id: 't2', maturity_date: '2030-11-13' }, { id: 't3', maturity_date: '2026-12-13' }]
const REP = {
  date: '2026-11-13',
  ladder: {
    ladder: [{ curve: 'USD_SOFR', buckets: { '0-1Y': 100, '1-5Y': 4000, '5-10Y': -2400, '10Y+': 0 }, total: 1700 },
             { curve: 'EUR_ESTR', buckets: { '0-1Y': 0, '1-5Y': 0, '5-10Y': 0, '10Y+': 0 }, total: 0 }],
    spot01: { BTC: 22900, EUR: 71810 },
    crybasis01: { BTC_FUNDING: -1460 },
    vega: [{ curve: 'USD_SWVOL_ATM', buckets: { '0-1Y': 0, '1-5Y': 4200, '5-10Y': 0, '10Y+': 0 }, total: 4200 }],
  },
  ladder_rows: [
    { trade_id: 't1', usd_rate: 1, kr01: {}, spot01: { BTC: 18300 }, crybasis01: { BTC_FUNDING: { FLAT: -1150 } }, vega: {} },
    { trade_id: 't2', usd_rate: 1, kr01: {}, spot01: { BTC: 4600 }, crybasis01: { BTC_FUNDING: { '1-5Y': -310 } }, vega: {} },
    { trade_id: 't3', usd_rate: 1.07, kr01: {}, spot01: { EUR: 67112.149533 }, crybasis01: {}, vega: {} },      // in EUR; 1.07 to the dollar
    { trade_id: 'gone', kr01: {}, spot01: { BTC: 999 }, crybasis01: {}, vega: {} },                              // no rate to the dollar: left out, as the book total leaves it out
  ],
  moves: { stdev: { USD_SOFR: { '0-1Y': 3, '1-5Y': 5, '5-10Y': 5.5, '10Y+': 5 }, BTC_SPOT: { SPOT: 3.1 }, EUR_SPOT: { SPOT: 0.45 }, USD_SWVOL_ATM: { '1-5Y': 120 } } },
}

describe("the trader's home: a trade's place along the tenor", () => {
  it('keeps a ticket of a round tenor in the bucket that holds that tenor\'s quote: the anniversary, and a week for spot and a roll', () => {
    const from = '2026-11-13'
    expect(maturityBucket('2036-11-13', from), 'ten years to the day (3,653 days: 10.0014 years of 365.25)').toBe('5-10Y')
    expect(maturityBucket('2036-11-19', from), 'ten years from spot, rolled over a weekend').toBe('5-10Y')
    expect(maturityBucket('2036-11-20', from), 'the last day of grace').toBe('5-10Y')
    expect(maturityBucket('2036-11-21', from)).toBe('10Y+')
    expect(maturityBucket('2027-11-15', from), 'one year, rolled off a Saturday (367 days)').toBe('0-1Y')
    expect(maturityBucket('2028-03-01', '2027-03-01'), 'one year across a leap day (366 days)').toBe('0-1Y')
    expect(maturityBucket('2031-11-17', from), 'five years from spot').toBe('1-5Y')
    expect(maturityBucket('2031-11-21', from)).toBe('5-10Y')
    expect(maturityBucket('2031-11-17T00:00:00Z', '2026-11-13T09:30:00Z'), 'a timestamp is read by its date').toBe('1-5Y')
  })
  it('places a maturity from the report\'s date, and a past or unreadable one at the near end', () => {
    expect(maturityBucket('2027-02-13', '2026-11-13')).toBe('0-1Y')
    expect(maturityBucket('2030-11-13', '2026-11-13')).toBe('1-5Y')
    expect(maturityBucket('2040-01-01', '2026-11-13')).toBe('10Y+')
    expect(maturityBucket('2026-01-01', '2026-11-13')).toBe('0-1Y')
    expect(maturityBucket(null, '2026-11-13')).toBe('0-1Y')
    expect(bucketReach('2026-11-13')).toEqual(['to 2027', 'to 2031', 'to 2036', 'after 2036'])
  })
})

describe("the trader's home: the risk factors", () => {
  const list = factors(REP, TRADES)
  const by = Object.fromEntries(list.map(f => [f.key, f]))
  it('is one entry per factor the book carries, rates first, and leaves out a curve with nothing on it', () => {
    expect(list.map(f => f.key)).toEqual(['IR:USD_SOFR', 'SPOT:EUR', 'SPOT:BTC', 'BASIS:BTC_FUNDING', 'VEGA:USD_SWVOL_ATM'])
    expect(by['IR:USD_SOFR']).toMatchObject({ name: 'USD SOFR', measure: 'IR01', factor: 'ir', unit: 'per bp', v: [100, 4000, -2400, 0], total: 1700 })
  })
  it('names a spot delta by what it is on', () => {
    expect(spotMeasure('EUR')).toEqual(['fx', 'FX01']); expect(spotMeasure('BTC')).toEqual(['cry', 'CRY01']); expect(spotMeasure('SOL')).toEqual(['cry', 'CRY01'])
    expect(by['SPOT:BTC']).toMatchObject({ measure: 'CRY01', factor: 'cry' }); expect(by['SPOT:EUR']).toMatchObject({ measure: 'FX01', factor: 'fx' })
  })
  it('draws a spot delta at the maturity of the trade that carries it, in dollars, and adds up to the book\'s total', () => {
    expect(by['SPOT:BTC'].v).toEqual([18300, 4600, 0, 0])
    expect(by['SPOT:BTC'].total).toBe(22900)                              // the row with no rate to the dollar is not in it
    expect(by['SPOT:EUR'].v[0]).toBeCloseTo(71810, 3)
    expect(by['SPOT:EUR'].total).toBeCloseTo(REP.ladder.spot01.EUR, 3)
  })
  it('puts a flat funding curve\'s one bucket at the trade\'s maturity and keeps a bucketed one where it is', () => {
    expect(by['BASIS:BTC_FUNDING']).toMatchObject({ name: 'BTC', measure: 'CRYBASIS01', v: [-1150, -310, 0, 0], total: -1460, move: null, hasDay: false })
  })
  it('multiplies each bucket by its factor\'s usual daily move, in the unit the sensitivity is per', () => {
    expect(by['IR:USD_SOFR'].day).toEqual([300, 20000, -13200, 0])       // per bp × bp
    expect(by['SPOT:BTC'].day.map(x => Math.round(x))).toEqual([56730, 14260, 0, 0])   // per 1% × 3.1%
    expect(by['VEGA:USD_SWVOL_ATM'].day).toEqual([0, 5040, 0, 0])        // per bp of vol × 1.2bp (the report says 120 hundredths)
    expect(by['VEGA:USD_SWVOL_ATM']).toMatchObject({ name: 'USD swaptions', unit: 'per bp of vol' })
    expect(list.filter(f => f.hasDay).map(f => f.key)).toEqual(['IR:USD_SOFR', 'SPOT:EUR', 'SPOT:BTC', 'VEGA:USD_SWVOL_ATM'])
  })
  it('says where a factor is largest on a usual day', () => {
    expect(peak(by['IR:USD_SOFR'])).toEqual({ bucket: '1-5Y', usd: 20000 })
    expect(peak(by['BASIS:BTC_FUNDING'])).toBe(null)
  })
  it('has no money scale where a bucket with risk has no history, and none at all without the report\'s moves', () => {
    const short = factors({ ...REP, moves: { stdev: { USD_SOFR: { '1-5Y': 5 } } } }, TRADES)
    expect(short.find(f => f.key === 'IR:USD_SOFR').hasDay).toBe(false)   // 0-1Y and 5-10Y carry risk and have no move
    const none = factors({ ...REP, moves: undefined }, TRADES)
    expect(canDay(none)).toBe(false); expect(canDay(list)).toBe(true)
    expect(factors(null)).toEqual([]); expect(factors({ ladder: {} })).toEqual([])
  })
  it('gives a flat curve no usual move, as the VaR gives it none, and places its one bucket at the trade\'s maturity', () => {
    const rep = { date: '2026-11-13', ladder: { ladder: [{ curve: 'CHF_SARON', buckets: { '0-1Y': 0, '1-5Y': 0, '5-10Y': 0, '10Y+': 0, FLAT: 900 }, total: 900 }] },
                  ladder_rows: [{ trade_id: 't2', usd_rate: 1, kr01: { CHF_SARON: { FLAT: 900 } }, spot01: {} }], moves: { stdev: { CHF_SARON: { '1-5Y': 4 } } } }
    const [f] = factors(rep, TRADES)
    expect(f).toMatchObject({ v: [0, 900, 0, 0], move: null, day: null, hasDay: false })
  })
  it('does not count as placed what sits in a bucket the picture does not have: the total is still drawn', () => {
    const rep = { date: '2026-11-13', ladder: { crybasis01: { BTC_FUNDING: -500 } }, ladder_rows: [{ trade_id: 't1', usd_rate: 1, crybasis01: { BTC_FUNDING: { '3M': -500 } } }], moves: { stdev: {} } }
    expect(factors(rep, TRADES)[0].v).toEqual([-500, 0, 0, 0])
  })
  it('adds up one day\'s carry from the trades the report valued, in dollars', () => {
    expect(carry({ ladder_rows: [{ usd_rate: 1, theta: 128 }, { usd_rate: 1.07, theta: -100 }, { theta: 999 }, { usd_rate: 1, theta: null }] })).toBeCloseTo(21, 9)
    expect(carry({ ladder_rows: [{ usd_rate: 1 }] })).toBe(null); expect(carry(null)).toBe(null)
  })
  it('draws a total at the near end when the report has no rows to place it by', () => {
    const f = factors({ ...REP, ladder_rows: [] }, TRADES).find(x => x.key === 'SPOT:BTC')
    expect(f.v).toEqual([22900, 0, 0, 0])
  })
})

describe("the trader's home: a stored report that is not the book as it stands", () => {
  const live = (id, at = '2026-11-13T10:00:00Z') => ({ id, trade_ref: `TRD-${id}`, status: 'CONFIRMED', created_at: at })
  const rep = { date: '2026-11-13', generated_at: '2026-11-13T12:00:00Z', moves: null, fixings: null, ladder: { problems: [{ trade_ref: 'TRD-3' }] }, ladder_rows: [{ trade_id: 1 }, { trade_id: 2 }] }
  it('is the book when every live trade is in it or named as one it could not value', () => {
    expect(staleness(rep, [live(1), live(2), live(3), { id: 9, status: 'CANCELLED', created_at: '2026-11-13T13:00:00Z' }], '2026-11-13')).toBe(null)
    expect(staleness(null, [live(1)])).toBe(null)
  })
  it('is not the book when a live trade is missing from it, when it values one that is no longer live, or when one was booked after it', () => {
    expect(staleness(rep, [live(1), live(2), live(4)])).toBe('book')
    expect(staleness(rep, [live(1)])).toBe('book')
    expect(staleness({ ...rep, ladder_rows: [{ trade_id: 1 }] }, [live(1, '2026-11-13T12:00:01Z')])).toBe('book')
  })
  it('is behind the market when the curves have a later date, and older when it was stored before it carried the moves', () => {
    expect(staleness(rep, [live(1), live(2)], '2026-11-14')).toBe('market')
    expect(staleness({ ...rep, moves: undefined }, [live(1), live(2)])).toBe('older')
    expect(staleness({ ...rep, fixings: undefined }, [live(1), live(2)]), 'stored before the report carried the fixings').toBe('older')
  })
})

describe("the trader's home: a stream's height", () => {
  const list = factors(REP, TRADES)
  it('is one scale for every factor on the money scale, the largest bucket a full lane', () => {
    const h = heights(list, 'day'), i = list.findIndex(f => f.key === 'SPOT:BTC'), j = list.findIndex(f => f.key === 'IR:USD_SOFR')
    expect(h[i].h[0]).toBeCloseTo(1, 9)                                    // 56,730 a day is the largest bucket on the page
    expect(h[j].h[1]).toBeCloseTo(Math.sqrt(20000 / 56730), 9)
    expect(h[j].h[2]).toBeCloseTo(-Math.sqrt(13200 / 56730), 9)            // short is below the line
    expect(h[i].own).toBe(false)
  })
  it('keeps a factor with no history to its own scale and says so', () => {
    const h = heights(list, 'day'), k = list.findIndex(f => f.key === 'BASIS:BTC_FUNDING')
    expect(h[k].own).toBe(true); expect(h[k].h[0]).toBeCloseTo(-1, 9); expect(h[k].h[1]).toBeCloseTo(-Math.sqrt(310 / 1150), 9)
  })
  it('is each factor to its own scale per 01', () => {
    const h = heights(list, 'raw')
    for (const x of h) { expect(Math.max(...x.h.map(Math.abs))).toBeCloseTo(1, 9); expect(x.own).toBe(false) }
  })
  it('draws the largest when there are more factors than lanes, and names the rest', () => {
    const many = Array.from({ length: MAX_LANES + 2 }, (_, i) => ({ key: `k${i}`, factor: 'ir', name: `C${i}`, measure: 'IR01', total: i + 1, v: [i + 1, 0, 0, 0], day: [(i + 1) * 10, 0, 0, 0], hasDay: true }))
    const { drawn, rest } = lanes(many)
    expect(drawn).toHaveLength(MAX_LANES); expect(rest.map(f => f.key)).toEqual(['k0', 'k1'])
    expect(lanes(many.slice(0, 3)).rest).toEqual([])
  })
})

// A book with a two-year position against a five-year one on USD SOFR (they net in the 1-5Y bucket), a little risk
// at the quotes before them, a ten-year position, a swaption grid's vega at one expiry, and a spot delta.
const POINTS_REP = {
  date: '2026-11-13',
  ladder: {
    ladder: [{ curve: 'USD_SOFR', buckets: { '0-1Y': -5, '1-5Y': 1500, '5-10Y': 2000, '10Y+': 0 }, total: 3495,
               points: [{ tenor: '6M', years: 0.5, bucket: '0-1Y', value: 9.5 }, { tenor: '1Y', years: 1, bucket: '0-1Y', value: -14.4 },
                        { tenor: '2Y', years: 2, bucket: '1-5Y', value: -3000 }, { tenor: '3Y', years: 3, bucket: '1-5Y', value: 0.2 },
                        { tenor: '5Y', years: 5, bucket: '1-5Y', value: 4500 }, { tenor: '10Y', years: 10, bucket: '5-10Y', value: 2000 }] }],
    spot01: { BTC: 22900 },
    vega: [{ curve: 'USD_SWVOL_ATM', buckets: { '0-1Y': 0, '1-5Y': 4200, '5-10Y': 0, '10Y+': 0 }, total: 4200, points: [{ tenor: '5Y', years: 5, bucket: '1-5Y', value: 4200 }] }],
  },
  ladder_rows: [{ trade_id: 't1', usd_rate: 1, kr01: {}, spot01: { BTC: 22900 }, vega: {} }],
  moves: { stdev: { USD_SOFR: { '0-1Y': 3, '1-5Y': 5, '5-10Y': 5.5, '10Y+': 5 }, BTC_SPOT: { SPOT: 3.1 } } },
}

describe("the trader's home: a curve's risk at each quoted tenor", () => {
  const list = factors(POINTS_REP, TRADES), sofr = list.find(f => f.key === 'IR:USD_SOFR'), btc = list.find(f => f.key === 'SPOT:BTC'), vol = list.find(f => f.key === 'VEGA:USD_SWVOL_ATM')
  it('reads the points of a curve and of a surface, each with its bucket and what a usual day moves it by', () => {
    expect(sofr.pts.map(p => [p.tenor, p.i, p.x, p.day])).toEqual([['6M', 0, 9.5, 28.5], ['1Y', 0, -14.4, -43.2], ['2Y', 1, -3000, -15000], ['5Y', 1, 4500, 22500], ['10Y', 2, 2000, 11000]])
    expect(vol.pts.map(p => [p.tenor, p.i, p.x, p.day])).toEqual([['5Y', 1, 4200, null]])          // no usual move measured for the surface
    expect(btc.pts).toBeUndefined()                                                                  // a spot delta has no tenor of its own
    expect(factors(REP, TRADES).find(f => f.key === 'IR:USD_SOFR').pts).toEqual([])                  // an older stored report: none
  })
  it('gives a column to each tenor that matters to some factor, nearest first, and one to a bucket with none', () => {
    const cols = columns(list)
    expect(MATERIAL).toBe(0.03)
    // 6M and 1Y are under 3% of the curve's largest point (4,500) and get no column; the bucket still has its one
    expect(cols.slots).toEqual([{ i: 0, tenor: null }, { i: 1, tenor: '2Y' }, { i: 1, tenor: '5Y' }, { i: 2, tenor: '10Y' }, { i: 3, tenor: null }])
    expect(cols.groups).toEqual([{ i: 0, from: 0, to: 1 }, { i: 1, from: 1, to: 3 }, { i: 2, from: 3, to: 4 }, { i: 3, from: 4, to: 5 }])
    expect(columns(factors(REP, TRADES)).slots).toEqual(BUCKETS.map((_, i) => ({ i, tenor: null })))      // no points: the four buckets, as before
  })
  it('draws a point in its tenor\'s column, and a factor with no point in a bucket across the bucket', () => {
    const cols = columns(list), sc = scene(list, 'raw', new Map())
    const s = laneMarks(sofr, sc[list.indexOf(sofr)], cols)
    // 6M and 1Y are too small for a column, so the bucket they are in (−5) is drawn whole: nothing the factor carries
    // in a bucket is left off the picture
    expect(s.marks.map(m => [m.tenor, m.from, m.to, m.x])).toEqual([[null, 0, 1, -5], ['2Y', 1, 2, -3000], ['5Y', 2, 3, 4500], ['10Y', 3, 4, 2000]])
    expect(s.left).toBe(0)
    // a point too small for a column in a bucket where another point has one is left off, and counted: it is said
    // under the picture and listed on the Risk page
    const mixed = { v: [0, 1520, 0, 0], pts: [{ tenor: '2Y', years: 2, i: 1, x: -3000 }, { tenor: '3Y', years: 3, i: 1, x: 20 }, { tenor: '5Y', years: 5, i: 1, x: 4500 }] }
    const mc = columns([mixed]), ms = laneMarks(mixed, scene([mixed], 'raw', new Map())[0], mc)
    expect(mc.slots.filter(x => x.tenor).map(x => x.tenor)).toEqual(['2Y', '5Y'])
    expect(ms.marks.map(m => m.tenor)).toEqual(['2Y', '5Y']); expect(ms.left).toBe(1)
    const b = laneMarks(btc, sc[list.indexOf(btc)], cols)
    expect(b.marks.map(m => [m.tenor, m.from, m.to, m.x])).toEqual([[null, 0, 1, 22900]])  // the trade matures inside a year
    const v = laneMarks(vol, sc[list.indexOf(vol)], cols)
    expect(v.marks.map(m => [m.tenor, m.from, m.to])).toEqual([['5Y', 2, 3]])              // the same column as the curve's five-year point
    // an older report: every bucket whole
    const old = factors(REP, TRADES), oc = columns(old), os = scene(old, 'raw', new Map())
    expect(laneMarks(old[0], os[0], oc).marks.map(m => [m.tenor, m.from, m.x])).toEqual([[null, 0, 100], [null, 1, 4000], [null, 2, -2400]])
  })
  it('scales a factor to its largest point, which a bucket that nets is smaller than', () => {
    const h = heights(list, 'raw')[list.indexOf(sofr)]
    expect(h.ph.map(x => Number(x.toFixed(4)))).toEqual([0.0459, -0.0566, -0.8165, 1, 0.6667])      // root(x / 4,500)
    expect(Number(h.h[1].toFixed(4))).toBe(0.5774)                                                     // the bucket, 1,500 of 4,500
    const d = heights(list, 'day')[list.indexOf(sofr)]
    expect(Number(d.ph[3].toFixed(4))).toBe(Number(Math.sqrt(22500 / 70990).toFixed(4)))             // on the money scale the book's largest is BTC's 22,900 × 3.1
  })
  it('draws a point as the share of its bucket\'s limit that it uses on its own', () => {
    const by = factorLimits([{ id: 'a', metric: 'KR01:USD_SOFR:1-5Y', limit: 5000, warn_pct: 80, scope: 'ALL' }])
    const s = scene(list, 'limit', by)[list.indexOf(sofr)]
    expect(s.ph.slice(2, 4)).toEqual([-0.6, 0.9])                 // 3,000 short and 4,500 long, each against the bucket's 5,000
    expect(s.h[1]).toBe(0.3)                                      // the bucket itself: 1,500 of 5,000
    expect(s.ph[4]).toBe(0.4)                                     // a bucket with no limit of its own: against the factor's widest
  })
})

describe("the trader's home: the figure at a box", () => {
  const f = { hasDay: true }
  it('is the sensitivity itself, or on the money scale what a usual day moves it by', () => {
    const m = { x: 100.4, day: 5020 }
    expect(['raw', 'limit', 'day'].map(mode => markFigure(f, m, mode))).toEqual(['+100', '+100', '+5,020'])
    expect(markFigure(f, { x: -3, day: -150 }, 'day')).toBe('−150')
  })
  it('stays the sensitivity for a factor with no usual move, which is drawn to its own scale', () => {
    expect(markFigure({ hasDay: false }, { x: 12754, day: null }, 'day')).toBe('+12,754')
  })
  it('is shortened for a narrow column: thousands from ten thousand, millions from a million', () => {
    expect([871, -9949, 12754, -740717, 999499, 999500, 12_754_000, -153_765_000].map(signedShort))
      .toEqual(['+871', '−9,949', '+13k', '−741k', '+999k', '+1.00m', '+12.8m', '−154m'])
    expect(markFigure(f, { x: 100.4, day: 5020 }, 'day', true)).toBe('+5,020')
    expect(markFigure({ hasDay: false }, { x: 740717, day: null }, 'raw', true)).toBe('+741k')
  })
})

describe("the trader's home: which figures of a lane are written", () => {
  const width = (t) => t.length * 7, room = { x0: 0, x1: 400 }
  // three boxes of 30px side by side on a line at y=100, their figures above them
  const box = (left, tall, full, short = full) => ({ cx: left + 15, y: 100 - tall - 5, inside: false, box: [left, 100 - tall, left + 30, 100], full, short, size: tall })
  it('writes every figure whole where the figures do not meet', () => {
    const out = laneFigures([box(40, 4, '+108'), box(120, 8, '+197'), box(200, 30, '+1,582')], width, room)
    expect(out.map(f => f.fig)).toEqual(['+108', '+197', '+1,582'])
    expect(out[2].x).toBe(200 + 15 - 21)                                  // about its box's middle, though wider than its box
  })
  it('writes the largest box first, shortens a neighbour, and leaves one with no room to the tip', () => {
    // three boxes edge to edge, all as tall: the largest takes its whole figure (56px over a 30px box); the next
    // largest is shortened to stay clear of it; the smallest, between them, has no room even shortened
    const a = { ...box(40, 30, '+740,717', '+741k') }, b = { ...box(70, 30, '+612,345', '+612k') }, c = { ...box(100, 30, '+598,000', '+598k') }
    a.size = 30; b.size = 10; c.size = 20
    const out = laneFigures([a, b, c], width, room)
    expect(out[0].fig).toBe('+740,717'); expect(out[2].fig).toBe('+598k'); expect(out[1]).toBeNull()
  })
  it('does not write a figure over another box, and one inside its box must fit it', () => {
    // a short box beside a tall one: the short box's figure, just above it, would lie across the tall box
    const low = box(40, 6, '+12,345', '+12k'), high = box(74, 60, '+900')
    const out = laneFigures([low, high], width, room)
    expect(out[1].fig).toBe('+900')
    expect(out[0].fig, 'shortened, it stays clear of the tall box').toBe('+12k'); expect(out[0].x + width('+12k')).toBeLessThanOrEqual(74 - 1)
    const inside = { cx: 60, y: 60, inside: true, box: [40, 40, 80, 100], full: '+36,498', short: '+36k', size: 60 }
    expect(laneFigures([inside], width, room)[0].fig).toBe('+36k')        // 40px of box holds four characters, not seven
    expect(laneFigures([{ ...inside, short: '+36,498' }], width, room)[0]).toBeNull()
  })
  it('keeps a figure between the picture\'s edges', () => {
    expect(laneFigures([box(0, 10, '+969,401')], width, { x0: 6, x1: 400 })[0].x).toBe(6)
    expect(laneFigures([box(380, 10, '+969,401')], width, { x0: 0, x1: 400 })[0].x).toBe(400 - 56)
  })
})

describe("the trader's home: where a bucket's figure is written", () => {
  const lane = { base: 100, half: 38, text: 10 }                      // a lane of 76px: its edges at 62 and 138
  const span = (at) => [at.y - 10, at.y]                               // the figure's top and its baseline
  it('stands just past a small box, above it long and below it short', () => {
    expect(figureAt({ ...lane, side: 1, tall: 12 })).toEqual({ y: 83, inside: false })
    expect(figureAt({ ...lane, side: -1, tall: 12 })).toEqual({ y: 127, inside: false })
  })
  it('goes inside a box too tall to leave room in the lane, so it never reaches the lane beside it', () => {
    for (const side of [1, -1]) for (const tall of [2, 8, 14, 20, 24, 28, 30.4, 36]) {
      const at = figureAt({ ...lane, side, tall }), [a, b] = span(at)
      expect(a, `side ${side}, a box of ${tall}`).toBeGreaterThanOrEqual(62)
      expect(b).toBeLessThanOrEqual(138)
      if (at.inside) { expect(Math.min(a, b)).toBeGreaterThanOrEqual(Math.min(100, 100 - side * tall)); expect(Math.max(a, b)).toBeLessThanOrEqual(Math.max(100, 100 - side * tall)) }
    }
    expect(figureAt({ ...lane, side: 1, tall: 30.4 }).inside).toBe(true)
  })
  it('keeps clear of the bucket\'s limit line: past it where the lane has room, inside the box where it has not', () => {
    const clear = (at, lineY) => { const [a, b] = span(at); return b < lineY - 5 || a > lineY + 1 }      // a long side's line and its hatching
    const near = figureAt({ ...lane, side: 1, tall: 12, line: 18 })     // the line 6px past the box: the figure goes past the line
    expect(near.inside).toBe(false); expect(clear(near, 82)).toBe(true); expect(near.y).toBeLessThan(82)
    const high = figureAt({ ...lane, side: 1, tall: 27, line: 30.4 })   // no room past the line: inside the box
    expect(high.inside).toBe(true); expect(clear(high, 69.6)).toBe(true)
    const over = figureAt({ ...lane, side: 1, tall: 35.8, line: 30.4 }) // past its limit: the line crosses the box, the figure is under it
    expect(over.inside).toBe(true); expect(clear(over, 69.6)).toBe(true); expect(over.y).toBeLessThanOrEqual(100)
    // a taller lane: room past the box but not past the line. The figure stands on the line, which gives way to it
    const on = figureAt({ base: 100, half: 48, text: 10, side: 1, tall: 32, line: 35.8 })
    expect(on).toEqual({ y: 63, inside: false, onLine: true })
    const short = figureAt({ ...lane, side: -1, tall: 27, line: 30.4 })
    expect(short.inside).toBe(true); expect(short.y).toBeLessThan(130.4 - 3)
  })
})

describe("the trader's home: limits", () => {
  const LIMS = [
    { id: 'a', metric: 'VAR_99_1D', scope: 'ALL', limit: 250000, value: 183800, utilisation_pct: 73.52, status: 'OK' },
    { id: 'b', metric: 'SPOT01:BTC', scope: 'ALL', limit: 25000, value: 22900, utilisation_pct: 91.6, status: 'WARN' },
    { id: 'c', metric: 'KR01:USD_SOFR:1-5Y', scope: 'BOOK', scope_name: 'Swaps', limit: 3000, value: 4000, utilisation_pct: 133.3, status: 'BREACH' },
    { id: 'd', metric: 'STRESS:RISK_OFF', scope: 'ALL', limit: 1, value: null, utilisation_pct: null, status: 'NA' },
    { id: 'e', metric: 'PFE_PEAK:Demo Bank', scope: 'ALL', limit: 10, value: 3, utilisation_pct: 30, status: 'OK' },
  ]
  it('names a limit by what it is on', () => {
    expect(LIMS.map(l => limitLabel(l, [{ id: 'RISK_OFF', name: 'Risk-off' }]))).toEqual(['VAR', 'BTC CRY01', 'USD SOFR 1-5Y · SWAPS', 'STRESS RISK-OFF', 'PFE Demo Bank'])
    expect(limitLabel({ metric: 'IR01' })).toBe('IR01'); expect(limitLabel({ metric: 'IR01:EUR_ESTR' })).toBe('IR01 EUR ESTR')
  })
  it('is one mark for each limit with a figure against it, the closest first: a 01 on the book, a size, an exposure', () => {
    const m = limitMarks(LIMS)
    expect(m.map(x => [x.id, x.pct, x.kind])).toEqual([['c', 133, 's'], ['b', 92, 'o'], ['a', 74, 's'], ['e', 30, 'c']])      // a limit on a book is on a part: a size
    expect(limitMarks(undefined)).toEqual([])
  })
  it('knows which way the figure a limit is on points, from the factor it is on; a VaR or a part of the book has no side', () => {
    const list = factors(REP, TRADES)
    const m = limitMarks([
      { id: 1, metric: 'KR01:USD_SOFR:5-10Y', scope: 'ALL', limit: 5000, utilisation_pct: 48, status: 'OK' },
      { id: 2, metric: 'KR01:USD_SOFR:1-5Y', scope: 'ALL', limit: 5000, utilisation_pct: 80, status: 'WARN' },
      { id: 3, metric: 'SPOT01:BTC', scope: 'ALL', limit: 25000, utilisation_pct: 91.6, status: 'WARN' },
      { id: 4, metric: 'IR01', scope: 'ALL', limit: 4000, utilisation_pct: 42.5, status: 'OK' },
      { id: 5, metric: 'VAR_99_1D', scope: 'ALL', limit: 1, utilisation_pct: 10, status: 'OK' },
      { id: 6, metric: 'KR01:USD_SOFR:1-5Y', scope: 'BOOK', scope_name: 'B', limit: 1, utilisation_pct: 5, status: 'OK' },
      { id: 7, metric: 'NPV', scope: 'ALL', limit: 1, utilisation_pct: 20, status: 'OK' },
    ], [], list, -5)
    expect(Object.fromEntries(m.map(x => [x.id, x.side]))).toEqual({ 1: -1, 2: 1, 3: 1, 4: 1, 5: 0, 6: 0, 7: -1 })
    expect(standing(m, 0).tight).toBe('Closest: BTC CRY01, long, at 92% of its limit.')
  })
  it('says where you stand from the statuses the API gave', () => {
    const s = standing(limitMarks(LIMS), 2)
    expect(s.words).toEqual([['over', '1 limit passed'], ['near', '1 close'], ['dim', '2 clear'], ['hollow', '2 to confirm']])
    expect(s.tight).toBe('Closest: USD SOFR 1-5Y · SWAPS, at 133% of its limit.')
    expect(standing(limitMarks(LIMS.slice(0, 1)), 0).words).toEqual([['ok', 'Inside every limit'], ['dim', '1 clear']])
    expect(standing([], 0)).toEqual({ words: [['mute', 'No limits set']], standardOnly: false, tight: '' })
  })
})

describe("the trader's home: a factor against its limits", () => {
  const list = factors(REP, TRADES), sofr = list.find(f => f.key === 'IR:USD_SOFR'), btc = list.find(f => f.key === 'SPOT:BTC'), eur = list.find(f => f.key === 'SPOT:EUR')
  const by = factorLimits([
    { id: 'k1', metric: 'KR01:USD_SOFR:1-5Y', scope: 'ALL', limit: 5000, warn_pct: 75 },
    { id: 'k2', metric: 'KR01:USD_SOFR:5-10Y', scope: 'ALL', limit: 2000, warn_pct: 80 },
    { id: 't', metric: 'IR01:usd_sofr', scope: 'ALL', limit: 10000 },
    { id: 's', metric: 'SPOT01:BTC', scope: 'ALL', limit: 25000, warn_pct: 90 },
    { id: 'x', metric: 'SPOT01:EUR', scope: 'DESK', scope_name: 'FX', limit: 1 },          // on a part of the book: not drawn on the whole
    { id: 'z', metric: 'KR01:USD_SOFR:1-5Y', scope: 'ALL', limit: 0 },                      // no limit
    { id: 'v', metric: 'VAR_99_1D', scope: 'ALL', limit: 100 },
  ])
  it('finds the limits that are on a factor, for the whole book, whatever the case of the key', () => {
    expect(limitsOf(sofr, by).buckets.map(b => b && b.limit)).toEqual([null, 5000, 2000, null])
    expect(limitsOf(sofr, by).total).toMatchObject({ limit: 10000, warn: 0.8 })
    expect(limitsOf(btc, by).total).toMatchObject({ limit: 25000, warn: 0.9 })
    expect(limitsOf(eur, by)).toBe(null); expect(canLimit(list, by)).toBe(true); expect(canLimit(list, new Map())).toBe(false)
    expect([...shownOn(list, by)].sort()).toEqual(['k1', 'k2', 's', 't'])          // these are on a stream; the VaR and the desk's are listed beside
  })
  it('reads a limit on both sides: long is a share above, short a share below, and the tightest is named with the room left', () => {
    const a = against(sofr, limitsOf(sofr, by))
    expect(a.per.map(p => p && [p.u, p.state])).toEqual([null, [0.8, 'WARN'], [-1.2, 'BREACH'], null])      // +4,000 of 5,000 warns at 75%; −2,400 of 2,000 is past, short
    expect(a.total).toMatchObject({ u: 0.17, state: 'OK' })
    expect(a.head).toMatchObject({ u: -1.2, bucket: '5-10Y', limit: 2000, pos: -2400 }); expect(a.head.room).toBeCloseTo(-400, 6)
    expect(against(btc, limitsOf(btc, by)).head).toMatchObject({ u: 0.916, state: 'WARN', bucket: null }); expect(against(btc, limitsOf(btc, by)).head.room).toBeCloseTo(2100, 6)
    expect(against(eur, null)).toBe(null)
  })
  it('takes the size of a share from the API where it reports one, and the side from the factor: the two cannot disagree', () => {
    // the API measures a bucket's limit on the bucket's own quotes; the picture also places a flat curve's risk there
    const api = factorLimits([{ id: 'k', metric: 'KR01:USD_SOFR:1-5Y', scope: 'ALL', limit: 5000, warn_pct: 80, utilisation_pct: 50 },
                              { id: 'n', metric: 'KR01:USD_SOFR:5-10Y', scope: 'ALL', limit: 4000, warn_pct: 80, utilisation_pct: 85 }])
    const a = against(sofr, limitsOf(sofr, api))
    expect(a.per[1]).toMatchObject({ u: 0.5, state: 'OK', room: 2500 })          // not the 80% its own 4,000 would make
    expect(a.per[2]).toMatchObject({ u: -0.85, state: 'WARN' })                  // short, by the factor's own sign
    expect(scene(list, 'limit', api)[list.indexOf(sofr)].h.slice(1, 3)).toEqual([0.5, -0.85])
  })
  it('draws each bucket as the share of its limit it uses, with the limit at the lane\'s full height, and writes the figure there', () => {
    const sc = scene(list, 'limit', by), s = sc[list.indexOf(sofr)], b = sc[list.indexOf(btc)], e = sc[list.indexOf(eur)]
    expect(s.h).toEqual([0.01, 0.8, -LIMIT_MAX, 0])                      // a bucket with no limit of its own is its share of the total's; past a limit is held at the lane's edge
    expect(s.bank, 'a line only where the bucket has a limit of its own').toEqual([null, 1, 1, null])
    expect(s.tags.map(t => t && Math.round(t.u * 100))).toEqual([null, 80, -120, null])
    expect(s.total).toMatchObject({ u: 0.17, state: 'OK' })               // both are drawn: the buckets' lines and the total's gauge
    // a limit on the total is not a limit on each bucket: no line across them (four buckets at a quarter each would
    // each look a quarter used while the total stood at its limit), the buckets as shares of it, the total as a gauge
    expect(b.h.map(x => Math.round(x * 1000) / 1000)).toEqual([0.732, 0.184, 0, 0])
    expect(b.h[0] + b.h[1]).toBeCloseTo(b.total.u, 9)
    expect(b.bank).toEqual([null, null, null, null]); expect(b.tags).toEqual([null, null, null, null])
    expect(b.total).toMatchObject({ u: 0.916, state: 'WARN' })
    expect(e).toMatchObject({ none: true, bank: [null, null, null, null] }); expect(Math.max(...e.h)).toBeCloseTo(0.6, 9)
  })
  it('draws the limit on the money scale too: its size times the same usual move, where the lane has room for it', () => {
    const sc = scene(list, 'day', by), s = sc[list.indexOf(sofr)], hs = heights(list, 'day')
    expect(s.h).toEqual(hs[list.indexOf(sofr)].h)
    expect(s.bank[1]).toBeCloseTo(Math.sqrt(5000 * 5 / 56730), 9)       // 5,000 a bp times 5bp, against the page's largest bucket
    expect(s.bank[2]).toBeCloseTo(Math.sqrt(2000 * 5.5 / 56730), 9)
    expect(scene(list, 'day', new Map())[0].bank).toEqual([null, null, null, null])
    const raw = scene(list, 'raw', by)[list.indexOf(sofr)]
    expect(raw.bank[1]).toBeCloseTo(Math.sqrt(5000 / 4000), 9)          // just past the largest bucket: still on the lane
    expect(raw.bank[2]).toBeCloseTo(Math.sqrt(2000 / 4000), 9)
    expect(raw.bank[0]).toBe(null)                                       // no limit of its own on this bucket
  })
})

describe("the trader's home: a limit for every curve", () => {
  const list = factors(REP, TRADES)
  const limits = [
    { id: 'standard:IR01:USD_SOFR', metric: 'IR01:USD_SOFR', scope: 'ALL', limit: 50000, warn_pct: 80, utilisation_pct: 3.4, status: 'OK', standard: true },
    { id: 'standard:VEGA:USD_SWVOL_ATM', metric: 'VEGA:USD_SWVOL_ATM', scope: 'ALL', limit: 25000, warn_pct: 80, utilisation_pct: 16.8, status: 'OK', standard: true },
    { id: 'vb', metric: 'VEGA:USD_SWVOL_ATM:1-5Y', scope: 'ALL', limit: 5000, warn_pct: 80, utilisation_pct: 84, status: 'WARN' },
    { id: 'standard:CRYBASIS01:BTC_FUNDING', metric: 'CRYBASIS01:BTC_FUNDING', scope: 'ALL', limit: 10000, warn_pct: 80, utilisation_pct: 14.6, status: 'OK', standard: true },
  ]
  it('draws a limit on a surface\'s vega and on a forward basis as it does a curve\'s, and knows a standard one', () => {
    const by = factorLimits(limits), vega = list.find(f => f.key === 'VEGA:USD_SWVOL_ATM'), basis = list.find(f => f.key === 'BASIS:BTC_FUNDING')
    expect(limitsOf(vega, by).total).toMatchObject({ limit: 25000, standard: true }); expect(limitsOf(vega, by).buckets[1]).toMatchObject({ limit: 5000, standard: false })
    expect(against(vega, limitsOf(vega, by)).head).toMatchObject({ u: 0.84, state: 'WARN', bucket: '1-5Y', standard: false })
    expect(against(basis, limitsOf(basis, by)).head).toMatchObject({ u: -0.146, standard: true, bucket: null })      // short the basis: the left of the rail, below the line
  })
  it('names them on the rail, on the side the figure is on, and says when every limit there is a standard one', () => {
    const m = limitMarks(limits, [], list)
    expect(m.map(x => [x.name, x.side, x.standard])).toEqual([['USD SWAPTIONS VEGA 1-5Y', 1, false], ['USD SWAPTIONS VEGA', 1, true], ['BTC CRYBASIS01', -1, true], ['IR01 USD SOFR', 1, true]])
    expect(standing(m, 0).standardOnly).toBe(false)
    expect(standing(m.filter(x => x.standard), 0).standardOnly).toBe(true)
  })
})

describe("the trader's home: the P&L", () => {
  const S = { dod: 31503, mtd: 623208, ytd: 522290, market: -28131, trading: 59634, mtd_market: 273018, mtd_trading: 350190, ytd_market: 172100, ytd_trading: 350190,
              dod_after_xva: 31025, mtd_after_xva: 618721, ytd_after_xva: 516170,
              buckets: [{ bucket: 'RATES', group: 'MARKET', usd: -6480 }, { bucket: 'NEW', group: 'TRADING', usd: 59634 }, { bucket: 'VOL', group: 'MARKET', usd: 0 }] }
  it('reads as a statement: the market, trading, the two together, what XVA took, what is left', () => {
    expect(statement(S)).toEqual([['Market', -28131, 273018, 172100, undefined], ['Trading', 59634, 350190, 350190, undefined], ['Clean', 31503, 623208, 522290, 'sum'],
                                  ['XVA', -478, -4487, -6120], ['After XVA', 31025, 618721, 516170, 'sum']])
    for (const k of [1, 2, 3]) expect(statement(S)[0][k] + statement(S)[1][k], 'market and trading make the clean').toBe(statement(S)[2][k])
  })
  it('ends at the clean line where the summary has no P&L after XVA, and leaves out a line it does not carry', () => {
    expect(statement({ dod: 1, mtd: 2, ytd: 3 })).toEqual([['Clean', 1, 2, 3, 'sum']]); expect(statement(null)).toEqual([])
    expect(statement({ dod: 1, mtd: 2, ytd: 3, market: 1 }).map(r => r[0])).toEqual(['Market', 'Clean'])
  })
  it('lists what moved the day in the P&L page\'s words, each against the largest', () => {
    const m = moved(S)
    expect(m.rows.map(r => [r.label, r.usd, Math.round(r.share * 1000) / 1000])).toEqual([['RATES', -6480, 0.109], ['NEW TRADES', 59634, 1], ['VOLATILITY', 0, 0]])
    expect(m.any).toBe(true); expect(moved({ buckets: [] }).any).toBe(false); expect(moved(null).rows).toEqual([])
  })
  it('writes a figure with its sign, a zero bare and a missing one as a dash', () => {
    expect([31503.4, -478, 0.2, null, NaN].map(signed)).toEqual(['+31,503', '−478', '0', '—', '—'])
    expect(BUCKETS).toHaveLength(4)
  })
})

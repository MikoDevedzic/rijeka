// The trader's home: what it works out from the risk report, the trades and the P&L summary.
import { describe, expect, it } from 'vitest'
import { BUCKETS, maturityBucket, bucketReach, spotMeasure, factors, peak, lanes, canDay, heights, carry, staleness, limitLabel, limitMarks, standing, railLayout, statement, moved, signed, MAX_LANES } from './trader-home'

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
  const rep = { date: '2026-11-13', generated_at: '2026-11-13T12:00:00Z', moves: null, ladder: { problems: [{ trade_ref: 'TRD-3' }] }, ladder_rows: [{ trade_id: 1 }, { trade_id: 2 }] }
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
  it('is one mark for each limit with a figure against it, the closest first', () => {
    const m = limitMarks(LIMS)
    expect(m.map(x => [x.id, x.pct, x.kind])).toEqual([['c', 133, 'o'], ['b', 92, 'o'], ['a', 74, 'o'], ['e', 30, 'c']])
    expect(limitMarks(undefined)).toEqual([])
  })
  it('says where you stand from the statuses the API gave', () => {
    const s = standing(limitMarks(LIMS), 2)
    expect(s.words).toEqual([['over', '1 limit passed'], ['near', '1 close'], ['dim', '2 clear'], ['hollow', '2 to confirm']])
    expect(s.tight).toBe('Closest: USD SOFR 1-5Y · SWAPS, at 133% of its limit.')
    expect(standing(limitMarks(LIMS.slice(0, 1)), 0).words).toEqual([['ok', 'Inside every limit'], ['dim', '1 clear']])
    expect(standing([], 0)).toEqual({ words: [['mute', 'No limits set']], tight: '' })
  })
  it('places each mark by how much of its limit is used, holds a mark past 125% at the rail\'s end, and lifts a label off its neighbour', () => {
    const { marks, lanes: n } = railLayout(limitMarks(LIMS), 1000)
    const at = Object.fromEntries(marks.map(m => [m.id, m]))
    expect(at.a.x).toBeCloseTo(588.16, 2); expect(at.e.x).toBeCloseTo(240, 6); expect(at.c.x).toBe(1000)
    expect(at.c.cx).toBeLessThanOrEqual(1000 - at.c.w / 2)                 // the label stays on the rail
    const tight = railLayout([{ id: 1, name: 'AAAAAAAA', u: 0.5, pct: 50 }, { id: 2, name: 'BBBBBBBB', u: 0.51, pct: 51 }], 600)
    expect(tight.marks.map(m => m.lane)).toEqual([0, 1]); expect(tight.lanes).toBe(2); expect(n).toBeGreaterThanOrEqual(1)
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

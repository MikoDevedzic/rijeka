// Which request an answer on a currency ticket's tabs belongs to (fx-requests.js). The quotes are made up.
import { describe, it, expect } from 'vitest'
import { SCENARIO_KEPT, marketKey, scenarioTerms, scenarioRequest, scenarioMerge, scenarioRead, xvaTermsKey, xvaResultMatches } from './fx-requests'

const option = (o = {}) => ({
  pair: 'BTCUSD', shape: 'OPTION', base_currency: 'BTC', quote_currency: 'USD', option_type: 'CALL', direction: 'BUY', base_notional: 10,
  expiry_date: '2026-12-09', settlement_date: '2026-12-09', valuation_date: '2026-11-09', strike: 110000, spot: 104000, forward: 104250,
  settlement_type: 'NON_DELIVERABLE', style: 'AMERICAN', payout: null, payout_currency: null, barrier_type: null, barrier: null, lower: null, upper: null,
  rebate: 0, touch_type: null, pay_at_hit: false, vol_pct: 48.5, npv: 31250.5,
  vol_snapshot: '2026-11-09', vol_marks: 'Venue marks · 2026-11-09 12:57 UTC', forward_source: 'market points (BTCUSD_FWD 2026-11-09, Venue forwards · 2026-11-09 12:57 UTC), basis +12.5 pts vs parity',
  ...o,
})
const forward = (o = {}) => ({
  pair: 'EURUSD', shape: 'FORWARD', base_currency: 'EUR', quote_currency: 'USD', direction: 'SELL', base_notional: 1_000_000, settlement_date: '2027-02-11',
  forward_rate: 1.0912, forward: 1.0915, spot: 1.085, npv: -300, forward_source: 'implied from the two OIS curves (interest-rate parity)', ...o,
})

describe('marketKey: the stored market a quote priced on', () => {
  it('a change of strike, notional, date or value leaves it as it is', () => {
    const k = marketKey(option())
    expect(marketKey(option({ strike: 120000 }))).toBe(k)
    expect(marketKey(option({ base_notional: 25, npv: 1 }))).toBe(k)
    // another date has another basis against parity at the end of the forward's source: not part of the market read
    expect(marketKey(option({ expiry_date: '2027-01-09', forward_source: 'market points (BTCUSD_FWD 2026-11-09, Venue forwards · 2026-11-09 12:57 UTC), basis +40.1 pts vs parity' }))).toBe(k)
  })
  it('another pair, a later read of the surface or of the points is another market', () => {
    const k = marketKey(option())
    expect(marketKey(option({ pair: 'ETHUSD' }))).not.toBe(k)
    expect(marketKey(option({ vol_marks: 'Venue marks · 2026-11-09 13:07 UTC' }))).not.toBe(k)
    expect(marketKey(option({ vol_snapshot: '2026-11-10' }))).not.toBe(k)
    expect(marketKey(option({ forward_source: 'market points (BTCUSD_FWD 2026-11-09, Venue forwards · 2026-11-09 13:07 UTC), basis +12.5 pts vs parity' }))).not.toBe(k)
  })
  it('a forward off parity names no stored points: one key per pair', () => {
    expect(marketKey(forward())).toBe(marketKey(forward({ settlement_date: '2027-05-11', forward_rate: 1.1 })))
    expect(marketKey(forward())).toBe('EURUSD|||implied from the two OIS curves (interest-rate parity)')
  })
  it('no quote, or a quote without a pair: null', () => {
    expect(marketKey(null)).toBe(null)
    expect(marketKey({})).toBe(null)
  })
})

describe('a styled option under a scenario: what the engine is asked, and what a figure reads', () => {
  const barrier = option({ style: 'BARRIER', barrier_type: 'UP_OUT', barrier: 130000, rebate: undefined, pay_at_hit: undefined, t_expiry: 0.0822 })
  const market = { spot: 104000, forward: 104250, df_quote: 0.9967, vol_pct: 48.5 }
  const up = { spot: 109200, forward: 109462.5, df_quote: 0.9967, vol_pct: 48.5 }
  it('scenarioTerms is the option as the route takes it: its style and levels, the years to expiry, the spot it was priced at', () => {
    const b = scenarioTerms(barrier)
    expect(b).toMatchObject({ option_type: 'CALL', direction: 'BUY', base_notional: 10, strike: 110000, t_expiry: 0.0822, spot: 104000, style: 'BARRIER', barrier_type: 'UP_OUT', barrier: 130000, rebate: 0, pay_at_hit: false, payout_currency: 'QUOTE' })
    expect(Object.values(b).includes(undefined)).toBe(false)             // JSON would drop an undefined and the key would differ
    expect('pair' in b || 'npv' in b || 'vol_pct' in b).toBe(false)       // nothing of the market: that is in the states
    expect(scenarioTerms(null)).toBe(null)
  })
  const id = (s) => [s.spot, s.forward, s.df_quote, s.vol_pct].join('|')
  it('scenarioRequest prices a market once however many names read it', () => {
    const r = scenarioRequest(barrier, [['now', market], ['only:spot', up], ['only:vol', market], ['lad:spot:0', market], ['lad:spot:5', up]])
    expect(r.body.states).toEqual([market, up])
    expect(r.ids).toEqual([id(market), id(up)])
    expect(r.index).toEqual({ now: id(market), 'only:spot': id(up), 'only:vol': id(market), 'lad:spot:0': id(market), 'lad:spot:5': id(up) })
    expect(r.key).toBe(JSON.stringify(r.body))
    expect(r.body.style).toBe('BARRIER')
    expect(r.terms).toBe(JSON.stringify(scenarioTerms(barrier)))
  })
  it('a name with no usable market is left out; with none left there is nothing to ask', () => {
    const r = scenarioRequest(barrier, [['now', market], ['only:vol', { ...market, vol_pct: null }], ['only:fwd', null], ['lad:spot:-100', { ...market, spot: 0 }]])
    expect(Object.keys(r.index)).toEqual(['now'])
    expect(scenarioRequest(barrier, [['now', null]])).toBe(null)
    expect(scenarioRequest(barrier, [])).toBe(null)
    expect(scenarioRequest(null, [['now', market]])).toBe(null)
  })
  it('a market already answered for these terms is not asked again; with all of them held there is no request', () => {
    const first = scenarioRequest(barrier, [['now', market]])
    const held = scenarioMerge(null, first, [{ npv: 31250.5, touched: false }])
    const next = scenarioRequest(barrier, [['now', up], ['only:vol', market]], held)
    expect(next.body.states).toEqual([up])                                    // the market itself is held
    expect(next.index['only:vol']).toBe(id(market))
    const all = scenarioRequest(barrier, [['now', market]], held)
    expect(all.body).toBe(null); expect(all.key).toBe(null); expect(all.index.now).toBe(id(market))
    // what was answered for other terms is another trade's: everything is asked
    expect(scenarioRequest({ ...barrier, strike: 111000 }, [['now', market]], held).body.states).toEqual([market])
  })
  it('scenarioRead: the value at the name\'s own market, for these terms only', () => {
    const r1 = scenarioRequest(barrier, [['now', market], ['only:spot', up]])
    const held = scenarioMerge(null, r1, [{ npv: 31250.5, touched: false }, { npv: 20, touched: true }])
    expect(scenarioRead(held, r1, 'now')).toEqual({ npv: 31250.5, touched: false, error: null })
    expect(scenarioRead(held, r1, 'only:spot')).toEqual({ npv: 20, touched: true, error: null })
    // the scenario moves on: `now` is another market, not yet answered, and reads as nothing; it never reads the old one
    const down = { ...market, spot: 98800, forward: 99037.5 }
    const r2 = scenarioRequest(barrier, [['now', down], ['only:spot', down], ['only:vol', market]], held)
    expect(scenarioRead(held, r2, 'now')).toBe(null)
    expect(scenarioRead(held, r2, 'only:vol')).toEqual({ npv: 31250.5, touched: false, error: null })     // a market still held is read at once
    // the terms change (another strike): nothing held is read, though the names and the markets are the same
    const other = scenarioRequest({ ...barrier, strike: 111000 }, [['now', market], ['only:spot', up]], held)
    expect(scenarioRead(held, other, 'now')).toBe(null)
    expect(scenarioRead(held, other, 'only:spot')).toBe(null)
    expect(scenarioRead(null, r1, 'now')).toBe(null); expect(scenarioRead(held, null, 'now')).toBe(null)
    expect(scenarioRead(held, r1, 'lad:spot:5')).toBe(null)                                                // a name the request does not carry
  })
  it('scenarioMerge: answers add up for the same terms, start again for other terms, and stay within a bound', () => {
    const r1 = scenarioRequest(barrier, [['now', market]])
    const h1 = scenarioMerge(null, r1, [{ npv: 1, touched: false }])
    const r2 = scenarioRequest(barrier, [['now', up]], h1)
    const h2 = scenarioMerge(h1, r2, [{ npv: 2, touched: false }])
    expect(Object.keys(h2.by)).toEqual([id(market), id(up)])
    const rOther = scenarioRequest({ ...barrier, strike: 111000 }, [['now', market]], h2)
    const h3 = scenarioMerge(h2, rOther, [{ npv: 3, touched: false }])
    expect(h3.terms).toBe(rOther.terms); expect(Object.keys(h3.by)).toEqual([id(market)]); expect(h3.by[id(market)].npv).toBe(3)
    // an answer shorter than what was asked: the market is recorded as not priced, with a reason, never left to be read as held and empty
    const short = scenarioMerge(null, scenarioRequest(barrier, [['now', market], ['x', up]]), [{ npv: 1, touched: false }])
    expect(scenarioRead(short, scenarioRequest(barrier, [['x', up]], short), 'x')).toEqual({ npv: null, touched: false, error: 'the engine gave no answer for this market' })
    // the oldest markets are let go
    let h = null
    for (let k = 0; k < SCENARIO_KEPT + 25; k++) { const s = { ...market, spot: 100000 + k }; h = scenarioMerge(h, scenarioRequest(barrier, [['now', s]], h), [{ npv: k, touched: false }]) }
    expect(Object.keys(h.by)).toHaveLength(SCENARIO_KEPT)
    expect(h.by[id({ ...market, spot: 100000 })]).toBeUndefined(); expect(h.by[id({ ...market, spot: 100000 + SCENARIO_KEPT + 24 })].npv).toBe(SCENARIO_KEPT + 24)
  })
  it('scenarioRead: a market the pricer could not value reads as no figure, with its reason', () => {
    const r = scenarioRequest(barrier, [['now', market]])
    const held = scenarioMerge(null, r, [{ npv: null, touched: false, error: 'outside what the pricer can value' }])
    expect(scenarioRead(held, r, 'now')).toEqual({ npv: null, touched: false, error: 'outside what the pricer can value' })
  })
})

describe('an XVA result and the quote it was simulated for', () => {
  it('matches the same terms repriced on a moved market', () => {
    const at = xvaTermsKey(option())
    expect(xvaResultMatches(at, option())).toBe(true)
    expect(xvaResultMatches(at, option({ spot: 99000, forward: 99200, vol_pct: 55, npv: 1, vol_marks: 'later' }))).toBe(true)
    const f = xvaTermsKey(forward())
    expect(xvaResultMatches(f, forward({ spot: 1.09, forward: 1.0961, npv: 4900 }))).toBe(true)
  })
  it.each([
    ['pair', { base_currency: 'ETH' }], ['notional', { base_notional: 11 }], ['direction', { direction: 'SELL' }], ['settlement', { settlement_date: '2026-12-10' }],
    ['expiry', { expiry_date: '2026-12-08' }], ['strike', { strike: 110001 }], ['option type', { option_type: 'PUT' }], ['style', { style: 'EUROPEAN' }],
    ['barrier', { barrier: 130000 }], ['barrier type', { barrier_type: 'UP_OUT' }], ['lower', { lower: 90000 }], ['upper', { upper: 130000 }],
    ['rebate', { rebate: 5 }], ['payout', { payout: 1000 }], ['payout currency', { payout_currency: 'BASE' }], ['touch type', { touch_type: 'ONE_TOUCH' }],
    ['pay at hit', { pay_at_hit: true }], ['settlement type', { settlement_type: 'DELIVERABLE' }],
  ])('an option whose %s changed no longer matches', (_, change) => {
    expect(xvaResultMatches(xvaTermsKey(option()), option(change))).toBe(false)
  })
  it.each([
    ['notional', { base_notional: 2_000_000 }], ['direction', { direction: 'BUY' }], ['settlement', { settlement_date: '2027-03-11' }], ['K', { forward_rate: 1.0913 }],
    ['pair', { quote_currency: 'JPY' }], ['shape', { shape: 'NDF' }],
  ])('a forward whose %s changed no longer matches', (_, change) => {
    expect(xvaResultMatches(xvaTermsKey(forward()), forward(change))).toBe(false)
  })
  it('a field the quote leaves out is the same as one it sends as null', () => {
    const { barrier, ...without } = option()
    expect(barrier).toBe(null)
    expect(xvaTermsKey(without)).toBe(xvaTermsKey(option()))
  })
  it('a forward and an option on the same pair and date are different trades', () => {
    expect(xvaResultMatches(xvaTermsKey(forward()), option({ base_currency: 'EUR', base_notional: 1_000_000, direction: 'SELL', settlement_date: '2027-02-11' }))).toBe(false)
  })
  it('no record of the terms, or no quote: no match', () => {
    expect(xvaResultMatches(null, option())).toBe(false)
    expect(xvaResultMatches(undefined, option())).toBe(false)
    expect(xvaResultMatches(xvaTermsKey(option()), null)).toBe(false)
    expect(xvaTermsKey(null)).toBe(null)
  })
})

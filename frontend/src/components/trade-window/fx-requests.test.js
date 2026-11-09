// Which request an answer on a currency ticket's tabs belongs to (fx-requests.js). The quotes are made up.
import { describe, it, expect } from 'vitest'
import { marketKey, ladderBody, ladderKey, ladderWanted, ladderShown, xvaTermsKey, xvaResultMatches } from './fx-requests'

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

describe('the style ladder: which quote it belongs to', () => {
  it('ladderBody is the engine\'s request for the quote', () => {
    const b = ladderBody(option({ style: 'BARRIER', barrier_type: 'UP_OUT', barrier: 130000, rebate: undefined, pay_at_hit: undefined }))
    expect(b).toMatchObject({ pair: 'BTCUSD', option_type: 'CALL', base_notional: 10, strike: 110000, spot: 104000, style: 'BARRIER', barrier_type: 'UP_OUT', barrier: 130000, rebate: 0, pay_at_hit: false })
    expect(Object.keys(b)).toHaveLength(20)
    expect(ladderBody(null)).toBe(null)
  })
  it('ladderKey: the same request is the same ladder, whatever else the quote carries', () => {
    const k = ladderKey(option())
    expect(ladderKey(option({ npv: 1, vol_pct: 50, forward: 105000 }))).toBe(k)        // the request sends none of these
    expect(ladderKey(option({ strike: 120000 }))).not.toBe(k)
    expect(ladderKey(option({ spot: 104100 }))).not.toBe(k)
    expect(ladderKey(option({ direction: 'SELL' }))).not.toBe(k)
    expect(ladderKey(null)).toBe(null)
  })
  it('ladderWanted: only for the showing tab, a settled quote, and a request not yet answered', () => {
    const k = ladderKey(option())
    expect(ladderWanted({ active: true, stale: false, key: k, heldKey: null, failedKey: null })).toBe(true)
    expect(ladderWanted({ active: false, stale: false, key: k })).toBe(false)                   // the tab is not showing
    expect(ladderWanted({ active: true, stale: true, key: k })).toBe(false)                     // the quote is being repriced
    expect(ladderWanted({ active: true, stale: false, key: k, heldKey: k })).toBe(false)        // once per quote
    expect(ladderWanted({ active: true, stale: false, key: k, failedKey: k })).toBe(false)      // a failure is not repeated
    expect(ladderWanted({ active: true, stale: false, key: k, heldKey: ladderKey(option({ strike: 1 })) })).toBe(true)
    expect(ladderWanted({ active: true, stale: false, key: null })).toBe(false)
    expect(ladderWanted()).toBe(false)
  })
  it('ladderShown: the last ladder stays while the next is on its way or the quote is stale', () => {
    const a = ladderKey(option()), b = ladderKey(option({ strike: 120000 }))
    const held = { key: a, data: { rows: [] } }
    expect(ladderShown({ key: a, held, failed: null, stale: false })).toEqual({ ladder: held.data, error: null, updating: false })
    expect(ladderShown({ key: b, held, failed: null, stale: false })).toEqual({ ladder: held.data, error: null, updating: true })      // a new quote, its ladder not back yet
    expect(ladderShown({ key: a, held, failed: null, stale: true })).toEqual({ ladder: held.data, error: null, updating: true })       // terms changed, no new quote yet
    expect(ladderShown({ key: a, held: null, failed: null, stale: false })).toEqual({ ladder: null, error: null, updating: false })    // the first ladder: nothing to keep
  })
  it('ladderShown: an error belongs to the request on screen only', () => {
    const a = ladderKey(option()), b = ladderKey(option({ strike: 120000 }))
    const held = { key: a, data: { rows: [] } }
    expect(ladderShown({ key: b, held, failed: { key: b, message: 'ladder 500' }, stale: false })).toEqual({ ladder: held.data, error: 'ladder 500', updating: false })
    expect(ladderShown({ key: a, held, failed: { key: b, message: 'ladder 500' }, stale: false })).toEqual({ ladder: held.data, error: null, updating: false })
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

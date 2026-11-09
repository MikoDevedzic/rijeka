import { describe, it, expect } from 'vitest'
import { settlementDefault, settlementOptions, settlementTerms, settlementLabel, settlementNote, addDays, defaultFixingDate, clampFixingDate, earliestFixingDate, fixingCaption, MAX_FIXING_GAP_DAYS } from './fx-settlement'

// synthetic pair rows in the shape of GET /api/currency/pairs
const SOURCES = [
  { source: 'CME CF BRR', time: '16:00 London', auto: false },
  { source: 'Deribit BTC delivery price', time: '08:00 UTC', auto: true },
]
// `fixing_default` is the constant benchmark everywhere; `settlement_default` is the venue's delivery price where
// its fixings are arriving and the benchmark elsewhere
const FEED = { pair: 'BTCUSD', fixing_default: 'CME CF BRR', settlement_default: { source: 'Deribit BTC delivery price', time: '08:00 UTC' }, fixing_sources: SOURCES }
const BENCH = { pair: 'BTCUSD', fixing_default: 'CME CF BRR', settlement_default: { source: 'CME CF BRR', time: '16:00 London' }, fixing_sources: SOURCES }
const NO_FIELD = { pair: 'BTCUSD', fixing_default: 'CME CF BRR', fixing_sources: SOURCES }      // sources listed, no settlement_default
const OLD = { pair: 'BTCUSD', fixing_default: 'CME CF BRR' }                                   // an API answer from before the choice existed
const PRODUCTS = ['FORWARD', 'OPTION']

describe('the settlement source a digital-asset ticket books', () => {
  it('the default is settlement_default, and fixing_default only when that field is absent', () => {
    expect(settlementDefault(FEED)).toBe('Deribit BTC delivery price')
    expect(settlementDefault(BENCH)).toBe('CME CF BRR')
    expect(settlementDefault(NO_FIELD)).toBe('CME CF BRR')
    expect(settlementDefault({ fixing_default: 'CME CF BRR', settlement_default: { source: '' } })).toBe('CME CF BRR')
    expect(settlementDefault(undefined)).toBeUndefined()
  })
  it('an untouched ticket where the venue\'s fixings arrive books the delivery price at 08:00 UTC on both products', () => {
    for (const product of PRODUCTS)
      expect(settlementTerms(FEED, '', product)).toEqual({ source: 'Deribit BTC delivery price', time: '08:00 UTC', auto: true, isDefault: true })
  })
  it('an untouched ticket where the benchmark is the default books it at 16:00 London on both products', () => {
    for (const product of PRODUCTS) {
      expect(settlementTerms(BENCH, '', product)).toEqual({ source: 'CME CF BRR', time: '16:00 London', auto: false, isDefault: true })
      expect(settlementTerms(NO_FIELD, '', product)).toEqual({ source: 'CME CF BRR', time: '16:00 London', auto: false, isDefault: true })
    }
  })
  it('the booked time is the source\'s time in fixing_sources, not the one settlement_default repeats', () => {
    const disagree = { ...FEED, settlement_default: { source: 'Deribit BTC delivery price', time: '09:00 UTC' } }
    expect(settlementTerms(disagree, '', 'OPTION').time).toBe('08:00 UTC')
  })
  it('an explicit pick overrides the default and carries its own time on both products', () => {
    for (const product of PRODUCTS) {
      expect(settlementTerms(FEED, 'CME CF BRR', product)).toEqual({ source: 'CME CF BRR', time: '16:00 London', auto: false, isDefault: false })
      expect(settlementTerms(BENCH, 'Deribit BTC delivery price', product)).toEqual({ source: 'Deribit BTC delivery price', time: '08:00 UTC', auto: true, isDefault: false })
    }
  })
  it('picking the default again is the untouched ticket', () => {
    for (const product of PRODUCTS) {
      expect(settlementTerms(FEED, 'Deribit BTC delivery price', product)).toEqual(settlementTerms(FEED, '', product))
      expect(settlementTerms(BENCH, 'CME CF BRR', product)).toEqual(settlementTerms(BENCH, '', product))
    }
  })
  it('an older API answer gives no choice and the terms the ticket wrote before: fixing_default at the product\'s hard-coded time', () => {
    expect(settlementOptions(OLD)).toEqual([])
    expect(settlementTerms(OLD, '', 'FORWARD')).toEqual({ source: 'CME CF BRR', time: '16:00 London', auto: false, isDefault: true })
    expect(settlementTerms(OLD, '', 'OPTION')).toEqual({ source: 'CME CF BRR', time: '08:00 UTC', auto: false, isDefault: true })
    expect(settlementTerms(OLD, 'Deribit BTC delivery price', 'OPTION')).toEqual({ source: 'CME CF BRR', time: '08:00 UTC', auto: false, isDefault: true })
    expect(settlementTerms({ ...OLD, fixing_sources: [] }, '', 'OPTION')).toMatchObject({ source: 'CME CF BRR', time: '08:00 UTC' })
    expect(settlementOptions(undefined)).toEqual([])
    expect(settlementTerms(undefined, '', 'FORWARD')).toEqual({ source: undefined, time: '16:00 London', auto: false, isDefault: true })
  })
  it('a source of another pair left in the select falls back to the default', () => {
    expect(settlementTerms(FEED, 'Deribit ETH delivery price', 'FORWARD')).toEqual(settlementTerms(FEED, '', 'FORWARD'))
  })
  it('lists the default even if the API left it out of the sources, and drops unusable rows', () => {
    const odd = { fixing_default: 'CME CF BRR', settlement_default: { source: 'CME CF BRR', time: '16:00 London' }, fixing_sources: [null, { source: '' }, SOURCES[1]] }
    expect(settlementOptions(odd)).toEqual([{ source: 'CME CF BRR', time: '16:00 London', auto: false }, SOURCES[1]])
    for (const product of PRODUCTS)
      expect(settlementTerms(odd, '', product)).toEqual({ source: 'CME CF BRR', time: '16:00 London', auto: false, isDefault: true })
  })
  it('a source listed without a time falls back to the product\'s old constant', () => {
    const noTime = { fixing_default: 'A', fixing_sources: [{ source: 'A', time: '16:00 London' }, { source: 'B' }] }
    expect(settlementTerms(noTime, 'B', 'OPTION')).toEqual({ source: 'B', time: '08:00 UTC', auto: false, isDefault: false })
    expect(settlementTerms(noTime, 'B', 'FORWARD')).toEqual({ source: 'B', time: '16:00 London', auto: false, isDefault: false })
  })
  it('labels an option with the source and its time, and says who supplies the fixing and where', () => {
    expect(settlementLabel(SOURCES[0])).toBe('CME CF BRR · 16:00 London')
    expect(settlementLabel({ source: 'CME CF BRR', time: null })).toBe('CME CF BRR')
    expect(settlementNote(SOURCES[1])).toBe('fixed automatically each day at 08:00 UTC')
    expect(settlementNote(SOURCES[0])).toBe('your desk enters this fixing under Market data › FX · Crypto › Fixings')
    expect(settlementNote(null)).toBe('')
  })
})

describe('the fixing date of a digital-asset forward', () => {
  const AUTO = { source: 'Deribit BTC delivery price', time: '08:00 UTC', auto: true }
  const BENCHMARK = { source: 'CME CF BRR', time: '16:00 London', auto: false }
  const today = '2026-03-10', tomorrow = '2026-03-11'

  it('a source the feed stores fixes on the settlement date', () => {
    expect(defaultFixingDate({ settlementDate: '2026-06-10', source: AUTO, today })).toBe('2026-06-10')
    expect(defaultFixingDate({ settlementDate: tomorrow, source: AUTO, today })).toBe(tomorrow)
  })
  it('a benchmark fixes one calendar day before the settlement date', () => {
    expect(defaultFixingDate({ settlementDate: '2026-06-10', source: BENCHMARK, today })).toBe('2026-06-09')
    expect(defaultFixingDate({ settlementDate: '2026-06-08', source: BENCHMARK, today })).toBe('2026-06-07')      // a Monday settles, a Sunday fixes: calendar days
  })
  it('a benchmark settling tomorrow or the day after never fixes before tomorrow', () => {
    expect(defaultFixingDate({ settlementDate: tomorrow, source: BENCHMARK, today })).toBe(tomorrow)      // settles tomorrow: fixes tomorrow
    expect(defaultFixingDate({ settlementDate: '2026-03-12', source: BENCHMARK, today })).toBe(tomorrow)
    expect(defaultFixingDate({ settlementDate: '2026-03-13', source: BENCHMARK, today })).toBe('2026-03-12')
  })
  it('never proposes today: a trade settling today or earlier has no fixing date', () => {
    for (const source of [AUTO, BENCHMARK]) {
      expect(defaultFixingDate({ settlementDate: today, source, today })).toBeNull()
      expect(defaultFixingDate({ settlementDate: '2026-03-01', source, today })).toBeNull()
      for (const settlementDate of [tomorrow, '2026-03-12', '2026-03-20', '2026-06-10'])
        expect(defaultFixingDate({ settlementDate, source, today }) > today, `${source.source} settling ${settlementDate}`).toBe(true)
    }
  })
  it('crosses a month, a year and a leap day without drifting', () => {
    expect(defaultFixingDate({ settlementDate: '2027-01-01', source: BENCHMARK, today })).toBe('2026-12-31')
    expect(defaultFixingDate({ settlementDate: '2028-03-01', source: BENCHMARK, today })).toBe('2028-02-29')
    expect(defaultFixingDate({ settlementDate: '2027-03-01', source: BENCHMARK, today })).toBe('2027-02-28')
    expect(defaultFixingDate({ settlementDate: '2027-01-01', source: BENCHMARK, today: '2026-12-31' })).toBe('2027-01-01')      // tomorrow is next year
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')      // the day European clocks go back
    expect(addDays('2026-03-29', -1)).toBe('2026-03-28')     // and forward
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('has no default without a settlement date, and treats a source with no flag as a benchmark', () => {
    expect(defaultFixingDate({ settlementDate: '', source: AUTO, today })).toBeNull()
    expect(defaultFixingDate({ settlementDate: 'soon', source: AUTO, today })).toBeNull()
    expect(defaultFixingDate({ settlementDate: '2026-02-30', source: AUTO, today })).toBeNull()
    expect(defaultFixingDate({ settlementDate: '2026-06-10', source: undefined, today })).toBe('2026-06-09')
  })
  it('clamps a typed date above the settlement date, and leaves one inside the last seven days alone', () => {
    const settlementDate = '2026-06-10'
    expect(MAX_FIXING_GAP_DAYS).toBe(7)
    expect(clampFixingDate({ date: '2026-06-11', settlementDate, today })).toBe('2026-06-10')
    expect(clampFixingDate({ date: '2027-01-01', settlementDate, today })).toBe('2026-06-10')
    for (const inside of ['2026-06-03', '2026-06-07', settlementDate]) expect(clampFixingDate({ date: inside, settlementDate, today })).toBe(inside)
  })
  it('caps the gap to the settlement date at seven days: a date eight days before clamps to seven', () => {
    const settlementDate = '2026-06-10'
    expect(clampFixingDate({ date: '2026-06-02', settlementDate, today })).toBe('2026-06-03')
    expect(clampFixingDate({ date: '2026-04-01', settlementDate, today })).toBe('2026-06-03')
    expect(clampFixingDate({ date: '2025-12-31', settlementDate, today })).toBe('2026-06-03')
    expect(clampFixingDate({ date: '2026-02-20', settlementDate: '2026-03-05', today: '2026-01-15' })).toBe('2026-02-26')      // across a month end
    expect(earliestFixingDate({ settlementDate, today })).toBe('2026-06-03')
  })
  it('tomorrow still wins when it is later than seven days before the settlement date; today is never accepted', () => {
    const settlementDate = '2026-03-13'                                   // three days from today
    expect(earliestFixingDate({ settlementDate, today })).toBe(tomorrow)
    expect(clampFixingDate({ date: '2026-03-06', settlementDate, today })).toBe(tomorrow)
    expect(clampFixingDate({ date: today, settlementDate, today })).toBe(tomorrow)
    expect(clampFixingDate({ date: '2026-03-12', settlementDate, today })).toBe('2026-03-12')
    expect(earliestFixingDate({ settlementDate: '2026-03-18', today })).toBe(tomorrow)          // seven days before is tomorrow exactly
    expect(earliestFixingDate({ settlementDate: '2026-03-19', today })).toBe('2026-03-12')
    expect(earliestFixingDate({ settlementDate: null, today })).toBe(tomorrow)
    expect(earliestFixingDate({ settlementDate: '2026-06-10', today: null })).toBe('2026-06-03')
  })
  it('a trade settling tomorrow can only fix tomorrow; one settling today or earlier has no fixing date', () => {
    for (const date of [today, tomorrow, '2026-03-20']) expect(clampFixingDate({ date, settlementDate: tomorrow, today })).toBe(tomorrow)
    expect(clampFixingDate({ date: today, settlementDate: today, today })).toBeNull()
    expect(clampFixingDate({ date: '2026-03-10', settlementDate: '2026-03-01', today })).toBeNull()
  })
  it('a date that is not a date is null; without limits a date is left alone', () => {
    expect(clampFixingDate({ date: '', settlementDate: '2026-06-10', today })).toBeNull()
    expect(clampFixingDate({ date: '2026-6-1', settlementDate: '2026-06-10', today })).toBeNull()
    expect(clampFixingDate({ date: '2026-04-01', settlementDate: null, today: null })).toBe('2026-04-01')
  })
  it('says when the trade fixes: the forward on its fixing date, the option at its expiry', () => {
    expect(fixingCaption({ product: 'FORWARD', fixingDate: '2026-06-10', settlementDate: '2026-06-10', time: '08:00 UTC' })).toBe('fixes on 2026-06-10 at 08:00 UTC, settles 2026-06-10')
    expect(fixingCaption({ product: 'OPTION', expiryDate: '2026-06-10', time: '08:00 UTC' })).toBe('fixes at expiry, 2026-06-10 at 08:00 UTC')
    expect(fixingCaption({ product: 'OPTION', expiryDate: '', time: '08:00 UTC' })).toBe('')
  })
  it('says a forward that fixes before it settles is priced to the settlement date', () => {
    expect(fixingCaption({ product: 'FORWARD', fixingDate: '2026-06-09', settlementDate: '2026-06-10', time: '16:00 London' })).toBe('fixes on 2026-06-09 at 16:00 London, settles 2026-06-10; priced to the settlement date')
  })
  it('says so when no fixing date is possible, and nothing without a settlement date', () => {
    expect(fixingCaption({ product: 'FORWARD', fixingDate: null, settlementDate: '2026-03-10', time: '08:00 UTC' })).toBe('no fixing date is possible: the settlement date must be after today')
    expect(fixingCaption({ product: 'FORWARD', fixingDate: null, settlementDate: '', time: '08:00 UTC' })).toBe('')
  })
})

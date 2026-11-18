import { describe, it, expect } from 'vitest'
import { EXPIRY_DATE, EXPIRY_TENORS, EXPIRY_Y, daysBetween, offWeekend, swaptionExpiry, swaptionUnderlying } from './product-defaults'

// 18 November 2026 is a Wednesday.
const NEW = { valDate: '2026-11-18', tradeDate: '2026-11-18', structure: 'EUROPEAN' }

describe('a swaption\'s expiry on the ticket', () => {
  it('lists tenors to ten years', () => {
    expect(EXPIRY_TENORS).toEqual(['1M', '3M', '6M', '9M', '1Y', '2Y', '3Y', '4Y', '5Y', '7Y', '10Y'])
    expect(EXPIRY_TENORS.map(t => EXPIRY_Y[t])).toEqual([1 / 12, 0.25, 0.5, 0.75, 1, 2, 3, 4, 5, 7, 10])
  })

  it('a tenor is that many calendar months from the valuation date, not a count of days', () => {
    const three = swaptionExpiry({ ...NEW, expiry: '3M' })
    expect(three).toMatchObject({ tenor: '3M', date: '2027-02-18', custom: false, rolledFrom: null, shiftDays: 92 })   // 91 days on was the 17th
    expect(three.years).toBeCloseTo(92 / 365, 12)
    expect(swaptionExpiry({ ...NEW, expiry: '6M' }).date).toBe('2027-05-18')
    expect(swaptionExpiry({ ...NEW, expiry: '10Y' })).toMatchObject({ date: '2036-11-18', shiftDays: 3653 })
    expect(swaptionExpiry({ ...NEW }), 'untouched: the default, a year of 365 days').toMatchObject({ tenor: '1Y', date: '2027-11-18', years: 1 })
  })

  it('a tenor that lands on a weekend is rolled, and says from where; the month is not left', () => {
    // 18 December 2027 is a Saturday: the Monday after
    expect(swaptionExpiry({ ...NEW, valDate: '2026-12-18', expiry: '1Y' })).toMatchObject({ date: '2027-12-20', rolledFrom: '2027-12-18' })
    // 31 July 2027 is a Saturday and the Monday after is in August: the Friday before
    expect(offWeekend('2027-07-31')).toBe('2027-07-30')
    expect(offWeekend('2027-08-01')).toBe('2027-08-02')                // a Sunday
    expect(offWeekend('2027-08-04')).toBe('2027-08-04')                // a Wednesday is left alone
  })

  it('a typed date is the expiry as typed: no tenor, the option\'s time and the underlying\'s shift from the days', () => {
    const ex = swaptionExpiry({ ...NEW, expiry: EXPIRY_DATE, expiryDate: '2027-03-15' })
    expect(ex).toMatchObject({ tenor: null, date: '2027-03-15', custom: true, rolledFrom: null, shiftDays: 117 })
    expect(ex.years).toBeCloseTo(117 / 365, 12)
    // the same date reached by its tenor prices on the same time: one rule for both ways in
    const byTenor = swaptionExpiry({ ...NEW, expiry: '3M' }), byDate = swaptionExpiry({ ...NEW, expiry: EXPIRY_DATE, expiryDate: '2027-02-18' })
    expect(byDate.years).toBe(byTenor.years)
    expect(byDate.shiftDays).toBe(byTenor.shiftDays)
  })

  it('a Bermudan keeps whole tenors: its tree steps in twelfths of a year, and a typed date falls back to the nearest', () => {
    expect(swaptionExpiry({ ...NEW, structure: 'BERMUDAN', expiry: '3Y' })).toMatchObject({ tenor: '3Y', years: 3, custom: false, date: '2029-11-19' })   // the 18th is a Sunday
    expect(swaptionExpiry({ ...NEW, structure: 'BERMUDAN', expiry: EXPIRY_DATE, expiryDate: '2028-10-30' })).toMatchObject({ tenor: '2Y', years: 2, custom: false })
  })

  it('a booked trade keeps the date it was booked with and shows the time it has left', () => {
    // booked on 2 November 2026 under the earlier rule (365 days on), opened on 18 May 2027
    const seen = swaptionExpiry({ readOnly: true, tradeDate: '2026-11-02', valDate: '2027-05-18', expiry: '1Y', expiryDate: '2027-11-02', structure: 'EUROPEAN' })
    expect(seen).toMatchObject({ tenor: '1Y', date: '2027-11-02', custom: false, shiftDays: 365 })                // the legs stay where they were booked
    expect(seen.years).toBeCloseTo(daysBetween('2027-05-18', '2027-11-02') / 365, 12)                          // 168 days, not a year
    // past its expiry the time is a day, never zero or less: the request stays one the pricer answers
    expect(swaptionExpiry({ readOnly: true, tradeDate: '2026-11-02', valDate: '2028-01-10', expiry: '1Y', expiryDate: '2027-11-02' }).years).toBeCloseTo(1 / 365, 12)
    // booked on a typed date
    expect(swaptionExpiry({ readOnly: true, tradeDate: '2026-11-18', valDate: '2026-11-18', expiry: EXPIRY_DATE, expiryDate: '2027-03-15' })).toMatchObject({ tenor: null, custom: true, date: '2027-03-15', shiftDays: 117 })
  })

  it('with no valuation date yet it answers the tenor\'s own figures and no date', () => {
    expect(swaptionExpiry({ expiry: '2Y' })).toMatchObject({ tenor: '2Y', date: null, years: 2, shiftDays: 731 })
  })

  it('the swap it delivers into starts after the expiry and runs its whole tenor by the calendar', () => {
    const spot = { effDate: '2026-11-20', matDate: '2031-11-20' }
    // 1Y on 18 November 2026: 365 days on. Both dates moved by 365 days gave an end of 19 November 2032 (a leap day inside)
    expect(swaptionUnderlying({ ...NEW, ...spot, expiry: '1Y' })).toEqual({ start: '2027-11-20', end: '2032-11-20' })
    expect(swaptionUnderlying({ ...NEW, ...spot, expiry: EXPIRY_DATE, expiryDate: '2027-03-15' })).toEqual({ start: '2027-03-17', end: '2032-03-17' })
    // a booked trade keeps the dates its legs carry, by the rule of its day
    expect(swaptionUnderlying({ readOnly: true, tradeDate: '2026-11-18', valDate: '2027-01-05', ...spot, expiry: '1Y', expiryDate: '2027-11-18' })).toEqual({ start: '2027-11-20', end: '2032-11-19' })
    expect(swaptionUnderlying({ ...NEW, expiry: '1Y' })).toEqual({ start: null, end: null })          // the schedule dates have not arrived
  })
})

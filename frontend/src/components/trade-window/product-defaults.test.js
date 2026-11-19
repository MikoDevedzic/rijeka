import { describe, it, expect } from 'vitest'
import { EXPIRY_DATE, EXPIRY_TENORS, EXPIRY_Y, CAPFLOOR_DEFAULTS, capStrike, capVol, daysBetween, offWeekend, swaptionExpiry, swaptionUnderlying, swaptionVol, volSourceWords } from './product-defaults'

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
    expect(swaptionExpiry({ ...NEW, valDate: '2026-12-18', expiry: '1Y' })).toMatchObject({ date: '2027-12-20', rolledFrom: '2027-12-18', rolledWhy: 'Saturday' })
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
    expect(seen).toMatchObject({ expired: false, problem: null })
    // past its expiry it is the swap it delivered: flagged, so the ticket prices no option; not a problem to refuse
    expect(swaptionExpiry({ readOnly: true, tradeDate: '2026-11-02', valDate: '2028-01-10', expiry: '1Y', expiryDate: '2027-11-02' })).toMatchObject({ expired: true, problem: null })
    // booked on a typed date
    expect(swaptionExpiry({ readOnly: true, tradeDate: '2026-11-18', valDate: '2026-11-18', expiry: EXPIRY_DATE, expiryDate: '2027-03-15' })).toMatchObject({ tenor: null, custom: true, date: '2027-03-15', shiftDays: 117 })
  })

  it('a new ticket refuses an expiry that is not after the valuation date, in words', () => {
    for (const d of ['2026-10-01', '2026-11-18']) {
      const ex = swaptionExpiry({ ...NEW, expiry: EXPIRY_DATE, expiryDate: d })
      expect(ex.expired).toBe(true)
      expect(ex.problem).toBe(`The expiry ${d} is not after the valuation date 2026-11-18: type a later date or choose a tenor.`)
    }
    expect(swaptionExpiry({ ...NEW, expiry: EXPIRY_DATE, expiryDate: '2026-11-19' })).toMatchObject({ expired: false, problem: null })
    expect(swaptionExpiry({ ...NEW, expiry: '1M' }).problem).toBeNull()
  })

  it('with no valuation date yet it answers the tenor\'s own figures and no date', () => {
    expect(swaptionExpiry({ expiry: '2Y' })).toMatchObject({ tenor: '2Y', date: null, years: 2, shiftDays: 731 })
  })

  it('the swap it delivers into starts after the expiry and runs its whole tenor by the calendar', () => {
    const spot = { effDate: '2026-11-20', matDate: '2031-11-20' }
    // 1Y on 18 November 2026: 365 days on. Both dates moved by 365 days gave an end of 19 November 2032 (a leap day inside)
    expect(swaptionUnderlying({ ...NEW, ...spot, expiry: '1Y' })).toEqual({ start: '2027-11-20', end: '2032-11-20' })
    expect(swaptionUnderlying({ ...NEW, ...spot, expiry: EXPIRY_DATE, expiryDate: '2027-03-15' })).toEqual({ start: '2027-03-17', end: '2032-03-17' })
    // a booked trade shows the dates its own legs carry, whichever rule booked them
    const bookedTrade = { readOnly: true, tradeDate: '2026-11-18', valDate: '2027-01-05', ...spot, expiry: '1Y', expiryDate: '2027-11-18' }
    expect(swaptionUnderlying({ ...bookedTrade, underStart: '2027-11-20', underEnd: '2032-11-20' })).toEqual({ start: '2027-11-20', end: '2032-11-20' })   // booked since 0.56.0
    expect(swaptionUnderlying({ ...bookedTrade, underStart: '2027-11-20', underEnd: '2032-11-19' })).toEqual({ start: '2027-11-20', end: '2032-11-19' })   // booked before it
    // its legs not at hand: the older rule, which every earlier booking followed
    expect(swaptionUnderlying(bookedTrade)).toEqual({ start: '2027-11-20', end: '2032-11-19' })
    expect(swaptionUnderlying({ ...NEW, expiry: '1Y' })).toEqual({ start: null, end: null })          // the schedule dates have not arrived
  })
})

describe('a swaption\'s vol on the ticket', () => {
  const surface = { vol_bp: 94.9, tier: 'QUOTED', point: '1Yx5Y', asof: '2026-11-18', currency: 'USD' }
  it('untouched, the ticket shows the surface\'s and sends none: the engine reads the market for the option on the ticket', () => {
    expect(swaptionVol({ volDefault: surface })).toEqual({ bp: null, typed: false, shown: 94.9, problem: null })
    expect(swaptionVol({ volBp: '', volDefault: surface })).toMatchObject({ bp: null, shown: 94.9 })
    expect(swaptionVol({})).toEqual({ bp: null, typed: false, shown: null, problem: null })          // the surface has not answered yet
  })
  it('a typed vol is the vol', () => {
    expect(swaptionVol({ volBp: '80', volDefault: surface })).toEqual({ bp: 80, typed: true, shown: null, problem: null })
    expect(swaptionVol({ volBp: ' 1,250.5 ' }).bp).toBe(1250.5)
    expect(swaptionVol({ volBp: '5000' }).typed).toBe(true)
  })
  it('what is not a vol is refused in words, never quietly replaced by the surface\'s', () => {
    for (const bad of ['abc', '0', '-5', '5000.01', '1e9']) {
      const v = swaptionVol({ volBp: bad, volDefault: surface })
      expect(v, bad).toMatchObject({ bp: null, typed: false })
      expect(v.problem, bad).toContain('is not a normal vol in basis points (above zero, at most 5,000)')
    }
  })
  it('says in a few words where an untouched vol comes from', () => {
    expect(volSourceWords(surface)).toBe('surface 1Y×5Y · 2026-11-18')
    expect(volSourceWords({ ...surface, tier: 'NEAREST', point: '7Yx9Y' })).toBe('nearest point 7Y×9Y · 2026-11-18')
    expect(volSourceWords({ vol_bp: 85, tier: 'DEFAULT', point: null, asof: null, currency: 'EUR' })).toBe('desk default · no EUR swaption surface')
    expect(volSourceWords(null)).toBe('from the swaption surface')
  })
})

describe('a cap\'s, a floor\'s and a collar\'s strike and vol on the ticket', () => {
  it('opens with no strike and no vol of its own: no rate is typed into the ticket for the trader', () => {
    expect(CAPFLOOR_DEFAULTS).toMatchObject({ capRate: '', floorRate: '', volOverride: '' })
  })
  it('a blank strike is none (at the money, the engine\'s to strike); a typed one is that rate as a decimal', () => {
    expect(capStrike('')).toEqual({ dec: null, blank: true, problem: null })
    expect(capStrike(undefined).blank).toBe(true)
    expect(capStrike('4.5').dec).toBeCloseTo(0.045, 12)
    expect(capStrike(' 3.75% ').dec).toBeCloseTo(0.0375, 12)
    expect(capStrike('0')).toEqual({ dec: 0, blank: false, problem: null })                 // a 0 % floor is a strike
    expect(capStrike('-0.25').dec).toBeCloseTo(-0.0025, 12)
  })
  it('text that is not a rate is a problem said in words, never 0 %', () => {
    for (const bad of ['abc', '4,5x', '450', '1e9']) {
      const k = capStrike(bad, 'cap rate')
      expect(k, bad).toMatchObject({ dec: null, blank: false })
      expect(k.problem, bad).toContain('is not a rate in percent')
      expect(k.problem, bad).toContain('The cap rate')
    }
  })
  it('a typed vol is the vol; blank is the surface\'s; anything else is refused in words', () => {
    expect(capVol({})).toEqual({ bp: null, problem: null })
    expect(capVol({ volOverride: ' 1,250.5 ' })).toEqual({ bp: 1250.5, problem: null })
    for (const bad of ['abc', '0', '-5', '5000.01']) expect(capVol({ volOverride: bad }).problem, bad).toContain('is not a normal vol in basis points')
  })
})


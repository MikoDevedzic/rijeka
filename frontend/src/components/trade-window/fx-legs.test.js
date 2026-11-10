import { describe, it, expect } from 'vitest'
import { addMonths, newLeg, nextLeg, stripLegs, structureOf, legProblem, packageTotals, packageRef, packageTag, readPackageTag } from './fx-legs'

const first = { direction: 'SELL', notional: 5, settlement: '2026-12-10', strike: 73550 }

describe('a forward as a package of legs', () => {
  it('adds months on the same day, or the month\'s last when it has no such day', () => {
    expect(addMonths('2026-12-10', 1)).toBe('2027-01-10')
    expect(addMonths('2026-12-10', 14)).toBe('2028-02-10')
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2027-03-31', -1)).toBe('2027-02-28')
    for (const bad of ['', null, '10/12/2026', '2026-12']) expect(addMonths(bad, 1)).toBe('')
    expect(addMonths('2026-12-10', 1.5)).toBe('')
  })
  it('a strip is the ticket\'s side and size a month apart, each at its own fair forward', () => {
    const legs = stripLegs(first, 6)
    expect(legs.map(l => l.settlement)).toEqual(['2027-01-10', '2027-02-10', '2027-03-10', '2027-04-10', '2027-05-10'])
    expect(legs.every(l => l.direction === 'SELL' && l.notional === 5 && l.strike === null)).toBe(true)
    expect(new Set(legs.map(l => l.id)).size).toBe(5)
    expect(stripLegs(first, 1)).toEqual([])
    expect(structureOf(first, legs)).toBe('STRIP')
    expect(structureOf(first, [])).toBe('OUTRIGHT')
  })
  it('the next leg follows the last one a month later; any change of shape is custom', () => {
    const legs = stripLegs(first, 3)
    const more = nextLeg(first, legs)
    expect(more).toMatchObject({ direction: 'SELL', notional: 5, settlement: '2027-03-10', strike: null })
    expect(nextLeg(first, [])).toMatchObject({ settlement: '2027-01-10' })
    expect(structureOf(first, [...legs, more])).toBe('STRIP')
    expect(structureOf(first, [{ ...legs[0], direction: 'BUY' }, legs[1]])).toBe('CUSTOM')
    expect(structureOf(first, [{ ...legs[0], notional: 7 }])).toBe('CUSTOM')
    expect(structureOf(first, [legs[1]])).toBe('CUSTOM')                       // a month skipped
    expect(structureOf(first, [{ ...legs[0], strike: 80000 }])).toBe('STRIP')  // its own strike is what a strip is for
  })
  it('a leg from nonsense is still a leg, and says what it lacks', () => {
    expect(newLeg({})).toMatchObject({ direction: 'BUY', notional: 1, settlement: '', strike: null })
    expect(legProblem(newLeg({}))).toBe('a settlement date')
    expect(legProblem({ notional: 0, settlement: '2027-01-10', strike: null })).toBe('a size above zero')
    expect(legProblem({ notional: 5, settlement: '2027-01-10', strike: -1 })).toMatch(/strike/)
    expect(legProblem({ notional: 5, settlement: '2027-01-10', strike: null })).toBeNull()
  })
  it('the value and each sensitivity add across the legs that are priced', () => {
    const rows = [
      { direction: 'SELL', notional: 5, quote: { npv: 100, spot01: -3665, ir01: 4 } },
      { direction: 'SELL', notional: 5, quote: { npv: -40, delta_quote_per_pct: -3670, ir01: 5 } },
      { direction: 'BUY', notional: 2, quote: null },
    ]
    expect(packageTotals(rows)).toEqual({ n: 3, priced: 2, npv: 60, spot01: -7335, ir01: 9, netNotional: -8 })
    expect(packageTotals([{ direction: 'BUY', notional: 1, quote: null }])).toMatchObject({ npv: null, spot01: null, netNotional: 1 })
  })
  it('a package tag is written into the trade and read back; other text is not a tag', () => {
    const ref = packageRef(1794322831000, 0.5)
    expect(ref).toMatch(/^PKG-[A-Z0-9]{8}$/)
    expect(packageRef(1794322831000, 0.25)).not.toBe(ref)                    // the same millisecond, another package
    const tag = packageTag('STRIP', ref, 2, 6)
    expect(readPackageTag(tag)).toEqual({ structure: 'STRIP', ref, i: 2, n: 6 })
    for (const not of [null, '', 'Macro', 'STRIP 2/6', 'strip PKG-ABCDE 1/2', 'STRIP PKG-ABCDE 1', 'BUTTERFLY PKG-ABCD1 1/3', 'STRIP PKG-ABCD1 5/3', 'STRIP PKG-ABCD1 0/3']) expect(readPackageTag(not), String(not)).toBeNull()
    expect(readPackageTag('RISK REVERSAL PKG-ABCD1 2/2')).toMatchObject({ structure: 'RISK REVERSAL', i: 2, n: 2 })
  })
})

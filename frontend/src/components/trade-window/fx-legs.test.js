import { describe, it, expect } from 'vitest'
import { addMonths, newLeg, nextLeg, stripLegs, pairedLeg, seedStyle, styleOf, structureOf, legProblem, legPayoff, packageTotals, packageRef, packageTag, readPackageTag, packageOf } from './fx-legs'

const first = { kind: 'FWD', direction: 'SELL', notional: 5, date: '2026-12-10', strike: 73550 }

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
    expect(legs.map(l => l.date)).toEqual(['2027-01-10', '2027-02-10', '2027-03-10', '2027-04-10', '2027-05-10'])
    expect(legs.every(l => l.kind === 'FWD' && l.direction === 'SELL' && l.notional === 5 && l.strike === null)).toBe(true)
    expect(new Set(legs.map(l => l.id)).size).toBe(5)
    expect(stripLegs(first, 1)).toEqual([])
    expect(structureOf(first, legs)).toBe('STRIP')
    expect(structureOf(first, [])).toBe('OUTRIGHT')
  })
  it('the next leg follows the last one a month later; any change of shape is custom', () => {
    const legs = stripLegs(first, 3)
    const more = nextLeg(first, legs)
    expect(more).toMatchObject({ kind: 'FWD', direction: 'SELL', notional: 5, date: '2027-03-10', strike: null })
    expect(nextLeg(first, [])).toMatchObject({ date: '2027-01-10' })
    expect(structureOf(first, [...legs, more])).toBe('STRIP')
    expect(structureOf(first, [{ ...legs[0], direction: 'BUY' }, legs[1]])).toBe('CUSTOM')
    expect(structureOf(first, [{ ...legs[0], notional: 7 }])).toBe('CUSTOM')
    expect(structureOf(first, [legs[1]])).toBe('CUSTOM')                       // a month skipped
    expect(structureOf(first, [{ ...legs[0], strike: 80000 }])).toBe('STRIP')  // its own strike is what a strip is for
  })
  it('a leg from nonsense is still a leg, and says what it lacks', () => {
    expect(newLeg({})).toMatchObject({ kind: 'FWD', direction: 'BUY', notional: 1, date: '', strike: null, style: 'EUROPEAN' })
    expect(legProblem(newLeg({}))).toBe('a settlement date')
    expect(legProblem({ kind: 'FWD', notional: 0, date: '2027-01-10', strike: null })).toBe('a size above zero')
    expect(legProblem({ kind: 'FWD', notional: 5, date: '2027-01-10', strike: -1 })).toMatch(/strike/)
    expect(legProblem({ kind: 'FWD', notional: 5, date: '2027-01-10', strike: null })).toBeNull()
    expect(legProblem({ kind: 'SWAP', notional: 5, date: '2027-01-10' })).toBe('a type')
  })
  it('the value and each sensitivity add across the legs that are priced', () => {
    const rows = [
      { kind: 'FWD', direction: 'SELL', notional: 5, quote: { npv: 100, spot01: -3665, ir01: 4 } },
      { kind: 'FWD', direction: 'SELL', notional: 5, quote: { npv: -40, delta_quote_per_pct: -3670, ir01: 5 } },
      { kind: 'FWD', direction: 'BUY', notional: 2, quote: null },
    ]
    expect(packageTotals(rows)).toEqual({ n: 3, priced: 2, npv: 60, spot01: -7335, ir01: 9, vega: null, netNotional: -8 })
    expect(packageTotals([{ kind: 'FWD', direction: 'BUY', notional: 1, quote: null }])).toMatchObject({ npv: null, spot01: null, netNotional: 1 })
    // an option's size is not a position in the asset: the net notional is of the forwards; vega adds across the options
    expect(packageTotals([{ kind: 'CALL', direction: 'BUY', notional: 10, quote: { npv: 5, vega: 2 } }, { kind: 'PUT', direction: 'SELL', notional: 10, quote: { npv: -3, vega: -1.5 } }])).toMatchObject({ npv: 2, vega: 0.5, netNotional: null })
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

  it('a leg is a forward, a call, a put or a touch; an option carries its style, and a touch is its own', () => {
    expect(styleOf({ kind: 'FWD' })).toBeNull()
    expect(styleOf({ kind: 'CALL' })).toBe('EUROPEAN'); expect(styleOf({ kind: 'PUT', style: 'BARRIER' })).toBe('BARRIER')
    expect(styleOf({ kind: 'TOUCH', style: 'DIGITAL' })).toBe('TOUCH'); expect(styleOf({ kind: 'CALL', style: 'nonsense' })).toBe('EUROPEAN')
    // a leg added after an option is that option again, style and levels with it
    const put = { kind: 'PUT', direction: 'BUY', notional: 10, date: '2027-02-10', strike: 65000, style: 'BARRIER', barrierType: 'DOWN_OUT', barrier: 55000 }
    expect(nextLeg(put, [])).toMatchObject({ kind: 'PUT', style: 'BARRIER', barrierType: 'DOWN_OUT', barrier: 55000, date: '2027-03-10', strike: null })
    expect(structureOf(put, stripLegs(put, 3))).toBe('STRIP')
  })
  it('a style starts with levels around the forward, and keeps the ones it has', () => {
    expect(seedStyle({ kind: 'CALL', style: 'BARRIER', barrierType: 'UP_OUT' }, 100000)).toEqual({ barrier: 115000 })
    expect(seedStyle({ kind: 'PUT', style: 'BARRIER', barrierType: 'DOWN_IN' }, 100000)).toEqual({ barrier: 85000 })
    expect(seedStyle({ kind: 'CALL', style: 'BARRIER', barrierType: 'KNOCK_OUT' }, 100000)).toEqual({ barrier: 115000, barrierType: 'UP_OUT' })
    expect(seedStyle({ kind: 'CALL', style: 'DOUBLE_BARRIER', barrierType: 'UP_OUT' }, 1.0847, { dp: 5 })).toEqual({ lowerB: 0.922, upperB: 1.2474, barrierType: 'KNOCK_OUT' })
    expect(seedStyle({ kind: 'CALL', style: 'DIGITAL' }, 100000, { payout: 1000000 })).toEqual({ payout: 1000000 })
    expect(seedStyle({ kind: 'TOUCH' }, 100000)).toEqual({ barrier: 115000, payout: 100000 })
    expect(seedStyle({ kind: 'CALL', style: 'BARRIER', barrierType: 'UP_OUT', barrier: 120000 }, 100000)).toEqual({})
    expect(seedStyle({ kind: 'CALL', style: 'EUROPEAN' }, 100000)).toEqual({}); expect(seedStyle({ kind: 'TOUCH' }, NaN)).toEqual({})
  })
  it('the two-option structures are built on the ticket\'s own option and named for what they are', () => {
    const put = { kind: 'PUT', direction: 'BUY', notional: 10, date: '2027-02-10', strike: 65000, style: 'EUROPEAN' }
    const other = pairedLeg(put, 'OTHER', { f: 74000 })
    expect(other).toMatchObject({ kind: 'CALL', direction: 'SELL', notional: 10, date: '2027-02-10', strike: 83000 })   // as far above the forward as the put is below
    expect(structureOf(put, [other])).toBe('COLLAR')
    const call = { ...put, kind: 'CALL', strike: 85000 }
    expect(structureOf(call, [pairedLeg(call, 'OTHER', { f: 74000 })])).toBe('RISK REVERSAL')
    expect(pairedLeg({ ...put, strike: null }, 'OTHER', { f: 74000, k: 74000 })).toMatchObject({ kind: 'CALL', strike: 81400 })   // struck at the forward: the other side 10 % away
    const straddle = pairedLeg({ ...call, strike: 74000 }, 'STRADDLE')
    expect(straddle).toMatchObject({ kind: 'PUT', direction: 'BUY', strike: 74000, date: '2027-02-10' })
    expect(structureOf({ ...call, strike: 74000 }, [straddle])).toBe('STRADDLE')
    const far = pairedLeg({ ...call, direction: 'SELL' }, 'CALENDAR')
    expect(far).toMatchObject({ kind: 'CALL', direction: 'BUY', strike: 85000, date: '2027-03-10' })
    expect(structureOf({ ...call, direction: 'SELL' }, [far])).toBe('CALENDAR')
    expect(pairedLeg(first, 'OTHER', { f: 74000 })).toBeNull()                                       // a forward has no other side
    // not vanilla, not one size, a third leg: custom
    expect(structureOf(put, [{ ...other, style: 'BARRIER' }])).toBe('CUSTOM')
    expect(structureOf(put, [{ ...other, notional: 5 }])).toBe('CUSTOM')
    expect(structureOf(put, [other, { ...other, strike: 90000 }])).toBe('CUSTOM')
  })
  it('says what a style lacks', () => {
    const o = { kind: 'CALL', notional: 10, date: '2027-02-10', strike: 80000 }
    expect(legProblem({ ...o, style: 'BARRIER', barrier: null })).toBe('a barrier level')
    expect(legProblem({ ...o, style: 'DOUBLE_BARRIER', lowerB: 90000, upperB: 60000 })).toMatch(/lower and an upper/)
    expect(legProblem({ ...o, style: 'DIGITAL', payout: 0 })).toBe('a payout above zero')
    expect(legProblem({ ...o, style: 'DIGITAL', payout: 100000, notional: 0 })).toBeNull()             // a payout has no size
    expect(legProblem({ kind: 'TOUCH', date: '2027-02-10', barrier: 95000, payout: 100000, strike: -5 })).toBeNull()   // nor a strike
    expect(legProblem({ kind: 'CALL', notional: 10, date: '', strike: null })).toBe('an expiry date')
  })
  it('what a leg pays at expiry, a barrier read at the expiry alone', () => {
    const N = 10
    expect(legPayoff({ kind: 'FWD', notional: N }, 80000, 74000)).toBe(60000)
    expect(legPayoff({ kind: 'CALL', notional: N }, 80000, 74000)).toBe(60000); expect(legPayoff({ kind: 'CALL', notional: N }, 70000, 74000)).toBe(0)
    expect(legPayoff({ kind: 'PUT', notional: N }, 70000, 74000)).toBe(40000)
    expect(legPayoff({ kind: 'CALL', style: 'DIGITAL', payout: 100000 }, 74001, 74000)).toBe(100000); expect(legPayoff({ kind: 'PUT', style: 'DIGITAL', payout: 100000 }, 74001, 74000)).toBe(0)
    const ko = { kind: 'CALL', notional: N, style: 'BARRIER', barrierType: 'UP_OUT', barrier: 95000 }
    expect(legPayoff(ko, 90000, 85000)).toBe(50000); expect(legPayoff(ko, 96000, 85000)).toBe(0)
    expect(legPayoff({ ...ko, barrierType: 'UP_IN' }, 90000, 85000)).toBe(0); expect(legPayoff({ ...ko, barrierType: 'UP_IN' }, 96000, 85000)).toBe(110000)
    const dko = { kind: 'PUT', notional: N, style: 'DOUBLE_BARRIER', barrierType: 'KNOCK_OUT', lowerB: 60000, upperB: 95000 }
    expect(legPayoff(dko, 70000, 85000)).toBe(150000); expect(legPayoff(dko, 59000, 85000)).toBe(0)
    expect(legPayoff({ kind: 'TOUCH', touchType: 'ONE_TOUCH', barrier: 95000, payout: 100000 }, 96000, null, 74000)).toBe(100000)
    expect(legPayoff({ kind: 'TOUCH', touchType: 'NO_TOUCH', barrier: 95000, payout: 100000 }, 96000, null, 74000)).toBe(0)
    expect(legPayoff({ kind: 'TOUCH', touchType: 'ONE_TOUCH', barrier: 60000, payout: 100000 }, 59000, null, 74000)).toBe(100000)   // a barrier below the forward is reached going down
  })

  it('a package is named only for what it is', () => {
    const put = { kind: 'PUT', direction: 'BUY', notional: 10, date: '2027-02-10', strike: 65000, style: 'EUROPEAN' }
    const call = { kind: 'CALL', direction: 'SELL', notional: 10, date: '2027-02-10', strike: 85000, style: 'EUROPEAN' }
    expect(structureOf(put, [call])).toBe('COLLAR')
    expect(structureOf(put, [{ ...call, style: 'AMERICAN' }])).toBe('CUSTOM')                 // one European, one American
    expect(structureOf(put, [{ ...call, strike: 60000 }])).toBe('CUSTOM')                     // the call under the put
    expect(structureOf(put, [{ ...call, strike: null }])).toBe('CUSTOM')                      // a strike not yet known
    expect(structureOf({ ...put, direction: 'SELL' }, [{ ...call, direction: 'BUY' }])).toBe('RISK REVERSAL')
    expect(structureOf({ ...put, strike: 74000 }, [{ ...call, direction: 'BUY', strike: 74000, style: 'AMERICAN' }])).toBe('CUSTOM')   // not one style: not a straddle
    expect(structureOf({ ...call, direction: 'SELL' }, [{ ...call, direction: 'BUY', date: '2027-03-10', style: 'AMERICAN' }])).toBe('CUSTOM')
    // a strip of options repeats the style's terms: a leg with another barrier is not the strip
    const ko = { ...call, style: 'BARRIER', barrierType: 'UP_OUT', barrier: 95000, rebate: 500 }
    const strip = stripLegs(ko, 3)
    expect(strip.every(l => l.rebate === 500 && l.barrier === 95000)).toBe(true)              // a copy carries every term, the rebate too
    expect(structureOf(ko, strip)).toBe('STRIP')
    expect(structureOf(ko, [{ ...strip[0], barrier: 99000 }, strip[1]])).toBe('CUSTOM')
    expect(structureOf(ko, [{ ...strip[0], rebate: null }, strip[1]])).toBe('CUSTOM')
    expect(structureOf(ko, [{ ...strip[0], strike: 90000 }, strip[1]])).toBe('STRIP')         // its own strike is still the strip
  })
  it('the other side is never struck at or below zero; a double touch has two levels and pays on leaving them', () => {
    const far = { kind: 'CALL', direction: 'BUY', notional: 10, date: '2027-02-10', strike: 200000, style: 'EUROPEAN' }
    expect(pairedLeg(far, 'OTHER', { f: 74000 }).strike).toBe(66600)                           // the mirror would be below zero: 10 % under the forward
    const dt = { kind: 'TOUCH', touchType: 'DOUBLE_NO_TOUCH', date: '2027-02-10', payout: 100000 }
    expect(legProblem(dt)).toMatch(/lower and an upper/)
    expect(seedStyle(dt, 100000)).toEqual({ lowerB: 85000, upperB: 115000 })
    const set = { ...dt, lowerB: 85000, upperB: 115000 }
    expect(legProblem(set)).toBeNull()
    expect(legPayoff(set, 100000, null, 100000)).toBe(100000); expect(legPayoff(set, 120000, null, 100000)).toBe(0)
    expect(legPayoff({ ...set, touchType: 'DOUBLE_ONE_TOUCH' }, 120000, null, 100000)).toBe(100000)
    // a single touch is reached from where spot is: a barrier between spot and the forward is above spot
    expect(legPayoff({ kind: 'TOUCH', touchType: 'ONE_TOUCH', barrier: 100500, payout: 1 }, 100600, null, 100000)).toBe(1)
  })
})

describe('a package as the server names it: one trade ID, a leg ID for each leg', () => {
  const leg = (id, i, n, status = 'PENDING', pid = 'TRD-44312345', structure = 'STRIP') => ({ id, trade_ref: `${pid}-${i}`, status, strategy: `${structure} ${pid} ${i}/${n}` })
  it('reads the tag the booking writes, with the package\'s trade ID', () => {
    expect(readPackageTag('STRIP TRD-44312345 2/3')).toEqual({ structure: 'STRIP', ref: 'TRD-44312345', i: 2, n: 3 })
    expect(readPackageTag('RISK REVERSAL TRD-00000001 1/2')).toMatchObject({ structure: 'RISK REVERSAL', ref: 'TRD-00000001' })
    // the ticket's older reference is still read, and what is neither is not a tag
    expect(readPackageTag('STRIP PKG-ABCD1234 1/2')).toMatchObject({ ref: 'PKG-ABCD1234' })
    for (const not of ['STRIP TRD-1234 1/2', 'STRIP TRD-44312345-1 1/2', 'STRIP TRD-44312345 0/2', 'STRIP TRD-44312345 3/2', 'TRD-44312345 1/2']) expect(readPackageTag(not), not).toBe(null)
  })
  it('finds every leg of a trade\'s package among the blotter\'s trades, in order, or nothing', () => {
    const a = leg('a', 1, 3), b = leg('b', 2, 3), c = leg('c', 3, 3)
    const other = leg('x', 1, 2, 'PENDING', 'TRD-99999999'), single = { id: 's', trade_ref: 'TRD-11111111', status: 'PENDING', strategy: null }
    const all = [c, single, a, other, b]
    expect(packageOf(b, all)).toEqual({ tradeId: 'TRD-44312345', structure: 'STRIP', n: 3, legs: [a, b, c] })
    expect(packageOf(single, all)).toBe(null)
    expect(packageOf(a, [a, c]), 'a leg missing from the list').toBe(null)
    expect(packageOf(other, all), 'the other package has one of its two legs here').toBe(null)
    expect(packageOf(null, all)).toBe(null)
    // two packages do not mix: the same place in another package is not this package's leg
    expect(packageOf(a, [a, b, leg('z', 3, 3, 'PENDING', 'TRD-22222222')])).toBe(null)
  })
})

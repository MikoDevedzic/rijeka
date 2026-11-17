// The amend form's rules (amend-terms.js): which trades offer it, what is refused before it is sent, the body, the line.
import { describe, it, expect } from 'vitest'
import { amendBody, amendChanged, amendDone, amendProblem, amendWords, canAmend, fmtTerm } from './amend-terms'

const offered = [
  { key: 'notional', label: 'NOTIONAL', now: '10000000', unit: 'USD', why_not: null },
  { key: 'fixed_rate', label: 'FIXED RATE', now: '3.480003', unit: '%', why_not: null },
  { key: 'spread', label: 'SPREAD', now: '0', unit: 'bp', why_not: 'the floating leg has a spread schedule of its own' },
]

describe('amend-terms', () => {
  it('is offered on a pending or confirmed trade that is not a leg of a package', () => {
    expect(canAmend({ status: 'PENDING' })).toBe(true)
    expect(canAmend({ status: 'CONFIRMED' })).toBe(true)
    expect(canAmend({ status: 'TERMINATED' })).toBe(false)
    expect(canAmend({ status: 'CONFIRMED' }, { pkg: {} })).toBe(false)
    expect(canAmend({ status: 'CONFIRMED' }, { terminated: true })).toBe(false)
    expect(canAmend(null)).toBe(false)
  })
  it('names a pending change a correction and a confirmed one an amendment', () => {
    expect(amendWords('CORRECTION').submit).toBe('✓ CORRECT THE BOOKING')
    expect(amendWords('AMENDMENT').open).toBe('◆ AMEND')
  })
  it('sends only the terms that differ, as typed, and never one the trade cannot change', () => {
    const typed = { notional: '12,500,000', fixed_rate: '3.480003', spread: '15' }
    expect(amendChanged(offered, typed).map(t => t.key)).toEqual(['notional'])
    expect(amendBody(offered, typed, '  agreed by phone ')).toEqual({ terms: { notional: '12500000' }, reason: 'agreed by phone' })
    expect(amendBody(offered, { fixed_rate: '3.55' }, '')).toEqual({ terms: { fixed_rate: '3.55' } })
  })
  it('says what is wrong before anything is sent', () => {
    expect(amendProblem(offered, {})).toBe('type the new value of at least one term')
    expect(amendProblem(offered, { fixed_rate: '3.480003' })).toBe('type the new value of at least one term')
    expect(amendProblem(offered, { fixed_rate: '3,5x' })).toBe('the fixed rate is a number')
    expect(amendProblem(offered, { notional: '9000000' })).toMatch(/partially terminate/)
    expect(amendProblem(offered, { notional: '0' })).toMatch(/partially terminate/)
    expect(amendProblem([{ key: 'strike', label: 'STRIKE', now: '1.1', why_not: null }], { strike: '-1' })).toBe('the strike is above zero')
    expect(amendProblem(offered, { fixed_rate: '-0.25' })).toBe(null)
    expect(amendProblem(offered, { spread: 'abc', fixed_rate: '3.5' })).toBe(null)      // a term that cannot be changed is not read
  })
  it('says what was done, each term from and to, and whether anything was signed', () => {
    const am = { kind: 'AMENDMENT', anchored: true, reason: 'agreed by phone', terms: [
      { key: 'notional', label: 'NOTIONAL', from: '10000000', to: '12500000', unit: 'USD' },
      { key: 'fixed_rate', label: 'FIXED RATE', from: '3.480003', to: '3.55', unit: '%' }] }
    expect(amendDone(am)).toBe('Amended: NOTIONAL 10,000,000 → 12,500,000 USD (an increase) · FIXED RATE 3.480003 → 3.55 % · the signed record was replaced on-chain, both parties signing · agreed by phone')
    expect(amendDone({ kind: 'CORRECTION', anchored: false, terms: [{ key: 'strike', label: 'STRIKE', from: '1.1', to: '1.12', unit: 'USD' }] }))
      .toBe('Corrected: STRIKE 1.1 → 1.12 USD · the booking changed; no record on a chain was signed for it')
    expect(amendDone(null)).toBe(null)
    expect(amendDone({ from_notional: '1' })).toBe(null)        // a partial termination's notice is not an amendment's
    expect(fmtTerm('108490.94218920723')).toBe('108,490.94218921')
  })
})

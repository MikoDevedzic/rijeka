// trade-window/partial-termination.test.js
// The helpers behind the ticket's PARTIALLY TERMINATE block. Run: npm test.
import { describe, it, expect } from 'vitest'
import { canPartiallyTerminate, partialProblem, partialBody, partialDone, fmtNotional } from './partial-termination'

const trade = (over = {}) => ({ id: 't', status: 'CONFIRMED', notional: '10000000', structure: 'VANILLA', ...over })

describe('which trades offer a partial termination', () => {
  it('a pending or confirmed trade with a notional', () => {
    expect(canPartiallyTerminate(trade())).toBe(true)
    expect(canPartiallyTerminate(trade({ status: 'PENDING' }))).toBe(true)
  })
  it('not a terminal trade, a package leg, a terminated record, a payout option or a trade with no notional', () => {
    for (const status of ['CANCELLED', 'TERMINATED', 'MATURED']) expect(canPartiallyTerminate(trade({ status }))).toBe(false)
    expect(canPartiallyTerminate(trade(), { pkg: { n: 3 } })).toBe(false)
    expect(canPartiallyTerminate(trade(), { terminated: true })).toBe(false)
    for (const structure of ['DIGITAL', 'TOUCH', 'touch']) expect(canPartiallyTerminate(trade({ structure }))).toBe(false)
    for (const notional of [null, '0', undefined]) expect(canPartiallyTerminate(trade({ notional }))).toBe(false)
    expect(canPartiallyTerminate(null)).toBe(false)
  })
})

describe('what is wrong with what was typed', () => {
  const ok = { current: '10000000', remaining: '6,000,000', feeAmount: '', feeDate: '', today: '2026-11-12' }
  it('nothing, with or without a fee', () => {
    expect(partialProblem(ok)).toBeNull()
    expect(partialProblem({ ...ok, feeAmount: '12,500', feeDate: '2026-11-16' })).toBeNull()
    expect(partialProblem({ ...ok, feeAmount: '12500', feeDate: '2026-11-12' })).toBeNull()
  })
  it('the notional that remains', () => {
    expect(partialProblem({ ...ok, remaining: '' })).toMatch(/type the notional/)
    expect(partialProblem({ ...ok, remaining: 'abc' })).toMatch(/is a number/)
    expect(partialProblem({ ...ok, remaining: '0' })).toMatch(/above zero/)
    expect(partialProblem({ ...ok, remaining: '10000000' })).toMatch(/below the trade's 10,000,000/)
    expect(partialProblem({ ...ok, remaining: '12000000' })).toMatch(/below the trade's/)
  })
  it('the fee', () => {
    expect(partialProblem({ ...ok, feeAmount: '-5', feeDate: '2026-11-16' })).toMatch(/above zero/)
    expect(partialProblem({ ...ok, feeAmount: '5', feeDate: '' })).toMatch(/needs the date/)
    expect(partialProblem({ ...ok, feeAmount: '5', feeDate: '2026-11-11' })).toMatch(/today or later/)
  })
})

describe('what is sent and what is said after', () => {
  it('only the notional that remains, and the fee when there is one', () => {
    expect(partialBody({ remaining: '6,000,000', feeDirection: 'PAY', feeAmount: '', feeDate: '' })).toEqual({ new_notional: '6000000' })
    expect(partialBody({ remaining: '2.5', feeDirection: 'RECEIVE', feeAmount: '12,500', feeDate: '2026-11-16' }))
      .toEqual({ new_notional: '2.5', fee: { direction: 'RECEIVE', amount: 12500, date: '2026-11-16' } })
  })
  it('says what was done, and whether a record on a chain was superseded', () => {
    const pt = { from_notional: '10', to_notional: '2.5', notional_ccy: 'BTC', anchored: true, fee: { direction: 'PAY', amount: 900, currency: 'USD', date: '2026-11-12' } }
    expect(partialDone(pt)).toBe('Reduced from 10 to 2.5 BTC · unwind fee paid 900 USD on 2026-11-12 · the signed record was superseded on-chain, both parties signing')
    expect(partialDone({ from_notional: '10000000', to_notional: '4000000', notional_ccy: 'USD', anchored: false, fee: null }))
      .toBe('Reduced from 10,000,000 to 4,000,000 USD · the booking changed; no record on a chain was signed for it')
    expect(partialDone(null)).toBeNull()
    expect(fmtNotional('x')).toBe('—')
  })
})

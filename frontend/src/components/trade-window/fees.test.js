import { describe, it, expect } from 'vitest'
import { feeRow, feeProblem, feeIsBlank, cleanFees, premiumTerms, withFees, rowsFromTerms, feesSummary, FEE_TYPES } from './fees'

const row = (o) => feeRow({ type: 'PREMIUM', direction: 'PAY', amount: '12,500.50', date: '2026-11-16', ...o })

describe('fees on a trade', () => {
  it('a row is a fee when it has an amount above zero and a date; an untouched row is not one and is not wrong', () => {
    expect(feeProblem(row())).toBe(null)
    expect(feeProblem(feeRow())).toBe(null)
    expect(feeIsBlank(feeRow())).toBe(true)
    expect(feeProblem(row({ amount: 'abc' }))).toMatch(/a number/)
    expect(feeProblem(row({ amount: '0' }))).toMatch(/above zero/)
    expect(feeProblem(row({ amount: '-5' }))).toMatch(/above zero/)
    expect(feeProblem(row({ date: '' }))).toMatch(/needs its date/)
    expect(feeProblem(row({ date: '16/11/2026' }))).toMatch(/needs its date/)
    expect(feeProblem(row({ amount: '', date: '2026-11-16' }))).toMatch(/a number/)
    expect(feeProblem({ ...row(), type: 'TIP' })).toMatch(/type/)
    expect(FEE_TYPES).toEqual(['PREMIUM', 'UPFRONT', 'BROKERAGE', 'UNWIND', 'OTHER'])
  })
  it('what is sent: the complete rows in the trade\'s currency; nothing at all while a row is wrong', () => {
    const rows = [row(), feeRow(), row({ type: 'UPFRONT', direction: 'RECEIVE', amount: '4000', date: '2027-01-04' })]
    expect(cleanFees(rows, 'usd')).toEqual([
      { type: 'PREMIUM', direction: 'PAY', amount: 12500.5, currency: 'USD', date: '2026-11-16' },
      { type: 'UPFRONT', direction: 'RECEIVE', amount: 4000, currency: 'USD', date: '2027-01-04' }])
    expect(cleanFees([row(), row({ amount: 'x' })], 'USD')).toBe(null)
    expect(cleanFees([], 'USD')).toEqual([])
    expect(cleanFees([feeRow()], 'USD')).toEqual([])
    expect(cleanFees(null, 'USD')).toEqual([])
  })
  it('the confirmation\'s premium is the PREMIUM fees added up, on the first of their dates', () => {
    const fees = cleanFees([row({ amount: '100.10', date: '2027-02-01' }), row({ amount: '200.20', date: '2026-12-01' }), row({ type: 'BROKERAGE', amount: '9' })], 'EUR')
    expect(premiumTerms(fees)).toEqual({ premium_amount: 300.3, premium_currency: 'EUR', premium_payment_date: '2026-12-01' })
    expect(premiumTerms(cleanFees([row({ type: 'UPFRONT' })], 'USD'))).toBe(null)
    expect(premiumTerms([])).toBe(null)
  })
  it('a booking body takes the fees into its terms and leaves a body with none as it was', () => {
    const body = { instrument_type: 'FX_OPTION', terms: { strike: '1.09', premium_amount: '55', premium_currency: 'USD', premium_payment_date: '2026-11-12' } }
    const fees = cleanFees([row(), row({ type: 'BROKERAGE', amount: '250' })], 'USD')
    const out = withFees(body, fees)
    expect(out.terms.fees).toEqual(fees)
    expect(out.terms).toMatchObject({ strike: '1.09', premium_amount: 12500.5, premium_currency: 'USD', premium_payment_date: '2026-11-16' })
    expect(body.terms.fees).toBeUndefined()
    // no PREMIUM among them: the ticket's own premium fields stand
    expect(withFees(body, cleanFees([row({ type: 'UPFRONT' })], 'USD')).terms).toMatchObject({ premium_amount: '55', premium_payment_date: '2026-11-12' })
    expect(withFees(body, [])).toBe(body)
    expect(withFees(body, null)).toBe(body)
    expect(withFees(null, fees)).toBe(null)
  })
  it('a booked trade opened again shows its fees; one booked before fees were a list shows its premium', () => {
    const rows = rowsFromTerms({ fees: [{ type: 'UPFRONT', direction: 'RECEIVE', amount: 4000, currency: 'USD', date: '2027-01-04' }] })
    expect(rows.map(({ type, direction, amount, date }) => ({ type, direction, amount, date }))).toEqual([{ type: 'UPFRONT', direction: 'RECEIVE', amount: '4000', date: '2027-01-04' }])
    const old = rowsFromTerms({ side: 'SELL', premium_amount: 150000, premium_payment_date: '2026-11-12T00:00:00' })
    expect(old.map(({ type, direction, amount, date }) => ({ type, direction, amount, date }))).toEqual([{ type: 'PREMIUM', direction: 'RECEIVE', amount: '150000', date: '2026-11-12' }])
    expect(rowsFromTerms({ direction: 'BUY', premium_amount: '10', premium_payment_date: '2026-11-12' })[0].direction).toBe('PAY')
    expect(rowsFromTerms({ premium_amount: null })).toEqual([])
    expect(rowsFromTerms(null)).toEqual([])
    expect(new Set(rowsFromTerms({ fees: [{ type: 'OTHER', direction: 'PAY', amount: 1, date: '2027-01-04' }, { type: 'OTHER', direction: 'PAY', amount: 2, date: '2027-01-05' }] }).map(r => r.id)).size).toBe(2)
  })
  it('one line says how many and which way', () => {
    expect(feesSummary([], 'USD')).toBe('none entered')
    expect(feesSummary(cleanFees([row(), row({ type: 'UPFRONT', direction: 'RECEIVE', amount: '4000' })], 'USD'), 'USD')).toBe('2 fees · pay 12,500.50 · receive 4,000.00 USD')
    expect(feesSummary(cleanFees([row()], 'USD'), 'USD')).toBe('1 fee · pay 12,500.50 USD')
  })
})

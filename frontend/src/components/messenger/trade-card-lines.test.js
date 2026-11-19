import { describe, it, expect } from 'vitest'
import { optionLines } from './trade-card-lines'

// The card of an option on a rate (0.61.0). A swaption's card read "You pay fixed 3.86%" and nothing of the option;
// a cap's read "You receive USD SOFR" with no strike.
describe('the lines a trade card writes for an option on a rate', () => {
  const swaption = { instrument: 'IR_SWAPTION', embedded: [], option: { type: 'SWAPTION', you: 'SELL', premium: 'RECEIVE',
    fields: { right: 'PAYER', exercise_style: 'EUROPEAN', expiry_date: '2027-11-19', strike: '0.03859304', settlement: 'PHYSICAL',
      premium_amount: '165478.07', premium_currency: 'USD', premium_payment_date: '2026-11-23' } } }
  it('a sold payer swaption says who sold it, its expiry, its strike and which way the premium goes', () => {
    expect(optionLines(swaption)).toEqual([{ lead: 'You sell a European payer swaption',
      rest: 'expiry 2027-11-19 · strike 3.859304% · premium USD 165,478.07, you receive on 2026-11-23' }])
    const bought = { ...swaption, option: { ...swaption.option, you: 'BUY', premium: 'PAY', fields: { ...swaption.option.fields, right: 'RECEIVER', strike: '0.04' } } }
    expect(optionLines(bought)[0]).toEqual({ lead: 'You buy a European receiver swaption', rest: 'expiry 2027-11-19 · strike 4% · premium USD 165,478.07, you pay on 2026-11-23' })
  })
  it('a swaption with no premium in its record says so', () => {
    const none = { ...swaption, option: { ...swaption.option, premium: null, fields: { ...swaption.option.fields, premium_amount: undefined } } }
    expect(optionLines(none)[0].rest).toBe('expiry 2027-11-19 · strike 3.859304% · no premium in the record')
  })
  it('a collar: each option with its strike and who buys it, then the premium', () => {
    const collar = { instrument: 'IR_COLLAR', embedded: [{ type: 'CAP', strike: '4.5%', you: 'BUY' }, { type: 'FLOOR', strike: '3%', you: 'SELL' }],
      option: { type: 'COLLAR', you: 'BUY', premium: 'PAY', fields: { premium_amount: '2604.66', premium_currency: 'USD', premium_payment_date: '2026-11-23' } } }
    expect(optionLines(collar)).toEqual([{ lead: 'You buy the cap, strike 4.5%', rest: '' }, { lead: 'You sell the floor, strike 3%', rest: '' },
      { lead: 'Premium', rest: 'USD 2,604.66, you pay on 2026-11-23' }])
    // no premium entered: the card says so
    expect(optionLines({ ...collar, option: { ...collar.option, premium: null, fields: {} } })[2]).toEqual({ lead: 'Premium', rest: 'none in the record' })
  })
  it('a cap signed before record v3 has its strike and no premium line; a swap has no line at all', () => {
    expect(optionLines({ instrument: 'IR_CAP', embedded: [{ type: 'CAP', strike: '4.5%', you: 'SELL' }], option: null })).toEqual([{ lead: 'You sell the cap, strike 4.5%', rest: '' }])
    expect(optionLines({ instrument: 'IR_SWAP', legs: [] })).toEqual([])
    expect(optionLines(null)).toEqual([])
  })
})

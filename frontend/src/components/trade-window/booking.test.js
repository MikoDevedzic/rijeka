// trade-window/booking.test.js
// The POST /api/book/trade bodies the unified window sends, per product. The
// backend stores trade.terms and the legs as they arrive (booking.py
// complete_booking only fills what is missing), the exposure engine and the
// P&L valuation read the option terms (ccr/options.swaption_terms,
// pnl/valuation._value_swaption) and the pricers the embedded strikes
// (pricing/ir_swap.py), so these shapes are a contract. Run: npm test.
import { describe, it, expect, vi } from 'vitest'

// booking.js imports the session helper, whose supabase client needs env vars
// at import time; the builders under test never call it.
vi.mock('../../lib/session', () => ({ getSessionMaybe: async () => null }))

import { buildBookingBody, buildLegs, executeBooking, INSTRUMENT_OF } from './booking'

const extras = { ownEntityId: 'own-1', counterpartyId: 'cp-1', desk: 'RATES', book: 'USD-IRS' }

// A 5Y USD SOFR ticket as the window holds it: dates from /api/schedules/preview,
// the coupon solved at par, every leg convention at its default.
const swapState = {
  productKey: 'IR_SWAP', structure: 'VANILLA', direction: 'PAY',
  notional: 10_000_000, ccy: 'USD', tenor: '5Y',
  tradeDate: '2026-11-02', effDate: '2026-11-04', matDate: '2031-11-04', valDate: '2026-11-02',
  coupon: '3.75000000', parRate: 3.75, rateUserEdited: false,
  index: 'SOFR', spread: '0', leverage: '1.0',
}

describe('IR_SWAP (unchanged since Sprint 12)', () => {
  it('books a vanilla swap: trade terms plus FIXED-1 and FLOAT-1', () => {
    const body = buildBookingBody(swapState, 'PAY', extras)
    expect(body).toEqual({
      store: 'WORKING', asset_class: 'RATES', instrument_type: 'IR_SWAP', structure: 'VANILLA',
      own_legal_entity_id: 'own-1', counterparty_id: 'cp-1',
      notional: 10_000_000, notional_ccy: 'USD',
      trade_date: '2026-11-02', effective_date: '2026-11-04', maturity_date: '2031-11-04',
      desk: 'RATES', book: 'USD-IRS',
      terms: {
        direction: 'PAY', float_direction: 'RECEIVE',
        fixed_rate: 0.0375,
        fixed_pay_freq: 'ANNUAL', fixed_day_count: 'ACT/360', fixed_bdc: 'MOD_FOLLOWING', fixed_calendar: null,
        float_index: 'SOFR', float_reset_freq: 'DAILY', float_pay_freq: 'ANNUAL',
        float_day_count: 'ACT/360', float_bdc: 'MOD_FOLLOWING', float_calendar: null,
        spread: 0, leverage: 1,
      },
      legs: [
        {
          leg_ref: 'FIXED-1', leg_seq: 1, leg_type: 'FIXED',
          direction: 'PAY', currency: 'USD', notional: 10_000_000, notional_type: 'BULLET',
          effective_date: '2026-11-04', maturity_date: '2031-11-04',
          day_count: 'ACT/360', payment_frequency: 'ANNUAL', bdc: 'MOD_FOLLOWING', payment_calendar: null,
          stub_type: 'SHORT_FRONT', payment_lag: 2,
          fixed_rate: 0.0375, fixed_rate_schedule: null, notional_schedule: null,
          discount_curve_id: 'USD_SOFR', forecast_curve_id: null, ois_compounding: null,
          terms: { custom_cashflows: [] },
        },
        {
          leg_ref: 'FLOAT-1', leg_seq: 2, leg_type: 'FLOAT',
          direction: 'RECEIVE', currency: 'USD', notional: 10_000_000, notional_type: 'BULLET',
          effective_date: '2026-11-04', maturity_date: '2031-11-04',
          day_count: 'ACT/360', payment_frequency: 'ANNUAL', reset_frequency: 'DAILY',
          bdc: 'MOD_FOLLOWING', payment_calendar: null,
          stub_type: 'SHORT_FRONT', payment_lag: 2,
          fixed_rate: 0, spread: 0, spread_schedule: null, leverage: 1, notional_schedule: null,
          discount_curve_id: 'USD_SOFR', forecast_curve_id: 'USD_SOFR', ois_compounding: null,
          terms: { custom_cashflows: [] },
        },
      ],
    })
  })

  it('books a BASIS swap as two float legs with the spread on FLOAT-2', () => {
    const body = buildBookingBody({ ...swapState, structure: 'BASIS', index2: 'EFFR', spread: '12.5' }, 'PAY', extras)
    expect(body.structure).toBe('BASIS')
    expect(body.terms).toMatchObject({ direction: 'PAY', index1: 'SOFR', index2: 'EFFR', spread: 0.00125 })
    expect(body.legs.map(l => [l.leg_ref, l.direction, l.spread, l.forecast_curve_id])).toEqual([
      ['FLOAT-1', 'PAY', 0, 'USD_SOFR'], ['FLOAT-2', 'RECEIVE', 0.00125, 'USD_EFFR'],
    ])
  })
})

// A 1Y into 5Y payer swaption, struck at 4%, 86.5bp normal vol, premium 25bp.
const swaptionState = {
  ...swapState, productKey: 'IR_SWAPTION', structure: 'EUROPEAN',
  expiry: '1Y', volBp: '86.5', strike: '4.0', optionSide: 'BUY',
  premium: '25', premiumMode: 'BP', settleDate: '2026-11-04',
}

describe('IR_SWAPTION', () => {
  it('books the option terms on the trade and the forward-starting swap as its legs', () => {
    const body = buildBookingBody(swaptionState, 'PAY', extras)
    expect(body).toMatchObject({
      asset_class: 'RATES', instrument_type: 'IR_SWAPTION', structure: 'EUROPEAN',
      notional: 10_000_000, notional_ccy: 'USD',
      // trade-level dates stay the spot-start swap's; the legs carry the forward start
      trade_date: '2026-11-02', effective_date: '2026-11-04', maturity_date: '2031-11-04',
    })
    expect(body.terms).toEqual({
      direction: 'PAY', float_direction: 'RECEIVE',
      fixed_rate: 0.04,
      fixed_pay_freq: 'ANNUAL', fixed_day_count: 'ACT/360', fixed_bdc: 'MOD_FOLLOWING', fixed_calendar: null,
      float_index: 'SOFR', float_reset_freq: 'DAILY', float_pay_freq: 'ANNUAL',
      float_day_count: 'ACT/360', float_bdc: 'MOD_FOLLOWING', float_calendar: null,
      spread: 0, leverage: 1,
      option: 'SWAPTION', side: 'BUY', is_payer: true,
      expiry_date: '2027-11-02',          // valuation date + round(1 * 365.25) days
      expiry_tenor: '1Y', exercise_type: 'EUROPEAN',
      strike: 0.04, vol_bp: 86.5,
      premium_amount: 25_000,             // 25bp of 10m
      premium_currency: 'USD', premium_payment_date: '2026-11-04',
    })
    // the types the engines read
    expect(typeof body.terms.expiry_date).toBe('string')
    expect(typeof body.terms.strike).toBe('number')
    expect(typeof body.terms.is_payer).toBe('boolean')
    expect(['BUY', 'SELL']).toContain(body.terms.side)

    expect(body.legs).toHaveLength(2)
    const [fixed, float] = body.legs
    expect(fixed).toMatchObject({
      leg_ref: 'FIXED-1', leg_type: 'FIXED', direction: 'PAY',
      effective_date: '2027-11-04', maturity_date: '2032-11-03',   // both shifted by 365 days
      fixed_rate: 0.04,                                            // the strike, not the par coupon
    })
    expect(float).toMatchObject({
      leg_ref: 'FLOAT-1', leg_type: 'FLOAT', direction: 'RECEIVE',
      effective_date: '2027-11-04', maturity_date: '2032-11-03',
      forecast_curve_id: 'USD_SOFR', leverage: 1,
    })
  })

  it('passes a BERMUDAN structure through as structure and exercise_type', () => {
    const body = buildBookingBody({ ...swaptionState, structure: 'BERMUDAN', expiry: '3Y', exerciseScheduleY: [2, 1, 3] }, 'RECEIVE', extras)
    expect(body.structure).toBe('BERMUDAN')
    expect(body.terms).toMatchObject({ exercise_type: 'BERMUDAN', exercise_schedule_y: [1, 2, 3], is_payer: false, expiry_tenor: '3Y' })
    expect(body.legs[0].effective_date).toBe('2029-11-04')      // + round(3 * 365.25) = 1096 days, one leap day crossed
  })

  it('a blank strike is the priced ATM forward, and an error when nothing was priced', () => {
    const blank = { ...swaptionState, strike: '' }
    expect(() => buildBookingBody(blank, 'PAY', extras)).toThrow(/price the swaption first/)
    expect(() => buildLegs(blank, 'PAY', 10_000_000)).toThrow(/price the swaption first/)
    const body = buildBookingBody(blank, 'PAY', { ...extras, priced: { forward_rate: 0.0381234 } })
    expect(body.terms.strike).toBe(0.0381234)
    expect(body.terms.fixed_rate).toBe(0.0381234)
    expect(body.legs[0].fixed_rate).toBe(0.0381234)
  })

  it('a premium entered in currency is booked as entered; none entered books null', () => {
    expect(buildBookingBody({ ...swaptionState, premium: '150000', premiumMode: 'DOLLAR' }, 'PAY', extras).terms.premium_amount).toBe(150_000)
    expect(buildBookingBody({ ...swaptionState, premium: '' }, 'PAY', extras).terms.premium_amount).toBeNull()
  })
})

// A 5Y SOFR cap at 4.5%, quarterly, the vol from the priced strip (no override).
const capState = {
  productKey: 'RATES_CAP', structure: null, direction: 'PAY',
  notional: 10_000_000, ccy: 'USD', tenor: '5Y',
  tradeDate: '2026-11-02', effDate: '2026-11-04', matDate: '2031-11-04', valDate: '2026-11-02',
  capRate: '4.5', index: 'SOFR', capResetFreq: 'DAILY', capPayFreq: 'QUARTERLY', capDayCount: 'ACT/360',
  volOverride: '', optionSide: 'BUY',
}
const pricedCap = { npv: 123_456.78, vol_bp: 91.2 }

describe('IR_CAP / IR_FLOOR / IR_COLLAR', () => {
  it('books a bought cap as one OPT-1 float leg with no participation and one CAP strike', () => {
    const body = buildBookingBody(capState, 'PAY', { ...extras, priced: pricedCap })
    expect(body).toMatchObject({ asset_class: 'RATES', instrument_type: 'IR_CAP', structure: null, notional_ccy: 'USD' })
    expect(body.terms).toEqual({
      option: 'CAP', side: 'BUY',
      cap_rate: 0.045, floor_rate: null,
      vol_bp: 91.2,                       // the priced vol when no override was typed
      premium_amount: 123_456.78,         // the priced NPV when no premium was typed
      premium_currency: 'USD', premium_payment_date: '2026-11-04',
      direction: 'PAY', float_direction: 'RECEIVE',
      float_index: 'SOFR', float_reset_freq: 'DAILY', float_pay_freq: 'QUARTERLY',
      float_day_count: 'ACT/360', float_bdc: 'MOD_FOLLOWING', float_calendar: null,
      spread: 0, leverage: 0,
    })
    expect(body.legs).toEqual([{
      leg_ref: 'OPT-1', leg_seq: 1, leg_type: 'FLOAT',
      direction: 'RECEIVE', currency: 'USD', notional: 10_000_000, notional_type: 'BULLET',
      effective_date: '2026-11-04', maturity_date: '2031-11-04',
      day_count: 'ACT/360', payment_frequency: 'QUARTERLY', reset_frequency: 'DAILY',
      bdc: 'MOD_FOLLOWING', payment_calendar: null,
      stub_type: 'SHORT_FRONT', payment_lag: 2,
      fixed_rate: 0, spread: 0, spread_schedule: null, leverage: 0,
      discount_curve_id: 'USD_SOFR', forecast_curve_id: 'USD_SOFR', ois_compounding: null,
      embedded_options: [
        { type: 'CAP', direction: 'BUY', default_strike: 0.045, strike_schedule: [{ date: '2026-11-04', strike: 0.045 }] },
      ],
      terms: {},
    }])
  })

  it('a typed vol override and premium win over the priced ones', () => {
    const body = buildBookingBody({ ...capState, volOverride: '80', premium: '10', premiumMode: 'BP' }, 'PAY', { ...extras, priced: pricedCap })
    expect(body.terms.vol_bp).toBe(80)
    expect(body.terms.premium_amount).toBe(10_000)
  })

  it('books a bought collar as a long CAP and a short FLOOR on the same leg', () => {
    const body = buildBookingBody({ ...capState, productKey: 'RATES_COLLAR', floorRate: '3.0' }, 'PAY',
                                  { ...extras, priced: { net_npv: -2_500, cap_vol_bp: 90.1 } })
    expect(body.instrument_type).toBe('IR_COLLAR')
    expect(body.terms).toMatchObject({ option: 'COLLAR', side: 'BUY', cap_rate: 0.045, floor_rate: 0.03, vol_bp: 90.1, premium_amount: -2_500 })
    expect(body.legs).toHaveLength(1)
    expect(body.legs[0].leg_ref).toBe('OPT-1')
    expect(body.legs[0].embedded_options).toEqual([
      { type: 'CAP',   direction: 'BUY',  default_strike: 0.045, strike_schedule: [{ date: '2026-11-04', strike: 0.045 }] },
      { type: 'FLOOR', direction: 'SELL', default_strike: 0.03,  strike_schedule: [{ date: '2026-11-04', strike: 0.03 }] },
    ])
    // a sold collar is the mirror image
    const sold = buildBookingBody({ ...capState, productKey: 'RATES_COLLAR', floorRate: '3.0', optionSide: 'SELL' }, 'PAY', extras)
    expect(sold.terms.side).toBe('SELL')
    expect(sold.legs[0].embedded_options.map(e => [e.type, e.direction])).toEqual([['CAP', 'SELL'], ['FLOOR', 'BUY']])
  })

  it('books a sold floor, the strike at its default when untouched', () => {
    const { capRate: _c, floorRate: _f, ...untouched } = capState
    const body = buildBookingBody({ ...untouched, productKey: 'RATES_FLOOR', optionSide: 'SELL' }, 'PAY', extras)
    expect(body.instrument_type).toBe('IR_FLOOR')
    expect(body.terms).toMatchObject({ option: 'FLOOR', side: 'SELL', cap_rate: null, floor_rate: 0.03, vol_bp: null, premium_amount: null })
    expect(body.legs[0].embedded_options).toEqual([
      { type: 'FLOOR', direction: 'SELL', default_strike: 0.03, strike_schedule: [{ date: '2026-11-04', strike: 0.03 }] },
    ])
  })
})

describe('executeBooking', () => {
  it('names the canonical instrument types and refuses anything else before any request', async () => {
    expect(INSTRUMENT_OF).toEqual({ IR_SWAP: 'IR_SWAP', IR_SWAPTION: 'IR_SWAPTION', RATES_CAP: 'IR_CAP', RATES_FLOOR: 'IR_FLOOR', RATES_COLLAR: 'IR_COLLAR' })
    await expect(executeBooking({ state: { ...swapState, productKey: 'FX_FORWARD' }, direction: 'PAY' })).rejects.toThrow(/FX_FORWARD/)
    await expect(executeBooking({ state: { ...capState, notional: 0 }, direction: 'PAY' })).rejects.toThrow(/Notional/)
  })
})

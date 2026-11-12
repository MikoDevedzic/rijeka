// trade-window/booking.js
// ─────────────────────────────────────────────────────────────────────────────
// Sprint 12 item 3: atomic booking pipeline + lifecycle transitions.
//
// Exports:
//   executeBooking({ state, direction, extras })   atomic BOOKED + price
//   confirmTrade(tradeId, extras?)                 PENDING -> CONFIRMED
//   cancelTrade(tradeId, reason?, extras?)         PENDING -> CANCELLED
//   buildLegs, buildBookingBody                    helpers for executeBooking
//
// executeBooking replaces the three sequential HTTP calls from Sprint 10 Patch 6
// (POST /api/trades/ + N× POST /api/trade-legs/ + POST /price)
// with one atomic call + pricing:
//   1) POST /api/book/trade  (atomic BOOKED event + trade + legs)
//   2) POST /price           (cashflows, unchanged)
//
// confirmTrade + cancelTrade are atomic lifecycle transitions. Each hits a
// single backend endpoint that wraps (event insert + trade projection update
// + idempotency cache) in one Postgres transaction.
//
// All three atomic calls are idempotent via Idempotency-Key header (UUID).
// Each call generates a fresh UUID by default; a retry of the same logical
// operation can pass the same key via extras.idempotencyKey.
// ─────────────────────────────────────────────────────────────────────────────

import { withFees } from './fees'
import { toRateSchedule, toNotionalSchedule, toSpreadSchedule } from './schedule_translator'
import { getSessionMaybe } from '../../lib/session'
import { SWAPTION_DEFAULTS, CAPFLOOR_DEFAULTS, addDays, expiryShiftDays } from './product-defaults'

// Unified-window product key → the instrument_type the backend stores and the
// engines match on (ccr/options.py, pnl/valuation.py, pricing/ir_swap.py).
export const INSTRUMENT_OF = {
  IR_SWAP:      'IR_SWAP',
  IR_SWAPTION:  'IR_SWAPTION',
  RATES_CAP:    'IR_CAP',
  RATES_FLOOR:  'IR_FLOOR',
  RATES_COLLAR: 'IR_COLLAR',
}
const CAP_LIKE = new Set(['RATES_CAP', 'RATES_FLOOR', 'RATES_COLLAR'])

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

// Mirrors legacy TradeBookingWindow.CCY_CURVE
const CCY_CURVE = {
  USD: 'USD_SOFR', EUR: 'EUR_ESTR', GBP: 'GBP_SONIA',
  JPY: 'JPY_TONAR', CHF: 'CHF_SARON', AUD: 'AUD_AONIA',
  CAD: 'CAD_CORRA',
}

export const INDEX_CURVE = {
  'SOFR':'USD_SOFR','TERM SOFR 1M':'USD_TSOFR_1M','TERM SOFR 3M':'USD_TSOFR_3M',
  'TERM SOFR 6M':'USD_TSOFR_6M','EFFR':'USD_EFFR',
  '\u20acSTR':'EUR_ESTR','EURIBOR 1M':'EUR_ESTR','EURIBOR 3M':'EUR_EURIBOR_3M',
  'EURIBOR 6M':'EUR_EURIBOR_6M',
  'SONIA':'GBP_SONIA','TERM SONIA 3M':'GBP_SONIA_3M','TERM SONIA 6M':'GBP_SONIA_3M',
  'TONAR':'JPY_TONAR','TIBOR 3M':'JPY_TIBOR_3M','TIBOR 6M':'JPY_TIBOR_6M',
  'SARON':'CHF_SARON','TERM SARON 3M':'CHF_SARON_3M',
  'AONIA':'AUD_AONIA','BBSW 3M':'AUD_BBSW_3M','BBSW 6M':'AUD_BBSW_6M',
  'CORRA':'CAD_CORRA',
}

const INDEX_PAY_LAG = {
  'SOFR':2,'EFFR':2,'\u20acSTR':2,'SONIA':0,'TONAR':2,'SARON':2,'AONIA':0,'CORRA':2,
  'TERM SOFR 1M':0,'TERM SOFR 3M':0,'TERM SOFR 6M':0,
  'EURIBOR 1M':0,'EURIBOR 3M':0,'EURIBOR 6M':0,
  'TERM SONIA 3M':0,'TERM SONIA 6M':0,'TIBOR 3M':0,'TIBOR 6M':0,
  'TERM SARON 3M':0,'BBSW 3M':0,'BBSW 6M':0,
}

function parseCoupon(coupon) {
  if (typeof coupon === 'number') return coupon / 100
  const s = String(coupon || '').replace(/[^0-9.-]/g, '')
  const n = parseFloat(s)
  return isFinite(n) ? n / 100 : 0
}

function parseBps(v) {
  const n = parseFloat(String(v ?? '0'))
  return isNaN(n) ? 0 : n / 10000
}

function parseLev(v) {
  const n = parseFloat(String(v ?? '1.0'))
  return isNaN(n) ? 1.0 : n
}

function curveObj(curveId) {
  return { curve_id: curveId, quotes: [], interp_method: 'LogLinearDiscount' }
}

async function getSession() {
  const session = await getSessionMaybe()
  if (!session?.access_token) throw new Error('No session — please log in.')
  return session
}

/**
 * Build legs for the atomic booking payload. No trade_id or id (server assigns).
 *   IR_SWAP       VANILLA / OIS => fixed + float. BASIS => two floats.
 *   IR_SWAPTION   the underlying forward-starting swap: fixed + float, dates
 *                 shifted by the expiry, fixed_rate = the strike.
 *   RATES_CAP / RATES_FLOOR / RATES_COLLAR
 *                 one float leg OPT-1 with no participation in the rate
 *                 (leverage 0): only its embedded caplets / floorlets have value.
 * extras.priced is the last preview-pricing result (ATM strike, priced vol).
 */
export function buildLegs(state, direction, notional, extras = {}) {
  switch (state.productKey) {
    case 'IR_SWAP':     return buildSwapLegs(state, direction, notional)
    case 'IR_SWAPTION': return buildSwaptionLegs(state, direction, notional, extras)
    case 'RATES_CAP': case 'RATES_FLOOR': case 'RATES_COLLAR':
      return buildCapFloorLegs(state, direction, notional)
    default:
      throw new Error(
        'buildLegs: atomic booking supports IR_SWAP, IR_SWAPTION and the cap, ' +
        'floor and collar (got ' + state.productKey + ').'
      )
  }
}

function buildSwapLegs(state, direction, notional) {
  const ccy        = state.ccy || 'USD'
  const curveId    = CCY_CURVE[ccy] || 'USD_SOFR'
  const isOIS      = state.structure === 'OIS'
  const isBASIS    = state.structure === 'BASIS'
  const index      = state.index || 'SOFR'
  const forecastId = INDEX_CURVE[index] || curveId
  const payLag     = INDEX_PAY_LAG[index] != null ? INDEX_PAY_LAG[index] : 2

  const fixedRate = parseCoupon(state.coupon)
  const spread    = parseBps(state.spread)
  const leverage  = parseLev(state.leverage)
  const dir       = direction
  const floatDir  = dir === 'PAY' ? 'RECEIVE' : 'PAY'

  const byLegRef = state.customCashflowsByLegRef || {}

  if (isBASIS) {
    const index2      = state.index2 || 'EFFR'
    const forecastId2 = INDEX_CURVE[index2] || curveId
    return [
      {
        leg_ref: 'FLOAT-1', leg_seq: 1, leg_type: 'FLOAT',
        direction: dir, currency: ccy, notional, notional_type: 'BULLET',
        effective_date: state.effDate, maturity_date: state.matDate,
        day_count:         state.floatDc        || 'ACT/360',
        payment_frequency: state.floatPayFreq   || 'ANNUAL',
        reset_frequency:   state.floatResetFreq || 'DAILY',
        bdc:               state.floatBdc       || 'MOD_FOLLOWING',
        payment_calendar:  state.floatCal       || null,
        stub_type: 'SHORT_FRONT', payment_lag: payLag,
        fixed_rate: 0, spread: 0, leverage: 1.0,
        discount_curve_id: curveId, forecast_curve_id: forecastId,
        ois_compounding: null,
        terms: { custom_cashflows: byLegRef['FLOAT-1'] || [] },
      },
      {
        leg_ref: 'FLOAT-2', leg_seq: 2, leg_type: 'FLOAT',
        direction: floatDir,
        currency: ccy, notional, notional_type: 'BULLET',
        effective_date: state.effDate, maturity_date: state.matDate,
        day_count:         state.floatDc2        || 'ACT/360',
        payment_frequency: state.floatPayFreq2   || 'ANNUAL',
        reset_frequency:   state.floatResetFreq2 || 'DAILY',
        bdc:               state.floatBdc        || 'MOD_FOLLOWING',
        payment_calendar:  state.floatCal        || null,
        stub_type: 'SHORT_FRONT', payment_lag: payLag,
        fixed_rate: 0, spread, leverage: 1.0,
        discount_curve_id: curveId, forecast_curve_id: forecastId2,
        ois_compounding: null,
        terms: { custom_cashflows: byLegRef['FLOAT-2'] || [] },
      },
    ]
  }

  // VANILLA or OIS: fixed + float.
  const fixedLeg = {
    leg_ref: 'FIXED-1', leg_seq: 1, leg_type: 'FIXED',
    direction: dir, currency: ccy, notional, notional_type: 'BULLET',
    effective_date: state.effDate, maturity_date: state.matDate,
    day_count:         state.fixedDc      || 'ACT/360',
    payment_frequency: state.fixedPayFreq || 'ANNUAL',
    bdc:               state.fixedBdc     || 'MOD_FOLLOWING',
    payment_calendar:  state.fixedCal     || null,
    stub_type: 'SHORT_FRONT', payment_lag: payLag,
    fixed_rate: fixedRate,
    fixed_rate_schedule: toRateSchedule(state.rateSchedule),
    notional_schedule:   toNotionalSchedule(state.notionalSchedule),
    discount_curve_id: curveId, forecast_curve_id: null,
    ois_compounding: null,
    terms: { custom_cashflows: byLegRef['FIXED-1'] || [] },
  }
  const floatLeg = {
    leg_ref: 'FLOAT-1', leg_seq: 2, leg_type: 'FLOAT',
    direction: floatDir, currency: ccy, notional, notional_type: 'BULLET',
    effective_date: state.effDate, maturity_date: state.matDate,
    day_count:         state.floatDc        || 'ACT/360',
    payment_frequency: state.floatPayFreq   || 'ANNUAL',
    reset_frequency:   isOIS ? 'DAILY' : (state.floatResetFreq || 'DAILY'),
    bdc:               state.floatBdc       || 'MOD_FOLLOWING',
    payment_calendar:  state.floatCal       || null,
    stub_type: 'SHORT_FRONT', payment_lag: payLag,
    fixed_rate: 0,
    spread,
    spread_schedule: toSpreadSchedule(state.spreadSchedule),
    leverage,
    notional_schedule: toNotionalSchedule(state.notionalSchedule),
    discount_curve_id: curveId, forecast_curve_id: forecastId,
    ois_compounding: isOIS ? 'COMPOUNDING' : null,
    terms: { custom_cashflows: byLegRef['FLOAT-1'] || [] },
  }
  return [fixedLeg, floatLeg]
}

// ── Option products ──────────────────────────────────────────────────────────
// Until November 2026 the legacy ticket booked these as the generic swap's legs
// and terms: a cap lost its strike, a swaption its expiry, vol and side, and the
// desk valued them as swaps. The option terms live on the trade (what the
// exposure engine and the P&L valuation read: ccr/options.swaption_terms,
// pnl/valuation._value_swaption) and the strikes on the float leg's
// embedded_options (what the pricers read).

/** The premium in currency: OptionFeeBlock's PREMIUM AMOUNT in bp of notional
 *  or in currency (state.premiumMode). Null when none was entered. */
function premiumAmount(state, notional) {
  const n = parseFloat(String(state.premium ?? '').replace(/[^0-9.-]/g, ''))
  if (!isFinite(n) || n === 0) return null
  return (state.premiumMode || 'BP') === 'BP' ? (n / 10000) * notional : n
}

/** The swaption's strike as a decimal: the STRIKE field, or blank = the ATM
 *  forward the last /api/price/swaption call computed. */
function swaptionStrike(state, extras) {
  const raw = String(state.strike ?? SWAPTION_DEFAULTS.strike).trim()
  if (raw !== '') {
    const k = parseFloat(raw)
    if (!isFinite(k)) throw new Error('Strike must be a number (percent) or blank for ATM.')
    return k / 100
  }
  const fwd = extras.priced?.forward_rate
  if (fwd == null || !isFinite(Number(fwd))) {
    throw new Error('Strike is blank (ATM): price the swaption first so the ATM forward is known.')
  }
  return Number(fwd)
}

function buildSwaptionLegs(state, direction, notional, extras = {}) {
  const shift  = expiryShiftDays(state.expiry)
  const strike = swaptionStrike(state, extras)
  // The underlying is the forward-starting swap the option delivers into,
  // struck at the option's strike.
  return buildSwapLegs({ ...state, structure: 'VANILLA' }, direction, notional).map(l => ({
    ...l,
    effective_date: addDays(state.effDate, shift),
    maturity_date:  addDays(state.matDate, shift),
    ...(l.leg_type === 'FIXED' ? { fixed_rate: strike } : {}),
  }))
}

/** The cap-like products' strikes as decimals; null when the product has no
 *  such leg (a cap has no floor_rate). */
function capFloorRates(state) {
  const pct = v => { const n = parseFloat(String(v)); return isFinite(n) ? n / 100 : NaN }
  const hasCap   = state.productKey === 'RATES_CAP'   || state.productKey === 'RATES_COLLAR'
  const hasFloor = state.productKey === 'RATES_FLOOR' || state.productKey === 'RATES_COLLAR'
  const cap   = hasCap   ? pct(state.capRate   ?? CAPFLOOR_DEFAULTS.capRate)   : null
  const floor = hasFloor ? pct(state.floorRate ?? CAPFLOOR_DEFAULTS.floorRate) : null
  if (hasCap   && isNaN(cap))   throw new Error('Cap rate must be a number (percent).')
  if (hasFloor && isNaN(floor)) throw new Error('Floor rate must be a number (percent).')
  return { cap, floor }
}

function buildCapFloorLegs(state, direction, notional) {
  const ccy        = state.ccy || 'USD'
  const curveId    = CCY_CURVE[ccy] || 'USD_SOFR'
  const index      = state.index || 'SOFR'
  const forecastId = INDEX_CURVE[index] || curveId
  const payLag     = INDEX_PAY_LAG[index] != null ? INDEX_PAY_LAG[index] : 2
  const side       = state.optionSide || CAPFLOOR_DEFAULTS.optionSide
  const theirs     = side === 'BUY' ? 'SELL' : 'BUY'
  const { cap, floor } = capFloorRates(state)
  const strikeEntry = (type, dir, k) => ({
    type, direction: dir, default_strike: k,
    strike_schedule: [{ date: state.effDate, strike: k }],
  })
  // BUY: we own the cap (and, in a collar, sold the floor).
  const embedded = []
  if (cap   != null) embedded.push(strikeEntry('CAP',   side, cap))
  if (floor != null) embedded.push(strikeEntry('FLOOR', state.productKey === 'RATES_COLLAR' ? theirs : side, floor))
  return [{
    leg_ref: 'OPT-1', leg_seq: 1, leg_type: 'FLOAT',
    direction: 'RECEIVE', currency: ccy, notional, notional_type: 'BULLET',
    effective_date: state.effDate, maturity_date: state.matDate,
    day_count:         state.capDayCount  || CAPFLOOR_DEFAULTS.capDayCount,
    payment_frequency: state.capPayFreq   || CAPFLOOR_DEFAULTS.capPayFreq,
    reset_frequency:   state.capResetFreq || CAPFLOOR_DEFAULTS.capResetFreq,
    bdc:               state.floatBdc     || 'MOD_FOLLOWING',
    payment_calendar:  state.floatCal     || null,
    stub_type: 'SHORT_FRONT', payment_lag: payLag,
    fixed_rate: 0, spread: 0, spread_schedule: null, leverage: 0,
    discount_curve_id: curveId, forecast_curve_id: forecastId,
    ois_compounding: null,
    embedded_options: embedded,
    terms: {},
  }]
}

/** The vanilla (fixed-for-float) swap terms. Shared by the swap and, with the
 *  strike as the fixed rate, the swaption's underlying. */
function vanillaTerms(state, direction, fixedRate) {
  const dir      = direction
  const floatDir = dir === 'PAY' ? 'RECEIVE' : 'PAY'
  return {
    direction: dir, float_direction: floatDir,
    fixed_rate:      fixedRate || null,
    fixed_pay_freq:  state.fixedPayFreq || 'ANNUAL',
    fixed_day_count: state.fixedDc      || 'ACT/360',
    fixed_bdc:       state.fixedBdc     || 'MOD_FOLLOWING',
    fixed_calendar:  state.fixedCal     || null,
    float_index:      state.index           || 'SOFR',
    float_reset_freq: state.floatResetFreq  || 'DAILY',
    float_pay_freq:   state.floatPayFreq    || 'ANNUAL',
    float_day_count:  state.floatDc         || 'ACT/360',
    float_bdc:        state.floatBdc        || 'MOD_FOLLOWING',
    float_calendar:   state.floatCal        || null,
    spread:   parseBps(state.spread),
    leverage: parseLev(state.leverage),
  }
}

/** POST /api/book/trade body for IR_SWAPTION. */
export function buildSwaptionBookingBody(state, direction, extras = {}) {
  const notional  = Number(state.notional) || 0
  const ccy       = state.ccy || 'USD'
  const expiry    = state.expiry ?? SWAPTION_DEFAULTS.expiry
  const shift     = expiryShiftDays(expiry)
  const strike    = swaptionStrike(state, extras)
  const structure = state.structure || 'EUROPEAN'
  const volBp     = parseFloat(String(state.volBp ?? SWAPTION_DEFAULTS.volBp))
  const terms = {
    ...vanillaTerms(state, direction, strike),
    option: 'SWAPTION',
    side: state.optionSide || SWAPTION_DEFAULTS.optionSide,
    is_payer: direction === 'PAY',
    expiry_date: addDays(state.valDate, shift),
    expiry_tenor: expiry,
    exercise_type: structure,
    ...(structure === 'BERMUDAN' && Array.isArray(state.exerciseScheduleY) && state.exerciseScheduleY.length
      ? { exercise_schedule_y: state.exerciseScheduleY.map(Number).filter(t => Number.isFinite(t) && t > 0).sort((a, b) => a - b) }
      : {}),
    strike,
    vol_bp: isFinite(volBp) ? volBp : null,
    premium_amount: premiumAmount(state, notional),
    premium_currency: ccy,
    premium_payment_date: state.settleDate || state.effDate,
  }
  return {
    store: extras.store || 'WORKING',
    asset_class: 'RATES',
    instrument_type: INSTRUMENT_OF.IR_SWAPTION,
    structure,
    own_legal_entity_id: extras.ownEntityId   || null,
    counterparty_id:     extras.counterpartyId || null,
    notional,
    notional_ccy: ccy,
    trade_date:     state.tradeDate,
    effective_date: state.effDate,
    maturity_date:  state.matDate,
    desk: extras.desk || null,
    book: extras.book || null,
    terms,
    legs: buildLegs(state, direction, notional, extras),
  }
}

/** POST /api/book/trade body for RATES_CAP / RATES_FLOOR / RATES_COLLAR. */
export function buildCapFloorBookingBody(state, direction, extras = {}) {
  const notional = Number(state.notional) || 0
  const ccy      = state.ccy || 'USD'
  const { cap, floor } = capFloorRates(state)
  const priced   = extras.priced || null
  const volOv    = parseFloat(String(state.volOverride ?? CAPFLOOR_DEFAULTS.volOverride))
  const pricedVol = priced?.vol_bp ?? priced?.cap_vol_bp ?? null
  const pricedNpv = priced?.npv ?? priced?.net_npv ?? null
  const terms = {
    option: INSTRUMENT_OF[state.productKey].replace('IR_', ''),
    side: state.optionSide || CAPFLOOR_DEFAULTS.optionSide,
    cap_rate: cap, floor_rate: floor,
    vol_bp: isFinite(volOv) ? volOv : pricedVol,
    premium_amount: premiumAmount(state, notional) ?? pricedNpv,
    premium_currency: ccy,
    premium_payment_date: state.settleDate || state.effDate,
    direction, float_direction: 'RECEIVE',
    float_index:      state.index        || 'SOFR',
    float_reset_freq: state.capResetFreq || CAPFLOOR_DEFAULTS.capResetFreq,
    float_pay_freq:   state.capPayFreq   || CAPFLOOR_DEFAULTS.capPayFreq,
    float_day_count:  state.capDayCount  || CAPFLOOR_DEFAULTS.capDayCount,
    float_bdc:        state.floatBdc     || 'MOD_FOLLOWING',
    float_calendar:   state.floatCal     || null,
    spread: 0, leverage: 0,
  }
  return {
    store: extras.store || 'WORKING',
    asset_class: 'RATES',
    instrument_type: INSTRUMENT_OF[state.productKey],
    structure: null,
    own_legal_entity_id: extras.ownEntityId   || null,
    counterparty_id:     extras.counterpartyId || null,
    notional,
    notional_ccy: ccy,
    trade_date:     state.tradeDate,
    effective_date: state.effDate,
    maturity_date:  state.matDate,
    desk: extras.desk || null,
    book: extras.book || null,
    terms,
    legs: buildLegs(state, direction, notional, extras),
  }
}

/**
 * Build the /api/book/trade atomic body from shell state.
 * Includes both trade-level fields AND legs in one payload.
 * Dispatches on state.productKey; the IR_SWAP body is unchanged since Sprint 12.
 */
export function buildBookingBody(state, direction, extras = {}) {
  // extras.fees: the ticket's fees as cleanFees gives them (fees.js): a list, or null while a row is not complete
  if (extras.fees === null) throw new Error('A fee on the TRADE tab is not complete: finish or remove it before booking.')
  return withFees(bodyWithoutFees(state, direction, extras), extras.fees)
}

function bodyWithoutFees(state, direction, extras = {}) {
  if (state.productKey === 'IR_SWAPTION') return buildSwaptionBookingBody(state, direction, extras)
  if (CAP_LIKE.has(state.productKey))     return buildCapFloorBookingBody(state, direction, extras)
  if (state.productKey !== 'IR_SWAP') {
    throw new Error('buildBookingBody: unsupported product ' + state.productKey)
  }
  const fixedRate = parseCoupon(state.coupon)
  const isBASIS   = state.structure === 'BASIS'
  const dir       = direction

  const terms = isBASIS
    ? {
        direction: dir,
        index1: state.index  || 'SOFR',
        index2: state.index2 || 'EFFR',
        spread: parseBps(state.spread),
        float_reset_freq:  state.floatResetFreq  || 'DAILY',
        float_pay_freq:    state.floatPayFreq    || 'ANNUAL',
        float_day_count:   state.floatDc         || 'ACT/360',
        float_bdc:         state.floatBdc        || 'MOD_FOLLOWING',
        float_reset_freq2: state.floatResetFreq2 || 'DAILY',
        float_pay_freq2:   state.floatPayFreq2   || 'ANNUAL',
        float_day_count2:  state.floatDc2        || 'ACT/360',
      }
    : vanillaTerms(state, dir, fixedRate)

  const notional = Number(state.notional) || 0

  return {
    store: extras.store || 'WORKING',
    asset_class: 'RATES',
    instrument_type: 'IR_SWAP',
    structure: state.structure || 'VANILLA',
    own_legal_entity_id: extras.ownEntityId   || null,
    counterparty_id:     extras.counterpartyId || null,
    notional,
    notional_ccy: state.ccy || 'USD',
    trade_date:     state.tradeDate,
    effective_date: state.effDate,
    maturity_date:  state.matDate,
    desk: extras.desk || null,
    book: extras.book || null,
    terms,
    legs: buildLegs(state, direction, notional),
  }
}

/**
 * Atomic booking pipeline:
 *   1) POST /api/book/trade    (BOOKED event + trade + legs in one Postgres txn)
 *   2) POST /price             (cashflow generation, unchanged)
 *
 * Returns: { trade, priceData, legs, eventId, idempotentReplay }
 * Throws on any failure. Caller handles UI state + store refresh.
 *
 * Idempotency: caller may pass `idempotencyKey` in extras; if omitted,
 * one is generated per call. Retrying the same call instance with the
 * same key returns the same result without double-booking.
 */
export async function executeBooking({ state, direction, extras = {} }) {
  if (!INSTRUMENT_OF[state.productKey]) {
    throw new Error(
      'Atomic booking supports IR_SWAP, IR_SWAPTION and the cap, floor and collar ' +
      '(got ' + state.productKey + ').'
    )
  }
  if (!state.notional || Number(state.notional) <= 0) throw new Error('Notional is required.')
  if (!state.effDate || !state.matDate)               throw new Error('Effective and maturity dates are required.')
  if (!state.tradeDate)                               throw new Error('Trade date is required.')
  if (!state.valDate)                                 throw new Error('Valuation date is required.')

  const session = await getSession()
  const idempotencyKey = extras.idempotencyKey || crypto.randomUUID()
  const headers = {
    Authorization: 'Bearer ' + session.access_token,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  }

  // 1) Atomic BOOKED event + trade + legs
  const body = buildBookingBody(state, direction, extras)
  const bookRes = await fetch(API + '/api/book/trade', {
    method: 'POST', headers, body: JSON.stringify(body),
  })
  if (!bookRes.ok) {
    const e = await bookRes.json().catch(() => ({}))
    throw new Error(e.detail || 'Atomic booking failed (HTTP ' + bookRes.status + ')')
  }
  const { trade, legs, event_id, idempotent_replay } = await bookRes.json()
  const tradeId = trade.id

  // 2) Initial valuation — persists cashflows
  const curveId = CCY_CURVE[state.ccy] || 'USD_SOFR'
  const priceRes = await fetch(API + '/price', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      trade_id: tradeId,
      valuation_date: state.valDate,
      curves: [curveObj(curveId)],
    }),
  })
  if (!priceRes.ok) {
    const e = await priceRes.json().catch(() => ({}))
    throw new Error(e.detail || 'Initial valuation failed')
  }
  const priceData = await priceRes.json()

  return {
    trade,
    priceData,
    legs,
    eventId: event_id,
    idempotentReplay: !!idempotent_replay,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint 12 item 3 siblings: atomic lifecycle transitions
//
// Both POST to /api/trade-events/{confirm|cancel}/{trade_id}. The backend
// wraps (TradeEvent insert + trade projection update + idempotency cache)
// in a single Postgres transaction. State machine is enforced server-side:
// only PENDING trades can transition. Non-PENDING returns 409 with a
// human-readable detail message that the UI can surface directly.
//
// Both return { trade, legs, eventId, idempotentReplay }. The returned
// `trade.status` is authoritative (CONFIRMED or CANCELLED). Caller should
// refetch the blotter so the row reflects the new status.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PENDING -> CONFIRMED.
 * @param {string} tradeId - UUID of the trade to confirm.
 * @param {object} [extras] - optional { idempotencyKey }.
 * @returns {Promise<{ trade, legs, eventId, idempotentReplay }>}
 */
export async function confirmTrade(tradeId, extras = {}) {
  if (!tradeId) throw new Error('trade_id is required.')

  const session = await getSession()
  const idempotencyKey = extras.idempotencyKey || crypto.randomUUID()
  const headers = {
    Authorization: 'Bearer ' + session.access_token,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  }

  const res = await fetch(API + '/api/trade-events/confirm/' + tradeId, {
    method: 'POST',
    headers,
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.detail || 'Confirm failed (HTTP ' + res.status + ')')
  }

  const { trade, legs, event_id, idempotent_replay } = await res.json()
  return {
    trade,
    legs,
    eventId: event_id,
    idempotentReplay: !!idempotent_replay,
  }
}

/**
 * PENDING -> CANCELLED (terminal).
 * @param {string} tradeId - UUID of the trade to cancel.
 * @param {string|null} [reason] - optional cancellation reason (audit trail).
 * @param {object} [extras] - optional { idempotencyKey }.
 * @returns {Promise<{ trade, legs, eventId, idempotentReplay }>}
 */
export async function cancelTrade(tradeId, reason = null, extras = {}) {
  if (!tradeId) throw new Error('trade_id is required.')

  const session = await getSession()
  const idempotencyKey = extras.idempotencyKey || crypto.randomUUID()
  const headers = {
    Authorization: 'Bearer ' + session.access_token,
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  }

  const fetchOptions = { method: 'POST', headers }
  if (reason && String(reason).trim()) {
    fetchOptions.body = JSON.stringify({ reason: String(reason).trim() })
  }

  const res = await fetch(API + '/api/trade-events/cancel/' + tradeId, fetchOptions)
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    throw new Error(e.detail || 'Cancel failed (HTTP ' + res.status + ')')
  }

  const { trade, legs, event_id, idempotent_replay } = await res.json()
  return {
    trade,
    legs,
    eventId: event_id,
    idempotentReplay: !!idempotent_replay,
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// On-chain confirmation (backend/api/routes/chain.py)
// ─────────────────────────────────────────────────────────────────────────────

async function _authed(path, method = 'GET', extraHeaders = {}) {
  const session = await getSession()
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json', ...extraHeaders },
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    const err = new Error(e.detail || (method + ' ' + path + ' failed (HTTP ' + res.status + ')'))
    err.status = res.status
    throw err
  }
  return res.json()
}

/** PENDING -> CONFIRMED with both parties' EIP-712 signatures over the
 *  canonical trade hash, anchored on-chain when a chain is configured.
 *  When the transaction is sent but not mined within the API's wait (25 s) the
 *  route answers 202 and this resolves { pending: true, tx_hash, explorer_tx,
 *  note, trade, legs }: the trade is still PENDING and ConfirmPanel polls
 *  reconcileAnchor() until the block arrives. */
export async function confirmTradeOnChain(tradeId, extras = {}) {
  if (!tradeId) throw new Error('trade_id is required.')
  const idempotencyKey = extras.idempotencyKey || crypto.randomUUID()
  const session = await getSession()
  const res = await fetch(API + '/api/chain/confirm/' + tradeId, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    const err = new Error(e.detail || ('POST /api/chain/confirm failed (HTTP ' + res.status + ')'))
    err.status = res.status
    throw err
  }
  const body = await res.json()
  if (res.status === 202 || body.pending) {
    return { pending: true, tx_hash: body.tx_hash || null, explorer_tx: body.explorer_tx || null, note: body.note || null,
             submitted_at: body.submitted_at || null, trade: body.trade, legs: body.legs || [], eventId: null, idempotentReplay: false }
  }
  const { trade, legs, event_id, idempotent_replay } = body
  return { pending: false, trade, legs, eventId: event_id, idempotentReplay: !!idempotent_replay }
}

/** A package of legs booked whole (backend api/routes/booking.py, POST /api/book/package): every leg or none, in
 *  one transaction. The server names the package (its trade ID, TRD-12345678) and each leg (TRD-12345678-1, ...).
 *  Resolves { package: { trade_id, structure, legs }, trades: [the leg trades, in order] }. */
export async function bookPackage(structure, legs, extras = {}) {
  const session = await getSession()
  const res = await fetch(API + '/api/book/package', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json', 'Idempotency-Key': extras.idempotencyKey || crypto.randomUUID() },
    body: JSON.stringify({ structure, legs }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(typeof j.detail === 'string' ? j.detail : (j.detail ? JSON.stringify(j.detail) : 'Booking the package failed (HTTP ' + res.status + ')')), { status: res.status })
  return j
}

/** One confirmation for a package (POST /api/chain/confirm-package): every leg PENDING -> CONFIRMED together, the
 *  package record (the legs' hashes) signed by both parties and anchored once. Resolves
 *  { package: { trade_id, legs, hash, record, anchor }, trades: [the legs, CONFIRMED] }. */
export async function confirmPackageOnChain(tradeIds, extras = {}) {
  const session = await getSession()
  const res = await fetch(API + '/api/chain/confirm-package', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json', 'Idempotency-Key': extras.idempotencyKey || crypto.randomUUID() },
    body: JSON.stringify({ trade_ids: tradeIds }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(typeof j.detail === 'string' ? j.detail : 'POST /api/chain/confirm-package failed (HTTP ' + res.status + ')'), { status: res.status })
  return j
}

/** Where an anchor in flight stands (backend chain/pending.py): { pending, tx_hash, explorer_tx, note }
 *  while the transaction waits for a block; { applied: true, status: 'CONFIRMED', trade, legs } once the
 *  CONFIRMED event is written; { failed: true, reason } when it reverted or was dropped. */
export function reconcileAnchor(tradeId) { return _authed('/api/chain/reconcile/' + tradeId, 'POST') }

export function getAttestation(tradeId) { return _authed('/api/chain/attestation/' + tradeId) }
export function verifyTradeOnChain(tradeId) { return _authed('/api/chain/verify/' + tradeId, 'POST') }
export function chainStatus() { return _authed('/api/chain/status') }

/** Self-contained proof pack: canonical record + hash + both signatures +
 *  where it is anchored. Everything a third party needs to verify without us. */
export function getProofPack(tradeId) { return _authed('/api/chain/proof/' + tradeId) }

async function _authedJson(path, method, body, extraHeaders = {}) {
  const session = await getSession()
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json', ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    const err = new Error(e.detail || (method + ' ' + path + ' failed (HTTP ' + res.status + ')'))
    err.status = res.status
    throw err
  }
  return res.json()
}

/** Lifecycle on an anchored trade. Both need the counterparty's signature
 *  unless Rijeka holds their key (demo). See chain/README.md. */
export function amendRequest(tradeId, changes) { return _authedJson('/api/chain/amend-request/' + tradeId, 'POST', { changes }) }
export function amendOnChain(tradeId, changes, sig = {}) {
  return _authedJson('/api/chain/amend/' + tradeId, 'POST', { changes, ...sig }, { 'Idempotency-Key': crypto.randomUUID() })
}
/** A partial termination: the trade stays on the notional that remains, with the unwind fee among its fees. The
 *  API works out what changes; an anchored trade's record is superseded on-chain with both signatures. */
export function partialTerminate(tradeId, body, sig = {}) {
  return _authedJson('/api/chain/partial-terminate/' + tradeId, 'POST', { ...body, ...sig }, { 'Idempotency-Key': crypto.randomUUID() })
}
export function terminateRequest(tradeId) { return _authed('/api/chain/terminate-request/' + tradeId) }
export function terminateOnChain(tradeId, sig = {}, reason = null) {
  return _authedJson('/api/chain/terminate/' + tradeId, 'POST', { ...sig, reason }, { 'Idempotency-Key': crypto.randomUUID() })
}

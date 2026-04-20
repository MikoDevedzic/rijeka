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

import { supabase } from '../../lib/supabase'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

// Mirrors legacy TradeBookingWindow.CCY_CURVE
const CCY_CURVE = {
  USD: 'USD_SOFR', EUR: 'EUR_ESTR', GBP: 'GBP_SONIA',
  JPY: 'JPY_TONA', CHF: 'CHF_SARON', AUD: 'AUD_AONIA',
  CAD: 'CAD_CORRA',
}

const INDEX_CURVE = {
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
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('No session — please log in.')
  return session
}

/**
 * Build legs for the atomic booking payload. No trade_id or id (server assigns).
 * IR_SWAP only. VANILLA / OIS => fixed + float. BASIS => two floats.
 */
export function buildLegs(state, direction, notional) {
  if (state.productKey !== 'IR_SWAP') {
    throw new Error(
      'buildLegs: only IR_SWAP is supported in atomic booking (got ' +
      state.productKey + ').'
    )
  }

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
    fixed_rate_schedule: null,
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
    spread_schedule: null,
    leverage,
    discount_curve_id: curveId, forecast_curve_id: forecastId,
    ois_compounding: isOIS ? 'COMPOUNDING' : null,
    terms: { custom_cashflows: byLegRef['FLOAT-1'] || [] },
  }
  return [fixedLeg, floatLeg]
}

/**
 * Build the /api/book/trade atomic body from shell state.
 * Includes both trade-level fields AND legs in one payload.
 */
export function buildBookingBody(state, direction, extras) {
  const fixedRate = parseCoupon(state.coupon)
  const isBASIS   = state.structure === 'BASIS'
  const dir       = direction
  const floatDir  = dir === 'PAY' ? 'RECEIVE' : 'PAY'

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
    : {
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
  if (state.productKey !== 'IR_SWAP') {
    throw new Error(
      'Atomic booking currently supports IR_SWAP only. ' +
      'Other products still book via legacy path.'
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

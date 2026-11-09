// trade-window/products/rates.js
// ─────────────────────────────────────────────────────────────────────────────
// All 5 current rates products as Product Registry adapters.
//
// Each descriptor is a pure data+function declaration — no React rendering
// happens at module load. The TradeWindow calls the Component when needed.
//
// This file replaces the hard-coded per-product branching in the old
// TradeBookingWindow.jsx. Adding RATES_INFLATION_SWAP or RATES_CMS_SWAPTION
// later = append a new descriptor; no core changes.
//
// The Component imports below are thin wrappers around the existing form
// fragments — migration keeps all current validation logic intact, just
// mounts it via the unified shell.
// ─────────────────────────────────────────────────────────────────────────────

import { registerProduct } from '../registry'
import { SwapTermsBody, SwaptionTermsBody, CapTermsBody,
         FloorTermsBody, CollarTermsBody } from '../product-terms'
import { toRateSchedule, toNotionalSchedule, toSpreadSchedule } from '../schedule_translator'
import { TENOR_Y as TENOR_Y_MAP, FREQ_PER_YEAR, SWAPTION_DEFAULTS, CAPFLOOR_DEFAULTS,
         addDays, expiryYears, expiryShiftDays } from '../product-defaults'

// ── Shared helpers ──────────────────────────────────────────────────────────

// a figure that rounds to zero is "$0": no sign, no colour (never "−$0")
const fmtCurrency = v => {
  if (v == null) return '—'
  const n = Math.round(v)
  return (n > 0 ? '+' : n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString()
}

const signClass = v => (v == null || Math.round(v) === 0) ? null : (v > 0 ? 'positive' : 'negative')

const metricCurrency = (label, value) => ({
  label, value: fmtCurrency(value), format: 'currency', colorBy: signClass(value)
})

const metricBp = (label, value) => ({
  label, value: value == null ? '—' : `${value.toFixed(1)}bp`, format: 'bp', colorBy: 'info'
})

const metricPct = (label, value) => ({
  label, value: value == null ? '—' : `${(value * 100).toFixed(4)}%`, format: 'pct', colorBy: 'info'
})

// ── Pricing constants (mirror legacy TradeBookingWindow.jsx) ─────────────

const CCY_CURVE = {
  USD: 'USD_SOFR', EUR: 'EUR_ESTR', GBP: 'GBP_SONIA',
  JPY: 'JPY_TONAR', CHF: 'CHF_SARON', AUD: 'AUD_AONIA',
  CAD: 'CAD_CORRA',
}

const INDEX_CURVE = {
  'SOFR':'USD_SOFR','TERM SOFR 1M':'USD_TSOFR_1M','TERM SOFR 3M':'USD_TSOFR_3M',
  'TERM SOFR 6M':'USD_TSOFR_6M','EFFR':'USD_EFFR',
  '\u20acSTR':'EUR_ESTR','EURIBOR 1M':'EUR_ESTR','EURIBOR 3M':'EUR_EURIBOR_3M','EURIBOR 6M':'EUR_EURIBOR_6M',
  'SONIA':'GBP_SONIA','TERM SONIA 3M':'GBP_SONIA_3M','TERM SONIA 6M':'GBP_SONIA_3M',
  'TONAR':'JPY_TONAR','TIBOR 3M':'JPY_TIBOR_3M','TIBOR 6M':'JPY_TIBOR_6M',
  'SARON':'CHF_SARON','TERM SARON 3M':'CHF_SARON_3M',
  'AONIA':'AUD_AONIA','BBSW 3M':'AUD_BBSW_3M','BBSW 6M':'AUD_BBSW_6M',
  'CORRA':'CAD_CORRA',
}

// OIS indices: T+2 payment lag (SONIA/AONIA T+0). IBOR/Term: T+0.
const INDEX_PAY_LAG = {
  'SOFR':2,'EFFR':2,'\u20acSTR':2,'SONIA':0,'TONAR':2,'SARON':2,'AONIA':0,'CORRA':2,
  'TERM SOFR 1M':0,'TERM SOFR 3M':0,'TERM SOFR 6M':0,
  'EURIBOR 1M':0,'EURIBOR 3M':0,'EURIBOR 6M':0,
  'TERM SONIA 3M':0,'TERM SONIA 6M':0,'TIBOR 3M':0,'TIBOR 6M':0,
  'TERM SARON 3M':0,'BBSW 3M':0,'BBSW 6M':0,
}

// Tenor and frequency tables, and the option products' field defaults, are
// shared with the TERMS bodies and the booking: ../product-defaults.js.

// ── IR SWAP ─────────────────────────────────────────────────────────────────

registerProduct({
  key: 'IR_SWAP',
  label: 'IR Swap',
  assetClass: 'RATES',

  structures: [
    { key: 'VANILLA',          label: 'VANILLA'         },
    { key: 'OIS',              label: 'OIS'             },
    { key: 'BASIS',            label: 'BASIS'           },
    { key: 'AMORTIZING',       label: 'AMORTIZING'      },
    // L32: CAPPED_FLOATER / FLOORED_FLOATER retired (Sprint 13 / migration 008b) - use leg-level embedded_options
    { key: 'ZERO_COUPON',      label: 'ZERO COUPON SOON', live: false },
    { key: 'STEP_UP',          label: 'STEP UP SOON',     live: false },
  ],
  defaultStructure: 'VANILLA',

  direction: state => state.structure === 'BASIS'
    ? { pay: 'PAY LEG 1', receive: 'RECEIVE LEG 1' }
    : { pay: 'PAY FIXED', receive: 'RECEIVE FIXED' },

  terms: {
    title: 'SWAP TERMS',
    helper: state => ({
      text: state.structure === 'BASIS'
        ? '↔ floating-for-floating basis swap'
        : '→ fixed-for-float · OIS discounting',
      color: state.structure === 'BASIS' ? 'var(--amber)' : 'var(--blue)',
    }),
    footerText: 'Full revaluation · log-linear DF interp · OIS discounting',
    Component: SwapTermsBody,
  },

  optionFee: null,

  analytics: {
    metrics: r => [
      metricCurrency('NET NPV',   r.npv),
      metricCurrency('IR01',      r.ir01),
      metricCurrency('IR01 DISC', r.ir01_disc),
      metricCurrency('THETA',     r.theta),
      metricPct    ('FWD RATE',   r.fwd_rate),
    ],
    breakdown: r => r.legs ? {
      kind: 'legs',
      columns: ['LEG','TYPE','DIR','CCY','PV','IR01','IR01 DISC','GAMMA','THETA'],
      rows: r.legs.map(l => [
        l.leg_ref, l.leg_type, l.direction, l.currency,
        fmtCurrency(l.pv), fmtCurrency(l.ir01),
        fmtCurrency(l.ir01_disc), l.gamma?.toFixed(4) ?? '—',
        fmtCurrency(l.theta),
      ]),
    } : null,
  },

  footer: {
    metrics: r => [
      metricCurrency('NET NPV',   r.npv),
      metricCurrency('IR01',      r.ir01),
      metricCurrency('IR01 DISC', r.ir01_disc),
      metricCurrency('THETA',     r.theta),
    ],
    structureLabel: state => state.structure || 'VANILLA',
  },

  pricing: {
    endpoint: '/price/preview',
    // The coupon is still blank because the par rate is being solved (product-terms.jsx): pricing now would
    // strike the fixed leg at 0 % and show a par swap worth millions. The window waits for the solve instead.
    // Only while a solve can actually be on its way: without the schedule dates none starts, and pricing at once
    // lets the API say what is missing.
    awaitsPar: state => state.structure !== 'BASIS' && !state.readOnly && !state.rateUserEdited && !!state.effDate && !!state.matDate
      && !isFinite(parseFloat(String(state.coupon ?? '').replace(/[^0-9.-]/g, ''))),
    buildPayload: state => {
      const ccy      = state.ccy || 'USD'
      const curveId  = CCY_CURVE[ccy] || 'USD_SOFR'
      const dir      = state.direction || 'PAY'
      const isOIS    = state.structure === 'OIS'
      const isBASIS  = state.structure === 'BASIS'
      const notional = Number(state.notional) || 0

      // Coupon: numeric or string. A blank coupon never reaches here on a fixed-leg structure: the window
      // waits for the par solve (awaitsPar above); 0 is the basis swap's legs and a typed zero coupon.
      const couponRaw = state.coupon
      const couponNum = typeof couponRaw === 'number'
        ? couponRaw
        : parseFloat(String(couponRaw || '').replace(/[^0-9.-]/g, ''))
      const fixedRate = isFinite(couponNum) ? couponNum / 100 : 0

      // Leg conventions. Defaults match legacy USD/SOFR setup. SwapTermsBody
      // (rewritten in Patch 4) will provide user-editable overrides via state.
      const index          = state.index          || 'SOFR'
      const fixedPayFreq   = state.fixedPayFreq   || 'ANNUAL'
      const fixedDc        = state.fixedDc        || 'ACT/360'
      const fixedBdc       = state.fixedBdc       || 'MOD_FOLLOWING'
      const floatResetFreq = state.floatResetFreq || 'DAILY'
      const floatPayFreq   = state.floatPayFreq   || 'ANNUAL'
      const floatDc        = state.floatDc        || 'ACT/360'
      const floatBdc       = state.floatBdc       || 'MOD_FOLLOWING'
      const spread         = (parseFloat(state.spread)   || 0) / 10000
      const leverage       =  parseFloat(state.leverage) || 1.0
      const forecastId     = INDEX_CURVE[index] || curveId
      const payLag         = INDEX_PAY_LAG[index] != null ? INDEX_PAY_LAG[index] : 2

      let legs
      if (isBASIS) {
        // BASIS: two float legs, potentially different indices.
        const index2          = state.index2          || 'EFFR'
        const forecastId2     = INDEX_CURVE[index2] || curveId
        const floatResetFreq2 = state.floatResetFreq2 || 'DAILY'
        const floatPayFreq2   = state.floatPayFreq2   || 'ANNUAL'
        const floatDc2        = state.floatDc2        || 'ACT/360'
        legs = [
          {
            leg_ref: 'FLOAT-1', leg_seq: 1, leg_type: 'FLOAT',
            direction: dir, currency: ccy, notional,
            effective_date: state.effDate, maturity_date: state.matDate,
            day_count: floatDc, payment_frequency: floatPayFreq,
            reset_frequency: floatResetFreq,
            bdc: floatBdc, payment_lag: payLag,
            fixed_rate: 0, spread: 0, leverage: 1.0,
            discount_curve_id: curveId, forecast_curve_id: forecastId,
            ois_compounding: null,
          },
          {
            leg_ref: 'FLOAT-2', leg_seq: 2, leg_type: 'FLOAT',
            direction: dir === 'PAY' ? 'RECEIVE' : 'PAY',
            currency: ccy, notional,
            effective_date: state.effDate, maturity_date: state.matDate,
            day_count: floatDc2, payment_frequency: floatPayFreq2,
            reset_frequency: floatResetFreq2,
            bdc: floatBdc, payment_lag: payLag,
            fixed_rate: 0, spread, leverage: 1.0,
            discount_curve_id: curveId, forecast_curve_id: forecastId2,
            ois_compounding: null,
          },
        ]
      } else {
        // VANILLA or OIS: fixed leg + float leg.
        legs = [
          {
            leg_ref: 'FIXED-1', leg_seq: 1, leg_type: 'FIXED',
            direction: dir, currency: ccy, notional,
            effective_date: state.effDate, maturity_date: state.matDate,
            day_count: fixedDc, payment_frequency: fixedPayFreq,
            bdc: fixedBdc, payment_lag: payLag,
            fixed_rate: fixedRate,
            fixed_rate_schedule: toRateSchedule(state.rateSchedule),
            notional_schedule:   toNotionalSchedule(state.notionalSchedule),
            discount_curve_id: curveId, forecast_curve_id: null,
            ois_compounding: null,
          },
          {
            leg_ref: 'FLOAT-1', leg_seq: 2, leg_type: 'FLOAT',
            direction: dir === 'PAY' ? 'RECEIVE' : 'PAY',
            currency: ccy, notional,
            effective_date: state.effDate, maturity_date: state.matDate,
            day_count: floatDc, payment_frequency: floatPayFreq,
            reset_frequency: isOIS ? 'DAILY' : floatResetFreq,
            bdc: floatBdc, payment_lag: payLag,
            spread_schedule:   toSpreadSchedule(state.spreadSchedule),
            notional_schedule: toNotionalSchedule(state.notionalSchedule),
            fixed_rate: 0, spread, leverage,
            discount_curve_id: curveId, forecast_curve_id: forecastId,
            ois_compounding: isOIS ? 'COMPOUNDING' : null,
          },
        ]
      }

      // Sprint 13 Patch 4 — PRODUCT_TAXONOMY §1.11 leg-level embedded optionality.
      //
      // The UI now populates `state.floatLegEmbeddedOptions` — an array of
      // entries `[{type, direction, defaultStrike}, ...]` — via the new
      // <LegEmbeddedOptions> component. This replaces the Sprint 12 pattern
      // that derived the cap/floor payload from separate `capRate` + `floorRate`
      // + `capFloorDirection` scalars gated by `state.structure`.
      //
      // For each entry we emit an entry in `float_leg.embedded_options`:
      //   { type: 'CAP'|'FLOOR', direction: 'BUY'|'SELL',
      //     strike_schedule: [{ date, strike }], default_strike: <decimal> }
      //
      // We also populate `cap_rate` / `floor_rate` scalar columns on the leg,
      // which the backend's dual-write shim uses to round-trip legacy reads.
      // The backend validator `validate_structure_leg_consistency` (Patch 3)
      // already accepts this shape for CAPPED_FLOATER / FLOORED_FLOATER and
      // any non-scoped structure.
      //
      // Convention: UI stores strikes in percent. Backend expects decimals.
      // Division by 100 happens here, at the seam.
      const struct = state.structure || 'VANILLA'
      const rawEntries = Array.isArray(state.floatLegEmbeddedOptions)
        ? state.floatLegEmbeddedOptions
        : []
      if (rawEntries.length > 0) {
        const floatLeg = legs.find(l => l.leg_type === 'FLOAT' && l.leg_ref !== 'FLOAT-2')
        if (floatLeg) {
          const effDate = state.effDate || state.tradeDate || null
          const validEntries = rawEntries
            .map(e => {
              const strikePct = parseFloat(e.defaultStrike)
              if (!isFinite(strikePct)) return null
              const strikeDec = strikePct / 100
              if (!effDate) return null
              return {
                type:      e.type,
                direction: e.direction,
                strike_schedule: [{ date: effDate, strike: strikeDec }],
                default_strike:  strikeDec,
              }
            })
            .filter(Boolean)

          floatLeg.embedded_options = validEntries

          // Sprint 12 legacy scalar columns — populate from first matching
          // entry of each type for UI round-trip during the Patches 3-4
          // window. Dropped by Migration 008b. The shim in ir_swap.py reads
          // embedded_options first, so these are for round-trip read, not
          // for pricing.
          const firstCap   = validEntries.find(e => e.type === 'CAP')
          const firstFloor = validEntries.find(e => e.type === 'FLOOR')
          if (firstCap)   floatLeg.cap_rate   = firstCap.default_strike
          if (firstFloor) floatLeg.floor_rate = firstFloor.default_strike
        }
      }

      // curves are injected by the TradeWindow shell (Patch 1). Do not add here.
      return {
        legs,
        valuation_date: state.valDate,
        structure: struct,   // Sprint 12 — closes L22 (structure now persisted on booking)
      }
    },
    parseResponse: r => r,
    timeoutMs: 15000,
  },
})

// ── IR SWAPTION ─────────────────────────────────────────────────────────────

registerProduct({
  key: 'IR_SWAPTION',
  label: 'IR Swaption',
  assetClass: 'RATES',

  structures: [
    { key: 'EUROPEAN', label: 'EUROPEAN' },
    { key: 'BERMUDAN', label: 'BERMUDAN' },
    { key: 'AMERICAN', label: 'AMERICAN SOON', live: false },
  ],
  defaultStructure: 'EUROPEAN',

  direction: () => ({ pay: 'PAY FIXED', receive: 'RECEIVE FIXED' }),

  terms: {
    title: 'OPTION TERMS',
    helper: state => {
      const sold = state.optionSide === 'SELL'
      return state.direction === 'PAY'
        ? { text: (sold ? '→ SOLD PAYER (holder may pay us fixed)' : '→ PAYER (right to pay fixed)'), color: 'var(--red)' }
        : { text: (sold ? '← SOLD RECEIVER (holder may receive fixed from us)' : '← RECEIVER (right to receive fixed)'), color: 'var(--accent)' }
    },
    footerText: 'Black/Bachelier normal vol · HW1F cross-check · Physical settlement · ' +
                'Strike blank = ATM forward (computed from OIS curve)',
    Component: SwaptionTermsBody,
  },

  optionFee: { premiumInBpOrDollar: true, multiPaymentAllowed: true },

  analytics: {
    metrics: r => {
      // Sprint 13B: when structure='BERMUDAN', the response carries
      // `early_exercise_premium` (Bermudan NPV - European-equivalent NPV).
      // Display it in place of the HW1F cross-check, which doesn't apply
      // to the tree path (the tree IS HW1F).
      const isBermudan = r.structure === 'BERMUDAN'
      const m = [
        metricCurrency('OPTION NPV', r.npv),
        metricCurrency('VEGA / 1bp', r.vega),
        metricCurrency('IR01',       r.ir01),
        metricCurrency('THETA',      r.theta),
      ]
      if (isBermudan) {
        m.push(metricCurrency('EE PREMIUM', r.early_exercise_premium))
      } else {
        m.push(metricCurrency('HW1F', r.hw1f_npv))
      }
      return m
    },
    breakdown: r => r.legs ? {
      kind: 'legs',
      columns: ['LEG','TYPE','DIR','CCY','PV','IR01','IR01 DISC','VEGA','THETA'],
      rows: r.legs.map(l => [
        l.leg_ref, l.leg_type, l.direction, l.currency,
        fmtCurrency(l.pv), fmtCurrency(l.ir01),
        fmtCurrency(l.ir01_disc), fmtCurrency(l.vega),
        fmtCurrency(l.theta),
      ]),
    } : null,
  },

  footer: {
    metrics: r => [
      metricCurrency('OPTION NPV', r.npv),
      metricCurrency('VEGA/1bp',   r.vega),
      metricCurrency('IR01',       r.ir01),
      metricCurrency('THETA/day',  r.theta),
    ],
    structureLabel: state => state.structure || 'EUROPEAN',
  },

  pricing: {
    endpoint: '/api/price/swaption',
    // From the keys SwaptionTermsBody and PrimaryEconomics write: expiry (tenor
    // string), tenor, strike (% or blank = ATM), volBp, ccy, valDate, direction,
    // and the swap dates shifted by the expiry (they carry the T+2 spot lag).
    buildPayload: state => {
      const expiry   = state.expiry ?? SWAPTION_DEFAULTS.expiry
      const expiry_y = expiryYears(expiry)
      const shift    = expiryShiftDays(expiry)
      const strikeRaw = String(state.strike ?? SWAPTION_DEFAULTS.strike).trim()
      const strike   = strikeRaw !== '' && isFinite(parseFloat(strikeRaw)) ? parseFloat(strikeRaw) / 100 : null
      const volBp    = parseFloat(String(state.volBp ?? SWAPTION_DEFAULTS.volBp))
      // ── Sprint 13B: Bermudan dispatch ────────────────────────────────────
      // When structure === 'BERMUDAN', send a default annual exercise
      // schedule from year 1 through expiry_y (inclusive): "annual European
      // on every coupon up to expiry", the most common market convention.
      // User can override via state.exerciseScheduleY when the editor lands.
      const isBermudan = state.structure === 'BERMUDAN'
      let exercise_schedule_y = null
      if (isBermudan) {
        if (Array.isArray(state.exerciseScheduleY) && state.exerciseScheduleY.length) {
          exercise_schedule_y = state.exerciseScheduleY
            .map(Number)
            .filter(t => Number.isFinite(t) && t > 0)
            .sort((a, b) => a - b)
        } else {
          // Default: [1, 2, ..., floor(expiry_y)] union {expiry_y}.
          // Snap-aligned to dt=1/12 by integer years; expiry_y itself is
          // appended to guarantee the Bermudan ≥ European invariant holds
          // tautologically (the European exercise is in the schedule).
          const E = expiry_y
          const out = []
          for (let y = 1; y <= Math.floor(E); y++) out.push(y)
          if (out.length === 0 || out[out.length - 1] !== E) out.push(E)
          exercise_schedule_y = out
        }
      }
      return {
        notional:            Number(state.notional) || 0,
        expiry_y,
        tenor_y:             TENOR_Y_MAP[state.tenor] || 5,
        strike,
        vol_bp:              isFinite(volBp) ? volBp : 86.5,
        is_payer:            state.direction === 'PAY',
        pay_freq_y:          1.0,
        valuation_date:      state.valDate,
        effective_date:      state.effDate ? addDays(state.effDate, shift) : null,
        maturity_date:       state.matDate ? addDays(state.matDate, shift) : null,
        curve_id:            CCY_CURVE[state.ccy] || 'USD_SOFR',
        exercise_type:       state.structure || 'EUROPEAN',
        // Sprint 13B
        structure:           state.structure || 'EUROPEAN',
        exercise_schedule_y,
      }
    },
    parseResponse: r => r,
    timeoutMs: 60000,    // Sprint 13B: bumped from 30000 — Bermudan tree
                         // takes ~7s base + ~14s vega bumps on dt=1/12
  },
})

// ── RATES CAP ───────────────────────────────────────────────────────────────

registerProduct({
  key: 'RATES_CAP',
  label: 'Interest Rate Cap',
  assetClass: 'RATES',

  structures: [],
  defaultStructure: null,

  direction: () => ({ pay: 'PAY FIXED', receive: 'RECEIVE FIXED' }),

  terms: {
    title: 'CAP TERMS',
    helper: state => ({
      text: state.optionSide === 'SELL' ? '↑ SELL CAP · premium received, pay above the strike' : '↑ BUY CAP · protection vs rising rates',
      color: 'var(--red)',
    }),
    footerText: 'Bachelier (Normal) · vol from cap surface · OIS discounting · SOFR in-arrears',
    Component: CapTermsBody,
  },

  optionFee: { premiumInBpOrDollar: true, multiPaymentAllowed: false },

  analytics: {
    metrics: r => [
      metricCurrency('OPTION NPV',  r.npv),
      { label: 'PREMIUM %', value: r.premium_pct?.toFixed(4) + '%', colorBy: 'info' },
      metricCurrency('VEGA / 1bp',  r.vega),
      metricCurrency('IR01',        r.ir01),
      metricBp      ('VOL (bp)',    r.vol_bp),
    ],
    breakdown: r => r.caplets ? {
      kind: 'caplets',
      columns: ['CAPLET','PERIOD START','PERIOD END','FWD RATE','DF','τ','VOL(bp)','PV'],
      rows: r.caplets.map(c => [
        c.period, c.start_date, c.end_date,
        c.forward?.toFixed(4) + '%', c.df?.toFixed(6),
        c.tau?.toFixed(4), c.vol_bp?.toFixed(1),
        fmtCurrency(c.pv),
      ]),
    } : null,
  },

  footer: {
    metrics: r => [
      metricCurrency('OPTION NPV', r.npv),
      metricCurrency('VEGA/1bp',   r.vega),
      metricCurrency('IR01',       r.ir01),
      metricBp      ('VOL (bp)',   r.vol_bp),
    ],
    structureLabel: () => 'CAP',
  },

  pricing: {
    endpoint: '/api/price/cap',
    buildPayload: state => {
      const payFreq = state.capPayFreq || CAPFLOOR_DEFAULTS.capPayFreq
      return {
        notional: Number(state.notional) || 0,
        tenor_y:  TENOR_Y_MAP[state.tenor] || 5,
        cap_rate: (parseFloat(state.capRate ?? CAPFLOOR_DEFAULTS.capRate) || 0) / 100,
        freq_per_year: FREQ_PER_YEAR[payFreq] || 4,
        curve_id: CCY_CURVE[state.ccy] || 'USD_SOFR',
        valuation_date: state.valDate,
        ...(state.volOverride && state.volOverride !== ''
          ? { vol_override_bp: parseFloat(state.volOverride) }
          : {}),
      }
    },
    parseResponse: r => r,
    timeoutMs: 30000,
  },
})

// ── RATES FLOOR ─────────────────────────────────────────────────────────────

registerProduct({
  key: 'RATES_FLOOR',
  label: 'Interest Rate Floor',
  assetClass: 'RATES',

  structures: [],
  defaultStructure: null,

  direction: () => ({ pay: 'PAY FIXED', receive: 'RECEIVE FIXED' }),

  terms: {
    title: 'FLOOR TERMS',
    helper: state => ({
      text: state.optionSide === 'SELL' ? '↓ SELL FLOOR · premium received, pay below the strike' : '↓ BUY FLOOR · protection vs falling rates',
      color: 'var(--accent)',
    }),
    footerText: 'Bachelier (Normal) · put-call vol symmetry via |K−ATM| · OIS discounting · SOFR in-arrears',
    Component: FloorTermsBody,
  },

  optionFee: { premiumInBpOrDollar: true, multiPaymentAllowed: false },

  analytics: {
    metrics: r => [
      metricCurrency('OPTION NPV',  r.npv),
      { label: 'PREMIUM %', value: r.premium_pct?.toFixed(4) + '%', colorBy: 'info' },
      metricCurrency('VEGA / 1bp',  r.vega),
      metricCurrency('IR01',        r.ir01),
      metricBp      ('VOL (bp)',    r.vol_bp),
    ],
    breakdown: r => r.caplets ? {
      kind: 'caplets',
      columns: ['FLOORLET','PERIOD START','PERIOD END','FWD RATE','DF','τ','VOL(bp)','PV'],
      rows: r.caplets.map(c => [
        c.period, c.start_date, c.end_date,
        c.forward?.toFixed(4) + '%', c.df?.toFixed(6),
        c.tau?.toFixed(4), c.vol_bp?.toFixed(1),
        fmtCurrency(c.pv),
      ]),
    } : null,
  },

  footer: {
    metrics: r => [
      metricCurrency('OPTION NPV', r.npv),
      metricCurrency('VEGA/1bp',   r.vega),
      metricCurrency('IR01',       r.ir01),
      metricBp      ('VOL (bp)',   r.vol_bp),
    ],
    structureLabel: () => 'FLOOR',
  },

  pricing: {
    endpoint: '/api/price/floor',
    buildPayload: state => {
      const payFreq = state.capPayFreq || CAPFLOOR_DEFAULTS.capPayFreq
      return {
        notional: Number(state.notional) || 0,
        tenor_y:  TENOR_Y_MAP[state.tenor] || 5,
        floor_rate: (parseFloat(state.floorRate ?? CAPFLOOR_DEFAULTS.floorRate) || 0) / 100,
        freq_per_year: FREQ_PER_YEAR[payFreq] || 4,
        curve_id: CCY_CURVE[state.ccy] || 'USD_SOFR',
        valuation_date: state.valDate,
        ...(state.volOverride && state.volOverride !== ''
          ? { vol_override_bp: parseFloat(state.volOverride) }
          : {}),
      }
    },
    parseResponse: r => r,
    timeoutMs: 30000,
  },
})

// ── RATES COLLAR ────────────────────────────────────────────────────────────

registerProduct({
  key: 'RATES_COLLAR',
  label: 'Interest Rate Collar',
  assetClass: 'RATES',

  structures: [],
  defaultStructure: null,

  direction: () => ({ pay: 'PAY FIXED', receive: 'RECEIVE FIXED' }),

  terms: {
    title: 'COLLAR TERMS',
    helper: state => ({
      text: state.optionSide === 'SELL' ? '↕ SELL COLLAR · sell cap, buy floor' : '↕ BUY COLLAR · buy cap, sell floor',
      color: 'var(--amber)',
    }),
    footerText: 'Long Cap − Short Floor · Bachelier (Normal) · zero-cost spread = cap − floor',
    Component: CollarTermsBody,
  },

  optionFee: { premiumInBpOrDollar: true, multiPaymentAllowed: false },

  analytics: {
    metrics: r => [
      metricCurrency('NET NPV',      r.net_npv),
      { label: 'ZC SPREAD',   value: r.zero_cost_spread_bp?.toFixed(0) + 'bp', colorBy: 'warning' },
      metricCurrency('NET VEGA',     r.net_vega),
      metricCurrency('NET IR01',     r.net_ir01),
      { label: 'CAP/FLR VOL', value: `${r.cap_vol_bp?.toFixed(1)} / ${r.floor_vol_bp?.toFixed(1)}`, colorBy: 'info' },
    ],
    breakdown: r => ({
      kind: 'components',
      columns: ['LEG','COMPONENT','NPV','PREMIUM %','VOL(bp)','TIER'],
      rows: [
        ['LONG',  `CAP @ ${r.cap_rate_pct?.toFixed(2)}%`,   fmtCurrency(r.cap_npv),
         r.cap_premium_pct?.toFixed(4) + '%',   r.cap_vol_bp?.toFixed(1),   r.cap_vol_tier],
        ['SHORT', `FLOOR @ ${r.floor_rate_pct?.toFixed(2)}%`, fmtCurrency(-r.floor_npv),
         '−' + r.floor_premium_pct?.toFixed(4) + '%', r.floor_vol_bp?.toFixed(1), r.floor_vol_tier],
        ['NET',   'COLLAR', fmtCurrency(r.net_npv),
         r.net_pct?.toFixed(4) + '%', '—', '—'],
      ],
    }),
  },

  footer: {
    metrics: r => [
      metricCurrency('NET NPV',   r.net_npv),
      metricCurrency('NET VEGA',  r.net_vega),
      metricCurrency('NET IR01',  r.net_ir01),
      { label: 'ZC SPREAD', value: r.zero_cost_spread_bp?.toFixed(0) + 'bp', colorBy: 'warning' },
    ],
    structureLabel: () => 'COLLAR',
  },

  pricing: {
    endpoint: '/api/price/collar',
    buildPayload: state => {
      const payFreq = state.capPayFreq || CAPFLOOR_DEFAULTS.capPayFreq
      return {
        notional: Number(state.notional) || 0,
        tenor_y:  TENOR_Y_MAP[state.tenor] || 5,
        cap_rate:   (parseFloat(state.capRate   ?? CAPFLOOR_DEFAULTS.capRate)   || 0) / 100,
        floor_rate: (parseFloat(state.floorRate ?? CAPFLOOR_DEFAULTS.floorRate) || 0) / 100,
        freq_per_year: FREQ_PER_YEAR[payFreq] || 4,
        curve_id: CCY_CURVE[state.ccy] || 'USD_SOFR',
        valuation_date: state.valDate,
      }
    },
    parseResponse: r => r,
    timeoutMs: 30000,
  },
})

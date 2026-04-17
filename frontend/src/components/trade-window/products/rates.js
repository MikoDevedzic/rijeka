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

// ── Shared helpers ──────────────────────────────────────────────────────────

const fmtCurrency = v => (v == null) ? '—' :
  (v >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(v)).toLocaleString()

const signClass = v => (v == null) ? null : (v >= 0 ? 'positive' : 'negative')

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
  JPY: 'JPY_TONA', CHF: 'CHF_SARON', AUD: 'AUD_AONIA',
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

// Tenor string → years as float. Matches legacy TradeBookingWindow.TENOR_YEARS.
const TENOR_Y_MAP = {
  'ON':1/365,'1W':7/365,'1M':1/12,'2M':2/12,'3M':3/12,'6M':6/12,'9M':9/12,
  '1Y':1,'18M':1.5,'2Y':2,'3Y':3,'4Y':4,'5Y':5,'6Y':6,'7Y':7,'8Y':8,
  '9Y':9,'10Y':10,'12Y':12,'15Y':15,'20Y':20,'25Y':25,'30Y':30,'40Y':40,'50Y':50,
}

// Option-expiry tenor string → years as float.
const EXPIRY_Y_MAP = {
  '1M':1/12,'3M':0.25,'6M':0.5,'1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'10Y':10,
}

// Pay-frequency string → number of accruals per year.
const FREQ_PER_YEAR = {
  'MONTHLY':12, 'QUARTERLY':4, 'SEMI_ANNUAL':2, 'ANNUAL':1,
}

// ── IR SWAP ─────────────────────────────────────────────────────────────────

registerProduct({
  key: 'IR_SWAP',
  label: 'IR Swap',
  assetClass: 'RATES',

  structures: [
    { key: 'VANILLA',     label: 'VANILLA'     },
    { key: 'OIS',         label: 'OIS'         },
    { key: 'BASIS',       label: 'BASIS'       },
    { key: 'XCCY',        label: 'XCCY SOON',        live: false },
    { key: 'ZERO_COUPON', label: 'ZERO COUPON SOON', live: false },
    { key: 'STEP_UP',     label: 'STEP UP SOON',     live: false },
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
      color: state.structure === 'BASIS' ? '#F5C842' : '#4A9EFF',
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
    buildPayload: state => {
      const ccy      = state.ccy || 'USD'
      const curveId  = CCY_CURVE[ccy] || 'USD_SOFR'
      const dir      = state.direction || 'PAY'
      const isOIS    = state.structure === 'OIS'
      const isBASIS  = state.structure === 'BASIS'
      const notional = Number(state.notional) || 0

      // Coupon: numeric or string; 'PAR'/non-numeric falls to 0 for now.
      // Patch 4 will wire the par-rate auto-fetch so 'PAR' resolves to the
      // par swap rate from the current curve.
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
            fixed_rate_schedule: null,
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
            fixed_rate: 0, spread, leverage,
            discount_curve_id: curveId, forecast_curve_id: forecastId,
            ois_compounding: isOIS ? 'COMPOUNDING' : null,
          },
        ]
      }

      // curves are injected by the TradeWindow shell (Patch 1). Do not add here.
      return {
        legs,
        valuation_date: state.valDate,
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
    { key: 'BERMUDAN', label: 'BERMUDAN SOON', live: false },
    { key: 'AMERICAN', label: 'AMERICAN SOON', live: false },
  ],
  defaultStructure: 'EUROPEAN',

  direction: state => ({ pay: 'PAY FIXED', receive: 'RECEIVE FIXED' }),

  terms: {
    title: 'OPTION TERMS',
    helper: state => state.direction === 'PAY'
      ? { text: '→ PAYER (right to pay fixed)',     color: '#FF6B6B' }
      : { text: '← RECEIVER (right to receive fixed)', color: '#00D4A8' },
    footerText: 'Black/Bachelier normal vol · HW1F cross-check · Physical settlement · ' +
                'Strike blank = ATM forward (computed from OIS curve)',
    Component: SwaptionTermsBody,
  },

  optionFee: { premiumInBpOrDollar: true, multiPaymentAllowed: true },

  analytics: {
    metrics: r => [
      metricCurrency('OPTION NPV', r.npv),
      metricCurrency('VEGA / 1bp', r.vega),
      metricCurrency('IR01',       r.ir01),
      metricCurrency('THETA',      r.theta),
      metricCurrency('HW1F',       r.hw1f_npv),
    ],
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
    buildPayload: state => ({
      notional: state.notional,
      expiry_y: state.expiryY,
      tenor_y:  state.tenorY,
      strike:   state.strike,
      is_payer: state.direction === 'PAY',
      curve_id: state.curveId,
      vol_override_bp: state.volOverride,
      valuation_date: state.valuationDate,
    }),
    parseResponse: r => r,
    timeoutMs: 30000,
  },
})

// ── RATES CAP ───────────────────────────────────────────────────────────────

registerProduct({
  key: 'RATES_CAP',
  label: 'Interest Rate Cap',
  assetClass: 'RATES',

  structures: [],
  defaultStructure: null,

  direction: state => ({ pay: 'PAY FIXED', receive: 'RECEIVE FIXED' }),

  terms: {
    title: 'CAP TERMS',
    helper: state => ({ text: '↑ BUY CAP · protection vs rising rates', color: '#FF6B6B' }),
    footerText: 'Bachelier (Normal) · vol from Bloomberg cap surface · OIS discounting · SOFR in-arrears',
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
      const payFreq = state.capPayFreq || 'QUARTERLY'
      return {
        notional: Number(state.notional) || 0,
        tenor_y:  TENOR_Y_MAP[state.tenor] || 5,
        cap_rate: (parseFloat(state.capRate) || 0) / 100,
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

  direction: state => ({ pay: 'PAY FIXED', receive: 'RECEIVE FIXED' }),

  terms: {
    title: 'FLOOR TERMS',
    helper: state => ({ text: '↓ BUY FLOOR · protection vs falling rates', color: '#00D4A8' }),
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
      const payFreq = state.capPayFreq || 'QUARTERLY'
      return {
        notional: Number(state.notional) || 0,
        tenor_y:  TENOR_Y_MAP[state.tenor] || 5,
        floor_rate: (parseFloat(state.floorRate) || 0) / 100,
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

  direction: state => ({ pay: 'PAY FIXED', receive: 'RECEIVE FIXED' }),

  terms: {
    title: 'COLLAR TERMS',
    helper: state => ({ text: '↕ BUY COLLAR · cap + floor spread', color: '#F5C842' }),
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
      const payFreq = state.capPayFreq || 'QUARTERLY'
      return {
        notional: Number(state.notional) || 0,
        tenor_y:  TENOR_Y_MAP[state.tenor] || 5,
        cap_rate:   (parseFloat(state.capRate)   || 0) / 100,
        floor_rate: (parseFloat(state.floorRate) || 0) / 100,
        freq_per_year: FREQ_PER_YEAR[payFreq] || 4,
        curve_id: CCY_CURVE[state.ccy] || 'USD_SOFR',
        valuation_date: state.valDate,
      }
    },
    parseResponse: r => r,
    timeoutMs: 30000,
  },
})

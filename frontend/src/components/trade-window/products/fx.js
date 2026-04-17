// trade-window/products/fx.js  (SKELETON — Sprint 11+)
// ─────────────────────────────────────────────────────────────────────────────
// Example: adding a new asset class is a single file. The renderer never
// changes. The ArchitectureNav never changes. Tabs never change.
// ─────────────────────────────────────────────────────────────────────────────

import { registerProduct } from '../registry'
import { FxForwardTermsBody, FxOptionTermsBody } from '../sections/product-terms'

// ── FX FORWARD ──────────────────────────────────────────────────────────────

registerProduct({
  key: 'FX_FORWARD',
  label: 'FX Forward',
  assetClass: 'FX',

  structures: [
    { key: 'OUTRIGHT',     label: 'OUTRIGHT'     },
    { key: 'NDF',          label: 'NDF'          },
    { key: 'SWAP_POINTS',  label: 'SWAP POINTS'  },
  ],
  defaultStructure: 'OUTRIGHT',

  direction: () => ({ pay: 'BUY BASE', receive: 'SELL BASE' }),

  terms: {
    title: 'FX FORWARD TERMS',
    helper: state => ({
      text: `→ ${state.baseCcy || 'USD'}/${state.quoteCcy || 'EUR'} @ forward`,
      color: '#4A9EFF',
    }),
    footerText: 'Spot + points · settlement T+2 · OIS discounting on both legs',
    Component: FxForwardTermsBody,   // implement in sections/product-terms
  },

  optionFee: null,

  analytics: {
    metrics: r => [
      { label: 'NPV',             value: fmtCurrency(r.npv),     colorBy: signClass(r.npv) },
      { label: 'SPOT',            value: r.spot?.toFixed(4),     colorBy: 'info' },
      { label: 'FWD POINTS',      value: r.fwd_points?.toFixed(1), colorBy: 'info' },
      { label: 'DELTA / CCY',     value: fmtCurrency(r.delta),   colorBy: 'info' },
      { label: 'DV01',            value: fmtCurrency(r.dv01),    colorBy: 'info' },
    ],
    breakdown: r => r.legs ? {
      kind: 'legs',
      columns: ['LEG','CCY','NOTIONAL','RATE','PV','DELTA'],
      rows: r.legs.map(l => [
        l.leg_ref, l.currency, l.notional.toLocaleString(),
        l.rate.toFixed(6), fmtCurrency(l.pv), fmtCurrency(l.delta),
      ]),
    } : null,
  },

  footer: {
    metrics: r => [
      { label: 'NPV',        value: fmtCurrency(r.npv),       colorBy: signClass(r.npv) },
      { label: 'FWD',        value: r.forward?.toFixed(4),    colorBy: 'info' },
      { label: 'DELTA',      value: fmtCurrency(r.delta),     colorBy: 'info' },
      { label: 'DV01',       value: fmtCurrency(r.dv01),      colorBy: 'info' },
    ],
    structureLabel: state => state.structure || 'OUTRIGHT',
  },

  pricing: {
    endpoint: '/api/price/fx-forward',
    buildPayload: state => ({
      base_ccy:  state.baseCcy,
      quote_ccy: state.quoteCcy,
      notional:  state.notional,
      value_date: state.valueDate,
      structure: state.structure,
    }),
    parseResponse: r => r,
    timeoutMs: 30000,
  },
})

// ── FX OPTION (Vanilla) ─────────────────────────────────────────────────────
//   Same template. Different terms. Different analytics columns (Greeks for FX).
//   No changes anywhere else.

/*
registerProduct({
  key: 'FX_OPTION',
  label: 'FX Option',
  assetClass: 'FX',
  structures: [{key:'EUROPEAN'}, {key:'AMERICAN'}, {key:'BARRIER', label:'BARRIER SOON', live:false}],
  ...
  terms: { title: 'OPTION TERMS', Component: FxOptionTermsBody, ... },
  optionFee: { premiumInBpOrDollar: true, multiPaymentAllowed: false },
  analytics: { metrics: r => [
    metricCurrency('PREMIUM', r.premium),
    { label: 'DELTA', value: r.delta?.toFixed(4), colorBy: 'info' },
    { label: 'GAMMA', value: r.gamma?.toFixed(4), colorBy: 'info' },
    { label: 'VEGA',  value: r.vega?.toFixed(2),  colorBy: 'info' },
    { label: 'VANNA', value: r.vanna?.toFixed(2), colorBy: 'info' },
    ...
  ] },
  ...
})
*/

// ── Helper formatters (local to this module or import from shared) ──────────
const fmtCurrency = v => (v == null) ? '—' :
  (v >= 0 ? '+' : '−') + '$' + Math.abs(Math.round(v)).toLocaleString()
const signClass = v => (v == null) ? null : (v >= 0 ? 'positive' : 'negative')

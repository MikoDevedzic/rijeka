// trade-window/incremental-xva.js
// ────────────────────────────────────────────────────────────────────────────────────
// The pure parts of IncrementalXva.jsx: the signed currency format, the result rows
// from a POST /api/xva/incremental response, the request body, the disabled reason,
// the EE polyline and the development mock. No React; tested in IncrementalXva.test.js.
// ────────────────────────────────────────────────────────────────────────────────────

export const ROWS = [['CVA', 'cva'], ['DVA', 'dva'], ['FVA', 'fva'], ['FBA', 'fba'], ['KVA', 'kva'], ['MVA', 'mva'], ['TOTAL', 'total']]
const SYM = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }

// ── pure helpers (IncrementalXva.test.js) ─────────────────────────────────────────

// Signed, rounded, with the currency's symbol: −$1,234 · +$457 · $0 · — for nothing.
// The same shape as the ticket's money() and XVATab's fmtDollar.
export function fmtSigned(v, ccy = 'USD') {
  if (v == null || isNaN(v)) return '—'
  const n = Math.round(Number(v))
  const sign = n < 0 ? '−' : n > 0 ? '+' : ''
  return sign + (SYM[ccy] ?? (ccy + ' ')) + Math.abs(n).toLocaleString('en-US')
}

// The result table's rows from a response. `incremental` is what the server
// reports; if a key is missing it is with − without.
export function buildRows(resp) {
  if (!resp) return []
  const w0 = resp.without || {}, w1 = resp.with || {}, inc = resp.incremental || {}
  return ROWS.map(([label, key]) => {
    const a = w0[key] ?? null, b = w1[key] ?? null
    const d = inc[key] ?? (a != null && b != null ? b - a : null)
    return { key, label, without: a, with: b, incremental: d, total: key === 'total' }
  })
}

// Why the RUN button is disabled, or null when it can run. buildTrade may throw
// (a swaption with a blank strike before it is priced): the message is the reason.
export function disabledReason({ counterpartyId, priced, buildTrade, tradeId }) {
  if (tradeId) return counterpartyId ? null : 'this trade has no counterparty'
  if (!counterpartyId) return 'select a counterparty first'
  if (!priced) return 'price the trade first'
  try {
    const t = typeof buildTrade === 'function' ? buildTrade() : null
    if (!t) return 'price the trade first'
  } catch (e) {
    return e?.message || String(e)
  }
  return null
}

// The request body. A stored trade goes by id; a hypothetical one as the booking body.
export function buildRequest({ counterpartyId, tradeId, buildTrade }) {
  return {
    counterparty_id: counterpartyId || null,
    trade: tradeId ? null : (buildTrade?.() ?? null),
    trade_id: tradeId || null,
    n_paths: null,
  }
}

// What an error response reads as. 429 is the route's rate limit.
export function errorMessage(status, json) {
  if (status === 429) return 'too many runs — wait a minute'
  const d = json?.detail
  if (typeof d === 'string' && d) return d
  if (d) return JSON.stringify(d)
  return `incremental xva ${status}`
}

// Polyline points for one EE series on a W×H canvas, shared y-range across series.
export function eePoints(values, lo, hi, W = 1000, H = 100) {
  if (!values?.length) return ''
  const span = hi - lo || 1
  const n = values.length
  return values.map((v, i) => {
    const x = n === 1 ? 0 : (i / (n - 1)) * W
    const y = H - ((Number(v) || 0) - lo) / span * H
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

// ── mock (IncrementalXva.jsx MOCK = true) ───────────────────────────────────────
export function mockResponse({ counterpartyId, counterpartyName, tradeId }) {
  const months = 24
  const asof = new Date()
  const grid = Array.from({ length: months }, (_, i) => {
    const d = new Date(asof); d.setMonth(d.getMonth() + i + 1); return d.toISOString().slice(0, 10)
  })
  const hump = (i, peak, scale) => scale * Math.exp(-((i - peak) ** 2) / (2 * (months / 3) ** 2))
  const without = grid.map((_, i) => Math.round(hump(i, 9, 180000) + 20000))
  const withT = grid.map((_, i) => Math.round(hump(i, 9, 180000) + 20000 + hump(i, 12, 65000)))
  const w0 = { cva: -1234.5, dva: 456.7, fva: -89.0, fba: 12.0, kva: -300.0, mva: -150.0 }
  const w1 = { cva: -1810.2, dva: 601.3, fva: -131.4, fba: 19.5, kva: -412.8, mva: -221.0 }
  const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0)
  const tot = (o) => ({ ...o, total: Math.round(sum(o) * 100) / 100 })
  const a = tot(w0), b = tot(w1)
  const inc = Object.fromEntries(Object.keys(a).map(k => [k, Math.round((b[k] - a[k]) * 100) / 100]))
  return {
    counterparty: counterpartyName || 'COUNTERPARTY', counterparty_id: counterpartyId, asof: asof.toISOString().slice(0, 10),
    csa: { preset: 'BILATERAL', collateralised: true, threshold_usd: 500000, mta_usd: 100000, mpor_days: 10, im_exchanged: false },
    measure: 'RISK_NEUTRAL', n_paths: 2000, months, other_trades: 3,
    without: a, with: b, incremental: inc,
    ee: { grid, without, with: withT },
    notes: ['common random numbers: both runs use the same paths', tradeId ? 'mock: marginal of removing the stored trade' : 'mock: no server call was made'],
    seconds: 0.6,
  }
}

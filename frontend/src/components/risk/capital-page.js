// risk/capital-page.js — the pure parts of CapitalPage.jsx: the metric list, the column and step labels, the rows
// of the counterparty table and of the attribution waterfall from a GET /api/capital/portfolio response, the
// bar geometry. No React; tested in capital-page.test.js.

export const COLUMNS = ['BASELINE', 'ON_CHAIN_CURRENT', 'ON_CHAIN_FORWARD']
export const COLUMN_LABEL = { BASELINE: 'CSA AS BOOKED', ON_CHAIN_CURRENT: 'ON-CHAIN · CURRENT RULES', ON_CHAIN_FORWARD: 'ON-CHAIN · FORWARD STATES' }
export const COLUMN_DESC = {
  BASELINE: 'the counterparty record: its CSA type, threshold, MTA, margin frequency, disputes, collateral and enforceability',
  ON_CHAIN_CURRENT: 'zero threshold and MTA, daily margining, no dispute doubling, recognised collateral, eligible IM: every channel the rules recognise today',
  ON_CHAIN_FORWARD: 'plus the cleared-floor margin period of risk, a tokenised sovereign claim eligible as IM, Level 1 liquidity: the states that need supervisory recognition',
}
export const METRICS = [
  ['RWA', 'rwa', 'the counterparty risk weight × SA-CCR EAD (CRE20, CRE52)'],
  ['K CCR', 'k_ccr', '8 % of RWA'],
  ['K CVA', 'k_cva', 'the reduced basic-approach CVA capital (MAR50.14–50.15)'],
  ['SA-CCR EAD', 'ead', '1.4 × (RC + multiplier × add-on) at the valuation date'],
  ['SIMM IM', 'im', 'invariant to the collateral; moves only with the margin period of risk'],
  ['KVA', 'kva', 'the capital legs along the exposure path, at the hurdle'],
  ['CVA', 'cva', 'under the economic CSA'],
  ['FVA', 'fva', 'under the economic CSA'],
  ['MVA', 'mva', 'IM funded at the spread less the posted asset’s yield'],
  ['ColVA', 'colva', 'the carry of the variation margin against cash at OIS, from what the schedule holds it in'],
  ['COST', 'cost', '−(CVA + FVA + KVA + MVA + ColVA): the P&L charge'],
  ['LEVERAGE EXP.', 'leverage', '1.4 × (RC with cash VM only + add-on) (LEV30)'],
  ['HQLA OF IM', 'hqla_im', 'the liquidity value of the margin posted (LCR30)'],
]
// Regulatory stock at today, in USD: what Risk → CAPITAL shows for the CSA as booked. Prices (KVA, MVA, CVA, FVA, ColVA)
// are valuation adjustments and live in the regimes report under Risk → COLLATERAL and on the ticket's XVA tab.
export const STOCK_METRICS = [
  ['RWA', 'rwa', 'the counterparty risk weight × SA-CCR EAD (CRE20, CRE52)'],
  ['K CCR', 'k_ccr', '8 % of RWA'],
  ['K CVA', 'k_cva', 'the reduced basic-approach CVA capital (MAR50.14–50.15)'],
  ['SA-CCR EAD', 'ead', '1.4 × (RC + multiplier × add-on) at the valuation date'],
  ['SIMM IM', 'im', 'initial margin under the record\'s CSA'],
  ['LEVERAGE EXP.', 'leverage', '1.4 × (RC with cash VM only + add-on) (LEV30)'],
  ['HQLA OF IM', 'hqla_im', 'the liquidity value of the margin posted (LCR30)'],
]

// One row per counterparty with the booked column's stock metrics.
export function stockRows(rep) {
  if (!rep?.counterparties) return []
  return rep.counterparties.map(c => {
    if (c.empty) return { id: c.counterparty_id, name: c.counterparty, empty: true, note: c.error || (c.skipped || []).map(s => `${s.trade_ref}: ${s.reason}`).join(' · ') || 'nothing to simulate', trades: c.trades }
    const b = c.columns?.BASELINE || {}
    return { id: c.counterparty_id, name: c.counterparty, empty: false, trades: c.trades, simulated: c.simulated, record: c.record, inputs: c.inputs,
      values: Object.fromEntries(STOCK_METRICS.map(([, k]) => [k, b[k] ?? null])) }
  })
}

export function stockTotals(rep) {
  const b = rep?.totals?.BASELINE
  if (!b) return null
  return Object.fromEntries(STOCK_METRICS.map(([, k]) => [k, b[k] ?? null]))
}

export const STEP_LABEL = {
  THRESHOLD_MTA: 'Zero threshold & MTA', MARGIN_FREQUENCY: 'Daily margining', DISPUTES: 'No dispute doubling', COLLATERAL: 'Recognised collateral',
  IM_ELIGIBILITY: 'Eligible IM, its yield', MPOR_RELIEF: 'Cleared-floor MPoR', TOKENISED_IM: 'Tokenised sovereign as IM', HQLA_L1: 'Level 1 HQLA',
}

const SYM = '$'
export function fmt(v) {
  if (v == null || isNaN(v)) return '—'
  return SYM + Math.abs(Math.round(Number(v))).toLocaleString('en-US') + (Number(v) < 0 ? ' (−)' : '')
}
export function fmtSigned(v) {
  if (v == null || isNaN(v)) return '—'
  const n = Math.round(Number(v))
  return (n < 0 ? '−' : n > 0 ? '+' : '') + SYM + Math.abs(n).toLocaleString('en-US')
}
export function fmtBp(v) {
  if (v == null || isNaN(v)) return '—'
  const n = Number(v)
  return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1) + ' bp'
}
export function fmtPct(a, b) {
  if (a == null || b == null || !isFinite(a) || !isFinite(b) || Math.abs(b) < 1e-9) return '—'
  const p = (a / b - 1) * 100
  return (p > 0 ? '+' : '') + p.toFixed(0) + ' %'
}

// Counterparty rows for one metric: the three columns and the change from the baseline.
export function tableRows(rep, key) {
  if (!rep?.counterparties) return []
  return rep.counterparties.map(c => {
    if (c.empty) return { id: c.counterparty_id, name: c.counterparty, empty: true, note: c.error || (c.skipped || []).map(s => `${s.trade_ref}: ${s.reason}`).join(' · ') || 'nothing to simulate', trades: c.trades }
    const v = Object.fromEntries(COLUMNS.map(col => [col, c.columns?.[col]?.[key] ?? null]))
    return { id: c.counterparty_id, name: c.counterparty, empty: false, trades: c.trades, simulated: c.simulated, record: c.record, values: v,
      change: { ON_CHAIN_CURRENT: v.ON_CHAIN_CURRENT - v.BASELINE, ON_CHAIN_FORWARD: v.ON_CHAIN_FORWARD - v.BASELINE },
      quote: c.quote, inputs: c.inputs }
  })
}

export function totalsRow(rep, key) {
  if (!rep?.totals) return null
  const v = Object.fromEntries(COLUMNS.map(col => [col, rep.totals[col]?.[key] ?? null]))
  return { values: v, change: { ON_CHAIN_CURRENT: v.ON_CHAIN_CURRENT - v.BASELINE, ON_CHAIN_FORWARD: v.ON_CHAIN_FORWARD - v.BASELINE }, quote: rep.quote }
}

// The waterfall for one metric: the baseline bar, one bar per step (its delta), the two column bars.
export function waterfall(steps, columns, key) {
  if (!steps || !columns) return []
  const out = [{ key: 'BASELINE', label: 'CSA as booked', state: 'BASELINE', kind: 'level', value: columns.BASELINE?.[key] ?? 0 }]
  let running = out[0].value
  for (const s of steps) {
    if (s.key === 'BASELINE') continue
    const d = s.delta?.[key] ?? 0
    out.push({ key: s.key, label: STEP_LABEL[s.key] || s.label, state: s.state, kind: 'delta', value: d, from: running, to: running + d, source: s.source, csa: s.csa })
    running += d
    if (s.key === 'IM_ELIGIBILITY') out.push({ key: 'ON_CHAIN_CURRENT', label: 'On-chain · current rules', state: 'CURRENT', kind: 'level', value: running })
  }
  out.push({ key: 'ON_CHAIN_FORWARD', label: 'On-chain · forward states', state: 'FORWARD', kind: 'level', value: running })
  return out
}

// Bar geometry in a W×H box for the waterfall: levels from zero, deltas from `from` to `to`.
export function bars(items, W = 1000, H = 160, pad = 6) {
  if (!items.length) return []
  const lo = Math.min(0, ...items.flatMap(i => i.kind === 'level' ? [i.value] : [i.from, i.to]))
  const hi = Math.max(0, ...items.flatMap(i => i.kind === 'level' ? [i.value] : [i.from, i.to]))
  const span = hi - lo || 1
  const y = v => H - ((v - lo) / span) * H
  const w = (W - pad * (items.length + 1)) / items.length
  return items.map((it, i) => {
    const a = it.kind === 'level' ? 0 : it.from
    const b = it.kind === 'level' ? it.value : it.to
    const top = Math.min(y(a), y(b)), bottom = Math.max(y(a), y(b))
    return { ...it, x: pad + i * (w + pad), w, y: top, h: Math.max(bottom - top, 1), zero: y(0) }
  })
}

export function errorMessage(status, json) {
  if (status === 429) return 'too many runs — wait a minute'
  const d = json?.detail
  if (typeof d === 'string' && d) return d
  return `capital ${status}`
}

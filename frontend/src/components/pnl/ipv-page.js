// pnl/ipv-page.js — the pure parts of IpvPage.jsx: the inputs table rows, the pillar rows, the surface grid,
// the waterfall and the formats from a GET /api/ipv/run response. No React; tested in ipv-page.test.js.

export const STATE_LABEL = { PENDING: 'PENDING', VERIFIED: 'VERIFIED', OVERRIDDEN: 'OVERRIDDEN', APPROVED: 'APPROVED', WAIVED: 'WAIVED' }
export const STATE_COLOR = { PENDING: 'var(--text-dim)', VERIFIED: 'var(--accent)', OVERRIDDEN: 'var(--amber)', APPROVED: 'var(--accent)', WAIVED: 'var(--text-mute)' }
export const PILLAR_COLOR = { OK: 'var(--accent)', APPROVED: 'var(--accent)', REVIEW: 'var(--red)', OVERRIDDEN: 'var(--amber)', UNVERIFIED: 'var(--text-dim)' }
export const KIND_LABEL = { RATES: 'rate curve', FUNDING: 'funding level', SWAPTION_VOL: 'swaption vol surface', FX_VOL: 'FX vol surface', SPOT: 'spot' }
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
export function fmtQuote(v, kind) {
  if (v == null || isNaN(v)) return '—'
  const d = kind === 'SPOT' ? 4 : kind === 'SWAPTION_VOL' ? 2 : 3
  return Number(v).toFixed(d)
}
export function fmtShift(v, unit) {
  if (v == null || isNaN(v)) return '—'
  const n = Number(v)
  const d = unit === 'pct' ? 2 : 1
  return (n > 0 ? '+' : '') + n.toFixed(d) + ' ' + (unit === 'bp' ? 'bp' : unit === 'vol_bp' ? 'bp' : unit === 'vol_pt' ? 'pt' : '%')
}
export function sensLabel(kind) {
  return kind === 'RATES' || kind === 'FUNDING' ? 'IR01' : kind === 'SPOT' ? 'spot01' : 'vega'
}

// The inputs table: one row per input, with the counts the controller reads first.
export function inputRows(run) {
  return (run?.inputs || []).map(i => ({
    curve_id: i.curve_id, kind: i.kind, kindLabel: KIND_LABEL[i.kind] || i.kind, unit: i.unit, trades: i.trades, state: i.state,
    sensitivity: i.sensitivity_total, sens: `${sensLabel(i.kind)} ${fmtSigned(i.sensitivity_total)}/${i.unit === 'pct' ? '%' : i.unit === 'vol_pt' ? 'pt' : 'bp'}`,
    desk: i.desk_snapshot_date ? `snapshot ${i.desk_snapshot_date}` : 'no snapshot',
    independent: i.has_independent ? i.independent_source : (i.unladdered ? 'nothing to verify' : 'none · model IPV only'),
    review: i.review || 0, overridden: i.overridden || 0, impact: i.first_order || 0, pillars: i.pillars?.length || 0, decision: i.decision || null,
    unladdered: !!i.unladdered, note: i.note || null,
  }))
}

// The pillar rows of one input (a curve, a spot, a funding level): one line per quote.
export function pillarRows(input) {
  return (input?.pillars || []).map(p => ({
    key: p.key, tenor: p.tenor, quote_type: p.quote_type, desk: p.desk, independent: p.independent, gap: p.gap, sensitivity: p.sensitivity,
    tol: p.tol, tolSource: p.tol_source, material: p.material, override: p.override, overrideId: p.override_id, reason: p.override_reason, by: p.override_by,
    shift: p.shift, impact: p.impact, status: p.status,
  }))
}

// A swaption surface as a grid: rows = expiries, columns = tenors, from "AxB" keys.
export function surfaceGrid(input) {
  const cells = (input?.pillars || []).filter(p => /x/i.test(p.key))
  const parse = k => { const [e, t] = k.split(/x/i); return { expiry: e, tenor: t } }
  const years = s => { const m = /^(\d+(?:\.\d+)?)([DWMY])$/i.exec(String(s)); if (!m) return 0; const n = Number(m[1]); return { D: n / 365, W: n / 52, M: n / 12, Y: n }[m[2].toUpperCase()] }
  const expiries = [...new Set(cells.map(c => parse(c.key).expiry))].sort((a, b) => years(a) - years(b))
  const tenors = [...new Set(cells.map(c => parse(c.key).tenor))].sort((a, b) => years(a) - years(b))
  const at = {}
  for (const c of cells) { const { expiry, tenor } = parse(c.key); at[`${expiry}|${tenor}`] = c }
  return { expiries, tenors, cell: (e, t) => at[`${e}|${t}`] || null }
}

// An FX surface as a grid: rows = tenors, columns = quote types.
export function fxGrid(input) {
  const cells = (input?.pillars || []).filter(p => p.quote_type)
  const years = s => { const m = /^(\d+(?:\.\d+)?)([DWMY])$/i.exec(String(s)); if (!m) return 0; const n = Number(m[1]); return { D: n / 365, W: n / 52, M: n / 12, Y: n }[m[2].toUpperCase()] }
  const tenors = [...new Set(cells.map(c => c.tenor))].sort((a, b) => years(a) - years(b))
  const types = ['ATM', 'RR25', 'BF25'].filter(t => cells.some(c => c.quote_type === t))
  const at = {}
  for (const c of cells) at[`${c.tenor}|${c.quote_type}`] = c
  return { tenors, types, cell: (t, q) => at[`${t}|${q}`] || null }
}

// Flash → official: the lines of the waterfall from the run's figures.
export function waterfall(run) {
  if (!run || run.flash_usd == null) return []
  const out = [{ key: 'FLASH', label: 'FLASH P&L', sub: 'the traders’ marks', value: run.flash_usd, kind: 'level' }]
  for (const i of run.inputs || []) {
    if (i.first_order) out.push({ key: `IPV·${i.curve_id}`, label: `IPV · ${i.curve_id}`, sub: `${i.overridden || 0} override${i.overridden === 1 ? '' : 's'}`, value: i.first_order, kind: 'delta' })
  }
  out.push({ key: 'SECOND', label: 'IPV · SECOND ORDER', sub: run.applied_at ? 'full revaluation less first order' : 'apply to compute', value: run.applied_at ? (run.second_order_usd || 0) : null, kind: 'delta' })
  out.push({ key: 'XVA', label: 'XVA RESERVE CHANGE', sub: run.scope_key === 'GLOBAL' ? 'the netted components, day on day' : 'book level only', value: run.xva_usd, kind: 'delta' })
  out.push({ key: 'OFFICIAL', label: 'OFFICIAL P&L', sub: run.status === 'SIGNED' ? `signed ${run.signed_name || ''}` : 'unsigned', value: run.official_usd, kind: 'level' })
  return out
}

export function counts(run) {
  const inputs = run?.inputs || []
  const settled = inputs.filter(i => i.state !== 'PENDING').length
  return { inputs: inputs.length, settled, pending: inputs.length - settled, review: inputs.reduce((a, i) => a + (i.review || 0), 0), overridden: inputs.reduce((a, i) => a + (i.overridden || 0), 0), unvalued: (run?.unvalued || []).length }
}

export function errorMessage(status, json) {
  if (status === 429) return 'too many runs — wait a minute'
  const d = json?.detail
  if (typeof d === 'string' && d) return d
  return `ipv ${status}`
}

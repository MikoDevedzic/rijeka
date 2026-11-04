// trade-window/capital.js
// ────────────────────────────────────────────────────────────────────────────────────
// The pure parts of CapitalTab.jsx: the metric rows, the grid for one counterparty type
// and one view (standalone / incremental) from a POST /api/capital/trade response, the
// request body, the quote line and the derivation text of a cell. No React; tested in
// capital.test.js.
// ────────────────────────────────────────────────────────────────────────────────────
import { disabledReason as xvaDisabledReason, errorMessage as xvaErrorMessage, fmtSigned } from './incremental-xva'

export const PRESETS = ['CASH_GOVT', 'PLUS_STABLECOIN', 'PLUS_TOKENISED_FUND', 'PLUS_TOKENISED_SOVEREIGN']
export const REGIME_LABEL = {
  COUNTERPARTY: 'AS RECORDED',
  CASH_GOVT: 'CASH + GOVT',
  PLUS_STABLECOIN: '+ STABLECOIN',
  PLUS_TOKENISED_FUND: '+ TOKENISED FUND',
  PLUS_TOKENISED_SOVEREIGN: '+ TOKENISED SOVEREIGN',
}
export const REGIME_DESC = {
  COUNTERPARTY: 'the counterparty record: its CSA type, threshold and MTA, cash and government securities, enforceable',
  CASH_GOVT: 'cash and government securities: recognised (CRE22.34), 0.5–4 % haircut (CRE22.49), eligible IM (§23.156), Level 1 HQLA',
  PLUS_STABLECOIN: 'a private payment stablecoin: not eligible collateral (SCO60.94), not eligible IM, not HQLA; close-out netting assumed unenforceable',
  PLUS_TOKENISED_FUND: 'tokenised money-market fund shares: look-through recognition at the worst permitted holding (CRE22.49 note), eligible IM after the 13 July 2026 amendment, Level 2A',
  PLUS_TOKENISED_SOVEREIGN: 'a tokenised sovereign claim, perfected and safe-harboured: recognised as the underlying (SCO60.94), IM eligibility a conditional state, Level 2A floor / Level 1 ceiling, atomic settlement at the cleared margin period of risk',
}
export const DEFAULT_TYPES = [
  { key: 'CORPORATE·UNRATED', type: 'CORPORATE', rating: 'UNRATED' },
  { key: 'BANK·A', type: 'BANK', rating: 'A' },
  { key: 'FUND·UNRATED', type: 'FUND', rating: 'UNRATED' },
]

// money: signed, as the XVA rows; ratio: the multiplier; none: hidden from the grid
// Stock only: regulatory quantities at today, in the reporting currency. The lifetime prices of that stock
// (KVA, MVA) and the credit and funding adjustments (CVA, FVA) are valuation adjustments and live on the XVA tab.
export const METRIC_ROWS = [
  ['SIMM IM', 'im', 'money'],
  ['SA-CCR EAD', 'ead', 'money'],
  ['RWA', 'rwa', 'money'],
  ['K CCR', 'k_ccr', 'money'],
  ['K CVA', 'k_cva', 'money'],
  ['LEVERAGE EXP.', 'leverage', 'money'],
  ['HQLA OF IM', 'hqla_im', 'money'],
]
export const COST_ROW = null

export const FORMULA = {
  im: 'IM = RW_SIMM × |sensitivity| × √(MPoR/10): the IR delta weight on IR01, the FX delta weight on spot01; posted only where the collateral is eligible IM',
  ead: 'EAD = 1.4 × (RC + multiplier × AddOn)  (CRE52.1); RC margined max(V − C, TH + MTA − NICA, 0), unmargined max(V − C, 0); AddOn by asset class and hedging set (CRE52.57, 52.59, SCO60.98)',
  rwa: 'RWA = RW × EAD, the counterparty risk weight from CRE20',
  k_ccr: 'K_CCR = 8 % × RW × EAD',
  k_cva: 'K_CVA = 0.65 × (1/1.4) × S_c × M × EAD × DF(M)  (MAR50.14–50.15), S_c by sector and grade (MAR50.16)',
  kva: 'KVA = −hurdle × Σ (K_CCR(t) + K_CVA(t)) Δt P(0,t) along the exposure path',
  mva: 'MVA = −Σ IM(t) × max(ftp − pickup, 0) Δt P(0,t); pickup the yield of the eligible collateral posted',
  cva: 'CVA = −LGD × Σ EE(t) ΔPD(t) P(0,t) under the economic CSA (gross when close-out netting is unenforceable)',
  fva: 'FVA = −Σ ftp × EE(t) Δt P(0,t) under the economic CSA',
  leverage: 'leverage exposure = 1.4 × (max(V − cash VM, 0) + AddOn): only cash variation margin reduces it (LEV30)',
  hqla_im: 'HQLA value of the IM posted: Level 1 at 0 %, Level 2A at 15 %, Level 2B at 50 %, none for unrecognised assets (LCR30)',
  cost: 'the charge the regime carries: −(CVA + FVA + KVA + MVA)',
}

export function fmtMoney0(v, ccy = 'USD') {
  if (v == null || isNaN(v)) return '—'
  const n = Math.round(Number(v))
  const SYM = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }
  return (SYM[ccy] ?? ccy + ' ') + Math.abs(n).toLocaleString('en-US') + (n < 0 ? ' (−)' : '')
}

// the value shown: costs (kva, mva, cva, fva) keep their sign; exposures and capital are magnitudes
export function cellValue(cell, key) {
  if (!cell) return null
  if (key === 'cost') return -((cell.cva || 0) + (cell.fva || 0) + (cell.kva || 0) + (cell.mva || 0))
  return cell[key] ?? null
}

export function fmtCell(v, key, ccy = 'USD') {
  if (v == null) return '—'
  if (['kva', 'mva', 'cva', 'fva'].includes(key)) return fmtSigned(v, ccy)
  return fmtMoney0(v, ccy)
}

// The regime names in the response's order; the counterparty's own first when present.
// The first column's tooltip: the counterparty's recorded schedule (instruments, rail) when there is one.
export function regimeDesc(res, name) {
  const rg = (res?.regimes || []).find(r => r.name === name)
  const pi = rg?.posted_instruments
  if (name === 'COUNTERPARTY' && pi && Object.keys(pi).length) {
    const comp = Object.entries(pi).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${k} ${Math.round(w * 100)} %`).join(', ')
    const recv = Object.entries(rg.received_instruments || {}).sort((a, b) => b[1] - a[1]).map(([k, w]) => `${k} ${Math.round(w * 100)} %`).join(', ')
    return `the counterparty's collateral schedule: posts ${comp}; receives ${recv || comp}; ${rg.mpor_state === 'ON_CHAIN' ? 'on-chain rail' : 'bilateral rail'}`
  }
  return REGIME_DESC[name] || name
}

export function regimeNames(res) {
  return (res?.regimes || []).map(r => r.name)
}

export function typeKeys(res) {
  return (res?.types || []).map(t => t.key)
}

// The grid for one type and one view: rows = metrics (+ the cost row), cells keyed by regime.
export function buildGrid(res, typeKey, view = 'INCREMENTAL') {
  if (!res?.cells) return []
  const names = regimeNames(res)
  const pick = (rg) => {
    const c = res.cells?.[rg]?.[typeKey]
    if (!c) return null
    if (view === 'STANDALONE') return c.standalone || c.with
    return c.incremental || c.with
  }
  return METRIC_ROWS.map(([label, key]) => ({
    key, label, cells: Object.fromEntries(names.map(rg => [rg, cellValue(pick(rg), key)])),
  }))
}

// The quote line: the regime's cost against the first one, in bp of notional.
export function quoteCells(res, typeKey) {
  const names = regimeNames(res)
  return Object.fromEntries(names.map(rg => [rg, res?.quote?.[rg]?.[typeKey] || null]))
}

export function fmtBp(v) {
  if (v == null || isNaN(v)) return '—'
  const n = Number(v)
  return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1) + ' bp'
}

// What the RUN button needs; a stored trade goes by id, a new one as its booking body.
// the route accepts 200–5,000 paths; a blank field means the engine's own default
export function clampPaths(paths) {
  const n = Number(paths)
  if (paths === '' || paths == null || !Number.isFinite(n) || n <= 0) return null
  return Math.min(5000, Math.max(200, Math.round(n)))
}

export function buildRequest({ counterpartyId, tradeId, buildTrade, regimes, types, hurdle, paths }) {
  return {
    counterparty_id: counterpartyId || null,
    trade: tradeId ? null : (buildTrade?.() ?? null),
    trade_id: tradeId || null,
    regimes: regimes && regimes.length ? regimes : null,
    counterparty_types: types && types.length ? types.map(t => ({ type: t.type, rating: t.rating, sector: t.sector || null, rw_override: t.rw_override ?? null, label: t.label || null })) : null,
    hurdle: Number.isFinite(Number(hurdle)) ? Number(hurdle) / 100 : 0.12,
    n_paths: clampPaths(paths),
  }
}

export const disabledReason = xvaDisabledReason
export function errorMessage(status, json) {
  if (status === 429) return 'too many runs — wait a minute'
  return xvaErrorMessage(status, json).replace('incremental xva', 'capital')
}

// The derivation drawer for one cell: the formula, the regime's two CSAs, the inputs the engine used,
// and the SA-CCR snapshot of the set (per trade, per hedging set).
export function derivation(res, regime, typeKey, key, view = 'INCREMENTAL') {
  if (!res) return []
  const rg = (res.regimes || []).find(r => r.name === regime)
  const c = res.cells?.[regime]?.[typeKey]
  const inputs = c?.inputs
  const lines = []
  lines.push({ h: 'FORMULA', t: FORMULA[key] || key })
  if (rg) {
    const eco = rg.economic_csa, reg = rg.regulatory_csa
    lines.push({ h: 'REGIME', t: `${REGIME_LABEL[regime] || regime} — ${REGIME_DESC[regime] || ''}` })
    lines.push({ h: 'ECONOMIC CSA', t: eco ? `${eco.collateralised ? 'VM exchanged' : 'uncollateralised'}${eco.collateralised ? ` · threshold ${fmtMoney0(eco.threshold_cp)} · MTA ${fmtMoney0(eco.mta)} · MPoR ${eco.mpor_days}bd` : ''}${eco.im_exchanged ? ' · IM exchanged' : ' · no IM'}${eco.im_yield_pickup_bp ? ` · pickup ${eco.im_yield_pickup_bp} bp` : ''}` : '—' })
    lines.push({ h: 'REGULATORY CSA', t: reg ? `${reg.crm_recognised ? 'margined: collateral recognised' : 'unmargined: collateral not recognised'}${reg.crm_recognised ? ` · haircut ${(100 * (reg.collateral_haircut || 0)).toFixed(2)} % · MPoR ${reg.mpor_days}bd · MF ${(1.5 * Math.sqrt(reg.mpor_days / 250)).toFixed(3)}` : ' · MF √min(M, 1)'}${reg.im_exchanged ? ' · IM counts as NICA' : ' · no NICA'}` : '—' })
    for (const e of rg.explain || []) {
      if (e.step === 'recognition') lines.push({ h: 'RECOGNITION', t: `${e.class} ${Math.round(100 * e.weight)} %: ${e.crm.toLowerCase().replace('_', ' ')}, haircut ${e.haircut_pct} % — ${e.source || ''}; ${e.haircut_source || ''}` })
      if (e.step === 'enforceability') lines.push({ h: 'ENFORCEABILITY', t: `${e.enforceable ? 'enforceable' : 'not enforceable'}: ${e.effect} — ${e.source}` })
      if (e.step === 'initial margin') lines.push({ h: 'INITIAL MARGIN', t: `${e.class} ${Math.round(100 * e.weight)} %: ${e.im_eligible ? 'eligible IM' : 'not eligible IM'} (${e.state}), pickup ${e.pickup_bp} bp — ${e.source || ''}` })
      if (e.step === 'margin period of risk') lines.push({ h: 'MARGIN PERIOD', t: `${e.mpor_days} business days (${e.state}) — ${e.source}` })
    }
  }
  if (inputs) lines.push({ h: 'COUNTERPARTY', t: `${inputs.counterparty_type} ${inputs.rating_bucket}: RW ${(100 * inputs.rw).toFixed(0)} % (${inputs.rw_source}) · S_c ${(100 * inputs.s_c).toFixed(1)} % (${inputs.s_c_source}) · hurdle ${(100 * inputs.hurdle).toFixed(0)} %` })
  const setName = view === 'STANDALONE' ? 'standalone' : 'with'
  const snap = res.saccr?.[regime]?.[setName]
  if (snap && ['ead', 'rwa', 'k_ccr', 'k_cva', 'kva', 'leverage'].includes(key)) {
    lines.push({ h: 'SA-CCR TODAY', t: `RC ${fmtMoney0(snap.rc)} · AddOn ${fmtMoney0(snap.addon)} · multiplier ${Number(snap.multiplier).toFixed(3)} · ${snap.mf} · EAD ${fmtMoney0(snap.ead)}${snap.capped ? ' (capped at the unmargined EAD, CRE52.2)' : ''}` })
    for (const [ac, d] of Object.entries(snap.by_class || {})) {
      const sets = Object.entries(d.hedging_sets || {}).map(([hs, x]) => `${hs} ${fmtMoney0(x.addon)}`).join(', ')
      lines.push({ h: `ADD-ON ${ac}`, t: `${fmtMoney0(d.addon)} — ${sets}` })
    }
    for (const t of snap.trades || []) {
      lines.push({ h: t.trade_ref || 'TRADE', t: `${t.asset_class} ${t.hedging_set}${t.sub_type ? ' ' + t.sub_type : ''}: notional ${fmtMoney0(t.notional)} · S ${Number(t.S).toFixed(2)} E ${Number(t.E).toFixed(2)} M ${Number(t.M).toFixed(2)}${t.SD != null ? ` · SD ${Number(t.SD).toFixed(3)}` : ''} · δ ${Number(t.delta).toFixed(3)} · MF ${Number(t.MF).toFixed(3)}${t.bucket ? ` · bucket ${t.bucket}` : ''} · effective ${fmtMoney0(t.effective)}` })
    }
  }
  return lines
}

// ── development mock (CapitalTab MOCK = true) ───────────────────────────────────────
export function mockResponse() {
  const types = DEFAULT_TYPES.map(t => ({ ...t, sector: null, rw_override: null, label: null }))
  const mk = (ead, im, scale) => ({ im, ead, rwa: ead * scale, k_ccr: 0.08 * ead * scale, k_cva: 0.02 * ead, kva: -0.012 * ead * scale, kva_ccr: -0.01 * ead * scale, kva_cva: -0.002 * ead * scale,
    mva: -0.004 * im, cva: -0.03 * ead, dva: 0.01 * ead, fva: -0.005 * ead, fba: 0.002 * ead, xva_total: -0.03 * ead, leverage: 1.4 * ead, hqla_im: im, addon: ead / 1.4, rc: 0, multiplier: 1 })
  const cells = {}
  const regimes = PRESETS.map(name => ({ name, explain: [], economic_csa: { collateralised: name !== 'PLUS_STABLECOIN', threshold_cp: 0, mta: 0, mpor_days: 10, im_exchanged: true }, regulatory_csa: { crm_recognised: name !== 'PLUS_STABLECOIN', collateral_haircut: 0.005, mpor_days: 10, im_exchanged: true } }))
  for (const r of regimes) {
    cells[r.name] = {}
    const f = r.name === 'PLUS_STABLECOIN' ? 3.1 : r.name === 'PLUS_TOKENISED_FUND' ? 1.2 : r.name === 'PLUS_TOKENISED_SOVEREIGN' ? 0.7 : 1
    for (const t of types) {
      const scale = t.type === 'BANK' ? 0.3 : 1
      const w = mk(90_000 * f, r.name === 'PLUS_STABLECOIN' ? 0 : 280_000, scale)
      cells[r.name][t.key] = { inputs: { counterparty_type: t.type, rating_bucket: t.rating, rw: scale, s_c: 0.05, hurdle: 0.12, rw_source: 'CRE20', s_c_source: 'MAR50.16' }, standalone: w, with: w, without: null, incremental: w }
    }
  }
  return { mode: 'INCREMENTAL', counterparty: 'MOCK', asof: '2026-11-03', n_paths: 2000, months: 60, seed: 7, regimes, types, cells, saccr: {}, quote: {}, notes: ['mock'], seconds: 0.1 }
}

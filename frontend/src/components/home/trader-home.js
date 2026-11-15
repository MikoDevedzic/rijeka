// home/trader-home.js — what the trader's home draws, worked out from what the API already answers: the risk
// report's ladder, limits and moves (GET /api/risk/report), the trades (GET /api/trades/) and the P&L summary
// (GET /api/pnl/summary). Nothing here prices anything. The one product it forms is a sensitivity times that
// factor's usual daily move (the report's `moves`: backend/risk/var.py typical_moves), so that a basis point of
// SOFR, a percent of bitcoin and a point of volatility can be drawn on one scale, in money.

// The ladder's tenor buckets, as backend/pnl/explain.py BUCKETS names and bounds them.
export const BUCKETS = ['0-1Y', '1-5Y', '5-10Y', '10Y+']
export const BUCKET_LABEL = { '0-1Y': 'TO 1Y', '1-5Y': '1Y TO 5Y', '5-10Y': '5Y TO 10Y', '10Y+': 'PAST 10Y' }
const EDGES = [1.0001, 5.0001, 10.0001]
export const bucketOfYears = (y) => BUCKETS[EDGES.findIndex(e => y < e)] ?? BUCKETS[BUCKETS.length - 1]

// The bucket a trade's maturity falls in, counted from the report's date in years of 365.25 days. Used only to
// place a sensitivity that has no tenor of its own (a spot delta, a flat curve's one bucket) along the picture.
export function maturityBucket(maturityIso, asOfIso) {
  const a = Date.parse(maturityIso), b = Date.parse(asOfIso)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return BUCKETS[0]
  return bucketOfYears(Math.max(0, (a - b) / (365.25 * 864e5)))
}

// The last year a bucket reaches from the report's date ("to 2031"); the last bucket has no end.
export function bucketReach(asOfIso) {
  const y = new Date(Date.parse(asOfIso) || Date.now()).getUTCFullYear()
  return [`to ${y + 1}`, `to ${y + 5}`, `to ${y + 10}`, `after ${y + 10}`]
}

const FIAT = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'MXN', 'ZAR', 'SGD', 'HKD', 'CNH', 'CNY', 'TRY', 'BRL', 'INR', 'KRW'])
// A spot delta is FX01 on a currency and CRY01 on a digital asset (lib/risk-factors.js: two factors, two colours).
export const spotMeasure = (asset) => FIAT.has(String(asset).toUpperCase()) ? ['fx', 'FX01'] : ['cry', 'CRY01']
const pretty = (id) => String(id).replace(/_/g, ' ')
const surfaceName = (id) => /_SWVOL/.test(id) ? `${String(id).split('_')[0]} swaptions` : String(id).replace(/_VOL$/, '')
const EPS = 0.5                       // less than half a dollar per unit of the bump is not a risk to draw
const ORDER = { ir: 0, fx: 1, cry: 2, basis: 3, vol: 4 }
export const MAX_LANES = 7

// One entry per risk factor the book carries: its sensitivity in each tenor bucket (USD, the reporting currency),
// the factor's usual daily move in each (or null where the history gives none), and the two multiplied.
export function factors(rep, trades = []) {
  const lad = rep?.ladder || {}, rows = (rep?.ladder_rows || []).filter(r => r.usd_rate != null), sd = rep?.moves?.stdev || {}
  const mat = new Map((trades || []).map(t => [String(t.id), maturityBucket(t.maturity_date, rep?.date)]))
  const at = (r) => mat.get(String(r.trade_id)) || BUCKETS[0]
  const blank = () => BUCKETS.map(() => 0)
  const add = (v, b, x) => { const i = BUCKETS.indexOf(b); if (i >= 0 && Number.isFinite(x)) v[i] += x }
  const out = []
  const push = (f) => {
    if (!f.v.some(x => Math.abs(x) >= EPS)) return
    f.total = f.v.reduce((a, b) => a + b, 0)
    f.day = f.move ? f.v.map((x, i) => Math.abs(x) < EPS ? 0 : f.move[i] == null ? null : x * f.move[i]) : null
    f.hasDay = !!f.day && f.day.every(x => x != null)
    out.push(f)
  }
  // a total with no rows to place it by (an older stored report) is drawn at the near end rather than dropped
  const rest = (v, total, placed) => { if (Number.isFinite(total) && Math.abs(total - placed) > Math.max(1, Math.abs(total) * 1e-6)) add(v, BUCKETS[0], total - placed) }

  for (const row of lad.ladder || []) {
    const v = blank()
    for (const b of BUCKETS) add(v, b, Number(row.buckets?.[b] || 0))
    if (row.buckets?.FLAT) { let placed = 0; for (const r of rows) { const x = r.kr01?.[row.curve]?.FLAT; if (x) { add(v, at(r), x * r.usd_rate); placed += x * r.usd_rate } } rest(v, Number(row.buckets.FLAT), placed) }
    const m = sd[row.curve]
    push({ key: `IR:${row.curve}`, name: pretty(row.curve), measure: 'IR01', factor: 'ir', unit: 'per bp', moveUnit: 'bp', v, move: m ? BUCKETS.map(b => m[b] ?? null) : null })
  }
  for (const [asset, total] of Object.entries(lad.spot01 || {})) {
    const v = blank(); let placed = 0
    for (const r of rows) { const x = r.spot01?.[asset]; if (x) { add(v, at(r), x * r.usd_rate); placed += x * r.usd_rate } }
    rest(v, Number(total), placed)
    const [factor, measure] = spotMeasure(asset), s = sd[`${asset}_SPOT`]?.SPOT
    push({ key: `SPOT:${asset}`, name: asset, measure, factor, unit: 'per 1%', moveUnit: '%', v, move: s != null ? BUCKETS.map(() => s) : null, byMaturity: true })
  }
  for (const [cid, total] of Object.entries(lad.crybasis01 || {})) {
    const v = blank(); let placed = 0
    for (const r of rows) for (const [b, x] of Object.entries(r.crybasis01?.[cid] || {})) { add(v, b === 'FLAT' ? at(r) : b, x * r.usd_rate); placed += x * r.usd_rate }
    rest(v, Number(total), placed)
    push({ key: `BASIS:${cid}`, name: String(cid).replace(/_FUNDING$/, ''), measure: 'CRYBASIS01', factor: 'basis', unit: 'per bp', moveUnit: 'bp', v, move: null })
  }
  for (const row of lad.vega || []) {
    const v = blank()
    for (const b of BUCKETS) add(v, b, Number(row.buckets?.[b] || 0))
    if (row.buckets?.FLAT) { let placed = 0; for (const r of rows) { const x = r.vega?.[row.curve]?.FLAT; if (x) { add(v, at(r), x * r.usd_rate); placed += x * r.usd_rate } } rest(v, Number(row.buckets.FLAT), placed) }
    const m = sd[row.curve], sw = /_SWVOL/.test(row.curve)
    // the report's move for a surface is in hundredths of a point (of a bp of normal vol for a swaption grid), as the VaR multiplies it
    push({ key: `VEGA:${row.curve}`, name: surfaceName(row.curve), measure: 'VEGA', factor: 'vol', unit: sw ? 'per bp of vol' : 'per vol point', moveUnit: sw ? 'bp of vol' : 'pt', v, move: m ? BUCKETS.map(b => m[b] != null ? m[b] / 100 : null) : null })
  }
  return out.sort((a, b) => ORDER[a.factor] - ORDER[b.factor] || a.name.localeCompare(b.name))
}

// The largest bucket of a factor on the money scale: where it sits and what a usual day moves it by.
export function peak(f) {
  if (!f?.hasDay) return null
  let i = 0
  f.day.forEach((x, k) => { if (Math.abs(x) > Math.abs(f.day[i])) i = k })
  return { bucket: BUCKETS[i], usd: Math.abs(f.day[i]) }
}

// The factors the picture has room for: the largest by a usual day's money, then those with no history, in the
// picture's own order. The rest are named beside it, not drawn.
export function lanes(list, max = MAX_LANES) {
  if (list.length <= max) return { drawn: list, rest: [] }
  const size = (f) => peak(f)?.usd ?? -1
  const keep = new Set([...list].sort((a, b) => size(b) - size(a) || Math.abs(b.total) - Math.abs(a.total)).slice(0, max).map(f => f.key))
  return { drawn: list.filter(f => keep.has(f.key)), rest: list.filter(f => !keep.has(f.key)) }
}

// Whether the money scale can be offered at all: at least one factor has a usual move for every bucket it sits in.
export const canDay = (list) => list.some(f => f.hasDay)

// The height of each bucket of each factor, between −1 and 1 (above the line long, below it short). 'day': USD for
// a usual day, every factor on one scale; a factor with no history keeps its own scale and says so. 'raw': the
// sensitivity itself, each factor to its own scale. The square root keeps a small bucket in sight beside a large one.
export function heights(list, mode) {
  const root = (x, top) => top > 0 ? Math.sign(x) * Math.sqrt(Math.abs(x) / top) : 0
  const big = mode === 'day' ? Math.max(0, ...list.filter(f => f.hasDay).flatMap(f => f.day.map(Math.abs))) : 0
  return list.map(f => {
    if (mode === 'day' && f.hasDay) return { h: f.day.map(x => root(x, big)), own: false }
    const top = Math.max(...f.v.map(Math.abs))
    return { h: f.v.map(x => root(x, top)), own: mode === 'day' }
  })
}

// ── limits ───────────────────────────────────────────────────────────────────
const round = (n) => Math.round(n)
export function limitLabel(lim, scenarios = []) {
  const m = String(lim?.metric || ''), [head, a, b] = m.split(':')
  const name = head === 'VAR_99_1D' ? 'VAR' : head === 'VAR_95_1D' ? 'VAR 2ND' : head === 'ES_99_1D' ? 'ES' : head === 'VAR_H' ? 'VAR HORIZON'
    : head === 'IR01' ? (a ? `IR01 ${pretty(a)}` : 'IR01') : head === 'KR01' ? `${pretty(a)} ${b || ''}`.trim() : head === 'SPOT01' ? `${a} ${spotMeasure(a)[1]}`
    : head === 'STRESS' ? `STRESS ${(scenarios.find(s => s.id === a)?.name || a || '').toUpperCase()}` : head === 'PFE_PEAK' ? `PFE ${a || ''}`.trim() : pretty(m)
  return lim?.scope && String(lim.scope).toUpperCase() !== 'ALL' && lim.scope_name ? `${name} · ${String(lim.scope_name).toUpperCase()}` : name
}
// One mark per limit that has a figure against it, the closest to its limit first.
export function limitMarks(limits = [], scenarios = []) {
  return (limits || []).filter(l => Number.isFinite(l?.utilisation_pct)).map(l => ({
    id: l.id, name: limitLabel(l, scenarios), u: l.utilisation_pct / 100, pct: round(l.utilisation_pct), status: l.status, value: l.value, limit: l.limit,
    kind: /^(PFE|EPE|CVA|CE)/.test(String(l.metric)) ? 'c' : 'o',
  })).sort((a, b) => b.u - a.u)
}
// Where you stand, in words. A status is the API's (BREACH at or past the limit, WARN at the limit's own warning level).
export function standing(marks, pending = 0) {
  const over = marks.filter(m => m.status === 'BREACH').length, near = marks.filter(m => m.status === 'WARN').length, clear = marks.length - over - near
  const words = []
  if (!marks.length) words.push(['mute', 'No limits set'])
  else if (over) words.push(['over', `${over} limit${over > 1 ? 's' : ''} passed`])
  else words.push(['ok', 'Inside every limit'])
  if (near) words.push(['near', `${near} close`])
  if (marks.length && clear) words.push(['dim', `${clear} clear`])
  if (pending) words.push(['hollow', `${pending} to confirm`])
  const t = marks[0]
  return { words, tight: t ? `Closest: ${t.name}, at ${t.pct}% of its limit.` : '' }
}
// Where each mark and its label go on a rail `width` px wide that ends at 125% of a limit. A label that would
// run into its neighbour goes up a lane; the rail's own height follows the lanes used.
export const RAIL_MAX = 1.25
export function railLayout(marks, width, charW = 6.9) {
  const out = marks.map(m => ({ ...m, x: Math.min(Math.max(m.u, 0), RAIL_MAX) / RAIL_MAX * width })).sort((a, b) => a.x - b.x)
  const ends = []
  for (const m of out) {
    m.text = `${m.name} ${m.pct}%`
    m.w = m.text.length * charW + 6
    m.cx = Math.max(m.w / 2, Math.min(width - m.w / 2, m.x))
    let k = 0
    while (ends[k] != null && m.cx - m.w / 2 < ends[k] + 8) k++
    ends[k] = m.cx + m.w / 2; m.lane = k
  }
  return { marks: out, lanes: Math.max(1, ends.length) }
}

// ── P&L ──────────────────────────────────────────────────────────────────────
// The statement, each line for the day, the month and the year: what the market did to the book, what trading
// did (new trades, amendments, unwinds), the two together (clean), what XVA took, what is left. The XVA lines are
// there only when the summary has the P&L after XVA (the XVA reserves module); XVA is the difference of the two
// totals, not a figure of its own. A line the summary does not carry is left out.
export function statement(s) {
  if (!s) return []
  const rows = []
  const line = (label, a, b, c, kind) => { if ([a, b, c].some(x => x != null)) rows.push([label, a, b, c, kind]) }
  line('Market', s.market, s.mtd_market, s.ytd_market)
  line('Trading', s.trading, s.mtd_trading, s.ytd_trading)
  rows.push(['Clean', s.dod, s.mtd, s.ytd, 'sum'])
  const after = [s.dod_after_xva, s.mtd_after_xva, s.ytd_after_xva]
  if (after.every(x => x == null)) return rows
  const diff = (a, b) => a == null || b == null ? null : a - b
  rows.push(['XVA', diff(after[0], s.dod), diff(after[1], s.mtd), diff(after[2], s.ytd)], ['After XVA', ...after, 'sum'])
  return rows
}
// The day's P&L by what moved it, in the P&L page's own words and order.
export const MOVED_LABEL = { CARRY: 'CARRY', CASH: 'CASH SETTLED', RATES: 'RATES', FX: 'FX · SPOT & POINTS', VOL: 'VOLATILITY', RESIDUAL: 'RESIDUAL', AMEND: 'AMENDMENTS', NEW: 'NEW TRADES', UNWIND: 'UNWINDS' }
export function moved(s) {
  const rows = (s?.buckets || []).filter(b => Number.isFinite(b?.usd)).map(b => ({ key: b.bucket, label: MOVED_LABEL[b.bucket] || b.bucket, group: b.group, usd: b.usd }))
  const top = Math.max(0, ...rows.map(r => Math.abs(r.usd)))
  return { rows: rows.map(r => ({ ...r, share: top ? Math.abs(r.usd) / top : 0 })), any: rows.some(r => Math.abs(r.usd) >= 0.5) }
}

export const fmt0 = (n) => n == null || !Number.isFinite(Number(n)) ? '—' : Math.round(Math.abs(Number(n))).toLocaleString('en-US')
export const signed = (n) => n == null || !Number.isFinite(Number(n)) ? '—' : Math.round(Number(n)) === 0 ? '0' : `${n > 0 ? '+' : '−'}${fmt0(n)}`
export const tone = (n) => n > 0.5 ? 'pos' : n < -0.5 ? 'neg' : ''

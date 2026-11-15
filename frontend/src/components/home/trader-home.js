// home/trader-home.js — what the trader's home draws, worked out from what the API already answers: the risk
// report's ladder, limits and moves (GET /api/risk/report), the trades (GET /api/trades/) and the P&L summary
// (GET /api/pnl/summary). Nothing here prices anything. The one product it forms is a sensitivity times that
// factor's usual daily move (the report's `moves`: backend/risk/var.py typical_moves), so that a basis point of
// SOFR, a percent of bitcoin and a point of volatility can be drawn on one scale, in money.

// The ladder's tenor buckets, as backend/pnl/explain.py BUCKETS names and bounds them.
export const BUCKETS = ['0-1Y', '1-5Y', '5-10Y', '10Y+']
export const BUCKET_LABEL = { '0-1Y': 'TO 1Y', '1-5Y': '1Y TO 5Y', '5-10Y': '5Y TO 10Y', '10Y+': 'PAST 10Y' }
const EDGE_YEARS = [1, 5, 10]
// A ticket of a round tenor starts at spot and rolls to a business day, so it matures a few days past the
// anniversary of the day it was dealt; a year is also not 365.25 days. The ladder keeps a ten-year quote in 5-10Y,
// so a ten-year ticket belongs there too: a bucket ends at the calendar anniversary of the report's date plus a
// week (Emmy, 14 November 2026: by days over 365.25 a ten-year ticket fell in 10Y+).
export const GRACE_DAYS = 7
const day = (iso) => Date.parse(String(iso ?? '').slice(0, 10))
const plusYears = (ms, n) => { const d = new Date(ms); d.setUTCFullYear(d.getUTCFullYear() + n); return d.getTime() }

// The bucket a trade's maturity falls in, from the report's date. Used only to place a sensitivity that has no
// tenor of its own (a spot delta, a flat curve's one bucket) along the picture.
export function maturityBucket(maturityIso, asOfIso) {
  const m = day(maturityIso), a = day(asOfIso)
  if (!Number.isFinite(m) || !Number.isFinite(a)) return BUCKETS[0]
  const i = EDGE_YEARS.findIndex(n => m <= plusYears(a, n) + GRACE_DAYS * 864e5)
  return BUCKETS[i < 0 ? BUCKETS.length - 1 : i]
}

// The last year a bucket reaches from the report's date ("to 2031"); the last bucket has no end.
export function bucketReach(asOfIso) {
  const y = new Date(Date.parse(asOfIso) || Date.now()).getUTCFullYear()
  return [`to ${y + 1}`, `to ${y + 5}`, `to ${y + 10}`, `after ${y + 10}`]
}

const FIAT = new Set(['XAU', 'XAG', 'XPT', 'XPD', 'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'MXN', 'ZAR', 'SGD', 'HKD', 'CNH', 'CNY', 'TRY', 'BRL', 'INR', 'KRW'])
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
  const add = (v, b, x) => { const i = BUCKETS.indexOf(b); if (i < 0 || !Number.isFinite(x)) return 0; v[i] += x; return x }       // what was placed: a bucket the picture does not have places nothing
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
    if (row.buckets?.FLAT) { let placed = 0; for (const r of rows) { const x = r.kr01?.[row.curve]?.FLAT; if (x) placed += add(v, at(r), x * r.usd_rate) } rest(v, Number(row.buckets.FLAT), placed) }
    // a flat curve (one quote) has no bucket in the history, and the VaR gives it no move: neither does the picture
    const m = row.buckets?.FLAT ? null : sd[row.curve]
    push({ key: `IR:${row.curve}`, name: pretty(row.curve), measure: 'IR01', factor: 'ir', unit: 'per bp', moveUnit: 'bp', v, move: m ? BUCKETS.map(b => m[b] ?? null) : null })
  }
  for (const [asset, total] of Object.entries(lad.spot01 || {})) {
    const v = blank(); let placed = 0
    for (const r of rows) { const x = r.spot01?.[asset]; if (x) placed += add(v, at(r), x * r.usd_rate) }
    rest(v, Number(total), placed)
    const [factor, measure] = spotMeasure(asset), s = sd[`${asset}_SPOT`]?.SPOT
    push({ key: `SPOT:${asset}`, name: asset, measure, factor, unit: 'per 1%', moveUnit: '%', v, move: s != null ? BUCKETS.map(() => s) : null, byMaturity: true })
  }
  for (const [cid, total] of Object.entries(lad.crybasis01 || {})) {
    const v = blank(); let placed = 0
    for (const r of rows) for (const [b, x] of Object.entries(r.crybasis01?.[cid] || {})) placed += add(v, b === 'FLAT' ? at(r) : b, x * r.usd_rate)
    rest(v, Number(total), placed)
    push({ key: `BASIS:${cid}`, name: String(cid).replace(/_FUNDING$/, ''), measure: 'CRYBASIS01', factor: 'basis', unit: 'per bp', moveUnit: 'bp', v, move: null })
  }
  for (const row of lad.vega || []) {
    const v = blank()
    for (const b of BUCKETS) add(v, b, Number(row.buckets?.[b] || 0))
    if (row.buckets?.FLAT) { let placed = 0; for (const r of rows) { const x = r.vega?.[row.curve]?.FLAT; if (x) placed += add(v, at(r), x * r.usd_rate) } rest(v, Number(row.buckets.FLAT), placed) }
    const m = row.buckets?.FLAT ? null : sd[row.curve], sw = /_SWVOL/.test(row.curve)
    // the report's move for a surface is in hundredths of a point (of a bp of normal vol for a swaption grid), as the VaR multiplies it
    push({ key: `VEGA:${row.curve}`, name: surfaceName(row.curve), measure: 'VEGA', factor: 'vol', unit: sw ? 'per bp of vol' : 'per vol point', moveUnit: sw ? 'bp of vol' : 'pt', v, move: m ? BUCKETS.map(b => m[b] != null ? m[b] / 100 : null) : null })
  }
  return out.sort((a, b) => ORDER[a.factor] - ORDER[b.factor] || a.name.localeCompare(b.name))
}

// One day's carry of the book in dollars: the pricers' theta of each trade the report valued, added up. Null where
// no trade reports one.
export function carry(rep) {
  const xs = (rep?.ladder_rows || []).filter(r => r.usd_rate != null && Number.isFinite(r.theta)).map(r => r.theta * r.usd_rate)
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null
}

// Why a stored report is not the book as it stands, or null when it is: 'older' (stored before the report carried
// the moves), 'market' (the market data has a later date), 'book' (a live trade it did not value, a valued trade
// that is no longer live, or a trade booked after it was made). The home then asks for the report again, once.
const LIVE = new Set(['PENDING', 'CONFIRMED', 'LIVE'])           // backend/pnl/explain.py LIVE: what the ladder values
export function staleness(rep, trades = [], marketDate = null) {
  if (!rep || !rep.date) return null
  if (rep.moves === undefined) return 'older'
  if (marketDate && String(marketDate).slice(0, 10) > String(rep.date).slice(0, 10)) return 'market'
  const live = (trades || []).filter(t => LIVE.has(t.status))
  const seen = new Set((rep.ladder_rows || []).map(r => String(r.trade_id)))
  const failed = new Set((rep.ladder?.problems || []).map(p => p.trade_ref))
  const ids = new Set(live.map(t => String(t.id)))
  if (live.some(t => !seen.has(String(t.id)) && !failed.has(t.trade_ref)) || [...seen].some(id => !ids.has(id))) return 'book'
  const made = Date.parse(rep.generated_at)
  return Number.isFinite(made) && live.some(t => Date.parse(t.created_at) > made) ? 'book' : null
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

// ── a factor against its limits ──────────────────────────────────────────────
// A limit is one number on the size, whichever the sign (backend/risk/limits.py measures |value|), so it stands on
// both sides of a stream's line: the long limit above, the short limit below. The limits that are on a factor the
// picture draws, for the whole book: a curve's bucket (KR01:<curve>:<bucket>), a curve's total (IR01:<curve>), an
// asset's spot 01 (SPOT01:<asset>). A limit on a desk or a book is on a part of the book, and is not drawn on it.
export const LIMIT_MAX = 1.18                              // how far past its limit a stream is still drawn
const isAll = (l) => String(l?.scope || 'ALL').toUpperCase() === 'ALL'
// `used` is the share the API itself reports for the limit (utilisation_pct), where it reports one: the picture
// draws that, so the two cannot disagree (a flat curve's risk, which the picture places in a bucket, is not in the
// figure a bucket's limit is measured on).
const lim = (l) => ({ id: l.id, limit: Number(l.limit), warn: Number.isFinite(Number(l.warn_pct)) ? Number(l.warn_pct) / 100 : 0.8,
                      used: Number.isFinite(l.utilisation_pct) ? l.utilisation_pct / 100 : null, standard: !!l.standard })
export function factorLimits(limits = []) {
  const by = new Map()
  const at = (key) => { const k = key.toUpperCase(); if (!by.has(k)) by.set(k, { total: null, buckets: BUCKETS.map(() => null) }); return by.get(k) }
  for (const l of limits || []) {
    if (!isAll(l) || !(Number(l.limit) > 0)) continue
    const [head, a, b] = String(l.metric || '').split(':')
    const h = head.toUpperCase()
    if (h === 'KR01' && a && BUCKETS.includes(b)) at(`IR:${a}`).buckets[BUCKETS.indexOf(b)] = lim(l)
    else if (h === 'IR01' && a) at(`IR:${a}`).total = lim(l)
    else if (h === 'SPOT01' && a) at(`SPOT:${a}`).total = lim(l)
    else if (h === 'VEGA' && a && BUCKETS.includes(b)) at(`VEGA:${a}`).buckets[BUCKETS.indexOf(b)] = lim(l)
    else if (h === 'VEGA' && a && !b) at(`VEGA:${a}`).total = lim(l)
    else if (h === 'CRYBASIS01' && a) at(`BASIS:${a}`).total = lim(l)
  }
  return by
}
export const limitsOf = (f, by) => by?.get(String(f.key).toUpperCase()) || null
// The ids of the limits that stand on one of these factors: the ones the picture and the gauges already show.
export const shownOn = (list, by) => new Set(list.flatMap(f => { const fl = limitsOf(f, by); return fl ? [fl.total, ...fl.buckets].filter(Boolean).map(l => l.id) : [] }))
const stateOf = (u, warn) => Math.abs(u) >= 1 ? 'BREACH' : Math.abs(u) >= warn ? 'WARN' : 'OK'
// How a factor stands against its limits: each bucket's signed share of its own limit (null where the bucket has
// none), the total's share of the total's limit, and the tightest of them with the room left. The size of a share is
// the API's where it gave one; the side is the sign of the factor's own figure.
export function against(f, fl) {
  if (!fl) return null
  const one = (l, pos, bucket) => {
    const size = l.used != null ? l.used : Math.abs(pos) / l.limit, u = (pos < 0 ? -1 : 1) * size
    return { u, state: stateOf(u, l.warn), limit: l.limit, pos, bucket, room: l.limit * (1 - size), standard: l.standard }
  }
  const per = f.v.map((x, i) => fl.buckets[i] ? one(fl.buckets[i], x, BUCKETS[i]) : null)
  const total = fl.total ? one(fl.total, f.total, null) : null
  const all = [...per, total].filter(Boolean)
  if (!all.length) return null
  return { per, total, head: all.reduce((a, b) => Math.abs(b.u) > Math.abs(a.u) ? b : a) }
}

// What the picture draws for each factor: the height of each bucket between −1 and 1 (heights, above), where a
// bucket's own limit stands on the same scale (null where the bucket has none, or where it is off the lane), the
// share to write at a bucket, and the total against the total's limit (drawn as a gauge at the lane's start: a limit
// on a total is not a limit on each bucket, so it is never a line across them). 'limit' draws each bucket as the
// share of its own limit it uses, so a stream that reaches a bucket's line is at that limit; a bucket with no limit
// of its own is drawn as its share of the total's limit, or, with neither, against the factor's largest limit.
export function scene(list, mode, by) {
  const hs = heights(list, mode === 'limit' ? 'raw' : mode)
  const big = mode === 'day' ? Math.max(0, ...list.filter(f => f.hasDay).flatMap(f => f.day.map(Math.abs))) : 0
  const root = (x, top) => top > 0 ? Math.sqrt(Math.abs(x) / top) : null
  return list.map((f, k) => {
    const fl = limitsOf(f, by), ag = against(f, fl), top = Math.max(...f.v.map(Math.abs))
    let h = hs[k].h, own = hs[k].own, none = false
    if (mode === 'limit') {
      none = !ag; own = false
      const widest = fl ? Math.max(fl.total?.limit || 0, ...fl.buckets.map(b => b?.limit || 0)) : 0
      h = none ? f.v.map(x => (top ? x / top : 0) * 0.6) : f.v.map((x, i) => ag.per[i] ? ag.per[i].u : x / (fl.total?.limit || widest))
    }
    const bank = BUCKETS.map((_, i) => {
      const l = fl?.buckets[i]?.limit
      if (l == null) return null
      const y = mode === 'limit' ? 1 : mode === 'day' && f.hasDay ? root(l * f.move[i], big) : root(l, top)
      return y != null && y <= LIMIT_MAX + 0.02 ? y : null
    })
    const tags = BUCKETS.map((_, i) => ag?.per[i] && Math.abs(f.v[i]) >= EPS ? ag.per[i] : null)
    return { h: h.map(x => Math.max(-LIMIT_MAX, Math.min(LIMIT_MAX, x))), own, none, bank, tags, total: ag?.total || null, against: ag }
  })
}
export const canLimit = (list, by) => list.some(f => limitsOf(f, by))

// ── limits ───────────────────────────────────────────────────────────────────
const round = (n) => Math.round(n)
export function limitLabel(lim, scenarios = []) {
  const m = String(lim?.metric || ''), [head, a, b] = m.split(':')
  const name = head === 'VAR_99_1D' ? 'VAR' : head === 'VAR_95_1D' ? 'VAR 2ND' : head === 'ES_99_1D' ? 'ES' : head === 'VAR_H' ? 'VAR HORIZON'
    : head === 'IR01' ? (a ? `IR01 ${pretty(a)}` : 'IR01') : head === 'KR01' ? `${pretty(a)} ${b || ''}`.trim() : head === 'SPOT01' ? `${a} ${spotMeasure(a)[1]}`
    : head === 'STRESS' ? `STRESS ${(scenarios.find(s => s.id === a)?.name || a || '').toUpperCase()}` : head === 'PFE_PEAK' ? `PFE ${a || ''}`.trim()
    : head === 'VEGA' && a ? `${surfaceName(a).toUpperCase()} VEGA${b ? ` ${b}` : ''}` : head === 'CRYBASIS01' && a ? `${a.replace(/_FUNDING$/, '')} CRYBASIS01` : pretty(m)
  return lim?.scope && String(lim.scope).toUpperCase() !== 'ALL' && lim.scope_name ? `${name} · ${String(lim.scope_name).toUpperCase()}` : name
}
// One mark per limit that has a figure against it, the closest to its limit first. `side` says which way the figure
// it limits points: 1 long, −1 short (read from the factor the limit is on, for the whole book: the API gives the
// size alone), 0 for a size that has no side (a VaR, a stress loss, an exposure, a limit on part of the book).
export function limitMarks(limits = [], scenarios = [], list = [], npv = null) {
  const fac = new Map(list.map(f => [String(f.key).toUpperCase(), f]))
  const sideOf = (l) => {
    if (!isAll(l)) return 0
    const [head, a, b] = String(l.metric || '').split(':'), h = head.toUpperCase(), sgn = (x) => x > 0 ? 1 : x < 0 ? -1 : 0
    if (h === 'KR01') { const f = fac.get(`IR:${a}`.toUpperCase()), i = BUCKETS.indexOf(b); return f && i >= 0 ? sgn(f.v[i]) : 0 }
    if (h === 'IR01') return a ? sgn(fac.get(`IR:${a}`.toUpperCase())?.total || 0) : sgn(list.filter(f => f.factor === 'ir').reduce((s, f) => s + f.total, 0))
    if (h === 'SPOT01') return sgn(fac.get(`SPOT:${a}`.toUpperCase())?.total || 0)
    if (h === 'VEGA') { const f = fac.get(`VEGA:${a}`.toUpperCase()), i = BUCKETS.indexOf(b); return !f ? 0 : i >= 0 ? sgn(f.v[i]) : sgn(f.total) }
    if (h === 'CRYBASIS01') return sgn(fac.get(`BASIS:${a}`.toUpperCase())?.total || 0)
    if (h === 'NPV') return sgn(npv || 0)
    return 0
  }
  return (limits || []).filter(l => Number.isFinite(l?.utilisation_pct)).map(l => ({
    id: l.id, name: limitLabel(l, scenarios), u: l.utilisation_pct / 100, pct: round(l.utilisation_pct), status: l.status, value: l.value, limit: l.limit, side: sideOf(l), standard: !!l.standard,
    kind: /^(PFE|EPE|CVA|CE)/.test(String(l.metric)) ? 'c' : /^(VAR|ES|STRESS)/.test(String(l.metric).toUpperCase()) || !isAll(l) ? 's' : 'o',
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
  return { words, standardOnly: marks.length > 0 && marks.every(m => m.standard), tight: t ? `Closest: ${t.name}${t.side ? (t.side > 0 ? ', long' : ', short') : ''}, at ${t.pct}% of its limit.` : '' }
}
// Where each mark and its label go on a rail `width` px wide: flat in the middle, 125% of a limit at either end. A
// short figure is to the left of the middle, a long one and a size with no side to the right. A label that would
// run into its neighbour goes up a lane; the rail's own height follows the lanes used.
export const RAIL_MAX = 1.25
export const railAt = (m) => 0.5 + (m.side < 0 ? -1 : 1) * Math.min(Math.max(m.u, 0), RAIL_MAX) / RAIL_MAX / 2        // 0 to 1 along the rail
export function railLayout(marks, width, charW = 6.9) {
  const out = marks.map(m => ({ ...m, x: railAt(m) * width })).sort((a, b) => a.x - b.x)
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

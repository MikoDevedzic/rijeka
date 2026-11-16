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
  // a curve's risk at each of its quoted tenors (the report's `points`, since 0.40.0): what a bucket is made of.
  // An older stored report has none, and the picture then draws the bucket whole.
  const points = (row, move) => (row.points || []).map(p => {
    const i = BUCKETS.indexOf(p.bucket), x = Number(p.value)
    return { tenor: String(p.tenor), years: Number(p.years) || 0, i, x, day: move?.[i] != null ? x * move[i] : null }
  }).filter(p => p.i >= 0 && Math.abs(p.x) >= EPS)
  const rest = (v, total, placed) => { if (Number.isFinite(total) && Math.abs(total - placed) > Math.max(1, Math.abs(total) * 1e-6)) add(v, BUCKETS[0], total - placed) }

  for (const row of lad.ladder || []) {
    const v = blank()
    for (const b of BUCKETS) add(v, b, Number(row.buckets?.[b] || 0))
    if (row.buckets?.FLAT) { let placed = 0; for (const r of rows) { const x = r.kr01?.[row.curve]?.FLAT; if (x) placed += add(v, at(r), x * r.usd_rate) } rest(v, Number(row.buckets.FLAT), placed) }
    // a flat curve (one quote) has no bucket in the history, and the VaR gives it no move: neither does the picture
    const m = row.buckets?.FLAT ? null : sd[row.curve]
    const move = m ? BUCKETS.map(b => m[b] ?? null) : null
    push({ key: `IR:${row.curve}`, name: pretty(row.curve), measure: 'IR01', factor: 'ir', unit: 'per bp', moveUnit: 'bp', v, move, pts: points(row, move) })
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
    const move = m ? BUCKETS.map(b => m[b] != null ? m[b] / 100 : null) : null
    push({ key: `VEGA:${row.curve}`, name: surfaceName(row.curve), measure: 'VEGA', factor: 'vol', unit: sw ? 'per bp of vol' : 'per vol point', moveUnit: sw ? 'bp of vol' : 'pt', v, move, pts: points(row, move) })
  }
  return out.sort((a, b) => ORDER[a.factor] - ORDER[b.factor] || a.name.localeCompare(b.name))
}

// One day's carry of the book in dollars: the pricers' theta of each trade the report valued, added up. Null where
// no trade reports one.
export function carry(rep) {
  const xs = (rep?.ladder_rows || []).filter(r => r.usd_rate != null && Number.isFinite(r.theta)).map(r => r.theta * r.usd_rate)
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null
}

// The book in four figures, from the risk report: what the home's strip shows on a phone (a monitor has the
// trader's home). They are the Risk page's own figures, on its date and from its ladder, in the report's currency,
// so that one book has one set of numbers on every screen. Until 0.42.5 the strip read the brief's fact sheet:
// the book valued today on each pricer's own figures, a different sum on a different day (IR01 14,226 against the
// ladder's 10,176 on the integration book; Marco, 15 November 2026). Null where there is no report to read.
export function bookStrip(rep) {
  if (!rep || !rep.date) return null
  const lad = rep.ladder || {}, curves = lad.ladder || []
  const rows = (rep.ladder_rows || []).filter(r => r.usd_rate != null)
  const spot01 = {}
  for (const [asset, v] of Object.entries(lad.spot01 || {})) if (Number.isFinite(Number(v)) && Math.abs(v) >= 0.5) spot01[asset] = Number(v)
  return {
    date: String(rep.date).slice(0, 10), ccy: rep.reporting_ccy || 'USD',
    npv: rows.length ? rows.reduce((a, r) => a + (Number(r.npv) || 0) * r.usd_rate, 0) : null,
    ir01: curves.length ? curves.reduce((a, c) => a + (Number(c.total) || 0), 0) : null,
    spot01, theta: carry(rep),
  }
}

// Why a stored report is not the book as it stands, or null when it is: 'older' (stored before the report carried
// the moves, the fixings, or a curve's risk at its quoted tenors), 'market' (the market data has a later date),
// 'book' (a live trade it did not value, a valued trade that is no longer live, or a trade booked after it was
// made). The home then asks for the report again, once. The daily run keeps a day's report once it is stored, so
// without the 'older' rule a report made by the release before stays on the home until the market date moves:
// the picture drew whole buckets for a day after the tenors were live (15 November 2026).
const LIVE = new Set(['PENDING', 'CONFIRMED', 'LIVE'])           // backend/pnl/explain.py LIVE: what the ladder values
export function staleness(rep, trades = [], marketDate = null) {
  if (!rep || !rep.date) return null
  if (rep.moves === undefined || rep.fixings === undefined) return 'older'          // stored before the report carried the moves, or the fixings
  // since 0.40.0 every curve and surface of the ladder carries `points`, an empty list where it has none to give
  if ([...(rep.ladder?.ladder || []), ...(rep.ladder?.vega || [])].some(r => r.points === undefined)) return 'older'
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
  const big = mode === 'day' ? dayTop(list) : 0
  return list.map(f => {
    const pts = f.pts || []
    if (mode === 'day' && f.hasDay) return { h: f.day.map(x => root(x, big)), ph: pts.map(p => root(p.day, big)), own: false }
    const top = sizeTop(f)
    return { h: f.v.map(x => root(x, top)), ph: pts.map(p => root(p.x, top)), own: mode === 'day' }
  })
}
// The largest thing a factor draws: a bucket, or one quoted tenor of it (a two-year position against a five-year
// one nets in the bucket, and each point is then larger than the bucket).
const sizeTop = (f) => Math.max(0, ...f.v.map(Math.abs), ...(f.pts || []).map(p => Math.abs(p.x)))
const dayTop = (list) => Math.max(0, ...list.filter(f => f.hasDay).flatMap(f => [...f.day, ...(f.pts || []).map(p => p.day)].map(x => Math.abs(x || 0))))

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
  const big = mode === 'day' ? dayTop(list) : 0
  const root = (x, top) => top > 0 ? Math.sqrt(Math.abs(x) / top) : null
  return list.map((f, k) => {
    const fl = limitsOf(f, by), ag = against(f, fl), top = sizeTop(f), pts = f.pts || []
    let h = hs[k].h, ph = hs[k].ph, own = hs[k].own, none = false
    if (mode === 'limit') {
      none = !ag; own = false
      const widest = fl ? Math.max(fl.total?.limit || 0, ...fl.buckets.map(b => b?.limit || 0)) : 0
      // a point is drawn as the share of its bucket's limit it uses on its own: the points of a bucket then stand
      // against the same line the bucket does
      const share = (x, i) => none ? (top ? x / top : 0) * 0.6 : x / (fl.buckets[i]?.limit || fl.total?.limit || widest)
      h = none ? f.v.map(x => share(x)) : f.v.map((x, i) => ag.per[i] ? ag.per[i].u : share(x, i))
      ph = pts.map(p => share(p.x, p.i))
    }
    const bank = BUCKETS.map((_, i) => {
      const l = fl?.buckets[i]?.limit
      if (l == null) return null
      const y = mode === 'limit' ? 1 : mode === 'day' && f.hasDay ? root(l * f.move[i], big) : root(l, top)
      return y != null && y <= LIMIT_MAX + 0.02 ? y : null
    })
    const tags = BUCKETS.map((_, i) => ag?.per[i] && Math.abs(f.v[i]) >= EPS ? ag.per[i] : null)
    const held = (x) => Math.max(-LIMIT_MAX, Math.min(LIMIT_MAX, x))
    return { h: h.map(held), ph: ph.map(held), own, none, bank, tags, total: ag?.total || null, against: ag }
  })
}
export const canLimit = (list, by) => list.some(f => limitsOf(f, by))

// ── the picture's columns ────────────────────────────────────────────────────
// A quoted tenor has a column of its own where it carries at least this share of its factor's largest point. The
// rest are not drawn (the Risk page lists every one): a five-year swap is priced a little off every quote before
// five years, and a column for each would leave no room to read the one that matters.
export const MATERIAL = 0.03

// The columns of the picture, nearest first: within each bucket one for every quoted tenor that some factor
// carries materially, or one for the bucket whole where no factor has a point there. `groups` says which columns
// are each bucket's.
export function columns(list) {
  const per = BUCKETS.map(() => new Map())
  for (const f of list) {
    const top = Math.max(0, ...(f.pts || []).map(p => Math.abs(p.x)))
    for (const p of f.pts || []) if (Math.abs(p.x) >= MATERIAL * top) per[p.i].set(p.tenor, p.years)
  }
  const slots = [], groups = []
  per.forEach((m, i) => {
    const from = slots.length, ts = [...m.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t)
    if (ts.length) ts.forEach(tenor => slots.push({ i, tenor })); else slots.push({ i, tenor: null })
    groups.push({ i, from, to: slots.length })
  })
  return { slots, groups }
}

// What one factor draws, nearest first. A point in a column of its own: { from, to, i, tenor, h, x, day }. A
// bucket the factor carries with no point of its own drawn in it is drawn whole, across the bucket's columns (the
// same with `tenor` null): a spot delta placed by its trade's maturity, a flat curve, an older report, and a
// bucket whose points are all too small for a column, so that what a factor carries in a bucket is never left off
// the picture (Vera, 15 November 2026). `sc` is the factor's entry in scene(). `left` counts the points given no
// column in a bucket where another point of the factor has one.
export function laneMarks(f, sc, cols) {
  const slotOf = new Map(cols.slots.map((s, k) => [`${s.i}:${s.tenor}`, k])), pts = f.pts || [], out = []
  const drawn = new Set()                                   // the buckets in which a point of this factor has a column
  pts.forEach((p, j) => {
    const k = slotOf.get(`${p.i}:${p.tenor}`)
    if (k == null) return
    drawn.add(p.i)
    out.push({ from: k, to: k + 1, i: p.i, tenor: p.tenor, h: sc.ph[j], x: p.x, day: p.day })
  })
  BUCKETS.forEach((_, i) => {
    if (!(Math.abs(f.v[i]) >= EPS) || drawn.has(i)) return
    out.push({ from: cols.groups[i].from, to: cols.groups[i].to, i, tenor: null, h: sc.h[i], x: f.v[i], day: f.day?.[i] ?? null })
  })
  const left = pts.filter(p => drawn.has(p.i) && !slotOf.has(`${p.i}:${p.tenor}`)).length
  return { marks: out.sort((a, b) => a.from - b.from), left }
}

// What is written at a box: what it carries on the scale being read ('day': what a usual day moves it by, in USD,
// where the factor has a usual move; otherwise the sensitivity itself). `short` is the same figure in fewer
// characters, for a column too narrow for the whole of it.
export function markFigure(f, m, mode, short = false) {
  const x = mode === 'day' && f.hasDay && m.day != null ? m.day : m.x
  return short ? signedShort(x) : signed(x)
}
export const signedShort = (n) => {
  const a = Math.abs(Number(n)), sg = n > 0 ? '+' : '−'
  if (!Number.isFinite(a)) return '—'
  return a >= 999_500 ? `${sg}${(a / 1e6).toFixed(a >= 99_950_000 ? 0 : a >= 9_995_000 ? 1 : 2)}m` : a >= 9_950 ? `${sg}${Math.round(a / 1e3)}k` : signed(n)
}

// Which figures of one lane are written, and where each starts. `items`, one for each box: { cx, y, inside, box:
// [left, top, right, bottom], full, short, size }, where `y` is the figure's baseline (figureAt), `cx` the box's
// middle and `size` what the box carries. The largest boxes are written first, whole if there is room and
// shortened if not; a figure that would run into one already written, or into another box, is left to the tip. A
// figure inside its box must fit the box. `width` measures a string as it will be drawn; figures stay between `x0`
// and `x1`. Returns, for each item, { fig, x, w } (the figure, where it starts and how wide it is) or null.
export function laneFigures(items, width, { x0, x1, text = 10, gap = 5 }) {
  const hit = (r, q, g) => r[0] < q[2] + g && q[0] < r[2] + g && r[1] < q[3] && q[1] < r[3]
  const out = items.map(() => null), written = []
  const order = items.map((_, k) => k).sort((p, q) => Math.abs(items[q].size) - Math.abs(items[p].size))
  for (const k of order) {
    const it = items[k]
    for (const fig of it.full === it.short ? [it.full] : [it.full, it.short]) {
      const w = width(fig)
      if (it.inside && w > it.box[2] - it.box[0] - 6) continue
      const x = Math.max(x0, Math.min(x1 - w, it.cx - w / 2)), r = [x, it.y - text, x + w, it.y]
      if (written.some(q => hit(r, q, gap))) continue
      if (!it.inside && items.some((o, j) => j !== k && hit(r, o.box, 1))) continue
      out[k] = { fig, x, w }; written.push(r)
      break
    }
  }
  return out
}

// Where a bucket's figure is written: the y of its baseline, and whether that is inside the box. `side` 1 long (the
// box stands above the stream's line at `base`), −1 short; `tall` the box's height; `line` how far from `base` the
// bucket's own limit line stands on that side (null with none); `half` half the lane's height; `text` the figure's
// height. Tried in turn: just past the box's far edge; past the limit line where that is in the way; just past the
// box though the limit line is there (`onLine`: the line is then drawn with a break for the figure, which is how a
// box close to its limit reads); inside the box, at its far edge (nearer the stream's line than the limit line
// where that crosses the box). A figure never leaves its lane, so it cannot be written over the lane beside it.
export function figureAt({ side, base, tall, line = null, half, text = 10 }) {
  const far = base - side * tall, lineY = line == null ? null : base - side * line
  const past = (edge) => side > 0 ? edge - 5 : edge + 5 + text
  const fits = (y) => side > 0 ? y - text >= base - half : y <= base + half
  // the limit line and the hatching on its far side take five px; a figure is kept two px clear of them
  const hits = (y) => lineY != null && (side > 0 ? y >= lineY - 7 && y - text <= lineY + 3 : y - text <= lineY + 7 && y >= lineY - 3)
  const out = past(far)
  if (fits(out) && !hits(out)) return { y: out, inside: false }
  if (lineY != null) {
    const beyond = past(side > 0 ? Math.min(far, lineY - 4) : Math.max(far, lineY + 4))
    if (fits(beyond)) return { y: beyond, inside: false }
    if (fits(out)) return { y: out, inside: false, onLine: true }          // on the line, which gives way to it
  }
  if (tall >= text + 9) {
    let y = side > 0 ? far + text + 4 : far - 5
    if (hits(y) && line >= text + 12) y = side > 0 ? lineY + text + 5 : lineY - 6
    return { y, inside: true }
  }
  return { y: side > 0 ? Math.max(out, base - half + text) : Math.min(out, base + half), inside: false }
}

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
  else if (over) words.push(['over', `${over} limit${over > 1 ? 's' : ''} breached`])          // the Risk page's word for the same thing
  else words.push(['ok', 'Inside every limit'])
  if (near) words.push(['near', `${near} close`])
  if (marks.length && clear) words.push(['dim', `${clear} clear`])
  if (pending) words.push(['hollow', `${pending} pending`])        // trades awaiting a signature, the blotter's word; whose turn it is, NEEDS YOU says
  const t = marks[0]                                               // the marks come most used first: past its limit it is not "closest" to it
  const lead = t && t.status === 'BREACH' ? 'Furthest past' : 'Closest'
  return { words, standardOnly: marks.length > 0 && marks.every(m => m.standard), tight: t ? `${lead}: ${t.name}${t.side ? (t.side > 0 ? ', long' : ', short') : ''}, at ${t.pct}% of its limit.` : '' }
}

// The line under the three items NEEDS YOU shows: how many more there are, and where they are when they are all in
// one place. An item about a trade is on the blotter and one about a limit on the Risk page; a batch that has not
// run or the chain's node is on neither, so a mixed rest is only counted.
export function more(rest) {
  const n = rest.length
  if (!n) return ''
  const where = (a) => a.chat || /^\/messenger/.test(a.href || '') ? 'in chat' : /^\/blotter/.test(a.href || '') ? 'on the blotter' : /^\/risk/.test(a.href || '') ? 'on the Risk page' : ''
  const places = new Set(rest.map(where))
  const one = places.size === 1 ? [...places][0] : ''
  return `and ${n} more${one ? ' ' + one : ''}`
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

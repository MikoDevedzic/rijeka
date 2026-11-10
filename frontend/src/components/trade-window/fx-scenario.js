// trade-window/fx-scenario.js
// ────────────────────────────────────────────────────────────────────────────────────
// The arithmetic of the CURVE SCENARIO tab of an FX or digital-asset ticket, as pure
// functions: no React, no fetch, no canvas. FxTabs.jsx holds the state and
// FxScenarioChart.jsx draws; both read their numbers from here.
//
//   interpPoints     forward points at a day count: the backend's interp_points, line for line
//   rippleWeights    how far a dragged tenor carries its neighbours
//   applyTenorDrag   the dragged curve, inside its bounds
//   reprice          the panel's closed form, with the dragged points added to the forward
//   settlementAmount what a fixing pays
//   strikeAsBooked   K as the ticket will book it: the terms' own, else the quote's rounded to the pair's decimals
//   settledState     a booked trade past its fixing date: nothing here is repriced for it
//   isoDate / axisDates  the one date format the tabs print (YYYY-MM-DD; MM-DD on a dense axis in one year)
//   chartGeometry    the chart's scales, shared by the drawing and the hit test
//
// One rule for every function: an input it needs that is missing or not finite gives null,
// never a number put in its place. The caller shows a dash or a different view.
// ────────────────────────────────────────────────────────────────────────────────────

// Days from the spot date to each quoted tenor. GET /api/currency/pairs sends the backend's own map as
// tenor_days (tenorMap below); this copy stands in only for an API answer that does not carry it.
export const TENOR_DAYS = { ON: 1, '1W': 7, '2W': 14, '1M': 30, '2M': 61, '3M': 91, '6M': 182, '9M': 273, '1Y': 365, '2Y': 730 }

export const SPOT_BOUND_PCT = 50      // the whole curve moves at most ±50 % (the SPOT shock)
export const TENOR_BOUND = 0.5        // one tenor moves at most ±50 % of spot, in price
export const FORWARD_FLOOR = 0.01     // and never below 1 % of spot: a forward stays positive
export const RIPPLE_SIGMA = 0.15      // width of the ripple, in square-root years (the chart's own time axis)
export const FIXING_DAYS = 30         // how far back the chart's left side reaches
export const RATE_SHOCK_BOUND = 300   // a rate pillar moves at most ±300 bp, flat shock and its own together
export const FX_SPOT_LAG_DAYS = 2     // the market's convention for a currency pair, for a caller that cannot infer it

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const positive = (v) => finite(v) && v > 0
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
// a number as the API sends it: a finite number, or a string that is one; anything else is not a number (null is not 0)
const asNumber = (v) => finite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null

// ── the forward curve ────────────────────────────────────────────────────────────────

// The backend's tenor map when the pairs answer carries a usable one, otherwise this module's copy.
export function tenorMap(fromApi) {
  if (!fromApi || typeof fromApi !== 'object') return TENOR_DAYS
  const entries = Object.entries(fromApi)
  return entries.length > 0 && entries.every(([, d]) => positive(d)) ? Object.fromEntries(entries) : TENOR_DAYS
}

// The quoted tenors of a points curve as [days, points], ascending; null when the curve is missing or a quoted
// tenor has no number. A tenor the map does not know is not a point (the backend drops it the same way).
function quotedPoints(points, tenorDays) {
  if (!points || typeof points !== 'object' || !tenorDays) return null
  const xs = []
  for (const [t, v] of Object.entries(points)) {
    if (tenorDays[t] == null) continue
    const n = asNumber(v)
    if (n == null) return null
    xs.push([tenorDays[t], n, t])
  }
  return xs.sort((a, b) => a[0] - b[0])
}

// Forward points at `days` from the spot date: linear in days between quoted tenors, 0 at spot, flat beyond
// the last tenor. The same rule as interp_points in backend/api/routes/currencies.py.
export function interpPoints(points, days, tenorDays = TENOR_DAYS) {
  const quoted = quotedPoints(points, tenorDays)
  if (!quoted || !finite(days)) return null
  const xs = [[0, 0], ...quoted]
  if (days <= 0) return 0
  for (let i = 0; i + 1 < xs.length; i++) {
    const [d0, p0] = xs[i], [d1, p1] = xs[i + 1]
    if (d0 <= days && days <= d1) return d1 > d0 ? p0 + (p1 - p0) * (days - d0) / (d1 - d0) : p1
  }
  return xs[xs.length - 1][1]
}

// Whole days from one ISO date to another (b − a); null when either is not a date.
export function daysBetween(a, b) {
  const utc = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null }
  const x = utc(a), y = utc(b)
  return x == null || y == null ? null : Math.round((y - x) / 86400000)
}

// ── dates as the tabs print them ─────────────────────────────────────────────────────
// One format everywhere: ISO YYYY-MM-DD. A value that starts with a date (an ISO timestamp too) is cut to the
// date; anything else is '' and the caller leaves the words out.
const ISO = /^(\d{4})-(\d{2})-(\d{2})/
export const isoDate = (s) => { const m = ISO.exec(String(s ?? '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : '' }

// The date `n` whole days from an ISO date, as ISO; '' when the start is not a date.
export function addDays(iso, n) {
  const m = ISO.exec(String(iso ?? ''))
  return m && finite(n) ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10) : ''
}

// The ticks of a dense time axis: MM-DD when every date on the axis is in one year (the year is said nowhere
// else, so it must be the same for all of them), else each in full. A tick that is not a date is ''.
export function axisDates(dates) {
  const isos = (Array.isArray(dates) ? dates : []).map(isoDate)
  const years = new Set(isos.filter(Boolean).map(d => d.slice(0, 4)))
  return isos.map(d => (d && years.size === 1 ? d.slice(5) : d))
}

// ── the strike as booked ─────────────────────────────────────────────────────────────

// A number to the nearest `dp` decimals (toFixed, so the same digits the tabs print); null for anything else.
// A change with its sign, at the decimals shown: "+1,234", "-56", and a plain "0" for one that rounds to nothing (a
// zero is neither a gain nor a loss). en-US like the rest of the ticket, whatever the browser's locale.
export function signedChange(x, dp = 0) {
  if (!finite(x)) return '—'
  const r = Number(x.toFixed(dp))
  const body = Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
  return r > 0 ? '+' + body : r < 0 ? '-' + body : body
}
export const roundTo = (x, dp) => (finite(x) && Number.isInteger(dp) && dp >= 0 ? Number(x.toFixed(dp)) : null)

// K as the ticket will book it. The terms a ticket passes carry the level it sends to the record (a forward's
// forward_price / forward_rate, an option's strike_price / strike, as strings); when they do, that is K. Without
// one, the quote's level rounded to the pair's decimals, which is what a blank strike books (fx-ticket.js
// bookedStrike rounds the same way; this one reads the terms first). A touch has no K.
export function strikeAsBooked(q, terms, dp) {
  if (!q) return null
  if (q.shape === 'OPTION' && q.style === 'TOUCH') return null
  const own = q.shape === 'OPTION' ? [terms?.strike_price, terms?.strike] : [terms?.forward_price, terms?.forward_rate]
  for (const v of own) { const n = asNumber(v); if (positive(n)) return n }
  const k = chartStrike(q)
  return k == null ? null : (roundTo(k, dp) ?? k)
}

// Points are quoted from the spot date. A digital asset's spot settles at once (lag 0). The engine's answer names
// the lag it carried the forward over (`tSpot`, in years, ACT/365): when it does, that is the lag. An older answer
// does not, and the lag is then the one at which the stored points give back the quote's own market points. Null
// when the inputs are missing or no single lag stands out: the caller then says which convention it falls back
// on (FX_SPOT_LAG_DAYS).
export function spotLagDays({ points, settleDays, marketPoints, crypto, tSpot, tenorDays = TENOR_DAYS } = {}) {
  if (crypto === true) return 0
  if (finite(tSpot) && tSpot >= 0) return Math.round(tSpot * 365)
  if (!finite(marketPoints) || !finite(settleDays)) return null
  const errs = []
  for (let lag = 0; lag <= 7; lag++) {
    const p = interpPoints(points, settleDays - lag, tenorDays)
    if (p == null) return null
    errs.push(Math.abs(p - marketPoints))
  }
  const least = Math.min(...errs)
  const at = errs.map((e, lag) => (e <= least + 1e-9 ? lag : -1)).filter(lag => lag >= 0)
  return at.length === 1 ? at[0] : null
}

// A ticket priced without quoted points (parity, or the desk's own funding rate) still has a curve: the carry
// that takes its spot to its forward, at every tenor. In points, so the chart and the drag treat it as quoted.
// A trade that settles at spot has no carry to read: its curve is flat.
export function carryPoints({ spot, forward, days, pip, tenorDays = TENOR_DAYS } = {}) {
  if (!positive(spot) || !positive(forward) || !positive(pip) || !finite(days) || !tenorDays) return null
  const c = days > 0 ? Math.log(forward / spot) / days : 0
  const out = {}
  for (const [t, d] of Object.entries(tenorDays)) out[t] = spot * (Math.exp(c * d) - 1) / pip
  return out
}

// The tenors of a points curve in order: days from the spot date, and x, the days from today the chart draws at.
export function curveNodes(points, lag = 0, tenorDays = TENOR_DAYS) {
  const quoted = quotedPoints(points, tenorDays)
  if (!quoted || !finite(lag)) return null
  return quoted.map(([days, p, tenor]) => ({ tenor, days, x: days + lag, points: p }))
}

const validNodes = (nodes) => Array.isArray(nodes) && nodes.every(n => n && finite(n.days) && finite(n.x) && finite(n.points))

// ── the drag ─────────────────────────────────────────────────────────────────────────

// A Gaussian around the dragged tenor, measured on the square-root time axis the chart is drawn on, so the
// ripple looks the same width at the short end and at the long end. The dragged tenor itself moves in full.
export function rippleWeights(nodes, k, sigma = RIPPLE_SIGMA) {
  if (!validNodes(nodes) || !nodes[k] || !positive(sigma)) return null
  const u = (n) => Math.sqrt(n.days / 365)
  return nodes.map((n, i) => i === k ? 1 : Math.exp(-((u(n) - u(nodes[k])) ** 2) / (2 * sigma * sigma)))
}

// How far each tenor may move, in points: ±TENOR_BOUND of spot, and never to a forward below the floor.
export function tenorBounds(nodes, { spot, pip } = {}) {
  if (!validNodes(nodes) || !positive(spot) || !positive(pip)) return null
  return nodes.map(n => {
    const price = spot + n.points * pip
    const lo = Math.max(-TENOR_BOUND * spot, FORWARD_FLOOR * spot - price) / pip
    return { lo: Math.min(lo, 0), hi: TENOR_BOUND * spot / pip }
  })
}

// The moves of every tenor after the dragged one has gone `move` points from where the drag began.
export function applyTenorDrag({ origin, weights, move, bounds } = {}) {
  if (!Array.isArray(origin) || !Array.isArray(weights) || !Array.isArray(bounds) || !finite(move)) return null
  if (weights.length !== origin.length || bounds.length !== origin.length) return null
  if (!origin.every(finite) || !weights.every(finite) || !bounds.every(b => b && finite(b.lo) && finite(b.hi))) return null
  return origin.map((d, i) => clamp(d + move * weights[i], bounds[i].lo, bounds[i].hi))
}

export const clampSpotPct = (pct) => finite(pct) ? clamp(pct, -SPOT_BOUND_PCT, SPOT_BOUND_PCT) : null

// A whole-curve drag is the SPOT shock: the point under the cursor, worth `ref` at no spot shock, has gone
// `dPrice` from where the drag began.
export const spotPctFromDrag = ({ originPct, dPrice, ref } = {}) =>
  finite(originPct) && finite(dPrice) && positive(ref) ? clampSpotPct(originPct + 100 * dPrice / ref) : null

// The carry factor of the two rate shocks over `days`: a forward moves by exp((Δr_quote − Δr_base)·τ), τ the time
// its carry runs over: from the spot date to the tenor (a node's `days`), as in the engine, not from today.
export const carryFactor = (quoteBp, baseBp, days) =>
  finite(quoteBp) && finite(baseBp) && finite(days) ? Math.exp((quoteBp - baseBp) / 10000 * days / 365) : null

// The curve the chart draws: spot at today, then each tenor, base and shocked.
// shocked = (spot + (points + move)·pip) · (1 + spot shock) · carry factor from the spot date to that tenor.
export function shockedCurve({ spot, pip, nodes, moves, spotPct = 0, quoteBp = 0, baseBp = 0 } = {}) {
  if (!positive(spot) || !positive(pip) || !validNodes(nodes) || !finite(spotPct) || !finite(quoteBp) || !finite(baseBp)) return null
  if (!Array.isArray(moves) || moves.length !== nodes.length || !moves.every(finite)) return null
  const k = 1 + spotPct / 100
  return [
    { tenor: 'SPOT', x: 0, base: spot, shocked: spot * k },
    ...nodes.map((n, i) => ({
      tenor: n.tenor, x: n.x,
      base: spot + n.points * pip,
      shocked: (spot + (n.points + moves[i]) * pip) * k * carryFactor(quoteBp, baseBp, n.days),
    })),
  ]
}

// ── a rate curve shocked point by point ────────────────────────────────────────────────────────────────
// A forward or an option settles on one date, so of a discounting curve its price sees one number: the zero rate
// to that date. A shock typed or dragged on a pillar reaches the price through the shock at the settlement time:
// read between the two pillars around it, linearly in time, and held flat before the first pillar and after the
// last. `pillars` are the curve's own ({date, t, zero_pct}), `shocks` the basis points on each by its date.
export function shockAtTime(pillars, shocks, t) {
  if (!Array.isArray(pillars) || !pillars.length || !finite(t)) return 0
  const at = (p) => { const b = Number(shocks?.[p.date]); return finite(b) ? b : 0 }
  if (t <= pillars[0].t) return at(pillars[0])
  for (let i = 1; i < pillars.length; i++) {
    const a = pillars[i - 1], b = pillars[i]
    if (t <= b.t) return b.t > a.t ? at(a) + (at(b) - at(a)) * (t - a.t) / (b.t - a.t) : at(b)
  }
  return at(pillars[pillars.length - 1])
}

// The pillars a single-date trade is drawn against: every pillar up to its settlement and the two after it (the
// one that closes the interval it sits in, and one more for the shape), at most `max`, the nearest to it kept.
// Pillars beyond those cannot reach the price. [] for anything that is not a list of pillars.
export function pillarsShown(pillars, t, max = 8) {
  if (!Array.isArray(pillars) || !finite(t)) return []
  const ok = pillars.filter(p => p && finite(p.t) && p.t > 0 && finite(p.zero_pct) && typeof p.date === 'string').sort((a, b) => a.t - b.t)
  const after = ok.findIndex(p => p.t >= t)
  const end = after < 0 ? ok.length : Math.min(ok.length, after + 2)
  return ok.slice(Math.max(0, end - max), end)
}

// A pillar's name on the chart and in the table: its time as a tenor (1W, 3M, 2Y), to the nearest whole unit.
export function tenorLabel(t) {
  if (!finite(t) || t <= 0) return ''
  const days = t * 365
  if (days < 25) return days < 4 ? `${Math.max(1, Math.round(days))}D` : `${Math.round(days / 7)}W`
  if (days < 345) return `${Math.round(days / 30.4)}M`
  const y = days / 365
  return Math.abs(y - Math.round(y)) < 0.08 ? `${Math.round(y)}Y` : `${Math.round(days / 30.4)}M`
}

// ── the closed form ──────────────────────────────────────────────────────────────────

export const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989422804014327 * Math.exp(-x * x / 2); const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x >= 0 ? 1 - p : p }

export function gk(F, K, T, sigma, call, df) {
  if (!positive(F) || !positive(K) || !finite(T) || !finite(sigma) || !finite(df) || typeof call !== 'boolean') return null
  if (T <= 0 || sigma <= 0) return df * Math.max(call ? F - K : K - F, 0)
  const sT = sigma * Math.sqrt(T); const d1 = (Math.log(F / K) + 0.5 * sT * sT) / sT; const d2 = d1 - sT
  return df * (call ? F * Phi(d1) - K * Phi(d2) : K * Phi(-d2) - F * Phi(-d1))
}

// The engine's closed form under the panel's shocks. With no dragged points this is the arithmetic the panel
// has always used; `dPoints` is the change in forward points at the trade's settlement date (the dragged curve
// interpolated there), which rides the spot and rate shocks like the rest of the forward:
//   F' = F · (1 + spot shock) · exp((Δr_quote − Δr_base)·τ) + dPoints · pip · (1 + spot shock) · exp((Δr_quote − Δr_base)·τ)
//   DF_quote' = DF_quote · exp(−Δr_quote·T)
//   forward: NPV = ±N · (F' − K) · DF_quote'        option: NPV = ±N · Black-76(F', K, T_expiry, σ', DF_quote')
// F is the engine's own forward. T runs from today to settlement and τ = T − T_spot from the spot date to
// settlement: the engine carries a quoted FX spot from its spot date (pricing/currency_forward.py) and says how
// far that is from today in `t_spot` (0 for a digital asset, and for an answer that does not name it). So a
// parity-mode forward under a spot or a parallel rate shock is the engine's own figure, not an approximation of
// it. Under quoted points the engine holds the forward against the curves and adds the same points to a moved
// spot; here the points scale with spot and the sliders show the carry effect (the panel says so).
// Null when the quote does not carry what the form needs (a settled trade's body has no discount factor and no
// time to settlement): there is then no forward to show, and none is made up.
export function reprice(q, { spotPct = 0, quoteBp = 0, baseBp = 0, volPts = 0, dPoints = 0, pip = 1 } = {}) {
  if (!q || (q.direction !== 'BUY' && q.direction !== 'SELL')) return null
  if (![spotPct, quoteBp, baseBp, volPts, dPoints].every(finite) || !positive(pip)) return null
  const option = q.shape === 'OPTION'
  const T = option ? q.t_settle : q.t
  if (!positive(q.spot) || !positive(q.forward) || !finite(q.base_notional) || !positive(q.df_quote) || !finite(T)) return null
  if (option ? !(positive(q.strike) && finite(q.t_expiry) && finite(q.vol_pct) && (q.option_type === 'CALL' || q.option_type === 'PUT'))
             : !(finite(q.forward_rate) && positive(q.df_base))) return null
  const sign = q.direction === 'BUY' ? 1 : -1
  const k = 1 + spotPct / 100
  const S = q.spot * k
  const tSpot = finite(q.t_spot) && q.t_spot > 0 ? q.t_spot : 0
  const carry = Math.exp((quoteBp - baseBp) / 10000 * Math.max(T - tSpot, 0))
  const dfq = q.df_quote * Math.exp(-quoteBp / 10000 * T)
  // The engine's own forward, moved by the shocks, in both forward modes and for an option as for a forward. It is
  // never rebuilt here as S·DF_base/DF_quote: the two discount factors the quote names run from today, so on a
  // pair whose spot settles later that product is off by the carry over the spot lag (1.6 pips of forward on a
  // three-month EURUSD at 3.9% against 2.1%, three days to spot) and the unshocked scenario would not be the
  // ticket's NPV.
  let F = q.forward * k * carry
  if (dPoints) F += dPoints * pip * k * carry
  if (!finite(F)) return null
  F = Math.max(F, FORWARD_FLOOR * S)                               // a shocked forward is never zero or negative
  const unit = option ? gk(F, q.strike, q.t_expiry, Math.max(q.vol_pct / 100 + volPts / 100, 0.0001), q.option_type === 'CALL', dfq)
                      : (F - q.forward_rate) * dfq
  return finite(unit) ? { forward: F, npv: sign * q.base_notional * unit } : null      // a null unit value is not a zero
}

// ── the fixing ───────────────────────────────────────────────────────────────────────

// What a fixing pays, in the quote currency, from the booker's side (backend/settlement/rule.py):
// forward ±N·(fixing − K); European call ±N·max(fixing − K, 0); put ±N·max(K − fixing, 0).
export function settlementAmount({ shape, optionType, direction, notional, strike, fixing } = {}) {
  if (![notional, strike, fixing].every(finite) || !(fixing > 0)) return null
  if ((direction !== 'BUY' && direction !== 'SELL') || !shape) return null
  if (shape === 'OPTION' && optionType !== 'CALL' && optionType !== 'PUT') return null
  const sign = direction === 'BUY' ? 1 : -1
  const amount = shape === 'OPTION' ? sign * notional * Math.max(optionType === 'CALL' ? fixing - strike : strike - fixing, 0)
                                    : sign * notional * (fixing - strike)
  return amount === 0 ? 0 : amount                                 // never "-0"
}

const usable = (r) => r && typeof r.date === 'string' && positive(asNumber(r.value))

// The latest stored fixing of exactly this source (never another source's price, never the stored spot);
// on one date the desk's own entry stands before the shared one.
export function latestFixing(fixings, source) {
  if (!source) return null
  const rows = (fixings || []).filter(r => usable(r) && r.origin !== 'SPOT' && r.source === source)
  if (!rows.length) return null
  return rows.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.own && !a.own) ? b : a))
}

// The one series the chart's left side draws: the trade's own source when it has stored fixings, otherwise the
// source with the most, otherwise the stored spots. One point per date, ascending.
export function fixingSeries(fixings, source) {
  const rows = (fixings || []).filter(usable)
  if (!rows.length) return null
  const real = rows.filter(r => r.origin !== 'SPOT')
  let pick, label, spot = false
  if (!real.length) { pick = rows; label = 'stored spot'; spot = true }
  else {
    const by = new Map()
    real.forEach(r => by.set(r.source, [...(by.get(r.source) || []), r]))
    label = source && by.has(source) ? source : [...by.entries()].sort((a, b) => b[1].length - a[1].length)[0][0]
    pick = by.get(label)
  }
  const perDate = new Map()
  pick.forEach(r => { const had = perDate.get(r.date); if (!had || r.own || !had.own) perDate.set(r.date, r) })
  const out = [...perDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map(r => ({ date: r.date, value: asNumber(r.value) }))
  return { label, spot, ownSource: !spot && !!source && label === source, rows: out }
}

// The time a source fixes at, from the pair's own list of settlement sources (GET /api/currency/pairs,
// fixing_sources); null when the list does not name the source.
export function fixingTime(sources, source) {
  if (!Array.isArray(sources) || !source) return null
  const s = sources.find(x => x && x.source === source)
  return s && typeof s.time === 'string' && s.time.trim() ? s.time : null
}

// A booked trade whose fixing date has been reached: 'FIXED' (not yet settled) or 'SETTLED'; null while it is
// live or is a ticket being priced. The API names the state; an answer without it is read from the fields it
// has always carried (settled, or a fixing date with no discount factor).
export function settledState(q) {
  if (!q) return null
  if (q.state === 'FIXED' || q.state === 'SETTLED') return q.state
  if (q.state != null) return null
  if (q.settled === true) return 'SETTLED'
  return q.fixing_date != null && q.df_quote == null ? 'FIXED' : null
}

// Why a fixed or settled trade's figures are provisional, as the API reports it: no fixing stored for the named
// source (the API sends fixing: null), an unrecorded barrier state, or whatever else it says.
export function provisionalReasons(q, source) {
  if (!q || q.provisional !== true) return []
  const said = [q.provisional_reason, q.provisional_basis].filter(s => typeof s === 'string' && s.trim()).join(' ')
  const out = []
  // the API sends settlement_amount_if_touched only when the amount hangs on a knock state nobody recorded
  const ifTouched = asNumber(q.settlement_amount_if_touched)
  if (q.fixing == null) out.push({ kind: 'NO_FIXING', source: source || q.fixing_source || null, date: q.fixing_date || null })
  if (ifTouched != null || /barrier|knock|touch/i.test(said)) out.push({ kind: 'BARRIER', ifTouched })
  if (!out.length) out.push({ kind: 'OTHER', text: said || null })
  return out
}

// Everything the three tabs state about a fixed or settled trade, read off the API's body and nothing else:
// no figure here is worked out in the browser. The fixing is the one the API used (null when none is stored for
// the trade's source: the price is then the stored spot, and says so); the amount is the API's settlement_amount.
//   priceUsed / priceIsFixing   the price in the CASHFLOWS row: the fixing, or the stored spot it stood in for
//   amountNote                  the line under SETTLEMENT AMOUNT: the API's own `model` words when it sends them
export function settledFacts(q, terms, sources) {
  const state = settledState(q)
  if (!state) return null
  const fx = q.fixing && typeof q.fixing === 'object' && asNumber(q.fixing.value) != null ? q.fixing : null
  const source = fx?.source || q.fixing_source || terms?.settlement_price_source || terms?.fixing_source || null
  const amount = asNumber(q.settlement_amount), price = asNumber(q.settlement_price)
  const provisional = q.provisional === true
  const model = typeof q.model === 'string' && q.model.trim() ? q.model.trim() : null
  return {
    state, fx, source, provisional, model, amount, price,
    fixing: fx ? asNumber(fx.value) : null,
    disputed: !!fx && fx.disputed === true,
    fixDate: fx?.date || q.fixing_date || null,
    time: fx?.time || fixingTime(sources, source) || terms?.valuation_time || null,
    settlementDate: q.settlement_date || null,
    ifTouched: asNumber(q.settlement_amount_if_touched),
    priceUsed: fx ? asNumber(fx.value) : price, priceIsFixing: !!fx,
    amountNote: model ?? (amount == null ? 'not reported for this trade' : provisional ? 'provisional: see below' : state === 'SETTLED' ? 'settled' : 'due on the settlement date'),
    strike: chartStrike(q) ?? asNumber(q.K), notional: asNumber(q.base_notional) ?? asNumber(q.notional),
    reasons: provisionalReasons(q, source),
  }
}

// The terms of an option's style as the term sheet prints them, each one null when the body does not carry it:
// a row is left out, never printed around a dash.
//   payout   { amount, currency } of a digital or a touch        when    'at the hit' | 'at expiry' (a touch)
//   barrier  the single level of a barrier or a touch            range   { lower, upper } of a double
export function styleTerms(q) {
  if (!q || q.shape !== 'OPTION') return { payout: null, when: null, barrier: null, range: null }
  const touch = q.style === 'TOUCH'
  const double = q.style === 'DOUBLE_BARRIER' || (touch && String(q.touch_type || '').startsWith('DOUBLE'))
  const payout = asNumber(q.payout), barrier = asNumber(q.barrier), lower = asNumber(q.lower), upper = asNumber(q.upper)
  return {
    payout: (touch || q.style === 'DIGITAL') && payout != null ? { amount: payout, currency: (q.payout_currency === 'BASE' ? q.base_currency : q.quote_currency) || null } : null,
    when: !touch ? null : q.pay_at_hit === true ? 'at the hit' : q.pay_at_hit === false ? 'at expiry' : null,
    barrier: !double && (touch || q.style === 'BARRIER') && barrier != null ? barrier : null,
    range: double && lower != null && upper != null ? { lower, upper } : null,
  }
}

// The levels of an option's style the chart draws beside (or, for a touch, instead of) the strike.
// A touch has no strike: its level is the barrier.
export function chartLevels(q) {
  if (!q || q.shape !== 'OPTION') return []
  const level = (label, v) => (positive(asNumber(v)) ? [{ label, value: asNumber(v) }] : [])
  if (q.style === 'TOUCH') return String(q.touch_type || '').startsWith('DOUBLE') ? [...level('TOUCH', q.lower), ...level('TOUCH', q.upper)] : level('TOUCH', q.barrier)
  if (q.style === 'BARRIER') return level('BARRIER', q.barrier)
  if (q.style === 'DOUBLE_BARRIER') return [...level('BARRIER', q.lower), ...level('BARRIER', q.upper)]
  return []
}

// The MODEL row of an option's term sheet: the engine's own `method` words, and "on the forward to settlement"
// only when they do not already name a forward ("Black-76 on the quoted forward" says which forward it is on).
export function modelWords(method, fallback = 'Garman–Kohlhagen') {
  const m = typeof method === 'string' && method.trim() ? method.trim() : fallback
  return /forward/i.test(m) ? m : `${m} on the forward to settlement`
}

// The strike the chart draws: K of a forward, the strike of an option, nothing for a touch (it has none).
export function chartStrike(q) {
  if (!q) return null
  if (q.shape === 'OPTION') return q.style === 'TOUCH' ? null : asNumber(q.strike)
  return asNumber(q.forward_rate)
}

// ── the chart's scales ───────────────────────────────────────────────────────────────

// A pleasant step for about five gridlines across the value range (the rule RateCurveCanvas uses).
export function niceStep(range, target = 5) {
  if (!positive(range) || !positive(target)) return null
  const raw = range / target
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p
}

// The value axis that holds every number given, on round gridlines; null when there is no number to hold.
export function valueRange(values) {
  const vs = (values || []).filter(finite)
  if (!vs.length) return null
  let vMin = Math.min(...vs), vMax = Math.max(...vs)
  if (vMax - vMin < 1e-9 * Math.max(1, Math.abs(vMax))) { const h = Math.abs(vMax) * 0.01 || 0.5; vMin -= h; vMax += h }
  const padding = (vMax - vMin) * 0.08
  vMin -= padding; vMax += padding
  const step = niceStep(vMax - vMin)
  return { vMin: Math.floor(vMin / step) * step, vMax: Math.ceil(vMax / step) * step, step }
}

// The tenors the chart shows: up to the first one comfortably past the settlement date, so a one-month trade is
// not squeezed against a two-year axis. Returns the last day drawn; null when there is neither a curve nor a date.
export function horizonDays(curve, settleX) {
  if (!Array.isArray(curve) || !finite(settleX)) return null
  const want = Math.max(settleX * 1.3, 60)
  const past = curve.find(c => c.x >= want)
  const last = curve.length ? curve[curve.length - 1].x : 0
  const out = Math.max(past ? past.x : last, settleX * 1.05)
  return out > 0 ? out : null
}

// The split time axis: to the left of today the fixings, linear in days; to the right the forward curve on a
// square-root axis (the short end gets room). pxPerUnit is vertical pixels per one unit of price. leftShare is
// the part of the width the past takes: a quarter beside a forward curve, most of it when there is no curve.
export const CHART_PAD = { l: 70, r: 18, t: 24, b: 26 }
export function chartGeometry({ width, height, hasLeft, leftShare, leftDays = FIXING_DAYS, maxDays, vMin, vMax } = {}) {
  const share = leftShare ?? (hasLeft ? 0.24 : 0.05)
  if (!positive(width) || !positive(height) || !positive(leftDays) || !positive(maxDays) || !finite(vMin) || !finite(vMax) || !(vMax > vMin)) return null
  if (!finite(share) || share < 0 || share > 1) return null
  const pad = CHART_PAD
  const cw = Math.max(width - pad.l - pad.r, 1), ch = Math.max(height - pad.t - pad.b, 1)
  const lw = cw * share
  const x0 = pad.l + lw
  const rw = cw - lw
  const span = vMax - vMin
  return {
    pad, x0, left: pad.l, right: pad.l + cw, top: pad.t, bottom: pad.t + ch,
    pxPerUnit: ch / span,
    xs: (d) => d <= 0 ? x0 - (Math.min(-d, leftDays) / leftDays) * lw : x0 + Math.sqrt(Math.min(d, maxDays) / maxDays) * rw,
    ys: (v) => pad.t + ch - ((v - vMin) / span) * ch,
  }
}

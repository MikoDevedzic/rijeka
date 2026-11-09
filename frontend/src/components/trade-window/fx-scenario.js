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
//   chartGeometry    the chart's scales, shared by the drawing and the hit test
// ────────────────────────────────────────────────────────────────────────────────────

// backend/api/routes/currencies.py TENOR_DAYS: days from the spot date to each quoted tenor
export const TENOR_DAYS = { ON: 1, '1W': 7, '2W': 14, '1M': 30, '2M': 61, '3M': 91, '6M': 182, '9M': 273, '1Y': 365, '2Y': 730 }

export const SPOT_BOUND_PCT = 50      // the whole curve moves at most ±50 % (the SPOT shock)
export const TENOR_BOUND = 0.5        // one tenor moves at most ±50 % of spot, in price
export const FORWARD_FLOOR = 0.01     // and never below 1 % of spot: a forward stays positive
export const RIPPLE_SIGMA = 0.15      // width of the ripple, in square-root years (the chart's own time axis)
export const FIXING_DAYS = 30         // how far back the chart's left side reaches

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// ── the forward curve ────────────────────────────────────────────────────────────────

// Forward points at `days` from the spot date: linear in days between quoted tenors, 0 at spot, flat beyond
// the last tenor. The same rule as interp_points in backend/api/routes/currencies.py.
export function interpPoints(points, days) {
  const xs = Object.entries(points || {})
    .filter(([t, v]) => TENOR_DAYS[t] != null && finite(Number(v)))
    .map(([t, v]) => [TENOR_DAYS[t], Number(v)])
    .sort((a, b) => a[0] - b[0])
  xs.unshift([0, 0])
  if (!(days > 0)) return 0
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

// Points are quoted from the spot date. A digital asset's spot settles at once (lag 0). For a currency pair the
// quote does not carry its spot date, so the lag is the one at which the stored points give back the quote's
// own market points; two days when nothing tells them apart.
export function spotLagDays({ points, settleDays, marketPoints, crypto }) {
  if (crypto) return 0
  if (!points || !finite(marketPoints) || !finite(settleDays)) return 2
  let best = 2, err = Infinity
  for (const lag of [2, 1, 3, 0, 4, 5, 6, 7]) {
    const e = Math.abs(interpPoints(points, settleDays - lag) - marketPoints)
    if (e < err - 1e-9) { best = lag; err = e }
  }
  return best
}

// A ticket priced without quoted points (parity, or the desk's own funding rate) still has a curve: the carry
// that takes its spot to its forward, at every tenor. In points, so the chart and the drag treat it as quoted.
export function carryPoints({ spot, forward, days, pip }) {
  const c = spot > 0 && forward > 0 && days > 0 ? Math.log(forward / spot) / days : 0
  const out = {}
  for (const [t, d] of Object.entries(TENOR_DAYS)) out[t] = spot > 0 && pip > 0 ? spot * (Math.exp(c * d) - 1) / pip : 0
  return out
}

// The tenors of a points curve in order: days from the spot date, and x, the days from today the chart draws at.
export function curveNodes(points, lag = 0) {
  return Object.entries(points || {})
    .filter(([t, v]) => TENOR_DAYS[t] != null && finite(Number(v)))
    .map(([t, v]) => ({ tenor: t, days: TENOR_DAYS[t], x: TENOR_DAYS[t] + lag, points: Number(v) }))
    .sort((a, b) => a.days - b.days)
}

// ── the drag ─────────────────────────────────────────────────────────────────────────

// A Gaussian around the dragged tenor, measured on the square-root time axis the chart is drawn on, so the
// ripple looks the same width at the short end and at the long end. The dragged tenor itself moves in full.
export function rippleWeights(nodes, k, sigma = RIPPLE_SIGMA) {
  const u = (n) => Math.sqrt(n.days / 365)
  return nodes.map((n, i) => i === k ? 1 : Math.exp(-((u(n) - u(nodes[k])) ** 2) / (2 * sigma * sigma)))
}

// How far each tenor may move, in points: ±TENOR_BOUND of spot, and never to a forward below the floor.
export function tenorBounds(nodes, { spot, pip }) {
  return nodes.map(n => {
    const price = spot + n.points * pip
    const lo = Math.max(-TENOR_BOUND * spot, FORWARD_FLOOR * spot - price) / pip
    return { lo: Math.min(lo, 0), hi: TENOR_BOUND * spot / pip }
  })
}

// The moves of every tenor after the dragged one has gone `move` points from where the drag began.
export function applyTenorDrag({ origin, weights, move, bounds }) {
  return origin.map((d, i) => clamp(d + move * weights[i], bounds[i].lo, bounds[i].hi))
}

export const clampSpotPct = (pct) => clamp(finite(pct) ? pct : 0, -SPOT_BOUND_PCT, SPOT_BOUND_PCT)

// A whole-curve drag is the SPOT shock: the point under the cursor, worth `ref` at no spot shock, has gone
// `dPrice` from where the drag began.
export const spotPctFromDrag = ({ originPct, dPrice, ref }) => clampSpotPct(originPct + (ref > 0 ? 100 * dPrice / ref : 0))

// The carry factor of the two rate shocks over `days`: a forward moves by exp((Δr_quote − Δr_base)·T).
export const carryFactor = (quoteBp, baseBp, days) => Math.exp((quoteBp - baseBp) / 10000 * days / 365)

// The curve the chart draws: spot at today, then each tenor, base and shocked.
// shocked = (spot + (points + move)·pip) · (1 + spot shock) · carry factor to that tenor.
export function shockedCurve({ spot, pip, nodes, moves, spotPct = 0, quoteBp = 0, baseBp = 0 }) {
  const k = 1 + spotPct / 100
  return [
    { tenor: 'SPOT', x: 0, base: spot, shocked: spot * k },
    ...nodes.map((n, i) => ({
      tenor: n.tenor, x: n.x,
      base: spot + n.points * pip,
      shocked: (spot + (n.points + (moves?.[i] || 0)) * pip) * k * carryFactor(quoteBp, baseBp, n.x),
    })),
  ]
}

// ── the closed form ──────────────────────────────────────────────────────────────────

export const Phi = (x) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989422804014327 * Math.exp(-x * x / 2); const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x >= 0 ? 1 - p : p }

export function gk(F, K, T, sigma, call, df) {
  if (T <= 0 || sigma <= 0) return df * Math.max(call ? F - K : K - F, 0)
  const sT = sigma * Math.sqrt(T); const d1 = (Math.log(F / K) + 0.5 * sT * sT) / sT; const d2 = d1 - sT
  return df * (call ? F * Phi(d1) - K * Phi(d2) : K * Phi(-d2) - F * Phi(-d1))
}

// The engine's closed form under the panel's shocks. With no dragged points this is the arithmetic the panel
// has always used; `dPoints` is the change in forward points at the trade's settlement date (the dragged curve
// interpolated there), which rides the spot and rate shocks like the rest of the forward:
//   F' = F(spot, rates) + dPoints · pip · (1 + spot shock) · exp((Δr_quote − Δr_base)·T)
//   forward: NPV = ±N · (F' − K) · DF_quote'        option: NPV = ±N · Black-76(F', K, T_expiry, σ', DF_quote')
export function reprice(q, { spotPct = 0, quoteBp = 0, baseBp = 0, volPts = 0, dPoints = 0, pip = 1 } = {}) {
  const sign = q.direction === 'BUY' ? 1 : -1
  const k = 1 + spotPct / 100
  const S = q.spot * k
  const option = q.shape === 'OPTION'
  const T = option ? q.t_settle : q.t
  const dfq = q.df_quote * Math.exp(-quoteBp / 10000 * T)
  let F
  if (option) {
    F = q.forward * (S / q.spot) * Math.exp((quoteBp - baseBp) / 10000 * T)
  } else {
    const dfb = q.df_base * Math.exp(-baseBp / 10000 * T)
    F = q.forward_mode === 'MARKET' && q.market_points != null ? q.forward * (S / q.spot) * (dfb / q.df_base) / (dfq / q.df_quote) : S * dfb / dfq
  }
  if (dPoints) F += dPoints * pip * k * Math.exp((quoteBp - baseBp) / 10000 * T)
  const floor = FORWARD_FLOOR * S
  if (finite(floor) && !(F >= floor)) F = floor                    // a forward is never zero or negative
  if (option) {
    const vol = Math.max(q.vol_pct / 100 + volPts / 100, 0.0001)
    return { forward: F, npv: sign * q.base_notional * gk(F, q.strike, q.t_expiry, vol, q.option_type === 'CALL', dfq) }
  }
  return { forward: F, npv: sign * q.base_notional * (F - q.forward_rate) * dfq }
}

// ── the fixing ───────────────────────────────────────────────────────────────────────

// What a fixing pays, in the quote currency, from the booker's side (backend/settlement/rule.py):
// forward ±N·(fixing − K); European call ±N·max(fixing − K, 0); put ±N·max(K − fixing, 0).
export function settlementAmount({ shape, optionType, direction, notional, strike, fixing }) {
  if (![notional, strike, fixing].every(finite) || !(fixing > 0)) return null
  const sign = direction === 'BUY' ? 1 : -1
  const amount = shape === 'OPTION' ? sign * notional * Math.max(optionType === 'CALL' ? fixing - strike : strike - fixing, 0)
                                    : sign * notional * (fixing - strike)
  return amount === 0 ? 0 : amount                                 // never "-0"
}

const usable = (r) => r && typeof r.date === 'string' && finite(Number(r.value)) && Number(r.value) > 0

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
  const out = [...perDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map(r => ({ date: r.date, value: Number(r.value) }))
  return { label, spot, ownSource: !spot && !!source && label === source, rows: out }
}

// ── the chart's scales ───────────────────────────────────────────────────────────────

// A pleasant step for about five gridlines across the value range (the rule RateCurveCanvas uses).
export function niceStep(range, target = 5) {
  const raw = range / target
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p
}

// The value axis that holds every number given, on round gridlines.
export function valueRange(values) {
  const vs = values.filter(finite)
  if (!vs.length) return { vMin: 0, vMax: 1, step: 0.25 }
  let vMin = Math.min(...vs), vMax = Math.max(...vs)
  if (vMax - vMin < 1e-9 * Math.max(1, Math.abs(vMax))) { const h = Math.abs(vMax) * 0.01 || 0.5; vMin -= h; vMax += h }
  const padding = (vMax - vMin) * 0.08
  vMin -= padding; vMax += padding
  const step = niceStep(vMax - vMin)
  return { vMin: Math.floor(vMin / step) * step, vMax: Math.ceil(vMax / step) * step, step }
}

// The tenors the chart shows: up to the first one comfortably past the settlement date, so a one-month trade is
// not squeezed against a two-year axis. Returns the last day drawn.
export function horizonDays(curve, settleX) {
  const want = Math.max((settleX || 0) * 1.3, 60)
  const past = curve.find(c => c.x >= want)
  const last = curve.length ? curve[curve.length - 1].x : 0
  return Math.max(past ? past.x : last, (settleX || 0) * 1.05, 1)
}

// The split time axis: to the left of today the fixings, linear in days; to the right the forward curve on a
// square-root axis (the short end gets room). pxPerUnit is vertical pixels per one unit of price.
export const CHART_PAD = { l: 70, r: 18, t: 24, b: 26 }
export function chartGeometry({ width, height, hasLeft, leftDays = FIXING_DAYS, maxDays, vMin, vMax }) {
  const pad = CHART_PAD
  const cw = Math.max(width - pad.l - pad.r, 1), ch = Math.max(height - pad.t - pad.b, 1)
  const lw = cw * (hasLeft ? 0.24 : 0.05)
  const x0 = pad.l + lw
  const rw = cw - lw
  const span = vMax - vMin || 1
  return {
    pad, x0, left: pad.l, right: pad.l + cw, top: pad.t, bottom: pad.t + ch,
    pxPerUnit: ch / span,
    xs: (d) => d <= 0 ? x0 - (Math.min(-d, leftDays) / leftDays) * lw : x0 + Math.sqrt(Math.min(d, maxDays) / maxDays) * rw,
    ys: (v) => pad.t + ch - ((v - vMin) / span) * ch,
  }
}

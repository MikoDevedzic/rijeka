// trade-window/fx-vol.js
// ────────────────────────────────────────────────────────────────────────────────────
// The vol surface of the CURVE SCENARIO tab, as pure functions: no React, no fetch, no
// canvas. A pair's surface is quoted per tenor as an at-the-money vol (ATM), a 25-delta
// risk reversal (RR25) and a 25-delta butterfly (BF25), in vol points. The browser reads
// it the way the pricer does (backend/pricing/fx_vol.py), function for function:
//
//   pillars           parse_surface: one pillar per tenor with an ATM, in time order
//   interpPillar      _interp: each quote linear in time between tenors, flat beyond them
//   smileVol          smile_vol: the quadratic in the forward delta of a call (Malz, 1997)
//   forwardCallDelta  fx_option.forward_delta for a call: Φ(d1), premium excluded
//   volAt             vol_at: the fixed point σ = smile(Δ_call(σ)), eight steps from the ATM
//
// ATM is interpolated in vol, not in variance, because that is what the backend does
// (fx_vol.py _interp: `atm = _lin([(p.t, p.atm) for p in pillars], T)`).
//
// backend/tests/vectors/fx_scenario.json holds cases written by the backend's own
// functions; fx-vol.test.js reads the same file, so the two cannot drift apart unnoticed.
//
// The rule of fx-scenario.js holds here too: an input a function needs that is missing or
// not finite gives null, never a number put in its place.
// ────────────────────────────────────────────────────────────────────────────────────

// Years to each quoted tenor: TENOR_YEARS of backend/pricing/fx_vol.py. Not the forward-points day map
// (fx-scenario.js TENOR_DAYS): a month here is a twelfth of a year, there it is 30 days.
export const TENOR_YEARS = {
  ON: 1 / 365, '1W': 7 / 365, '2W': 14 / 365, '3W': 21 / 365, '1M': 1 / 12, '2M': 2 / 12, '3M': 3 / 12, '4M': 4 / 12,
  '6M': 0.5, '9M': 0.75, '1Y': 1.0, '18M': 1.5, '2Y': 2.0, '3Y': 3.0, '5Y': 5.0,
}
export const QUOTE_TYPES = ['ATM', 'RR25', 'BF25']
export const VOL_AT_ITERATIONS = 8        // vol_at's default
export const VOL_AT_TOLERANCE = 1e-10     // its stopping rule: a step smaller than this ends the iteration
export const VOL_FLOOR = 1e-4             // and its floor on a step
export const READ_TOLERANCE_PTS = 0.05    // the browser's reading and the quote's vol may differ by this much, in vol points

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const positive = (v) => finite(v) && v > 0
// a number as the API sends it: a finite number, or a string that is one; anything else is not a number (null is not 0)
const asNumber = (v) => finite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null

// ── the surface ──────────────────────────────────────────────────────────────────────

// The pillars of a surface grid ({TENOR: {ATM, RR25, BF25}} in vol points, as GET /api/currency/pairs sends
// vol_surface.grid), sorted by time, in decimals. A tenor the map does not know and a tenor without a positive
// ATM are dropped. `smile` is true when the tenor quotes an RR25 or a BF25: a tenor with an ATM alone says
// nothing about the skew (its rr and bf are 0 here and are skipped by interpPillar, not read as zero).
// No grid, or no usable tenor: an empty list, as the backend has it.
export function pillars(grid, tenorYears = TENOR_YEARS) {
  if (!grid || typeof grid !== 'object' || !tenorYears) return []
  const out = []
  for (const [name, row] of Object.entries(grid)) {
    const tenor = String(name).toUpperCase()
    if (!finite(tenorYears[tenor]) || !row || typeof row !== 'object') continue
    const v = {}
    for (const [k, raw] of Object.entries(row)) {
      const qt = String(k).toUpperCase(), n = asNumber(raw)
      if (QUOTE_TYPES.includes(qt) && n != null) v[qt] = n / 100.0
    }
    if (!(v.ATM > 0)) continue
    out.push({ tenor, t: tenorYears[tenor], atm: v.ATM, rr: v.RR25 ?? 0.0, bf: v.BF25 ?? 0.0, smile: 'RR25' in v || 'BF25' in v })
  }
  return out.sort((a, b) => a.t - b.t)
}

// _lin: linear in time between points, flat beyond them.
function lin(points, T) {
  const last = points[points.length - 1]
  if (T <= points[0][0]) return points[0][1]
  if (T >= last[0]) return last[1]
  for (let i = 0; i + 1 < points.length; i++) {
    const [ta, va] = points[i], [tb, vb] = points[i + 1]
    if (ta <= T && T <= tb) return va + (T - ta) / (tb - ta) * (vb - va)
  }
  return last[1]
}

const validPillars = (ps) => Array.isArray(ps) && ps.length > 0 && ps.every(p => p && finite(p.t) && finite(p.atm) && finite(p.rr) && finite(p.bf))

// The surface at T years: ATM over every pillar; RR and BF over the pillars that quote a smile.
export function interpPillar(ps, T) {
  if (!validPillars(ps) || !finite(T)) return null
  const atm = lin(ps.map(p => [p.t, p.atm]), T)
  const smiled = ps.filter(p => p.smile)
  if (!smiled.length) return { t: T, atm, rr: 0.0, bf: 0.0, smile: false }
  return { t: T, atm, rr: lin(smiled.map(p => [p.t, p.rr]), T), bf: lin(smiled.map(p => [p.t, p.bf]), T), smile: true }
}

// σ(Δ) = ATM − 2·RR25·(Δ − ½) + 16·BF25·(Δ − ½)², Δ the forward delta of a call. It gives back the three quotes:
// Δ = ½ the ATM, Δ = ¼ (the 25-delta call) ATM + BF + RR/2, Δ = ¾ (the 25-delta put) ATM + BF − RR/2.
export function smileVol(atm, rr, bf, callDelta) {
  if (![atm, rr, bf, callDelta].every(finite)) return null
  const x = callDelta - 0.5
  return atm - 2.0 * rr * x + 16.0 * bf * x * x
}

// ── the delta ────────────────────────────────────────────────────────────────────────

// The error function to the last few bits of a double: its power series (Abramowitz & Stegun 7.1.6) below 1.5 and
// the continued fraction of its complement (7.1.14) above. The polynomial Φ of fx-scenario.js is good to seven
// places, which prices a ticket to cents but would leave this reading visibly off the engine's.
const SQRT_PI = 1.772453850905516
export function erf(x) {
  if (typeof x !== 'number' || Number.isNaN(x)) return NaN
  const a = Math.abs(x), x2 = x * x
  if (a < 1.5) {
    let acc = 0.0, fk = 25.5
    for (let i = 0; i < 25; i++) { acc = 2.0 + x2 * acc / fk; fk -= 1.0 }
    return acc * x * Math.exp(-x2) / SQRT_PI
  }
  if (a >= 30) return x > 0 ? 1.0 : -1.0
  let s = 0.0, ds = 0.5, p = 1.0, pLast = 0.0, q = ds + x2, qLast = 1.0
  for (let i = 0; i < 50; i++) {
    s += ds; ds += 2.0
    const b = ds + x2
    let t = p; p = b * p - s * pLast; pLast = t
    t = q; q = b * q - s * qLast; qLast = t
  }
  const c = p / q * a * Math.exp(-x2) / SQRT_PI
  return x > 0 ? 1.0 - c : c - 1.0
}
export const normCdf = (x) => 0.5 * (1.0 + erf(x / Math.sqrt(2.0)))

// Φ(d1), d1 = (ln(F/K) + ½σ²T)/(σ√T): the premium-excluded forward delta of a call, which the smile is quoted on.
// With no time left or no vol it is 1 in the money and 0 otherwise.
export function forwardCallDelta(F, K, T, sigma) {
  if (!positive(F) || !positive(K) || !finite(T) || !finite(sigma)) return null
  if (T <= 0 || sigma <= 0) return F > K ? 1.0 : 0.0
  const sT = sigma * Math.sqrt(T)
  return normCdf((Math.log(F / K) + 0.5 * sT * sT) / sT)
}

// The smile vol (decimal) for strike K at expiry T: the delta depends on the vol, so the vol is the fixed point of
// σ = smile(Δ_call(σ)), iterated from the ATM. A surface with no skew at T is its ATM whatever the strike.
export function volAt(ps, T, F, K, iterations = VOL_AT_ITERATIONS) {
  const p = interpPillar(ps, T)
  if (!p || !positive(F) || !positive(K)) return null
  if (p.rr === 0.0 && p.bf === 0.0) return p.atm
  let sigma = p.atm
  for (let i = 0; i < iterations; i++) {
    const nxt = smileVol(p.atm, p.rr, p.bf, forwardCallDelta(F, K, T, sigma))
    if (Math.abs(nxt - sigma) < VOL_AT_TOLERANCE) { sigma = nxt; break }
    sigma = Math.max(nxt, VOL_FLOOR)
  }
  return sigma
}

// The tenors a surface's grid is shown and saved on: the standard ones and every tenor the stored surface has (a
// venue's digital-asset surface also quotes 2W and 3W), in time order. A tenor the map does not know goes last.
export const STANDARD_VOL_TENORS = ['1W', '1M', '2M', '3M', '6M', '9M', '1Y', '2Y']
export function surfaceTenors(stored, standard = STANDARD_VOL_TENORS, tenorYears = TENOR_YEARS) {
  const all = [...new Set([...standard, ...(Array.isArray(stored) ? stored : [])].map(t => String(t).toUpperCase()))]
  return all.sort((a, b) => (tenorYears[a] ?? 99) - (tenorYears[b] ?? 99))
}

// ── what the tab states ──────────────────────────────────────────────────────────────

// A stored source without its storage prefix: marks_label of backend/api/routes/currencies.py.
const marks = (source) => { const s = String(source || '').trim(); return (s.startsWith('DEMO · ') ? s.slice('DEMO · '.length) : s) || null }

// Whether the stored surface is the one the quote priced on, as far as the quote can tell: the same snapshot date
// and, for a venue's marks, the same marks. A digital asset's surface is read from the venue every few minutes,
// so a ticket priced before the last read carries an older one.
export function pricedOnThis(quote, surface) {
  if (!quote || !surface) return false
  if (quote.vol_snapshot != null && surface.valuation_date != null && quote.vol_snapshot !== surface.valuation_date) return false
  return quote.vol_marks == null || marks(surface.source) === quote.vol_marks
}

// Where T sits among quoted tenors, in the words the block prints in brackets.
function bracket(ps, T) {
  const on = ps.find(p => Math.abs(p.t - T) < 1e-12)
  if (on) return `the ${on.tenor} quotes`
  const first = ps[0], last = ps[ps.length - 1]
  if (T < first.t) return `before the first quoted tenor, ${first.tenor}: held flat`
  if (T > last.t) return `beyond the last quoted tenor, ${last.tenor}: held flat`
  const i = ps.findIndex(p => p.t > T)
  return `interpolated between ${ps[i - 1].tenor} and ${ps[i].tenor}`
}

// How the surface was read at T years, as words: on a quoted tenor, between two, or held flat outside them. The
// risk reversal and butterfly skip a tenor that quotes an ATM alone, so when they are read between different
// tenors than the ATM the words say so. Null without pillars (each with its tenor's name) or a time.
export function expiryWhere(ps, T) {
  if (!validPillars(ps) || !finite(T) || !ps.every(p => typeof p.tenor === 'string')) return null
  const atm = bracket(ps, T)
  const smiled = ps.filter(p => p.smile)
  if (!smiled.length || smiled.length === ps.length) return atm
  const skew = bracket(smiled, T)
  return skew === atm ? atm : `${atm}; the risk reversal and butterfly ${skew}`
}

// Everything the VOL SURFACE block states about one priced option, read off the pair's stored surface:
//   at          the surface at the option's expiry (ATM, RR25, BF25, decimals)
//   delta       the forward call delta of the strike at the vol the quote used: where its dot sits on the smile
//   surfaceVol  the vol the browser reads at the strike (volAt), which the engine's should equal
//   quoteVol    the vol the quote priced at (decimal)       override  the request named the vol: the dot is off the curve
//   differs     the two disagree by more than READ_TOLERANCE_PTS and the vol is not an override
//   where       how the surface was read at the expiry, in words (expiryWhere)
// The surface is read at the strike the quote carries, for every style: the engine reads it at the request's strike
// whenever one was sent and returns the K it used (the forward when none was, as for a touch priced without one).
// Only a quote that carries no strike is read at the forward here (hasStrike false). atForward: there is no
// strike to name, or a touch's K is the forward itself.
// Null when the surface has no usable tenor or the quote does not carry a forward, an expiry and a vol.
export function surfaceReading(quote, surface, tenorYears = TENOR_YEARS) {
  const ps = pillars(surface?.grid, tenorYears)
  if (!ps.length || !quote) return null
  const T = asNumber(quote.t_expiry), F = asNumber(quote.forward), vol = asNumber(quote.vol_pct)
  const hasStrike = positive(asNumber(quote.strike))
  const K = hasStrike ? asNumber(quote.strike) : F
  if (!positive(T) || !positive(F) || !positive(K) || !positive(vol)) return null
  const at = interpPillar(ps, T)
  const quoteVol = vol / 100
  const surfaceVol = volAt(ps, T, F, K)
  const override = quote.vol_tier === 'OVERRIDE'
  const diffPts = Math.abs(surfaceVol * 100 - vol)
  return {
    pillars: ps, T, F, K, hasStrike, atForward: !hasStrike || (quote.style === 'TOUCH' && K === F), at, quoteVol, surfaceVol, override, diffPts,
    where: expiryWhere(ps, T),
    delta: forwardCallDelta(F, K, T, quoteVol),
    differs: !override && diffPts > READ_TOLERANCE_PTS,
    sameSurface: pricedOnThis(quote, surface),
  }
}

// The vol the repricing uses under the VOL slider: the quote's vol moved by `pts` vol points, floored where
// fx-scenario.js reprice floors it. The whole surface is drawn moved by the same amount.
export const shockedVol = (vol, pts) => (finite(vol) && finite(pts) ? Math.max(vol + pts / 100, 0.0001) : null)

// ── what the charts draw ─────────────────────────────────────────────────────────────

// The term structure from today to maxT: the ATM and the 25-delta call and put vols (decimals), sampled evenly on
// the square-root time axis and at every quoted tenor and every extra time given, so each kink is drawn where it is.
export function termCurve(ps, maxT, extra = [], n = 64) {
  if (!validPillars(ps) || !positive(maxT) || !(n > 0)) return null
  const ts = new Set([0, maxT])
  for (let i = 1; i < n; i++) ts.add(maxT * (i / n) ** 2)
  for (const t of [...ps.map(p => p.t), ...extra]) if (finite(t) && t >= 0 && t <= maxT) ts.add(t)
  return [...ts].sort((a, b) => a - b).map(t => {
    const p = interpPillar(ps, t)
    return { t, atm: p.atm, call: smileVol(p.atm, p.rr, p.bf, 0.25), put: smileVol(p.atm, p.rr, p.bf, 0.75) }
  })
}

// The smile at one expiry: vol (decimal) against the forward delta of a call, from lo to hi.
export function smileCurve(at, lo = 0.1, hi = 0.9, n = 40) {
  if (!at || ![at.atm, at.rr, at.bf, lo, hi].every(finite) || !(hi > lo) || !(n > 0)) return null
  return Array.from({ length: n + 1 }, (_, i) => { const delta = lo + (hi - lo) * i / n; return { delta, vol: smileVol(at.atm, at.rr, at.bf, delta) } })
}

// The delta axis of the smile: 0.10 to 0.90, widened in steps of 0.05 to hold a strike beyond the 10-delta wings
// (the quadratic is extrapolated there as it stands, which is the pricer's stated limitation).
export function deltaRange(delta) {
  if (!finite(delta)) return { lo: 0.1, hi: 0.9 }
  const d = Math.max(0.0, Math.min(1.0, delta))
  return { lo: Math.min(0.1, Math.floor(d * 20 + 1e-9) / 20), hi: Math.max(0.9, Math.ceil(d * 20 - 1e-9) / 20) }
}

// The scales of one small chart. The time axis of the term structure is a square root from zero (the short end
// gets room, as on the forward curve above it); the delta axis of the smile runs from the high delta on the left
// to the low delta on the right (`reverse`), so strikes rise from left to right as they do on a price axis.
export const VOL_PAD = { l: 46, r: 16, t: 24, b: 26 }
export function volGeometry({ width, height, xMin = 0, xMax, vMin, vMax, sqrt = false, reverse = false } = {}) {
  if (!positive(width) || !positive(height) || !finite(xMin) || !finite(xMax) || !(xMax > xMin) || !finite(vMin) || !finite(vMax) || !(vMax > vMin)) return null
  const pad = VOL_PAD
  const cw = Math.max(width - pad.l - pad.r, 1), ch = Math.max(height - pad.t - pad.b, 1)
  const unit = (x) => { const u = (Math.max(xMin, Math.min(xMax, x)) - xMin) / (xMax - xMin); return sqrt ? Math.sqrt(u) : u }
  return {
    pad, left: pad.l, right: pad.l + cw, top: pad.t, bottom: pad.t + ch,
    xs: (x) => pad.l + (reverse ? 1 - unit(x) : unit(x)) * cw,
    ys: (v) => pad.t + ch - ((v - vMin) / (vMax - vMin)) * ch,
  }
}

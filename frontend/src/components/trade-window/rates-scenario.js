// trade-window/rates-scenario.js — the pure half of a rates ticket's CURVE SCENARIO tab (RatesScenario.jsx): which
// points of a curve or of a vol surface are shown, how a shock on them becomes the request the pricing route takes,
// and what the answer's figures are called. No React, no request; tested in rates-scenario.test.js.
//
// A scenario is: for each curve the trade is priced on, a flat shock in bp and a shock of its own on any quoted tenor;
// for an option, a flat shock of its vol in bp of normal vol and a shock of its own on any expiry of the surface.
// The server applies the curve's shocks to the quotes it builds the curve from and reprices the trade in full
// (backend/api/routes/pricer.py `_curve_shift`); the vol's shock reaches the trade as the shift at its own expiry.

export const CURVE_BOUND_BP = 300      // the largest whole shock of a quote, either way
export const VOL_BOUND_BP = 100        // and of a vol
const UNIT_Y = { D: 1 / 365, W: 7 / 365, M: 1 / 12, Y: 1 }

// A tenor in years: ON, 1W, 3M, 18M, 2Y. null when it is not one.
export function tenorYears(tenor) {
  const s = String(tenor ?? '').trim().toUpperCase()
  if (s === 'ON' || s === 'O/N' || s === 'TN') return 1 / 365
  const m = /^(\d+(?:\.\d+)?)([DWMY])$/.exec(s)
  return m ? Number(m[1]) * UNIT_Y[m[2]] : null
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v)
const num = (v) => (v == null || v === '' ? NaN : Number(v))

// Every quote of a rate curve, from its saved snapshot's quotes ({tenor, rate in %, enabled}): one per tenor, in order
// of time. These are what the curve is built from, and what a scenario moves.
export function curveQuotes(quotes) {
  const seen = new Set(), out = []
  for (const q of quotes || []) {
    const t = tenorYears(q?.tenor), v = num(q?.rate), id = String(q?.tenor ?? '').trim().toUpperCase()
    if (q?.enabled === false || t == null || !finite(v) || seen.has(id)) continue
    seen.add(id); out.push({ id, t, v, label: id })
  }
  return out.sort((a, b) => a.t - b.t)
}
// The points of a curve that are shown, and can be typed on or dragged: its quotes at the tenors a desk reads a curve
// at (a saved curve may quote thirty), up to the trade's last date (`through`, years) and the two after, because the
// ones beyond cannot reach the trade. A curve that quotes few of those tenors shows every quote it has.
export const SHOWN_TENORS = ['ON', '1M', '3M', '6M', '1Y', '2Y', '3Y', '4Y', '5Y', '7Y', '10Y', '15Y', '20Y', '30Y']
export function curvePoints(quotes, through) {
  const all = curveQuotes(quotes), std = all.filter(p => SHOWN_TENORS.includes(p.id))
  const out = std.length >= 4 ? std : all
  if (!finite(through)) return out
  const after = out.findIndex(p => p.t >= through - 1e-9)
  return after < 0 ? out : out.slice(0, after + 3)
}

// A cap surface's rows ({cap_tenor_y, strike_spread_bp, flat_vol_bp, is_atm}) as its at-the-money term structure, and
// as the smile at one maturity (the stored tenor nearest to it).
export function capTerm(rows) {
  const byT = new Map()
  for (const r of rows || []) {
    const t = num(r?.cap_tenor_y), v = num(r?.flat_vol_bp), s = Math.abs(num(r?.strike_spread_bp) || 0)
    if (!finite(t) || !finite(v)) continue
    const was = byT.get(t)
    if (!was || r.is_atm || (!was.atm && s < was.s)) { if (!(was?.atm && !r.is_atm)) byT.set(t, { v, s, atm: !!r.is_atm }) }
  }
  return [...byT.entries()].sort((a, b) => a[0] - b[0]).map(([t, x]) => ({ id: `${t}Y`, t, v: x.v, label: `${t}Y` }))
}
export function capSmile(rows, tenorY) {
  const ts = [...new Set((rows || []).map(r => num(r?.cap_tenor_y)).filter(finite))]
  if (!ts.length || !finite(tenorY)) return []
  const t = ts.reduce((a, b) => (Math.abs(b - tenorY) < Math.abs(a - tenorY) ? b : a))
  return (rows || []).filter(r => num(r.cap_tenor_y) === t && finite(num(r.flat_vol_bp)) && finite(num(r.strike_spread_bp)))
    .sort((a, b) => num(a.strike_spread_bp) - num(b.strike_spread_bp))
    .map(r => { const s = num(r.strike_spread_bp); return { id: `K${s}`, t: s, v: num(r.flat_vol_bp), label: s === 0 ? 'ATM' : `${s > 0 ? '+' : '−'}${Math.abs(s)}` } })
}

// A swaption surface's quotes ({tenor: '1Yx5Y', rate in bp}) as the term structure across expiries at one swap tenor
// (the stored one nearest to the trade's), and across swap tenors at one expiry.
function swaptionGrid(quotes) {
  const out = []
  for (const q of quotes || []) {
    const m = /^\s*([^xX]+)[xX]([^xX]+)\s*$/.exec(String(q?.tenor ?? '')), v = num(q?.rate)
    if (!m || q?.enabled === false || !finite(v)) continue
    const e = tenorYears(m[1]), s = tenorYears(m[2])
    if (e != null && s != null) out.push({ e, s, v, el: m[1].trim().toUpperCase(), sl: m[2].trim().toUpperCase() })
  }
  return out
}
const nearest = (xs, x) => xs.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a))
export function swaptionTerm(quotes, tenorY) {
  const g = swaptionGrid(quotes)
  if (!g.length || !finite(tenorY)) return { points: [], tenor: null }
  const s = nearest([...new Set(g.map(x => x.s))], tenorY)
  const pts = g.filter(x => x.s === s).sort((a, b) => a.e - b.e)
  return { points: pts.map(x => ({ id: x.el, t: x.e, v: x.v, label: x.el })), tenor: pts[0]?.sl ?? null }
}
export function swaptionAcross(quotes, expiryY) {
  const g = swaptionGrid(quotes)
  if (!g.length || !finite(expiryY)) return { points: [], expiry: null }
  const e = nearest([...new Set(g.map(x => x.e))], expiryY)
  const pts = g.filter(x => x.e === e).sort((a, b) => a.s - b.s)
  return { points: pts.map(x => ({ id: x.sl, t: x.s, v: x.v, label: x.sl })), expiry: pts[0]?.el ?? null }
}

// A shock: {flat, own: {id → shock}}. Its whole shock at a point, and at a time between two points (linear in time
// between the points' own shocks, the end point's beyond the ends; the flat shock everywhere).
export const NO_SHOCK = Object.freeze({ flat: 0, own: Object.freeze({}) })
export const shockAtPoint = (shock, p) => (Number(shock?.flat) || 0) + (Number(shock?.own?.[p.id]) || 0)
export function shockAtTime(shock, points, t) {
  const flat = Number(shock?.flat) || 0
  if (!points?.length || !finite(t)) return flat
  const own = (p) => Number(shock?.own?.[p.id]) || 0
  if (t <= points[0].t) return flat + own(points[0])
  const last = points[points.length - 1]
  if (t >= last.t) return flat + own(last)
  const j = points.findIndex(p => p.t >= t), a = points[j - 1], b = points[j]
  return flat + own(a) + (own(b) - own(a)) * (t - a.t) / (b.t - a.t)
}
export const isShocked = (shock) => !!(Number(shock?.flat) || Object.values(shock?.own || {}).some(v => Number(v)))
// What a curve's button says of its shock: "+10bp", "+10bp · 2 points", "2 points", "—".
export function shockSaid(shock, unit = 'bp') {
  const flat = Number(shock?.flat) || 0, n = Object.values(shock?.own || {}).filter(v => Number(v)).length
  const f = flat ? `${flat > 0 ? '+' : '−'}${Math.abs(Number(flat.toFixed(2)))}${unit}` : ''
  const p = n ? `${n} point${n > 1 ? 's' : ''}` : ''
  return f && p ? `${f} · ${p}` : f || p || '—'
}
// A curve's shock carried to every quote it is built from: a shown point has the shock typed or dragged on it, and a
// quote between two shown points the shock on the line between them (beyond the shown points, the end point's), so
// that a point moved carries the quotes around it and the curve built from them has no tooth in it.
export function spread(shock, shown, all) {
  const flat = Number(shock?.flat) || 0, own = {}
  if (!isShocked({ flat: 0, own: shock?.own })) return { flat, own }
  for (const q of all || []) { const v = shockAtTime({ flat: 0, own: shock.own }, shown, q.t); if (v) own[q.id] = Number(v.toFixed(6)) }
  return { flat, own }
}
// A typed or dragged shock kept within the bound once the flat one is added, and dropped when it is nothing.
export function withOwn(shock, id, value, bound) {
  const flat = Number(shock?.flat) || 0, own = { ...(shock?.own || {}) }
  const v = Math.max(-bound - flat, Math.min(bound - flat, Number(value) || 0))
  if (v) own[id] = v; else delete own[id]
  return { flat, own }
}
export function withFlat(shock, value, bound) {
  const flat = Math.max(-bound, Math.min(bound, Number(value) || 0)), own = {}
  for (const [id, v] of Object.entries(shock?.own || {})) { const c = Math.max(-bound - flat, Math.min(bound - flat, Number(v) || 0)); if (c) own[id] = c }
  return { flat, own }
}

// ── the trade ────────────────────────────────────────────────────────────────────────────────
export const KIND = { IR_SWAP: 'swap', IR_SWAPTION: 'swaption', RATES_CAP: 'cap', RATES_FLOOR: 'floor', RATES_COLLAR: 'collar' }
export const hasVol = (productKey) => KIND[productKey] != null && KIND[productKey] !== 'swap'
// The curves a request prices on, in the order the ticket names them: the one a cap, a floor, a collar or a swaption
// names for itself, else those of the request's own list (a swap's).
export function curveIds(payload) {
  const ids = payload?.curve_id ? [payload.curve_id] : Array.isArray(payload?.curves) ? payload.curves.map(c => c?.curve_id) : []
  return [...new Set(ids.filter(Boolean))]
}
// The trade's last date and its option's expiry, in years from the valuation date, as the pricing request has them.
const yearsBetween = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) ? (y - x) / (365.25 * 86400e3) : null }
export function horizon(productKey, payload) {
  const k = KIND[productKey]
  if (k === 'swap') { const ends = (payload?.legs || []).map(l => yearsBetween(payload.valuation_date, l.maturity_date)).filter(finite); return { through: ends.length ? Math.max(...ends) : null, expiry: null } }
  if (k === 'swaption') return { through: (Number(payload?.expiry_y) || 0) + (Number(payload?.tenor_y) || 0), expiry: Number(payload?.expiry_y) || null, tenor: Number(payload?.tenor_y) || null }
  return { through: Number(payload?.tenor_y) || null, expiry: Number(payload?.tenor_y) || null }
}

const curveFields = (shock) => {
  if (!isShocked(shock)) return null
  const own = Object.fromEntries(Object.entries(shock.own || {}).filter(([, v]) => Number(v)).map(([k, v]) => [k, Number(v)]))
  return { flat: Number(shock.flat) || 0, own }
}
// The pricing request of a scenario: the ticket's own request with each curve's shock and the vol's shift at the
// trade's expiry (`volShift`, bp). With nothing shocked it is the ticket's request, field for field.
export function scenarioPayload(productKey, payload, curves = {}, volShift = 0) {
  const k = KIND[productKey]
  if (!k || !payload) return payload
  if (k === 'swap') {
    return { ...payload, curves: (payload.curves || []).map(c => { const f = curveFields(curves[c.curve_id]); return f ? { ...c, shift_flat_bp: f.flat, shift_bp: f.own } : c }) }
  }
  const f = curveFields(curves[curveIds(payload)[0]])
  const out = { ...payload, ...(f ? { curve_flat_bp: f.flat, curve_shift_bp: f.own } : null) }
  if (volShift) out.vol_shift_bp = volShift          // the vol the trade priced at, moved: the server holds it while the curve moves
  return out
}
// The figures of an answer under one name each, whichever route gave it.
export function figures(productKey, r) {
  if (!r) return null
  const collar = KIND[productKey] === 'collar', swap = KIND[productKey] === 'swap'
  const pick = (...ks) => { for (const k of ks) if (finite(num(r[k]))) return num(r[k]); return null }
  return {
    npv: swap && r.option_pv != null ? pick('npv') : collar ? pick('net_npv') : pick('npv'),
    ir01: collar ? pick('net_ir01') : pick('ir01'),
    vega: collar ? pick('net_vega') : pick('vega'),
    vol: collar ? null : pick('vol_bp'),
    capVol: collar ? pick('cap_vol_bp') : null, floorVol: collar ? pick('floor_vol_bp') : null,
    ccy: r.currency || r.ccy || null,
  }
}

// The ladder's columns: the selected curve moved flat by each, on top of the scenario.
export const LADDER = { curve: [-50, -25, -10, -5, 0, 5, 10, 25, 50], vol: [-20, -10, -5, -2, 0, 2, 5, 10, 20] }
// Every price a scenario needs, as {key → request body}: the market, each shocked factor alone, all together, and the
// ladder of the selected factor. Bodies that are the same request share one key's answer (`same`), so nothing is
// asked twice. `factors`: [{key, kind: 'curve'|'vol'}]; `shocks`: {key → shock}; `volAt(shock)`: the vol shock at the trade.
export function wanted(productKey, payload, factors, shocks, sel, volAt) {
  const curvesOf = (shockOf) => Object.fromEntries(factors.filter(f => f.kind === 'curve').map(f => [f.key, shockOf(f)]))
  const body = (shockOf) => { const v = factors.find(f => f.kind === 'vol'); return scenarioPayload(productKey, payload, curvesOf(shockOf), v ? volAt(shockOf(v)) : 0) }
  const cells = { market: body(() => NO_SHOCK), all: body(f => shocks[f.key] || NO_SHOCK) }
  for (const f of factors) cells[`only:${f.key}`] = body(g => (g.key === f.key ? shocks[g.key] || NO_SHOCK : NO_SHOCK))
  const s = factors.find(f => f.key === sel)
  if (s) for (const x of LADDER[s.kind]) if (x) cells[`ladder:${x}`] = body(g => { const sh = shocks[g.key] || NO_SHOCK; return g.key === s.key ? { flat: (Number(sh.flat) || 0) + x, own: sh.own } : sh })
  const byBody = new Map(), bodies = {}, same = {}
  for (const [k, b] of Object.entries(cells)) { const j = JSON.stringify(b); if (byBody.has(j)) same[k] = byBody.get(j); else { byBody.set(j, k); bodies[k] = b } }
  return { bodies, same }
}

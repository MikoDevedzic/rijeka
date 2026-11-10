// trade-window/fx-legs.js — a currency or digital-asset trade as a package of legs (the DETAILS tab). The first leg
// is the ticket itself, set on the TRADE tab; every further leg is on the same pair and is a forward, a call, a put
// or a touch with its own side, size, date, strike and, for an option, style. A strip is one leg for each month; a
// collar, a risk reversal, a straddle and a calendar are two options.
//
// A package books as one trade per leg (each a forward the desk already prices, fixes, settles and confirms),
// tied by a tag in the trade's `strategy` field, which is the booking firm's own and is never shown to the
// counterparty: "STRIP PKG-M3K9Q2 2/6" is the second of the six legs of that package.
const finite = (x) => typeof x === 'number' && Number.isFinite(x)
const ISO = /^\d{4}-\d{2}-\d{2}$/

let seq = 0
export const legId = () => `leg-${Date.now().toString(36)}-${(seq++).toString(36)}`

// The date `months` months after an ISO date, on the same day of the month, or the month's last day when it has
// no such day (31 January + 1 month is 28 or 29 February). '' for anything that is not a date.
export function addMonths(iso, months) {
  if (!ISO.test(String(iso)) || !Number.isInteger(months)) return ''
  const [y, m, d] = iso.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

// A leg, as the table holds it. `kind` is what it is: FWD a forward, CALL or PUT an option, TOUCH a touch (which
// has no strike). `date` is the settlement date of a forward and the expiry of an option. `strike` null is "the
// fair forward for that date", worked out by the API. An option carries its `style` (EUROPEAN, AMERICAN, DIGITAL,
// BARRIER, DOUBLE_BARRIER) and that style's terms; they are the fields of the standalone option ticket.
export const LEG_KINDS = ['FWD', 'CALL', 'PUT', 'TOUCH']
export const LEG_STYLES = ['EUROPEAN', 'AMERICAN', 'DIGITAL', 'BARRIER', 'DOUBLE_BARRIER']
const STYLE_DEFAULTS = { style: 'EUROPEAN', barrierType: 'UP_OUT', barrier: null, lowerB: null, upperB: null, rebate: null, payout: null, payoutCcy: 'QUOTE', touchType: 'ONE_TOUCH', payAtHit: false }
// every term of a leg that its price or its record depends on, in one order (the key of its price)
export const LEG_TERMS = ['kind', 'direction', 'notional', 'date', 'strike', 'style', 'barrierType', 'barrier', 'lowerB', 'upperB', 'rebate', 'payout', 'payoutCcy', 'touchType', 'payAtHit']
const doubleTouch = (l) => String(l.touchType || '').startsWith('DOUBLE')
export const isOption = (l) => l.kind === 'CALL' || l.kind === 'PUT' || l.kind === 'TOUCH'
// the style a leg is priced and booked as: a touch is its own style, a forward has none
export const styleOf = (l) => (l.kind === 'TOUCH' ? 'TOUCH' : isOption(l) ? (LEG_STYLES.includes(l.style) ? l.style : 'EUROPEAN') : null)
export function newLeg(from, over = {}) {
  const kind = LEG_KINDS.includes(from.kind) ? from.kind : 'FWD'
  const date = ISO.test(String(from.date ?? from.settlement)) ? (from.date ?? from.settlement) : ''
  return { ...STYLE_DEFAULTS, ...Object.fromEntries(Object.keys(STYLE_DEFAULTS).filter(k => from[k] != null).map(k => [k, from[k]])),
           id: legId(), kind, direction: from.direction === 'SELL' ? 'SELL' : 'BUY', notional: finite(from.notional) && from.notional > 0 ? from.notional : 1,
           date, strike: null, ...over }
}

// The levels a style starts with, around the fair forward `f` (rounded to `dp` decimals): a barrier 15 % away on the
// side its kind names, a range 15 % either side, the pair's usual payout. Only what the style uses and the leg lacks.
export function seedStyle(l, f, { dp = 2, payout = 100000 } = {}) {
  const r = (x) => Number(x.toFixed(dp)), st = styleOf(l), out = {}
  if (!finite(f) || f <= 0) return out
  const down = String(l.barrierType || '').startsWith('DOWN')
  if ((st === 'BARRIER' || (st === 'TOUCH' && !doubleTouch(l))) && !(l.barrier > 0)) out.barrier = r(f * (down ? 0.85 : 1.15))
  if ((st === 'DOUBLE_BARRIER' || (st === 'TOUCH' && doubleTouch(l))) && !(l.lowerB > 0 && l.upperB > 0)) { out.lowerB = r(f * 0.85); out.upperB = r(f * 1.15) }
  if (st === 'DOUBLE_BARRIER' && !String(l.barrierType || '').startsWith('KNOCK')) out.barrierType = 'KNOCK_OUT'
  if (st === 'BARRIER' && String(l.barrierType || '').startsWith('KNOCK')) out.barrierType = 'UP_OUT'
  if ((st === 'DIGITAL' || st === 'TOUCH') && !(l.payout > 0)) out.payout = payout
  return out
}

// The leg after the last one: the same kind, style, side and size, a month later, at the fair forward.
export function nextLeg(first, legs) {
  const last = legs.length ? legs[legs.length - 1] : first
  return newLeg(last, { date: addMonths(last.date, 1), strike: null })
}

// A strip of `n` legs in all from the ticket's own: the further n − 1, a month apart, each at its own fair forward.
export function stripLegs(first, n) {
  const out = []
  for (let i = 1; i < n; i++) out.push(newLeg(first, { date: addMonths(first.date, i), strike: null }))
  return out
}

// The second leg of a two-option structure built on the ticket's own option (`f` its fair forward, `k` its strike):
//   OTHER      the other of call and put, the other side, the same date and size, its strike as far from the
//              forward on the other side (a collar when the put is the one bought, a risk reversal when the call is)
//   STRADDLE   the other of call and put, the same side, strike, date and size
//   CALENDAR   the same option a month later, the other side
// null when the ticket's leg is not a call or a put.
export function pairedLeg(first, what, { f = null, k = null, dp = 2 } = {}) {
  if (first.kind !== 'CALL' && first.kind !== 'PUT') return null
  const other = first.kind === 'CALL' ? 'PUT' : 'CALL', flip = first.direction === 'BUY' ? 'SELL' : 'BUY'
  const strike = first.strike ?? (finite(k) ? k : null)
  if (what === 'STRADDLE') return newLeg(first, { kind: other, strike })
  if (what === 'CALENDAR') return newLeg(first, { direction: flip, date: addMonths(first.date, 1), strike })
  // as far from the forward on the other side; struck at the forward (or so far that the mirror is not a price), 10 % away
  const mirror = finite(f) && finite(strike) && Math.abs(strike / f - 1) > 0.005 ? 2 * f - strike : null
  const mirrored = mirror != null && mirror > 0 ? mirror : finite(f) ? f * (other === 'CALL' ? 1.1 : 0.9) : null
  return newLeg(first, { kind: other, direction: flip, strike: mirrored == null ? null : Number(mirrored.toFixed(dp)) })
}

// What a set of legs is called. An outright is the ticket alone; a strip is the ticket's own kind, style, side and
// size a month apart, in order; two vanilla options on one date and of one size are a straddle (a call and a put,
// one side, one strike), a collar (a put bought, a call sold) or a risk reversal (a put sold, a call bought); one
// option bought and sold on two dates at one strike is a calendar. Anything else is custom.
export function structureOf(first, legs) {
  if (!legs.length) return 'OUTRIGHT'
  // a term a leg does not carry is its default (a leg typed by hand and one made by newLeg read alike)
  const term = (l, k) => l[k] ?? STYLE_DEFAULTS[k] ?? null
  const same = (a, b, keys) => keys.every(k => term(a, k) === term(b, k))
  // a strip repeats the ticket's own leg, an option's style terms and all; only the date and the strike are each leg's own
  const SHAPE = ['kind', 'direction', 'notional']
  const STYLE_TERMS = ['barrierType', 'barrier', 'lowerB', 'upperB', 'rebate', 'payout', 'payoutCcy', 'touchType', 'payAtHit']
  if (legs.every((l, i) => same(l, first, SHAPE) && styleOf(l) === styleOf(first) && (!isOption(first) || same(l, first, STYLE_TERMS)) && l.date === addMonths(first.date, i + 1))) return 'STRIP'
  if (legs.length === 1) {
    const [a, b] = [first, legs[0]]
    const vanilla = (l) => (l.kind === 'CALL' || l.kind === 'PUT') && (styleOf(l) === 'EUROPEAN' || styleOf(l) === 'AMERICAN')
    // two options of one exercise style and one size, each with a strike
    if (vanilla(a) && vanilla(b) && styleOf(a) === styleOf(b) && a.notional === b.notional && a.strike != null && b.strike != null) {
      if (a.date === b.date && a.kind !== b.kind) {
        if (a.direction === b.direction) return a.strike === b.strike ? 'STRADDLE' : 'CUSTOM'
        const put = a.kind === 'PUT' ? a : b, call = a.kind === 'PUT' ? b : a
        if (!(put.strike < call.strike)) return 'CUSTOM'                 // the put under the call, or it is not a collar
        return put.direction === 'BUY' ? 'COLLAR' : 'RISK REVERSAL'
      }
      if (a.kind === b.kind && a.date !== b.date && a.direction !== b.direction && a.strike === b.strike) return 'CALENDAR'
    }
  }
  return 'CUSTOM'
}

// Why a leg cannot be priced as it stands, in words, or null.
export function legProblem(l) {
  if (!LEG_KINDS.includes(l.kind)) return 'a type'
  const st = styleOf(l), payoutStyle = st === 'DIGITAL' || st === 'TOUCH'
  if (!payoutStyle && (!finite(l.notional) || l.notional <= 0)) return 'a size above zero'
  if (!ISO.test(String(l.date))) return isOption(l) ? 'an expiry date' : 'a settlement date'
  if (l.kind !== 'TOUCH' && l.strike != null && !(finite(l.strike) && l.strike > 0)) return 'a strike above zero, or none for the fair forward'
  if ((st === 'BARRIER' || (st === 'TOUCH' && !doubleTouch(l))) && !(finite(l.barrier) && l.barrier > 0)) return 'a barrier level'
  if ((st === 'DOUBLE_BARRIER' || (st === 'TOUCH' && doubleTouch(l))) && !(finite(l.lowerB) && finite(l.upperB) && l.lowerB > 0 && l.upperB > l.lowerB)) return 'a lower and an upper barrier, in that order'
  if (payoutStyle && !(finite(l.payout) && l.payout > 0)) return 'a payout above zero'
  return null
}

// What one unit of a leg pays at expiry with the underlying at `x`, before its side: a forward x − K, a call or a put
// its intrinsic value, a digital or a touch its payout. In this picture a barrier is read at the expiry alone (a knock
// that happens on the way and comes back is not seen), which the chart says. `k` is the strike the leg is priced at,
// `f` the spot now (which side of it a touch's barrier is on).
export function legPayoff(l, x, k, f = null) {
  const N = finite(l.notional) ? l.notional : 0, st = styleOf(l)
  if (!isOption(l)) return N * (x - k)
  if (st === 'TOUCH') {
    // reached from where spot is now (`f` here is the spot): a barrier above it going up, one below it going down
    const past = doubleTouch(l) ? (x <= l.lowerB || x >= l.upperB) : (finite(f) ? l.barrier >= f : true) ? x >= l.barrier : x <= l.barrier
    return (String(l.touchType).endsWith('NO_TOUCH') ? !past : past) ? l.payout : 0
  }
  const call = l.kind === 'CALL'
  if (st === 'DIGITAL') return (call ? x > k : x < k) ? l.payout : 0
  let v = N * Math.max(call ? x - k : k - x, 0)
  if (st === 'BARRIER') { const past = String(l.barrierType).startsWith('UP') ? x >= l.barrier : x <= l.barrier; if (String(l.barrierType).endsWith('OUT') ? past : !past) v = 0 }
  if (st === 'DOUBLE_BARRIER') { const out = x <= l.lowerB || x >= l.upperB; if (l.barrierType === 'KNOCK_IN' ? !out : out) v = 0 }
  return v
}

// The package's totals over the quotes that are in: the value and each sensitivity add across the legs.
// { n, priced, npv, spot01, ir01, netNotional } with null where no leg has the figure.
export function packageTotals(rows) {
  const sum = (f) => { const xs = rows.map(f).filter(finite); return xs.length ? xs.reduce((a, b) => a + b, 0) : null }
  return {
    n: rows.length, priced: rows.filter(r => r.quote).length,
    npv: sum(r => r.quote?.npv), spot01: sum(r => r.quote?.spot01 ?? r.quote?.delta_quote_per_pct), ir01: sum(r => r.quote?.ir01),
    vega: sum(r => r.quote?.vega),
    netNotional: sum(r => (finite(r.notional) && !isOption(r) ? (r.direction === 'SELL' ? -r.notional : r.notional) : null)),
  }
}

// The package's reference and the tag each of its trades carries in `strategy`.
// Four characters of the clock and four at random (1.7 million): two packages do not get one reference.
export const packageRef = (now = Date.now(), rand = Math.random()) => `PKG-${now.toString(36).toUpperCase().slice(-4)}${Math.floor(rand * 36 ** 4).toString(36).toUpperCase().padStart(4, '0')}`
export const packageTag = (structure, ref, i, n) => `${structure} ${ref} ${i}/${n}`
// A trade's place in a package, read back from its `strategy`: { structure, ref, i, n }, or null for any other text.
// Only what the ticket writes: one of the structures it books, a place from 1 to the count. A strategy the desk typed
// itself ("Macro", "BUTTERFLY PKG-1 5/3") is not a tag and leaves the trade's own structure showing.
export const PACKAGE_STRUCTURES = ['STRIP', 'CUSTOM', 'COLLAR', 'RISK REVERSAL', 'STRADDLE', 'CALENDAR']
export function readPackageTag(strategy) {
  // the package's trade ID as the server names it (TRD-12345678), or the reference the ticket made before that (PKG-…)
  const m = /^([A-Z][A-Z ]*?) (TRD-\d{8}|PKG-[A-Z0-9]{4,12}) (\d{1,3})\/(\d{1,3})$/.exec(String(strategy ?? ''))
  if (!m || !PACKAGE_STRUCTURES.includes(m[1])) return null
  const i = Number(m[3]), n = Number(m[4])
  return i >= 1 && i <= n ? { structure: m[1], ref: m[2], i, n } : null
}

// The legs of the package `trade` belongs to, from a list of trades (the blotter's): every leg, in its place, or
// null when the trade is no leg, or a leg is missing from the list. { tradeId, structure, n, legs: [trade, ...] }.
// Only a package the server booked (its trade ID is a TRD-): the older ticket's PKG- reference groups rows in the
// blotter and is not a package that is confirmed as one.
export function packageOf(trade, trades) {
  const tag = readPackageTag(trade?.strategy)
  if (!tag || !/^TRD-\d{8}$/.test(tag.ref)) return null
  const legs = []
  for (const t of trades || []) {
    const g = readPackageTag(t?.strategy)
    if (g && g.ref === tag.ref && g.n === tag.n) legs[g.i - 1] = t
  }
  for (let i = 0; i < tag.n; i++) if (!legs[i]) return null
  return legs.length === tag.n ? { tradeId: tag.ref, structure: tag.structure, n: tag.n, legs } : null
}

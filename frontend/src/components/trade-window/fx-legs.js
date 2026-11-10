// trade-window/fx-legs.js — a forward as a package of legs (the DETAILS tab of a currency or digital-asset
// forward). The first leg is the ticket itself, set on the TRADE tab; every further leg is the same pair and
// the same kind of settlement with its own side, size, date and strike. A strip is a forward for each month.
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

// A further leg, as the table holds it. `strike` null is "the fair forward for that date", worked out by the API.
export function newLeg(from, over = {}) {
  return { id: legId(), direction: from.direction === 'SELL' ? 'SELL' : 'BUY', notional: finite(from.notional) && from.notional > 0 ? from.notional : 1,
           settlement: ISO.test(String(from.settlement)) ? from.settlement : '', strike: null, ...over }
}

// The leg after the last one: the same side and size, a month later, at the fair forward.
export function nextLeg(first, legs) {
  const last = legs.length ? legs[legs.length - 1] : first
  return newLeg(last, { settlement: addMonths(last.settlement, 1), strike: null })
}

// A strip of `n` legs in all from the ticket's own: the further n − 1, a month apart, each at its own fair forward.
export function stripLegs(first, n) {
  const out = []
  for (let i = 1; i < n; i++) out.push(newLeg(first, { settlement: addMonths(first.settlement, i), strike: null }))
  return out
}

// What a set of legs is called: an outright (the ticket alone), a strip (every leg the ticket's side and size, a
// month apart, in order), or custom.
export function structureOf(first, legs) {
  if (!legs.length) return 'OUTRIGHT'
  const strip = legs.every((l, i) => l.direction === first.direction && l.notional === first.notional && l.settlement === addMonths(first.settlement, i + 1))
  return strip ? 'STRIP' : 'CUSTOM'
}

// Why a leg cannot be priced as it stands, in words, or null.
export function legProblem(l) {
  if (!finite(l.notional) || l.notional <= 0) return 'a size above zero'
  if (!ISO.test(String(l.settlement))) return 'a settlement date'
  if (l.strike != null && !(finite(l.strike) && l.strike > 0)) return 'a strike above zero, or none for the fair forward'
  return null
}

// The package's totals over the quotes that are in: the value and each sensitivity add across the legs.
// { n, priced, npv, spot01, ir01, netNotional } with null where no leg has the figure.
export function packageTotals(rows) {
  const sum = (f) => { const xs = rows.map(f).filter(finite); return xs.length ? xs.reduce((a, b) => a + b, 0) : null }
  return {
    n: rows.length, priced: rows.filter(r => r.quote).length,
    npv: sum(r => r.quote?.npv), spot01: sum(r => r.quote?.spot01 ?? r.quote?.delta_quote_per_pct), ir01: sum(r => r.quote?.ir01),
    netNotional: sum(r => (finite(r.notional) ? (r.direction === 'SELL' ? -r.notional : r.notional) : null)),
  }
}

// The package's reference and the tag each of its trades carries in `strategy`.
export const packageRef = (now = Date.now(), rand = Math.random()) => `PKG-${now.toString(36).toUpperCase().slice(-5)}${Math.floor(rand * 1296).toString(36).toUpperCase().padStart(2, '0')}`
export const packageTag = (structure, ref, i, n) => `${structure} ${ref} ${i}/${n}`
// A trade's place in a package, read back from its `strategy`: { structure, ref, i, n }, or null for any other text.
export function readPackageTag(strategy) {
  const m = /^([A-Z][A-Z -]*?) (PKG-[A-Z0-9]{4,12}) (\d+)\/(\d+)$/.exec(String(strategy ?? ''))
  return m ? { structure: m[1], ref: m[2], i: Number(m[3]), n: Number(m[4]) } : null
}

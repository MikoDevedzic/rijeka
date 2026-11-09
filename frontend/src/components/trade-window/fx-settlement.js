// trade-window/fx-settlement.js — which settlement price source a digital-asset ticket books, and at what time.
//
// The pairs answer lists a pair's sources as `fixing_sources` ([{source, time, auto}]) and names the one a ticket
// books when nobody chooses as `settlement_default` ({source, time}): the venue's delivery price where its
// fixings are arriving, the benchmark elsewhere. The booked valuation time is always the time of the booked
// source as `fixing_sources` lists it, on the forward and on the option alike, picked or left at the default.
//
// `fixing_default` is the constant benchmark and stays one: it is the default only when `settlement_default` is
// absent. An older API answer, one without `fixing_sources`, keeps what the ticket wrote before the choice
// existed: `fixing_default` with the product's hard-coded time (the forward 16:00 London, the option 08:00 UTC).

export const LEGACY_VALUATION_TIME = { FORWARD: '16:00 London', OPTION: '08:00 UTC' }

const usable = (s) => !!s && typeof s.source === 'string' && s.source.trim() !== ''

// The source selected when nobody chooses.
export function settlementDefault(cur) {
  const named = cur?.settlement_default?.source
  return typeof named === 'string' && named.trim() !== '' ? named : cur?.fixing_default
}

// The select's options: the pair's sources, the default first in the list if the API left it out.
// Empty when the API does not list sources (an older answer): the ticket then shows no choice.
export function settlementOptions(cur) {
  const list = Array.isArray(cur?.fixing_sources) ? cur.fixing_sources.filter(usable) : []
  if (!list.length) return []
  const def = settlementDefault(cur)
  if (def && !list.some(s => s.source === def)) return [{ source: def, time: (def === cur?.settlement_default?.source && cur.settlement_default.time) || null, auto: false }, ...list]
  return list
}

// What the trade's terms carry: {source, time, auto, isDefault}. `picked` is the select's value ('' = untouched).
export function settlementTerms(cur, picked, product) {
  const legacy = LEGACY_VALUATION_TIME[product] || LEGACY_VALUATION_TIME.FORWARD
  const options = settlementOptions(cur)
  if (!options.length) return { source: cur?.fixing_default, time: legacy, auto: false, isDefault: true }
  const def = settlementDefault(cur)
  const hit = (picked ? options.find(s => s.source === picked) : null) || options.find(s => s.source === def) || options[0]
  // the source's own time as the list gives it; the old constant only for a source listed without one
  return { source: hit.source, time: hit.time || legacy, auto: !!hit.auto, isDefault: hit.source === def }
}

// "CME CF BRR · 16:00 London": one option of the select.
export function settlementLabel(s) {
  return s?.time ? `${s.source} · ${s.time}` : String(s?.source || '')
}

// The muted line under the select: who supplies this source's fixing.
export function settlementNote(s) {
  if (!s) return ''
  return s.auto ? `fixed automatically each day${s.time ? ` at ${s.time}` : ''}` : 'your desk enters this fixing under Market data › FX · Crypto › Fixings'
}

// ── The fixing date of a digital-asset forward ───────────────────────────────────────────────────────────────
// The record's `valuation_date` is the day the trade fixes; `settlement_date` is the day the cash moves. All dates
// here are ISO strings (YYYY-MM-DD) and the arithmetic is on UTC calendar days, so no time zone moves a date.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
// A real calendar date in ISO form, or null ("2026-02-30" is not one).
function isoDate(v) {
  const m = ISO_DATE.exec(String(v ?? ''))
  if (!m) return null
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.toISOString().slice(0, 10) === m[0] ? m[0] : null
}
export function addDays(date, n) {
  const m = ISO_DATE.exec(isoDate(date) || '')
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10) : null
}

// Between the fixing date and the settlement date the pricer carries the forward to the settlement date, an error
// that grows with the gap, so the gap is capped (the API refuses a larger one with 422).
export const MAX_FIXING_GAP_DAYS = 7

// The first fixing date a ticket accepts: the later of tomorrow and the settlement date less the largest gap.
// Tomorrow, not today: the fixing date is strictly after the trade date (today's fixing of a venue's source is
// already published, and the API refuses a valuation date on or before the trade date). `today` is the UTC day.
export function earliestFixingDate({ settlementDate, today }) {
  const first = addDays(today, 1), floor = addDays(settlementDate, -MAX_FIXING_GAP_DAYS)
  if (!first) return floor
  return floor && floor > first ? floor : first
}

// A fixing date held inside its limits: not before the earliest date above, not after the settlement date.
// Null when the date is not a date, or when no fixing date is possible (the trade settles today or earlier).
export function clampFixingDate({ date, settlementDate, today }) {
  let d = isoDate(date)
  if (!d) return null
  const first = earliestFixingDate({ settlementDate, today }), last = isoDate(settlementDate)
  if (first && last && first > last) return null
  if (first && d < first) d = first
  if (last && d > last) d = last
  return d
}

// The fixing date a ticket proposes. A source the feed stores (`auto`: the venue's morning price, same-day cash)
// fixes on the settlement date; a benchmark a desk enters fixes one calendar day before it, but never before
// tomorrow and never after the settlement date (a trade settling tomorrow fixes tomorrow). Never today.
// `source` is the selected source ({auto}). Null without a settlement date or when the trade settles today or earlier.
export function defaultFixingDate({ settlementDate, source, today }) {
  const settles = isoDate(settlementDate)
  if (!settles) return null
  return clampFixingDate({ date: source?.auto ? settles : addDays(settles, -1), settlementDate: settles, today })
}

// The muted line that says when the trade fixes: the forward on its fixing date, the option at its expiry.
// A forward that fixes before it settles is still priced to its settlement date, and the line says so.
export function fixingCaption({ product, fixingDate, expiryDate, settlementDate, time }) {
  const at = time ? ` at ${time}` : ''
  if (product === 'OPTION') return expiryDate ? `fixes at expiry, ${expiryDate}${at}` : ''
  if (!fixingDate) return settlementDate ? 'no fixing date is possible: the settlement date must be after today' : ''
  if (!settlementDate) return `fixes on ${fixingDate}${at}`
  return `fixes on ${fixingDate}${at}, settles ${settlementDate}${fixingDate !== settlementDate ? '; priced to the settlement date' : ''}`
}

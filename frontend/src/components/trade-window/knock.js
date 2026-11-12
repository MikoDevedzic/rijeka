// trade-window/knock.js
// The desk's record that a barrier was touched, on the ticket (POST /api/currency/knock): which trades take one,
// what the trade says today, what is wrong with what was typed, and the body. The rule itself is the API's
// (backend/settlement/knock.py).

const STYLES = ['BARRIER', 'DOUBLE_BARRIER', 'TOUCH']
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v))
const num = (v) => { const s = String(v ?? '').replace(/,/g, '').trim(); if (!s) return null; const x = Number(s); return Number.isFinite(x) ? x : NaN }

// A booked digital-asset option with a barrier or a touch level, still open.
export function canRecordKnock(trade) {
  if (!trade || String(trade.instrument_type || '').toUpperCase() !== 'CRYPTO_OPTION') return false
  if (!['PENDING', 'CONFIRMED'].includes(trade.status)) return false
  return STYLES.includes(String(trade.terms?.style || '').toUpperCase())
}

export const knockExpiry = (trade) => (isDate(trade?.terms?.expiration_date) ? trade.terms.expiration_date : null)
// the last day a touch can be dated: today, or the expiry if that has passed
export const knockLastDay = (trade, today) => { const e = knockExpiry(trade); return e && e < today ? e : today }
export const hasExpired = (trade, today) => { const e = knockExpiry(trade); return !!e && today >= e }

// What the trade's record says, in words.
export function knockLine(terms) {
  const t = terms || {}
  if (t.knocked === true) return `Touched on ${t.knock_date || 'a date not recorded'}` + (t.knock_level != null ? ` at ${Number(t.knock_level).toLocaleString('en-US', { maximumFractionDigits: 6 })}` : '')
  if (t.knocked === false) return 'Never touched: said at expiry'
  return 'Nothing recorded: at expiry the amount is provisional until the desk says whether the level traded'
}

export function knockProblem({ on, level, trade, today }) {
  if (!isDate(on)) return 'the date the level traded'
  const first = isDate(trade?.trade_date) ? trade.trade_date : null
  if (first && on < first) return `not before the trade date (${first})`
  const last = knockLastDay(trade, today)
  if (on > last) return `not after ${last}, the earlier of today and the expiry`
  const x = num(level)
  if (x !== null && !(x > 0)) return 'the level is a price'
  return null
}

export function knockBody({ on, level }) {
  const body = { knocked: true, on }
  const x = num(level)
  if (x !== null && x > 0) body.level = x
  return body
}

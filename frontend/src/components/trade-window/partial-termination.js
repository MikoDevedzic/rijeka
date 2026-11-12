// trade-window/partial-termination.js
// What the ticket needs to reduce a booked trade's notional (POST /api/chain/partial-terminate): which trades offer
// it, what is wrong with what was typed, and the body. The API works out everything that changes from the booking
// itself (backend/chain/partial_termination.py); this sends only the notional that remains and the unwind fee.

const num = (v) => {
  const s = String(v ?? '').replace(/,/g, '').trim()
  if (!s) return null
  const x = Number(s)
  return Number.isFinite(x) ? x : NaN
}
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v))

// A trade the block is offered on: pending or confirmed, with a notional, not one leg of a package (the registry
// holds the package's hash) and not an option whose size is a payout.
export function canPartiallyTerminate(trade, { pkg = null, terminated = false } = {}) {
  if (!trade || pkg || terminated) return false
  if (!['PENDING', 'CONFIRMED'].includes(trade.status)) return false
  if (!(Number(trade.notional) > 0)) return false
  if (['DIGITAL', 'TOUCH'].includes(String(trade.structure || '').toUpperCase())) return false
  return true
}

// What is wrong with the form, in words, or null. `current` is the trade's notional; a fee is optional, and a fee
// with an amount needs a date that is today or later.
export function partialProblem({ current, remaining, feeAmount, feeDate, today }) {
  const n = num(remaining)
  if (n === null) return 'type the notional that remains'
  if (Number.isNaN(n)) return 'the notional that remains is a number'
  if (!(n > 0)) return 'the notional that remains is above zero (to close the whole trade, terminate it)'
  if (!(n < Number(current))) return `the notional that remains is below the trade's ${fmtNotional(current)}`
  const a = num(feeAmount)
  if (a === null) return null
  if (Number.isNaN(a) || !(a > 0)) return 'the unwind fee is an amount above zero (PAY or RECEIVE says which way it goes)'
  if (!isDate(feeDate)) return 'the unwind fee needs the date it is paid'
  if (today && feeDate < today) return 'the unwind fee is paid today or later'
  return null
}

export function partialBody({ remaining, feeDirection, feeAmount, feeDate }) {
  const body = { new_notional: String(num(remaining)) }
  const a = num(feeAmount)
  if (a !== null && a > 0) body.fee = { direction: feeDirection === 'RECEIVE' ? 'RECEIVE' : 'PAY', amount: a, date: feeDate }
  return body
}

export function fmtNotional(v) {
  const x = Number(v)
  return Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'
}

// The line under the form once the API has answered: what the trade was reduced from and to, and whether the
// signed record on the chain was superseded or only the booking changed.
export function partialDone(pt) {
  if (!pt) return null
  const fee = pt.fee ? ` · unwind fee ${pt.fee.direction === 'RECEIVE' ? 'received' : 'paid'} ${fmtNotional(pt.fee.amount)} ${pt.fee.currency} on ${pt.fee.date}` : ''
  return `Reduced from ${fmtNotional(pt.from_notional)} to ${fmtNotional(pt.to_notional)} ${pt.notional_ccy || ''}`.trimEnd() + fee
    + (pt.anchored ? ' · the signed record was superseded on-chain, both parties signing' : ' · the booking changed; no record on a chain was signed for it')
}

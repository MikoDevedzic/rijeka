// Fees on a trade: any number of known payments entered with it (backend/pricing/fees.py). An option's premium is
// one type; an upfront payment, a broker's fee, an unwind fee, a premium paid in instalments are others or several
// rows. A row on the ticket is what the user is typing; `cleanFees` is what a complete row becomes for the API.

export const FEE_TYPES = ['PREMIUM', 'UPFRONT', 'BROKERAGE', 'UNWIND', 'OTHER']
export const MAX_FEES = 24

let seq = 0
// A new row. `direction` is ours: PAY or RECEIVE.
export function feeRow({ type = 'PREMIUM', direction = 'PAY', amount = '', date = '' } = {}) {
  seq += 1
  return { id: `fee-${seq}`, type, direction, amount: amount === '' || amount == null ? '' : String(amount), date: date || '' }
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim())
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null
}
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v))

// What is wrong with a row, in words, or null. A row with nothing typed in it is not a fee yet and is not wrong.
export function feeProblem(row) {
  const blankAmount = String(row.amount ?? '').trim() === '', blankDate = !row.date
  if (blankAmount && blankDate) return null
  const a = num(row.amount)
  if (a == null) return 'the amount is a number'
  if (!(a > 0)) return 'the amount is above zero: PAY or RECEIVE says which way it goes'
  if (!isDate(row.date)) return 'a fee needs its date'
  if (!FEE_TYPES.includes(row.type)) return 'choose a type'
  return null
}

export const feeIsBlank = (row) => String(row.amount ?? '').trim() === '' && !row.date

// The rows that are fees, as the API takes them, in the trade's currency. Null when a row is wrong: nothing is sent
// (priced, simulated or booked) on a list with a wrong row in it.
export function cleanFees(rows, currency) {
  const out = []
  for (const r of rows || []) {
    if (feeIsBlank(r)) continue
    if (feeProblem(r)) return null
    out.push({ type: r.type, direction: r.direction === 'RECEIVE' ? 'RECEIVE' : 'PAY', amount: num(r.amount), currency: String(currency || 'USD').toUpperCase(), date: r.date })
  }
  return out
}

// The premium as the confirmation record names it (one amount, one currency, one date): the PREMIUM fees added up,
// on the first of their dates. Null when the trade has no PREMIUM fee.
export function premiumTerms(fees) {
  const p = (fees || []).filter(f => f.type === 'PREMIUM')
  if (!p.length) return null
  return { premium_amount: Math.round(p.reduce((a, f) => a + f.amount, 0) * 100) / 100, premium_currency: p[0].currency,
           premium_payment_date: p.map(f => f.date).sort()[0] }
}

// A booking body with the trade's fees in its terms. The confirmation's premium fields follow the PREMIUM fees when
// there are any; with none they are left as the ticket set them.
export function withFees(body, fees) {
  if (!body || !fees || !fees.length) return body
  return { ...body, terms: { ...(body.terms || {}), fees, ...(premiumTerms(fees) || {}) } }
}

// The rows of a booked trade opened again: its fees; or, for a trade booked before fees were a list, its premium.
export function rowsFromTerms(terms) {
  const t = terms || {}
  if (Array.isArray(t.fees) && t.fees.length) return t.fees.map(f => feeRow({ type: f.type, direction: f.direction, amount: f.amount, date: f.date }))
  if (t.premium_amount != null && Number(t.premium_amount) > 0 && t.premium_payment_date) {
    const sold = String(t.side || t.direction || 'BUY').toUpperCase() === 'SELL'
    return [feeRow({ type: 'PREMIUM', direction: sold ? 'RECEIVE' : 'PAY', amount: t.premium_amount, date: String(t.premium_payment_date).slice(0, 10) })]
  }
  return []
}

// One short line for the block's header: "2 fees · pay 12,500.00 · receive 4,000.00 USD", amounts undiscounted.
export function feesSummary(fees, currency) {
  if (!fees || !fees.length) return 'none entered'
  const fmt = (x) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const pay = fees.filter(f => f.direction === 'PAY').reduce((a, f) => a + f.amount, 0)
  const rec = fees.filter(f => f.direction === 'RECEIVE').reduce((a, f) => a + f.amount, 0)
  return [`${fees.length} fee${fees.length > 1 ? 's' : ''}`, pay ? `pay ${fmt(pay)}` : null, rec ? `receive ${fmt(rec)}` : null].filter(Boolean).join(' · ') + ` ${currency || ''}`.trimEnd()
}

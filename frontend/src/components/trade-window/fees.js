// Fees on a trade: any number of known payments entered with it (backend/pricing/fees.py). An option's premium is
// one type; an upfront payment, a broker's fee, an unwind fee, a premium paid in instalments are others or several
// rows. A row on the ticket is what the user is typing; `cleanFees` is what a complete row becomes for the API.

export const FEE_TYPES = ['PREMIUM', 'UPFRONT', 'BROKERAGE', 'UNWIND', 'OTHER']
export const MAX_FEES = 24

let seq = 0
// A new row. `direction` is ours: PAY or RECEIVE. `currency` is the trade's when the row was made: an amount typed in
// one currency is never read as another (feeProblem says so when the trade's currency has changed under it).
export function feeRow({ type = 'PREMIUM', direction = 'PAY', amount = '', date = '', currency = null } = {}) {
  seq += 1
  return { id: `fee-${seq}`, type, direction, amount: amount === '' || amount == null ? '' : String(amount), date: date || '', currency: currency ? String(currency).toUpperCase() : null }
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, '').trim())
  return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null
}
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v))

// What is wrong with a row, in words, or null. A row with nothing typed in it is not a fee yet and is not wrong.
export function feeProblem(row, currency = null) {
  const blankAmount = String(row.amount ?? '').trim() === '', blankDate = !row.date
  if (blankAmount && blankDate) return null
  if (row.currency && currency && row.currency !== String(currency).toUpperCase()) return `entered in ${row.currency}; the trade is now in ${String(currency).toUpperCase()}: enter it again or remove it`
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
    if (feeProblem(r, currency)) return null
    out.push({ type: r.type, direction: r.direction === 'RECEIVE' ? 'RECEIVE' : 'PAY', amount: num(r.amount), currency: String(currency || 'USD').toUpperCase(), date: r.date })
  }
  return out
}

// The premium as the confirmation record names it (one amount the buyer pays the seller, one currency, one date): the
// PREMIUM fees that go the option's way (we PAY when we bought, RECEIVE when we sold) less any that go against it, on
// the first of their dates. Null when there is no PREMIUM fee or they do not add up to a premium the buyer pays.
export function premiumTerms(fees, side) {
  const p = (fees || []).filter(f => f.type === 'PREMIUM')
  if (!p.length) return null
  const ours = String(side || 'BUY').toUpperCase() === 'SELL' ? 'RECEIVE' : 'PAY'
  const net = Math.round(p.reduce((a, f) => a + (f.direction === ours ? f.amount : -f.amount), 0) * 100) / 100
  if (!(net > 0)) return null
  return { premium_amount: net, premium_currency: p[0].currency, premium_payment_date: p.map(f => f.date).sort()[0] }
}

// A booking body with the trade's fees in its terms. On an option (a body whose terms already carry a premium) the
// confirmation's premium fields follow the PREMIUM fees when they add up to one; on anything else, and with no
// PREMIUM fee, the terms are left as the ticket set them.
export function withFees(body, fees) {
  if (!body || !fees || !fees.length) return body
  const terms = body.terms || {}
  const premium = 'premium_amount' in terms ? premiumTerms(fees, terms.side || terms.direction) : null
  return { ...body, terms: { ...terms, fees, ...(premium || {}) } }
}

// The rows of a booked trade opened again: its fees; or, for a trade booked before fees were a list, its premium.
export function rowsFromTerms(terms) {
  const t = terms || {}
  if (Array.isArray(t.fees) && t.fees.length) return t.fees.filter(f => f && typeof f === 'object').map(f => feeRow({ type: f.type, direction: f.direction, amount: f.amount, date: f.date, currency: f.currency }))
  if (t.premium_amount != null && Number(t.premium_amount) > 0 && t.premium_payment_date) {
    const sold = String(t.side || t.direction || 'BUY').toUpperCase() === 'SELL'
    return [feeRow({ type: 'PREMIUM', direction: sold ? 'RECEIVE' : 'PAY', amount: t.premium_amount, date: String(t.premium_payment_date).slice(0, 10), currency: t.premium_currency })]
  }
  return []
}

// An amount as the field shows it once it is left: thousands separated, up to two decimals; what is not a number is
// left as typed (the row then says so).
export function amountShown(v) {
  const n = num(v)
  return n == null ? String(v ?? '') : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// One short line for the block's header: "2 fees · pay 12,500.00 · receive 4,000.00 USD", amounts undiscounted.
export function feesSummary(fees, currency) {
  if (!fees || !fees.length) return 'none entered'
  const fmt = (x) => x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const pay = fees.filter(f => f.direction === 'PAY').reduce((a, f) => a + f.amount, 0)
  const rec = fees.filter(f => f.direction === 'RECEIVE').reduce((a, f) => a + f.amount, 0)
  return [`${fees.length} fee${fees.length > 1 ? 's' : ''}`, pay ? `pay ${fmt(pay)}` : null, rec ? `receive ${fmt(rec)}` : null].filter(Boolean).join(' · ') + ` ${currency || ''}`.trimEnd()
}

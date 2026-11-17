// trade-window/amend-terms.js
// What the ticket needs to amend a booked trade's terms (GET /api/chain/amendable, POST /api/chain/amend-terms):
// which trades offer it, what is wrong with what was typed, the body, and the line that says what was done. The API
// says which terms the trade has and works out everything that changes from the booking itself
// (backend/chain/amendment.py); this sends only the terms typed and the reason.

const num = (v) => {
  const s = String(v ?? '').replace(/,/g, '').trim()
  if (!s) return null
  const x = Number(s)
  return Number.isFinite(x) ? x : NaN
}

// A trade the block is offered on: pending or confirmed, and not one leg of a package (the registry holds the
// package's hash). What it can change is the API's answer.
export function canAmend(trade, { pkg = null, terminated = false } = {}) {
  if (!trade || pkg || terminated) return false
  return ['PENDING', 'CONFIRMED'].includes(trade.status)
}

// The words for what the change is: a pending booking is put right (the other side has agreed nothing yet), a
// confirmed trade is amended.
export function amendWords(kind) {
  return kind === 'CORRECTION'
    ? { open: '◆ CORRECT THE BOOKING', title: 'CORRECTION', submit: '✓ CORRECT THE BOOKING', verb: 'Corrected' }
    : { open: '◆ AMEND', title: 'AMENDMENT', submit: '✓ AMEND THE TRADE', verb: 'Amended' }
}

/** A figure as the form writes it: grouped, up to eight decimals, nothing rounded away that the record holds. */
export function fmtTerm(v) {
  const x = Number(v)
  return Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '—'
}

// The figure as it was typed, without its grouping commas: what is sent, so no digit is lost to a float on the way.
const asTyped = (v) => String(v ?? '').replace(/,/g, '').trim()

// The terms typed that differ from what the trade has: [{ key, value, text }]. `offered` is the API's list
// ([{ key, label, now, unit, why_not }]), `typed` is { key: text }.
export function amendChanged(offered, typed) {
  return (offered || []).filter(t => !t.why_not).map(t => ({ key: t.key, value: num(typed?.[t.key]), text: asTyped(typed?.[t.key]), now: Number(t.now) }))
    .filter(t => t.value !== null && !Number.isNaN(t.value) && t.value !== t.now)
}

// What is wrong with the form, in words, or null.
export function amendProblem(offered, typed) {
  for (const t of offered || []) {
    if (t.why_not) continue
    const x = num(typed?.[t.key])
    if (x === null) continue
    if (Number.isNaN(x)) return `the ${t.label.toLowerCase()} is a number`
    if (t.key === 'notional' && x < Number(t.now)) return `an amendment raises the notional from ${fmtTerm(t.now)}: to reduce it, partially terminate`
    if (['forward_rate', 'forward_price', 'strike', 'notional'].includes(t.key) && !(x > 0)) return `the ${t.label.toLowerCase()} is above zero`
  }
  return amendChanged(offered, typed).length ? null : 'type the new value of at least one term'
}

export function amendBody(offered, typed, reason) {
  const terms = {}
  for (const t of amendChanged(offered, typed)) terms[t.key] = t.text
  const why = String(reason || '').trim()
  return why ? { terms, reason: why } : { terms }
}

// The line once the API has answered: each term from and to, and whether the signed record on the chain was
// superseded or only the booking changed.
export function amendDone(am) {
  if (!am || !Array.isArray(am.terms)) return null
  const terms = am.terms.map(t => `${t.label} ${fmtTerm(t.from)} → ${fmtTerm(t.to)}${t.unit ? ` ${t.unit}` : ''}${t.key === 'notional' ? ' (an increase)' : ''}`).join(' · ')
  return `${amendWords(am.kind).verb}: ${terms}`
    + (am.anchored ? ' · the signed record was replaced on-chain, both parties signing' : ' · the booking changed; no record on a chain was signed for it')
    + (am.reason ? ` · ${am.reason}` : '')
}

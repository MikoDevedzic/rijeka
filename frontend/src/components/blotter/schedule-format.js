// A period schedule's figure as the rest of the ticket writes one: at rest an amount has its thousands grouped
// (10,000,000) and a rate drops the zeros it does not need (3.480003, not 3.48000300). In the field being typed in
// it is the plain number, and what is kept is the plain number either way (LegDetailsTab.jsx, EditCell).
export function atRest(value, kind) {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  if (value === '' || value == null || !isFinite(n)) return value ?? ''
  if (kind === 'amount') return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return String(Number(n.toFixed(6)))
}

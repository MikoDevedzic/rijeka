import { parseNumber } from '../trade-window/fx-ticket'

// A period schedule's figure as the rest of the ticket writes one: at rest an amount has its thousands grouped
// (10,000,000) and a rate drops the zeros it does not need (3.480003, not 3.48000300). In the field being typed in
// it is the plain number, and what is kept is the plain number either way (LegDetailsTab.jsx, EditCell).
export function atRest(value, kind) {
  const n = Number(String(value ?? '').replace(/,/g, ''))
  if (value === '' || value == null || !isFinite(n)) return value ?? ''
  if (kind === 'amount') return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return String(Number(n.toFixed(6)))
}

// A figure that arrives from outside the field (a paste, an imported sheet) as the plain number the pricer reads:
// "10,000,000" is "10000000". What cannot be read as a number is left as it came, for the user to see and correct.
export function plain(value) {
  const p = parseNumber(typeof value === 'number' ? value : String(value ?? ''), { signed: true })
  return p.state === 'ok' ? String(p.value) : String(value ?? '')
}

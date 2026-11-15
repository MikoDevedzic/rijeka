// risk/fixing-ladder.js — what the Fixings panel shows, from the risk report's `fixings` (backend/risk/fixings.py):
// `resets`, one row a business day and index (the net notional whose floating rate is set by that day's fixing, and
// what one basis point on that fixing is worth), and `settlements`, the non-deliverable forwards that fix on a date.
// Nothing is computed here but the order and the grouping.
export const indexName = (id) => String(id || '').replace(/_/g, ' ')
// The dates that have a reset, in order, each with its rows by index; the first `limit` of them (all when 0).
export function byDate(fx, limit = 0) {
  const m = new Map()
  for (const r of fx?.resets || []) { if (!m.has(r.date)) m.set(r.date, []); m.get(r.date).push(r) }
  const days = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, rows]) => ({ date, rows: rows.sort((a, b) => a.index.localeCompare(b.index)) }))
  return limit ? days.slice(0, limit) : days
}
// One series an index for the picture: its net notional on each date it resets, and the largest of them.
export function series(fx) {
  const m = new Map()
  for (const r of fx?.resets || []) { if (!m.has(r.index)) m.set(r.index, []); m.get(r.index).push({ date: r.date, net: r.net_usd, f01: r.fixing01_usd, days: r.days }) }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([index, points]) => {
    points.sort((a, b) => a.date.localeCompare(b.date))
    return { index, points, top: Math.max(0, ...points.map(p => Math.abs(p.net))), f01: points.reduce((s, p) => s + p.f01, 0) }
  })
}
// The first fixing to come of each index: what resets next.
export const nextOf = (fx) => series(fx).map(s => ({ index: s.index, ...s.points[0] }))
const KIND = { IR_CAP: 'cap', IR_FLOOR: 'floor', IR_COLLAR: 'collar', IR_SWAPTION: 'swaption', BERMUDAN_SWAPTION: 'Bermudan swaption', FX_OPTION: 'FX option', CRYPTO_OPTION: 'digital-asset option' }
// "2 caps, 1 swaption": the trades whose fixing is an option's and is not a notional in the ladder.
export function notCovered(fx) {
  return Object.entries(fx?.not_covered || {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${KIND[k] || k.toLowerCase()}${n > 1 ? 's' : ''}`).join(', ')
}
export const any = (fx) => !!((fx?.resets || []).length || (fx?.settlements || []).length)
// A notional in millions with its sign: +125.0m, −40.0m; a small one written out.
export const mn = (n) => n == null || !Number.isFinite(Number(n)) ? '—' : Math.abs(n) < 5e4 ? (Math.round(n) === 0 ? '0' : `${n > 0 ? '+' : '−'}${Math.round(Math.abs(n)).toLocaleString('en-US')}`) : `${n > 0 ? '+' : '−'}${(Math.abs(n) / 1e6).toFixed(1)}m`
export const units = (n, unit) => n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${unit}`
export const day = (iso) => iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' }) : '—'

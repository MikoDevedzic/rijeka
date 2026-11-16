// configurations/adoption-view.js — the words and figures of the Adoption panel (GET /api/ops/adoption), kept
// out of the component so they are tested by themselves.
const STEP = {
  created: 'CREATED', returned: 'CAME BACK', priced: 'PRICED', booked: 'BOOKED', xva: 'RAN XVA', confirmed: 'CONFIRMED',
}
const STEP_SAYS = {
  created: 'accounts signed up', returned: 'active on a later day than the one they signed up',
  priced: 'priced a trade', booked: 'booked a trade', xva: 'ran an XVA simulation', confirmed: 'confirmed a trade',
}
const EVENT = {
  priced: 'PRICED', scenario: 'SCENARIO', xva: 'XVA', capital: 'CAPITAL', booked: 'BOOKED', confirmed: 'CONFIRMED',
  lifecycle: 'AMEND · TERMINATE', verified: 'VERIFIED A RECORD', risk: 'RISK', pnl: 'P&L', ipv: 'IPV', collateral: 'COLLATERAL',
  cashflows: 'CASHFLOWS', market_data: 'MARKET DATA SAVED', static_data: 'COUNTERPARTIES · ENTITIES', assistant: 'PROMETHEUS',
  chat: 'CHAT', methodology: 'METHODOLOGY',
}

export const stepLabel = (step) => STEP[step] || String(step || '').toUpperCase()
export const stepSays = (step) => STEP_SAYS[step] || ''
export const eventLabel = (event, detail) => `${EVENT[event] || String(event || '').toUpperCase().replace(/_/g, ' ')}${detail ? ` · ${detail}` : ''}`

/** A share of the accounts as a whole per cent; '—' when there is nothing to take a share of. */
export function share(v) {
  return Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—'
}

/** Hours as a person says them: under two days in hours, then in days. */
export function span(hours) {
  if (!Number.isFinite(hours)) return '—'
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)} h`
  return `${(hours / 24).toFixed(1)} d`
}

/** A day, written one way whatever the browser's language: 16 Nov 2026. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export function day(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '')
  return m && MONTHS[Number(m[2]) - 1] ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '—'
}

/** The week a row stands for: the Monday it began. */
export const week = (iso) => (iso ? `w/c ${day(iso).replace(/ \d{4}$/, '')}` : '—')

/** What the header says under the title. */
export function headline(a) {
  if (!a) return ''
  const n = `${a.accounts} account${a.accounts === 1 ? '' : 's'}`
  if (!a.recording) return `${n} · bookings and confirmations only: the activity table is not applied`
  return `${n} · activity recorded since ${day(a.tracking_since)}`
}

/** A cohort's cell: how many of its accounts were active that many weeks later; blank for a week that has not
 *  begun and for a week with no new accounts. */
export function kept(n, of) {
  if (n == null || !of) return ''                          // not begun, or a week in which no account was created
  return `${n} · ${Math.round((n / of) * 100)}%`
}

// trade-window/product-defaults.js
// ─────────────────────────────────────────────────────────────────────────────
// The one place the option products' field defaults and tenor tables live.
// The TERMS bodies (product-terms.jsx) display these when the trader has not
// touched a field, the preview pricers (products/rates.js) send them, and the
// booking (booking.js) stores them — so what is on screen is what is priced
// and what is booked. No React in here: booking.js and its tests import it.
// ─────────────────────────────────────────────────────────────────────────────

// Option-expiry tenor string → years, in the order the swaption's OPTION EXPIRY select lists them.
export const EXPIRY_Y = {
  '1M': 1 / 12, '3M': 0.25, '6M': 0.5, '9M': 0.75, '1Y': 1, '2Y': 2, '3Y': 3, '4Y': 4, '5Y': 5, '7Y': 7, '10Y': 10,
}
export const EXPIRY_TENORS = Object.keys(EXPIRY_Y)
// The select's value when the expiry was typed as a date and is no tenor's.
export const EXPIRY_DATE = 'DATE'

// Swap / cap tenor string → years. The PRIMARY ECONOMICS tenor select.
export const TENOR_Y = {
  'ON': 1 / 365, '1W': 7 / 365, '1M': 1 / 12, '2M': 2 / 12, '3M': 3 / 12, '6M': 6 / 12, '9M': 9 / 12,
  '1Y': 1, '18M': 1.5, '2Y': 2, '3Y': 3, '4Y': 4, '5Y': 5, '6Y': 6, '7Y': 7, '8Y': 8,
  '9Y': 9, '10Y': 10, '12Y': 12, '15Y': 15, '20Y': 20, '25Y': 25, '30Y': 30, '40Y': 40, '50Y': 50,
}

// Pay-frequency string → accruals per year (the cap pricers' freq_per_year).
export const FREQ_PER_YEAR = { MONTHLY: 12, QUARTERLY: 4, SEMI_ANNUAL: 2, ANNUAL: 1 }

// IR_SWAPTION: SwaptionTermsBody. Strike blank = ATM forward.
// optionSide BUY: we hold the right (we pay the premium); SELL: we wrote it.
export const SWAPTION_DEFAULTS = {
  expiry: '1Y', volBp: '86.5', strike: '', optionSide: 'BUY',
}

// RATES_CAP / RATES_FLOOR / RATES_COLLAR: the cap-like bodies. Strikes in %.
export const CAPFLOOR_DEFAULTS = {
  capRate: '4.5', floorRate: '3.0',
  capResetFreq: 'DAILY', capPayFreq: 'QUARTERLY', capDayCount: 'ACT/360',
  volOverride: '', optionSide: 'BUY',
}

// Calendar-day shift of an ISO date, in UTC so no DST day is lost.
export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const isIso = (d) => typeof d === 'string' && ISO_DAY.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'))
export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
// A date that falls on a weekend moved to the Monday after, or, where that is in the next month, the Friday before
// (modified following). The ticket holds no holiday calendar: a date on a holiday is the desk's to type.
export function offWeekend(iso) {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay()
  if (dow !== 0 && dow !== 6) return iso
  const fwd = addDays(iso, dow === 6 ? 2 : 1)
  return fwd.slice(0, 7) === iso.slice(0, 7) ? fwd : addDays(iso, dow === 6 ? -1 : -2)
}
const nearestTenor = (years) => EXPIRY_TENORS.reduce((best, t) => (Math.abs(EXPIRY_Y[t] - years) < Math.abs(EXPIRY_Y[best] - years) ? t : best), SWAPTION_DEFAULTS.expiry)

// A swaption ticket's expiry, for the field, the pricing request and the booking alike:
//   { tenor, date, custom, rolledFrom, years, shiftDays }
// - A tenor is that many calendar months from the valuation date, off a weekend (a 3M expiry on 18 November is
//   18 February, not 91 days on). A typed date (state.expiry === EXPIRY_DATE) is taken as typed.
// - A booked trade (state.readOnly) keeps the expiry date it was booked with, whatever the rule was that day.
// - `years` is the option's time: the days from the valuation date to the expiry over 365 (ACT/365), as the booked
//   option is revalued for P&L, VaR and the ladder (backend pnl/valuation._value_swaption), so a ticket and its
//   booking agree and a booked option shows the time it has left. A Bermudan keeps the tenor's whole years: its
//   tree steps in twelfths of a year and takes no other date, so a typed date falls back to the nearest tenor.
// - `shiftDays` moves the spot-starting swap of PRIMARY ECONOMICS to the swap the option delivers into: the days
//   from the trade's own date to the expiry.
export function swaptionExpiry(state = {}) {
  const val = isIso(state.valDate) ? state.valDate : null
  const anchor = state.readOnly && isIso(state.tradeDate) ? state.tradeDate : val
  const bermudan = state.structure === 'BERMUDAN'
  const booked = !!state.readOnly && isIso(state.expiryDate)
  const typed = !bermudan && state.expiry === EXPIRY_DATE && isIso(state.expiryDate)
  let tenor = EXPIRY_Y[state.expiry] ? state.expiry : null
  if (!tenor && !typed) tenor = isIso(state.expiryDate) && anchor ? nearestTenor(daysBetween(anchor, state.expiryDate) / 365.25) : SWAPTION_DEFAULTS.expiry
  let date = null, rolledFrom = null
  if (booked || typed) date = state.expiryDate
  else if (anchor) { const raw = addMonthsIso(anchor, Math.round(EXPIRY_Y[tenor] * 12)); date = offWeekend(raw); if (date !== raw) rolledFrom = raw }
  const shiftDays = date && anchor ? Math.max(daysBetween(anchor, date), 0) : Math.round(EXPIRY_Y[tenor || SWAPTION_DEFAULTS.expiry] * 365.25)
  const left = date && val ? daysBetween(val, date) / 365 : EXPIRY_Y[tenor || SWAPTION_DEFAULTS.expiry]
  const years = bermudan ? EXPIRY_Y[tenor] : Math.max(left, 1 / 365)
  return { tenor: typed ? null : tenor, date, custom: typed, rolledFrom, years, shiftDays }
}
// The swap a swaption delivers into: { start, end }. It starts `shiftDays` after the spot-starting swap of PRIMARY
// ECONOMICS and runs that swap's tenor by the calendar. (Both dates used to be moved by the same count of days, which
// made a five-year swap a day short whenever a leap day fell inside it: a 1Y5Y struck on 18 November 2026 ended on
// 19 November 2032.) A booked trade (state.readOnly) keeps the dates its legs were booked with, by that older rule.
export function swaptionUnderlying(state = {}) {
  if (!isIso(state.effDate) || !isIso(state.matDate)) return { start: null, end: null }
  const { shiftDays } = swaptionExpiry(state)
  const start = addDays(state.effDate, shiftDays)
  if (state.readOnly) return { start, end: addDays(state.matDate, shiftDays) }
  const [y1, m1] = state.effDate.split('-').map(Number), [y2, m2] = state.matDate.split('-').map(Number)
  return { start, end: addMonthsIso(start, (y2 - y1) * 12 + (m2 - m1)) }
}
// `months` calendar months after an ISO date, on the same day of the month or the month's last (fx-legs.addMonths).
function addMonthsIso(iso, months) {
  const [y, m, d] = iso.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + months, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

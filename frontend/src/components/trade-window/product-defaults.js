// trade-window/product-defaults.js
// ─────────────────────────────────────────────────────────────────────────────
// The one place the option products' field defaults and tenor tables live.
// The TERMS bodies (product-terms.jsx) display these when the trader has not
// touched a field, the preview pricers (products/rates.js) send them, and the
// booking (booking.js) stores them — so what is on screen is what is priced
// and what is booked. No React in here: booking.js and its tests import it.
// ─────────────────────────────────────────────────────────────────────────────

// Option-expiry tenor string → years. The swaption's OPTION EXPIRY select.
export const EXPIRY_Y = {
  '1M': 1 / 12, '3M': 0.25, '6M': 0.5, '1Y': 1, '2Y': 2, '3Y': 3, '5Y': 5, '7Y': 7, '10Y': 10,
}

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

// The years the option runs for: the expiry tenor, and its calendar-day shift
// for the underlying's forward-start dates (round(expiryY * 365.25), as the
// legacy ticket booked it, so the booked schedules do not move).
export function expiryYears(expiry) {
  return EXPIRY_Y[expiry ?? SWAPTION_DEFAULTS.expiry] || 1
}
export function expiryShiftDays(expiry) {
  return Math.round(expiryYears(expiry) * 365.25)
}

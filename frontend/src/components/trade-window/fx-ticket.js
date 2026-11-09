// trade-window/fx-ticket.js — the currency ticket's pricing request, and whether it may be sent without being asked.
//
// The FX and digital-asset ticket (FxCryptoPanel) prices itself: 400 ms after the last change of a term it posts
// to /api/currency/forward/price or /api/currency/option/price. The API answers 422 to terms it cannot price, and a
// refusal nobody asked for is noise (and fails a browser journey), so priceable() says in the browser what the API
// would say, condition by condition, and the automatic pricing sends nothing when it says no. PRICE in the footer
// is not held back by it, with two exceptions: a number the ticket cannot read is never sent by anything, and a
// digital asset's date is held to its last tenor by the field itself, so no path prices beyond it. Otherwise a
// forced price goes to the API and reports the API's own words.
//
// Numbers: one convention for the whole ticket. What the ticket writes is en-US whatever the browser's locale
// (formatInput for a field: digits and a point, no grouping; formatRead for read-only text: grouped), and what it
// reads goes through parseNumber, which refuses what it cannot read unambiguously instead of guessing.
//
// createTicketPricer at the end is the ticket's pricing as a small state machine with no React in it: which answer
// lands, what BOOK may book. Everything else here is pure: the terms as the form holds them in, a plain object out.

export const DEBOUNCE_MS = 400
export const SPOT_HINT = 'snap spot to price'
// pricing/fx_exotic.py: STYLES, BARRIER_TYPES, DOUBLE_TYPES, TOUCH_TYPES
export const STYLES = ['EUROPEAN', 'AMERICAN', 'DIGITAL', 'BARRIER', 'DOUBLE_BARRIER', 'TOUCH']
export const BARRIER_TYPES = ['UP_IN', 'UP_OUT', 'DOWN_IN', 'DOWN_OUT']
export const DOUBLE_TYPES = ['KNOCK_IN', 'KNOCK_OUT']
export const TOUCH_TYPES = ['ONE_TOUCH', 'NO_TOUCH', 'DOUBLE_ONE_TOUCH', 'DOUBLE_NO_TOUCH']
// What the automatic pricing does not attempt, though the API has no rule against it: dates further out than this,
// and overrides outside these ranges. The pricers are not written for them (a discount factor that underflows, a
// tree that divides by zero), and a number half typed is the usual way to reach one. PRICE still sends them
// (the digital-asset date limit below is not one of these: the date field holds a date to it, for every path).
// The vol range, the level range and the reach in standard deviations apply to the styles priced on a tree or by a
// first-passage or survival formula (GATED_STYLES); a European or a digital is a closed form and is not held back.
export const GATED_STYLES = ['AMERICAN', 'BARRIER', 'DOUBLE_BARRIER', 'TOUCH']
export const MAX_YEARS_OUT = 50
export const MAX_NOTIONAL = 1e15
export const MAX_FUNDING_PCT = 500
export const VOL_PCT_RANGE = [2, 500]
export const LEVEL_RANGE = [0.25, 4]        // a strike or a barrier as a multiple of spot
// ... and as a number of standard deviations (σ√T) from spot, when a vol is known: further out the option is worth
// nothing or its intrinsic value, and the tree and the first-passage formula fail on it (HTTP 500, 2026-11-09).
export const MAX_SIGMAS = 40
// The standard tenors of the ticket, and the last one a digital asset is priced to: the pair's forward points and
// its vol surface both end at two years, and beyond their last tenor the API holds the points (not the rate) and
// the vol flat, so a five-year forward would be spot plus the two-year points. That is not a price.
export const TENORS = ['1W', '2W', '1M', '2M', '3M', '6M', '9M', '1Y', '18M', '2Y']
export const MAX_CRYPTO_TENOR = '2Y'
export const CRYPTO_LIMIT_NOTE = `digital assets price to ${MAX_CRYPTO_TENOR}: the forward points and the vol surface end there`

const finite = (n) => typeof n === 'number' && Number.isFinite(n)

// ── numbers in, numbers out ──────────────────────────────────────────────────────────────────────────────────
export const NOT_A_NUMBER = 'not a number: use a point for decimals'
// A number as the ticket writes it into a field: digits and a point, no grouping, the same in every browser.
export function formatInput(n, dp = 2) {
  const v = Number(n)
  return n == null || n === '' || !Number.isFinite(v) ? '' : v.toFixed(dp)
}
// A number as the ticket writes it in read-only text: grouped, en-US whatever the browser's locale. '—' for none.
export function formatRead(n, dp = 2) {
  const v = Number(n)
  return n == null || n === '' || !Number.isFinite(v) ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}
// What a typed number is: { state: 'empty' | 'ok' | 'invalid', value }.
//   digits with at most one point, and a leading minus where the field is signed;
//   a comma groups only as en-US groups: one to three digits, then commas each followed by exactly three digits,
//   before any point ("108,250.5" is 108250.5); any other comma ("1,08345", "1234,567", "1.234,5") is refused;
//   nothing else: no exponent, no second point, no letters. Spaces around the number do not count.
// A comma is how half the world writes a decimal, and "1,08" read as 108 prices and books: it is refused instead.
export function parseNumber(text, { signed = false } = {}) {
  if (typeof text === 'number') return Number.isFinite(text) && (signed || text >= 0 || Object.is(text, -0)) ? { state: 'ok', value: text } : { state: 'invalid', value: NaN }
  const raw = String(text ?? '').trim()
  if (raw === '') return { state: 'empty', value: null }
  const bad = { state: 'invalid', value: NaN }
  let body = raw.replace(/^−/, '-')
  const negative = body.startsWith('-')
  if (negative) { if (!signed) return bad; body = body.slice(1) }
  if (body.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(body)) return bad
    body = body.replace(/,/g, '')
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(body)) return bad
  const value = Number(body)
  return Number.isFinite(value) ? { state: 'ok', value: negative ? -value : value } : bad
}

// The ticket's numeric fields: what each is called in a sentence, and whether it takes a minus.
const NUMBERS = { notional: ['the notional', false], strike: ['the strike', false], spotOv: ['the spot', false], fundOv: ['the funding rate', true], volOv: ['the vol', false],
                  payout: ['the payout', false], barrier: ['the barrier', false], lowerB: ['the lower level', false], upperB: ['the upper level', false], rebate: ['the rebate', false] }
// Every numeric field of the form, read once: { given, value, invalid }. `value` is NaN for a number that cannot be read.
export function readNumbers(t) {
  const out = {}
  for (const [k, [, signed]] of Object.entries(NUMBERS)) {
    const p = parseNumber(t[k], { signed })
    out[k] = { given: p.state !== 'empty', value: p.state === 'ok' ? p.value : NaN, invalid: p.state === 'invalid' }
  }
  return out
}
// The fields this ticket sends, for its product and style: a number typed into a field that is hidden is not read.
export function numbersSent(t) {
  if (!t.option) return ['notional', 'strike', 'spotOv', ...(t.crypto ? ['fundOv'] : [])]
  const sends = styleSends(t.style, t.touchType)
  return ['notional', 'spotOv', 'volOv', ...(sends.strike ? ['strike'] : []), ...(sends.payout ? ['payout'] : []), ...(sends.barrier ? ['barrier'] : []),
          ...(sends.rebate ? ['rebate'] : []), ...(sends.levels ? ['lowerB', 'upperB'] : [])]
}
// The first number the ticket sends that cannot be read: { field, why }, or null. Nothing is priced or booked on one.
export function unreadable(t) {
  const n = readNumbers(t)
  const field = numbersSent(t).find(k => n[k].invalid)
  if (!field) return null
  const name = field === 'strike' && !t.option ? (t.crypto ? 'the price K' : 'the rate K') : NUMBERS[field][0]
  return { field, why: `${name} is ${NOT_A_NUMBER}` }
}
const positive = (n) => finite(n) && n > 0
const pad = (n) => String(n).padStart(2, '0')

// A calendar date as the API reads one (YYYY-MM-DD, a day that exists).
export function isIsoDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const utcDay = (s) => new Date(`${s}T00:00:00Z`)
const DAY_MS = 86400000

// The date a tenor gives from `today` (both ISO): weeks as days, months and years on the calendar, a day the
// month does not have running into the next month (31 January + 1M is 3 March, 29 February + 1Y is 1 March),
// as the TENOR select has always made its dates.
export function tenorDate(tenor, today) {
  const m = /^(\d+)([WMY])$/.exec(String(tenor || ''))
  if (!m || !isIsoDate(today)) return null
  const d = utcDay(today), n = Number(m[1])
  if (m[2] === 'W') d.setUTCDate(d.getUTCDate() + 7 * n)
  else if (m[2] === 'M') d.setUTCMonth(d.getUTCMonth() + n)
  else d.setUTCFullYear(d.getUTCFullYear() + n)
  return d.toISOString().slice(0, 10)
}

// The standard tenor whose date, by tenorDate, is exactly `date`; null when the date is on none of them.
export function tenorOf(date, today, tenors = TENORS) {
  if (!isIsoDate(date) || !isIsoDate(today)) return null
  return tenors.find(t => tenorDate(t, today) === date) || null
}

// What the select says for a date on no standard tenor, by actual days from today: days under 60, months
// (of 365.25/12 days) under two years, years beyond. "CUSTOM" alone for a date that is not after today.
export function tenorLabel(date, today) {
  if (!isIsoDate(date) || !isIsoDate(today)) return 'CUSTOM'
  const days = Math.round((utcDay(date) - utcDay(today)) / DAY_MS)
  if (days <= 0) return 'CUSTOM'
  if (days < 60) return `CUSTOM · ${days}D`
  if (days < 730) return `CUSTOM · ${(days / (365.25 / 12)).toFixed(1)}M`
  return `CUSTOM · ${(days / 365.25).toFixed(1)}Y`
}

// The first and the last date a settlement or an expiry may be: after today, and for a digital asset no later
// than its last tenor. null where there is no limit (a currency pair has no last date).
export function firstDate(today) {
  if (!isIsoDate(today)) return null
  return new Date(utcDay(today).getTime() + DAY_MS).toISOString().slice(0, 10)
}
export function lastDate({ crypto, today }) {
  return crypto ? tenorDate(MAX_CRYPTO_TENOR, today) : null
}

// A date typed beyond the last one, brought back to it: { date, hit }.
export function holdToLast(date, last) {
  return last && isIsoDate(date) && date > last ? { date: last, hit: true } : { date, hit: false }
}

// "Today" for the check below: the later of the browser's own date and the UTC date. The API values on its own
// clock's date (UTC where it is hosted, the machine's on a local stack), so a date that is after the later of the
// two is after the API's today wherever it runs.
export function ticketToday(now = new Date()) {
  const utc = now.toISOString().slice(0, 10)
  const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return utc > local ? utc : local
}

// Which of the form's fields a style sends. The form keeps what was typed for another style (a strike under a
// touch, a barrier under a digital), and the field is hidden, so what is hidden must not travel: a touch has no
// strike, and a leftover one moved the vol the API read off the surface (found 2026-11-09). One list, read by the
// price request and by the booked terms, so the two cannot disagree.
//   strike      the STRIKE field (blank = at the forward)
//   payout      PAYOUT and PAID IN
//   barrier     one BARRIER level              barrierType  UP/DOWN-AND-IN/OUT, or KNOCK-IN/OUT on a double
//   rebate      REBATE                         levels       LOWER and UPPER
//   touchType   TOUCH TYPE                     payAtHit     PAID AT EXPIRY / AT HIT (a one-touch only)
export function styleSends(style, touchType) {
  const double = String(touchType || '').startsWith('DOUBLE')
  const touch = style === 'TOUCH'
  return {
    strike: style !== 'TOUCH',
    payout: style === 'DIGITAL' || touch,
    barrier: style === 'BARRIER' || (touch && !double),
    barrierType: style === 'BARRIER' || style === 'DOUBLE_BARRIER',
    rebate: style === 'BARRIER',
    levels: style === 'DOUBLE_BARRIER' || (touch && double),
    touchType: touch,
    payAtHit: touch && touchType === 'ONE_TOUCH',
  }
}

// The style's own fields of an option request, as the API names them (CurrencyOptionRequest), and of the booked
// terms (the same names). The strike is not among them: the request sends it as `strike` and the record under its
// own name, both only where styleSends().strike says so.
export function styleFields(t) {
  const { style } = t
  const sends = styleSends(style, t.touchType)
  const n = readNumbers(t)
  const f = { style }
  if (sends.payout) { f.payout = n.payout.value; f.payout_currency = t.payoutCcy }
  if (sends.barrierType) f.barrier_type = style === 'DOUBLE_BARRIER' && !String(t.barrierType || '').startsWith('KNOCK') ? 'KNOCK_OUT' : t.barrierType
  if (sends.barrier) f.barrier = n.barrier.value
  if (sends.rebate && n.rebate.given) f.rebate = n.rebate.value
  if (sends.levels) { f.lower = n.lowerB.value; f.upper = n.upperB.value }
  if (sends.touchType) { f.touch_type = t.touchType; f.pay_at_hit = sends.payAtHit && !!t.payAtHit }
  return f
}

// The request that prices the ticket: { path, body }. An override is sent, a default is not: a blank strike is
// struck at the forward by the API, a blank spot is the stored spot, a blank vol is the surface's.
// (A number that cannot be read stands as NaN here; unreadable() says so first, and such a request is never sent.)
export function priceRequest(t) {
  const n = readNumbers(t)
  if (t.option) {
    const body = { pair: t.pair, option_type: t.optType, base_notional: n.notional.value, expiry_date: t.expiry, direction: t.direction,
                   settlement_type: t.cashSettled ? 'NON_DELIVERABLE' : 'DELIVERABLE', ...styleFields(t) }
    if (t.optSettle) body.settlement_date = t.optSettle
    if (n.strike.given && styleSends(t.style, t.touchType).strike) body.strike = n.strike.value
    if (n.spotOv.given) body.spot = n.spotOv.value
    if (n.volOv.given) body.vol_pct = n.volOv.value
    return { path: '/api/currency/option/price', body }
  }
  const body = { pair: t.pair, shape: t.shape, base_notional: n.notional.value, direction: t.direction }
  if (t.shape !== 'SPOT') body.settlement_date = t.settlement
  if (n.strike.given) body.forward_rate = n.strike.value
  if (n.spotOv.given) body.spot = n.spotOv.value
  if (n.fundOv.given && t.crypto) body.base_rate_pct = n.fundOv.value
  return { path: '/api/currency/forward/price', body }
}

const horizon = (today) => `${String(Number(today.slice(0, 4)) + MAX_YEARS_OUT).padStart(4, '0')}${today.slice(4)}`

// May the automatic pricing send these terms? { ok, why }: `why` is a few plain words for the ticket when it may not.
// Each test names the line of the API that answers 422 to the same terms (backend/api/routes/currencies.py as
// `currencies`, backend/pricing/*.py by file name); the last block of each product is this file's own limits.
// `unreadable: true` beside a refusal means a number on the ticket cannot be read: not even PRICE sends that.
export function priceable(t) {
  const no = (why) => ({ ok: false, why })
  const { cur, today } = t
  if (!cur || cur.pair !== t.pair) return no('loading the pairs')                                   // currencies split_pair: a pair the API lists
  if (!isIsoDate(today)) return no('no date to price on')
  const cannotRead = unreadable(t)
  if (cannotRead) return { ok: false, why: cannotRead.why, unreadable: true }
  const n = readNumbers(t)
  // spot: an override above zero (CurrencyPriceRequest.spot / CurrencyOptionRequest.spot, gt=0), else a stored one
  // (currencies _price: "No <pair> spot saved"), itself above zero (currency_forward: "spot must be positive")
  const spotGiven = n.spotOv.given
  const spot = spotGiven ? n.spotOv.value : (cur.spot == null ? NaN : Number(cur.spot))
  if (spotGiven && !positive(spot)) return no('the spot must be a number above zero')
  if (!positive(spot)) return no(SPOT_HINT)
  // base_notional gt=0 on both requests; currency_forward: "base_notional must be positive"
  const notional = n.notional.given ? n.notional.value : NaN
  if (!positive(notional)) return no('enter a notional above zero')
  if (notional > MAX_NOTIONAL) return no('the notional is too large to price as you type: press PRICE')
  // currency_forward / fx_option: "direction must be BUY or SELL"
  if (t.direction !== 'BUY' && t.direction !== 'SELL') return no('choose a direction')
  const last = horizon(today)
  // this file's own: a digital asset is not priced beyond its last tenor (see MAX_CRYPTO_TENOR)
  const cryptoLast = lastDate({ crypto: !!t.crypto, today })
  const level = (v) => positive(v) && v >= spot * LEVEL_RANGE[0] && v <= spot * LEVEL_RANGE[1]

  if (!t.option) {
    // currencies _price: "shape must be SPOT, FORWARD or NDF"
    if (!['SPOT', 'FORWARD', 'NDF'].includes(t.shape)) return no('this product is not priced here')
    if (t.shape !== 'SPOT') {
      // settlement_date is a date (CurrencyPriceRequest) after the valuation date (currency_forward:
      // "settlement_date must be after the valuation date", answered 422 by currencies _price)
      if (!isIsoDate(t.settlement)) return no('enter a settlement date')
      if (t.settlement <= today) return no('the settlement date must be after today')
      if (cryptoLast && t.settlement > cryptoLast) return no(CRYPTO_LIMIT_NOTE)
      if (t.settlement > last) return no(`the settlement date is more than ${MAX_YEARS_OUT} years out: press PRICE`)
    }
    if (t.crypto && n.fundOv.given) {
      const f = n.fundOv.value
      // currency_forward: "discount factors must be positive" (a rate large enough to take e^(−r·T) to zero)
      if (Math.abs(f) > MAX_FUNDING_PCT) return no(`a funding rate beyond ${MAX_FUNDING_PCT} % is not priced as you type: press PRICE`)
    }
    return { ok: true, why: '' }
  }

  // fx_exotic validate / fx_option: "option_type must be CALL or PUT"
  if (t.optType !== 'CALL' && t.optType !== 'PUT') return no('choose a call or a put')
  // currencies _price_option: "expiry_date must be after the valuation date" (fx_option and fx_exotic say the same)
  if (!isIsoDate(t.expiry)) return no('enter an expiry date')
  if (t.expiry <= today) return no('the expiry must be after today')
  if (cryptoLast && t.expiry > cryptoLast) return no(CRYPTO_LIMIT_NOTE)
  if (t.expiry > last) return no(`the expiry is more than ${MAX_YEARS_OUT} years out: press PRICE`)
  // currencies _price_option: "settlement_date must be on or after the expiry date" (blank: the API sets it after expiry)
  if (t.optSettle) {
    if (!isIsoDate(t.optSettle)) return no('enter a settlement date')
    if (t.optSettle < t.expiry) return no('the settlement date cannot be before the expiry')
    if (t.optSettle > last) return no(`the settlement date is more than ${MAX_YEARS_OUT} years out: press PRICE`)
  }
  // CurrencyOptionRequest.strike gt=0; fx_exotic validate / fx_option: "strike must be positive" (blank: the forward;
  // a touch has no strike and sends none)
  const strikeSent = n.strike.given && styleSends(t.style, t.touchType).strike
  if (strikeSent && !positive(n.strike.value)) return no('the strike must be above zero')
  // CurrencyOptionRequest.vol_pct gt=0; fx_option: "vol must be positive"; fx_exotic price_exotic: "... vol must be positive"
  if (n.volOv.given && !positive(n.volOv.value)) return no('the vol must be above zero')
  // fx_exotic validate: "style must be one of ..."
  if (!STYLES.includes(t.style)) return no('choose a style')
  const f = styleFields(t)
  if (t.style === 'DIGITAL' || t.style === 'TOUCH') {
    // CurrencyOptionRequest.payout gt=0; fx_exotic validate: "payout must be positive"
    if (!positive(f.payout)) return no('enter a payout above zero')
    if (f.payout > MAX_NOTIONAL) return no('the payout is too large to price as you type: press PRICE')
    if (f.payout_currency !== 'QUOTE' && f.payout_currency !== 'BASE') return no('choose the currency the payout is paid in')
  }
  if (t.style === 'BARRIER') {
    // fx_exotic validate: "a barrier option needs barrier_type (UP_IN, UP_OUT, DOWN_IN, DOWN_OUT) and a positive barrier"
    // (CurrencyOptionRequest.barrier gt=0)
    if (!BARRIER_TYPES.includes(f.barrier_type)) return no('choose a barrier type')
    if (!positive(f.barrier)) return no('enter a barrier level')
    // fx_exotic validate: "an up barrier must be above spot" / "a down barrier must be below spot"
    if (f.barrier_type.startsWith('UP') && f.barrier <= spot) return no('an up barrier must be above spot')
    if (f.barrier_type.startsWith('DOWN') && f.barrier >= spot) return no('a down barrier must be below spot')
    // CurrencyOptionRequest.rebate ge=0
    if (n.rebate.given && !(finite(f.rebate) && f.rebate >= 0)) return no('the rebate cannot be below zero')
    if (!level(f.barrier)) return no('the barrier is too far from spot to price as you type: press PRICE')
  }
  const between = () => {
    // CurrencyOptionRequest.lower / upper gt=0; fx_exotic validate: "... lower < spot < upper"
    if (!positive(f.lower) || !positive(f.upper)) return 'enter a lower and an upper level'
    if (!(f.lower < spot && spot < f.upper)) return 'spot must lie between the lower and the upper level'
    if (!level(f.lower) || !level(f.upper)) return 'the levels are too far from spot to price as you type: press PRICE'
    return ''
  }
  if (t.style === 'DOUBLE_BARRIER') {
    // fx_exotic validate: "a double barrier needs barrier_type (KNOCK_IN, KNOCK_OUT) and lower < spot < upper"
    if (!DOUBLE_TYPES.includes(f.barrier_type)) return no('choose a barrier type')
    const why = between()
    if (why) return no(why)
  }
  if (t.style === 'TOUCH') {
    // fx_exotic validate: "touch_type must be one of ..."
    if (!TOUCH_TYPES.includes(f.touch_type)) return no('choose a touch type')
    if (f.touch_type.startsWith('DOUBLE')) {
      // fx_exotic validate: "a double touch needs lower < spot < upper"
      const why = between()
      if (why) return no(why)
    } else {
      // fx_exotic validate: "a touch option needs a barrier away from spot" (CurrencyOptionRequest.barrier gt=0)
      if (!positive(f.barrier)) return no('enter a barrier level')
      if (f.barrier === spot) return no('the barrier must be away from spot')
      if (!level(f.barrier)) return no('the barrier is too far from spot to price as you type: press PRICE')
    }
  }
  // this file's own limits, for the styles priced on a tree or by a first-passage or survival formula
  if (GATED_STYLES.includes(t.style)) {
    if (strikeSent && !level(n.strike.value)) return no('the strike is too far from spot to price as you type: press PRICE')
    const sigma = n.volOv.given ? n.volOv.value / 100 : (positive(Number(t.volHint)) ? Number(t.volHint) / 100 : null)
    if (sigma != null) {
      const reach = MAX_SIGMAS * sigma * Math.sqrt(Math.max(Math.round((utcDay(t.expiry) - utcDay(today)) / DAY_MS), 1) / 365)
      const sent = [strikeSent ? n.strike.value : null, f.barrier, f.lower, f.upper].filter(v => positive(v))
      if (sent.some(v => Math.abs(Math.log(v / spot)) > reach)) return no('a level that far from spot is not priced as you type for this expiry: press PRICE')
    }
    if (n.volOv.given && (n.volOv.value < VOL_PCT_RANGE[0] || n.volOv.value > VOL_PCT_RANGE[1])) return no(`a vol outside ${VOL_PCT_RANGE[0]} to ${VOL_PCT_RANGE[1]} % is not priced as you type: press PRICE`)
  }
  return { ok: true, why: '' }
}

// A level to three significant figures: the nearest (82,222.69 → 82200, 1.1935 → 1.19), or the next one 'up' or
// 'down', for a level that has to stay on its side of spot whatever the rounding (1.0505 down → 1.05).
export function roundLevel(x, toward) {
  const n = Number(x)
  if (!positive(n)) return ''
  if (toward !== 'up' && toward !== 'down') return String(Number(n.toPrecision(3)))
  const step = 10 ** (Math.floor(Math.log10(n)) - 2)
  const k = toward === 'up' ? Math.ceil(n / step - 1e-9) : Math.floor(n / step + 1e-9)
  return String(Number((k * step).toPrecision(3)))
}

// The vol a level is seeded from when no quote has said one yet: the pair's surface at the expiry as the pairs
// answer carries it (ATM, linear in time between its tenors, flat beyond them: pricing/fx_vol.py), else the level
// the API prices at when the pair has no surface (DEFAULT_VOL_PCT there). Vol points, e.g. 55.
const TENOR_YEARS = { ON: 1 / 365, '1W': 7 / 365, '2W': 14 / 365, '3W': 21 / 365, '1M': 1 / 12, '2M': 2 / 12, '3M': 3 / 12, '4M': 4 / 12, '6M': 0.5, '9M': 0.75, '1Y': 1, '18M': 1.5, '2Y': 2, '3Y': 3, '5Y': 5 }
export const DEFAULT_VOL_PCT = { EURUSD: 7.5, GBPUSD: 8.5, AUDUSD: 10, USDJPY: 10, USDCHF: 7.5, USDCAD: 6.5 }
export const DEFAULT_VOL_FALLBACK_PCT = 10
export function surfaceAtmPct(cur, years) {
  const grid = cur?.vol_surface?.grid
  if (!grid || typeof grid !== 'object') return null
  const pts = Object.entries(grid).map(([t, row]) => [TENOR_YEARS[String(t).toUpperCase()], Number(row?.ATM)]).filter(([t, v]) => positive(t) && positive(v)).sort((x, y) => x[0] - y[0])
  if (!pts.length) return null
  const T = positive(Number(years)) ? Number(years) : 0
  if (T <= pts[0][0]) return pts[0][1]
  if (T >= pts[pts.length - 1][0]) return pts[pts.length - 1][1]
  for (let i = 1; i < pts.length; i++) {
    const [ta, va] = pts[i - 1], [tb, vb] = pts[i]
    if (T <= tb) return va + (T - ta) / (tb - ta) * (vb - va)
  }
  return pts[pts.length - 1][1]
}
export function seedVolPct({ quoteVolPct, cur, pair, years }) {
  if (positive(Number(quoteVolPct))) return Number(quoteVolPct)
  return surfaceAtmPct(cur, years) ?? DEFAULT_VOL_PCT[String(pair || '').toUpperCase()] ?? DEFAULT_VOL_FALLBACK_PCT
}
// Years from today to a date, ACT/365 as the API counts the time to expiry. null when not after today.
export function yearsTo(date, today) {
  if (!isIsoDate(date) || !isIsoDate(today)) return null
  const days = Math.round((utcDay(date) - utcDay(today)) / DAY_MS)
  return days > 0 ? days / 365 : null
}

// The levels a style is given when it is chosen, on the option's own scale. With σ the vol and T the time to
// expiry, w = σ·√T is one standard deviation of the log price at expiry: a single barrier or a touch level sits
// one w from the forward, F·e^(±w), on the side its type needs (a touch above); a double's two levels 1.5 w either
// side, F·e^(∓1.5w). (Ten per cent either side, whatever the vol and the expiry, made a three-month double
// knock-out on a 55 % vol asset worth a dollar: it was certain to knock.) Each level is kept on its side of spot,
// which is what the API checks, rounded away from it to three significant figures, and no further than the
// automatic pricing reaches. {} for a style with no level, or while the spot, the vol or the expiry is unknown.
export const SEED_SINGLE_W = 1.0
export const SEED_DOUBLE_W = 1.5
const SEED_MAX_LOG = Math.log(2.5)
export function seedLevels({ style, barrierType, touchType, spot, forward, vol, years }) {
  const S = Number(spot), sigma = Number(vol), T = Number(years)
  if (!positive(S) || !positive(sigma) || !positive(T)) return {}
  const F = positive(Number(forward)) ? Number(forward) : S
  const w = sigma * Math.sqrt(T)
  const above = (k) => { const m = Math.exp(Math.min(k * w, SEED_MAX_LOG)); return roundLevel(F * m > S ? F * m : S * m, 'up') }
  const below = (k) => { const m = Math.exp(-Math.min(k * w, SEED_MAX_LOG)); return roundLevel(F * m < S ? F * m : S * m, 'down') }
  if (style === 'BARRIER') return { barrier: String(barrierType || '').startsWith('DOWN') ? below(SEED_SINGLE_W) : above(SEED_SINGLE_W) }
  if (style === 'DOUBLE_BARRIER') return { lower: below(SEED_DOUBLE_W), upper: above(SEED_DOUBLE_W) }
  if (style === 'TOUCH') return String(touchType || '').startsWith('DOUBLE') ? { lower: below(SEED_DOUBLE_W), upper: above(SEED_DOUBLE_W) } : { barrier: above(SEED_SINGLE_W) }
  return {}
}

// The annualised basis of a forward over spot, continuous: ln(F/S)/T. null when any of the three is missing.
export function annualisedBasis(forward, spot, t) {
  const F = Number(forward), S = Number(spot), T = Number(t)
  if (forward == null || spot == null || t == null || !positive(F) || !positive(S) || !positive(T)) return null
  return Math.log(F / S) / T
}

const amount = (n, dp) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })

// The second line under the forward: how far it is from spot, in words, and what that is a year.
// { points: '1,033.63 over spot', basis: '5.5 % a year' } above spot, '12.30 pts under spot' and '−2.0 % a year'
// below it; a digital asset in the quote currency, a currency pair in forward points (pips). null before a price.
// `t` is the time the forward runs over: the forward quote's `t`, the option quote's `t_settle`.
export function forwardCaption({ forward, spot, t, crypto, pip }) {
  const F = Number(forward), S = Number(spot)
  if (forward == null || spot == null || !positive(F) || !positive(S)) return null
  const diff = crypto ? F - S : (F - S) / (positive(Number(pip)) ? Number(pip) : 1e-4)
  const under = diff < 0 && Number(Math.abs(diff).toFixed(2)) !== 0
  const points = `${amount(diff, 2)}${crypto ? '' : ' pts'} ${under ? 'under' : 'over'} spot`
  const b = annualisedBasis(F, S, t)
  const pct = b == null ? null : b * 100
  return { points, basis: pct == null ? null : `${pct < 0 && Number(Math.abs(pct).toFixed(1)) !== 0 ? '−' : ''}${amount(pct, 1)} % a year` }
}

// The line under the valuation when the price used a market input the user typed: a spot or funding override is
// stored nowhere on the trade and a vol override is not used on revaluation, so the booked trade is valued on the
// stored market from the first revaluation on. null when the ticket is on the stored market.
export function overrideNote(t) {
  const n = readNumbers(t)
  const own = [n.spotOv.given && !n.spotOv.invalid ? 'spot' : null, t.option && n.volOv.given && !n.volOv.invalid ? 'vol' : null,
               !t.option && t.crypto && n.fundOv.given && !n.fundOv.invalid ? 'funding' : null].filter(Boolean)
  if (!own.length) return null
  const list = own.length === 1 ? own[0] : `${own.slice(0, -1).join(', ')} and ${own[own.length - 1]}`
  return `Priced with your own ${list}: the booked trade is revalued on the stored market, so its value in the blotter will differ.`
}

// A quote travels with the key of the terms and market it was priced for: { quote, key }. It is the quote of the
// terms on screen only while the two keys are the same; of any other terms it is nothing.
export function quoteFor(held, key) {
  return held && held.quote && held.key != null && held.key === key ? held.quote : null
}

// what a failed price says beside the valuation: the API's own words, or a plain line when it gave none
export function failureText(e) {
  const m = String(e?.message || e || '')
  if (/^\d{3}$/.test(m)) return `the price did not come back (HTTP ${m}): press PRICE to try again`
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'the API could not be reached: press PRICE to try again'
  return m || 'the price did not come back'
}

// ── The ticket's pricing, as a state machine ─────────────────────────────────────────────────────────────────
// The panel tells it the terms on screen (setTerms, at every change), PRICE (force) and BOOK (book); it says what is
// on screen (onChange) and what the window should hold (onPriced). No React, no fetch of its own: `send(request,
// signal)` is given to it and answers with the quote or rejects with the API's words.
//
//   terms  { key, ident, ready, check, request }
//          key      the request and the market it would be priced on, as one string: the quote of these terms
//          ident    product and pair: a quote of another ident is not shown at all
//          ready    false while there is nothing to price on (the pairs have not arrived)
//          check()  priceable() of these terms: { ok, why, unreadable }
//          request  what send() is given
//   state  { quote, quoteKey, quoteIdent, pending, note, review }
//          quote/quoteKey  the last quote that came back and the key it was priced for: they travel together
//          pending         a price is owed (the debounce) or in flight
//          note            { kind: 'why' | 'error', text }: why there is no price
//          review          BOOK repriced: the figures are new, and BOOK has to be pressed again
//
// The rules it holds:
//   only the latest request's answer lands (a counter); an earlier one in flight is aborted and says nothing;
//   the automatic price is sent `debounceMs` after the last change, and only when check().ok;
//   PRICE sends whatever check() thinks, unless a number cannot be read;
//   BOOK books a quote only when it was priced for exactly the terms on screen and was already there when BOOK
//   was pressed. With a price owed it waits for it, with none it asks for one (never for terms check() refuses),
//   and either way the new figures are shown and BOOK must be pressed again.
export function createTicketPricer({ send, onChange = () => {}, onPriced = () => {}, onError = () => {}, debounceMs = DEBOUNCE_MS,
                                     setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) }) {
  let seq = 0, timer = null, ctl = null, wait = null, now = null, live = true
  let state = { quote: null, quoteKey: null, quoteIdent: null, pending: false, note: null, review: false }
  const emit = (patch) => { state = { ...state, ...patch }; if (live) onChange(state) }
  const held = () => (now && state.quote && state.quoteKey === now.key ? { quote: state.quote, key: state.quoteKey } : null)
  const owe = () => { if (!wait) { let resolve; const promise = new Promise(r => { resolve = r }); wait = { promise, resolve } } }
  const answer = () => { const w = wait; wait = null; w?.resolve(held()) }
  // whatever was owed for earlier terms is called off: its answer, if it still comes, is not the latest
  const callOff = () => { seq += 1; if (timer != null) clearTimer(timer); timer = null; ctl?.abort(); ctl = null; return seq }
  const land = (got, note, t, review = false) => {
    // the same figures again: the quote object the window and its tabs already hold is kept
    const quote = got && state.quote && JSON.stringify(got) === JSON.stringify(state.quote) ? state.quote : got
    emit({ quote, quoteKey: quote ? t.key : null, quoteIdent: quote ? t.ident : null, pending: false, note: note || null, review: review && !!quote })
    if (live) onPriced(quote)
    answer()
  }
  const dispatch = (mine, t, { review = false, report = false } = {}) => {
    const c = new AbortController(); ctl = c
    let sent
    try { sent = Promise.resolve(send(t.request, c.signal)) } catch (e) { sent = Promise.reject(e) }
    return sent.then(
      q => { if (mine !== seq) return null; land(q, null, t, review); return q },
      e => {
        if (mine !== seq || c.signal.aborted) return null
        land(null, { kind: 'error', text: failureText(e) }, t)
        if (report && live) onError(String(e?.message || e || ''))
        return null
      })
  }
  const whenSettled = () => (wait ? wait.promise : Promise.resolve(held()))

  return {
    state: () => state,
    key: () => (now ? now.key : null),
    // the quote of the terms on screen, with its key; null while it is of other terms
    held,
    // answers with held() once no price is owed or in flight
    settled: whenSettled,
    setTerms(t) {
      if (live && now && now.key === t.key && now.ident === t.ident && now.ready === t.ready) { now = t; return }
      live = true
      now = t
      const mine = callOff()
      const other = state.quote && state.quoteIdent !== t.ident          // the quote of another product or pair goes at once
      if (!t.ready) { emit({ ...(other ? { quote: null, quoteKey: null, quoteIdent: null } : {}), pending: false, review: false }); onPriced(null); answer(); return }
      owe()
      emit({ ...(other ? { quote: null, quoteKey: null, quoteIdent: null } : {}), pending: true, note: null, review: false })
      // the window keeps the last quote, marked stale, so its tabs do not empty at every keystroke
      if (state.quote) onPriced(state.quote, { stale: true }); else onPriced(null)
      timer = setTimer(() => {
        if (mine !== seq) return
        timer = null
        const check = t.check()
        if (!check.ok) { land(null, { kind: 'why', text: check.why }, t); return }
        dispatch(mine, t)
      }, debounceMs)
    },
    // PRICE: the terms as they stand, whatever check() thinks of them, unless a number on the ticket cannot be read.
    // A refusal is reported through onError as well as beside the valuation.
    force() {
      if (!now) return Promise.resolve(null)
      const t = now, mine = callOff()
      const check = t.check()
      if (check.unreadable) { land(null, { kind: 'why', text: check.why }, t); return Promise.resolve(null) }
      owe(); emit({ pending: true, note: null, review: false })
      // the quote on screen once this lands (the object already held, when the figures are the same), or, overtaken by
      // a later change of a term, whatever that change's own price comes to
      return dispatch(mine, t, { report: true }).then(() => whenSettled()).then(h => (h ? h.quote : null))
    },
    // BOOK: { action: 'book', quote, key } | { action: 'review' } | { action: 'stop', why }
    async book() {
      if (!now || !now.ready) return { action: 'stop', why: 'loading the pairs' }
      const ready = held()
      // the quote of exactly these terms, on screen before this press: booked. (A PRICE refresh of the same terms may
      // still be in flight; the quote on screen is no less the quote of these terms for that.)
      if (ready) { if (state.review) emit({ review: false }); return { action: 'book', ...ready } }
      if (!state.pending) {
        // nothing priced for these terms and nothing owed: ask once, but never for terms the check refuses
        const t = now, check = t.check()
        if (!check.ok) { emit({ note: { kind: 'why', text: check.why } }); return { action: 'stop', why: check.why } }
        const mine = callOff()
        owe(); emit({ pending: true, note: null, review: false })
        dispatch(mine, t, { review: true })
      }
      const got = await whenSettled()
      if (!got) return { action: 'stop', why: state.note?.text || 'not priced' }
      if (!state.review) emit({ review: true })
      return { action: 'review' }
    },
    // the panel is gone: nothing lands after it, and nobody is left waiting
    dispose() { live = false; callOff(); const w = wait; wait = null; w?.resolve(null) },
  }
}

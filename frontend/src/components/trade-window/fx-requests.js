// trade-window/fx-requests.js
// ────────────────────────────────────────────────────────────────────────────────────
// Which request an answer on a currency ticket's tabs belongs to, as pure functions.
//
// The ticket prices itself after every change of its terms, so a new quote lands often
// and the tabs stay mounted once visited. A request that follows the quote therefore has
// to know three things: whether its tab is the one showing, whether the quote on screen
// is still being repriced (stale), and whether it already holds the answer for exactly
// this quote. Asked blindly, an option's scenario alone is some fifteen prices on the
// server for every landed quote.
//
//   marketKey          the stored market a quote priced on: the pairs answer is read once for it
//   scenarioRoute      which of the engine's two scenario routes prices a quote: an option's, or a forward's
//   scenarioTerms      a trade's terms as that route takes them
//   scenarioRequest    one request for every figure a scenario shows: each market priced once, and only if not held
//   scenarioMerge      the answers held, by the option's terms and by market
//   scenarioRead       what a name reads: the value at its own market for these terms, or nothing
//   xvaTermsKey        the terms an XVA run takes from a quote
//   xvaResultMatches   whether a result on screen was simulated for the quote on screen
// ────────────────────────────────────────────────────────────────────────────────────

const orNull = (v) => (v === undefined ? null : v)

// The stored market a quote priced on: the pair, the vol snapshot and marks, and the forward points it names.
// A change of strike, notional or date leaves it as it is, so the pairs answer (the pair's curve and surface,
// which do not depend on the ticket) is read once per pair and again only when the quote names a later read.
// The forward's source ends with the trade's own basis against parity, which moves with the date: left out.
export function marketKey(quote) {
  if (!quote || !quote.pair) return null
  const points = typeof quote.forward_source === 'string' ? quote.forward_source.split('), basis')[0] : ''
  return [quote.pair, orNull(quote.vol_snapshot), orNull(quote.vol_marks), points].join('|')
}

// ── a trade the engine prices under a scenario ──
// An option of any style: POST /api/currency/option/scenario. A spot, forward or NDF: POST /api/currency/forward/scenario.
const isOption = (quote) => quote?.shape === 'OPTION'
export const scenarioRoute = (quote) => (isOption(quote) ? '/api/currency/option/scenario' : '/api/currency/forward/scenario')

// The trade's terms as its route takes them. An option: the style and its levels, the years to expiry the quote
// reports, and the spot it was priced at (the side of a barrier the market stands on). A forward: its side, its size
// and the rate it is struck at; null when the quote names no rate (there is then nothing to value against).
export function scenarioTerms(quote) {
  if (!quote) return null
  if (!isOption(quote)) {
    const k = quote.forward_rate
    if (!(typeof k === 'number' && Number.isFinite(k) && k > 0)) return null
    return { direction: quote.direction, base_notional: quote.base_notional, forward_rate: k }
  }
  return {
    option_type: quote.option_type, direction: quote.direction, base_notional: quote.base_notional, strike: orNull(quote.strike), t_expiry: quote.t_expiry, spot: quote.spot,
    style: quote.style, payout: orNull(quote.payout), payout_currency: quote.payout_currency || 'QUOTE', barrier_type: orNull(quote.barrier_type), barrier: orNull(quote.barrier),
    lower: orNull(quote.lower), upper: orNull(quote.upper), rebate: quote.rebate || 0, touch_type: orNull(quote.touch_type), pay_at_hit: !!quote.pay_at_hit,
  }
}

// A market as the route reads it: an option's value takes a spot, a forward, a discount factor and a vol; a forward's
// takes the forward and the discount factor alone, so two scenarios that differ only in spot or vol are one market to it.
const FIELDS = { option: ['spot', 'forward', 'df_quote', 'vol_pct'], forward: ['forward', 'df_quote'] }
const stateId = (s, fields) => fields.map(f => s[f]).join('|')
const usableState = (s, fields) => !!s && fields.every(f => typeof s[f] === 'number' && Number.isFinite(s[f]) && s[f] > 0)
export const SCENARIO_KEPT = 400      // markets whose value is kept for one option, the oldest dropped first

// One request for every figure a scenario shows. `named`: [[name, market]], a market being { spot, forward, df_quote,
// vol_pct } (fx-scenario.js shockedState). `held`: { terms, by: { market -> value } }, what the engine has already
// answered (scenarioMerge). A value belongs to the option's terms and to one market, so two names on the same market
// share one valuation, a market already answered for these terms is not asked again, and nothing answered for other
// terms is ever read. A name with no usable market is left out and reads as nothing.
//   -> { terms, index: name -> market, ids, body, key } | null when no name has a market.
//      `body` (and `key`, its text) is null when every market wanted is already held: there is nothing to ask.
export function scenarioRequest(quote, named, held = null) {
  const terms = scenarioTerms(quote)
  if (!terms || !Array.isArray(named)) return null
  const termsKey = JSON.stringify(terms)
  const have = held && held.terms === termsKey && held.by ? held.by : {}
  const fields = isOption(quote) ? FIELDS.option : FIELDS.forward
  const index = {}, ids = [], states = []
  for (const [name, s] of named) {
    if (!usableState(s, fields)) continue
    const id = stateId(s, fields)
    index[name] = id
    if (!(id in have) && !ids.includes(id)) { ids.push(id); states.push(Object.fromEntries(fields.map(f => [f, s[f]]))) }
  }
  if (!Object.keys(index).length) return null
  const body = states.length ? { ...terms, states } : null
  return { terms: termsKey, index, ids, body, key: body ? JSON.stringify(body) : null }
}

// The answers held after a request comes back: its values under the markets it asked for, beside those already held
// for the same terms. Answers for other terms are let go: they are another trade's.
export function scenarioMerge(held, req, values) {
  if (!req) return held || null
  const by = { ...(held && held.terms === req.terms ? held.by : {}) }
  req.ids.forEach((id, i) => { by[id] = (Array.isArray(values) && values[i]) || { npv: null, touched: false, error: 'the engine gave no answer for this market' } })
  const keys = Object.keys(by)
  for (const k of keys.slice(0, Math.max(0, keys.length - SCENARIO_KEPT))) delete by[k]
  return { terms: req.terms, by }
}

// What a name reads: the engine's value at that name's market for these terms, or nothing until it is back. Never a
// value answered for another market or for other terms.
//   -> { npv, touched, error } | null
export function scenarioRead(held, req, name) {
  if (!held || !req || held.terms !== req.terms || !held.by) return null
  const v = held.by[req.index?.[name]]
  if (!v) return null
  return { npv: typeof v.npv === 'number' && Number.isFinite(v.npv) ? v.npv : null, touched: v.touched === true, error: v.error || null }
}

// The terms POST /api/xva/currency and /api/xva/currency-option take from the ticket, as the quote carries
// them: the pair, the side and size, the dates, the strike, and an option's type, settlement and style fields.
// Nothing of the market (spot, forward, vol, value): a quote repriced on a moved market for the same terms is
// the same trade.
const XVA_FIELDS = ['shape', 'base_currency', 'quote_currency', 'base_notional', 'direction', 'settlement_date']
const XVA_FORWARD_FIELDS = ['forward_rate']
const XVA_OPTION_FIELDS = ['expiry_date', 'strike', 'option_type', 'settlement_type', 'style', 'payout', 'payout_currency', 'barrier_type', 'barrier',
  'lower', 'upper', 'rebate', 'touch_type', 'pay_at_hit']
export function xvaTermsKey(quote) {
  if (!quote) return null
  const fields = [...XVA_FIELDS, ...(quote.shape === 'OPTION' ? XVA_OPTION_FIELDS : XVA_FORWARD_FIELDS)]
  return JSON.stringify(fields.map(f => [f, orNull(quote[f])]))
}

// Whether a result simulated for `simulatedFor` (the xvaTermsKey of the quote at the moment SIMULATE was
// pressed) is still the quote's. A result with no record of its terms matches nothing.
export const xvaResultMatches = (simulatedFor, quote) => simulatedFor != null && simulatedFor === xvaTermsKey(quote)

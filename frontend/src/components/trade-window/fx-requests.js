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
//   scenarioTerms      an option's terms as the engine's scenario route takes them
//   scenarioRequest    one request for every figure a scenario shows, a market priced once however many names read it
//   scenarioRead       what a name reads from the answers held, and whether it answers the request on screen
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

// ── an option the engine prices under a scenario (POST /api/currency/option/scenario) ──
// The option's terms as that route takes them: the style and its levels, the years to expiry the quote reports, and
// the spot it was priced at (the side of a barrier the market stands on).
export function scenarioTerms(quote) {
  if (!quote) return null
  return {
    option_type: quote.option_type, direction: quote.direction, base_notional: quote.base_notional, strike: orNull(quote.strike), t_expiry: quote.t_expiry, spot: quote.spot,
    style: quote.style, payout: orNull(quote.payout), payout_currency: quote.payout_currency || 'QUOTE', barrier_type: orNull(quote.barrier_type), barrier: orNull(quote.barrier),
    lower: orNull(quote.lower), upper: orNull(quote.upper), rebate: quote.rebate || 0, touch_type: orNull(quote.touch_type), pay_at_hit: !!quote.pay_at_hit,
  }
}

const stateId = (s) => [s.spot, s.forward, s.df_quote, s.vol_pct].join('|')
const usableState = (s) => !!s && [s.spot, s.forward, s.df_quote, s.vol_pct].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)

// One request for every figure a scenario shows. `named`: [[name, state]], a state being { spot, forward, df_quote,
// vol_pct } (fx-scenario.js shockedState). Two names on the same market share one valuation; a name with no usable
// state is left out and reads as nothing. Returns { key, body, index: name -> place in the answer's values }, or
// null when there is nothing to ask.
export function scenarioRequest(quote, named) {
  const terms = scenarioTerms(quote)
  if (!terms || !Array.isArray(named)) return null
  const states = [], at = new Map(), index = {}
  for (const [name, s] of named) {
    if (!usableState(s)) continue
    const id = stateId(s)
    if (!at.has(id)) { at.set(id, states.length); states.push({ spot: s.spot, forward: s.forward, df_quote: s.df_quote, vol_pct: s.vol_pct }) }
    index[name] = at.get(id)
  }
  if (!states.length) return null
  const body = { ...terms, states }
  return { key: JSON.stringify(body), body, index }
}

// What a name reads from the answers held. `held`: { key, index, values } of the last answer. For the request on
// screen it is that answer's own value; while the next is on its way the last answer's value under the same name
// stays (`current: false`: the tab's chip says it is repricing); a name the last answer did not carry reads as nothing.
//   -> { npv, touched, error, current } | null
export function scenarioRead(held, key, name) {
  if (!held || !held.index || !(name in held.index)) return null
  const v = held.values?.[held.index[name]]
  if (!v) return null
  return { npv: typeof v.npv === 'number' && Number.isFinite(v.npv) ? v.npv : null, touched: v.touched === true, error: v.error || null, current: held.key === key }
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

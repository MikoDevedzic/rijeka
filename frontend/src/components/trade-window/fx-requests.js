// trade-window/fx-requests.js
// ────────────────────────────────────────────────────────────────────────────────────
// Which request an answer on a currency ticket's tabs belongs to, as pure functions.
//
// The ticket prices itself after every change of its terms, so a new quote lands often
// and the tabs stay mounted once visited. A request that follows the quote therefore has
// to know three things: whether its tab is the one showing, whether the quote on screen
// is still being repriced (stale), and whether it already holds the answer for exactly
// this quote. Asked blindly, the style ladder alone is 46 option prices on the server
// for every landed quote.
//
//   marketKey          the stored market a quote priced on: the pairs answer is read once for it
//   ladderBody / Key   the engine's ladder request for a quote, and its identity
//   ladderWanted       whether to ask for a ladder now
//   ladderShown        the ladder to draw, whether it is being replaced, and an error
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

// The body of POST /api/currency/option/ladder for a priced option: every style repriced by the engine on a
// grid of spot and vol shocks.
export function ladderBody(quote) {
  if (!quote) return null
  return {
    pair: quote.pair, option_type: quote.option_type, base_notional: quote.base_notional, expiry_date: quote.expiry_date, settlement_date: quote.settlement_date,
    strike: quote.strike, direction: quote.direction, valuation_date: quote.valuation_date, spot: quote.spot, settlement_type: quote.settlement_type,
    style: quote.style, payout: quote.payout, payout_currency: quote.payout_currency, barrier_type: quote.barrier_type, barrier: quote.barrier,
    lower: quote.lower, upper: quote.upper, rebate: quote.rebate || 0, touch_type: quote.touch_type, pay_at_hit: !!quote.pay_at_hit,
  }
}

// A ladder belongs to the request that produced it: two quotes that would send the same body share one ladder.
export const ladderKey = (quote) => (quote ? JSON.stringify(ladderBody(quote)) : null)

// Ask for a ladder only when the tab is showing, the quote is not being repriced, and neither a ladder nor a
// failure is already held for this request (a failed request is not repeated until the quote changes).
export function ladderWanted({ active, stale, key, heldKey, failedKey } = {}) {
  return !!active && !stale && key != null && key !== heldKey && key !== failedKey
}

// What the ladder's place shows. The last ladder that came back stays while the next is on its way or the quote
// is stale (`updating`); an error is shown only for the request on screen.
//   held    { key, data } of the last ladder          failed  { key, message } of the last failure
export function ladderShown({ key, held, failed, stale } = {}) {
  const error = failed && failed.key === key ? failed.message : null
  const ladder = held ? held.data : null
  return { ladder, error, updating: !!ladder && !error && (!!stale || held.key !== key) }
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

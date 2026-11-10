// trade-window/fx-package.js — a package of legs seen as one trade on the tabs that used to show the first leg
// only: the footer's totals, the CASHFLOWS tab's legs and settlement dates, and one scenario over every leg.
//
// Every figure here is a sum of what each leg's own price already carries (the engine's NPV and sensitivities,
// the leg's own forward and discount factor); nothing is priced a second way. The legs are on one pair and in one
// quote currency (the DETAILS table adds legs to the ticket's pair), so their figures add. A package is shown as
// one only when EVERY leg is priced for the terms it shows: a sum with a leg missing is not the package's.
import { daysBetween, interpPoints, reprice, settledState, shockAtTime } from './fx-scenario'
import { crybasis01 } from './fx-ticket'

const finite = (x) => typeof x === 'number' && Number.isFinite(x)
const num = (x) => (x == null || x === '' ? null : (finite(Number(x)) ? Number(x) : null))
const signOf = (q) => (q.direction === 'BUY' ? 1 : -1)

// The ticket's quote and its further legs' as one list, in the legs' order. `view` is the ticket's leg table
// (id → { quote, error, pending }). `quotes` is null unless every leg is priced; `pending` while one is on its
// way; `failed` names the legs (2, 3, ...) that could not be priced.
export function packageView(firstQuote, legs, view) {
  const further = Array.isArray(legs) ? legs : []
  if (!further.length) return null
  const each = further.map(l => view?.[l.id] || { quote: null, error: null, pending: true })
  const pending = each.some(v => v.pending)
  const failed = each.map((v, i) => (!v.pending && (v.error || !v.quote) ? i + 2 : null)).filter(Boolean)
  const all = [firstQuote || null, ...each.map(v => (v.pending || v.error ? null : v.quote || null))]
  // the figures add only on one pair, in one quote currency: a leg priced on another is not summed in
  const mixed = !!firstQuote && all.some(q => q && (q.base_currency !== firstQuote.base_currency || q.quote_currency !== firstQuote.quote_currency))
  // a leg that has fixed or settled has no forward to settle at and nothing to reprice: it is not summed as a live one
  const done = all.map((q, i) => (q && settledState(q) ? i + 1 : null)).filter(Boolean)
  return { n: further.length + 1, pending, failed, mixed, done, each: all, quotes: all.every(Boolean) && !mixed && !done.length ? all : null }
}

// What stands in a package's way, in words, or null when it is whole.
export function packageGap(pkg) {
  if (!pkg || pkg.quotes) return null
  if (pkg.failed.length) return `leg ${pkg.failed.join(', ')} could not be priced`
  if (pkg.mixed) return 'a leg is priced on another pair'
  if (pkg.done?.length) return `leg ${pkg.done.join(', ')} has fixed or settled`
  return pkg.pending ? 'a leg is being priced' : 'the ticket is being priced'
}

// One leg's risk figures under the names the footer shows, read with the same fallbacks the single-trade footer
// uses for an older answer. A figure the answer does not carry counts as nothing.
export function legRisk(q) {
  const z = (v) => num(v) ?? 0
  return {
    npv: z(q.npv),
    spot01: z(q.spot01 ?? q.delta_quote_per_pct),
    ir01: z(q.ir01 ?? q.ir01_disc ?? q.rho_quote_per_bp),                 // a digital asset's one discounting curve
    irQuote: z(q.ir01_disc ?? q.rho_quote_per_bp), irBase: z(q.ir01_base ?? q.rho_base_per_bp),   // a currency pair's two
    crybasis01: crybasis01(q) ?? 0,
    theta: z(q.theta), vega: q.shape === 'OPTION' ? z(q.vega) : 0,
  }
}

// The package's totals for the footer. `options`: 'ALL' when every leg is an option (the first figure is then the
// net premium), 'SOME' or 'NONE'.
export function packageRisk(quotes) {
  if (!Array.isArray(quotes) || !quotes.length || !quotes.every(Boolean)) return null
  const out = { npv: 0, spot01: 0, ir01: 0, irQuote: 0, irBase: 0, crybasis01: 0, theta: 0, vega: 0 }
  for (const q of quotes) { const r = legRisk(q); for (const k of Object.keys(out)) out[k] += r[k] }
  const nOpt = quotes.filter(q => q.shape === 'OPTION').length
  return { ...out, n: quotes.length, options: nOpt === quotes.length ? 'ALL' : nOpt ? 'SOME' : 'NONE' }
}

// ── CASHFLOWS ────────────────────────────────────────────────────────────────────────

// What an option pays if it fixed at today's forward, in the quote currency, from the booker's side. The same
// figure the single-trade tab shows (FxTabs CashflowsBody): a vanilla's intrinsic value, a digital's payout when
// today's forward is through the strike, nothing for a touch (its payout hangs on the path, not on a fixing).
export function payoffAtForward(q) {
  const sign = signOf(q), call = q.option_type === 'CALL'
  if (q.style === 'TOUCH') return 0
  if (q.style === 'DIGITAL') {
    const through = call ? q.forward > q.strike : q.forward < q.strike
    return through ? sign * q.payout * (q.payout_currency === 'BASE' ? q.forward : 1) : 0
  }
  return sign * q.base_notional * Math.max(call ? q.forward - q.strike : q.strike - q.forward, 0)
}

// One row for each leg: what it is, when it settles, the premium it pays or receives today (an option), what it
// would settle at today's forward, and the engine's value of it. Amounts are in the quote currency.
//   forward:  amount = ±N·(F − K), the net of its two legs at the fair forward; its present value is its NPV
//   option:   premium = ∓|NPV| on the trade date; amount = the payoff at today's forward; value = the engine's NPV,
//             which is that payoff discounted plus the time value
// `cash`: settled as one net payment (a digital asset, an NDF, a non-deliverable option); otherwise the
// principals exchange and `exchange` carries them ({ base, quote }, signed from the booker's side).
export function packageFlows(quotes, { crypto = false } = {}) {
  if (!Array.isArray(quotes) || !quotes.length || !quotes.every(Boolean)) return null
  const legs = quotes.map((q, i) => {
    const sign = signOf(q), option = q.shape === 'OPTION'
    const cash = crypto || q.shape === 'NDF' || (option && q.settlement_type === 'NON_DELIVERABLE')
    const N = Number(q.base_notional), df = Number(q.df_quote)
    if (option) {
      const amount = payoffAtForward(q)
      return { n: i + 1, option: true, cash, direction: q.direction, optionType: q.option_type, style: q.style || 'EUROPEAN', notional: N, level: num(q.strike),
        date: q.settlement_date, expiry: q.expiry_date || null, premiumDate: q.valuation_date, premium: -sign * Math.abs(Number(q.npv)),
        amount, df, pv: amount * df, npv: Number(q.npv), exchange: null }
    }
    const quoteNotional = cash ? N * Number(q.forward_rate) : Number(q.quote_notional)
    const amount = sign * N * Number(q.forward) - sign * quoteNotional
    return { n: i + 1, option: false, cash, direction: q.direction, optionType: null, style: null, notional: N, level: num(q.forward_rate),
      date: q.settlement_date, expiry: null, premiumDate: null, premium: null,
      amount, df, pv: amount * df, npv: Number(q.npv), exchange: cash ? null : { base: sign * N, quote: -sign * quoteNotional } }
  })
  const sum = (xs) => xs.reduce((a, b) => a + b, 0)
  const opts = legs.filter(l => l.option)
  // the dates on which money moves: today for the premiums, then each settlement date, earliest first
  const byDate = new Map()
  const at = (date) => { if (!byDate.has(date)) byDate.set(date, { date, premium: null, amount: null, pv: null, base: null, quote: null, legs: [] }); return byDate.get(date) }
  const add = (row, key, v) => { row[key] = (row[key] ?? 0) + v }
  for (const l of opts) { const d = at(l.premiumDate); add(d, 'premium', l.premium); if (!d.legs.includes(l.n)) d.legs.push(l.n) }
  for (const l of legs) {
    const d = at(l.date)
    add(d, 'amount', l.amount); add(d, 'pv', l.pv)
    if (l.exchange) { add(d, 'base', l.exchange.base); add(d, 'quote', l.exchange.quote) }
    if (!d.legs.includes(l.n)) d.legs.push(l.n)
  }
  const dates = [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  return {
    legs, dates,
    premium: opts.length ? sum(opts.map(l => l.premium)) : null,
    amount: sum(legs.map(l => l.amount)), pv: sum(legs.map(l => l.pv)), npv: sum(legs.map(l => l.npv)),
  }
}

// A leg in a few words: SELL 5 BTC FORWARD @ 73,550 · BUY 10 BTC CALL @ 80,000 (BARRIER)
export function legWords(l, { base = '', fmt = String, dp = 2, nDp = 0 } = {}) {
  const what = l.option ? (l.style === 'TOUCH' ? 'TOUCH' : `${l.optionType}`) : 'FORWARD'
  const style = l.option && l.style !== 'EUROPEAN' && l.style !== 'TOUCH' ? ` (${String(l.style).replace(/_/g, ' ')})` : ''
  return `${l.direction} ${fmt(l.notional, nDp)} ${base} ${what}${l.level != null ? ` @ ${fmt(l.level, dp)}` : ''}${style}`
}

// ── CURVE SCENARIO ───────────────────────────────────────────────────────────────────

// A leg the browser's closed form reprices: a forward, or a European option. Any other style is the engine's.
export const closedForm = (q) => !!q && (q.shape !== 'OPTION' || !q.style || q.style === 'EUROPEAN')

// One scenario as each leg sees it. The scenario is made on the first leg's screen: a spot shock, a flat shock on
// each rate curve and on the vol, shocks on single pillars, and moves of the forward curve's tenors. A leg that
// settles on another date reads the same curves at ITS date: the points moved at its own days from spot, each
// rate curve's pillar shocks at its own time (shockAtTime, the engine's own interpolation).
//   scenario: { spotPct, quoteBp, baseBp, volPts, pip, crypto,
//               moved: { tenor: points }, tenorDays, lag,                    the forward curve as dragged and shifted:
//                                                                            EVERY tenor of the curve, an unmoved one at 0
//                                                                            (one left out is read as not on the curve,
//                                                                            and its neighbours' moves are spread over it)
//               quotePillars, quoteOwn, basePillars, baseOwn }                the pillar shocks of each rate curve
// Null for a leg the closed form does not price, or whose settlement cannot be placed on the curve.
export function legShocks(q, s) {
  if (!closedForm(q) || !s) return null
  const T = q.shape === 'OPTION' ? q.t_settle : q.t
  const settleX = daysBetween(q.valuation_date, q.settlement_date) ?? (finite(T) ? Math.round(T * 365) : null)
  if (settleX == null || !finite(T)) return null
  const dPoints = interpPoints(s.moved, Math.max(settleX - (s.lag || 0), 0), s.tenorDays)
  if (dPoints == null) return null
  const quoteBp = (s.quoteBp || 0) + shockAtTime(s.quotePillars, s.quoteOwn, T)
  const baseBp = s.crypto ? -(s.baseBp || 0) : (s.baseBp || 0) + shockAtTime(s.basePillars, s.baseOwn, T)
  return { spotPct: s.spotPct || 0, quoteBp, baseBp, volPts: s.volPts || 0, dPoints, pip: s.pip }
}

const FACTORS = ['spotPct', 'quoteBp', 'baseBp', 'volPts', 'dPoints']

// Every leg repriced under one scenario: { npv, rows: [{ forward, npv }] }, or null when a leg cannot be.
//   only:  the shocks to keep (one factor alone), the others held at nothing
//   extra: more on top of each leg's own shocks, the same for every leg (a ladder's column)
export function repricePackage(quotes, scenario, { only = null, extra = null } = {}) {
  if (!Array.isArray(quotes) || !quotes.length) return null
  const rows = []
  let npv = 0
  for (const q of quotes) {
    const own = scenario ? legShocks(q, scenario) : (closedForm(q) ? { pip: 1 } : null)
    if (!own) return null
    const s = { pip: own.pip }
    for (const k of FACTORS) s[k] = (only && !only.includes(k) ? 0 : own[k] || 0) + (extra?.[k] || 0)
    const r = reprice(q, s)
    if (!r) return null
    rows.push(r); npv += r.npv
  }
  return { npv, rows }
}

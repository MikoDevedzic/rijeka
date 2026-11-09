// FX and digital-asset leg of the NEW TRADE window: spot / forward / NDF on a
// currency pair or a crypto forward, priced on interest-rate parity by
// /api/currency/forward/price, and a European FX option (call or put on the
// base currency) priced by /api/currency/option/price: Garman–Kohlhagen on the
// same forward, the vol from the pair's ATM/RR/BF surface. The window owns the
// counterparty, book and footer buttons; it calls price() and payload() on this
// panel through a ref.
//
// The ticket prices itself: 400 ms after the last change of a term it sends the price request, when
// fx-ticket.js says the API would take it (priceable). While that is owed the last figures stay on screen, dimmed,
// and the window is told they are stale (onPriced(quote, { stale: true })); terms that cannot be priced, or a
// failed price, leave no quote (onPriced(null)) and say why beside the valuation. PRICE in the footer is a forced
// reprice and reports its error the old way too (onError). Which answer lands and what BOOK may book is the state
// machine in fx-ticket.js (createTicketPricer); this component tells it the terms and draws what it says.
// Every number typed here is kept as typed and read by one parser (parseNumber): what cannot be read is marked
// and is never priced or booked.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { sourceShort, isVenue } from '../market-data/fx-source'
import { getSessionSafe } from '../../lib/session'
import { AnalyticsBlock } from './sections'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const CRYPTO_BASES = ['BTC', 'ETH', 'SOL']
// read-only text: en-US, grouped, whatever the browser's locale (fx-ticket.js)
const fmt = (n, d = 2) => formatRead(n, d)
const rateDp = (pair) => !pair ? 2 : CRYPTO_BASES.includes(pair.slice(0, 3)) ? 2 : pair === 'USDJPY' ? 3 : 5
const iso = (d) => d.toISOString().slice(0, 10)
import { SHAPE_OF, DELTA_LABEL } from './fx-shape'
import { settlementOptions, settlementTerms, settlementLabel, settlementNote, defaultFixingDate, clampFixingDate, earliestFixingDate, fixingCaption, MAX_FIXING_GAP_DAYS } from './fx-settlement'
import { TENORS, CRYPTO_LIMIT_NOTE, priceRequest, priceable, styleFields as styleFieldsOf, styleSends, seedLevels, seedVolPct, yearsTo, forwardCaption, ticketToday,
         tenorDate, tenorOf, tenorLabel, firstDate, lastDate, holdToLast, formatRead, formatInput, readNumbers, overrideNote, quoteFor, createTicketPricer } from './fx-ticket'
import DefaultedInput, { NumberInput } from './DefaultedInput'

async function call(path, opts = {}) {
  const session = await getSessionSafe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body?.detail ? (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)) : `${r.status}`)
  return body
}

const lbl = { fontSize: '0.75rem', letterSpacing: '0.1em', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 3, fontFamily: 'var(--mono)' }
const Fld = ({ label, flex = 1, children }) => <div style={{ flex, minWidth: 0 }}><div style={lbl}>{label}</div>{children}</div>
const Row = ({ children }) => <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>{children}</div>
// One cell of a terms row: a label that stays on one line (the whole of it in the title when it is cut short) over
// its control. Every cell of a row is built this way, so the controls of a row start on the same line.
const Cell = ({ label, sub, children }) => (
  <div className="tbw-fx-cell">
    <div className="tbw-lbl tbw-fx-lbl" title={sub ? `${label} · ${sub}` : label}>{label}{sub ? <span className="tbw-mut"> · {sub}</span> : null}</div>
    {children}
  </div>
)

const FxCryptoPanel = forwardRef(function FxCryptoPanel({ ac, inst, onPriced, onError }, ref) {
  const crypto = ac === 'CRYPTO'
  const shape = SHAPE_OF[inst] || 'FORWARD'
  const [pairs, setPairs] = useState([])
  const [feeds, setFeeds] = useState(null)
  const [pair, setPair] = useState(crypto ? 'BTCUSD' : 'EURUSD')
  const [notional, setNotional] = useState(crypto ? '10' : '10000000')       // as typed, like every number on the ticket
  const [settlement, setSettlement] = useState(() => tenorDate('3M', iso(new Date())))
  const [direction, setDirection] = useState('BUY')
  const [strike, setStrike] = useState('')
  const [spotOv, setSpotOv] = useState('')
  const [fundOv, setFundOv] = useState('')
  // What the pricer says is on screen: the last quote and the key of the terms it priced (they travel together),
  // whether a price is owed, why there is none, and whether BOOK has to be pressed again (fx-ticket.js).
  const [priced, setPriced] = useState({ quote: null, quoteKey: null, quoteIdent: null, pending: false, note: null, review: false })
  const [limitHit, setLimitHit] = useState('')            // 'settlement' | 'expiry': a typed date was brought back to the last one
  const [busy, setBusy] = useState('')
  const seedRef = useRef({})                              // the pair, and the levels this panel filled in for it
  const cbRef = useRef({ onPriced, onError })
  const [pricer] = useState(() => createTicketPricer({
    send: (request, signal) => call(request.path, { method: 'POST', body: JSON.stringify(request.body), signal }),
    onChange: setPriced,
    onPriced: (q, meta) => cbRef.current.onPriced?.(q, meta),
    onError: (m) => cbRef.current.onError?.(m),
  }))
  // option terms (shape OPTION): call or put on the base, expiry, cash or physical, a vol override
  const option = shape === 'OPTION'
  const [optType, setOptType] = useState('CALL')
  const [expiry, setExpiry] = useState(() => tenorDate('3M', iso(new Date())))
  const [optSettle, setOptSettle] = useState('')          // '' = two business days after expiry (the server fills it)
  const [cashSettled, setCashSettled] = useState(crypto)
  const [volOv, setVolOv] = useState('')
  // style (pricing/fx_exotic.py): EUROPEAN | AMERICAN | DIGITAL | BARRIER | DOUBLE_BARRIER | TOUCH
  const [style, setStyle] = useState('EUROPEAN')
  const [payout, setPayout] = useState('1000000')
  const [payoutCcy, setPayoutCcy] = useState('QUOTE')
  const [barrierType, setBarrierType] = useState('UP_OUT')
  const [barrier, setBarrier] = useState('')
  const [lowerB, setLowerB] = useState('')
  const [upperB, setUpperB] = useState('')
  const [rebate, setRebate] = useState('')
  const [touchType, setTouchType] = useState('ONE_TOUCH')
  const [payAtHit, setPayAtHit] = useState(false)
  // the settlement price source picked in SETTLES ON; '' = the pair's default. The booked valuation time is the booked source's own
  const [settleSrc, setSettleSrc] = useState('')
  // the fixing date of a digital-asset forward as the user typed it; '' = not edited, the default for the source and the settlement date
  const [fixEdit, setFixEdit] = useState('')
  // every term the price depends on, as fx-ticket.js reads them
  const ticket = { option, shape, crypto, pair, notional, direction, settlement, strike, spotOv, fundOv, optType, expiry, optSettle, cashSettled, volOv,
                   style, payout, payoutCcy, barrierType, barrier, lowerB, upperB, rebate, touchType, payAtHit }
  const styleFields = () => styleFieldsOf(ticket)
  const nums = readNumbers(ticket)                        // every number of the form, read once by the ticket's one parser
  const todayIso = iso(new Date())
  // a settlement or an expiry is after today, and on a digital asset no later than the last tenor its market data carries
  const minDate = firstDate(todayIso)
  const maxDate = lastDate({ crypto, today: todayIso })

  useEffect(() => { cbRef.current = { onPriced, onError } })
  useEffect(() => {
    setPair(crypto ? 'BTCUSD' : 'EURUSD'); setNotional(crypto ? '10' : '10000000'); setCashSettled(crypto); setPayout(crypto ? '100000' : '1000000'); setSettleSrc('')
    // a date carried over from a currency pair is held to the digital asset's last tenor
    const last = lastDate({ crypto, today: iso(new Date()) })
    setSettlement(d => holdToLast(d, last).date); setExpiry(d => holdToLast(d, last).date); setLimitHit('')
  }, [crypto])
  // an edited fixing date belongs to one product, pair and settlement date: a change of any of them puts the default back
  useEffect(() => { setFixEdit('') }, [inst, pair, settlement])
  useEffect(() => { if (style === 'DOUBLE_BARRIER') setBarrierType(b => b.startsWith('KNOCK') ? b : 'KNOCK_OUT'); if (style === 'BARRIER') setBarrierType(b => b.startsWith('KNOCK') ? 'UP_OUT' : b) }, [style])
  // a settlement date typed for one expiry does not outlive an expiry after it: blank again, the API sets it from the expiry
  useEffect(() => { setOptSettle(s => (s && s < expiry ? '' : s)) }, [expiry])

  const load = async () => {
    try { const m = await call('/api/currency/pairs'); setPairs(m.pairs || []); setFeeds(m.feeds || null) } catch (e) { onError?.(e.message) }
  }
  useEffect(() => { load() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const cur = useMemo(() => pairs.find(p => p.pair === pair), [pairs, pair])
  // the quote on screen is the last one that came back, for as long as the ticket is the product and pair it priced
  const ident = `${ac}|${inst}|${pair}`
  const quote = priced.quoteIdent === ident ? priced.quote : null
  // Digital assets only: the sources the pair settles on (absent in an older API answer: no choice, the default as before).
  // A source picked for one pair is not a source of another, so settlementTerms falls back to the new pair's default.
  const settleOptions = crypto ? settlementOptions(cur) : []
  const settle = settlementTerms(cur, crypto ? settleSrc : '', option ? 'OPTION' : 'FORWARD')
  const settleShown = settleOptions.find(s => s.source === settle.source)
  // The fixing date of a digital-asset forward (the record's valuation_date), given the date it settles: the user's own
  // date held inside its limits (tomorrow or seven days before settlement, whichever is later, to settlement), else the default for the source. Without listed sources (an older API
  // answer) there is no field and the trade fixes on its settlement date, as it always did.
  const hasFixingDate = crypto && !option && settleOptions.length > 0
  // null when no fixing date is possible (the trade settles today or earlier)
  const ownOrDefaultFixing = (settles) => (fixEdit ? clampFixingDate({ date: fixEdit, settlementDate: settles, today: todayIso }) : null)
    || defaultFixingDate({ settlementDate: settles, source: settle, today: todayIso })
  // what is booked: with no possible fixing date the settlement date goes, as before, and the API says why it refuses it
  const fixingDateFor = (settles) => hasFixingDate ? (ownOrDefaultFixing(settles) || settles) : settles
  const quoted = !!cur?.forward_curve && cur.forward_curve.in_use !== false      // the account prices on quoted points (not on IMPLIED)
  const list = pairs.filter(p => !!p.crypto === crypto)

  const snap = async () => {
    setBusy('snap')
    try { await call('/api/currency/spot/snap', { method: 'POST' }); await load() } catch (e) { onError?.(e.message) } finally { setBusy('') }
  }

  // ── pricing ─────────────────────────────────────────────────────────────────
  // the request for the terms on screen, and the market it would be priced on as the pairs answer gave it: a change
  // of either is a change of the price
  const req = priceRequest(ticket)
  const market = cur ? [cur.spot, cur.spot_as_of, cur.funding_pct, cur.funding_as_of, cur.forward_curve?.valuation_date, cur.forward_curve?.label,
                        cur.forward_curve?.in_use, cur.vol_surface?.valuation_date, cur.vol_surface?.label] : null
  const priceKey = JSON.stringify([ac, inst, req, market])
  // The terms on screen, as the pricer takes them. check() is asked when the debounce runs out (and by BOOK): the
  // API's own rules, mirrored (priceable), with the vol of the quote on screen for the reach in standard deviations.
  const termsNow = { key: priceKey, ident, ready: !!cur, request: req,
                     check: () => priceable({ ...ticket, cur, today: ticketToday(), volHint: pricer.state().quote?.vol_pct }) }
  // Priced on open and on every change of a term or of the market, 400 ms after the last one.
  useEffect(() => { pricer.setTerms(termsNow) }, [priceKey, ident])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => pricer.dispose(), [pricer])

  // The levels a style needs, on the option's own scale (fx-ticket.js seedLevels: one σ√T from the forward for a
  // single level, 1.5 either side for a double), with σ the vol the quote used, else the surface's ATM at the
  // expiry, else the pair's default level. A level this panel put there follows the style, its type, the pair,
  // the expiry and the market for as long as the user has not typed in the field; an empty field is filled when
  // the style, its type, the pair or the expiry changes, and one the user has emptied is otherwise left empty.
  // A level belongs to one pair: another pair starts from its own market, and from its own defaults.
  const seedSpot = nums.spotOv.value > 0 ? nums.spotOv.value : cur?.spot
  const seedYears = yearsTo(expiry, todayIso)
  const seedVol = seedVolPct({ quoteVolPct: quote?.shape === 'OPTION' ? quote.vol_pct : null, cur, pair, years: seedYears }) / 100
  const seedForward = quote?.shape === 'OPTION' && Number(quote.spot) === Number(seedSpot) ? quote.forward : seedSpot      // the quote's forward, when it was priced on this spot
  useEffect(() => {
    const samePair = seedRef.current.pair === pair
    // what was typed for one pair is not another pair's: its K or strike, its spot, its funding rate and its vol go
    // back to their defaults (a BTC strike left on an ETH ticket would be priced as typed)
    if (!samePair && seedRef.current.pair) { setStrike(''); setSpotOv(''); setFundOv(''); setVolOv('') }
    if (!samePair) seedRef.current = { pair }
    const terms = [option, style, barrierType, touchType, expiry].join('|')
    const termsChanged = seedRef.current.terms !== terms
    seedRef.current.terms = terms
    const want = option && cur ? seedLevels({ style, barrierType, touchType, spot: seedSpot, forward: seedForward, vol: seedVol, years: seedYears }) : {}
    const fill = (name, held, set) => {
      const value = samePair ? held : ''
      const seeded = seedRef.current[name]
      const untouched = value === seeded || (value === '' && (termsChanged || seeded === undefined))
      const next = want[name] && untouched ? want[name] : value
      if (want[name] && next === want[name]) seedRef.current[name] = next
      if (next !== held) set(next)
    }
    fill('barrier', barrier, setBarrier); fill('lower', lowerB, setLowerB); fill('upper', upperB, setUpperB)
  }, [option, style, barrierType, touchType, pair, expiry, seedSpot, seedForward, seedVol, !!cur])   // eslint-disable-line react-hooks/exhaustive-deps

  // The quote of the terms on screen: none once a term (or the market) is no longer what the last quote priced.
  // Read off the two keys at render, so what the form shows from the quote changes in the same frame as the term.
  const stale = !!quote && priced.quoteKey !== priceKey
  const live = quoteFor({ quote, key: priced.quoteKey }, priceKey)
  const repricing = priced.pending || stale
  const note = priced.note

  // The trade body from what the ticket holds. With a quote `q` and the pair loaded it is the body that is booked
  // (payload()); with neither it is the same block from the form alone, for the tabs that read the terms before
  // or between pricings (terms()): what only a quote knows is null there, and a blank strike is null.
  const build = (q) => {
    const str = (v) => v == null ? null : String(v)
    const typedStrike = nums.strike.given && !nums.strike.invalid ? nums.strike.value : null
    const N = nums.notional.value                     // the notional as a number: a quote exists only for one that could be read
    const premium = q ? String(Math.abs(Math.round(q.npv * 100) / 100)) : null
    const styleTerms = Object.fromEntries(Object.entries(styleFields()).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v]))
    const barrierTerms = style === 'BARRIER' || style === 'DOUBLE_BARRIER' || style === 'TOUCH' ? { barrier_monitoring: 'CONTINUOUS', barrier_determination_agent: null } : {}
    const sends = styleSends(style, touchType)          // the same list the price request reads (fx-ticket.js)
    if (option) {
      const K = q ? q.strike : typedStrike
      const expiryDate = q ? q.expiry_date : expiry
      const settleDate = q ? q.settlement_date : (optSettle || null)
      const premiumDate = q ? q.valuation_date : null
      const volPct = q ? q.vol_pct : (nums.volOv.given && !nums.volOv.invalid ? nums.volOv.value : null)
      const volTier = q ? q.vol_tier : null
      if (crypto) {
        // a digital-asset option: the CRYPTO_OPTION (NDO) record's fields (ISDA Digital Asset Derivatives
        // Definitions vocabulary) plus the style's terms; cash-settled against the settlement price source
        return {
          asset_class: 'CRYPTO', instrument_type: 'CRYPTO_OPTION', structure: style,
          notional: N, notional_ccy: cur?.base, maturity_date: settleDate, discount_curve_id: cur?.quote_curve,
          terms: {
            direction, digital_asset: cur?.base, notional_amount: String(N), option_type: optType,
            exercise_style: style === 'AMERICAN' ? 'AMERICAN' : 'EUROPEAN',
            ...(sends.strike ? { strike_price: str(K), strike_currency: 'USD' } : {}),
            ...styleTerms,
            ...barrierTerms,
            expiration_date: expiryDate, expiration_time: settle.time || '08:00 UTC', valuation_date: expiryDate, valuation_time: settle.time,   // one cut: the option expires at the time its settlement price is fixed
           
            settlement_date: settleDate, settlement_currency: 'USD', settlement_price_source: settle.source,
            premium_amount: premium, premium_currency: 'USD', premium_payment_date: premiumDate,
            vol_pct: volPct, vol_tier: volTier, automatic_exercise: true, calculation_agent: null,
            disruption_fallback: 'ISDA Digital Asset Derivatives Definitions fallbacks',
          },
        }
      }
      // the option's terms as the canonical record names them (chain/canonical.py, FX_OPTION):
      // buyer and seller of the option, the strike, expiry and settlement, the premium as a cash flow.
      // The trade's structure is the style, so the blotter tells a digital from a barrier.
      const ndo = cashSettled
      return {
        asset_class: 'FX', instrument_type: 'FX_OPTION', structure: style,
        notional: N, notional_ccy: cur?.base, maturity_date: settleDate, discount_curve_id: cur?.quote_curve,
        terms: {
          direction, currency_pair: pair, base_currency: cur?.base, quote_currency: cur?.quote,
          option_type: optType, exercise_style: style === 'AMERICAN' ? 'AMERICAN' : 'EUROPEAN',
          base_notional: String(N), ...(sends.strike ? { strike: str(K), quote_notional: K == null ? null : String(N * K) } : {}),
          ...styleTerms,
          ...barrierTerms,
          expiry_date: expiryDate, expiry_time: '10:00 New York', settlement_date: settleDate,
          settlement_type: ndo ? 'NON_DELIVERABLE' : 'DELIVERABLE',
          ...(ndo ? { settlement_currency: cur?.quote, fixing_source: cur?.fixing_default } : {}),
          premium_amount: premium, premium_currency: cur?.quote, premium_payment_date: premiumDate,
          vol_pct: volPct, vol_tier: volTier, automatic_exercise: true, calculation_agent: null,
        },
      }
    }
    const K = typedStrike != null ? typedStrike : (q ? q.forward : null)
    const settleDate = q ? q.settlement_date : (shape === 'SPOT' ? null : settlement)
    if (crypto) return {
      asset_class: 'CRYPTO', instrument_type: 'CRYPTO_FORWARD', structure: 'VANILLA',
      notional: N, notional_ccy: cur?.base, maturity_date: settleDate, discount_curve_id: cur?.quote_curve,
      terms: {
        digital_asset: cur?.base, notional_amount: String(N), direction, forward_price: str(K), price_currency: 'USD',
        valuation_date: fixingDateFor(settleDate), valuation_time: settle.time, settlement_date: settleDate, settlement_currency: 'USD',
        settlement_price_source: settle.source, calculation_agent: null,
        disruption_fallback: 'ISDA Digital Asset Derivatives Definitions fallbacks',
      },
    }
    const ndf = shape === 'NDF'
    return {
      asset_class: 'FX', instrument_type: inst, structure: 'VANILLA',
      notional: N, notional_ccy: cur?.base, maturity_date: settleDate, discount_curve_id: cur?.quote_curve,
      terms: {
        direction, currency_pair: pair, base_currency: cur?.base, quote_currency: cur?.quote,
        base_notional: String(N), forward_rate: str(K), value_date: settleDate,
        settlement_type: ndf ? 'NON_DELIVERABLE' : 'DELIVERABLE',
        ...(ndf ? { settlement_currency: 'USD', fixing_source: cur?.fixing_default, fixing_date: settleDate } : {}),
        calculation_agent: null,
      },
    }
  }
  // The trade POST body minus what the window owns (parties, dates, desk, book).
  // Never from the quote of other terms. Called bare it is the quote of the terms on screen; BOOK hands back the
  // quote the pricer gave it WITH the key it was priced for, and a key that is not the key of the terms now on
  // screen is refused (null): the caller says "the terms changed: reprice".
  const payload = (...held) => {
    const q = held.length ? quoteFor({ quote: held[0], key: held[1] }, priceKey) : live
    return q && cur ? build(q) : null
  }
  // The terms block of that body from whatever the form holds now, priced or not: never throws, null if it cannot be built.
  const terms = () => { try { return build(live).terms } catch { return null } }
  // The trade POST body as TradeWindow sends it, minus the parties, desk and book: what the
  // incremental XVA run values as the hypothetical trade (POST /api/xva/incremental).
  const bookBody = () => { const body = payload(); if (!body) throw new Error('Price it first'); const today = iso(new Date()); return { ...body, trade_date: today, effective_date: today } }
  // The handle is made again at every render, so it always holds the form as it is, and each call first makes sure
  // the pricer has the terms of this render (it has, unless the call comes before the effect above has run).
  //   price()    PRICE: a forced reprice; the quote, or null
  //   book()     BOOK: { action: 'book', quote, key } | { action: 'review' } | { action: 'stop', why } (fx-ticket.js)
  //   payload(quote, key)  the trade body for that quote, or null when its key is not the key of the terms on screen
  //   quote()    the quote of the terms on screen (null while stale); settled() the same, once no price is owed
  const withTerms = (fn) => (...args) => { pricer.setTerms(termsNow); return fn(...args) }
  useImperativeHandle(ref, () => ({
    price: withTerms(() => pricer.force()),
    book: withTerms(() => pricer.book()),
    settled: withTerms(() => pricer.settled().then(h => (h ? h.quote : null))),
    quote: withTerms(() => pricer.held()?.quote ?? null),
    payload, terms, bookBody, busy: () => busy,
  }))

  // ── render: the same sections, labels and cards as the rates ticket ──────────
  const dp = rateDp(pair)
  const qc = cur?.quote || 'USD'
  const SYM = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }
  const money = (v) => { if (v == null || isNaN(v)) return '—'; const n = Math.round(v); return (n > 0 ? '+' : n < 0 ? '−' : '') + (SYM[qc] ?? (qc + ' ')) + Math.abs(n).toLocaleString('en-US') }
  const sgn = (v) => v == null || isNaN(v) || Math.round(v) === 0 ? null : (v > 0 ? 'positive' : 'negative')
  const spot01 = (r) => r.spot01 ?? r.delta_quote_per_pct
  const ir01 = (r) => r.ir01 ?? (r.rho_base_per_bp + r.rho_quote_per_bp)
  const effDate = (() => { const d = new Date(); let n = crypto ? 0 : 2; while (n > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n-- } return iso(d) })()
  const ndf = shape === 'NDF'
  const pct = (v, d = 2) => v == null || isNaN(v) ? '—' : `${(Number(v) * 100).toFixed(d)}%`
  // SHOW MATH: the formula behind each card, with this quote's own numbers (the Excel replication's Derivation sheet, live)
  const mathOf = (r) => {
    const F = fmt(r.forward, dp), K = fmt(r.strike, dp), S = fmt(r.spot, dp), T = fmt(r.t_expiry, 4), sig = fmt(r.vol_pct, 2)
    const gk = r.style === 'EUROPEAN' || !r.style
    return {
      npv: gk ? `DF_${qc}·[F·N(d₁) − K·N(d₂)]·N\nd₁ = [ln(F/K) + ½σ²T]/(σ√T) = ${fmt(r.d1, 4)} · d₂ = ${fmt(r.d2, 4)}\nF ${F} · K ${K} · σ ${sig}% · T ${T}y · DF ${fmt(r.df_quote, 6)}` : `${r.method}\nF ${F} · K ${K} · σ ${sig}% · T ${T}y`,
      delta: gk ? `Φ(d₁)·DF_${qc}·F/S·N = ${fmt(r.forward_delta * 100, 1)}% · ${fmt(r.df_quote, 4)} · ${F}/${S} · N` : `[NPV(S·1.01) − NPV(S·0.99)] / (0.02·S)`,
      spot01: `NPV(F·1.01) − NPV\nthe forward moves one for one with spot; the discounting does not`,
      vega: `NPV(σ + 1pt) − NPV\nrepriced at ${fmt(r.vol_pct + 1, 2)}%`,
      ir01: crypto ? `NPV(DF_${qc}·e^(−1bp·T), F·e^(+1bp·T)) − NPV\nthe ${qc} curve alone: the forward up by the carry, DF down` : `IR01 ${qc} + IR01 ${r.base_currency}\n+1bp on each curve, repriced`,
      fund01: `NPV(F·e^(−1bp·T)) − NPV\n+1bp on the funding rate: the forward down by the carry`,
      theta: `NPV(T − 1/365) − NPV\nsame spot, curves and vol, one calendar day later`,
    }
  }
  const optionDescriptor = { analytics: {
    metrics: (r) => { const m = mathOf(r); return [
      { label: 'OPTION NPV', value: money(r.npv), colorBy: sgn(r.npv), math: m.npv },
      { label: 'DELTA', value: `${fmt(r.delta_base_units, 0)} ${r.base_currency}`, colorBy: sgn(r.delta_base_units), math: m.delta },
      { label: DELTA_LABEL(crypto), value: money(r.spot01), colorBy: sgn(r.spot01), math: m.spot01 },
      { label: 'VEGA / 1pt', value: money(r.vega), colorBy: sgn(r.vega), math: m.vega },
      { label: crypto ? 'IR01 (DISC)' : 'IR01', value: money(r.ir01), colorBy: sgn(r.ir01), math: m.ir01 },
      ...(crypto ? [{ label: 'FUND01', value: money(r.fund01 ?? r.ir01_base), colorBy: sgn(r.fund01 ?? r.ir01_base), math: m.fund01 }] : []),
      { label: 'THETA', value: money(r.theta), colorBy: sgn(r.theta), math: m.theta },
    ] },
    breakdown: (r) => ({ kind: 'market', columns: ['ITEM', 'VALUE', 'NOTE'], rows: [
      ['SPOT', fmt(r.spot, dp), r.spot_source || ''],
      ['FORWARD TO SETTLEMENT', fmt(r.forward, dp), `${r.forward_mode === 'MARKET' && r.market_points != null ? 'quoted points' : 'implied from yields'}${r.forward_source ? ' · ' + r.forward_source : ''}`],
      ['STRIKE', fmt(r.strike, dp), strike === '' ? 'at the forward' : `${fmt((r.strike / r.forward - 1) * 100, 2)}% from the forward`],
      ['VOL', `${fmt(r.vol_pct, 3)}%`, `${r.vol_tier} · ${r.vol_source}${r.vol_marks ? ' · ' + r.vol_marks : r.vol_snapshot ? ' · ' + r.vol_snapshot : ''}`],
      ...(r.forward_delta != null ? [['FORWARD DELTA', pct(r.forward_delta, 1), `d1 ${fmt(r.d1, 4)} · d2 ${fmt(r.d2, 4)} · premium-excluded`]] : []),
      ...(r.intrinsic != null ? [['INTRINSIC / TIME VALUE', `${money(r.intrinsic * r.df_quote)} / ${money(r.time_value)}`, 'on the forward, discounted']] : []),
      ...(r.style && r.style !== 'EUROPEAN' ? [['STYLE', r.style.replace('_', ' '), [r.barrier_type, r.barrier && `barrier ${fmt(r.barrier, dp)}`, r.lower && `[${fmt(r.lower, dp)}, ${fmt(r.upper, dp)}]`, r.touch_type, r.payout && `pays ${fmt(r.payout, 0)} ${r.payout_currency === 'BASE' ? r.base_currency : qc}`, r.pay_at_hit ? 'paid at hit' : null, r.rebate ? `rebate ${r.rebate}` : null].filter(Boolean).join(' · ')]] : []),
      ['GAMMA', money(r.gamma_1pct), `change in ${DELTA_LABEL(crypto)} for a further +1% spot`],
      [crypto ? `IR01 ${qc} / FUND01` : `IR01 ${qc} / ${r.base_currency}`, `${money(r.ir01_disc)} / ${money(r.ir01_base)}`, crypto ? '+1 bp on the USD curve (IR01) / on the funding rate (FUND01)' : '+1 bp on each curve'],
      [`DF ${qc}`, fmt(r.df_quote, 6), `to settlement · T_exp ${fmt(r.t_expiry, 4)}y · T_settle ${fmt(r.t_settle, 4)}y`],
      ['MODEL', r.method || 'Garman–Kohlhagen', r.model || ''],
    ] }),
  } }
  const forwardDescriptor = { analytics: {
    metrics: (r) => [
      { label: 'NET NPV', value: money(r.npv), colorBy: sgn(r.npv), math: `±N·(F − K)·DF_${qc}\nF = S·DF_${r.base_currency}/DF_${qc} = ${fmt(r.forward, dp)} · K ${fmt(r.forward_rate, dp)} · DF ${fmt(r.df_quote, 6)}` },
      { label: DELTA_LABEL(crypto), value: money(spot01(r)), colorBy: sgn(spot01(r)), math: `N·S·DF_${r.base_currency}·1%\nexact: a forward is linear in spot` },
      { label: crypto ? 'IR01 (DISC)' : 'IR01', value: money(ir01(r)), colorBy: sgn(ir01(r)), math: crypto ? `−N·K·[DF_${qc}·e^(−1bp·T) − DF_${qc}]\nthe discounting curve alone` : `IR01 ${qc} + IR01 ${r.base_currency}\n−N·K·ΔDF_${qc} + N·S·ΔDF_${r.base_currency}` },
      ...(crypto ? [{ label: 'FUND01', value: money(r.fund01 ?? r.ir01_base ?? r.rho_base_per_bp), colorBy: sgn(r.fund01 ?? r.ir01_base ?? r.rho_base_per_bp), math: `N·S·[DF_${r.base_currency}·e^(−1bp·T) − DF_${r.base_currency}]\n+1bp on the funding rate` }]
                 : [{ label: 'IR01 DISC', value: money(r.ir01_disc ?? r.rho_quote_per_bp), colorBy: sgn(r.ir01_disc ?? r.rho_quote_per_bp), math: `−N·K·[DF_${qc}·e^(−1bp·T) − DF_${qc}]\nthe ${qc} curve alone` }]),
      { label: 'THETA', value: money(r.theta), colorBy: sgn(r.theta), math: `NPV one calendar day later, same market` },
    ],
    breakdown: (r) => ({ kind: 'market', columns: ['ITEM', 'VALUE', 'NOTE'], rows: [
      ['SPOT', fmt(r.spot, dp), r.spot_source || ''],
      ['FAIR FORWARD', fmt(r.forward, dp), `${fmt(r.forward_points, crypto ? 2 : 1)} ${crypto ? qc : 'pts'} · ${r.forward_mode === 'MARKET' && r.market_points != null ? 'quoted points' : crypto ? 'implied from funding' : 'implied from yields'}${r.forward_source ? ' · ' + r.forward_source : ''}`],
      ['PARITY FORWARD', fmt(r.implied_forward, dp), r.basis_points != null ? `basis ${fmt(r.basis_points, crypto ? 2 : 1)} ${crypto ? qc : 'pts'} vs quoted` : 'no quoted points'],
      [`DF ${qc} / ${r.base_currency}`, `${fmt(r.df_quote, 5)} / ${fmt(r.df_base, 5)}`, `T = ${fmt(r.t, 4)}y · ${r.base_discounting || ''}`],
      [`ZEROS ${qc} / ${r.base_currency}`, `${fmt(r.quote_rate * 100)}% / ${fmt(r.base_rate * 100)}%`, 'continuous to T'],
      ['IMPLIED CARRY', `${fmt(r.implied_carry * 100)}%`, 'annualised'],
      [crypto ? 'FUND01' : `IR01 BASE (${r.base_currency})`, money(r.ir01_base ?? r.rho_base_per_bp), crypto ? '+1 bp on the funding rate' : `+1 bp on the ${r.base_currency} curve`],
      ['MODEL', crypto ? 'F = S·e^(−r·T) / DF_quote' : 'F = S·DF_base / DF_quote', `NPV = ±N·(F − K)·DF_quote · ACT/365 · ${ndf || crypto ? 'cash-settled' : 'deliverable'}`],
    ] }),
  } }
  const descriptor = option ? optionDescriptor : forwardDescriptor
  // SETTLES ON: the settlement price source of a digital-asset trade, on its own row under the terms grid (the
  // six columns are taken, and a long source name must not widen the ticket), with the forward's FIXING DATE and
  // the note beside it; the row wraps before it would widen the ticket. One of the two terms sections renders it,
  // never both: the forward section stays mounted, hidden, under an option.
  const settlesShown = live?.settlement_date || settlement          // the form's own date while a price is owed: the fixing date follows at once
  const fixingShown = hasFixingDate ? ownOrDefaultFixing(settlesShown) : null
  const settlesOn = settleOptions.length > 0 && (
    <div className="tbw-fx-row" data-fx-row="settles-on" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start', marginTop: 10 }}>
      <div className="tbw-fx-cell" style={{ flex: '0 1 300px' }}>
        <div className="tbw-lbl tbw-fx-lbl">SETTLES ON</div>
        <select data-testid="settles-on" value={settle.source} onChange={e => setSettleSrc(e.target.value)}>
          {settleOptions.map(s => <option key={s.source} value={s.source}>{settlementLabel(s)}</option>)}
        </select>
      </div>
      {hasFixingDate && (
        <div className="tbw-fx-cell" style={{ flex: '0 1 150px' }}>
          <div className="tbw-lbl tbw-fx-lbl">FIXING DATE</div>
          {/* bound to the date that will be booked: a typed date is held inside its limits as it is typed, and again on blur */}
          <input type="date" data-testid="fixing-date" value={fixingShown || ''} min={earliestFixingDate({ settlementDate: settlesShown, today: todayIso }) || undefined} max={settlesShown || undefined}
                 title={`at most ${MAX_FIXING_GAP_DAYS} days before the settlement date`}
                 onChange={e => setFixEdit(clampFixingDate({ date: e.target.value, settlementDate: settlesShown, today: todayIso }) || '')}
                 onBlur={() => { if (fixEdit) setFixEdit(clampFixingDate({ date: fixEdit, settlementDate: settlesShown, today: todayIso }) || '') }} />
        </div>
      )}
      <div className="tbw-mut" style={{ flex: '1 1 240px', minWidth: 0, paddingTop: 22, lineHeight: 1.5 }}>
        <div>{settlementNote(settleShown)}</div>
        <div>{fixingCaption(option ? { product: 'OPTION', expiryDate: live?.expiry_date || expiry, time: settle.time }
                                   : { product: 'FORWARD', fixingDate: fixingShown, settlementDate: settlesShown, time: settle.time })}</div>
      </div>
    </div>
  )

  // ── the fields that show their default, the forward, the tenor ──────────────
  const dim = repricing && !!quote               // a price is owed: what the last quote says is shown dimmed
  // into a field: digits and a point, no grouping, the same in every browser (what is typed back is read by the same rule)
  const rate = (n) => formatInput(n, dp)
  const two = (n) => formatInput(n, 2)
  const base = cur?.base || 'base'
  const perUnit = `${qc} per ${base}`
  // SPOT: the stored spot as the field's value, and its own action at the end of the line under it
  const snapButton = (testId) => (
    <span className="tbw-fx-snap-wrap">·
      <button type="button" className="tbw-fx-snap" aria-label="Snap spot from the public feed" title={`Snap spot from ${crypto ? (feeds?.crypto || 'the public feed') : (feeds?.fx || 'the public feed')}`}
              data-testid={testId} onClick={snap} disabled={!!busy}>{busy === 'snap' ? 'snapping…' : '↻ snap'}</button>
    </span>
  )
  const spotField = (shown) => (
    <Cell label="SPOT" sub={perUnit}>
      <DefaultedInput testId={shown ? 'fx-spot' : undefined} value={spotOv} onChange={setSpotOv} fallback={cur?.spot} format={rate}
                      tag={cur?.spot != null ? `stored spot · ${cur.spot_as_of || 'no date'}` : 'not snapped'} action={snapButton(shown ? 'fx-snap' : undefined)} />
    </Cell>
  )
  // The fair forward of the latest quote, first in the terms row: to the settlement date on a forward, to the
  // option's own settlement on an option, with how far it is from spot and what that is a year (ln(F/S)/T, T the
  // time the forward runs over: the forward quote's t, the option quote's t_settle).
  const fwdTenor = shape === 'SPOT' ? null : tenorOf(settlement, todayIso)
  const expTenor = tenorOf(expiry, todayIso)
  const forwardWhen = option ? `to ${quote?.settlement_date || optSettle || 'settlement'}` : shape === 'SPOT' ? (live?.settlement_date || 'spot date') : (fwdTenor || settlement)
  const fwdYears = quote ? (quote.shape === 'OPTION' ? (quote.t_settle ?? quote.t) : quote.t) : null
  const fwdLine = quote ? forwardCaption({ forward: quote.forward, spot: quote.spot, t: fwdYears, crypto, pip: cur?.pip }) : null
  const fwdEmpty = option ? 'to settlement, once priced' : 'the fair forward, once priced'
  const forwardCell = (shown) => (
    <Cell label="FORWARD" sub={forwardWhen}>
      <div className={`tbw-mono tbw-fx-fwd${dim ? ' tbw-fx-dim' : ''}${quote ? '' : ' is-empty'}`} data-testid={shown ? 'fx-forward-rate' : undefined} data-value={quote?.forward ?? ''}
           title={quote?.forward_source || undefined}>{quote ? fmt(quote.forward, dp) : '—'}</div>
      <div className={`tbw-fx-tag tbw-fx-tag-wrap${dim ? ' tbw-fx-dim' : ''}`}>
        {fwdLine ? (<><span>{fwdLine.points}</span>{fwdLine.basis && <span>· {fwdLine.basis}</span>}</>) : <span>{fwdEmpty}</span>}
      </div>
    </Cell>
  )
  // The tenor says what the date is: the standard tenor the date falls on, or CUSTOM with its length when it falls
  // on none. Choosing a tenor sets the date; typing a date moves the tenor.
  const tenorSelect = (date, tenor, setDate, label) => (
    <select data-testid="fx-tenor" aria-label={label} value={tenor || 'CUSTOM'} onChange={e => { if (TENORS.includes(e.target.value)) setDate(tenorDate(e.target.value, todayIso)) }}>
      {TENORS.map(t => <option key={t} value={t}>{t}</option>)}
      {!tenor && <option value="CUSTOM">{tenorLabel(date, todayIso)}</option>}
    </select>
  )
  const setSettlementDate = (d) => { setSettlement(d); setLimitHit(h => (h === 'settlement' ? '' : h)) }
  const setExpiryDate = (d) => { setExpiry(d); setLimitHit(h => (h === 'expiry' ? '' : h)) }
  // a date typed beyond the last one is brought back to it when the field is left, and the ticket says so once
  const holdDate = (which, date, setDate) => { const held = holdToLast(date, maxDate); if (held.hit) { setDate(held.date); setLimitHit(which) } }
  const limitNote = (which) => limitHit === which && <div className="tbw-fx-limit" data-testid="fx-tenor-limit">{CRYPTO_LIMIT_NOTE}</div>
  // VOL %: where the vol on its default comes from, in the pair's own words (the venue and the time of its marks,
  // or the source and date of the surface), with the full sentence in the title
  const volTag = (quote?.shape === 'OPTION' && quote.vol_tier === 'DEFAULT') || !cur?.vol_surface ? 'default level'
    : isVenue(cur.vol_surface) ? cur.vol_surface.label : `${sourceShort(cur.vol_surface)} surface ${cur.vol_surface.valuation_date}`
  const volTitle = (quote?.shape === 'OPTION' && quote.vol_source) || cur?.vol_surface?.source || 'no surface for this pair: the desk default level'
  // FUNDING %: on quoted points the rate is the one the forward implies, and a typed rate replaces the quoted forward
  const fundTag = (quote && quote.shape !== 'OPTION' ? quote.forward_mode === 'MARKET' && quote.market_points != null : quoted) ? 'implied by the forward' : cur?.funding_pct != null ? 'saved rate' : 'default rate'
  const ownInputs = overrideNote(ticket)
  const fundTitle = quoted ? 'A rate typed here overrides the quoted forward: the forward is then spot carried at this rate' : cur?.funding_pct != null ? `${cur.funding_pct}% saved for ${base}` : `no rate saved for ${base}: 0%`

  return (
    <>
      <div className="tbw-sec">
        <div className="tbw-lbl">PRIMARY ECONOMICS</div>
        <div className={`tbw-fx-row ${option ? 'tbw-fx-grid-expiry' : 'tbw-fx-grid-6'}`} data-fx-row="primary">
          <Cell label="PAIR">
            <select value={pair} onChange={e => { setPair(e.target.value); setSettleSrc('') }}>
              {list.map(p => <option key={p.pair} value={p.pair}>{p.pair}</option>)}
            </select>
          </Cell>
          <Cell label="NOTIONAL" sub={cur?.base || 'BASE'}>
            {/* as typed; a large amount is read back grouped under the field, where a slip of a digit shows */}
            <NumberInput testId="fx-notional" value={notional} onChange={setNotional} placeholder={crypto ? '10' : '10000000'}
                         tag={nums.notional.value >= 10000 ? `${nums.notional.value.toLocaleString('en-US', { maximumFractionDigits: 8 })} ${cur?.base || ''}` : null} />
          </Cell>
          {/* what is bought or sold is in the label (SIDE of the option, DIRECTION in the base currency) and in each
              button's name; the buttons themselves are two short words that stay on one line at any width */}
          <Cell label={option ? 'SIDE' : 'DIRECTION'} sub={option ? undefined : (cur?.base || undefined)}>
            <div className="tbw-chip-row tbw-fx-chips">
              {['BUY', 'SELL'].map(d => (
                <button key={d} className={`tbw-chip ${direction === d ? 'is-on' : ''}`} aria-label={`${d === 'BUY' ? 'Buy' : 'Sell'} ${option ? 'option' : (cur?.base || 'base')}`}
                        onClick={() => setDirection(d)}>{d}</button>
              ))}
            </div>
          </Cell>
          {option ? (
            <Cell label="TYPE" sub={`on ${base}`}>
              <div className="tbw-chip-row tbw-fx-chips">
                {['CALL', 'PUT'].map(d => (
                  <button key={d} className={`tbw-chip ${optType === d ? 'is-on' : ''}`} onClick={() => setOptType(d)}>{d}</button>
                ))}
              </div>
            </Cell>
          ) : (
            <Cell label="TENOR">
              {shape === 'SPOT'
                ? <select data-testid="fx-tenor" value="SPOT" disabled onChange={() => {}}><option value="SPOT">SPOT</option></select>
                : tenorSelect(settlement, fwdTenor, setSettlementDate, 'Tenor')}
            </Cell>
          )}
          {option ? (
            <Cell label="EXPIRY" sub={crypto ? (settle.time || '08:00 UTC') : '10:00 NY'}>
              <div className="tbw-fx-pick">
                {tenorSelect(expiry, expTenor, setExpiryDate, 'Expiry tenor')}
                <input type="date" data-testid="fx-expiry" value={expiry} min={minDate || undefined} max={maxDate || undefined}
                       onChange={e => setExpiryDate(e.target.value)} onBlur={() => holdDate('expiry', expiry, setExpiry)} />
              </div>
              {limitNote('expiry')}
            </Cell>
          ) : (
            <Cell label="EFF DATE" sub={crypto ? 'T+0' : 'SPOT T+2'}>
              <input type="date" value={effDate} readOnly />
            </Cell>
          )}
          {option ? (
            <Cell label="SETTLEMENT">
              <input type="date" value={optSettle || live?.settlement_date || ''} min={expiry || undefined} onChange={e => setOptSettle(e.target.value)} />
              <div className="tbw-fx-tag tbw-fx-tag-free" title="Leave the date blank and the settlement date is set from the expiry"><span>{crypto ? 'blank = expiry + 1 day' : 'blank = expiry + 2 business days'}</span></div>
            </Cell>
          ) : (
            <Cell label="MAT DATE" sub={shape === 'SPOT' ? 'VALUE' : ndf || crypto ? 'SETTLEMENT' : 'VALUE'}>
              <input type="date" data-testid="fx-maturity" value={shape === 'SPOT' ? (live?.settlement_date || effDate) : settlement} disabled={shape === 'SPOT'}
                     min={shape === 'SPOT' ? undefined : minDate || undefined} max={shape === 'SPOT' ? undefined : maxDate || undefined}
                     onChange={e => setSettlementDate(e.target.value)} onBlur={() => { if (shape !== 'SPOT') holdDate('settlement', settlement, setSettlement) }} />
              {limitNote('settlement')}
            </Cell>
          )}
        </div>
      </div>

      {option && (
        <div className="tbw-sec">
          <div className="tbw-terms-header">
            <span className="tbw-lbl">OPTION TERMS</span>
            <span className="tbw-helper-badge">→ {direction === 'BUY' ? 'we hold' : 'we write'} the right to {optType === 'CALL' ? 'buy' : 'sell'} {cur?.base || 'base'} against {qc} · {cashSettled ? `cash-settled in ${qc}${crypto ? ' against ' + (settle.source || 'the settlement price source') : ''}` : 'deliverable'}</span>
          </div>
          <div className="tbw-chip-row" style={{ gap: 4, marginBottom: 10 }}>
            {[['EUROPEAN', 'EUROPEAN'], ['AMERICAN', 'AMERICAN'], ['DIGITAL', 'DIGITAL'], ['BARRIER', 'BARRIER'], ['DOUBLE_BARRIER', 'DOUBLE BARRIER'], ['TOUCH', 'TOUCH']].map(([k, l]) => (
              <button key={k} className={`tbw-chip ${style === k ? 'is-on' : ''}`} onClick={() => setStyle(k)}>{l}</button>
            ))}
          </div>
          {style !== 'EUROPEAN' && style !== 'AMERICAN' && (
            <div className="tbw-fx-row tbw-fx-grid-6" data-fx-row="style" style={{ marginBottom: 10 }}>
              {(style === 'DIGITAL' || style === 'TOUCH') && (<>
                <Cell label="PAYOUT">
                  <NumberInput testId="fx-payout" value={payout} onChange={setPayout} />
                </Cell>
                <Cell label="PAID IN">
                  <div className="tbw-chip-row tbw-fx-chips">
                    <button className={`tbw-chip ${payoutCcy === 'QUOTE' ? 'is-on' : ''}`} onClick={() => setPayoutCcy('QUOTE')}>{qc}</button>
                    <button className={`tbw-chip ${payoutCcy === 'BASE' ? 'is-on' : ''}`} onClick={() => setPayoutCcy('BASE')}>{cur?.base || 'BASE'}</button>
                  </div>
                </Cell>
              </>)}
              {style === 'BARRIER' && (<>
                <Cell label="BARRIER TYPE">
                  <select value={barrierType} onChange={e => setBarrierType(e.target.value)}>
                    {['UP_OUT', 'UP_IN', 'DOWN_OUT', 'DOWN_IN'].map(b => <option key={b} value={b}>{b.replace('_', '-AND-')}</option>)}
                  </select>
                </Cell>
                <Cell label="BARRIER" sub={perUnit}>
                  <NumberInput testId="fx-barrier" value={barrier} onChange={setBarrier} placeholder="level" />
                </Cell>
                <Cell label="REBATE" sub={perUnit}>
                  <NumberInput testId="fx-rebate" value={rebate} onChange={setRebate} placeholder="0" />
                </Cell>
              </>)}
              {style === 'DOUBLE_BARRIER' && (
                <Cell label="BARRIER TYPE">
                  <select value={barrierType} onChange={e => setBarrierType(e.target.value)}>
                    {['KNOCK_OUT', 'KNOCK_IN'].map(b => <option key={b} value={b}>{b.replace('_', '-')}</option>)}
                  </select>
                </Cell>
              )}
              {style === 'TOUCH' && (<>
                <Cell label="TOUCH TYPE">
                  <select value={touchType} onChange={e => setTouchType(e.target.value)}>
                    {['ONE_TOUCH', 'NO_TOUCH', 'DOUBLE_ONE_TOUCH', 'DOUBLE_NO_TOUCH'].map(b => <option key={b} value={b}>{b.replace(/_/g, ' ')}</option>)}
                  </select>
                </Cell>
                {touchType === 'ONE_TOUCH' && (
                  <Cell label="PAID">
                    <div className="tbw-chip-row tbw-fx-chips">
                      <button className={`tbw-chip ${!payAtHit ? 'is-on' : ''}`} onClick={() => setPayAtHit(false)}>AT EXPIRY</button>
                      <button className={`tbw-chip ${payAtHit ? 'is-on' : ''}`} onClick={() => setPayAtHit(true)}>AT HIT</button>
                    </div>
                  </Cell>
                )}
              </>)}
              {((style === 'TOUCH' && !touchType.startsWith('DOUBLE'))) && (
                <Cell label="BARRIER" sub={perUnit}>
                  <NumberInput testId="fx-barrier" value={barrier} onChange={setBarrier} placeholder="level" />
                </Cell>
              )}
              {(style === 'DOUBLE_BARRIER' || (style === 'TOUCH' && touchType.startsWith('DOUBLE'))) && (<>
                <Cell label="LOWER" sub={perUnit}>
                  <NumberInput testId="fx-lower" value={lowerB} onChange={setLowerB} placeholder="below spot" />
                </Cell>
                <Cell label="UPPER" sub={perUnit}>
                  <NumberInput testId="fx-upper" value={upperB} onChange={setUpperB} placeholder="above spot" />
                </Cell>
              </>)}
            </div>
          )}
          <div className="tbw-fx-row tbw-fx-grid-6" data-fx-row="option-terms">
            {forwardCell(true)}
            {style !== 'TOUCH' && (
              <Cell label="STRIKE" sub={perUnit}>
                {/* on its default the strike is the forward of the latest quote: the API strikes a blank one there, and again when the market moves */}
                <DefaultedInput testId="fx-strike" value={strike} onChange={setStrike} fallback={quote?.forward} format={rate} tag="at the forward" dim={dim} />
              </Cell>
            )}
            <Cell label="VOL %">
              {/* the vol the latest quote read off the surface; a quote priced on an override has no default to show until it is repriced */}
              <DefaultedInput testId="fx-vol" value={volOv} onChange={setVolOv} format={two} dim={dim} title={volTitle} tag={volTag}
                              fallback={quote && quote.shape === 'OPTION' && quote.vol_tier !== 'OVERRIDE' ? quote.vol_pct : null} />
            </Cell>
            <Cell label="SETTLEMENT">
              <div className="tbw-chip-row tbw-fx-chips">
                {!crypto && <button className={`tbw-chip ${!cashSettled ? 'is-on' : ''}`} onClick={() => setCashSettled(false)}>DELIVER</button>}
                <button className={`tbw-chip ${cashSettled ? 'is-on' : ''}`} onClick={() => setCashSettled(true)}>{crypto ? `CASH ${qc} · NDO` : `CASH ${qc}`}</button>
              </div>
            </Cell>
            {spotField(true)}
            <Cell label={`${qc} DISCOUNTING`}>
              <input className="tbw-mono" value={cur?.quote_curve || '—'} readOnly />
            </Cell>
          </div>
          {settlesOn}
          <div className="tbw-helper-text" style={{ marginTop: 10 }}>
            {style === 'EUROPEAN' ? (crypto ? (quoted ? 'Black-76 on the quoted forward' : 'Black-76, the funding rate as the carry') : 'Garman–Kohlhagen') : style === 'AMERICAN' ? 'Leisen–Reimer binomial tree, early exercise at every node' : style === 'DIGITAL' ? 'Reiner–Rubinstein cash-or-nothing / asset-or-nothing' : style === 'TOUCH' ? 'first-passage and survival probabilities, continuous monitoring' : 'survival-density integral, continuous monitoring'} on the forward to settlement · σ from the pair's ATM / 25Δ RR / 25Δ BF surface at the strike (Market data › FX › Volatility) · premium in {qc} on the trade date · ACT/365
          </div>
        </div>
      )}

      <div className="tbw-sec" style={option ? { display: 'none' } : undefined}>
        <div className="tbw-terms-header">
          <span className="tbw-lbl">FORWARD TERMS</span>
          <span className="tbw-helper-badge">→ {crypto ? `cash-settled in ${qc} · ${quoted ? `forward from ${cur.forward_curve.label || 'quoted points'}` : 'funding is a desk input'}` : ndf ? `non-deliverable · cash-settled in ${qc}` : shape === 'SPOT' ? 'spot · T+2 delivery' : 'deliverable · both principals exchange'}</span>
        </div>
        {/* five cells on the six columns the rows above use, so the columns of the ticket line up */}
        <div className="tbw-fx-row tbw-fx-grid-6" data-fx-row="forward-terms">
          {forwardCell(!option)}
          <Cell label={crypto ? 'PRICE K' : 'RATE K'} sub={perUnit}>
            {/* on its default K is the fair forward of the latest quote: a blank K is struck there by the API, and again when the market moves */}
            <DefaultedInput testId={option ? undefined : 'fx-strike'} value={strike} onChange={setStrike} fallback={quote?.forward} format={rate} tag="fair forward" dim={dim} />
          </Cell>
          {spotField(!option)}
          {crypto ? (
            <Cell label={`${cur?.base || 'ASSET'} FUNDING %`}>
              {/* the funding rate the latest quote used: the base zero the quoted forward implies, or the saved rate (the quote's own number, base_rate) */}
              <DefaultedInput testId={option ? undefined : 'fx-funding'} value={fundOv} onChange={setFundOv} signed format={two} dim={dim} title={fundTitle} tag={fundTag}
                              fallback={quote && quote.base_rate != null && quote.base_discounting !== 'request' ? quote.base_rate * 100 : null} />
            </Cell>
          ) : (
            <Cell label={`${cur?.base || 'BASE'} DISCOUNTING`}>
              <input className="tbw-mono" value={cur?.base_curve_available ? cur.base_curve : `${cur?.base_fallback || 'flat policy rate'}`} readOnly style={{ color: cur?.base_curve_available ? 'var(--text)' : 'var(--amber)' }} />
            </Cell>
          )}
          <Cell label={`${qc} DISCOUNTING`}>
            <input className="tbw-mono" value={cur?.quote_curve || '—'} readOnly />
          </Cell>
        </div>
        {!option && settlesOn}
        <div className="tbw-helper-text" style={{ marginTop: 10 }}>
          {crypto ? `Spot: ${feeds?.crypto || 'Coinbase (public)'}` : `Spot: ${feeds?.fx || 'ECB reference rates (public)'}`} · F = S·DF<sub>base</sub>/DF<sub>quote</sub> or S + quoted points · NPV = ±N·(F − K)·DF<sub>quote</sub> · ACT/365
        </div>
      </div>

      {/* The valuation: the last figures stay while the next price is owed, dimmed, with a marker; a price that
          cannot be had says why here, not in the window's title or on BOOK. */}
      <div className="tbw-fx-valuation">
        {repricing && <div className="tbw-fx-status" data-testid="fx-pricing" role="status">pricing…</div>}
        {!repricing && note && (
          <div className={`tbw-fx-note${note.kind === 'error' ? ' is-error' : ''}`} data-testid={note.kind === 'error' ? 'fx-price-error' : 'fx-price-why'} role={note.kind === 'error' ? 'alert' : 'status'}>
            {note.kind === 'error' ? `Not priced: ${note.text}` : note.text}
          </div>
        )}
        {/* BOOK repriced (or waited for a price that was owed): the figures are new, so it does not book in the same press */}
        {!repricing && priced.review && live && (
          <div className="tbw-fx-note" data-testid="fx-book-repriced" role="status">repriced: check the value and press BOOK again</div>
        )}
        {/* a market input of the user's own is not kept on the trade: the blotter will value it on the stored market */}
        {ownInputs && <div className="tbw-fx-note is-warning" data-testid="fx-override-note" role="note">{ownInputs}</div>}
        <div className={dim ? 'tbw-fx-dim' : undefined}>
          <AnalyticsBlock descriptor={descriptor} result={quote ? { ...quote, curve_id: cur?.quote_curve } : null} pricing={repricing} />
        </div>
      </div>
    </>
  )
})

export default FxCryptoPanel

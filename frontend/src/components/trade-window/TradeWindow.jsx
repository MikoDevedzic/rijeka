// trade-window/TradeWindow.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Unified renderer. Iterates sections in a fixed order, delegating each to
// the active product's descriptor. Never branches on product key — all
// product-specific logic lives in the descriptor.
//
// State owned HERE:
//   - selectedAssetClass     (default 'RATES')
//   - selectedProductKey     (default 'IR_SWAP')
//   - structure              (default from descriptor.defaultStructure)
//   - direction              ('PAY' or 'RECEIVE')
//   - common economics       (notional, ccy, tenor, eff/mat date, etc.)
//   - product-specific state (delegated — descriptor's Component owns its own)
//   - pricing result         (keyed by productKey so switching products keeps last result)
//   - pricing flags          (pricing, error)
//
// State NOT owned here:
//   - Product-specific terms — each Component owns its local input state and
//     passes it back via onChange. Keeps migration simple.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react'
import './styles.css'

import { getProduct, listProductsByAssetClass, listAssetClasses } from './registry'

import {
  TabBar,
  InstrumentSelector,
  CounterpartyBlock,
  PrimaryEconomics,
  ProductTerms,
  OptionFeeBlock,
  AnalyticsBlock,
  XVASummary,
  TradeFooter,
  CashflowsPanel,
} from './sections'
import DetailsPanel from './details-panel'
import XvaPanel      from './xva-panel'
import ScenarioPanel from './scenario-panel'
// Sprint 12 item 3: CONFIRM tab panel + lifecycle client
import { ConfirmPanel } from './ConfirmPanel'
import { executeBooking, buildBookingBody, confirmTrade, cancelTrade, confirmTradeOnChain, bookPackage, confirmPackageOnChain, getAttestation, verifyTradeOnChain, getProofPack, terminateOnChain, INDEX_CURVE } from './booking'
import { TENOR_Y, EXPIRY_Y } from './product-defaults'
// Sprint 13 follow-up — lifecycle cache refresh
import { useTradesStore, shortUti } from '../../store/useTradesStore'
import { useTabStore }    from '../../store/useTabStore'

// Import all product modules to register them at load time.
// Adding FX/credit = add one import line here.
import './products/rates'
import useMarketDataStore from '../../store/useMarketDataStore'
import { getSessionMaybe } from '../../lib/session'
import FxCryptoPanel from './FxCryptoPanel'
import { SHAPE_OF, DELTA_LABEL } from './fx-shape'
import FxXvaPanel from './FxXvaPanel'
import CapitalTab from './CapitalTab'
import { FxDetailsPanel, FxCashflowsPanel, FxScenarioPanel } from './FxTabs'
import { packageGap, packageRisk, packageView } from './fx-package'
import FxLegs from './FxLegs'
import { LEG_TERMS, structureOf, packageOf } from './fx-legs'

const NO_LEGS = []          // one empty list, so "no legs" is the same value at every render
// import './products/credit'
// import './products/equity'
// import './products/commodity'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

// Currency → curve ID mapping. Mirrors legacy TradeBookingWindow.CCY_CURVE.
const CCY_CURVE = {
  USD: 'USD_SOFR', EUR: 'EUR_ESTR', GBP: 'GBP_SONIA',
  JPY: 'JPY_TONAR', CHF: 'CHF_SARON', AUD: 'AUD_AONIA',
  CAD: 'CAD_CORRA',
}

// YYYY-MM-DD in local time (not UTC) — matches legacy.
function localDate() {
  const n = new Date()
  const p = x => String(x).padStart(2, '0')
  return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate())
}

// ── View mode: an existing trade opened from the blotter ─────────────────────
// The window is populated from the trade row (terms, dates, parties) and its
// legs, every input is read-only, the footer and the CONFIRM tab are in the
// booked state, and PRICE revalues through POST /price with the trade_id.

// instrument_type as stored (canonical IR_*, or INTEREST_RATE_* on older rows) → product key
const PRODUCT_OF_INSTRUMENT = {
  IR_SWAP: 'IR_SWAP', IR_SWAPTION: 'IR_SWAPTION',
  IR_CAP: 'RATES_CAP',       INTEREST_RATE_CAP: 'RATES_CAP',
  IR_FLOOR: 'RATES_FLOOR',   INTEREST_RATE_FLOOR: 'RATES_FLOOR',
  IR_COLLAR: 'RATES_COLLAR', INTEREST_RATE_COLLAR: 'RATES_COLLAR',
}
const CURRENCY_AC = {
  FX_SPOT: 'FX', FX_FORWARD: 'FX', NDF: 'FX', FX_SWAP: 'FX', FX_OPTION: 'FX',
  CRYPTO_FORWARD: 'CRYPTO', CRYPTO_OPTION: 'CRYPTO',
}
const CAP_LIKE = new Set(['RATES_CAP', 'RATES_FLOOR', 'RATES_COLLAR'])
const STATUS_COLOR = {
  PENDING: 'var(--amber)', CONFIRMED: 'var(--blue)', LIVE: 'var(--accent)',
  CANCELLED: 'var(--red)', TERMINATED: 'var(--text-dim)', MATURED: 'var(--text-dim)',
}

// What a new ticket opens on, and the order of the asset-class chips: digital assets first.
const NEW_TICKET = { assetClass: 'CRYPTO', curInst: 'CRYPTO_FORWARD' }
const ASSET_ORDER = ['CRYPTO', 'FX', 'RATES']

/** Where a stored trade lands in the window: asset class, currency instrument, registry product. */
function viewTarget(trade) {
  const it = String(trade?.instrument_type || '').toUpperCase()
  if (CURRENCY_AC[it]) return { assetClass: CURRENCY_AC[it], curInst: it, productKey: 'IR_SWAP' }
  return { assetClass: 'RATES', curInst: 'FX_FORWARD', productKey: PRODUCT_OF_INSTRUMENT[it] || 'IR_SWAP' }
}

const iso = d => (d ? String(d).slice(0, 10) : null)
// A decimal rate as the percent string the inputs show, without float noise.
const pctStr = v => (v == null || v === '' || isNaN(Number(v))) ? undefined : String(+(Number(v) * 100).toFixed(8))
const TENOR_LABELS = ['1M', '3M', '6M', '1Y', '2Y', '3Y', '5Y', '7Y', '10Y', '15Y', '20Y', '30Y']
const INDEX_OF_CURVE = Object.fromEntries(Object.entries(INDEX_CURVE).map(([k, v]) => [v, k]))

/** The nearest tenor chip to the booked schedule, for display. */
function tenorLabel(effDate, matDate) {
  if (!effDate || !matDate) return '5Y'
  const years = (new Date(matDate) - new Date(effDate)) / (365.25 * 86400e3)
  return TENOR_LABELS.reduce((best, t) => Math.abs(TENOR_Y[t] - years) < Math.abs(TENOR_Y[best] - years) ? t : best, '5Y')
}

/** The expiry tenor chip nearest a booked expiry date. */
function expiryLabel(tradeDate, expiryDate) {
  if (!tradeDate || !expiryDate) return undefined
  const years = (new Date(expiryDate) - new Date(tradeDate)) / (365.25 * 86400e3)
  return Object.keys(EXPIRY_Y).reduce((best, t) => Math.abs(EXPIRY_Y[t] - years) < Math.abs(EXPIRY_Y[best] - years) ? t : best, '1Y')
}

/**
 * The product state of a stored rates trade: trade.terms first (what the
 * ticket books since 2026-11), the legs as the fallback for older rows.
 * Mirrors the legacy window's populate effect, extended to the options.
 */
function viewProductState(trade, legs = []) {
  const t      = trade.terms || {}
  const fixed  = legs.find(l => l.leg_type === 'FIXED')
  const floats = legs.filter(l => l.leg_type === 'FLOAT')
  const float  = floats[0]
  const { productKey } = viewTarget(trade)
  const bp = v => (v == null || isNaN(Number(v))) ? undefined : String(+(Number(v) * 10000).toFixed(4))
  const embedded = Array.isArray(float?.embedded_options) ? float.embedded_options : []
  const emb = type => embedded.find(e => String(e.type).toUpperCase() === type)
  const s = {
    coupon:          pctStr(t.fixed_rate ?? fixed?.fixed_rate) ?? '',
    rateUserEdited:  true,
    parRate:         null,
    index:           t.float_index || t.index1 || INDEX_OF_CURVE[float?.forecast_curve_id] || 'SOFR',
    fixedPayFreq:    t.fixed_pay_freq  || fixed?.payment_frequency || 'ANNUAL',
    fixedDc:         t.fixed_day_count || fixed?.day_count         || 'ACT/360',
    fixedBdc:        t.fixed_bdc       || fixed?.bdc               || 'MOD_FOLLOWING',
    fixedCal:        t.fixed_calendar  || fixed?.payment_calendar  || undefined,
    floatResetFreq:  t.float_reset_freq || float?.reset_frequency   || 'DAILY',
    floatPayFreq:    t.float_pay_freq   || float?.payment_frequency || 'ANNUAL',
    floatDc:         t.float_day_count  || float?.day_count         || 'ACT/360',
    floatBdc:        t.float_bdc        || float?.bdc               || 'MOD_FOLLOWING',
    floatCal:        t.float_calendar   || float?.payment_calendar  || undefined,
    spread:          bp(t.spread ?? float?.spread) ?? '0',
    leverage:        String(t.leverage ?? float?.leverage ?? '1.0'),
  }
  if (trade.structure === 'BASIS') {
    Object.assign(s, {
      index2:          t.index2 || INDEX_OF_CURVE[floats[1]?.forecast_curve_id] || 'EFFR',
      floatResetFreq2: t.float_reset_freq2 || floats[1]?.reset_frequency   || 'DAILY',
      floatPayFreq2:   t.float_pay_freq2   || floats[1]?.payment_frequency || 'ANNUAL',
      floatDc2:        t.float_day_count2  || floats[1]?.day_count         || 'ACT/360',
    })
  }
  const premium = {
    premium:     t.premium_amount != null ? String(t.premium_amount) : '',
    premiumMode: 'DOLLAR',
    settleDate:  iso(t.premium_payment_date) || '',
    optionSide:  t.side || emb('CAP')?.direction || emb('FLOOR')?.direction || 'BUY',
  }
  if (productKey === 'IR_SWAPTION') {
    Object.assign(s, premium, {
      expiry: t.expiry_tenor || expiryLabel(iso(trade.trade_date), iso(t.expiry_date)) || '1Y',
      volBp:  t.vol_bp != null ? String(t.vol_bp) : undefined,
      strike: pctStr(t.strike ?? fixed?.fixed_rate) ?? '',
    })
  } else if (CAP_LIKE.has(productKey)) {
    Object.assign(s, premium, {
      capRate:      pctStr(t.cap_rate   ?? emb('CAP')?.default_strike),
      floorRate:    pctStr(t.floor_rate ?? emb('FLOOR')?.default_strike),
      capResetFreq: s.floatResetFreq, capPayFreq: s.floatPayFreq, capDayCount: s.floatDc,
      volOverride:  t.vol_bp != null ? String(t.vol_bp) : '',
    })
  } else if (embedded.length) {
    // a swap with caplets or floorlets on its float leg
    s.floatLegEmbeddedOptions = embedded
      .filter(e => e.type && e.direction)
      .map(e => ({ type: e.type, direction: e.direction, defaultStrike: pctStr(e.default_strike) || '' }))
  }
  return s
}

// Supabase session fetch — used by getSessionWithCache below.
async function getSession() {
  const session = await getSessionMaybe()
  return session
}

const SECTION_ORDER = [
  'tabs',
  'instrument',
  'counterparty',
  'primary',
  'terms',
  'optionFee',
  'analytics',
  'xva',
  'footer',
]

export default function TradeWindow({ onClose, onBook, onViewTrade, initialProduct = 'IR_SWAP', initialTrade = null, initialPos = null }) {
  // View mode: initialTrade is a stored trade (blotter row). Fixed for the
  // window's life; a window never switches between a new and a stored trade.
  const viewMode = !!initialTrade
  const view0    = viewMode ? viewTarget(initialTrade) : null
  const [productKey, setProductKey]   = useState(view0?.productKey || initialProduct)
  const product                        = getProduct(productKey)
  // FX and digital assets share one panel (interest-rate parity) and are not
  // registry products: the window keeps parties, dates, tabs and footer.
  // A new ticket opens on digital assets (10 November 2026: the first thing a visitor sees); a stored trade opens
  // on its own asset class.
  const [assetClass, setAssetClass]    = useState(view0?.assetClass || NEW_TICKET.assetClass)
  const [curInst, setCurInst]          = useState(view0?.curInst || NEW_TICKET.curInst)
  const isCurrency                     = assetClass === 'FX' || assetClass === 'CRYPTO'
  const fxRef                          = useRef(null)
  const winRef                         = useRef(null)
  // A manual drag of the resize handle leaves an inline width/height on the
  // window; clear it when the instrument changes so the window fits the new
  // content again (up to max-height, after which it scrolls).
  useEffect(() => {
    const el = winRef.current
    if (el) { el.style.height = ''; el.style.width = '' }
  }, [assetClass, curInst, productKey])
  const [fxQuote, setFxQuote]          = useState(null)
  // where the currency panel draws its valuation block: under the flows on the CASHFLOWS tab, once that tab has been opened
  const [valuationSlot, setValuationSlot] = useState(null)
  // the quote a trade was booked from in this window: the term sheet reads AS BOOKED only while it is still the one shown
  const [bookedFxQuote, setBookedFxQuote] = useState(null)
  // The currency ticket reprices as its terms are typed. Between a change and the price that answers it the panel
  // hands back the last quote marked stale: the tabs keep it (they would empty at every keystroke otherwise) and
  // the footer shows its figures dimmed. Terms that cannot be priced, or a failed price, hand back null.
  const [fxStale, setFxStale]          = useState(false)
  // A forward as a package of legs (fx-legs.js, the DETAILS tab): the ticket is the first leg; these are the further
  // ones, each with the price of its own terms (id → { key, quote, error, pending }), and, once booked, the package's
  // reference and the trade each leg became.
  const [legsHeld, setLegsHeld]        = useState({ on: null, legs: [] })
  const [legQuotes, setLegQuotes]      = useState({})
  const [bookedLegs, setBookedLegs]    = useState(null)
  const legQuotesRef = useRef({})                       // the prices as they stand, for the pricing loop to read between its requests
  useEffect(() => { legQuotesRef.current = legQuotes })
  const legsFor = ['CRYPTO_FORWARD', 'CRYPTO_OPTION', 'FX_FORWARD', 'NDF', 'FX_OPTION'].includes(curInst) && (assetClass === 'CRYPTO' || assetClass === 'FX')
  // The legs are of one pair and one kind of first leg: a size and a strike typed for BTCUSD mean nothing on ETHUSD.
  // While the ticket has no quote (between prices) they are kept; on another pair there are none.
  const legsOn = fxQuote ? `${fxQuote.pair}|${fxQuote.shape}` : legsHeld.on
  const fxLegs = legsHeld.on === legsOn ? legsHeld.legs : NO_LEGS
  const setFxLegs = (legs) => setLegsHeld({ on: legsOn, legs })
  // Price every further leg whose terms (or whose ticket: the pair, the market typed over) have changed since its last
  // price. The request is the ticket's own with the leg's side, size, date and strike (FxCryptoPanel legRequest).
  // every term of a leg that its price or its record depends on
  const legTerms = (l) => LEG_TERMS.map(k => l[k])
  const legsKey = JSON.stringify(fxLegs.map(l => [l.id, ...legTerms(l)]))
  // what a leg's price depends on beyond its own terms: the ticket's pair, kind of settlement and market (a typed spot or carry shows in the quote)
  const fxQuoteId = fxQuote ? `${fxQuote.pair}|${fxQuote.shape}|${fxQuote.valuation_date}|${fxQuote.spot}|${fxQuote.base_rate}|${fxQuote.forward_mode}` : ''
  // a leg's price is the price of exactly these: its own terms and that market. BOOK checks the same key.
  // and what it takes from the ticket: the pair, how it settles, a typed spot or carry, the source (FxCryptoPanel legContext)
  const legContext = fxRef.current?.legContext?.() || ''
  const legKey = (l) => JSON.stringify([...legTerms(l), fxQuoteId, legContext])
  useEffect(() => {
    if (!legsFor || viewMode || bookedLegs || !fxLegs.length || !fxQuoteId) return
    let dead = false
    const due = fxLegs.map(l => { const r = fxRef.current?.legRequest?.(l); return r ? { l, r, key: legKey(l) } : null }).filter(Boolean)
    const timer = setTimeout(async () => {
      for (const { l, r, key } of due) {
        const have = legQuotesRef.current[l.id]
        if (have && have.key === key && !have.pending && (have.quote || have.error)) continue     // priced for exactly these; one left pending by a request that was dropped is asked again
        setLegQuotes(m => ({ ...m, [l.id]: { key, quote: m[l.id]?.quote || null, error: null, pending: true } }))
        try {
          const session = await getSessionWithCache(sessionCacheRef)
          const res = await fetch(API + r.path, { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(r.body) })
          const j = await res.json().catch(() => ({}))
          if (dead) return
          const error = res.ok ? null : (typeof j.detail === 'string' ? j.detail : 'this leg could not be priced')
          setLegQuotes(m => (m[l.id]?.key === key ? { ...m, [l.id]: { key, quote: res.ok ? j : null, error, pending: false } } : m))
        } catch (e) {
          if (dead) return
          setLegQuotes(m => (m[l.id]?.key === key ? { ...m, [l.id]: { key, quote: null, error: e.message || 'this leg could not be priced', pending: false } } : m))
        }
      }
    }, 350)
    return () => { dead = true; clearTimeout(timer) }
  }, [legsKey, fxQuoteId, legContext, legsFor, viewMode, bookedLegs])      // eslint-disable-line react-hooks/exhaustive-deps
  // the ticket as a leg, with the strike it was priced at where none was typed (what the package is named by)
  const firstPriced = (f, q) => (f && f.strike == null && f.kind !== 'TOUCH' && q ? { ...f, strike: Number(f.kind === 'FWD' ? q.forward_rate : q.strike) } : f)
  // What the table shows for each leg: its price, and whether that price is of the terms it now shows. A leg just
  // changed is waiting from that moment, not from when its request goes out.
  const legView = Object.fromEntries(fxLegs.map(l => { const q = legQuotes[l.id], mine = !!q && q.key === legKey(l); return [l.id, { quote: q?.quote || null, error: mine ? q.error : null, pending: !mine || !!q.pending }] }))
  // The further legs as the XVA tab runs them: each leg's trade body, once every leg is priced for the terms it shows.
  const xvaLegs = (() => {
    if (!legsFor || viewMode || !fxLegs.length) return null
    const rows = fxLegs.map(l => { const v = legView[l.id]; const body = v && !v.pending && v.quote ? fxRef.current?.legBody?.(v.quote, l) : null; return body ? { body, quote: v.quote } : null })
    const ready = rows.every(Boolean)
    const failed = fxLegs.some(l => { const v = legView[l.id]; return !!v && !v.pending && (!!v.error || !v.quote) })
    return { count: fxLegs.length, ready, failed, key: legsKey, bodies: ready ? rows.map(r => r.body) : [], quotes: ready ? rows.map(r => r.quote) : [] }
  })()
  // The package as the other tabs and the footer see it (fx-package.js): the ticket's quote and every further leg's,
  // whole only when each leg is priced for the terms it shows. Null for a ticket without further legs.
  const pkg = legsFor && !viewMode && fxQuote ? packageView(fxQuote, fxLegs, legView) : null
  // a leg that is gone takes its price with it; a product that has no legs has none
  useEffect(() => { if (!legsFor && legsHeld.legs.length) setLegsHeld({ on: null, legs: [] }) }, [legsFor, legsHeld.legs.length])
  const CURRENCY_PRODUCTS = {
    FX:     [{ key: 'FX_SPOT', label: 'FX spot' }, { key: 'FX_FORWARD', label: 'FX forward' }, { key: 'NDF', label: 'NDF' }, { key: 'FX_SWAP', label: 'FX swap', live: false }, { key: 'FX_OPTION', label: 'FX option' }],
    CRYPTO: [{ key: 'CRYPTO_FORWARD', label: 'Crypto forward' }, { key: 'CRYPTO_OPTION', label: 'Crypto option' }],
  }
  // Read at every render, not memoised on the quote: the panel's handle is replaced after the render in which the
  // quote arrives, so a value remembered at that moment came from the handle before it (no quote yet, no terms),
  // and the tabs then showed a priced ticket with no terms (the scenario tab: "no settlement price source").
  const fxTerms = (() => {
    if (viewMode) return initialTrade.terms || null       // the term sheet as booked
    if (!fxQuote) return null
    try { return fxRef.current?.terms?.() || fxRef.current?.payload?.()?.terms || null } catch { return null }
  })()
  // one more render after the quote changes: the panel's handle (and its terms) is replaced after the render the quote arrives in
  const [, setFxTermsTick] = useState(0); useEffect(() => { setFxTermsTick(n => n + 1) }, [fxQuote])
  const n0 = (v) => {
    const n = Math.round(Number(v) || 0)
    const shown = (n === 0 ? 0 : n).toLocaleString('en-US', { maximumFractionDigits: 0 })   // never "-0"; en-US like the rest of the ticket, whatever the browser's locale
    return shown          // while a price is owed the footer dims these and says so (TradeFooter `stale`); the figure itself stays text, so it rolls to the next one
  }
  const currencyFooter = {
    footer: {
      // an option's structure is its style, on a currency pair and on a digital asset alike
      // a package is named as DETAILS names it (STRIP, COLLAR, CUSTOM, ...), and as it will be booked
      structureLabel: () => {
        if (pkg) { try { return structureOf(firstPriced(fxRef.current?.firstLeg?.(), fxQuote), fxLegs) } catch { /* the ticket as one trade, below */ } }
        return (curInst === 'FX_OPTION' || curInst === 'CRYPTO_OPTION') && fxTerms?.style ? fxTerms.style.replace(/_/g, ' ') : (SHAPE_OF[curInst] || 'FORWARD')
      },
      // The desk's names with their units (the same span as the ticket's tiles, FxCryptoPanel): CRY01 / FX01 for
      // +1 % spot, IR01 for +1 bp on the discounting curve, CRYBASIS01 for +1 bp a year on a digital asset's forward
      // basis (a long gains; the API sends it as crybasis01, and older answers only fund01, its negative), VEGA for
      // +1 vol point, THETA for one day. A currency pair's two rate sensitivities are shown apart: their sum reads as zero.
      // The strip is plain: no figure is coloured by its sign (the tiles above carry the sign and the colour).
      metrics: (r) => {
        if (!r) return []
        const unit = (name, u) => <>{name}<span className="tbw-fx-unit"> · {u}</span></>
        const crypto = assetClass === 'CRYPTO'
        // A package: the sum over every leg, under the same names. Until each leg is priced the figures are a dash
        // and the first label says what is owed: a sum with a leg missing is not the package's.
        if (pkg) {
          const t = packageRisk(pkg.quotes), gap = packageGap(pkg)
          const v = (x) => (t ? n0(x) : '—')
          // Six figures (a package with an option in it) share the footer's one line with a structure's name and the
          // buttons: they are then named without their units, which the TRADE tab's tiles carry. Paid or received,
          // and what a package is waiting for, are not units and stay. (The count of legs is on BOOK.)
          const six = !!t && t.options !== 'NONE'
          const u = (name, what) => (six ? name : unit(name, what))
          return [
            t && t.options === 'ALL'
              ? { label: unit('NET PREMIUM ' + r.quote_currency, t.npv >= 0 ? 'paid' : 'received'), value: n0(Math.abs(t.npv)) }
              : { label: gap ? unit('PACKAGE NPV ' + r.quote_currency, gap) : 'PACKAGE NPV ' + r.quote_currency, value: v(t?.npv) },
            { label: u(DELTA_LABEL(crypto), '1 % spot'), value: v(t?.spot01) },
            ...(crypto
              ? [{ label: u('IR01', '1 bp'), value: v(t?.ir01) }, { label: u('CRYBASIS01', '1 bp basis'), value: v(t?.crybasis01) }]
              : [{ label: u(`${r.quote_currency} IR01`, '1 bp'), value: v(t?.irQuote) }, { label: u(`${r.base_currency} IR01`, '1 bp'), value: v(t?.irBase) }]),
            { label: u('THETA', '1 day'), value: v(t?.theta) },
            ...(six ? [{ label: 'VEGA', value: v(t.vega) }] : []),
          ]
        }
        const crybasis = r.crybasis01 ?? (r.fund01 != null ? -r.fund01 : r.ir01_base != null ? -r.ir01_base : r.rho_base_per_bp != null ? -r.rho_base_per_bp : 0)
        const spot01 = r.spot01 ?? r.delta_quote_per_pct
        const option = r.shape === 'OPTION'
        return [
          // an option's first figure is its premium, paid or received (the NET NPV tile stays in the analytics block)
          option
            ? { label: unit('PREMIUM ' + r.quote_currency, r.direction === 'SELL' ? 'received' : 'paid'), value: n0(Math.abs(r.npv)) }
            : { label: 'NET NPV ' + r.quote_currency, value: n0(r.npv) },
          { label: unit(DELTA_LABEL(crypto), '1 % spot'), value: n0(spot01) },
          ...(crypto
            ? [{ label: unit('IR01', '1 bp'), value: n0(r.ir01 ?? r.ir01_disc ?? r.rho_quote_per_bp) },
               { label: unit('CRYBASIS01', '1 bp basis'), value: n0(crybasis) }]
            // a currency pair: each currency's curve on its own (their sum reads as zero), forward and option alike
            : [{ label: unit(`${r.quote_currency} IR01`, '1 bp'), value: n0(r.ir01_disc ?? r.rho_quote_per_bp) },
               { label: unit(`${r.base_currency} IR01`, '1 bp'), value: n0(r.ir01_base ?? r.rho_base_per_bp) }]),
          { label: unit('THETA', '1 day'), value: n0(r.theta ?? 0) },
          ...(r.shape === 'OPTION' ? [{ label: unit('VEGA', '1 pt'), value: n0(r.vega ?? 0) }] : []),
        ]
      },
    },
  }
  if (!product) throw new Error(`Unknown product: ${productKey}`)

  const { curveInterp }                = useMarketDataStore()

  const [structure, setStructure]      = useState(() => viewMode
    ? (initialTrade.structure || initialTrade.terms?.exercise_type || product.defaultStructure)
    : product.defaultStructure)
  const [direction, setDirection]      = useState(() => {
    const t = initialTrade?.terms || {}
    if (t.direction === 'PAY' || t.direction === 'RECEIVE') return t.direction
    if (typeof t.is_payer === 'boolean') return t.is_payer ? 'PAY' : 'RECEIVE'
    return 'PAY'
  })
  const [economics, setEconomics]      = useState(() => viewMode ? {
    notional: Number(initialTrade.notional) || 0, ccy: initialTrade.notional_ccy || 'USD',
    tenor: tenorLabel(iso(initialTrade.effective_date), iso(initialTrade.maturity_date)),
    effDate: iso(initialTrade.effective_date), matDate: iso(initialTrade.maturity_date),
    tradeDate: iso(initialTrade.trade_date), valDate: null,
    ownEntityId: initialTrade.own_legal_entity_id || '', counterpartyId: initialTrade.counterparty_id || '',
    desk: initialTrade.desk || '', book: initialTrade.book || '',
  } : {
    notional: 10_000_000, ccy: 'USD', tenor: '5Y',
    effDate: null, matDate: null, tradeDate: null,
    valDate: null,
    // Counterparty block. own_legal_entity_id / counterparty_id are what the
    // booking body carries and what on-chain confirmation resolves signing
    // keys from, so a trade booked without them cannot be confirmed.
    ownEntityId: '', counterpartyId: '', desk: '', book: '',
  })
  // Reference data for the counterparty block.
  const [refData, setRefData] = useState({ entities: [], counterparties: [], desks: [], books: [], loading: true, error: null })
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const session = await getSession()
        const h = { Authorization: 'Bearer ' + session.access_token }
        const [cpR, orgR, leR, dfR] = await Promise.all([
          fetch(API + '/api/counterparties/', { headers: h }),
          fetch(API + '/nodes', { headers: h }),
          fetch(API + '/api/legal-entities/', { headers: h }),
          fetch(API + '/api/me/booking-defaults', { headers: h }).catch(() => null),
        ])
        if (cancelled) return
        const counterparties = cpR.ok ? await cpR.json() : []
        const nodes          = orgR.ok ? await orgR.json() : []
        const entities       = leR.ok ? await leR.json() : []
        const own            = entities.filter(e => e.is_own_entity)
        setRefData({
          entities: own.length ? own : entities,
          counterparties,
          desks: nodes.filter(n => n.node_type === 'desk' && n.is_active !== false),
          books: nodes.filter(n => n.node_type === 'book' && n.is_active !== false),
          loading: false,
          error: (cpR.ok && leR.ok) ? null : 'reference data unavailable',
        })
        // Default to the first own entity, as the legacy window does. A stored
        // trade shows what it was booked with, defaults or not.
        if (viewMode) return
        if (own.length) setEconomics(e => (e.ownEntityId ? e : { ...e, ownEntityId: own[0].id }))
        // The trader's default desk and book (Configurations › P&L & Control), when the ticket has none yet.
        const df = dfR && dfR.ok ? await dfR.json() : null
        if (df) setEconomics(e => ({ ...e, desk: e.desk || df.default_desk || '', book: e.book || df.default_book || '' }))
      } catch (err) {
        if (!cancelled) setRefData(r => ({ ...r, loading: false, error: err.message || 'reference data failed' }))
      }
    })()
    return () => { cancelled = true }
  }, [viewMode])
  // View mode: from the trade's terms at once, refined from its legs below.
  const [productState, setProductState] = useState(() => (viewMode && !view0.assetClass.match(/FX|CRYPTO/))
    ? viewProductState(initialTrade, []) : {})
  const [result, setResult]             = useState(null)
  const [pricing, setPricing]           = useState(false)
  const [awaitingPar, setAwaitingPar]   = useState(null)    // the product whose PRICE click is held while its par rate solves (null: none)
  const [error, setError]               = useState('')

  // Sprint 10 Patch 6 — booking state. In view mode the stored trade is the
  // booked trade: the footer and the CONFIRM tab start in the booked state.
  const [bookedTrade, setBookedTrade] = useState(initialTrade || null)
  const [booking,     setBooking]     = useState(false)
  const [bookErr,     setBookErr]     = useState('')

  // Sprint 12 item 3 — lifecycle state (PENDING -> CONFIRMED | CANCELLED)
  const [confirming, setConfirming] = useState(false)
  // On-chain confirmation: attestation returned with the CONFIRMED event,
  // and the result of an independent VERIFY (recompute hash, query chain).
  const [attestation, setAttestation] = useState(null)
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [confirmErr, setConfirmErr] = useState('')
  const [cancelErr,  setCancelErr]  = useState('')

  // ── Window chrome state (Patch 8): active tab + drag position ──────────
  const [activeTab, setActiveTab] = useState('TRADE')

  // Sprint 12 item 6 follow-up (L29): lazy-init tab mounting.
  // On first activation, the tab is marked visited; once visited the panel
  // stays mounted (display:none when inactive) so user edits survive tab
  // switches. TRADE is always considered visited (it's the default tab
  // and uses the always-mounted display:none pattern from Patch 8).
  const [tabsVisited, setTabsVisited] = useState({ TRADE: true })
  useEffect(() => {
    if (!tabsVisited[activeTab]) {
      setTabsVisited(v => ({ ...v, [activeTab]: true }))
    }
  }, [activeTab, tabsVisited])

  // Patch 21: XVA integration — params ref for XVATab to write to,
  // sim result state for shell-level consumption later.
  const xvaParamsRef = useRef(null)
  const [, setXvaSimResult] = useState(null)
  const [pos, setPos] = useState(() => initialPos || ({
    x: Math.max(10, (typeof window !== 'undefined' ? window.innerWidth : 1400) - 1287) / 2,
    y: 30,
  }))
  const dragEndRef = useRef(null)       // ends a drag in progress; called when the ticket closes mid-drag

  // Drag-to-move. Pressing the body of the window starts nothing in React: the listeners are attached here, and
  // once the pointer has travelled three pixels the window follows it as a transform written straight to the
  // element, once a frame. The browser moves a layer it has already drawn and the ticket is not rendered again
  // for every pixel of travel (it used to be: 1,700 attribute writes in a three-second drag). The resting
  // position (left/top, in state) is set once, on release. The top edge stays on the screen and a strip of the
  // window stays inside it, so the header can always be reached. A press that does not travel changes nothing,
  // so a tooltip open inside the window stays where it is (a transformed ancestor would re-anchor it).
  const handleWindowMouseDown = (e) => {
    if (e.button !== 0) return             // a right-press opens the context menu, which swallows the mouseup
    // Skip drag if the user is interacting with a form control or button.
    // Uses .closest() so we catch clicks on nested spans/icons too.
    if (e.target.closest(
      'input, select, textarea, button, [contenteditable], [role="button"],' +
      'canvas, .tbw-no-drag'
    )) return
    // Skip drag if mousedown landed in the bottom-right resize zone.
    // CSS `resize: both` exposes a ~16px hit area in the corner of the
    // .tbw-window element itself (no separate child node), so e.target
    // alone can't distinguish resize-grab from window-body click. 20px
    // gives a comfortable hit zone without false positives elsewhere.
    const el = e.currentTarget
    const rect = el.getBoundingClientRect()
    if (
      e.clientX >= rect.right - 20 &&
      e.clientY >= rect.bottom - 20
    ) return
    dragEndRef.current?.()
    const s = { px: pos.x, py: pos.y, mx: e.clientX, my: e.clientY }
    const w = el.offsetWidth
    let raf = 0, dx = 0, dy = 0, moving = false
    const paint = () => { raf = 0; el.style.transform = `translate3d(${dx}px, ${dy}px, 0)` }
    const stop = () => {
      cancelAnimationFrame(raf); raf = 0     // a frame still waiting would put the transform back after release
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragEndRef.current = null
    }
    function onUp() {
      stop()
      if (!moving) return
      el.style.willChange = ''
      if (dx || dy) setPos({ x: s.px + dx, y: s.py + dy })     // the layout effect below takes the transform off in the same commit
      else el.style.transform = ''
    }
    function onMove(ev) {
      if (!ev.buttons) return onUp()         // the button came up where no mouseup reached this window
      if (!moving) {
        if (Math.abs(ev.clientX - s.mx) < 3 && Math.abs(ev.clientY - s.my) < 3) return
        moving = true
        el.style.willChange = 'transform'
      }
      dx = Math.min(window.innerWidth - 80, Math.max(80 - w, s.px + ev.clientX - s.mx)) - s.px
      dy = Math.min(window.innerHeight - 40, Math.max(0, s.py + ev.clientY - s.my)) - s.py
      if (!raf) raf = requestAnimationFrame(paint)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    dragEndRef.current = () => { stop(); el.style.willChange = ''; el.style.transform = '' }
  }
  useEffect(() => () => dragEndRef.current?.(), [])
  // The transform comes off in the same commit that moves left/top, before the browser paints: no jump on release.
  useLayoutEffect(() => { if (winRef.current) winRef.current.style.transform = '' }, [pos])

  // Reset state when product changes — each product owns its own state shape.
  // Not on mount: the initial state is already the product's (and, in view
  // mode, the stored trade's).
  const firstProductRender = useRef(true)
  useEffect(() => {
    if (firstProductRender.current) { firstProductRender.current = false; return }
    setStructure(product.defaultStructure)
    setProductState({})
    setResult(null)
    setError('')
  }, [productKey])

  // Set valuation date to today on mount, and the trade date of a new ticket — mirrors legacy.
  useEffect(() => {
    const today = localDate()
    setEconomics(e => ({ ...e, valDate: today, tradeDate: e.tradeDate || today }))
  }, [])

  // View mode: the legs, for the conventions an older row's terms do not carry.
  useEffect(() => {
    if (!viewMode || isCurrency) return
    let cancelled = false
    ;(async () => {
      try {
        const session = await getSession()
        if (!session?.access_token || cancelled) return
        const res = await fetch(API + '/api/trade-legs/' + initialTrade.id, { headers: { Authorization: 'Bearer ' + session.access_token } })
        if (!res.ok || cancelled) return
        const legs = await res.json()
        if (cancelled || !Array.isArray(legs) || !legs.length) return
        setProductState(s => ({ ...s, ...viewProductState(initialTrade, legs) }))
      } catch (e) { console.warn('[tw] legs fetch failed', e) }
    })()
    return () => { cancelled = true }
  }, [viewMode, isCurrency, initialTrade])

  // View mode: the trade's shared identifiers (its UTI, the counterparty's own
  // ref for it), and its status followed live from the blotter store — the
  // counterparty's countersignature from chat, a cancel from another window.
  // Only PENDING is followed: a status this window set itself is never undone.
  const theirRef   = useTradesStore(s => (viewMode ? s.theirRefs[initialTrade.id] : null) || null)
  const liveStatus = useTradesStore(s => viewMode ? s.trades.find(t => t.id === initialTrade.id)?.status : undefined)
  useEffect(() => {
    if (!viewMode || !liveStatus || liveStatus === 'PENDING') return
    setBookedTrade(b => (b && b.status === 'PENDING') ? { ...b, status: liveStatus } : b)
  }, [viewMode, liveStatus])
  const [utiCopied, setUtiCopied] = useState(false)
  const copyUti = () => {
    const uti = bookedTrade?.uti
    if (!uti) return
    navigator.clipboard?.writeText(uti).then(() => { setUtiCopied(true); setTimeout(() => setUtiCopied(false), 1500) }).catch(() => {})
  }

  const state = useMemo(() => ({
    productKey, structure, direction, readOnly: viewMode, ...economics, ...productState,
  }), [productKey, structure, direction, viewMode, economics, productState])

  // Fields that belong in `economics` (shell-level). Everything else is
  // routed to productState. Descriptors call update() with either kind
  // of field; the shell handles the split.
  const ECON_FIELDS = new Set([
    'notional','ccy','tenor','effDate','matDate','tradeDate','valDate',
  ])

  const updateProductState = useCallback((patch) => {
    const econPatch = {}
    const prodPatch = {}
    for (const k of Object.keys(patch)) {
      if (ECON_FIELDS.has(k)) econPatch[k] = patch[k]
      else prodPatch[k] = patch[k]
    }
    if (Object.keys(econPatch).length) setEconomics(e => ({ ...e, ...econPatch }))
    if (Object.keys(prodPatch).length) setProductState(s => ({ ...s, ...prodPatch }))
  }, [])

  // ── Pricing ────────────────────────────────────────────────────────────────

  const sessionCacheRef = useRef(null)
  const abortRef        = useRef(null)

  const handlePrice = useCallback(async () => {
    if (pricing) return
    // A fixed leg whose coupon is still blank is waiting for the par solve. Pricing now would strike it at 0 %.
    // Hold the click until the coupon arrives (the effect below prices then), or say why it cannot.
    if (!viewMode && !isCurrency && product.pricing.awaitsPar?.(state)) {
      if (state.parError) { setError(state.parError + ' Type a coupon to price.'); setAwaitingPar(null); return }
      setError(''); setResult(null); setAwaitingPar(productKey)
      return
    }
    setAwaitingPar(null)
    setPricing(true); setError(''); setResult(null)

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const abortTimer = setTimeout(() => ac.abort(),
                                  product.pricing.timeoutMs || 30000)

    try {
      const curveId  = CCY_CURVE[state.ccy] || 'USD_SOFR'
      const curves   = [{
        curve_id: curveId,
        quotes: [],
        interp_method: curveInterp?.[curveId] || 'LogLinearDiscount',
      }]

      // Session with 5s deadline + cache fallback (copied pattern from Sprint 9.1)
      const session = await getSessionWithCache(sessionCacheRef)
      const post = async (path, body) => {
        const res = await fetch(API + path, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ac.signal,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || 'Pricing failed')
        return data
      }

      if (viewMode) {
        // A stored trade is revalued as booked: POST /price with its trade_id
        // (a currency trade returns through currencies.price_booked). A
        // swaption's option analytics come from its pricer on the booked
        // terms; the booked legs supply the cashflows.
        const booked = await post('/price', { trade_id: initialTrade.id, valuation_date: state.valDate, curves, states: true })
        if (isCurrency) { setFxQuote(booked); return }
        let data = booked
        if (productKey === 'IR_SWAPTION' && state.effDate && state.matDate) {
          try {
            const opt = await post(product.pricing.endpoint, { ...product.pricing.buildPayload(state), curves })
            data = { ...opt, legs: booked.legs, curve_mode: booked.curve_mode, trade_id: booked.trade_id }
          } catch (e) { console.warn('[tw] swaption revaluation fell back to the booked legs', e) }
        }
        setResult(product.pricing.parseResponse(data))
        return
      }

      const endpoint = typeof product.pricing.endpoint === 'function'
        ? product.pricing.endpoint(state) : product.pricing.endpoint
      const data = await post(endpoint, { ...product.pricing.buildPayload(state), curves })
      setResult(product.pricing.parseResponse(data))
    } catch (e) {
      if (e?.name === 'AbortError') setError('Pricing request aborted')
      else setError(e.message)
    } finally {
      clearTimeout(abortTimer)
      setPricing(false)
    }
  }, [pricing, product, productKey, state, viewMode, isCurrency, initialTrade, curveInterp])

  // PRICE was held for the par solve: price the moment the coupon is there; give up with the reason if the solve
  // fails or does not answer in ten seconds.
  useEffect(() => {
    if (!awaitingPar) return
    // the ticket moved to another product or asset class while the click was held: the hold was for that one
    if (awaitingPar !== productKey || isCurrency || viewMode) { setAwaitingPar(null); return }
    // the user took the coupon over: nothing is priced on a half-typed number; PRICE is theirs to press
    if (state.rateUserEdited) { setAwaitingPar(null); return }
    if (state.parError) { setAwaitingPar(null); setError(state.parError + ' Type a coupon to price.'); return }
    if (!product.pricing.awaitsPar?.(state)) { handlePrice(); return }
    const t = setTimeout(() => { setAwaitingPar(null); setError('The par rate did not solve. Type a coupon, or press PAR to solve again.') }, 10000)
    return () => clearTimeout(t)
  }, [awaitingPar, state, product, productKey, isCurrency, viewMode, handlePrice])

  // View mode: value the trade as soon as the window opens, so the analytics,
  // the footer and the CASHFLOWS tab show the booked trade without a click.
  const pricedOnOpen = useRef(false)
  useEffect(() => {
    if (!viewMode || pricedOnOpen.current || !state.valDate) return
    pricedOnOpen.current = true
    handlePrice()
  }, [viewMode, state.valDate, handlePrice])

  // View mode: a confirmed trade's on-chain record (hash, both signatures,
  // block), loaded when the CONFIRM tab opens. {attestation, on_chain} from
  // the backend, {error} when it could not be read.
  useEffect(() => {
    if (!viewMode || activeTab !== '◆ CONFIRM' || attestation !== null) return
    if (!['CONFIRMED', 'TERMINATED'].includes(bookedTrade?.status)) return
    let live = true
    getAttestation(bookedTrade.id)
      .then(r => { if (live) setAttestation(r || { error: 'empty response' }) })
      .catch(e => { if (live) setAttestation({ error: e.message || String(e) }) })
    return () => { live = false }
  }, [viewMode, activeTab, attestation, bookedTrade])

  // Sprint 10 Patch 6 — booking handlers
  const handleBook = useCallback(async () => {
    if (booking || pricing) return
    setBookErr(''); setBooking(true)
    try {
      // A trade with no counterparty cannot be confirmed (on-chain or
      // otherwise) — a confirmation names both signing parties. Catch it
      // here rather than after the trade is already booked.
      if (!economics.counterpartyId) {
        throw new Error('Select a COUNTERPARTY on the TRADE tab before booking.')
      }
      if (!economics.ownEntityId) {
        throw new Error('Select an OWN ENTITY on the TRADE tab before booking.')
      }
      const r = await executeBooking({
        state, direction,
        extras: {
          ownEntityId:     economics.ownEntityId   || null,
          counterpartyId:  economics.counterpartyId || null,
          desk:            economics.desk || null,
          book:            economics.book || null,
          // the last preview result: a blank swaption strike books its ATM
          // forward, a cap without a vol override books the priced vol
          priced:          result,
        },
      })
      setBookedTrade(r.trade)
      // The option products' own analytics (vega, vol, caplets) came from the
      // preview; /price after booking returns the swap-shaped valuation of
      // the stored legs, which is what the swap shows.
      if (r.priceData && productKey === 'IR_SWAP') setResult(product.pricing.parseResponse(r.priceData))
      try { useTradesStore.getState().fetchTrades?.({ quiet: true }) } catch { /* blotter refresh is best effort */ }
      onBook?.({ productKey, trade: r.trade })
    } catch (e) {
      setBookErr(e.message || String(e))
    } finally {
      setBooking(false)
    }
  }, [booking, pricing, state, direction, product, productKey, onBook, economics, result])

  const handleBookCurrency = useCallback(async () => {
    if (booking || pricing) return
    setBookErr(''); setBooking(true)
    try {
      if (!economics.counterpartyId) throw new Error('Select a COUNTERPARTY on the TRADE tab before booking.')
      if (!economics.ownEntityId) throw new Error('Select an OWN ENTITY on the TRADE tab before booking.')
      // The panel decides (fx-ticket.js createTicketPricer): a quote is booked only when it was priced for exactly the
      // terms on screen and was already there when BOOK was pressed. With a price owed or none yet, the ticket prices
      // and stops: the new figures, or the reason there are none, are shown beside the valuation and BOOK is pressed
      // again. It never forces a price for terms the automatic pricing refuses.
      const decision = await fxRef.current?.book?.()
      if (!decision || decision.action !== 'book') return
      // the quote travels with the key of the terms it priced; the body is built only if those are still the terms
      const body = fxRef.current.payload(decision.quote, decision.key)
      if (!body) throw new Error('the terms changed: reprice')
      const today = new Date().toISOString().slice(0, 10)
      const session = await getSessionWithCache(sessionCacheRef)
      const post = async (b, strategy) => {
        const res = await fetch(API + '/api/trades/', {
          method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...b, own_legal_entity_id: economics.ownEntityId, counterparty_id: economics.counterpartyId,
                                 desk: economics.desk || null, book: economics.book || null, trade_date: today, effective_date: today, ...(strategy ? { strategy } : {}) }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(typeof j.detail === 'string' ? j.detail : (j.detail ? JSON.stringify(j.detail) : 'Booking failed'))
        return j
      }
      // A package: every further leg must hold the price of the terms it now shows, or nothing is booked at all. Then
      // each leg is its own trade (the first is the ticket's), tagged in `strategy` with the package and its place.
      const legs = legsFor ? fxLegs : []
      const priced = legs.map((l, i) => {
        const r = fxRef.current?.legRequest?.(l), q = legQuotes[l.id]
        if (!r || !q?.quote || q.pending || q.key !== legKey(l)) throw new Error(q?.error || !r ? `Leg ${i + 2} has no price for its terms${q?.error ? ` (${q.error})` : ''}: nothing was booked. Fix or remove it on DETAILS, then press BOOK again.` : `Leg ${i + 2} is still being priced for the terms it now shows: nothing was booked. Press BOOK again in a moment.`)
        const b = fxRef.current.legBody(q.quote, l)
        if (!b) throw new Error(`Leg ${i + 2} could not be built: nothing was booked.`)
        return { l, b }
      })
      // A package is booked whole, in one call: every leg or none (POST /api/book/package). The server names it: one
      // trade ID for the package (TRD-12345678) and a leg ID for each leg under it (TRD-12345678-1, -2, ...).
      let t
      if (priced.length) {
        const structure = structureOf(firstPriced(fxRef.current.firstLeg(), decision.quote), legs)
        const whole = (b) => ({ ...b, legs: [], own_legal_entity_id: economics.ownEntityId, counterparty_id: economics.counterpartyId,
                                desk: economics.desk || null, book: economics.book || null, trade_date: today, effective_date: today })
        const r = await bookPackage(structure, [whole(body), ...priced.map(x => whole(x.b))])
        const refs = { first: r.trades[0].trade_ref }
        priced.forEach((x, k) => { refs[x.l.id] = r.trades[k + 1].trade_ref })
        // the legs as booked (id, leg ID, status): CONFIRM reads the package from these, at once, without waiting for
        // the blotter's trades to arrive (a CONFIRM pressed before they did confirmed one leg alone: found by review)
        setBookedLegs({ ref: r.package.trade_id, structure: r.package.structure, refs, trades: r.trades.map(x => ({ id: x.id, trade_ref: x.trade_ref, status: x.status, strategy: x.strategy })) })
        t = r.trades[0]
      } else {
        t = await post(body, null)
      }
      setBookedTrade(t)
      // the quote that was sent, not whatever the window holds by now: a price that landed while the POST was out is not the booked one
      setBookedFxQuote(decision.quote)
      try { useTradesStore.getState().fetchTrades?.() } catch { /* ignore: blotter refresh is best effort */ }
      onBook?.({ productKey: body.instrument_type, trade: t })
    } catch (e) {
      setBookErr(e.message || String(e))
    } finally {
      setBooking(false)
    }
  // the legs as they stand when BOOK is pressed, not as they were when the window opened
  }, [booking, pricing, economics, onBook, fxLegs, legQuotes, legsFor, fxQuoteId, legContext])      // eslint-disable-line react-hooks/exhaustive-deps

  // Incremental XVA (XVA tab): the counterparty's netting set with and without
  // this trade. A stored or just-booked trade goes by id (the marginal effect of
  // removing it); a hypothetical one as the body the booking would send. The
  // rates builder throws when the ticket cannot be booked yet (a swaption with a
  // blank strike before pricing): IncrementalXva shows the message as the reason
  // its button is disabled.
  const incrementalTradeId  = bookedTrade?.id || null
  const counterpartyName    = useMemo(() =>
    refData.counterparties.find(c => c.id === economics.counterpartyId)?.name
      || initialTrade?.counterparty_name || null,
    [refData.counterparties, economics.counterpartyId, initialTrade])
  const buildRatesTrade = useCallback(() => buildBookingBody(state, direction, {
    ownEntityId: economics.ownEntityId || null, counterpartyId: economics.counterpartyId || null,
    desk: economics.desk || null, book: economics.book || null, priced: result,
  }), [state, direction, economics, result])
  const buildCurrencyTrade = useCallback(() => fxRef.current?.bookBody ? fxRef.current.bookBody() : null, [])

  // The package the booked trade is a leg of, from the blotter's trades: { tradeId, structure, n, legs }. `pendingPackage`
  // is it when every leg is still PENDING (then CONFIRM confirms the package as one record); else a leg goes alone.
  const allTrades = useTradesStore(s => s.trades)
  // from the blotter's trades when they hold every leg (their statuses are the live ones); else from the legs this
  // window booked a moment ago
  const bookedPackage = bookedTrade && bookedLegs?.trades?.some(x => x.id === bookedTrade.id)
    ? { tradeId: bookedLegs.ref, structure: bookedLegs.structure, n: bookedLegs.trades.length, legs: bookedLegs.trades } : null
  const tradePackage = bookedTrade ? (packageOf(allTrades.find(x => x.id === bookedTrade.id) || bookedTrade, allTrades) || bookedPackage) : null
  const pendingPackage = tradePackage && tradePackage.legs.every(x => x.status === 'PENDING') ? tradePackage : null

  // Sprint 12 item 3 — CONFIRM handler: PENDING -> CONFIRMED
  const handleConfirm = useCallback(async (mode = 'chain') => {
    if (!bookedTrade?.id) return
    if (confirming || cancelling) return
    setConfirmErr(''); setConfirming(true)
    try {
      // Default path signs the canonical trade hash for both parties and
      // anchors it (TradeConfirmationRegistry). 'offchain' is the plain
      // status flip for environments with no signing keys configured.
      // A leg of a package whose legs are all still pending: the package is confirmed as one record, every leg together.
      const pkg = mode !== 'offchain' ? pendingPackage : null
      let r
      if (pkg) {
        const done = await confirmPackageOnChain(pkg.legs.map(x => x.id))
        r = { trade: done.trades.find(x => x.id === bookedTrade.id) || done.trades[0] }
      } else {
        r = mode === 'offchain'
          ? await confirmTrade(bookedTrade.id)
          : await confirmTradeOnChain(bookedTrade.id)
      }
      if (mode !== 'offchain') {
        try { setAttestation(await getAttestation(r.trade.id)) } catch (e) { console.warn('[chain] attestation fetch failed', e) }
      }
      // r.trade.status is now 'CONFIRMED' — ConfirmPanel re-renders into
      // terminal state automatically.
      setBookedTrade(r.trade)
      // Sprint 13 follow-up — lifecycle cache refresh: onBook is a stub
      // in App.jsx today, so refresh the stores directly.
      await useTradesStore.getState().fetchTrades()
      useTabStore.getState().refreshTrade(r.trade.id, r.trade)
      onBook?.({ productKey, trade: r.trade })
    } catch (e) {
      setConfirmErr(e.message || String(e))
    } finally {
      setConfirming(false)
    }
  }, [bookedTrade, confirming, cancelling, productKey, onBook, pendingPackage])

  // The counterparty countersigned from chat: the trade is CONFIRMED server-side. Reflect it here
  // and load the attestation, without re-running any confirm call.
  const handleRemoteConfirmed = useCallback(async () => {
    if (!bookedTrade?.id || bookedTrade.status === 'CONFIRMED') return
    setBookedTrade(t => ({ ...t, status: 'CONFIRMED' }))
    try { setAttestation(await getAttestation(bookedTrade.id)) } catch (e) { console.warn('[chain] attestation fetch failed', e) }
    try { useTradesStore.getState().fetchTrades?.() } catch { /* blotter refresh is best effort */ }
  }, [bookedTrade])

  const handleVerify = useCallback(async () => {
    if (!bookedTrade?.id || verifying) return
    setVerifying(true); setVerifyResult(null)
    try { setVerifyResult(await verifyTradeOnChain(bookedTrade.id)) }
    catch (e) { setVerifyResult({ error: e.message || String(e) }) }
    finally { setVerifying(false) }
  }, [bookedTrade, verifying])

  const [terminating, setTerminating] = useState(false)
  const handleTerminate = useCallback(async (reason) => {
    if (!bookedTrade?.id || terminating) return
    setTerminating(true); setConfirmErr('')
    try {
      const r = await terminateOnChain(bookedTrade.id, {}, reason)
      setBookedTrade(r.trade)
      try { setAttestation(await getAttestation(r.trade.id)) } catch (e) { console.warn('[chain] attestation fetch failed', e) }
      await useTradesStore.getState().fetchTrades()
      useTabStore.getState().refreshTrade(r.trade.id, r.trade)
    } catch (e) {
      setConfirmErr(e.message || String(e))
    } finally {
      setTerminating(false)
    }
  }, [bookedTrade, terminating])

  const handleDownloadProof = useCallback(async () => {
    if (!bookedTrade?.id) return
    try {
      const proof = await getProofPack(bookedTrade.id)
      const blob = new Blob([JSON.stringify(proof, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${proof.trade_ref || bookedTrade.id}-confirmation-proof.json`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      setVerifyResult({ error: e.message || String(e) })
    }
  }, [bookedTrade])

  // A shareable proof link: the proof pack, deflated and base64url-encoded in
  // the URL fragment of the public verifier. Nothing is stored server-side;
  // whoever holds the link holds the proof, which is the owner's choice.
  const handleCopyProofLink = useCallback(async () => {
    if (!bookedTrade?.id) return
    try {
      const proof = await getProofPack(bookedTrade.id)
      const json = new TextEncoder().encode(JSON.stringify(proof))
      let bytes = json
      try {
        const cs = new CompressionStream('deflate-raw'); const w = cs.writable.getWriter(); w.write(json); w.close()
        bytes = new Uint8Array(await new Response(cs.readable).arrayBuffer())
      } catch { /* no CompressionStream: plain base64 JSON, the verifier accepts both */ }
      let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b) })
      const b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const url = `https://rijeka.app/verify/#p=${b64}`
      await navigator.clipboard.writeText(url)
      setVerifyResult({ info: `Proof link copied (${url.length.toLocaleString()} characters). Anyone who opens it sees the terms, both signatures and the chain record verified in their browser.` })
    } catch (e) {
      setVerifyResult({ error: e.message || String(e) })
    }
  }, [bookedTrade])

  // Sprint 12 item 3 — CANCEL handler: PENDING -> CANCELLED (terminal)
  const handleCancelTrade = useCallback(async (reason) => {
    if (!bookedTrade?.id) return
    if (confirming || cancelling) return
    setCancelErr(''); setCancelling(true)
    try {
      const r = await cancelTrade(bookedTrade.id, reason)
      // r.trade.status is now 'CANCELLED' — ConfirmPanel re-renders into
      // terminal state automatically.
      setBookedTrade(r.trade)
      // Sprint 13 follow-up — lifecycle cache refresh: onBook is a stub
      // in App.jsx today, so refresh the stores directly.
      await useTradesStore.getState().fetchTrades()
      useTabStore.getState().refreshTrade(r.trade.id, r.trade)
      onBook?.({ productKey, trade: r.trade })
    } catch (e) {
      setCancelErr(e.message || String(e))
    } finally {
      setCancelling(false)
    }
  }, [bookedTrade, confirming, cancelling, productKey, onBook])

  const handleNewTrade = () => {
    setBookedTrade(null); setBookedFxQuote(null); setResult(null); setError(''); setBookErr('')
    setFxLegs([]); setLegQuotes({}); setBookedLegs(null)        // a package that was booked is not carried into the next ticket
    // Sprint 12 item 3 — also clear lifecycle state
    setConfirmErr(''); setCancelErr('')
    setConfirming(false); setCancelling(false)
  }

  const handleViewTrade = () => {
    const id = bookedTrade?.id || bookedTrade?.trade_id
    if (onViewTrade && id) onViewTrade(id)
    else onClose?.()
  }

  // Safety net — auto-clear stuck pricing flag after 20s (Sprint 9.1 pattern)
  useEffect(() => {
    if (!pricing) return
    const t = setTimeout(() => {
      console.warn('[safety-net] pricing stuck >20s, forcing false')
      setPricing(false)
    }, 20000)
    return () => clearTimeout(t)
  }, [pricing])

  // Booking safety-net — auto-clear stuck booking flag after 20s (Patch 6)
  useEffect(() => {
    if (!booking) return
    const t = setTimeout(() => {
      console.warn('[safety-net] booking stuck >20s, forcing false')
      setBooking(false)
    }, 20000)
    return () => clearTimeout(t)
  }, [booking])

  // Sprint 12 item 3 — confirm safety-net
  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => {
      console.warn('[safety-net] confirming stuck >20s, forcing false')
      setConfirming(false)
    }, 20000)
    return () => clearTimeout(t)
  }, [confirming])

  // Sprint 12 item 3 — cancel safety-net
  useEffect(() => {
    if (!cancelling) return
    const t = setTimeout(() => {
      console.warn('[safety-net] cancelling stuck >20s, forcing false')
      setCancelling(false)
    }, 20000)
    return () => clearTimeout(t)
  }, [cancelling])

  // A stored cap, floor or collar is revalued through /price, which returns
  // the swap-shaped valuation of its OPT-1 leg (NPV, IR01, theta, the leg's
  // caplet cashflows), not the preview pricer's caplet strip: show it with the
  // swap's analytics and footer, under the product's own structure label.
  const swapProduct    = getProduct('IR_SWAP')
  const displayProduct = useMemo(() => (viewMode && CAP_LIKE.has(productKey) && swapProduct)
    ? { ...product, analytics: swapProduct.analytics, footer: { ...swapProduct.footer, structureLabel: product.footer.structureLabel } }
    : product, [viewMode, productKey, product, swapProduct])
  const status = bookedTrade?.status || 'PENDING'

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={winRef}
      className="tbw-window"
      style={{ left: pos.x + 'px', top: pos.y + 'px' }}
      onMouseDown={handleWindowMouseDown}
    >
      <div className="tbw-header">
        <div className="tbw-traffic-lights">
          <button
            type="button"
            className="tbw-light tbw-light-r"
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onClose && onClose() }}
            title="Close"
          />
          <span
            className="tbw-light tbw-light-y"
            onMouseDown={e => e.stopPropagation()}
            title="Minimize (n/a)"
          />
          <span
            className="tbw-light tbw-light-g"
            onMouseDown={e => e.stopPropagation()}
            title="Maximize (n/a)"
          />
        </div>
        <div className="tbw-title" style={bookedTrade && !viewMode ? { color: 'var(--accent)' } : {}}>
          {booking
            ? 'BOOKING...'
            : viewMode
              ? (bookedTrade.trade_ref || bookedTrade.id) + ' · ' + status
              : bookedTrade
                ? '✓ BOOKED · ' + (bookedTrade.trade_ref || bookedTrade.id)
                : bookErr
                  ? 'ERROR: ' + bookErr
                  : 'NEW TRADE'}
          {viewMode && theirRef && (
            <span className="tbw-ids" title={`${theirRef.firm}'s own ref for this trade`}>
              THEIR REF <b>{theirRef.trade_ref}</b>
            </span>
          )}
          {viewMode && bookedTrade.uti && (
            <span className="tbw-ids tbw-no-drag" onClick={copyUti} onMouseDown={e => e.stopPropagation()}
                  style={{ cursor: 'pointer' }}
                  title={`${bookedTrade.uti}\nThe same on both parties' bookings. Click to copy.`}>
              UTI <b>{utiCopied ? 'COPIED' : shortUti(bookedTrade.uti)}</b>
            </span>
          )}
        </div>
        {viewMode && (
          <span className="tbw-status-badge tbw-no-drag"
                style={{ marginLeft: 'auto', marginRight: 12, color: STATUS_COLOR[status] || 'var(--text-dim)' }}>
            {status}
          </span>
        )}
        {bookedTrade && !viewMode && (
          <div className="tbw-no-drag" style={{ display: 'flex', gap: '8px', marginLeft: 'auto', marginRight: '12px' }}>
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); handleViewTrade() }}
              style={{ fontSize: '0.8125rem', fontWeight: 700, padding: '2px 8px', borderRadius: '2px', cursor: 'pointer', fontFamily: "'IBM Plex Mono',var(--mono)", background: 'rgba(217,178,92,0.08)', border: '1px solid var(--accent)', color: 'var(--accent)' }}
            >VIEW IN BLOTTER</button>
            <button
              type="button"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); handleNewTrade() }}
              style={{ fontSize: '0.8125rem', fontWeight: 700, padding: '2px 8px', borderRadius: '2px', cursor: 'pointer', fontFamily: "'IBM Plex Mono',var(--mono)", background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-dim)' }}
            >NEW TRADE</button>
          </div>
        )}
      </div>

      <TabBar active={activeTab} onTab={setActiveTab} />

      {/* TRADE content stays mounted (hidden when tab != TRADE) so auto-fetch
          effects in SwapTermsBody don't re-fire every tab switch. */}
      <div style={{ display: activeTab === 'TRADE' ? 'block' : 'none' }}>
        {/* View mode: the whole ticket is read-only — a disabled fieldset
            disables every input, select and chip inside it at once. */}
        <fieldset className="tbw-fieldset" disabled={viewMode}>
        <InstrumentSelector
          assetClasses={[...new Set([...ASSET_ORDER, ...listAssetClasses()])]}
          activeAssetClass={assetClass}
          onAssetClassChange={(c) => { if (!['RATES', 'FX', 'CRYPTO'].includes(c)) return; setAssetClass(c); setFxQuote(null); setFxLegs([]); setLegQuotes({}); setBookedLegs(null); if (c === 'FX') setCurInst('FX_FORWARD'); if (c === 'CRYPTO') setCurInst('CRYPTO_FORWARD') }}
          products={isCurrency ? CURRENCY_PRODUCTS[assetClass] : listProductsByAssetClass(product.assetClass)}
          activeProductKey={isCurrency ? curInst : productKey}
          onProductChange={isCurrency ? (k) => { setCurInst(k); setFxQuote(null); setFxLegs([]); setLegQuotes({}); setBookedLegs(null) } : setProductKey}
          structures={isCurrency ? [] : product.structures}
          activeStructure={structure}
          onStructureChange={setStructure}
        />

        <CounterpartyBlock
          state={economics}
          onChange={patch => setEconomics(e => ({ ...e, ...patch }))}
          refData={refData}
        />

        {isCurrency && !viewMode && (<>
            <FxCryptoPanel ref={fxRef} ac={assetClass} inst={curInst} valuationSlot={valuationSlot} onPriced={(q, meta) => { setFxQuote(q); setFxStale(!!(q && meta?.stale)) }} onError={(m) => setBookErr(m)} />
          </>)}
        {!isCurrency && (<>
        <PrimaryEconomics
          state={economics}
          direction={direction}
          directionLabels={product.direction(state)}
          onDirectionChange={setDirection}
          onChange={patch => setEconomics(e => ({ ...e, ...patch }))}
        />

        <ProductTerms
          descriptor={product}
          state={state}
          update={updateProductState}
        />

        {product.optionFee && (
          <OptionFeeBlock
            spec={product.optionFee}
            state={state}
            update={updateProductState}
          />
        )}
        </>)}
        </fieldset>

        {/* View mode, currency trade: the term sheet as booked and the
            valuation /price returned for it (FxCryptoPanel is a ticket, not a view). */}
        {isCurrency && viewMode && (<>
          {error && <div className="tbw-sec"><div className="tbw-error">{error}</div></div>}
          {!fxQuote && pricing && <div className="tbw-sec tbw-mut">valuing…</div>}
          <FxDetailsPanel quote={fxQuote} terms={fxTerms} crypto={assetClass === 'CRYPTO'} booked />
        </>)}

        {/* TRADE holds what the user sets. What comes back (the valuation, the flows) is on CASHFLOWS, and its
            headline figures are in the footer on every tab; only a price that failed is said here, under the terms. */}
        {!isCurrency && error && (
          <div className="tbw-sec" data-testid="price-error"><div className="tbw-error">{error}</div></div>
        )}
      </div>

      {tabsVisited['CASHFLOWS'] && !isCurrency && (
        <div style={{ display: activeTab === 'CASHFLOWS' ? 'block' : 'none' }}>
          {/* the flows first, as the tab is named; under them the valuation: each figure with its formula, and what the price was built from */}
          <CashflowsPanel result={result} productKey={productKey} state={state} />
          <AnalyticsBlock
            descriptor={displayProduct}
            result={result}
            pricing={pricing || !!awaitingPar}
            error={error}
            state={state}
          />
        </div>
      )}

      {tabsVisited['DETAILS'] && !isCurrency && (
        <div style={{ display: activeTab === 'DETAILS' ? 'block' : 'none' }}>
          <DetailsPanel
            productKey={productKey}
            state={state}
            direction={direction}
            setProductState={setProductState}
          />
        </div>
      )}

      {tabsVisited['DETAILS'] && isCurrency && (
        <div style={{ display: activeTab === 'DETAILS' ? 'block' : 'none' }}>
          {legsFor && !viewMode && fxQuote && (
            <div className="tbw-no-drag">
              <FxLegs first={fxRef.current?.firstLeg?.() || null} quote={fxQuote} legs={fxLegs} setLegs={setFxLegs} quotes={legView} crypto={assetClass === 'CRYPTO'} defaults={fxRef.current?.legDefaults?.() || {}}
                dp={assetClass === 'CRYPTO' ? 2 : fxQuote.pair === 'USDJPY' ? 3 : 5} locked={!!bookedTrade} booked={bookedLegs} stale={fxStale} />
            </div>
          )}
          <FxDetailsPanel quote={fxQuote} terms={fxTerms} crypto={assetClass === 'CRYPTO'} active={activeTab === 'DETAILS'} stale={fxStale}
            booked={viewMode || (!!bookedTrade && !!fxQuote && bookedFxQuote === fxQuote && !fxStale)} />
        </div>
      )}
      {tabsVisited['CASHFLOWS'] && isCurrency && (
        <div style={{ display: activeTab === 'CASHFLOWS' ? 'block' : 'none' }}>
          <FxCashflowsPanel quote={fxQuote} crypto={assetClass === 'CRYPTO'} active={activeTab === 'CASHFLOWS'} stale={fxStale} pkg={pkg} />
          {/* the valuation under the flows is the ticket's own: with further legs it is leg 1's, and says so */}
          {pkg && <div data-testid="fx-cf-leg1-valuation" className="tbw-leg1-valuation">LEG 1 · THE TICKET'S OWN VALUATION<span> the package's figures are above and in the footer</span></div>}
          <div ref={setValuationSlot} className={pkg ? 'tbw-valuation-slot tbw-valuation-slot-named' : 'tbw-valuation-slot'} />
        </div>
      )}
      {tabsVisited['CURVE SCENARIO'] && isCurrency && (
        <div style={{ display: activeTab === 'CURVE SCENARIO' ? 'block' : 'none' }}>
          <FxScenarioPanel quote={fxQuote} terms={fxTerms} crypto={assetClass === 'CRYPTO'} active={activeTab === 'CURVE SCENARIO'} stale={fxStale} pkg={pkg} />
        </div>
      )}
      {tabsVisited['XVA'] && isCurrency && (
        <div style={{ display: activeTab === 'XVA' ? 'block' : 'none' }}>
          <FxXvaPanel
            quote={fxQuote}
            counterpartyId={economics.counterpartyId || null}
            counterpartyName={counterpartyName}
            buildTrade={buildCurrencyTrade}
            tradeId={incrementalTradeId}
            stale={fxStale}
            legs={xvaLegs}
            crypto={assetClass === 'CRYPTO'}
          />
        </div>
      )}

      {tabsVisited['XVA'] && !isCurrency && (
        <div style={{ display: activeTab === 'XVA' ? 'block' : 'none' }}>
          <XvaPanel
            productKey={productKey}
            state={state}
            direction={direction}
            result={result}
            xvaParamsRef={xvaParamsRef}
            onSimResult={setXvaSimResult}
            counterpartyId={economics.counterpartyId || null}
            counterpartyName={counterpartyName}
            buildTrade={buildRatesTrade}
            tradeId={incrementalTradeId}
          />
        </div>
      )}

      {tabsVisited['CAPITAL'] && (
        <div style={{ display: activeTab === 'CAPITAL' ? 'block' : 'none' }}>
          <CapitalTab
            counterpartyId={economics.counterpartyId || null}
            counterpartyName={counterpartyName}
            buildTrade={isCurrency ? buildCurrencyTrade : buildRatesTrade}
            tradeId={incrementalTradeId}
            priced={isCurrency ? !!fxQuote : !!result}
            ccy="USD"
          />
        </div>
      )}

      {tabsVisited['CURVE SCENARIO'] && !isCurrency && (
        <div style={{ display: activeTab === 'CURVE SCENARIO' ? 'block' : 'none' }}>
          <ScenarioPanel
            productKey={productKey}
            state={state}
            direction={direction}
            result={result}
          />
        </div>
      )}

      {/* Sprint 12 item 3 — CONFIRM tab */}
      {tabsVisited['◆ CONFIRM'] && (
        <div style={{ display: activeTab === '◆ CONFIRM' ? 'block' : 'none' }}>
          <ConfirmPanel
            bookedTrade={bookedTrade}
            pkg={tradePackage}
            pkgPending={!!pendingPackage}
            confirming={confirming}
            cancelling={cancelling}
            confirmErr={confirmErr}
            cancelErr={cancelErr}
            onConfirm={handleConfirm}
            attestation={attestation}
            onVerify={handleVerify}
            onDownloadProof={handleDownloadProof}
            onCopyProofLink={handleCopyProofLink}
            onTerminate={handleTerminate}
            terminating={terminating}
            verifying={verifying}
            verifyResult={verifyResult}
            onCancelTrade={handleCancelTrade}
            onRemoteConfirmed={handleRemoteConfirmed}
          />
          {attestation && !attestation.attestation && ['CONFIRMED', 'TERMINATED'].includes(status) && (
            <div className="tbw-sec tbw-mut">
              {attestation.error
                ? 'Could not load the confirmation record: ' + attestation.error
                : 'Confirmed off-chain: no signatures and nothing anchored, so there is no on-chain record for this trade.'}
            </div>
          )}
        </div>
      )}

      {activeTab !== 'TRADE' && activeTab !== 'CASHFLOWS' && activeTab !== 'DETAILS' && activeTab !== 'XVA' && activeTab !== 'CAPITAL' && activeTab !== 'CURVE SCENARIO' && activeTab !== '◆ CONFIRM' && (
        <div className="tbw-placeholder">
          — {activeTab} tab not yet wired in the unified shell —
        </div>
      )}

      <TradeFooter
        stale={isCurrency && fxStale}
        descriptor={isCurrency ? currencyFooter : displayProduct}
        result={isCurrency ? fxQuote : result}
        state={state}
        pricing={pricing || !!awaitingPar}
        onPrice={isCurrency && !viewMode ? () => fxRef.current?.price() : handlePrice}   // a booked currency trade has no ticket panel: PRICE revalues it as booked
        onBook={isCurrency ? handleBookCurrency : handleBook}
        booking={booking}
        bookErr={bookErr}
        booked={!!bookedTrade}
        bookWord={isCurrency && legsFor && !viewMode && fxLegs.length ? `BOOK ${fxLegs.length + 1} LEGS` : undefined}
        bookDisabled={!viewMode && (!economics.counterpartyId || !economics.ownEntityId)}
        bookTitle={!economics.counterpartyId ? 'choose a counterparty first' : 'choose an own entity first'}
        onCancel={onClose}
      />
    </div>
  )
}

// ── Supabase session cache helper (lifted from Sprint 9.1) ─────────────────

async function getSessionWithCache(ref) {
  const deadline = new Promise((_, r) =>
    setTimeout(() => r(new Error('SESSION_TIMEOUT')), 5000))
  try {
    const s = await Promise.race([getSession(), deadline])
    if (s?.access_token) ref.current = { ...s, _cachedAt: Date.now() }
    return s
  } catch (e) {
    if (e?.message === 'SESSION_TIMEOUT' && ref.current) {
      console.warn('[tw] getSession hung, using cached session')
      return ref.current
    }
    throw e
  }
}

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

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
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
import { executeBooking, buildBookingBody, confirmTrade, cancelTrade, confirmTradeOnChain, getAttestation, verifyTradeOnChain, getProofPack, terminateOnChain, INDEX_CURVE } from './booking'
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
  const [assetClass, setAssetClass]    = useState(view0?.assetClass || product?.assetClass || 'RATES')
  const [curInst, setCurInst]          = useState(view0?.curInst || 'FX_FORWARD')
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
  const n0 = (v) => { const n = Math.round(Number(v) || 0); return (n === 0 ? 0 : n).toLocaleString(undefined, { maximumFractionDigits: 0 }) }   // never "-0"
  const currencyFooter = {
    footer: {
      structureLabel: () => (curInst === 'FX_OPTION' && fxTerms?.style ? fxTerms.style.replace(/_/g, ' ') : (SHAPE_OF[curInst] || 'FORWARD')),
      metrics: (r) => r ? [
        { label: 'NET NPV ' + r.quote_currency, value: n0(r.npv), colorBy: r.npv >= 0 ? 'pos' : 'neg' },
        { label: DELTA_LABEL(assetClass === 'CRYPTO'), value: n0(r.spot01 ?? r.delta_quote_per_pct), colorBy: (r.spot01 ?? r.delta_quote_per_pct) >= 0 ? 'pos' : 'neg' },
        { label: 'IR01', value: n0(r.ir01 ?? (r.rho_base_per_bp + r.rho_quote_per_bp)) },
        ...(assetClass === 'CRYPTO'
          ? [{ label: 'FUND01', value: n0(r.fund01 ?? r.ir01_base ?? r.rho_base_per_bp ?? 0) }]
          : [{ label: 'IR01 DISC', value: n0(r.ir01_disc ?? r.rho_quote_per_bp) }]),
        { label: 'THETA', value: n0(r.theta ?? 0), colorBy: (r.theta ?? 0) >= 0 ? 'pos' : 'neg' },
        ...(r.shape === 'OPTION' ? [{ label: 'VEGA / 1pt', value: n0(r.vega ?? 0), colorBy: (r.vega ?? 0) >= 0 ? 'pos' : 'neg' }] : []),
      ] : [],
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
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef(null)

  const handleWindowMouseDown = (e) => {
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
    const rect = e.currentTarget.getBoundingClientRect()
    if (
      e.clientX >= rect.right - 20 &&
      e.clientY >= rect.bottom - 20
    ) return
    dragStartRef.current = {
      px: pos.x, py: pos.y,
      mx: e.clientX, my: e.clientY,
    }
    setDragging(true)
  }

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
      if (!fxRef.current?.quote()) { const q = await fxRef.current?.price(); if (!q) throw new Error('Price it first') }
      const body = fxRef.current.payload()
      const today = new Date().toISOString().slice(0, 10)
      const session = await getSessionWithCache(sessionCacheRef)
      const res = await fetch(API + '/api/trades/', {
        method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, own_legal_entity_id: economics.ownEntityId, counterparty_id: economics.counterpartyId,
                               desk: economics.desk || null, book: economics.book || null, trade_date: today, effective_date: today }),
      })
      const t = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof t.detail === 'string' ? t.detail : (t.detail ? JSON.stringify(t.detail) : 'Booking failed'))
      setBookedTrade(t)
      try { useTradesStore.getState().fetchTrades?.() } catch { /* ignore: blotter refresh is best effort */ }
      onBook?.({ productKey: body.instrument_type, trade: t })
    } catch (e) {
      setBookErr(e.message || String(e))
    } finally {
      setBooking(false)
    }
  }, [booking, pricing, economics, onBook])

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

  // Sprint 12 item 3 — CONFIRM handler: PENDING -> CONFIRMED
  const handleConfirm = useCallback(async (mode = 'chain') => {
    if (!bookedTrade?.id) return
    if (confirming || cancelling) return
    setConfirmErr(''); setConfirming(true)
    try {
      // Default path signs the canonical trade hash for both parties and
      // anchors it (TradeConfirmationRegistry). 'offchain' is the plain
      // status flip for environments with no signing keys configured.
      const r = mode === 'offchain'
        ? await confirmTrade(bookedTrade.id)
        : await confirmTradeOnChain(bookedTrade.id)
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
  }, [bookedTrade, confirming, cancelling, productKey, onBook])

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
    setBookedTrade(null); setResult(null); setError(''); setBookErr('')
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

  // Drag-to-move: mousemove updates pos, mouseup ends drag (Patch 8).
  useEffect(() => {
    if (!dragging) return
    const onMove = (e) => {
      const s = dragStartRef.current
      if (!s) return
      setPos({
        x: s.px + e.clientX - s.mx,
        y: s.py + e.clientY - s.my,
      })
    }
    const onUp = () => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

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
              style={{ fontSize: '0.8125rem', fontWeight: 700, padding: '2px 8px', borderRadius: '2px', cursor: 'pointer', fontFamily: "'IBM Plex Mono',var(--mono)", background: 'rgba(13,212,168,0.08)', border: '1px solid var(--accent)', color: 'var(--accent)' }}
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
          assetClasses={[...new Set([...listAssetClasses(), 'FX', 'CRYPTO'])]}
          activeAssetClass={assetClass}
          onAssetClassChange={(c) => { if (!['RATES', 'FX', 'CRYPTO'].includes(c)) return; setAssetClass(c); setFxQuote(null); if (c === 'FX') setCurInst('FX_FORWARD'); if (c === 'CRYPTO') setCurInst('CRYPTO_FORWARD') }}
          products={isCurrency ? CURRENCY_PRODUCTS[assetClass] : listProductsByAssetClass(product.assetClass)}
          activeProductKey={isCurrency ? curInst : productKey}
          onProductChange={isCurrency ? (k) => { setCurInst(k); setFxQuote(null) } : setProductKey}
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
            <FxCryptoPanel ref={fxRef} ac={assetClass} inst={curInst} onPriced={setFxQuote} onError={(m) => setBookErr(m)} />
            <XVASummary result={fxQuote} />
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
          <FxDetailsPanel quote={fxQuote} terms={fxTerms} crypto={assetClass === 'CRYPTO'} />
          <XVASummary result={fxQuote} />
        </>)}

        {!isCurrency && (<>
        <AnalyticsBlock
          descriptor={displayProduct}
          result={result}
          pricing={pricing || !!awaitingPar}
          error={error}
          state={state}
        />

        <XVASummary result={result} />
        </>)}
      </div>

      {tabsVisited['CASHFLOWS'] && !isCurrency && (
        <div style={{ display: activeTab === 'CASHFLOWS' ? 'block' : 'none' }}>
          <CashflowsPanel result={result} productKey={productKey} state={state} />
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
          <FxDetailsPanel quote={fxQuote} terms={fxTerms} crypto={assetClass === 'CRYPTO'} />
        </div>
      )}
      {tabsVisited['CASHFLOWS'] && isCurrency && (
        <div style={{ display: activeTab === 'CASHFLOWS' ? 'block' : 'none' }}>
          <FxCashflowsPanel quote={fxQuote} crypto={assetClass === 'CRYPTO'} />
        </div>
      )}
      {tabsVisited['CURVE SCENARIO'] && isCurrency && (
        <div style={{ display: activeTab === 'CURVE SCENARIO' ? 'block' : 'none' }}>
          <FxScenarioPanel quote={fxQuote} terms={fxTerms} crypto={assetClass === 'CRYPTO'} />
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
        descriptor={isCurrency ? currencyFooter : displayProduct}
        result={isCurrency ? fxQuote : result}
        state={state}
        pricing={pricing || !!awaitingPar}
        onPrice={isCurrency && !viewMode ? () => fxRef.current?.price() : handlePrice}   // a booked currency trade has no ticket panel: PRICE revalues it as booked
        onBook={isCurrency ? handleBookCurrency : handleBook}
        booking={booking}
        bookErr={bookErr}
        booked={!!bookedTrade}
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

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

// Import all product modules to register them at load time.
// Adding FX/credit = add one import line here.
import './products/rates'
import useMarketDataStore from '../../store/useMarketDataStore'
import { supabase } from '../../lib/supabase'
// import './products/fx'
// import './products/credit'
// import './products/equity'
// import './products/commodity'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

// Currency → curve ID mapping. Mirrors legacy TradeBookingWindow.CCY_CURVE.
const CCY_CURVE = {
  USD: 'USD_SOFR', EUR: 'EUR_ESTR', GBP: 'GBP_SONIA',
  JPY: 'JPY_TONA', CHF: 'CHF_SARON', AUD: 'AUD_AONIA',
  CAD: 'CAD_CORRA',
}

// YYYY-MM-DD in local time (not UTC) — matches legacy.
function localDate() {
  const n = new Date()
  const p = x => String(x).padStart(2, '0')
  return n.getFullYear() + '-' + p(n.getMonth() + 1) + '-' + p(n.getDate())
}

// Supabase session fetch — used by getSessionWithCache below.
async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
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

export default function TradeWindow({ onClose, onBook, initialProduct = 'IR_SWAP' }) {
  const [productKey, setProductKey]   = useState(initialProduct)
  const product                        = getProduct(productKey)
  if (!product) throw new Error(`Unknown product: ${productKey}`)

  const { curves, curveInterp }        = useMarketDataStore()

  const [structure, setStructure]      = useState(product.defaultStructure)
  const [direction, setDirection]      = useState('PAY')
  const [economics, setEconomics]      = useState({
    notional: 10_000_000, ccy: 'USD', tenor: '5Y',
    effDate: null, matDate: null, tradeDate: null,
    valDate: null,
  })
  const [productState, setProductState] = useState({})
  const [result, setResult]             = useState(null)
  const [pricing, setPricing]           = useState(false)
  const [error, setError]               = useState('')

  // ── Window chrome state (Patch 8): active tab + drag position ──────────
  const [activeTab, setActiveTab] = useState('TRADE')

  // Patch 21: XVA integration — params ref for XVATab to write to,
  // sim result state for shell-level consumption later.
  const xvaParamsRef = useRef(null)
  const [xvaSimResult, setXvaSimResult] = useState(null)
  const [pos, setPos] = useState(() => ({
    x: Math.max(10, (typeof window !== 'undefined' ? window.innerWidth : 1400) - 1170) / 2,
    y: 30,
  }))
  const [dragging, setDragging] = useState(false)
  const dragStartRef = useRef(null)

  const handleWindowMouseDown = (e) => {
    // Skip drag if the user is interacting with a form control or button.
    // Uses .closest() so we catch clicks on nested spans/icons too.
    if (e.target.closest(
      'input, select, textarea, button, [contenteditable], [role="button"]'
    )) return
    dragStartRef.current = {
      px: pos.x, py: pos.y,
      mx: e.clientX, my: e.clientY,
    }
    setDragging(true)
  }

  // Reset state when product changes — each product owns its own state shape
  useEffect(() => {
    setStructure(product.defaultStructure)
    setProductState({})
    setResult(null)
    setError('')
  }, [productKey])

  // Set valuation date and trade date to today on mount — mirrors legacy.
  useEffect(() => {
    const today = localDate()
    setEconomics(e => ({ ...e, valDate: today, tradeDate: today }))
  }, [])

  const state = useMemo(() => ({
    productKey, structure, direction, ...economics, ...productState,
  }), [productKey, structure, direction, economics, productState])

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
    setPricing(true); setError(''); setResult(null)

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const abortTimer = setTimeout(() => ac.abort(),
                                  product.pricing.timeoutMs || 30000)

    try {
      const endpoint = typeof product.pricing.endpoint === 'function'
        ? product.pricing.endpoint(state) : product.pricing.endpoint
      const curveId  = CCY_CURVE[state.ccy] || 'USD_SOFR'
      const payload  = {
        ...product.pricing.buildPayload(state),
        curves: [{
          curve_id: curveId,
          quotes: [],
          interp_method: curveInterp?.[curveId] || 'LogLinearDiscount',
        }],
      }

      // Session with 5s deadline + cache fallback (copied pattern from Sprint 9.1)
      const session = await getSessionWithCache(sessionCacheRef)

      const res = await fetch(API + endpoint, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: ac.signal,
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Pricing failed')

      setResult(product.pricing.parseResponse(data))
    } catch (e) {
      if (e?.name === 'AbortError') setError('Pricing request aborted')
      else setError(e.message)
    } finally {
      clearTimeout(abortTimer)
      setPricing(false)
    }
  }, [pricing, product, state])

  // Safety net — auto-clear stuck pricing flag after 20s (Sprint 9.1 pattern)
  useEffect(() => {
    if (!pricing) return
    const t = setTimeout(() => {
      console.warn('[safety-net] pricing stuck >20s, forcing false')
      setPricing(false)
    }, 20000)
    return () => clearTimeout(t)
  }, [pricing])

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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
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
        <div className="tbw-title">NEW TRADE</div>
      </div>

      <TabBar active={activeTab} onTab={setActiveTab} />

      {/* TRADE content stays mounted (hidden when tab != TRADE) so auto-fetch
          effects in SwapTermsBody don't re-fire every tab switch. */}
      <div style={{ display: activeTab === 'TRADE' ? 'block' : 'none' }}>
        <InstrumentSelector
          assetClasses={listAssetClasses()}
          activeAssetClass={product.assetClass}
          products={listProductsByAssetClass(product.assetClass)}
          activeProductKey={productKey}
          onProductChange={setProductKey}
          structures={product.structures}
          activeStructure={structure}
          onStructureChange={setStructure}
        />

        <CounterpartyBlock />

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

        <AnalyticsBlock
          descriptor={product}
          result={result}
          pricing={pricing}
          error={error}
          state={state}
        />

        <XVASummary result={result} />
      </div>

      {activeTab === 'CASHFLOWS' && (
        <CashflowsPanel result={result} productKey={productKey} state={state} />
      )}

      {activeTab === 'DETAILS' && (
        <DetailsPanel
          productKey={productKey}
          state={state}
          direction={direction}
          setProductState={setProductState}
        />
      )}

      {activeTab === 'XVA' && (
        <XvaPanel
          productKey={productKey}
          state={state}
          direction={direction}
          result={result}
          xvaParamsRef={xvaParamsRef}
          onSimResult={setXvaSimResult}
        />
      )}

      {activeTab === 'CURVE SCENARIO' && (
        <ScenarioPanel
          productKey={productKey}
          state={state}
          direction={direction}
          result={result}
        />
      )}

      {activeTab !== 'TRADE' && activeTab !== 'CASHFLOWS' && activeTab !== 'DETAILS' && activeTab !== 'XVA' && activeTab !== 'CURVE SCENARIO' && (
        <div className="tbw-placeholder">
          — {activeTab} tab not yet wired in the unified shell —
        </div>
      )}

      <TradeFooter
        descriptor={product}
        result={result}
        state={state}
        pricing={pricing}
        onPrice={handlePrice}
        onBook={() => onBook({ productKey, state, result })}
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

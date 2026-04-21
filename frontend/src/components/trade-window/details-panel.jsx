// trade-window/details-panel.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// DetailsPanel — adapter that mounts the legacy LegDetailsTab component
// inside the unified TradeWindow shell. Builds adapter refs and setters
// from the shell's state model. (Patch 20)
//
// Legacy LegDetailsTab expects DOM-style refs (notionalRef, rateRef,
// spreadRef) via props. The unified shell uses controlled React state.
// We synthesize plain-object refs on each render that expose a .current
// .value string — read-only for legacy's purposes.
// ────────────────────────────────────────────────────────────────────────────────────

import { useRef, useMemo } from 'react'
import LegDetailsTab from '../blotter/LegDetailsTab'
import { supabase } from '../../lib/supabase'

const getSession = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// Functional-or-plain setter factory.
// Produces a setter compatible with both setX(val) and setX(prev => next).
function makeFieldSetter(setProductState, field, defaultValue = []) {
  return (v) => {
    setProductState(p => {
      const prev = p[field] !== undefined ? p[field] : defaultValue
      const next = typeof v === 'function' ? v(prev) : v
      return { ...p, [field]: next }
    })
  }
}

export default function DetailsPanel({
  productKey,
  state,
  direction,
  setProductState,
}) {
  // scheduleRef is a sync handoff point LegDetailsTab writes to on every
  // schedule derivation. The shell doesn't need to read it — the setters
  // also fire — but LegDetailsTab expects the prop.
  const scheduleRef = useRef({})

  // Adapter refs — read-only snapshots of current state. Rebuilt each
  // render so LegDetailsTab sees fresh values when it reads ref.current.
  const notionalRef = useMemo(() => ({
    current: { value: String(state.notional != null ? state.notional : 10000000) },
  }), [state.notional])

  const rateRef = useMemo(() => {
    const couponStr = String(state.coupon || '')
    // Coupon may be 'auto', 'PAR', or numeric. Fall back to parRate.
    const numericCoupon = /^-?\d*\.?\d+$/.test(couponStr) ? couponStr : ''
    const rateVal = numericCoupon || (state.parRate != null ? String(state.parRate) : '')
    return { current: { value: rateVal } }
  }, [state.coupon, state.parRate])

  const spreadRef = useMemo(() => ({
    current: { value: String(state.spread != null ? state.spread : '0') },
  }), [state.spread])

  // Setters for schedule state. All routed through setProductState.
  const setRateSchedule     = useMemo(() => makeFieldSetter(setProductState, 'rateSchedule',     []),    [setProductState])
  const setNotionalSchedule = useMemo(() => makeFieldSetter(setProductState, 'notionalSchedule', []),    [setProductState])
  const setSpreadSchedule   = useMemo(() => makeFieldSetter(setProductState, 'spreadSchedule',   []),    [setProductState])
  const setFeeSchedule      = useMemo(() => makeFieldSetter(setProductState, 'feeSchedule',      []),    [setProductState])
  const setZcToggle         = useMemo(() => makeFieldSetter(setProductState, 'zcToggle',         false), [setProductState])

  // Simple deriveStructLabel fallback. Legacy had a rich derivation
  // across step-up / amortizing / spread / ZC combinations; for Phase 2
  // we just return the current structure from state, which is what the
  // DETAILS banner displays. A richer derivation can be added later.
  const deriveStructLabel = () => {
    if (state.zcToggle) return 'ZERO_COUPON'
    const hasRate     = (state.rateSchedule     || []).length > 0
    const hasNotional = (state.notionalSchedule || []).length > 0
    const hasSpread   = (state.spreadSchedule   || []).length > 0
    const n = [hasRate, hasNotional, hasSpread].filter(Boolean).length
    if (n === 0)         return state.structure || 'VANILLA'
    if (n >= 3)          return 'CUSTOM_SWAP'
    if (hasRate && hasSpread)     return 'STEP_UP_SPREAD'
    if (hasRate && hasNotional)   return 'STEP_UP_AMORTIZING'
    if (hasNotional && hasSpread) return 'AMORTIZING_SPREAD'
    if (hasRate)     return 'STEP_UP'
    if (hasNotional) return 'AMORTIZING'
    if (hasSpread)   return 'SPREAD_SWAP'
    return state.structure || 'VANILLA'
  }

  const floatDir = direction === 'PAY' ? 'RECEIVE' : 'PAY'

  return (
    <LegDetailsTab
      // Structure & direction
      struct={state.structure || 'VANILLA'}
      dir={direction}
      floatDir={floatDir}
      inst={productKey}

      // Economics
      ccy={state.ccy || 'USD'}
      index={state.index || 'SOFR'}
      effDate={state.effDate}
      matDate={state.matDate}
      valDate={state.valDate}
      parRate={state.parRate}

      // Adapter refs
      notionalRef={notionalRef}
      rateRef={rateRef}
      spreadRef={spreadRef}

      // Fixed leg conventions
      fixedPayFreq={state.fixedPayFreq || 'ANNUAL'}
      fixedDc={state.fixedDc || 'ACT/360'}
      fixedBdc={state.fixedBdc || 'MOD_FOLLOWING'}
      fixedCal={state.fixedCal || 'NEW_YORK'}

      // Float leg conventions
      floatPayFreq={state.floatPayFreq || 'ANNUAL'}
      floatDc={state.floatDc || 'ACT/360'}
      floatBdc={state.floatBdc || 'MOD_FOLLOWING'}
      floatCal={state.floatCal || 'NEW_YORK'}
      floatResetFreq={state.floatResetFreq || 'DAILY'}

      // BASIS second float leg
      index2={state.index2}
      floatDc2={state.floatDc2}
      floatPayFreq2={state.floatPayFreq2}
      floatResetFreq2={state.floatResetFreq2}

      // Schedules (controlled via shell product state)
      zcToggle={state.zcToggle || false}
      setZcToggle={setZcToggle}
      rateSchedule={state.rateSchedule || []}
      setRateSchedule={setRateSchedule}
      notionalSchedule={state.notionalSchedule || []}
      setNotionalSchedule={setNotionalSchedule}
      spreadSchedule={state.spreadSchedule || []}
      setSpreadSchedule={setSpreadSchedule}
      scheduleRef={scheduleRef}

      // Swaption option fee
      feeSchedule={state.feeSchedule || []}
      setFeeSchedule={setFeeSchedule}
      feeAmount={state.feeAmount || ''}
      feeAmountType={state.feeAmountType || 'BP'}
      feeSettleDate={state.feeSettleDate || ''}
      exerciseType={state.exerciseType || 'EUROPEAN'}

      // Helpers
      deriveStructLabel={deriveStructLabel}
      getSession={getSession}
    />
  )
}

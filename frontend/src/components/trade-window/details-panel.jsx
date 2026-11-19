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
import { getSessionMaybe } from '../../lib/session'

const getSession = async () => {
  const session = await getSessionMaybe()
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
  locked = false,          // a booked trade: the schedules are read, not edited
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
  // Sprint 12 — CAPPED_FLOATER / FLOORED_FLOATER setters
  const setCapStrikeSchedule   = useMemo(() => makeFieldSetter(setProductState, 'capStrikeSchedule',   []),     [setProductState])
  const setFloorStrikeSchedule = useMemo(() => makeFieldSetter(setProductState, 'floorStrikeSchedule', []),     [setProductState])
  const setCapFloorDirection   = useMemo(() => makeFieldSetter(setProductState, 'capFloorDirection',   'SELL'), [setProductState])

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

  // The schedules below are a swap's: a coupon, a spread or a notional by period, read by the swap's price and
  // booked on its legs. On a cap, a floor, a collar and a swaption nothing read them (the price is of one strike
  // and one notional; a swaption's of the delivered swap's two dates), and a swaption's fee schedule here was read
  // by nothing since the FEES block. So the tab says what is the case and where the periods are.
  const NOT_OPEN = {
    RATES_CAP: 'A cap', RATES_FLOOR: 'A floor', RATES_COLLAR: 'A collar', IR_SWAPTION: null,
  }
  if (productKey in NOT_OPEN) {
    return (
      <div className="tbw-sec" data-testid="details-not-open">
        <div className="tbw-lbl">SCHEDULES</div>
        <div className="tbw-terms-note" style={{ marginTop: 8 }}>
          {productKey === 'IR_SWAPTION'
            ? 'The swap a swaption delivers is priced on its two dates at the strike: a schedule of coupons, spreads or notionals on it is not open on this ticket. Its flows are on CASHFLOWS. A premium paid in instalments is entered as fees on the TRADE tab.'
            : `${NOT_OPEN[productKey]} is one leg at one notional${productKey === 'RATES_COLLAR' ? ' and two strikes' : ' and one strike'}: a schedule of strikes or notionals is not open on this ticket. Its periods, each with its forward, its vol and its value, are on CASHFLOWS.`}
        </div>
      </div>
    )
  }

  return (
    <LegDetailsTab
      locked={locked}
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

      // Sprint 12 — CAPPED_FLOATER / FLOORED_FLOATER
      capStrikeSchedule={state.capStrikeSchedule || []}
      setCapStrikeSchedule={setCapStrikeSchedule}
      floorStrikeSchedule={state.floorStrikeSchedule || []}
      setFloorStrikeSchedule={setFloorStrikeSchedule}
      capFloorDirection={state.capFloorDirection || (state.structure === 'FLOORED_FLOATER' ? 'BUY' : 'SELL')}
      setCapFloorDirection={setCapFloorDirection}

      // Helpers
      deriveStructLabel={deriveStructLabel}
      getSession={getSession}
    />
  )
}

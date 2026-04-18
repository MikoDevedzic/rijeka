// trade-window/xva-panel.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// XvaPanel — adapter that mounts the legacy XVATab component inside the
// unified TradeWindow shell. Same pattern as DetailsPanel (Patch 20).
// ────────────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react'
import XVATab from '../blotter/XVATab'
import { supabase } from '../../lib/supabase'

const getSession = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export default function XvaPanel({
  productKey,
  state,
  direction,
  result,
  xvaParamsRef,
  onSimResult,
}) {
  // Adapter refs: read-only snapshots of current state, rebuilt on change.
  const notionalRef = useMemo(() => ({
    current: { value: String(state.notional != null ? state.notional : 10000000) },
  }), [state.notional])

  const rateRef = useMemo(() => {
    const couponStr = String(state.coupon || '')
    const numericCoupon = /^-?\d*\.?\d+$/.test(couponStr) ? couponStr : ''
    const rateVal = numericCoupon || (state.parRate != null ? String(state.parRate) : '')
    return { current: { value: rateVal } }
  }, [state.coupon, state.parRate])

  return (
    <XVATab
      // Trade context — null for new trades (XVATab tolerates this)
      trade={null}

      // Adapter refs
      notionalRef={notionalRef}
      rateRef={rateRef}

      // Dates
      effDate={state.effDate}
      matDate={state.matDate}

      // Helpers
      getSession={getSession}

      // Current priced result
      analytics={result}

      // Params ref (XVATab writes, shell provides)
      xvaParamsRef={xvaParamsRef}

      // Simulation result callback
      onSimResult={onSimResult}

      // Direction + instrument
      direction={direction}
      instrumentType={productKey}

      // Swaption context (only relevant for IR_SWAPTION)
      swaptionExpiry={state.swaptionExpiry || '1Y'}
      swaptionTenor={state.tenor || '5Y'}
      swaptionVol={state.swaptionVol || '86.5'}
      swaptionResult={productKey === 'IR_SWAPTION' ? result : null}
    />
  )
}

// trade-window/scenario-panel.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// ScenarioPanel — adapter that mounts the extracted ScenarioTab inside
// the unified TradeWindow shell. Same pattern as DetailsPanel and
// XvaPanel (Patches 20 + 21).
// ────────────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react'
import ScenarioTab from '../blotter/ScenarioTab'
import useMarketDataStore from '../../store/useMarketDataStore'
import { supabase } from '../../lib/supabase'

const getSession = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// Map unified-shell product keys to the legacy `inst` values that
// ScenarioTab's IS_CAPFLOOR / IS_SWPN checks expect.
const INST_MAP = {
  IR_SWAP:       'IR_SWAP',
  IR_SWAPTION:   'IR_SWAPTION',
  RATES_CAP:     'INTEREST_RATE_CAP',
  RATES_FLOOR:   'INTEREST_RATE_FLOOR',
  RATES_COLLAR:  'INTEREST_RATE_COLLAR',
}

export default function ScenarioPanel({
  productKey,
  state,
  direction,
  result,
}) {
  const curves = useMarketDataStore(s => s.curves)

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
    <ScenarioTab
      ccy={state.ccy || 'USD'}
      index={state.index || 'SOFR'}
      dir={direction}
      struct={state.structure || 'VANILLA'}
      effDate={state.effDate}
      matDate={state.matDate}
      valDate={state.valDate}
      curves={curves}
      analytics={result}
      notionalRef={notionalRef}
      rateRef={rateRef}
      fixedPayFreq={state.fixedPayFreq || 'ANNUAL'}
      fixedDc={state.fixedDc || 'ACT/360'}
      fixedBdc={state.fixedBdc || 'MOD_FOLLOWING'}
      floatResetFreq={state.floatResetFreq || 'DAILY'}
      floatPayFreq={state.floatPayFreq || 'ANNUAL'}
      floatDc={state.floatDc || 'ACT/360'}
      floatBdc={state.floatBdc || 'MOD_FOLLOWING'}
      getSession={getSession}
      inst={INST_MAP[productKey] || productKey}
      swaptionExpiry={state.swaptionExpiry || '1Y'}
      swaptionTenor={state.tenor || '5Y'}
      swaptionVol={state.swaptionVol || '86.5'}
      swaptionResult={productKey === 'IR_SWAPTION' ? result : null}
      capResult={(productKey === 'RATES_CAP' || productKey === 'RATES_FLOOR' || productKey === 'RATES_COLLAR') ? result : null}
      capVolOverride={state.capVolOverride || ''}
      setCapVolOverride={() => {}}
      handleCapFloorPrice={() => {}}
    />
  )
}

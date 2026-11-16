// trade-window/FxRateCurve.jsx — a rate curve on the CURVE SCENARIO tab of a currency trade: its pillars' zero rates as
// the market has them (dashed) and as the scenario has them (in the factor's colour), with the trade's settlement
// marked. A pillar is dragged up or down to shock it; the shock is reported in basis points and kept by the tab.
// The drawing is ScenarioCurve.jsx, the one every product's scenario tab uses for a curve or a vol term structure.
import ScenarioCurve from './ScenarioCurve'
import { RATE_SHOCK_BOUND, tenorLabel } from './fx-scenario'

// `pillars`: [{date, t, zero_pct}] in order; `shockAt(p)`: its whole shock in bp (flat plus its own);
// `onPoint(date, bp)`: the pillar's own shock after a drag; `settleT`: the trade's settlement, in years.
export default function FxRateCurve({ pillars, shockAt, onPoint, own, flat = 0, settleT, color = 'var(--rf-ir)', disabled = false, testId = 'fx-rate-curve' }) {
  if (!pillars?.length) return null
  const byId = new Map(pillars.map(p => [p.date, p]))
  return (
    <ScenarioCurve points={pillars.map(p => ({ id: p.date, t: p.t, v: p.zero_pct, label: tenorLabel(p.t) }))} shockAt={(p) => shockAt(byId.get(p.id))}
      onPoint={onPoint} own={own} flat={flat} scale={100} bound={RATE_SHOCK_BOUND} step={1} mark={Number.isFinite(settleT) ? { t: settleT, label: 'SETTLES' } : null}
      color={color} disabled={disabled} testId={testId} ariaLabel="The curve's zero rates: market against scenario" />
  )
}

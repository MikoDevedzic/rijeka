// trade-window/FxRateCurve.jsx — a rate curve on the CURVE SCENARIO tab: its pillars' zero rates as the market has
// them (dashed) and as the scenario has them (in the factor's colour), with the trade's settlement marked. A pillar
// is dragged up or down to shock it; the shock is reported in basis points and kept by the tab. Drawn as SVG at a
// fixed coordinate size and scaled to its box, so a drag is read in the drawing's own units.
import { useRef, useState } from 'react'
import { RATE_SHOCK_BOUND, tenorLabel } from './fx-scenario'

const W = 880, H = 250, L = 64, R = 20, TOP = 18, BOT = 30

// `pillars`: [{date, t, zero_pct}] in order; `shockAt(p)`: its whole shock in bp (flat plus its own);
// `onPoint(date, bp)`: the pillar's own shock after a drag; `settleT`: the trade's settlement, in years.
export default function FxRateCurve({ pillars, shockAt, onPoint, own, flat = 0, settleT, color = 'var(--rf-ir)', disabled = false, testId = 'fx-rate-curve' }) {
  const svg = useRef(null)
  const drag = useRef(null)
  const [frozen, setFrozen] = useState(null)                          // the scale holds still while a pillar is dragged
  if (!pillars?.length) return null
  const n = pillars.length
  const market = pillars.map(p => p.zero_pct), scen = pillars.map(p => p.zero_pct + shockAt(p) / 100)
  let lo = Math.min(...market, ...scen), hi = Math.max(...market, ...scen)
  const pad = Math.max((hi - lo) * 0.25, 0.05); lo -= pad; hi += pad
  if (frozen) { lo = frozen.lo; hi = frozen.hi }
  const X = (i) => (n === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (n - 1))
  const Y = (v) => H - BOT - (v - lo) / (hi - lo) * (H - TOP - BOT)
  const path = (a) => a.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  // where the settlement falls between the pillars, on the evenly spaced axis
  let sx = null
  if (Number.isFinite(settleT)) {
    if (settleT <= pillars[0].t) sx = X(0)
    else if (settleT >= pillars[n - 1].t) sx = X(n - 1)
    else { const j = pillars.findIndex(p => p.t >= settleT); const a = pillars[j - 1], b = pillars[j]; sx = X(j - 1) + (X(j) - X(j - 1)) * (settleT - a.t) / (b.t - a.t) }
  }
  const ticks = [0, 1, 2, 3, 4].map(q => lo + (hi - lo) * q / 4)

  const down = (e, i) => {
    if (disabled) return
    drag.current = { i, y: e.clientY, bp: Number(own?.[pillars[i].date]) || 0, scale: { lo, hi } }
    setFrozen({ lo, hi })
    svg.current?.setPointerCapture?.(e.pointerId)
  }
  const move = (e) => {
    const d = drag.current
    if (!d || !svg.current) return
    const box = svg.current.getBoundingClientRect()
    const perPx = (d.scale.hi - d.scale.lo) / ((H - TOP - BOT) * box.height / H)        // % a year per pixel on screen
    const bp = Math.round(d.bp + (d.y - e.clientY) * perPx * 100)
    onPoint(pillars[d.i].date, Math.max(-RATE_SHOCK_BOUND - flat, Math.min(RATE_SHOCK_BOUND - flat, bp)))
  }
  const up = () => { drag.current = null; setFrozen(null) }

  return (
    <svg ref={svg} data-testid={testId} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The curve's zero rates: market against scenario"
         style={{ display: 'block', width: '100%', height: H, touchAction: 'none' }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {ticks.map((v, q) => (
        <g key={q}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
          <text x={L - 8} y={Y(v) + 4} textAnchor="end" fontFamily="var(--mono)" fontSize="11" fill="var(--text-mute)">{v.toFixed(2)}</text>
        </g>
      ))}
      {sx != null && <line x1={sx} x2={sx} y1={TOP - 4} y2={H - BOT + 2} stroke="var(--accent-hi)" strokeDasharray="3 4" opacity="0.7" />}
      {sx != null && <text x={sx} y={TOP - 6} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--accent-hi)">SETTLES</text>}
      <path d={path(market)} fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeDasharray="5 5" />
      <path d={path(scen)} fill="none" stroke={color} strokeWidth="2.2" />
      {pillars.map((p, i) => (
        <g key={p.date}>
          <text x={X(i)} y={H - 8} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--text-mute)">{tenorLabel(p.t)}</text>
          <circle cx={X(i)} cy={Y(scen[i])} r="6" fill="var(--bg)" stroke={color} strokeWidth="2" data-pillar={p.date}
                  style={{ cursor: disabled ? 'default' : 'ns-resize' }} onPointerDown={(e) => down(e, i)} />
        </g>
      ))}
    </svg>
  )
}

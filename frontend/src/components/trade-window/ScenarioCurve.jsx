// trade-window/ScenarioCurve.jsx — one curve on the CURVE SCENARIO tab of every product: its points as the market has
// them (dashed) and as the scenario has them (in the factor's colour), with the trade's own date marked. A point is
// dragged up or down to shock it; the shock is reported in the curve's own unit and kept by the tab. A rate curve
// (zero or par rates, shocked in basis points) and a volatility term structure (vol by expiry, shocked in vol points or
// in basis points of normal vol) are the same drawing: volatility is moved exactly as a curve is.
// Drawn as SVG at a fixed coordinate size and scaled to its box, so a drag is read in the drawing's own units.
import { useRef, useState } from 'react'

const L = 64, R = 20, TOP = 18, BOT = 30

// `points`: [{id, t, v, label}] in order (v in the axis's unit); `shockAt(p)`: its whole shock (flat plus its own), in
// the shock's unit; `onPoint(id, shock)`: the point's own shock after a drag; `own`: {id → its own shock};
// `scale`: shock units to one unit of the axis (100 bp to 1 %; 1 where the axis is in the shock's unit);
// `bound`: the largest whole shock either way; `step`: what a drag is rounded to; `mark`: {t, label} the trade's date;
// `dot`: {t, v, label} a figure of the trade's own on the curve (the vol it priced at), moved with the scenario;
// `lines`: [{values, color, dash}] other lines of the same surface, drawn thin, not dragged; `width`: the drawing's own
// width in its units (880 across a tab; half of it where two stand side by side, so the type stays its size), and
// `height` its height.
export default function ScenarioCurve({ points, shockAt, onPoint, own, flat = 0, scale = 100, bound = 300, step = 1, mark, dot, lines = [],
  decimals = 2, color = 'var(--rf-ir)', disabled = false, testId = 'scn-curve', ariaLabel = 'The curve: market against scenario', width: W = 880, height: H = 250 }) {
  const svg = useRef(null)
  const drag = useRef(null)
  const [frozen, setFrozen] = useState(null)                          // the scale holds still while a point is dragged
  if (!points?.length) return null
  const n = points.length
  const market = points.map(p => p.v), scen = points.map(p => p.v + shockAt(p) / scale)
  const also = lines.flatMap(l => l.values.filter(v => Number.isFinite(v)))
  const dotV = dot && Number.isFinite(dot.v) ? [dot.v] : []
  let lo = Math.min(...market, ...scen, ...also, ...dotV), hi = Math.max(...market, ...scen, ...also, ...dotV)
  const pad = Math.max((hi - lo) * 0.25, 5 * 10 ** -decimals); lo -= pad; hi += pad
  if (frozen) { lo = frozen.lo; hi = frozen.hi }
  const X = (i) => (n === 1 ? (L + W - R) / 2 : L + i * (W - L - R) / (n - 1))
  const Y = (v) => H - BOT - (v - lo) / (hi - lo) * (H - TOP - BOT)
  const path = (a) => a.map((v, i) => (Number.isFinite(v) ? `${i && Number.isFinite(a[i - 1]) ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}` : '')).join(' ')
  // where a time falls between the points, on the evenly spaced axis
  const xAt = (t) => {
    if (!Number.isFinite(t)) return null
    if (t <= points[0].t) return X(0)
    if (t >= points[n - 1].t) return X(n - 1)
    const j = points.findIndex(p => p.t >= t), a = points[j - 1], b = points[j]
    return X(j - 1) + (X(j) - X(j - 1)) * (t - a.t) / (b.t - a.t)
  }
  const mx = mark ? xAt(mark.t) : null, dx = dot ? xAt(dot.t) : null
  const ticks = [0, 1, 2, 3, 4].map(q => lo + (hi - lo) * q / 4)

  const down = (e, i) => {
    if (disabled) return
    drag.current = { i, y: e.clientY, s: Number(own?.[points[i].id]) || 0, scale: { lo, hi } }
    setFrozen({ lo, hi })
    svg.current?.setPointerCapture?.(e.pointerId)
  }
  const move = (e) => {
    const d = drag.current
    if (!d || !svg.current) return
    const box = svg.current.getBoundingClientRect()
    const perPx = (d.scale.hi - d.scale.lo) / ((H - TOP - BOT) * box.height / H)        // axis units per pixel on screen
    const s = Math.round((d.s + (d.y - e.clientY) * perPx * scale) / step) * step
    onPoint(points[d.i].id, Math.max(-bound - flat, Math.min(bound - flat, s)))
  }
  const up = () => { drag.current = null; setFrozen(null) }

  return (
    <svg ref={svg} data-testid={testId} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}
         style={{ display: 'block', width: '100%', height: H, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {ticks.map((v, q) => (
        <g key={q}>
          <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
          <text x={L - 8} y={Y(v) + 4} textAnchor="end" fontFamily="var(--mono)" fontSize="11" fill="var(--text-mute)">{v.toFixed(decimals)}</text>
        </g>
      ))}
      {mx != null && <line x1={mx} x2={mx} y1={TOP - 4} y2={H - BOT + 2} stroke="var(--accent-hi)" strokeDasharray="3 4" opacity="0.7" />}
      {mx != null && <text x={Math.max(L + 28, Math.min(W - R - 28, mx))} y={TOP - 6} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--accent-hi)">{mark.label}</text>}
      {lines.map((l, k) => <path key={k} d={path(l.values)} fill="none" stroke={l.color} strokeWidth="1.2" strokeDasharray={l.dash || undefined} opacity="0.85" />)}
      <path d={path(market)} fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeDasharray="5 5" />
      <path d={path(scen)} fill="none" stroke={color} strokeWidth="2.2" />
      {points.map((p, i) => (
        <g key={p.id}>
          <text x={X(i)} y={H - 8} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--text-mute)">{p.label}</text>
          <circle cx={X(i)} cy={Y(scen[i])} r="6" fill="var(--bg)" stroke={color} strokeWidth="2" data-pillar={p.id}
                  style={{ cursor: disabled ? 'default' : 'ns-resize' }} onPointerDown={(e) => down(e, i)} />
        </g>
      ))}
      {dx != null && Number.isFinite(dot.v) && (
        <g data-testid={`${testId}-dot`} data-value={dot.v}>
          <circle cx={dx} cy={Y(dot.v)} r="4.5" fill="var(--amber)" stroke="var(--bg)" strokeWidth="1.5" />
          <text x={Math.max(L + 40, Math.min(W - R - 40, dx))} y={Y(dot.v) - 10} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--amber)">{dot.label}</text>
        </g>
      )}
    </svg>
  )
}

// trade-window/ScenarioCurve.jsx — one curve on the CURVE SCENARIO tab of every product: its points as the market has
// them (dashed) and as the scenario has them (in the factor's colour), with the trade's own date marked. A point is
// dragged up or down to shock it; the shock is reported in the curve's own unit and kept by the tab. A rate curve
// (zero or par rates, shocked in basis points) and a volatility term structure (vol by expiry, shocked in vol points or
// in basis points of normal vol) are the same drawing: volatility is moved exactly as a curve is.
// Drawn as SVG at a fixed coordinate size and scaled to its box, so a drag is read in the drawing's own units.
import { useRef, useState } from 'react'
import { PLOT_BOX } from './xva-shared'

const L = 64, R = 20, TOP = 18, BOT = 30

// The axis: steps of 1, 2, 2.5 or 5 times a power of ten, about four to a chart, and the range taken out to whole steps.
const niceStep = (span, n = 4) => { const raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p }
const stepDp = (step) => { for (let d = 0; d <= 4; d++) { const x = step * 10 ** d; if (Math.abs(x - Math.round(x)) < 1e-6) return d } return 4 }
function axis(values, minPad) {
  let lo = Math.min(...values), hi = Math.max(...values)
  const pad = Math.max((hi - lo) * 0.2, minPad); lo -= pad; hi += pad
  const step = niceStep(hi - lo)
  lo = Math.floor(lo / step + 1e-9) * step; hi = Math.ceil(hi / step - 1e-9) * step
  const ticks = []; for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Number(v.toFixed(8)))
  return { lo, hi, step, ticks, dp: stepDp(step) }
}

// What the lines and the dot are, under a chart: the same words and marks on every product.
// `items`: [{ mark: 'dash' | 'line' | 'thin' | 'dot', color, text }].
export function CurveLegend({ items, testId }) {
  const sw = (i) => i.mark === 'dot'
    ? <span aria-hidden="true" style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 8, background: i.color, marginRight: 6, verticalAlign: 'middle' }} />
    : <span aria-hidden="true" style={{ display: 'inline-block', width: 18, height: 0, verticalAlign: 'middle', marginRight: 6, borderTop: `${i.mark === 'thin' ? 1 : 2}px ${i.mark === 'dash' ? 'dashed' : 'solid'} ${i.color}` }} />
  return (
    <div data-testid={testId} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginTop: 6, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
      {items.filter(Boolean).map(i => <span key={i.text} style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{sw(i)}{i.text}</span>)}
    </div>
  )
}

// `points`: [{id, t, v, label}] in order (v in the axis's unit); `shockAt(p)`: its whole shock (flat plus its own), in
// the shock's unit; `onPoint(id, shock)`: the point's own shock after a drag; `own`: {id → its own shock};
// `scale`: shock units to one unit of the axis (100 bp to 1 %; 1 where the axis is in the shock's unit);
// `bound`: the largest whole shock either way; `step`: what a drag is rounded to; `mark`: {t, label} the trade's date;
// `dot`: {t, v, label} a figure of the trade's own on the curve (the vol it priced at), moved with the scenario;
// `lines`: [{values, color, dash}] other lines of the same surface, drawn thin, not dragged; `width`: the drawing's own
// width in its units (880 across a tab; half of it where two stand side by side, so the type stays its size), and
// `height` its height. A chart that is not dragged (`disabled`) draws its points as small dots, not as rings to take hold of.
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
  const ax = frozen || axis([...market, ...scen, ...also, ...dotV], 5 * 10 ** -decimals)
  const { lo, hi } = ax
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

  const down = (e, i) => {
    if (disabled) return
    drag.current = { i, y: e.clientY, s: Number(own?.[points[i].id]) || 0, scale: { lo, hi } }
    setFrozen(ax)
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
  // the words on the chart stand on the chart's own ground, so a line under them does not run through them
  const plate = { paintOrder: 'stroke', stroke: 'var(--panel)', strokeWidth: 4, strokeLinejoin: 'round' }

  return (
    <div style={{ ...PLOT_BOX, minWidth: 0 }}>
      <svg ref={svg} data-testid={testId} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}
           style={{ display: 'block', width: '100%', height: H, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {ax.ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--border)" />
            <text x={L - 8} y={Y(v) + 4} textAnchor="end" fontFamily="var(--mono)" fontSize="11" fill="var(--text-mute)">{v.toFixed(Math.max(ax.dp, decimals > 1 ? 2 : ax.dp))}</text>
          </g>
        ))}
        {mx != null && <line x1={mx} x2={mx} y1={TOP - 4} y2={H - BOT + 2} stroke="var(--text-dim)" strokeDasharray="3 4" />}
        {mx != null && <text x={Math.max(L + 34, Math.min(W - R - 34, mx))} y={TOP - 6} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--text-hi)">{mark.label}</text>}
        {lines.map((l, k) => <path key={k} d={path(l.values)} fill="none" stroke={l.color} strokeWidth="1.2" strokeDasharray={l.dash || undefined} opacity="0.85" />)}
        <path d={path(market)} fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeDasharray="5 5" />
        <path d={path(scen)} fill="none" stroke={color} strokeWidth="2.2" />
        {points.map((p, i) => (
          <g key={p.id}>
            <text x={X(i)} y={H - 8} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--text-mute)">{p.label}</text>
            {disabled
              ? <circle cx={X(i)} cy={Y(scen[i])} r="3" fill={color} data-pillar={p.id} />
              : <circle cx={X(i)} cy={Y(scen[i])} r="6" fill="var(--panel)" stroke={color} strokeWidth="2" data-pillar={p.id} style={{ cursor: 'ns-resize' }} onPointerDown={(e) => down(e, i)} />}
          </g>
        ))}
        {dx != null && Number.isFinite(dot.v) && (
          <g data-testid={`${testId}-dot`} data-value={dot.v}>
            <circle cx={dx} cy={Y(dot.v)} r="4.5" fill="var(--amber)" stroke="var(--panel)" strokeWidth="1.5" />
            <text x={Math.max(L + 44, Math.min(W - R - 44, dx + (dx > (L + W - R) / 2 ? -42 : 42)))} y={Y(dot.v) + (Y(dot.v) < TOP + 26 ? 18 : -10)} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--amber)" style={plate}>{dot.label}</text>
          </g>
        )}
      </svg>
    </div>
  )
}

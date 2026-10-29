// market-data/RateCurveCanvas.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// One term-structure chart for every curve page under Configurations: OIS par
// rates, basis spreads, forward points. Crisp at any pixel ratio, redraws when
// its container resizes, a labelled rate axis, and the desk palette (canvas
// cannot read CSS variables, so the hex values mirror index.css).
//
//   <RateCurveCanvas points={[{ t: years, v: value }]} unit="%" color="#0dd4a8" height={180} />
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react'

const C = {
  bg: '#0C1015', grid: 'rgba(38,48,60,0.9)', axis: '#5F6C7B', label: '#8B98A8', hi: '#F4F7FA',
}
const FONT = '10px JetBrains Mono, IBM Plex Mono, ui-monospace, monospace'
const X_TICKS = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 15, 20, 25, 30, 40, 50]

const tick = (y) => y < 1 ? `${Math.round(y * 12)}M` : `${y}Y`

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

// A pleasant step for ~4–6 gridlines across the value range.
function niceStep(range, target = 5) {
  const raw = range / target
  const p = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / p
  return (m < 1.5 ? 1 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p
}

export function draw(canvas, { points, unit = '%', color = '#0dd4a8', decimals }) {
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth, H = canvas.clientHeight
  if (!W || !H) return
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H)

  const pts = (points || []).filter(p => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t)
  if (pts.length < 2) return

  const PAD = { l: 54, r: 18, t: 14, b: 28 }
  const CW = W - PAD.l - PAD.r, CH = H - PAD.t - PAD.b
  const maxT = pts[pts.length - 1].t, minT = Math.min(pts[0].t, 0)
  let vMin = Math.min(...pts.map(p => p.v)), vMax = Math.max(...pts.map(p => p.v))
  if (vMax - vMin < 1e-9) { vMin -= 0.5; vMax += 0.5 }
  const step = niceStep(vMax - vMin)
  vMin = Math.floor(vMin / step) * step; vMax = Math.ceil(vMax / step) * step
  if (vMax - vMin < step * 2) { vMin -= step; vMax += step }
  const dp = decimals ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2)

  // sqrt time axis: the short end gets room, the long end does not dominate
  const xs = t => PAD.l + (Math.sqrt(Math.max(t - minT, 0)) / Math.sqrt(maxT - minT)) * CW
  const ys = v => PAD.t + CH - ((v - vMin) / (vMax - vMin)) * CH

  // grid + rate axis
  ctx.font = FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'right'
  for (let v = vMin; v <= vMax + 1e-9; v += step) {
    const y = ys(v)
    ctx.strokeStyle = C.grid; ctx.lineWidth = 0.6
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
    ctx.fillStyle = C.axis; ctx.fillText(v.toFixed(dp) + (unit === '%' ? '%' : ''), PAD.l - 8, y)
  }
  if (vMin < 0 && vMax > 0) {
    ctx.strokeStyle = 'rgba(244,247,250,0.25)'; ctx.lineWidth = 0.8; ctx.setLineDash([3, 3])
    ctx.beginPath(); ctx.moveTo(PAD.l, ys(0)); ctx.lineTo(W - PAD.r, ys(0)); ctx.stroke(); ctx.setLineDash([])
  }
  // tenor axis
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  let lastX = -1e9
  X_TICKS.filter(t => t >= Math.max(minT, 0.2) && t <= maxT * 1.02).forEach(t => {
    const x = xs(t)
    if (x - lastX < 34) return
    lastX = x
    ctx.strokeStyle = 'rgba(38,48,60,0.6)'; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke()
    ctx.fillStyle = C.label; ctx.fillText(tick(t), x, H - PAD.b + 7)
  })

  // area, glow, line, markers
  const rgb = hexToRgb(color)
  ctx.beginPath()
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(xs(p.t), ys(p.v)) : ctx.lineTo(xs(p.t), ys(p.v)))
  ctx.lineTo(xs(maxT), H - PAD.b); ctx.lineTo(xs(pts[0].t), H - PAD.b); ctx.closePath()
  const g = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b)
  g.addColorStop(0, `rgba(${rgb},0.14)`); g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = g; ctx.fill()

  ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  ctx.beginPath()
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(xs(p.t), ys(p.v)) : ctx.lineTo(xs(p.t), ys(p.v)))
  ctx.strokeStyle = `rgba(${rgb},0.18)`; ctx.lineWidth = 6; ctx.stroke()
  ctx.beginPath()
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(xs(p.t), ys(p.v)) : ctx.lineTo(xs(p.t), ys(p.v)))
  ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke()
  pts.forEach(p => {
    ctx.beginPath(); ctx.arc(xs(p.t), ys(p.v), 2.6, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
  })

  // first and last values, so the eye does not have to hunt
  ctx.font = FONT; ctx.textBaseline = 'bottom'
  const fmt = v => v.toFixed(Math.max(dp, 2)) + (unit === '%' ? '%' : unit === 'bp' ? 'bp' : '')
  ctx.textAlign = 'left'; ctx.fillStyle = C.hi
  ctx.fillText(fmt(pts[0].v), xs(pts[0].t) + 6, ys(pts[0].v) - 6)
  ctx.textAlign = 'right'
  ctx.fillText(fmt(pts[pts.length - 1].v), xs(maxT) - 2, ys(pts[pts.length - 1].v) - 6)
}

export default function RateCurveCanvas({ points, unit = '%', color = '#0dd4a8', height = 180, decimals, style }) {
  const ref = useRef(null)
  const key = (points || []).map(p => `${p.t}:${p.v}`).join('|')

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const run = () => draw(canvas, { points, unit, color, decimals })
    run()
    const ro = new ResizeObserver(run)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [key, unit, color, decimals])   // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={ref} style={{ display: 'block', width: '100%', height, ...style }} />
}

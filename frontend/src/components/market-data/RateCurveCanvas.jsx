// market-data/RateCurveCanvas.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// One term-structure chart for every curve page under Configurations: OIS par
// rates, basis spreads, FX and crypto outright forwards. Crisp at any pixel
// ratio, redraws when its container resizes, a labelled value axis, and the
// desk palette (canvas cannot read CSS variables, so the hex values mirror
// index.css).
//
//   <RateCurveCanvas points={[{ t: years, v: value }]} unit="%" color="#0dd4a8" height={180} />
//   <RateCurveCanvas series={[{ label, color, points }, …]} unit="" decimals={5} />
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

const clean = (points) => (points || []).filter(p => Number.isFinite(p.t) && Number.isFinite(p.v)).sort((a, b) => a.t - b.t)

export function draw(canvas, { series, unit = '%', decimals }) {
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth, H = canvas.clientHeight
  if (!W || !H) return
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H)

  const ss = (series || []).map(s => ({ ...s, points: clean(s.points) })).filter(s => s.points.length >= 2)
  if (!ss.length) return
  const all = ss.flatMap(s => s.points)

  const PAD = { l: unit === '' ? 70 : 54, r: 18, t: 16, b: 28 }
  const CW = W - PAD.l - PAD.r, CH = H - PAD.t - PAD.b
  const maxT = Math.max(...all.map(p => p.t)), minT = Math.min(0, ...all.map(p => p.t))
  let vMin = Math.min(...all.map(p => p.v)), vMax = Math.max(...all.map(p => p.v))
  if (vMax - vMin < 1e-9) { vMin -= 0.5; vMax += 0.5 }
  const step = niceStep(vMax - vMin)
  vMin = Math.floor(vMin / step) * step; vMax = Math.ceil(vMax / step) * step
  if (vMax - vMin < step * 2) { vMin -= step; vMax += step }
  const dp = decimals ?? (step >= 1 ? 0 : step >= 0.1 ? 1 : 2)
  const suffix = unit === '%' ? '%' : unit === 'bp' ? 'bp' : ''

  // sqrt time axis: the short end gets room, the long end does not dominate
  const xs = t => PAD.l + (Math.sqrt(Math.max(t - minT, 0)) / Math.sqrt(maxT - minT || 1)) * CW
  const ys = v => PAD.t + CH - ((v - vMin) / (vMax - vMin)) * CH

  // grid + value axis
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

  const fmt = v => v.toFixed(Math.max(dp, decimals ?? 2)) + suffix
  ss.forEach((s, si) => {
    const pts = s.points, color = s.color || '#0dd4a8', rgb = hexToRgb(color)
    const path = () => { ctx.beginPath(); pts.forEach((p, i) => i === 0 ? ctx.moveTo(xs(p.t), ys(p.v)) : ctx.lineTo(xs(p.t), ys(p.v))) }
    if (si === 0) {                                    // area under the primary series
      path(); ctx.lineTo(xs(pts[pts.length - 1].t), H - PAD.b); ctx.lineTo(xs(pts[0].t), H - PAD.b); ctx.closePath()
      const g = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b)
      g.addColorStop(0, `rgba(${rgb},0.14)`); g.addColorStop(1, `rgba(${rgb},0)`)
      ctx.fillStyle = g; ctx.fill()
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'
    if (s.dash) ctx.setLineDash(s.dash)
    path(); ctx.strokeStyle = `rgba(${rgb},0.18)`; ctx.lineWidth = 6; ctx.stroke()
    path(); ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke()
    ctx.setLineDash([])
    pts.forEach(p => { ctx.beginPath(); ctx.arc(xs(p.t), ys(p.v), 2.6, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill() })
    // last value tag per series; first value for the primary one
    ctx.font = FONT; ctx.textBaseline = 'bottom'; ctx.fillStyle = C.hi
    const last = pts[pts.length - 1]
    ctx.textAlign = 'right'; ctx.fillText(fmt(last.v), xs(last.t) - 2, ys(last.v) - 6 - si * 12)
    if (si === 0) { ctx.textAlign = 'left'; ctx.fillText(fmt(pts[0].v), xs(pts[0].t) + 6, ys(pts[0].v) - 6) }
  })

  // legend when there is more than one series
  if (ss.length > 1) {
    ctx.font = FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
    let x = PAD.l + 6
    ss.forEach(s => {
      ctx.strokeStyle = s.color || '#0dd4a8'; ctx.lineWidth = 2
      if (s.dash) ctx.setLineDash(s.dash)
      ctx.beginPath(); ctx.moveTo(x, PAD.t - 6); ctx.lineTo(x + 16, PAD.t - 6); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle = C.label; ctx.fillText(s.label || '', x + 21, PAD.t - 6)
      x += 21 + ctx.measureText(s.label || '').width + 18
    })
  }
}

export default function RateCurveCanvas({ points, series, unit = '%', color = '#0dd4a8', height = 180, decimals, style }) {
  const ref = useRef(null)
  const all = series || [{ points, color }]
  const key = all.map(s => (s.label || '') + ':' + (s.points || []).map(p => `${p.t}:${p.v}`).join('|')).join('||')

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const run = () => draw(canvas, { series: all, unit, decimals })
    run()
    const ro = new ResizeObserver(run)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [key, unit, decimals])   // eslint-disable-line react-hooks/exhaustive-deps

  return <canvas ref={ref} style={{ display: 'block', width: '100%', height, ...style }} />
}

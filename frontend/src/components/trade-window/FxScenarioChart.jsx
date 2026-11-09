// trade-window/FxScenarioChart.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// The chart of the CURVE SCENARIO tab on an FX or digital-asset ticket. Time runs
// left to right with TODAY marked: to its left the pair's recent fixings, to its
// right the forward curve by tenor, base (dashed) and shocked (solid). The strike
// is a horizontal line, the settlement (and expiry) date a vertical one, and the
// shocked forward at settlement a dot with its value.
//
// A tenor point drags vertically; Shift, or the spot point at TODAY, drags the
// whole curve. The chart only reports the drag (index, whole, dPrice): the panel
// owns the shocks and hands back the curve to draw. All scales come from
// fx-scenario.js, so the drawing and the hit test cannot disagree.
//
// Its own canvas, in the style of market-data/RateCurveCanvas.jsx (same palette,
// font and grid; canvas cannot read CSS variables, so the hex values mirror
// index.css). That component is left as it is: it recomputes its axes on every
// draw and has one square-root time axis from zero, where this chart needs a
// split axis with the past on it, an axis that holds still during a drag, and
// geometry shared with pointer handling.
//
// For the browser journeys the wrapper carries data-spot-x, data-spot-y (the
// canvas coordinates of the spot point at TODAY) and data-px-per-unit (vertical
// pixels per one unit of price), kept current on every draw.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { chartGeometry, daysBetween, horizonDays, valueRange, FIXING_DAYS } from './fx-scenario'

const C = {
  bg: '#0C1015', grid: 'rgba(38,48,60,0.9)', axis: '#5F6C7B', label: '#8B98A8', hi: '#F4F7FA',
  curve: '#0dd4a8', curveRgb: '13,212,168', fix: '#4a9ad4', strike: '#F0A020',
}
const FONT = '10px JetBrains Mono, IBM Plex Mono, ui-monospace, monospace'
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HIT = 16                                           // pixels around a point that count as on it

const fin = (v) => typeof v === 'number' && Number.isFinite(v)
const num = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const day = (iso, year) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]} ${MON[+m[2] - 1]}${year ? ' ' + m[1].slice(2) : ''}` : '' }
const addDays = (iso, n) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n)).toISOString().slice(0, 10) : '' }
// the decimals a gridline step needs (0.25 → 2, 500 → 0), never more than the price itself shows
const stepDp = (step, cap) => { for (let d = 0; d <= cap; d++) { const x = step * 10 ** d; if (Math.abs(x - Math.round(x)) < 1e-6) return d } return cap }

// a strike far from spot would flatten the curve: it is named in the legend and left off the axis
const strikeOnScale = (strike, spot) => fin(strike) && fin(spot) && strike > 0.4 * spot && strike < 1.6 * spot

// Everything the drawing and the hit test share: which points are on the chart, and the scales.
function layout(W, H, p, frozen) {
  const vis = (p.curve || []).map((c, index) => ({ ...c, index })).filter(c => fin(c.base) && fin(c.shocked) && fin(c.x))
  if (!W || !H || !vis.length || vis[0].x !== 0) return null
  const maxDays = horizonDays(vis, Math.max(p.settle?.x || 0, p.expiry?.x || 0))
  const pts = vis.filter(c => c.x <= maxDays)
  const fix = (p.fixings?.rows || []).map(r => ({ d: daysBetween(p.today, r.date), v: r.value, date: r.date }))
    .filter(f => f.d != null && f.d <= 0 && f.d >= -FIXING_DAYS && fin(f.v))
  const strikeOn = strikeOnScale(p.strike, pts[0].base)
  const range = frozen || valueRange([...pts.flatMap(c => [c.base, c.shocked]), ...fix.map(f => f.v), p.forward, strikeOn ? p.strike : NaN])
  const geo = chartGeometry({ width: W, height: H, hasLeft: fix.length > 0, maxDays, vMin: range.vMin, vMax: range.vMax })
  return { pts, fix, range, geo, maxDays, strikeOn }
}

function draw(canvas, p, L, hover) {
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth, H = canvas.clientHeight
  if (!W || !H) return
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H)
  ctx.font = FONT
  if (!L) { ctx.fillStyle = C.label; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('No forward curve to draw', W / 2, H / 2); return }

  const { pts, fix, range, geo, strikeOn } = L
  const { xs, ys, left, right, top, bottom, x0 } = geo
  const dp = p.dp ?? 2
  const axisDp = stepDp(range.step, dp)
  const inX = (x, w) => Math.max(left + w / 2, Math.min(right - w / 2, x))

  // value axis and its grid
  ctx.textBaseline = 'middle'; ctx.textAlign = 'right'
  for (let v = range.vMin; v <= range.vMax + range.step * 1e-6; v += range.step) {
    const y = ys(v)
    ctx.strokeStyle = C.grid; ctx.lineWidth = 0.6
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke()
    ctx.fillStyle = C.axis; ctx.fillText(num(v, axisDp), left - 8, y)
  }

  // time axis: dates to the left of today, tenors to the right
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  const vline = (x, style, width = 0.5, dash) => { ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]) }
  if (fix.length) {
    for (const d of [-30, -20, -10]) {
      const x = xs(d)
      vline(x, 'rgba(38,48,60,0.6)')
      ctx.fillStyle = C.label; ctx.fillText(day(addDays(p.today, d)), Math.max(x, left + 16), bottom + 7)
    }
  }
  let lastX = x0
  pts.slice(1).forEach(c => {
    const x = xs(c.x)
    if (x - lastX < 30) return
    lastX = x
    vline(x, 'rgba(38,48,60,0.6)')
    ctx.fillStyle = C.label; ctx.fillText(c.tenor, x, bottom + 7)
  })
  vline(x0, 'rgba(244,247,250,0.55)', 1)
  ctx.fillStyle = C.hi; ctx.fillText('TODAY', x0, bottom + 7)

  // settlement and expiry: vertical markers, named above the plot
  const marks = []
  if (p.expiry && fin(p.expiry.x) && p.expiry.x > 0) marks.push({ x: xs(p.expiry.x), text: `EXPIRY ${day(p.expiry.date, true)}` })
  if (p.settle && fin(p.settle.x) && p.settle.x > 0) marks.push({ x: xs(p.settle.x), text: `SETTLE ${day(p.settle.date, true)}` })
  marks.forEach(m => vline(m.x, 'rgba(244,247,250,0.45)', 1, [4, 3]))
  ctx.textBaseline = 'bottom'; ctx.fillStyle = C.hi
  if (marks.length === 2 && Math.abs(marks[0].x - marks[1].x) < ctx.measureText(marks[0].text).width / 2 + ctx.measureText(marks[1].text).width / 2 + 10) {
    const text = `${marks[0].text} · ${marks[1].text}`
    ctx.fillText(text, inX((marks[0].x + marks[1].x) / 2, ctx.measureText(text).width), top - 6)
  } else {
    marks.forEach(m => ctx.fillText(m.text, inX(m.x, ctx.measureText(m.text).width), top - 6))
  }

  ctx.save()
  ctx.beginPath(); ctx.rect(left - 6, top - 2, right - left + 12, bottom - top + 4); ctx.clip()

  // the strike
  if (strikeOn) {
    const y = ys(p.strike)
    ctx.strokeStyle = C.strike; ctx.lineWidth = 1; ctx.setLineDash([6, 4])
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.setLineDash([])
    ctx.fillStyle = C.strike; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'
    ctx.fillText(`K ${num(p.strike, dp)}`, left + 6, y - 3)
  }

  // fixings: a line with dots, left of today
  if (fix.length) {
    ctx.strokeStyle = C.fix; ctx.lineWidth = 1.4; ctx.lineJoin = 'round'
    ctx.beginPath(); fix.forEach((f, i) => i === 0 ? ctx.moveTo(xs(f.d), ys(f.v)) : ctx.lineTo(xs(f.d), ys(f.v))); ctx.stroke()
    fix.forEach(f => { ctx.beginPath(); ctx.arc(xs(f.d), ys(f.v), 2.4, 0, Math.PI * 2); ctx.fillStyle = C.fix; ctx.fill() })
  }

  // the forward curve: base dashed; shocked solid once anything has moved
  const path = (key) => { ctx.beginPath(); pts.forEach((c, i) => i === 0 ? ctx.moveTo(xs(c.x), ys(c[key])) : ctx.lineTo(xs(c.x), ys(c[key]))) }
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  ctx.setLineDash([5, 4])
  path('base'); ctx.strokeStyle = p.moved ? C.label : C.curve; ctx.lineWidth = p.moved ? 1.2 : 1.8; ctx.stroke()
  ctx.setLineDash([])
  if (p.moved) {
    pts.forEach(c => { ctx.beginPath(); ctx.arc(xs(c.x), ys(c.base), 1.8, 0, Math.PI * 2); ctx.fillStyle = C.label; ctx.fill() })
    path('shocked'); ctx.strokeStyle = `rgba(${C.curveRgb},0.18)`; ctx.lineWidth = 6; ctx.stroke()
    path('shocked'); ctx.strokeStyle = C.curve; ctx.lineWidth = 1.8; ctx.stroke()
  }
  pts.forEach(c => {
    const x = xs(c.x), y = ys(c.shocked), on = hover === c.index
    if (on) { ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fillStyle = `rgba(${C.curveRgb},0.22)`; ctx.fill() }
    ctx.beginPath(); ctx.arc(x, y, c.index === 0 ? 4 : 3.2, 0, Math.PI * 2); ctx.fillStyle = C.curve; ctx.fill()
    if (c.index === 0) { ctx.strokeStyle = C.hi; ctx.lineWidth = 1; ctx.stroke() }
  })
  ctx.restore()

  // the shocked forward at settlement: a dot and its value
  if (p.settle && fin(p.settle.x) && fin(p.forward)) {
    const x = xs(p.settle.x), y = Math.max(top, Math.min(bottom, ys(p.forward)))
    ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fillStyle = C.hi; ctx.fill()
    ctx.strokeStyle = C.curve; ctx.lineWidth = 2; ctx.stroke()
    const text = num(p.forward, dp), w = ctx.measureText(text).width
    const tx = x + 9 + w > right ? x - 9 - w : x + 9
    const ty = y - 16 < top ? y + 6 : y - 16
    ctx.fillStyle = 'rgba(12,16,21,0.85)'; ctx.fillRect(tx - 3, ty - 1, w + 6, 13)
    ctx.fillStyle = C.hi; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(text, tx, ty + 1)
  }

  // the point under the cursor: its tenor, its value, and how far it has moved
  const h = pts.find(c => c.index === hover)
  if (h) {
    const moved = Math.abs(h.shocked - h.base) > 10 ** -dp / 2
    const text = `${h.tenor} ${num(h.shocked, dp)}${moved ? ` (${h.shocked > h.base ? '+' : '−'}${num(Math.abs(h.shocked - h.base), dp)})` : ''}`
    const w = ctx.measureText(text).width
    const tx = inX(xs(h.x), w + 8) - w / 2
    const ty = ys(h.shocked) + 12 + 13 > bottom ? ys(h.shocked) - 26 : ys(h.shocked) + 12
    ctx.fillStyle = 'rgba(12,16,21,0.92)'; ctx.fillRect(tx - 4, ty - 1, w + 8, 14)
    ctx.strokeStyle = `rgba(${C.curveRgb},0.5)`; ctx.lineWidth = 0.6; ctx.strokeRect(tx - 4, ty - 1, w + 8, 14)
    ctx.fillStyle = C.hi; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(text, tx, ty + 1.5)
  }
}

const sw = (style) => <span aria-hidden="true" style={{ display: 'inline-block', width: 18, height: 0, verticalAlign: 'middle', marginRight: 6, ...style }} />

export default function FxScenarioChart(props) {
  const { height = 260, fixings, moved, strike, dp = 2, tradeSource } = props
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const live = useRef(props)                                 // the latest props, for the observers and listeners
  const lay = useRef(null)                                   // the layout of the last draw: what the hit test reads
  const drag = useRef(null)
  const stop = useRef(null)
  const [hover, setHover] = useState(-1)
  const [, setTick] = useState(0)
  const hoverRef = useRef(-1)

  const redraw = () => {
    const canvas = canvasRef.current, wrap = wrapRef.current
    if (!canvas || !wrap) return
    const p = live.current
    const L = layout(canvas.clientWidth, canvas.clientHeight, p, drag.current?.range)
    lay.current = L
    draw(canvas, p, L, drag.current ? drag.current.index : hoverRef.current)
    if (L) {
      wrap.dataset.spotX = L.geo.xs(0).toFixed(2)
      wrap.dataset.spotY = L.geo.ys(L.pts[0].shocked).toFixed(2)
      wrap.dataset.pxPerUnit = String(L.geo.pxPerUnit)
    } else {
      delete wrap.dataset.spotX; delete wrap.dataset.spotY; delete wrap.dataset.pxPerUnit
    }
  }

  useEffect(() => { live.current = props; hoverRef.current = hover; redraw() })   // every render: the curve, the hover, the end of a drag
  useEffect(() => {
    const ro = new ResizeObserver(redraw)
    ro.observe(wrapRef.current)
    return () => { ro.disconnect(); stop.current?.() }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const hit = (e) => {
    const L = lay.current, canvas = canvasRef.current
    if (!L || !canvas) return -1
    const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top
    let best = -1, dist = HIT
    L.pts.forEach(c => { const d = Math.hypot(mx - L.geo.xs(c.x), my - L.geo.ys(c.shocked)); if (d <= dist) { dist = d; best = c.index } })
    return best
  }

  const onMouseDown = (e) => {
    if (e.button !== 0 || drag.current) return
    const index = hit(e)
    if (index < 0) return
    e.preventDefault()
    // the value axis is held for the length of the drag, so the point stays under the cursor
    const d = { index, whole: index === 0 || e.shiftKey, startY: e.clientY, pxPerUnit: lay.current.geo.pxPerUnit, range: lay.current.range }
    drag.current = d
    const cursor = document.body.style.cursor
    document.body.style.cursor = 'ns-resize'
    const move = (ev) => live.current.onDrag?.({ index: d.index, whole: d.whole, dPrice: (d.startY - ev.clientY) / d.pxPerUnit })
    const up = () => { stop.current?.(); live.current.onDragEnd?.(); setTick(t => t + 1) }
    stop.current = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      document.body.style.cursor = cursor
      drag.current = null; stop.current = null
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    live.current.onDragStart?.({ index: d.index, whole: d.whole })
    setTick(t => t + 1)
  }
  const onMouseMove = (e) => {
    if (drag.current) return
    const index = hit(e)
    e.currentTarget.style.cursor = index >= 0 ? 'ns-resize' : 'default'
    if (index !== hoverRef.current) setHover(index)
  }

  const legend = { display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ border: '1px solid var(--border)', borderRadius: 2, background: C.bg, overflow: 'hidden' }}>
        <div ref={wrapRef} data-testid="fx-scenario-chart" style={{ position: 'relative', width: '100%', height, minWidth: 0 }}>
          <canvas ref={canvasRef} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseLeave={() => { if (!drag.current) setHover(-1) }}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginTop: 6, fontSize: '0.72rem', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>
        {fixings?.rows?.length > 0 && (
          <span style={legend}>{sw({ borderTop: `2px solid ${C.fix}` })}
            {fixings.spot ? 'stored spot' : `FIXINGS · ${fixings.label}`}{!fixings.spot && tradeSource && !fixings.ownSource ? ' (not the source this trade settles on)' : ''}
          </span>
        )}
        <span style={legend}>{sw({ borderTop: `2px dashed ${moved ? C.label : C.curve}` })}BASE FORWARD</span>
        {moved && <span style={legend}>{sw({ borderTop: `2px solid ${C.curve}` })}SHOCKED</span>}
        {fin(strike) && <span style={legend}>{sw({ borderTop: `2px dashed ${C.strike}` })}K {num(strike, dp)}{strikeOnScale(strike, props.curve?.[0]?.base) ? '' : ' (off the scale)'}</span>}
        <span style={{ ...legend, whiteSpace: 'normal', color: 'var(--text-mute)', fontFamily: 'var(--sans)' }}>
          Drag a tenor point up or down to move it. Hold Shift, or drag the spot point at TODAY, to move the whole curve.
        </span>
      </div>
    </div>
  )
}

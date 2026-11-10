// trade-window/FxVolChart.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// The VOL SURFACE block of the CURVE SCENARIO tab on an FX or digital-asset option:
// the pair's stored surface (ATM, 25-delta risk reversal and butterfly by tenor) as
// two small charts, under the forward curve and above the sliders.
//
//   TERM STRUCTURE    the ATM vol against time to expiry on a square-root axis, joined
//                     the way the pricer joins it (linear in time, flat beyond the ends),
//                     the 25-delta call and put vols as two thinner lines, the option's
//                     expiry as a vertical line and the vol the quote used as a dot
//   SMILE AT EXPIRY   vol against the forward delta of a call at the option's expiry,
//                     the three quoted points as dots and the option's strike at its delta
//
// The VOL slider moves both: the whole surface by the slider's points, which is what
// the repricing does to the option's vol (fx-scenario.js reprice, volPts). The base
// stays as a dim dashed line.
//
// Every number comes from fx-vol.js, the browser's copy of backend/pricing/fx_vol.py,
// pinned to it by shared vectors. The line under the charts states the reading (and
// between which quoted tenors it was taken) and the vol the quote priced at; when the
// two disagree it says so in the warning colour. A shocked curve is the surface moved
// in parallel while the strike stays at its unshocked delta, and a second line says so.
//
// Drawn the way FxScenarioChart.jsx draws: a canvas, the same palette, font, grid and
// markers (canvas cannot read CSS variables, so the hex values mirror index.css as they
// do there). Each plot's wrapper carries data-ready, and so does the block: "true" once
// the panel's requests have settled and both plots have drawn.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from 'react'
import { isoDate, valueRange } from './fx-scenario'
import { deltaRange, pillars, shockedVol, smileCurve, smileVol, surfaceReading, termCurve, volGeometry } from './fx-vol'

const C = {
  bg: '#102723', grid: 'rgba(67,84,74,0.9)', axis: '#7b9388', label: '#8a9f94', hi: '#f6f1e4',
  curve: '#d9b25c', curveRgb: '217,178,92', call: '#8fc1e6', put: '#E06C75', strike: '#e9975a',
}
const FONT = '10px JetBrains Mono, IBM Plex Mono, ui-monospace, monospace'
const HEIGHT = 220

const fin = (v) => typeof v === 'number' && Number.isFinite(v)
const num = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const stepDp = (step, cap) => { for (let d = 0; d <= cap; d++) { const x = step * 10 ** d; if (Math.abs(x - Math.round(x)) < 1e-6) return d } return cap }
const pct = (v) => v * 100                               // the charts and the words are in vol points; fx-vol.js is in decimals

// ── drawing, shared by the two plots ─────────────────────────────────────────────────

function axes(ctx, geo, range) {
  const { left, right, ys } = geo
  const dp = stepDp(range.step, 2)
  ctx.textBaseline = 'middle'; ctx.textAlign = 'right'
  for (let v = range.vMin; v <= range.vMax + range.step * 1e-6; v += range.step) {
    const y = ys(v)
    ctx.strokeStyle = C.grid; ctx.lineWidth = 0.6
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke()
    ctx.fillStyle = C.axis; ctx.fillText(num(v, dp), left - 8, y)
  }
}
const vline = (ctx, geo, x, style, width = 0.5, dash) => {
  ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash || [])
  ctx.beginPath(); ctx.moveTo(x, geo.top); ctx.lineTo(x, geo.bottom); ctx.stroke(); ctx.setLineDash([])
}
const inX = (geo, x, w) => Math.max(geo.left + w / 2, Math.min(geo.right - w / 2, x))
// a line through points already in canvas coordinates
function line(ctx, pts, style, width, dash) {
  ctx.beginPath(); pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
  ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([])
}
// the base dashed, and once the slider has moved it the shocked curve solid over it: FxScenarioChart's forward curve
function baseAndShocked(ctx, base, shocked, moved) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  line(ctx, base, moved ? C.label : C.curve, moved ? 1.2 : 1.8, [5, 4])
  if (!moved) return
  line(ctx, shocked, `rgba(${C.curveRgb},0.18)`, 6)
  line(ctx, shocked, C.curve, 1.8)
}
const point = (ctx, x, y, r, fill, stroke) => {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill()
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke() }
}
// the option's own mark: a dot ringed in the strike's colour, with its words in a box beside it
function mark(ctx, geo, x, v, text, hollow) {
  const y = Math.max(geo.top, Math.min(geo.bottom, geo.ys(v)))
  ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fillStyle = hollow ? C.bg : C.hi; ctx.fill()
  ctx.strokeStyle = C.strike; ctx.lineWidth = 2; ctx.stroke()
  if (!text) return
  const w = ctx.measureText(text).width
  const tx = x + 9 + w > geo.right ? x - 9 - w : x + 9
  const ty = y - 16 < geo.top ? y + 6 : y - 16
  ctx.fillStyle = 'rgba(16,39,35,0.85)'; ctx.fillRect(tx - 3, ty - 1, w + 6, 13)
  ctx.fillStyle = C.hi; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(text, tx, ty + 1)
}
const clip = (ctx, geo) => { ctx.save(); ctx.beginPath(); ctx.rect(geo.left - 6, geo.top - 2, geo.right - geo.left + 12, geo.bottom - geo.top + 4); ctx.clip() }

// ── the term structure ───────────────────────────────────────────────────────────────

const TICK_FIRST = ['1Y', '1M', '3M', '6M', '2Y', '1W', '2M', '9M']

function drawTerm(ctx, W, H, { reading, vpt, expiryDate }) {
  const { pillars: ps, T, quoteVol } = reading
  const maxT = Math.max(ps[ps.length - 1].t, T * 1.05)
  const curve = termCurve(ps, maxT, [T])
  if (!curve) return false
  const shift = vpt / 100, moved = vpt !== 0
  const smiled = ps.some(p => p.smile)
  const dotVol = shockedVol(quoteVol, vpt)
  const range = valueRange([...curve.flatMap(p => [p.atm, p.atm + shift, ...(smiled ? [p.call + shift, p.put + shift] : [])]), dotVol].map(pct))
  const geo = range && volGeometry({ width: W, height: H, xMax: maxT, vMin: range.vMin, vMax: range.vMax, sqrt: true })
  if (!geo) return false
  const { xs, ys, left, right, top, bottom } = geo
  axes(ctx, geo, range)

  // time axis: the quoted tenors, on a square-root scale from today
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  // where two tenors would print over each other at the short end, the more familiar one is named
  const placed = []
  const rank = (p) => { const i = TICK_FIRST.indexOf(p.tenor); return i < 0 ? TICK_FIRST.length : i }
  ps.filter(p => p.t <= maxT).sort((a, b) => rank(a) - rank(b) || a.t - b.t).forEach(p => {
    const x = xs(p.t)
    if (placed.some(q => Math.abs(q - x) < 30)) return
    placed.push(x)
    vline(ctx, geo, x, 'rgba(67,84,74,0.6)')
    const w = ctx.measureText(p.tenor).width
    ctx.fillStyle = C.label; ctx.fillText(p.tenor, Math.max(left + w / 2, Math.min(right - w / 2, x)), bottom + 7)
  })

  // the option's expiry, named above the plot
  const xe = xs(T)
  vline(ctx, geo, xe, 'rgba(246,241,228,0.45)', 1, [4, 3])
  const text = `EXPIRY ${isoDate(expiryDate)}`.trim()        // ISO, like every date the tabs print
  ctx.textBaseline = 'bottom'; ctx.fillStyle = C.hi; ctx.fillText(text, inX(geo, xe, ctx.measureText(text).width), top - 6)

  clip(ctx, geo)
  const path = (key, by) => curve.map(p => [xs(p.t), ys(pct(p[key] + by))])
  if (smiled) {
    line(ctx, path('call', shift), C.call, 1)
    line(ctx, path('put', shift), C.put, 1)
  }
  baseAndShocked(ctx, path('atm', 0), path('atm', shift), moved)
  ps.forEach(p => {
    if (p.t > maxT) return
    if (moved) point(ctx, xs(p.t), ys(pct(p.atm)), 1.8, C.label)
    point(ctx, xs(p.t), ys(pct(p.atm + shift)), 3.2, C.curve)
  })
  ctx.restore()

  mark(ctx, geo, xe, pct(dotVol), `${reading.override ? 'override ' : ''}${num(pct(dotVol), 2)} %`, reading.override)
  return true
}

// ── the smile at the option's expiry ─────────────────────────────────────────────────

const DELTA_TICKS = [[0.9, '10P'], [0.75, '25P'], [0.5, 'ATM'], [0.25, '25C'], [0.1, '10C']]

function drawSmile(ctx, W, H, { reading, vpt, dp }) {
  const { at, delta, quoteVol, override, atForward, K, surfaceVol } = reading
  const { lo, hi } = deltaRange(delta)
  const curve = smileCurve(at, lo, hi)
  if (!curve) return false
  const shift = vpt / 100, moved = vpt !== 0
  const dotVol = shockedVol(quoteVol, vpt)
  const range = valueRange([...curve.flatMap(p => [p.vol, p.vol + shift]), dotVol].map(pct))
  const geo = range && volGeometry({ width: W, height: H, xMin: lo, xMax: hi, vMin: range.vMin, vMax: range.vMax, reverse: true })
  if (!geo) return false
  const { xs, ys, top, bottom } = geo
  axes(ctx, geo, range)

  // delta axis: the quoted points by name, puts (low strikes) on the left
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  DELTA_TICKS.forEach(([d, name]) => {
    vline(ctx, geo, xs(d), 'rgba(67,84,74,0.6)')
    ctx.fillStyle = d === 0.5 ? C.hi : C.label; ctx.fillText(name, xs(d), bottom + 7)
  })

  // the option's strike at its delta, named above the plot
  const haveDelta = fin(delta)
  if (haveDelta) {
    const xk = xs(delta)
    vline(ctx, geo, xk, C.strike, 1, [6, 4])
    // an override is off the curve: its label says what the surface reads there (the short form where the plot is narrow)
    const reads = num(pct(surfaceVol + shift), 2)
    const long = `override ${num(pct(dotVol), 2)} % · the surface reads ${reads} % at ${atForward ? 'the forward' : 'this strike'}`
    const text = !override ? `${atForward ? 'at the forward' : `K ${num(K, dp)}`} · ${num(pct(dotVol), 2)} %`
      : ctx.measureText(long).width <= geo.right - geo.left ? long : `override ${num(pct(dotVol), 2)} % · surface ${reads} %`
    ctx.textBaseline = 'bottom'; ctx.fillStyle = C.strike; ctx.fillText(text, inX(geo, xk, ctx.measureText(text).width), top - 6)
  }

  clip(ctx, geo)
  const path = (by) => curve.map(p => [xs(p.delta), ys(pct(p.vol + by))])
  baseAndShocked(ctx, path(0), path(shift), moved)
  // the three quotes interpolated to this expiry; a surface with no smile quoted has only its ATM
  ;(at.smile ? [0.75, 0.5, 0.25] : [0.5]).forEach(d => {
    const v = smileVol(at.atm, at.rr, at.bf, d)
    if (moved) point(ctx, xs(d), ys(pct(v)), 1.8, C.label)
    point(ctx, xs(d), ys(pct(v + shift)), d === 0.5 ? 4 : 3.2, C.curve, d === 0.5 ? C.hi : null)
  })
  ctx.restore()

  if (haveDelta) mark(ctx, geo, xs(delta), pct(dotVol), null, override)
  return true
}

// ── one plot: a canvas that redraws on every render and on every resize ──────────────

function Plot({ testId, title, draw, model, ready, onDrawn }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const live = useRef({ draw, model, ready, onDrawn })       // the latest props, for the resize observer

  const redraw = () => {
    const canvas = canvasRef.current, wrap = wrapRef.current
    if (!canvas || !wrap) return
    const p = live.current
    const W = canvas.clientWidth, H = canvas.clientHeight
    let drawn = false
    if (W && H) {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr)
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H)
      ctx.font = FONT
      drawn = p.draw(ctx, W, H, p.model)
      if (!drawn) { ctx.fillStyle = C.label; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('No surface to draw', W / 2, H / 2) }
    }
    wrap.dataset.ready = String(!!(p.ready && drawn))
    p.onDrawn?.()
  }

  useEffect(() => { live.current = { draw, model, ready, onDrawn }; redraw() })   // every render: the surface, the slider
  useEffect(() => {
    const ro = new ResizeObserver(redraw)
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '0.76rem', letterSpacing: '0.12em', color: 'var(--text-dim)', fontFamily: 'var(--mono)', marginBottom: 4 }}>{title}</div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 2, background: C.bg, overflow: 'hidden' }}>
        <div ref={wrapRef} data-testid={testId} data-plot="true" data-ready="false" style={{ position: 'relative', width: '100%', height: HEIGHT, minWidth: 0 }}>
          <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
        </div>
      </div>
    </div>
  )
}

// ── the block ────────────────────────────────────────────────────────────────────────

const sw = (style) => <span aria-hidden="true" style={{ display: 'inline-block', width: 18, height: 0, verticalAlign: 'middle', marginRight: 6, ...style }} />
const legendRow = { display: 'flex', flexWrap: 'wrap', gap: '4px 18px', marginTop: 6, fontSize: '0.72rem', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }
const legend = { display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }
const words = { ...legend, whiteSpace: 'normal', color: 'var(--text-mute)', fontFamily: 'var(--sans)' }
const muted = { fontSize: '0.72rem', color: 'var(--text-mute)', lineHeight: 1.5, marginTop: 8 }
const signed = (v, d = 2) => `${v > 0 ? '+' : ''}${num(v, d)}`

// quote     the priced option                         surface   the pairs row's vol_surface, or null when none is stored
// vpt       the VOL slider, in vol points             dp        decimals of the pair's price, for the strike
// ready     the panel's requests have settled         headerStyle  the panel's section header
export default function FxVolSurface({ quote, surface, pair, vpt = 0, dp = 2, ready, headerStyle }) {
  const blockRef = useRef(null)
  const reading = surfaceReading(quote, surface)
  // "true" on the block only when both plots say so, read after each of them draws
  const sync = () => {
    const el = blockRef.current
    if (!el) return
    const plots = [...el.querySelectorAll('[data-plot]')]
    el.dataset.ready = String(plots.length === 2 && plots.every(p => p.dataset.ready === 'true'))
  }

  if (!reading) {
    // a surface with no usable tenor is no surface; a quote without a forward, an expiry or a vol has nothing to mark
    if (pillars(surface?.grid).length > 0 || quote?.vol_pct == null) return null
    return (
      <div data-testid="fx-vol-none" style={muted}>
        No vol surface is stored for {pair}: the price used {num(quote.vol_pct, 2)} %{quote.vol_source ? ` (${quote.vol_source})` : ''}
      </div>
    )
  }

  const { at, quoteVol, surfaceVol, override, differs, diffPts, sameSurface, delta, atForward, where } = reading
  const moved = vpt !== 0
  const smiled = reading.pillars.some(p => p.smile)
  const model = { reading, vpt, dp, expiryDate: quote.expiry_date }
  return (
    <div ref={blockRef} data-testid="fx-vol-surface" data-ready="false" style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={headerStyle}>VOL SURFACE · {pair}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>{surface.label || surface.source || ''}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: '12px 20px' }}>
        <div style={{ minWidth: 0 }}>
          <Plot testId="fx-vol-term" title="TERM STRUCTURE" draw={drawTerm} model={model} ready={ready} onDrawn={sync} />
          <div style={legendRow}>
            <span style={legend}>{sw({ borderTop: `2px dashed ${moved ? C.label : C.curve}` })}{moved ? 'BASE ATM' : 'ATM'}</span>
            {moved && <span style={legend}>{sw({ borderTop: `2px solid ${C.curve}` })}SHOCKED</span>}
            {smiled && <span style={legend}>{sw({ borderTop: `1px solid ${C.call}` })}25-DELTA CALL</span>}
            {smiled && <span style={legend}>{sw({ borderTop: `1px solid ${C.put}` })}25-DELTA PUT</span>}
            <span style={legend}>{sw({ width: 8, height: 8, borderRadius: 8, border: `2px solid ${C.strike}`, background: override ? 'transparent' : C.hi })}{override ? 'THE OVERRIDE VOL' : atForward ? 'THE VOL AT THE FORWARD' : 'THE VOL AT THE STRIKE'}</span>
          </div>
        </div>
        <div style={{ minWidth: 0 }}>
          <Plot testId="fx-vol-smile" title={`SMILE AT EXPIRY · ${quote.expiry_date || ''}`} draw={drawSmile} model={model} ready={ready} onDrawn={sync} />
          <div style={legendRow}>
            <span style={legend}>{sw({ borderTop: `2px dashed ${moved ? C.label : C.curve}` })}{moved ? 'BASE SMILE' : 'SMILE'}</span>
            {moved && <span style={legend}>{sw({ borderTop: `2px solid ${C.curve}` })}SHOCKED</span>}
            <span style={legend}>{sw({ borderTop: `2px dashed ${C.strike}` })}{atForward ? 'THE FORWARD' : 'THE STRIKE'}{fin(delta) ? ` · call delta ${num(delta, 2)}` : ''}</span>
            <span style={words}>Strikes rise from left to right: the forward delta of a call runs from 0.90 (10P, the 10-delta put) to 0.10 (10C).</span>
          </div>
        </div>
      </div>
      <div data-testid="fx-vol-note" style={muted}>
        At this expiry (<span data-testid="fx-vol-where">{where}</span>): ATM <span data-testid="fx-vol-expiry-atm" data-value={pct(at.atm)} data-shocked={pct(at.atm) + vpt}>{num(pct(at.atm), 2)}</span> %
        {at.smile ? `, 25-delta risk reversal ${signed(pct(at.rr))} vol points, 25-delta butterfly ${num(pct(at.bf), 2)} vol points` : ' (the surface quotes no risk reversal or butterfly)'}
        ; the quote priced at <span data-testid="fx-vol-strike-vol" data-value={quote.vol_pct} data-surface={pct(surfaceVol)} data-shocked={pct(shockedVol(quoteVol, vpt))} data-delta={fin(delta) ? delta : ''} data-override={String(override)}>{num(pct(quoteVol), 2)}</span> %
        {override ? `, an override: the surface reads ${num(pct(surfaceVol), 2)} % at ${atForward ? 'the forward' : 'this strike'}` : ''}
        {differs && (
          <span data-testid="fx-vol-differs" style={{ color: 'var(--amber)' }}>
            {'; '}the surface read here differs from the quote's vol by {num(diffPts, 2)} points
            {sameSurface ? '' : ' (the stored surface is not the one the quote priced on: price the ticket again)'}
          </span>
        )}
      </div>
      {moved && (
        <div data-testid="fx-vol-shock-note" style={{ ...muted, marginTop: 2 }}>
          The shocked curve is the surface moved in parallel by {signed(vpt)} points, which is what the repricing does; the {atForward ? 'forward' : 'strike'} is drawn at its unshocked delta.
        </div>
      )}
    </div>
  )
}

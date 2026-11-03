// trade-window/ExposureCanvas.jsx — the exposure chart container every XVA tab uses: a sized canvas that
// draws the chart and redraws on data, hover or resize; the EE / ENE / PFE legend highlights a curve (its
// own state, or the parent's when `highlight`/`onHighlight` are given so the VA strip can light a curve
// too); the placeholder before the first run; any readouts the tab overlays as children.
// height: a number of pixels, or 'fill' to take the container's laid-out height (the rates tab's flex fill).
import { useEffect, useRef, useState } from 'react'
import { drawExposureChart } from './exposure-chart'

const LEGEND = [{ l: 'EE', c: 'var(--accent)', n: 'EE' }, { l: 'ENE', c: 'var(--blue)', n: 'ENE' }, { l: 'PFE 95%', c: 'var(--amber)', n: 'PFE' }]

export default function ExposureCanvas({ result, height = 230, placeholder = 'EE / ENE / PFE — press SIMULATE',
                                         highlight, onHighlight, style, children }) {
  const ref = useRef(null)
  const [ownHl, setOwnHl] = useState(null)
  const [tick, setTick] = useState(0)            // bumped when the container is resized (a tab becoming visible)
  const controlled = typeof onHighlight === 'function'
  const hl = controlled ? (highlight ?? null) : ownHl
  const setHl = controlled ? onHighlight : setOwnHl
  const fill = height === 'fill'

  // The canvas is absolutely positioned, so its size never feeds back into the container's layout: the
  // container is sized by its own height, flex or min-height alone. (Until 3 November 2026 the canvas
  // sat in flow and set its height from the container's, which the canvas itself had set: with a border
  // in between, each resize-observer tick grew the chart by a pixel, for ever, on the FX option tab.)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    let last = ''
    const ro = new ResizeObserver(() => {
      const p = canvas.parentElement
      const key = p ? `${p.clientWidth}x${p.clientHeight}` : ''
      if (key !== last) { last = key; setTick(t => t + 1) }       // redraw only when the container really changed
    })
    ro.observe(canvas.parentElement)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!result || !canvas) return
    const dpr = window.devicePixelRatio || 2
    const p = canvas.parentElement
    const w = p.clientWidth || 600
    const h = fill ? (p.clientHeight || 160) : height
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr)
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
    canvas.getContext('2d').scale(dpr, dpr)
    drawExposureChart(canvas, result.ee, result.ene, result.pfe, hl, result.sample_paths)
  }, [result, hl, height, fill, tick])

  return (
    <div style={{ position: 'relative', ...(fill ? {} : { height }), background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden', ...style }}>
      <canvas ref={ref} style={{ position: 'absolute', inset: 0, display: 'block' }} />
      {!result && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <div style={{ fontSize: '0.8125rem', color: 'var(--text-mute)', letterSpacing: '0.08em', fontFamily: 'var(--mono)' }}>{placeholder}</div>
        </div>
      )}
      {result && (
        <div style={{ position: 'absolute', top: '8px', right: '12px', display: 'flex', gap: '12px' }}>
          {LEGEND.map(({ l, c, n }) => (
            <div key={n} onMouseEnter={() => setHl(n)} onMouseLeave={() => setHl(null)}
                 style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', fontSize: '0.75rem', color: hl === n ? 'var(--text-hi)' : 'var(--text-mute)', fontFamily: 'var(--mono)' }}>
              <div style={{ width: '16px', height: '2px', background: c, opacity: hl === n ? 1 : 0.6 }} />{l}
            </div>
          ))}
        </div>
      )}
      {result && children}
    </div>
  )
}

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

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setTick(t => t + 1))
    ro.observe(canvas.parentElement)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = ref.current
    if (!result || !canvas) return
    const dpr = window.devicePixelRatio || 2
    const p = canvas.parentElement
    const w = p.offsetWidth || 600
    const h = fill ? (p.offsetHeight || 160) : height
    canvas.width = w * dpr; canvas.height = h * dpr
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
    canvas.getContext('2d').scale(dpr, dpr)
    drawExposureChart(canvas, result.ee, result.ene, result.pfe, hl, result.sample_paths)
  }, [result, hl, height, fill, tick])

  return (
    <div style={{ position: 'relative', ...(fill ? {} : { height }), background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden', ...style }}>
      <canvas ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />
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

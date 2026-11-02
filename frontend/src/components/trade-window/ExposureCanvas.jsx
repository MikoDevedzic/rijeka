// trade-window/ExposureCanvas.jsx — a sized canvas that draws the exposure chart and redraws on data or
// hover; the legend highlights a curve. Used by the FX and digital-asset XVA panel (the rates tab keeps
// its own canvas wiring).
import { useEffect, useRef, useState } from 'react'
import { drawExposureChart } from './exposure-chart'

const LEGEND = [{ l: 'EE', c: 'var(--accent)', n: 'EE' }, { l: 'ENE', c: 'var(--blue)', n: 'ENE' }, { l: 'PFE 95%', c: 'var(--amber)', n: 'PFE' }]

export default function ExposureCanvas({ result, height = 230, placeholder = 'EE / ENE / PFE — press SIMULATE' }) {
  const ref = useRef(null)
  const [hl, setHl] = useState(null)
  useEffect(() => {
    const canvas = ref.current
    if (!result || !canvas) return
    const dpr = window.devicePixelRatio || 2
    const w = canvas.parentElement.offsetWidth || 600
    canvas.width = w * dpr; canvas.height = height * dpr
    canvas.style.width = w + 'px'; canvas.style.height = height + 'px'
    canvas.getContext('2d').scale(dpr, dpr)
    drawExposureChart(canvas, result.ee, result.ene, result.pfe, hl, result.sample_paths)
  }, [result, hl, height])
  return (
    <div style={{ position: 'relative', height, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 3, overflow: 'hidden' }}>
      <canvas ref={ref} style={{ display: 'block', width: '100%', height: '100%' }} />
      {!result && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
                      color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: '0.8125rem', letterSpacing: '0.08em' }}>{placeholder}</div>
      )}
      {result && (
        <div style={{ position: 'absolute', top: 8, right: 12, display: 'flex', gap: 12 }}>
          {LEGEND.map(({ l, c, n }) => (
            <div key={n} onMouseEnter={() => setHl(n)} onMouseLeave={() => setHl(null)}
                 style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: '0.75rem', fontFamily: 'var(--mono)', color: hl === n ? 'var(--text-hi)' : 'var(--text-mute)' }}>
              <span style={{ width: 14, height: 2, background: c, display: 'inline-block' }} />{l}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

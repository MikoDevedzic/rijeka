// trade-window/Seal.jsx — the seal on a confirmation certificate: three rings of interlaced waves whose lobes and
// phases come from the trade's own hash, so every trade's is its own and the same hash always draws the same seal.
// It draws itself once when it appears (and at once where the reader has asked for less motion). `complete` adds
// what only an anchored record has: the centre point.
import { useEffect, useRef } from 'react'

import { TAU, sealRings } from './seal-rings'

function draw(cv, hash, ink, ink2, complete, p) {
  const w = cv.clientWidth, h = cv.clientHeight
  if (!w || !h) return
  const dpr = Math.max(2, window.devicePixelRatio || 1)
  if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
  const g = cv.getContext('2d')
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h)
  const rings = sealRings(hash), R = Math.min(w, h) / 2 - 1.5, cx = w / 2, cy = h / 2
  g.lineJoin = 'round'; g.lineWidth = Math.max(0.45, R / 180)
  rings.forEach((q, i) => {
    const pp = Math.max(0, Math.min(1, p * rings.length - i))
    if (!pp) return
    g.strokeStyle = i === 2 ? ink2 : ink; g.globalAlpha = 0.8
    const end = TAU * pp, steps = Math.ceil(420 * pp)
    for (let j = 0; j < q.n; j++) {
      g.beginPath()
      for (let s = 0; s <= steps; s++) {
        const th = end * s / steps
        const rad = R * (q.b + q.a * Math.sin(q.k * th + j * TAU / q.n) * (0.72 + 0.28 * Math.cos(q.m * th + q.ph)))
        const x = cx + rad * Math.cos(th - Math.PI / 2), y = cy + rad * Math.sin(th - Math.PI / 2)
        if (s) g.lineTo(x, y); else g.moveTo(x, y)
      }
      g.stroke()
    }
  })
  g.globalAlpha = 1; g.strokeStyle = ink; g.lineWidth = Math.max(0.6, R / 120)
  for (const rr of [R, R * 0.955]) { g.beginPath(); g.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + TAU * p); g.stroke() }
  if (p >= 1 && complete) { g.fillStyle = ink2; g.beginPath(); g.arc(cx, cy, R * 0.045, 0, TAU); g.fill() }
}

export default function Seal({ hash, ink = '#2a3b98', ink2 = '#bf261d', complete = true, size = 164 }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || !hash) return
    const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (still) { draw(cv, hash, ink, ink2, complete, 1); return }
    let raf = 0
    const t0 = performance.now(), ms = 1400
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms)
      draw(cv, hash, ink, ink2, complete, k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [hash, ink, ink2, complete])
  return <canvas ref={ref} data-testid="confirm-seal" aria-label="The seal drawn from this trade's hash" role="img" style={{ width: size, height: size, flexShrink: 0 }} />
}

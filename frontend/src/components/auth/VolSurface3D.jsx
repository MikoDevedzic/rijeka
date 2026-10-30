// A slowly rotating wireframe of the ATM swaption vol surface (expiry x
// tenor x normal vol), drawn on a canvas with a simple perspective camera.
// Real data from /api/public/pulse when available, a plausible hump when not.
import { useEffect, useRef } from 'react'

const FALLBACK_GRID = (() => {
  const exps = [1, 2, 3, 5, 7, 10], tens = [1, 2, 5, 10, 20, 30]
  const z = exps.map(e => tens.map(t => 72 + 30 * Math.exp(-((Math.log(e) - Math.log(1.5)) ** 2) / 1.2) * Math.exp(-((Math.log(t) - Math.log(2)) ** 2) / 2.2) + 2 * Math.log(t)))
  return { exps, tens, z }
})()

export default function VolSurface3D({ grid, height = 260, accent = '#0dd4a8' }) {
  const ref = useRef(null)
  const g = grid || FALLBACK_GRID

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    // refine the sparse quote grid (5x6 or so) into a smooth mesh: bilinear in
    // log(expiry) x log(tenor) index space, so the wire reads as a surface
    const R = 4
    const nE0 = g.exps.length, nT0 = g.tens.length
    const nE = (nE0 - 1) * R + 1, nT = (nT0 - 1) * R + 1
    const at = (i, j) => {
      const ei = Math.min(nE0 - 2, Math.floor(i / R)), tj = Math.min(nT0 - 2, Math.floor(j / R))
      const u = i / R - ei, v = j / R - tj
      const z = g.z
      return (1 - u) * (1 - v) * z[ei][tj] + u * (1 - v) * z[ei + 1][tj] + (1 - u) * v * z[ei][tj + 1] + u * v * z[ei + 1][tj + 1]
    }
    let lo = Infinity, hi = -Infinity
    for (const row of g.z) for (const v of row) { lo = Math.min(lo, v); hi = Math.max(hi, v) }
    const span = Math.max(1e-6, hi - lo)
    // model space: x = tenor (-1..1), y = vol (0..1.05), zz = expiry (-1..1)
    const pts = Array.from({ length: nE }, (_, i) => Array.from({ length: nT }, (_, j) =>
      [j / (nT - 1) * 2 - 1, (at(i, j) - lo) / span * 1.05, i / (nE - 1) * 2 - 1]))
    const isNode = (i, j) => i % R === 0 && j % R === 0

    let raf = 0, t0 = performance.now(), alive = true
    const tilt = -0.62
    const resize = () => {
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1)
      cv.width = Math.max(1, Math.round(r.width * dpr)); cv.height = Math.max(1, Math.round(r.height * dpr))
    }
    resize()
    const ro = new ResizeObserver(resize); ro.observe(cv)

    const project = (p, th) => {
      const c = Math.cos(th), s = Math.sin(th)
      let x = p[0] * c - p[2] * s, zz = p[0] * s + p[2] * c, y = p[1] - 0.45
      const ct = Math.cos(tilt), st = Math.sin(tilt)
      const y2 = y * ct - zz * st, z2 = y * st + zz * ct
      const d = 3.0 / (3.0 + z2)
      return [x * d, y2 * d, z2]
    }

    const draw = (now) => {
      if (!alive) return
      const W = cv.width, H = cv.height
      const el = (now - t0) / 1000
      const th = reduce ? 0.6 : 0.55 + el * 0.16
      const reveal = Math.min(1, el / 1.8)          // lines draw in over the first ~2s
      ctx.clearRect(0, 0, W, H)
      const S = Math.min(W / 2.35, H / 1.3), cx = W / 2, cy = H * 0.6
      const P = pts.map(row => row.map(p => project(p, th)))
      const toPx = q => [cx + q[0] * S, cy - q[1] * S]

      // faces, painter's order, faint fill by height
      const quads = []
      for (let i = 0; i < nE - 1; i++) for (let j = 0; j < nT - 1; j++) {
        const a = P[i][j], b = P[i][j + 1], c = P[i + 1][j + 1], d = P[i + 1][j]
        quads.push({ z: (a[2] + b[2] + c[2] + d[2]) / 4, h: (pts[i][j][1] + pts[i + 1][j + 1][1]) / 1.8, q: [a, b, c, d] })
      }
      quads.sort((u, v) => v.z - u.z)
      for (const f of quads) {
        ctx.beginPath()
        f.q.forEach((q, k) => { const [x, y] = toPx(q); k ? ctx.lineTo(x, y) : ctx.moveTo(x, y) })
        ctx.closePath()
        ctx.fillStyle = `rgba(13,212,168,${(0.025 + 0.2 * f.h) * reveal})`
        ctx.fill()
      }
      // wire: along tenor then along expiry; alpha by depth so the back reads as behind
      ctx.lineWidth = Math.max(0.8, S / 420)
      const seg = (a, b, k) => {
        const depth = 1 - Math.min(1, Math.max(0, ((a[2] + b[2]) / 2 + 1.2) / 2.4))
        ctx.strokeStyle = `rgba(13,212,168,${(0.22 + 0.6 * depth) * k})`
        const [x1, y1] = toPx(a), [x2, y2] = toPx(b)
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
      }
      const total = (nE * (nT - 1)) + (nT * (nE - 1))
      let n = 0
      for (let i = 0; i < nE; i++) for (let j = 0; j < nT - 1; j++) { if (n++ / total <= reveal) seg(P[i][j], P[i][j + 1], 1) }
      for (let j = 0; j < nT; j++) for (let i = 0; i < nE - 1; i++) { if (n++ / total <= reveal) seg(P[i][j], P[i + 1][j], 1) }
      // nodes
      for (let i = 0; i < nE; i++) for (let j = 0; j < nT; j++) {
        if (!isNode(i, j)) continue
        const q = P[i][j], [x, y] = toPx(q)
        const depth = 1 - Math.min(1, Math.max(0, (q[2] + 1.2) / 2.4))
        ctx.fillStyle = `rgba(13,212,168,${(0.25 + 0.7 * depth) * reveal})`
        ctx.beginPath(); ctx.arc(x, y, Math.max(1.4, S / 120) * (0.6 + 0.6 * depth), 0, Math.PI * 2); ctx.fill()
      }
      // axis captions on the two front edges
      ctx.font = `${Math.max(9, S / 22)}px "JetBrains Mono", monospace`
      ctx.fillStyle = 'rgba(139,152,168,0.9)'
      ctx.textAlign = 'center'
      const lab = (p, txt) => { const [x, y] = toPx(project(p, th)); ctx.fillText(txt, x, y) }
      lab([0, -0.08, -1.25], `TENOR ${g.tens[0]}Y → ${g.tens[nT0 - 1]}Y`)
      ctx.save(); ctx.textAlign = 'center'
      lab([1.28, -0.08, 0], `EXPIRY ${g.exps[0]}Y → ${g.exps[nE0 - 1]}Y`)
      ctx.restore()
      if (!reduce || el < 2.5) raf = requestAnimationFrame(draw)
    }
    const vis = () => { if (document.hidden) cancelAnimationFrame(raf); else { t0 = performance.now() - 3000; raf = requestAnimationFrame(draw) } }
    document.addEventListener('visibilitychange', vis)
    raf = requestAnimationFrame(draw)
    return () => { alive = false; cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', vis) }
  }, [g, accent])

  return <canvas ref={ref} className="au-vol" style={{ height }} aria-hidden="true" />
}

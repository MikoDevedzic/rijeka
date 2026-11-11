// brand/RijekaLogo.jsx — the logo in a bar: the river running into the ringed R that begins the name.
//
// It runs once when it appears (the paths grow, meet, and the line draws the R), then holds still: a mark that
// restarts in the header of a trading screen would pull the eye from the numbers. It runs once more whenever a
// trade is confirmed on chain (the window event `rijeka:confirmed`, sent by ConfirmMark). With "reduce motion" set
// it is drawn complete and does not move.
import { useEffect, useRef, useState } from 'react'

import { OFFICIAL_SEED, drawLockup, field, fit, lockupUnits, palette, phases, reducedMotion } from './mark'

const SHAPE = { x0: 50, spread: 24, box: 62, minw: 1.2, amin: 0.75 }      // a short, flat river, so the letters are as tall as the bar's type

export default function RijekaLogo({ height = 28, paths = 5, className = '', onClick, title = 'Rijeka: home' }) {
  const ref = useRef(null)
  const [width, setWidth] = useState(Math.round(height * 5.4))
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const f = field(OFFICIAL_SEED + 3, paths), still = reducedMotion()
    let raf = 0, start = performance.now(), pal = palette(cv), gone = false
    const measure = () => {
      pal = palette(cv)
      const u = lockupUnits(cv.getContext('2d'), { ...SHAPE, pal })
      setWidth(Math.ceil((u.right - (SHAPE.x0 - 4)) * height / SHAPE.box))
    }
    const frame = (now) => {
      const ms = now - start, p = still ? { progress: 1, trunk: 1, letter: 1, done: true } : phases(ms)
      const g = fit(cv)
      if (g.w && g.h) drawLockup(g.c, g.w, g.h, { ...SHAPE, f, pal, t: still ? 0 : Math.min(ms, 3800) / 1000, progress: p.progress, trunk: p.trunk, letter: p.letter })
      raf = p.done ? 0 : requestAnimationFrame(frame)
    }
    const wake = () => { if (!raf && !gone) raf = requestAnimationFrame(frame) }                 // draws the state it is in: mid-run, or complete
    const run = () => { start = performance.now(); wake() }
    measure(); run()
    document.fonts?.ready?.then(() => { if (!gone) { measure(); wake() } })                             // the type's width is only right once the face has loaded
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(wake) : null    // a new width clears the canvas
    ro?.observe(cv)
    window.addEventListener('rijeka:confirmed', run)
    return () => { gone = true; cancelAnimationFrame(raf); ro?.disconnect(); window.removeEventListener('rijeka:confirmed', run) }
  }, [height, paths])
  const press = onClick ? { role: 'link', tabIndex: 0, onClick, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e) } } } : { role: 'img' }
  return <canvas ref={ref} className={`rj-logo ${className}`.trim()} data-testid="rijeka-logo" aria-label={title} title={title} {...press} style={{ width, height }} />
}

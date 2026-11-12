// The app opening from its icon on a phone's home screen. The icon is the mark at rest (a home screen's icon is a
// still picture on every phone); this is the same mark coming alive: the paths run in, meet, and the line draws the
// R. It is shown once per launch, only when the app runs standalone (opened from the home screen), for about three
// seconds or until it is touched; with "reduce motion" set it is not shown at all.
import { useEffect, useRef, useState } from 'react'
import { OFFICIAL_SEED, drawMark, field, fit, palette, phases, reducedMotion } from './mark'
import { standalone } from '../../lib/phone'

const SEEN = 'rijeka.launched'
const due = () => {
  if (!standalone() || reducedMotion()) return false
  try { if (sessionStorage.getItem(SEEN)) return false; sessionStorage.setItem(SEEN, '1') } catch { /* no storage: show it */ }
  return true
}

export default function LaunchMark() {
  const [on, setOn] = useState(due)
  const [leaving, setLeaving] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!on) return undefined
    const cv = ref.current, f = field(OFFICIAL_SEED, 13), born = performance.now()
    let raf = 0, done = false
    const end = () => { if (done) return; done = true; setLeaving(true); setTimeout(() => setOn(false), 350) }
    const frame = (now) => {
      raf = 0
      if (!cv || !cv.isConnected) return
      const ms = now - born, p = phases(ms * 1.2), g = fit(cv)
      if (g.w && g.h) drawMark(g.c, g.w, g.h, { f, pal: palette(cv), t: ms / 1000, minw: 1, box: 124, progress: p.progress, trunk: p.trunk, letter: p.letter })
      if (ms < 3000) raf = requestAnimationFrame(frame); else end()
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf) }
  }, [on])
  if (!on) return null
  return (
    <div className={`launch-mark${leaving ? ' leaving' : ''}`} data-testid="launch-mark" role="img" aria-label="Rijeka" onClick={() => setOn(false)}>
      <canvas ref={ref} />
    </div>
  )
}

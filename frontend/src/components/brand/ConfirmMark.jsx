// brand/ConfirmMark.jsx — the logo as the picture of a confirmation in progress.
//
// While a trade is being signed and anchored the river runs: the paths grow in, meet, and keep re-simulating; the
// line reaches the ring and waits there, and the R and its ring show only as a faint outline. When the trade is
// confirmed the line runs into the letter and the R and ring are drawn: the logo is complete because the record
// is. If the confirmation fails the river fades and the letter is never drawn. With "reduce motion" set each state
// is drawn at once and nothing moves.
import { useEffect, useRef } from 'react'

import { OFFICIAL_SEED, drawMark, ease, field, fit, palette, reducedMotion } from './mark'

const LABEL = { running: 'Signing and anchoring: the confirmation is in progress', done: 'Confirmed: the record is complete', failed: 'Not confirmed' }

export default function ConfirmMark({ phase = 'running', seed = OFFICIAL_SEED, width = 280, height = 100 }) {
  const ref = useRef(null)
  const live = useRef({ phase, since: 0, began: 0, announced: false })
  const wakeRef = useRef(null)
  useEffect(() => {
    const now = performance.now(), s = live.current
    if (!s.began) s.began = now
    if (s.phase !== phase || !s.since) { s.phase = phase; s.since = now }
    if (phase === 'done' && !s.announced) { s.announced = true; window.dispatchEvent(new Event('rijeka:confirmed')) }
    wakeRef.current?.()                                // a change of phase wakes a loop that had finished
  }, [phase])
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const f = field(seed, 13), still = reducedMotion()
    let raf = 0
    const frame = (now) => {
      const s = live.current, pal = palette(cv), g = fit(cv)
      const age = (now - s.began) / 1000, inPhase = (now - s.since) / 1000
      let o = { progress: ease(age / 2.2), trunk: ease((age - 2.1) / 0.5), letter: 0, ghost: 1, alpha: 1 }, again = true
      if (s.phase === 'done') { o = { ...o, progress: 1, trunk: 1, letter: Math.min(1, inPhase / 1.1), ghost: 1 - Math.min(1, inPhase / 0.6) }; again = inPhase < 4 }
      if (s.phase === 'failed') { o = { ...o, ghost: 0.5, alpha: 1 - 0.6 * Math.min(1, inPhase / 0.8) }; again = inPhase < 0.9 }
      if (still) { o = { progress: 1, trunk: 1, letter: s.phase === 'done' ? 1 : 0, ghost: s.phase === 'done' ? 0 : 1, alpha: s.phase === 'failed' ? 0.4 : 1 }; again = false }
      if (g.w && g.h) drawMark(g.c, g.w, g.h, { f, pal, t: still ? 0 : age, minw: 1, box: 120, ...o })
      if (again) raf = requestAnimationFrame(frame); else raf = 0
    }
    const wake = () => { if (!raf) raf = requestAnimationFrame(frame) }
    wakeRef.current = wake; wake()
    // The ticket keeps a visited tab mounted and hidden, and a hidden canvas has no size: draw again when it has one.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(wake) : null
    ro?.observe(cv)
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); wakeRef.current = null }
  }, [seed])
  return <canvas ref={ref} data-testid="confirm-mark" data-phase={phase} role="img" aria-label={LABEL[phase] || ''} style={{ width, height, maxWidth: '100%', display: 'block' }} />
}

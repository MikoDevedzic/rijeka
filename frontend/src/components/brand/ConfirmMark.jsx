// brand/ConfirmMark.jsx — the logo as the picture of a confirmation in progress.
//
// While a trade is being signed and anchored the river runs: the paths grow in, meet, and keep re-simulating; the
// line reaches the ring and waits there, and the R and its ring show only as a faint outline. When the trade is
// confirmed the line runs into the letter and the R is drawn. The ring is the seal: it is drawn only when the
// record is anchored on a chain (`sealed`), and stays an outline where it is not. If the confirmation fails the
// river fades and the letter is never drawn. With "reduce motion" set each state is drawn at once and nothing moves.
//
// The loop runs only while there is something to see: it stops when the canvas has no size (the ticket keeps a
// visited tab mounted and hidden) or the page is hidden, and is woken when either comes back.
import { useEffect, useRef } from 'react'

import { OFFICIAL_SEED, drawMark, ease, field, fit, palette, reducedMotion } from './mark'

const LABEL = {
  running: 'Signing and anchoring: the confirmation is in progress',
  waiting: 'The confirmation is waiting',
  failed: 'Not confirmed',
}

export default function ConfirmMark({ phase = 'running', sealed = false, seed = OFFICIAL_SEED, width = 280, height = 100 }) {
  const ref = useRef(null)
  const live = useRef({ phase, since: 0, began: 0, sealedAt: 0, announced: false })
  const wakeRef = useRef(null)
  useEffect(() => {
    const now = performance.now(), s = live.current
    if (!s.began) s.began = now
    if (s.phase !== phase || !s.since) { s.phase = phase; s.since = now }
    if (sealed && !s.sealedAt) s.sealedAt = now
    if (phase === 'done' && !s.announced) { s.announced = true; window.dispatchEvent(new Event('rijeka:confirmed')) }
    wakeRef.current?.()                                // a change wakes a loop that had finished
  }, [phase, sealed])
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const f = field(seed, 13), still = reducedMotion()
    let raf = 0
    const frame = (now) => {
      raf = 0
      const s = live.current, g = fit(cv)
      if (!g.w || !g.h || document.hidden) return      // nothing to see: wait to be woken
      const age = (now - s.began) / 1000, inPhase = (now - s.since) / 1000, sealedFor = s.sealedAt ? (now - s.sealedAt) / 1000 : -1
      let o = { progress: ease(age / 2.2), trunk: ease((age - 2.1) / 0.5), letter: 0, ring: 0, ghost: 1, alpha: 1 }, again = s.phase === 'running'
      if (s.phase === 'done') {
        const ring = sealedFor < 0 ? 0 : Math.min(1, sealedFor / 0.9)
        o = { ...o, progress: 1, trunk: 1, letter: Math.min(1, inPhase / 0.8), ring, ghost: 1 - ring }
        again = inPhase < 3.5 || (sealedFor >= 0 && sealedFor < 3.5)      // it settles, then holds still
      }
      if (s.phase === 'failed') { o = { ...o, ghost: 0.5, alpha: 1 - 0.6 * Math.min(1, inPhase / 0.8) }; again = inPhase < 0.9 }
      if (still) { o = { progress: 1, trunk: 1, letter: s.phase === 'done' ? 1 : 0, ring: s.phase === 'done' && s.sealedAt ? 1 : 0, ghost: s.phase === 'done' && s.sealedAt ? 0 : 1, alpha: s.phase === 'failed' ? 0.4 : 1 }; again = false }
      drawMark(g.c, g.w, g.h, { f, pal: palette(cv), t: still ? 0 : age, minw: 1, box: 120, ...o })
      if (again) raf = requestAnimationFrame(frame)
    }
    const wake = () => { if (!raf) raf = requestAnimationFrame(frame) }
    wakeRef.current = wake; wake()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(wake) : null
    ro?.observe(cv)
    document.addEventListener('visibilitychange', wake)
    return () => { cancelAnimationFrame(raf); raf = 0; ro?.disconnect(); document.removeEventListener('visibilitychange', wake); wakeRef.current = null }
  }, [seed])
  const label = phase === 'done' ? (sealed ? 'Confirmed on chain: the record is sealed' : 'Confirmed: the record is signed and not anchored on a chain') : (LABEL[phase] || '')
  return <canvas ref={ref} data-testid="confirm-mark" data-phase={phase} data-sealed={sealed ? 'yes' : 'no'} role="img" aria-label={label} style={{ width, height, maxWidth: '100%', display: 'block' }} />
}

// brand/CertMark.jsx — the mark on a certificate of confirmation and on the paper made from it.
//
// It is the logo: this trade's river running into the ringed R. The river's paths come from the record's hash, so
// every trade's is its own and the same hash always draws the same one. The ring is the seal, as everywhere the
// mark is drawn: it is closed only where the record stands on a chain (`stands`); a record that is signed and not
// anchored, or closed, has the R with its ring as a faint outline, and the whole in the paper's grey.
//
// The inks are the paper's own tokens (.cert in trade-window/styles.css). It draws itself once when it comes into
// view (the ticket keeps a visited tab mounted and hidden, and a hidden canvas has no size), and at once where the
// reader has asked for less motion or it is being printed (`still`).
import { useEffect, useRef } from 'react'

import { drawMark, ease, field, fit, palette, reducedMotion, seedOf } from './mark'

const SHAPE = { x0: 78, spread: 30, box: 104 }       // a short river: on a certificate the letter and its ring are what is read, and are drawn large
const clamp = (x) => Math.max(0, Math.min(1, x))

export default function CertMark({ hash, stands = true, still = false, width = 164, height = 124 }) {
  const ref = useRef(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv || !hash) return undefined
    const f = field(seedOf(String(hash)), 7), atOnce = still || reducedMotion()
    let raf = 0, shown = false
    const paint = (p) => {
      const g = fit(cv)
      if (!g.w || !g.h) return
      let pal = palette(cv)
      if (!stands) { const grey = getComputedStyle(cv).getPropertyValue('--text-faint').trim() || pal.pale; pal = { ...pal, line: grey, letter: grey, pale: grey, blue: grey } }
      drawMark(g.c, g.w, g.h, { ...SHAPE, f, pal, t: 0, progress: clamp(p * 1.7), trunk: clamp((p - 0.5) * 4), letter: clamp((p - 0.6) * 3.4),
        ring: stands ? clamp((p - 0.82) * 5.6) : 0, ghost: stands ? 0 : clamp((p - 0.6) * 3.4), minw: 1 })
    }
    const play = () => {
      cancelAnimationFrame(raf)
      if (atOnce) { paint(1); return }
      const t0 = performance.now(), ms = 1500
      const step = (t) => { const k = Math.min(1, (t - t0) / ms); paint(ease(k)); if (k < 1) raf = requestAnimationFrame(step) }
      raf = requestAnimationFrame(step)
    }
    const seen = () => {
      const visible = cv.clientWidth > 0 && cv.clientHeight > 0
      if (visible && !shown) play()
      shown = visible
    }
    seen()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(seen) : null
    ro?.observe(cv)
    return () => { cancelAnimationFrame(raf); ro?.disconnect() }
  }, [hash, stands, still])
  return <canvas ref={ref} data-testid="cert-mark" data-stands={stands ? 'yes' : 'no'} role="img"
    aria-label={stands ? 'Rijeka: this record stands on the registry' : 'Rijeka: this record is not on the registry'} style={{ width, height, flexShrink: 0 }} />
}

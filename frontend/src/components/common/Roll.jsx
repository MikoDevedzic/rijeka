// common/Roll.jsx — a figure that rolls to its new value and flashes once when it lands, and the mark that says
// which risk factor a label is for.
//
// Roll: give it the text the app prints ("+$4,669"). When a figure arrives (a first price) it counts up from zero;
// when it changes it counts from the figure that was there; in about a third of a second, in the same dress
// throughout (lib/roll.js). Then it flashes once: green if the number went up, rose if it went down, limestone
// for a first price. Where the reader has asked for less motion, and for text that is not a number, the text is
// simply shown. The element always ends holding exactly the text it was given.
//
// The span's text is written here, not by React (it has no children), so a frame of the roll is never fought
// over; it is written before the first paint, so there is no empty frame either.
import { useLayoutEffect, useRef } from 'react'
import { rollFrom, formatLike, direction, ease } from '../../lib/roll'
import { RISK_FACTORS, riskFactorOf } from '../../lib/risk-factors'

const MS = 340
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export default function Roll({ children, ...rest }) {
  const text = children == null ? '' : String(children)
  const ref = useRef(null)
  const shown = useRef('')              // what the element held before this text
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const prev = shown.current
    shown.current = text
    el.textContent = text
    if (still()) return
    const plan = rollFrom(prev, text)
    if (!plan) return
    const dir = direction(prev, text)
    let raf = 0
    const t0 = performance.now()
    el.classList.remove('rj-flash', 'rj-flash-up', 'rj-flash-down', 'rj-flash-in')
    el.textContent = formatLike(plan.start, plan.to)
    const step = (t) => {
      const k = (t - t0) / MS
      if (k < 1) {
        el.textContent = formatLike(plan.start + (plan.to.value - plan.start) * ease(k), plan.to)
        raf = requestAnimationFrame(step)
      } else {
        el.textContent = text
        void el.offsetWidth                          // restart the flash if one is still running
        el.classList.add('rj-flash', dir > 0 ? 'rj-flash-up' : dir < 0 ? 'rj-flash-down' : 'rj-flash-in')
      }
    }
    raf = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf); el.textContent = text }
  }, [text])
  return <span ref={ref} data-roll={text} {...rest} />
}

// The small square before a sensitivity's name, in its risk factor's colour (lib/risk-factors.js), with the
// sentence that says the factor adds. Nothing for a label that is not a sensitivity.
export function RiskMark({ label }) {
  const key = riskFactorOf(label)
  const f = key && RISK_FACTORS[key]
  if (!f) return null
  return <span className="rf-mark" data-rf={key} role="img" aria-label={f.name} title={`${f.name}: ${f.adds}.`} style={{ background: `var(${f.token})` }} />
}

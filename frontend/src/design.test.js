// One way of setting type and colour (docs/design.md), held by counts that may only go down. The source still has
// many sizes and colours written by hand; this does not ask for them all to be gone today, it stops there being
// more tomorrow. A change that needs a new size or colour adds a token, not a literal.
import { describe, expect, it } from 'vitest'
import { KEYS, SCALE, baseline, measure } from '../scripts/check-design.mjs'

describe('type and colour are set one way', () => {
  const now = measure()
  const base = baseline()
  for (const k of KEYS) {
    it(`${k}: no more than the baseline (${base[k]})`, () => {
      const top = Object.entries(now.worst[k] || {}).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, n]) => `${f} (${n})`).join(', ')
      expect(now[k], `${k} rose from ${base[k]} to ${now[k]}. Use a step of the scale (${SCALE.join(', ')} px), a colour token, var(--mono) or var(--sans). Most in: ${top}. After a clean-up: npm run design -- --update`).toBeLessThanOrEqual(base[k])
    })
  }
  it('the baseline is not left higher than the source: lower it when a clean-up lands', () => {
    for (const k of KEYS) expect(base[k] - now[k], `${k} is ${now[k]}, the baseline still says ${base[k]}: npm run design -- --update`).toBeLessThanOrEqual(0)
  })
})

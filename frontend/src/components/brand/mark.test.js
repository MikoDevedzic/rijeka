// The logo's arithmetic: the same seed draws the same river, a path is pinned at both ends whatever the time,
// and a run reaches each of its stages in order.
import { describe, expect, it } from 'vitest'

import { MODES, bridge, ease, field, phases, rng, seedOf } from './mark'

describe('the mark', () => {
  it('draws the same river from the same seed, and another from another', () => {
    const a = field(42, 13), b = field(42, 13), c = field(43, 13)
    expect(a).toEqual(b)
    expect(a.length).toBe(13)
    expect(a[0].length).toBe(MODES)
    expect(c[0][0].a).not.toBe(a[0][0].a)
  })

  it('pins every path at both ends, at any time', () => {
    const f = field(7, 5)
    for (const modes of f) for (const t of [0, 1.7, 40, 1234.5]) {
      expect(bridge(modes, 0, t)).toBeCloseTo(0, 12)
      expect(Math.abs(bridge(modes, 1, t))).toBeLessThan(1e-9)
    }
  })

  it('moves a path with time, and keeps it within a few standard deviations of a bridge', () => {
    const modes = field(11, 1)[0]
    expect(bridge(modes, 0.5, 0)).not.toBe(bridge(modes, 0.5, 3))
    for (let k = 0; k <= 200; k++) expect(Math.abs(bridge(modes, 0.5, k * 0.37))).toBeLessThan(2.5)      // sd at the middle is 0.5
  })

  it('has the variance of a Brownian bridge at its middle, over many seeds', () => {
    let sum = 0, n = 4000
    for (let s = 1; s <= n; s++) { const y = bridge(field(s, 1)[0], 0.5, 0); sum += y * y }
    expect(sum / n).toBeGreaterThan(0.20)        // the full bridge has 0.25; fourteen terms of the series carry a little less
    expect(sum / n).toBeLessThan(0.28)
  })

  it('runs in order: paths, then the line, then the letter', () => {
    expect(phases(0)).toMatchObject({ progress: 0, trunk: 0, letter: 0, done: false })
    const mid = phases(2300)
    expect(mid.progress).toBe(1); expect(mid.trunk).toBeGreaterThan(0); expect(mid.letter).toBe(0)
    const end = phases(3900)
    expect(end).toMatchObject({ progress: 1, trunk: 1, letter: 1, done: true })
    expect(ease(-1)).toBe(0); expect(ease(2)).toBe(1)
  })

  it('makes a seed from a trade id, never zero, the same every time', () => {
    expect(seedOf('3f1c')).toBe(seedOf('3f1c'))
    expect(seedOf('3f1c')).not.toBe(seedOf('3f1d'))
    expect(seedOf('')).toBeGreaterThan(0)
    const r = rng(seedOf('x')); const v = r()
    expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1)
  })
})

import { describe, it, expect } from 'vitest'
import { parseFigure, formatLike, rollFrom, direction, ease } from './roll'

describe('a figure that rolls to its new value', () => {
  it('reads the number in the text the app prints, with its dress', () => {
    expect(parseFigure('+$4,669')).toMatchObject({ prefix: '+$', value: 4669, decimals: 0, suffix: '', negative: false })
    expect(parseFigure('−$2,986')).toMatchObject({ prefix: '−$', value: 2986, negative: true })
    expect(parseFigure('-$6')).toMatchObject({ value: 6, negative: true })
    expect(parseFigure('10,743')).toMatchObject({ prefix: '', value: 10743 })
    expect(parseFigure('3.480%')).toMatchObject({ value: 3.48, decimals: 3, suffix: '%' })
    expect(parseFigure('0 USD')).toMatchObject({ value: 0, suffix: ' USD' })
    expect(parseFigure('108,466.36')).toMatchObject({ value: 108466.36, decimals: 2 })
    for (const t of ['—', 'pricing…', '', null, undefined, 42, {}]) expect(parseFigure(t), String(t)).toBeNull()
    // more than one number, or a number grouped with points: shown as it is, not rolled
    for (const t of ['12.3 / 15.6', '0.99049 / 0.99247', '+$1.234.567', '5 + 5', '2026-11-10']) expect(parseFigure(t), t).toBeNull()
  })
  it('writes a number in between exactly as the app would have printed it', () => {
    const like = parseFigure('+$4,669')
    expect(formatLike(0, like)).toBe('$0')                                  // a frame that rounds to nothing has no sign
    expect(formatLike(0.3, parseFigure('−$2,986'))).toBe('$0')
    expect(formatLike(1234.4, like)).toBe('+$1,234')
    expect(formatLike(4669, like)).toBe('+$4,669')                         // the last frame is the text itself
    expect(formatLike(1493, parseFigure('−$2,986'))).toBe('−$1,493')
    expect(formatLike(1.74, parseFigure('3.480%'))).toBe('1.740%')
    expect(formatLike(54233.18, parseFigure('108,466.36'))).toBe('54,233.18')
    for (const t of ['+$4,669', '−$2,986', '10,743', '3.480%', '0 USD', '108,466.36', '27']) expect(formatLike(parseFigure(t).value, parseFigure(t)), t).toBe(t)
  })
  it('rolls from what was shown, or from zero for a first price or a figure that crossed zero', () => {
    expect(rollFrom('—', '+$4,669')).toMatchObject({ start: 0 })
    expect(rollFrom(undefined, '+$4,669')).toMatchObject({ start: 0 })
    expect(rollFrom('+$4,000', '+$4,669')).toMatchObject({ start: 4000 })
    expect(rollFrom('−$2,986', '+$10')).toMatchObject({ start: 0 })
    expect(rollFrom('+$4,669', '+$4,669')).toBeNull()                      // nothing changed
    expect(rollFrom('+$4,669', '—')).toBeNull()                            // not a number: shown as it is
    expect(rollFrom('—', '+$0')).toBeNull()                                // zero from nothing: nothing to roll
  })
  it('knows which way the signed number went', () => {
    expect(direction('+$4,000', '+$4,669')).toBe(1)
    expect(direction('−$2,986', '−$3,100')).toBe(-1)
    expect(direction('−$2,986', '+$10')).toBe(1)
    expect(direction('—', '+$10')).toBe(0)
    expect(direction('27', '27')).toBe(0)
  })
  it('eases from 0 to 1 and stays inside', () => {
    expect(ease(0)).toBe(0); expect(ease(1)).toBe(1); expect(ease(2)).toBe(1); expect(ease(-1)).toBe(0)
    expect(ease(0.5)).toBeGreaterThan(0.5)
  })
})

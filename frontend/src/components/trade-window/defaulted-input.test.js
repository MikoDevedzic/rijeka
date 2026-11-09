import { describe, it, expect } from 'vitest'
import { fieldView, overrideFrom, DASH, OVERRIDE_TAG, INVALID_TAG } from './defaulted-input'
import { formatInput } from './fx-ticket'

const rate = (n) => formatInput(n, 2)          // as the ticket writes a number into a field: a point, no grouping

describe('a field on its default shows the number', () => {
  it('no override and a known number: the number, formatted, with where it is from', () => {
    expect(fieldView({ value: '', fallback: 74747.9, format: rate, tag: 'stored spot · 2026-11-09' }))
      .toEqual({ state: 'default', text: '74747.90', tag: 'stored spot · 2026-11-09' })
  })
  it('a number that arrives as text is still a number, and zero is a number', () => {
    expect(fieldView({ value: '', fallback: '52.34', format: rate, tag: 'from the surface' }).text).toBe('52.34')
    expect(fieldView({ value: '', fallback: 0, format: rate, tag: 'saved rate' })).toEqual({ state: 'default', text: '0.00', tag: 'saved rate' })
    expect(fieldView({ value: '', fallback: 1.085 }).text).toBe('1.085')
  })
  it('an override: the text as typed, tagged override, whatever the default is', () => {
    expect(fieldView({ value: '75000', fallback: 75781.53, format: rate, tag: 'fair forward' })).toEqual({ state: 'override', text: '75000', tag: OVERRIDE_TAG })
    expect(fieldView({ value: '75000.', fallback: null, format: rate, tag: 'fair forward' }).text).toBe('75000.')
    expect(OVERRIDE_TAG).toBe('override')
  })
  it('no override and no number yet: a dash and the tag, never an empty box', () => {
    for (const fallback of [null, undefined, '', NaN, Infinity, 'soon'])
      expect(fieldView({ value: '', fallback, format: rate, tag: 'fair forward' })).toEqual({ state: 'empty', text: DASH, tag: 'fair forward' })
    expect(fieldView({ value: null, fallback: null }).tag).toBe('')
  })
})

describe('text that cannot be read is kept and marked, never turned into another number', () => {
  it('a comma decimal, two points, a lone point: invalid, the text as typed, and the field says what to do', () => {
    for (const value of ['1,08345', '1.2.3', '.', '1e5', 'abc', '-5'])
      expect(fieldView({ value, fallback: 1.085, format: rate, tag: 'stored spot' }), value).toEqual({ state: 'invalid', text: value, tag: INVALID_TAG })
    expect(INVALID_TAG).toBe('not a number: use a point for decimals')
  })
  it('a minus is a number only where the field is signed', () => {
    expect(fieldView({ value: '-1.35', fallback: 3, format: rate, tag: 'saved rate', signed: true }).state).toBe('override')
    expect(fieldView({ value: '-1.35', fallback: 3, format: rate, tag: 'saved rate' }).state).toBe('invalid')
    expect(fieldView({ value: '-1,35', fallback: 3, format: rate, tag: 'saved rate', signed: true }).state).toBe('invalid')
  })
  it('grouped as en-US groups it is an override, shown as typed', () => {
    expect(fieldView({ value: '108,250.5', fallback: 1, format: rate })).toEqual({ state: 'override', text: '108,250.5', tag: OVERRIDE_TAG })
  })
  it('the default the field shows reads back as the same number, so editing one digit of it changes one digit', () => {
    const shown = fieldView({ value: '', fallback: 1.08345, format: (n) => formatInput(n, 5), tag: 'stored spot' }).text
    expect(shown).toBe('1.08345')
    expect(fieldView({ value: shown.replace(/5$/, '6'), fallback: 1.08345, format: rate })).toEqual({ state: 'override', text: '1.08346', tag: OVERRIDE_TAG })
  })
})

describe('what a keystroke leaves', () => {
  it('the text as typed: nothing is stripped out of it, so nothing is read that was not meant', () => {
    expect(overrideFrom('7')).toBe('7')
    expect(overrideFrom('75000.5')).toBe('75000.5')
    expect(overrideFrom('1,08')).toBe('1,08')
    expect(overrideFrom('-1.25')).toBe('-1.25')
  })
  it('a key typed beside the dash of an empty field is the key alone', () => {
    expect(overrideFrom(`${DASH}5`)).toBe('5')
  })
  it('a field cleared by hand, left with the dash, or holding only spaces is back on its default', () => {
    expect(overrideFrom('')).toBe('')
    expect(overrideFrom(DASH)).toBe('')
    expect(overrideFrom('  ')).toBe('')
    expect(overrideFrom(null)).toBe('')
  })
})

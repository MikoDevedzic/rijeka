import { describe, it, expect } from 'vitest'
import { groupForDisplay } from './defaulted-input'
import { parseNumber } from './fx-ticket'

describe('groupForDisplay: how a number reads while its field is not being edited', () => {
  it('groups the whole part as en-US does and leaves the decimals as written', () => {
    expect(groupForDisplay('108250.00')).toBe('108,250.00')
    expect(groupForDisplay('108468.39')).toBe('108,468.39')
    expect(groupForDisplay('10000000')).toBe('10,000,000')
    expect(groupForDisplay('1234567.5')).toBe('1,234,567.5')
    expect(groupForDisplay('-12500.25')).toBe('-12,500.25')
    expect(groupForDisplay('108,250.5')).toBe('108,250.5')
  })
  it('does not touch a number below a thousand, or its decimals', () => {
    for (const t of ['10', '999', '1.08345', '55.42', '3.00', '-1.35', '0.5', '71400.'.slice(0, 2)]) expect(groupForDisplay(t)).toBe(t)
    expect(groupForDisplay('1000.123456')).toBe('1,000.123456')
  })
  it('returns what is not a plain number as it is', () => {
    for (const t of ['—', '', '1,08345', '1.2.3', 'abc', '1e5', '.']) expect(groupForDisplay(t)).toBe(t)
  })
  it('never changes the number: what is shown reads back as what was typed', () => {
    for (const t of ['108250.00', '10000000', '1234567.5', '999', '1.08345', '71400', '165000', '-12500.25']) {
      const shown = groupForDisplay(t)
      expect(parseNumber(shown, { signed: true })).toEqual(parseNumber(t, { signed: true }))
    }
  })
})

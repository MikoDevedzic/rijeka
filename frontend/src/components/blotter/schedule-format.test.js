import { describe, it, expect } from 'vitest'
import { atRest, plain } from './schedule-format'

describe('a schedule figure at rest', () => {
  it('groups an amount and keeps its cents', () => {
    expect(atRest('10000000', 'amount')).toBe('10,000,000')
    expect(atRest('2500000.5', 'amount')).toBe('2,500,000.5')
    expect(atRest('10,000,000', 'amount')).toBe('10,000,000')
  })
  it('drops a rate\'s spare zeros and keeps six decimals', () => {
    expect(atRest('3.48000300', 'rate')).toBe('3.480003')
    expect(atRest('3.50000000', 'rate')).toBe('3.5')
    expect(atRest('0', 'rate')).toBe('0')
    expect(atRest('-12.5', 'rate')).toBe('-12.5')
  })
  it('leaves what is not a number as it was typed', () => {
    expect(atRest('', 'amount')).toBe('')
    expect(atRest(null, 'rate')).toBe('')
    expect(atRest('abc', 'amount')).toBe('abc')
  })
})

describe('a figure pasted or imported', () => {
  it('is kept as the plain number the pricer reads', () => {
    expect(plain('10,000,000')).toBe('10000000')          // parseFloat of the pasted text would read 10
    expect(plain(10000000)).toBe('10000000')
    expect(plain('3.50')).toBe('3.5')
    expect(plain('-12.5')).toBe('-12.5')
    expect(plain('')).toBe('')
  })
  it('leaves what is not a number as it came, a comma decimal among them', () => {
    expect(plain('3,5')).toBe('3,5')
    expect(plain('n/a')).toBe('n/a')
  })
})

import { describe, it, expect } from 'vitest'
import { ccySign, inCcy } from './ticket-ccy'

describe('a rates ticket writes its figures in its own currency', () => {
  it('a dollar ticket is as it was', () => {
    expect(inCcy('+$4,669', 'USD')).toBe('+$4,669')
    expect(inCcy('−$1,593,827', undefined)).toBe('−$1,593,827')
  })
  it('EUR, GBP and JPY take their sign, another currency its code', () => {
    expect(inCcy('−$1,311,522', 'EUR')).toBe('−€1,311,522')
    expect(inCcy('+$4,730', 'GBP')).toBe('+£4,730')
    expect(inCcy('$0', 'JPY')).toBe('¥0')
    expect(inCcy('+$12', 'CHF')).toBe('+CHF 12')
    expect(ccySign('AUD')).toBe('AUD ')
  })
  it('every figure in a line, and nothing that is not text', () => {
    expect(inCcy('+$1 · −$2', 'EUR')).toBe('+€1 · −€2')
    expect(inCcy(null, 'EUR')).toBe(null)
    expect(inCcy(12, 'EUR')).toBe(12)
    expect(inCcy('—', 'EUR')).toBe('—')
  })
})

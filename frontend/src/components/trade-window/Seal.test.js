import { describe, it, expect } from 'vitest'
import { prng, sealRings } from './seal-rings'

describe('the seal is the hash, drawn', () => {
  it('the same hash always gives the same rings, and another hash gives others', () => {
    const a = '0x0719a0f9fa69aace0befc02f82bd84c19357dce8a82a9a66031d976b690e9b03'
    const b = '0x9f3a61d2c47be8051a7d3f9e2b6c80d4517ea93c0b2f6d18e4a7c35910dbc41e'
    expect(sealRings(a)).toEqual(sealRings(a))
    expect(sealRings(a)).not.toEqual(sealRings(b))
    for (const [i, q] of sealRings(a).entries()) {
      expect(Number.isInteger(q.k) && Number.isInteger(q.m)).toBe(true)
      expect(q.k).toBeGreaterThanOrEqual([12, 8, 5][i]); expect(q.k).toBeLessThan([22, 16, 11][i])
      expect(q.ph).toBeGreaterThanOrEqual(0); expect(q.ph).toBeLessThan(Math.PI * 2)
    }
  })
  it('the generator is a number in [0, 1) and repeats for a seed', () => {
    const r1 = prng('x'), r2 = prng('x')
    for (let i = 0; i < 50; i++) { const v = r1(); expect(v).toBe(r2()); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1) }
    expect(sealRings(undefined)).toEqual(sealRings(''))
  })
})

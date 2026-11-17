// What this browser remembers a person has done once (the launch home's XVA step): per account, and never an error.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { hasSeen, markSeen } from './seen'

const real = globalThis.localStorage
beforeEach(() => {
  const kept = new Map()
  globalThis.localStorage = { getItem: k => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)) }
})
afterEach(() => { globalThis.localStorage = real })

describe('seen', () => {
  it('is marked for the account that did it and no other', () => {
    expect(hasSeen('xva', 'u1')).toBe(false)
    markSeen('xva', 'u1')
    expect(hasSeen('xva', 'u1')).toBe(true)
    expect(hasSeen('xva', 'u2')).toBe(false)
  })
  it('marks nothing without an account', () => {
    markSeen('xva', undefined)
    expect(hasSeen('xva', undefined)).toBe(false)
    expect(hasSeen('xva', 'u1')).toBe(false)
  })
  it('is unmarked, and throws nothing, where storage is refused', () => {
    globalThis.localStorage = { getItem() { throw new Error('refused') }, setItem() { throw new Error('refused') } }
    expect(() => markSeen('xva', 'u1')).not.toThrow()
    expect(hasSeen('xva', 'u1')).toBe(false)
  })
})

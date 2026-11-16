// The messenger opens by itself once after a sign-in, and not again until the next one.
import { describe, it, expect } from 'vitest'
import { GREET_MIN_WIDTH, greetKey, shouldGreet, metElsewhere } from './greeting'

describe('greetKey', () => {
  it('is the user and the moment of the sign-in', () => {
    expect(greetKey({ user: { id: 'u1', last_sign_in_at: '2026-11-16T14:00:00Z' } })).toBe('u1|2026-11-16T14:00:00Z')
    expect(greetKey({ user: { id: 'u1' } })).toBe('u1|')
    expect(greetKey({ user: { id: 'u1', last_sign_in_at: '2026-11-16T15:00:00Z' } })).not.toBe(greetKey({ user: { id: 'u1', last_sign_in_at: '2026-11-16T14:00:00Z' } }))
    expect(greetKey(null)).toBe(null); expect(greetKey({})).toBe(null); expect(greetKey({ user: {} })).toBe(null)
  })
})

describe('shouldGreet', () => {
  const on = { key: 'u1|t1', seen: null, width: 1440 }
  it('opens once for a sign-in: not again after it was shown, and again for the next sign-in', () => {
    expect(shouldGreet(on)).toBe(true)
    expect(shouldGreet({ ...on, seen: 'u1|t1' })).toBe(false)                 // a reload, another page, or closed by the user
    expect(shouldGreet({ ...on, seen: 'u1|t0' })).toBe(true)                  // signed in again
    expect(shouldGreet({ ...on, seen: 'u2|t1' })).toBe(true)                  // another user in the same tab
  })
  it('not on a phone, not where the messenger is hidden, not while it is in its own window or already open', () => {
    expect(shouldGreet({ ...on, width: GREET_MIN_WIDTH - 1 })).toBe(false)
    expect(shouldGreet({ ...on, width: GREET_MIN_WIDTH })).toBe(true)
    expect(shouldGreet({ ...on, hidden: true })).toBe(false)
    expect(shouldGreet({ ...on, poppedOut: true })).toBe(false)
    expect(shouldGreet({ ...on, open: true })).toBe(false)
  })
  it('never without a sign-in or a width', () => {
    expect(shouldGreet()).toBe(false); expect(shouldGreet({ key: null, width: 1440 })).toBe(false); expect(shouldGreet({ key: 'k' })).toBe(false)
  })
})

describe('metElsewhere', () => {
  it('a messenger in a window of its own has met this sign-in already', () => {
    expect(metElsewhere({ key: 'u|t', seen: null, poppedOut: true })).toBe(true)
    expect(metElsewhere({ key: 'u|t', seen: 'u|t', poppedOut: true })).toBe(false)        // already marked
    expect(metElsewhere({ key: 'u|t', seen: null, poppedOut: false })).toBe(false)
    expect(metElsewhere({ key: null, seen: null, poppedOut: true })).toBe(false); expect(metElsewhere()).toBe(false)
  })
})

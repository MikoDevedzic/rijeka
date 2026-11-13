// lib/phone.js: which devices are told not to enlarge the page on focus, and what their viewport then says.
import { describe, it, expect } from 'vitest'
import { isIos, viewportOnIos, STACK_FROM } from './phone'

describe('an iPhone does not enlarge the page when a field is tapped', () => {
  it('knows an iPhone, an iPad, and an iPad that says it is a Mac', () => {
    expect(isIos('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe(true)
    expect(isIos('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe(true)
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 'MacIntel', 5)).toBe(true)
  })
  it('leaves a Mac, an Android phone and a desktop alone: there the same words would take pinch-zoom away', () => {
    expect(isIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 'MacIntel', 0)).toBe(false)
    expect(isIos('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130.0 Mobile Safari/537.36', 'Linux armv81', 5)).toBe(false)
    expect(isIos('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0', 'Win32', 0)).toBe(false)
    expect(isIos()).toBe(false)
  })
  it('adds the limit once and keeps what the page already said', () => {
    const page = 'width=device-width, initial-scale=1.0, viewport-fit=cover'
    expect(viewportOnIos(page)).toBe(`${page}, maximum-scale=1`)
    expect(viewportOnIos(viewportOnIos(page))).toBe(`${page}, maximum-scale=1`)
    expect(viewportOnIos('')).toBe('maximum-scale=1')
  })
  it('a table of four columns stays a table', () => { expect(STACK_FROM).toBe(5) })
})

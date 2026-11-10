import { describe, it, expect } from 'vitest'
import { bubblePlace } from './notes'

describe('where a note\'s bubble goes', () => {
  const view = { width: 1440, height: 900 }
  it('under the mark, from its left edge', () => {
    expect(bubblePlace({ left: 200, top: 100, bottom: 113 }, { height: 60 }, view)).toEqual({ left: 200, top: 119 })
  })
  it('kept inside the right edge of the browser', () => {
    expect(bubblePlace({ left: 1400, top: 100, bottom: 113 }, { height: 60 }, view).left).toBe(1440 - 320 - 8)
  })
  it('above the mark when there is no room below, and below again when there is none above either', () => {
    expect(bubblePlace({ left: 200, top: 860, bottom: 873 }, { height: 60 }, view).top).toBe(860 - 6 - 60)
    expect(bubblePlace({ left: 200, top: 20, bottom: 33 }, { height: 880 }, view).top).toBe(39)
  })
})

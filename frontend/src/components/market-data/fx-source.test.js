import { describe, it, expect } from 'vitest'
import { sourceKind, sourceShort } from './fx-source'

describe('how a curve source is shown in a cell and in a list row', () => {
  it('is one word in a table cell', () => {
    expect(sourceKind('DEMO · Deribit forwards · 2026-11-09 15:25 UTC · listed to 24SEP27, flat beyond')).toBe('FEED')
    expect(sourceKind('DEMO · handed back to the feed')).toBe('FEED')
    expect(sourceKind('MANUAL')).toBe('MANUAL')
    expect(sourceKind('bloomberg')).toBe('BLOOMBERG')
    expect(sourceKind(null)).toBe('MANUAL')
  })
  it('is a few words in a list row, never the whole sentence', () => {
    expect(sourceShort({ source: 'DEMO · Deribit forwards · 2026-11-09 15:25 UTC · listed to 24SEP27, flat beyond', label: 'Deribit 9 Nov 15:25 UTC' })).toBe('Deribit 9 Nov 15:25 UTC')
    expect(sourceShort({ source: 'DEMO · handed back to the feed', label: 'DEMO · handed back to the feed points 2026-11-09' })).toBe('feed (pending)')
    expect(sourceShort({ source: 'DEMO · synthetic surface', label: 'DEMO · synthetic surface surface 2026-11-09' })).toBe('feed')
    expect(sourceShort({ source: 'MANUAL', label: 'MANUAL points 2026-10-29' })).toBe('MANUAL')
    expect(sourceShort({})).toBe('')
    for (const c of [{ source: 'DEMO · Deribit forwards · x', label: 'Deribit 9 Nov 15:25 UTC' }, { source: 'DEMO · handed back to the feed' }, { source: 'MANUAL' }]) expect(sourceShort(c).length).toBeLessThanOrEqual(28)
  })
})

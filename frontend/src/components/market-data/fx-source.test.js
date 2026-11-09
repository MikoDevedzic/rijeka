import { describe, it, expect } from 'vitest'
import { sourceKind, sourceShort, sourceWord, isVenue } from './fx-source'

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
    expect(sourceShort({ source: 'DEMO · synthetic surface, level scaled by trailing realised vol', label: 'DEMO · synthetic surface … surface 2026-11-09' })).toBe('synthetic')
    expect(sourceShort({ source: 'DEMO · history backfill (public sources)' })).toBe('backfill')
    expect(sourceShort({ source: 'DEMO · NY Fed SOFR + UST par' })).toBe('feed')
    expect(sourceShort({ source: 'MANUAL', label: 'MANUAL points 2026-10-29' })).toBe('MANUAL')
    expect(sourceShort({})).toBe('')
  })
  it('is one word in the narrow pair list, and knows which rows carry their own time', () => {
    const venue = { source: 'DEMO · Deribit forwards · 2026-11-09 15:25 UTC · listed to 24SEP27, flat beyond', label: 'Deribit 9 Nov 15:25 UTC' }
    expect(sourceWord(venue)).toBe('Deribit')
    expect(isVenue(venue)).toBe(true)
    expect(sourceWord({ source: 'DEMO · handed back to the feed' })).toBe('feed (pending)')
    expect(sourceWord({ source: 'MANUAL', label: 'MANUAL points 2026-10-29' })).toBe('MANUAL')
    expect(isVenue({ source: 'MANUAL', label: 'MANUAL' })).toBe(false)
    expect(isVenue({ source: 'DEMO · handed back to the feed' })).toBe(false)
    for (const c of [{ source: 'DEMO · Deribit forwards · x', label: 'Deribit 9 Nov 15:25 UTC' }, { source: 'DEMO · handed back to the feed' }, { source: 'MANUAL' }]) expect(sourceShort(c).length).toBeLessThanOrEqual(28)
  })
})

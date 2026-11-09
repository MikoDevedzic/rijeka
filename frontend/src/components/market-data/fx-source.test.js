import { describe, it, expect } from 'vitest'
import { sourceKind, sourceShort, sourceWord, isVenue, pricedFromWords, baseRateWords } from './fx-source'

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

describe('pricedFromWords: the pill beside the curve pill never contradicts it', () => {
  const curve = { source: 'MANUAL', label: 'MANUAL points 2026-10-29' }
  it('reads the mode and the stored points together', () => {
    expect(pricedFromWords('MARKET', curve)).toBe('priced off the quoted points')
    expect(pricedFromWords('MARKET', null)).toBe('no points stored: priced from yields')
    expect(pricedFromWords('IMPLIED', curve)).toBe('priced from yields; the points are stored, not used')
    expect(pricedFromWords('IMPLIED', null)).toBe('priced from yields')
  })
  it('says what parity is for a digital asset', () => {
    expect(pricedFromWords('MARKET', null, true)).toBe('no points stored: priced from the carry rate')
    expect(pricedFromWords('IMPLIED', curve, true)).toBe('priced from the carry rate; the points are stored, not used')
    expect(pricedFromWords('MARKET', curve, true)).toBe('priced off the quoted points')
  })
  it('never says quoted points without a curve', () => {
    for (const mode of ['MARKET', 'IMPLIED', undefined]) for (const crypto of [true, false]) expect(pricedFromWords(mode, null, crypto)).not.toMatch(/quoted/)
  })
})

describe('baseRateWords: the digital asset\'s rate, named as the ticket names it', () => {
  const btc = { base: 'BTC', funding_pct: 3, forward_curve: { source: 'DEMO · Deribit forwards', in_use: true } }
  it('is the rate the points imply where the feed\'s points are in use', () => {
    expect(baseRateWords(btc, 'MARKET')).toBe('BTC rate implied by the points')
    expect(baseRateWords(btc, undefined)).toBe('BTC rate implied by the points')
  })
  it('is the saved rate otherwise: no points, points not in use, or the account on parity', () => {
    expect(baseRateWords({ base: 'BTC', funding_pct: 3 }, 'MARKET')).toBe('saved BTC rate 3 %')
    expect(baseRateWords({ ...btc, forward_curve: { ...btc.forward_curve, in_use: false } }, 'MARKET')).toBe('saved BTC rate 3 %')
    expect(baseRateWords(btc, 'IMPLIED')).toBe('saved BTC rate 3 %')
    expect(baseRateWords({ base: 'ETH', funding_pct: null }, 'MARKET')).toBe('saved ETH rate 0 %')
    expect(baseRateWords({ base: 'SOL', funding_pct: 4.25 }, 'IMPLIED')).toBe('saved SOL rate 4.25 %')
  })
  it('never says funding', () => {
    for (const p of [btc, { base: 'BTC' }]) for (const m of ['MARKET', 'IMPLIED']) expect(baseRateWords(p, m)).not.toMatch(/funding/i)
  })
})

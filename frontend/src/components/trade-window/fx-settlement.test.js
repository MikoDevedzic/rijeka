import { describe, it, expect } from 'vitest'
import { settlementOptions, settlementTerms, settlementLabel, settlementNote } from './fx-settlement'

// synthetic pair rows in the shape of GET /api/currency/pairs
const SOURCES = [
  { source: 'CME CF BRR', time: '16:00 London', auto: false },
  { source: 'Deribit BTC delivery price', time: '08:00 UTC', auto: true },
]
// where the feed runs the default is the venue's delivery price; elsewhere it is the licensed benchmark
const FEED = { pair: 'BTCUSD', fixing_default: 'Deribit BTC delivery price', fixing_default_time: '08:00 UTC', fixing_sources: SOURCES }
const BENCH = { pair: 'BTCUSD', fixing_default: 'CME CF BRR', fixing_default_time: '16:00 London', fixing_sources: SOURCES }
const OLD = { pair: 'BTCUSD', fixing_default: 'CME CF BRR' }      // an API answer from before the choice existed
const PRODUCTS = ['FORWARD', 'OPTION']

describe('the settlement source a digital-asset ticket books', () => {
  it('an untouched ticket on a feed instance books the delivery price at 08:00 UTC on both products', () => {
    for (const product of PRODUCTS)
      expect(settlementTerms(FEED, '', product)).toEqual({ source: 'Deribit BTC delivery price', time: '08:00 UTC', auto: true, isDefault: true })
  })
  it('an untouched ticket where the benchmark is the default books it at 16:00 London on both products', () => {
    for (const product of PRODUCTS)
      expect(settlementTerms(BENCH, '', product)).toEqual({ source: 'CME CF BRR', time: '16:00 London', auto: false, isDefault: true })
  })
  it('an explicit pick overrides the default and carries its own time on both products', () => {
    for (const product of PRODUCTS) {
      expect(settlementTerms(FEED, 'CME CF BRR', product)).toEqual({ source: 'CME CF BRR', time: '16:00 London', auto: false, isDefault: false })
      expect(settlementTerms(BENCH, 'Deribit BTC delivery price', product)).toEqual({ source: 'Deribit BTC delivery price', time: '08:00 UTC', auto: true, isDefault: false })
    }
  })
  it('picking the default again is the untouched ticket', () => {
    for (const product of PRODUCTS) {
      expect(settlementTerms(FEED, 'Deribit BTC delivery price', product)).toEqual(settlementTerms(FEED, '', product))
      expect(settlementTerms(BENCH, 'CME CF BRR', product)).toEqual(settlementTerms(BENCH, '', product))
    }
  })
  it('an older API answer gives no choice and the terms the ticket wrote before: the product\'s hard-coded time', () => {
    expect(settlementOptions(OLD)).toEqual([])
    expect(settlementTerms(OLD, '', 'FORWARD')).toEqual({ source: 'CME CF BRR', time: '16:00 London', auto: false, isDefault: true })
    expect(settlementTerms(OLD, '', 'OPTION')).toEqual({ source: 'CME CF BRR', time: '08:00 UTC', auto: false, isDefault: true })
    expect(settlementTerms(OLD, 'Deribit BTC delivery price', 'OPTION')).toEqual({ source: 'CME CF BRR', time: '08:00 UTC', auto: false, isDefault: true })
    expect(settlementTerms({ ...OLD, fixing_sources: [] }, '', 'OPTION')).toMatchObject({ source: 'CME CF BRR', time: '08:00 UTC' })
    expect(settlementOptions(undefined)).toEqual([])
    expect(settlementTerms(undefined, '', 'FORWARD')).toEqual({ source: undefined, time: '16:00 London', auto: false, isDefault: true })
  })
  it('a source of another pair left in the select falls back to the default', () => {
    expect(settlementTerms(FEED, 'Deribit ETH delivery price', 'FORWARD')).toEqual(settlementTerms(FEED, '', 'FORWARD'))
  })
  it('lists the default even if the API left it out of the sources, with the API\'s default time, and drops unusable rows', () => {
    const odd = { fixing_default: 'CME CF BRR', fixing_default_time: '16:00 London', fixing_sources: [null, { source: '' }, SOURCES[1]] }
    expect(settlementOptions(odd).map(s => s.source)).toEqual(['CME CF BRR', 'Deribit BTC delivery price'])
    for (const product of PRODUCTS)
      expect(settlementTerms(odd, '', product)).toEqual({ source: 'CME CF BRR', time: '16:00 London', auto: false, isDefault: true })
  })
  it('a source listed without a time: the default takes the API\'s default time, another falls back to the old constant', () => {
    const noTime = { fixing_default: 'A', fixing_default_time: '08:00 UTC', fixing_sources: [{ source: 'A', auto: true }, { source: 'B' }] }
    expect(settlementTerms(noTime, '', 'FORWARD')).toEqual({ source: 'A', time: '08:00 UTC', auto: true, isDefault: true })
    expect(settlementTerms(noTime, 'B', 'OPTION')).toEqual({ source: 'B', time: '08:00 UTC', auto: false, isDefault: false })
    expect(settlementTerms(noTime, 'B', 'FORWARD')).toEqual({ source: 'B', time: '16:00 London', auto: false, isDefault: false })
  })
  it('labels an option with the source and its time, and says who supplies the fixing', () => {
    expect(settlementLabel(SOURCES[0])).toBe('CME CF BRR · 16:00 London')
    expect(settlementLabel({ source: 'CME CF BRR', time: null })).toBe('CME CF BRR')
    expect(settlementNote(SOURCES[1])).toBe('fixed automatically each day at 08:00 UTC')
    expect(settlementNote(SOURCES[0])).toBe('your desk enters this fixing')
    expect(settlementNote(null)).toBe('')
  })
})

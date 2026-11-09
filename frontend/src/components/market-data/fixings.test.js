import { describe, it, expect } from 'vitest'
import { originWord, originPill, sortFixings, deskSources, feedSources, parseValue, checkFixing, saveErrorText } from './fixings'

// synthetic rows in the shape of GET /api/currency/fixings/{pair}; the values are made up
const SOURCES = [
  { source: 'CME CF BRR', time: '16:00 London', auto: false },
  { source: 'Deribit BTC delivery price', time: '08:00 UTC', auto: true },
]
const ROWS = [
  { date: '2026-01-05', source: 'Deribit BTC delivery price', time: '08:00 UTC', value: 100.5, origin: 'FEED', own: false },
  { date: '2026-01-06', source: 'Deribit BTC delivery price', time: '08:00 UTC', value: 101.25, origin: 'FEED', own: false },
  { date: '2026-01-06', source: 'CME CF BRR', time: '16:00 London', value: 101.75, origin: 'MANUAL', own: true },
  { date: '2026-01-07', source: 'stored spot (no fixing stored)', time: null, value: 102, origin: 'SPOT', own: true },
]

describe('the fixings table', () => {
  it('reads newest first, the sources of one date in name order', () => {
    expect(sortFixings(ROWS).map(r => `${r.date} ${r.source}`)).toEqual([
      '2026-01-07 stored spot (no fixing stored)',
      '2026-01-06 CME CF BRR',
      '2026-01-06 Deribit BTC delivery price',
      '2026-01-05 Deribit BTC delivery price',
    ])
  })
  it('does not reorder the answer it was given, and survives a missing or odd one', () => {
    const before = ROWS.map(r => r.date)
    sortFixings(ROWS)
    expect(ROWS.map(r => r.date)).toEqual(before)
    expect(sortFixings(undefined)).toEqual([])
    expect(sortFixings([null, { source: 'no date' }, ROWS[0]])).toEqual([ROWS[0]])
  })
  it('says where a fixing came from in one word', () => {
    expect(ROWS.map(originWord)).toEqual(['FEED', 'FEED', 'MANUAL', 'SPOT'])
    expect(originWord({ origin: 'feed' })).toBe('FEED')
    expect(originWord({ source: 'stored spot (no fixing stored)' })).toBe('SPOT')
    expect(originWord({ origin: 'something new', source: 'CME CF BRR' })).toBe('MANUAL')
    expect(originWord(null)).toBe('MANUAL')
    expect(['FEED', 'MANUAL', 'SPOT', 'OTHER'].map(originPill)).toEqual(['p-green', 'p-dim', 'p-amber', 'p-dim'])
  })
  it('splits a pair\'s sources into the desk\'s and the feed\'s', () => {
    expect(deskSources(SOURCES).map(s => s.source)).toEqual(['CME CF BRR'])
    expect(feedSources(SOURCES).map(s => s.source)).toEqual(['Deribit BTC delivery price'])
    expect(deskSources(undefined)).toEqual([])
    expect(deskSources([null, { source: '' }, { source: 'Deribit BTC delivery price', auto: true }])).toEqual([])
  })
})

describe('the entry form of a desk\'s own fixing', () => {
  const ok = { pair: 'BTCUSD', source: 'CME CF BRR', date: '2026-01-06', value: '74,012.5' }
  it('reads a value as typed', () => {
    expect(parseValue('74,012.5')).toBe(74012.5)
    expect(parseValue(' 101 ')).toBe(101)
    expect(parseValue('.5')).toBe(0.5)
    expect(parseValue(101.25)).toBe(101.25)
    for (const bad of ['', '0', '-5', 'abc', '1e5', 'Infinity', 'NaN', '1.2.3', null, undefined]) expect(parseValue(bad), String(bad)).toBeNull()
  })
  it('builds the body of the POST', () => {
    expect(checkFixing(ok, '2026-01-06')).toEqual({ ok: true, body: { pair: 'BTCUSD', fixing_date: '2026-01-06', source: 'CME CF BRR', value: 74012.5 } })
  })
  it('refuses a future date, a bad date, a bad value and a missing or overlong source', () => {
    expect(checkFixing(ok, '2026-01-05')).toEqual({ ok: false, error: 'A fixing cannot be dated in the future' })
    expect(checkFixing({ ...ok, date: '' }, '2026-01-06').ok).toBe(false)
    expect(checkFixing({ ...ok, date: '2026-13-45' }, '2027-01-01').ok).toBe(false)
    expect(checkFixing({ ...ok, value: '0' }, '2026-01-06')).toEqual({ ok: false, error: 'Enter the fixing as a positive number' })
    expect(checkFixing({ ...ok, value: '' }, '2026-01-06').ok).toBe(false)
    expect(checkFixing({ ...ok, source: ' ' }, '2026-01-06').ok).toBe(false)
    expect(checkFixing({ ...ok, source: 'x'.repeat(81) }, '2026-01-06').ok).toBe(false)
    expect(checkFixing({ ...ok, source: 'x'.repeat(80) }, '2026-01-06').ok).toBe(true)
  })
  it('says plainly that a 409 is the instance, and passes the API\'s text on otherwise', () => {
    expect(saveErrorText({ status: 409, message: 'fixings table missing' })).toMatch(/cannot store fixings yet/)
    expect(saveErrorText({ status: 422, message: 'fixing_date is in the future' })).toBe('fixing_date is in the future')
    expect(saveErrorText(undefined)).toBe('The fixing was not saved')
  })
})

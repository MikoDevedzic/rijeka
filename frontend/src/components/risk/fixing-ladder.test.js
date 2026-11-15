// The Fixings panel: the report's rows by date and by index, what resets next, and what is left out.
import { describe, expect, it } from 'vitest'
import { byDate, series, nextOf, notCovered, any, mn, units, indexName } from './fixing-ladder'

const FX = {
  resets: [
    { date: '2026-11-17', index: 'USD_SOFR', days: 1, receive_usd: 150e6, pay_usd: -25e6, net_usd: 125e6, fixing01_usd: 343.75, trades: 3 },
    { date: '2026-11-16', index: 'USD_SOFR', days: 1, receive_usd: 100e6, pay_usd: 0, net_usd: 100e6, fixing01_usd: 275, trades: 2 },
    { date: '2026-11-16', index: 'EUR_ESTR', days: 1, receive_usd: 0, pay_usd: -40e6, net_usd: -40e6, fixing01_usd: -110, trades: 1 },
    { date: '2026-11-20', index: 'USD_SOFR', days: 3, receive_usd: 100e6, pay_usd: 0, net_usd: 100e6, fixing01_usd: 825, trades: 2 },
  ],
  settlements: [{ date: '2026-12-11', pair: 'BTCUSD', source: 'CME CF BRR', unit: 'BTC', net_units: 250, spot01_usd: 22900, trades: 1 }],
  not_covered: { IR_CAP: 2, IR_SWAPTION: 1, FX_OPTION: 0 },
}

describe('the fixings panel', () => {
  it('lists the dates in order, each with its indices, and the first few when asked', () => {
    const d = byDate(FX)
    expect(d.map(x => [x.date, x.rows.map(r => r.index)])).toEqual([['2026-11-16', ['EUR_ESTR', 'USD_SOFR']], ['2026-11-17', ['USD_SOFR']], ['2026-11-20', ['USD_SOFR']]])
    expect(byDate(FX, 2)).toHaveLength(2); expect(byDate(null)).toEqual([])
  })
  it('makes one series an index, with its largest day and what a basis point on every listed fixing adds up to', () => {
    const s = series(FX)
    expect(s.map(x => [x.index, x.points.length, x.top, x.f01])).toEqual([['EUR_ESTR', 1, 40e6, -110], ['USD_SOFR', 3, 125e6, 1443.75]])
    expect(s[1].points.map(p => p.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-20'])
  })
  it('says what resets next on each index', () => {
    expect(nextOf(FX)).toEqual([{ index: 'EUR_ESTR', date: '2026-11-16', net: -40e6, f01: -110, days: 1 }, { index: 'USD_SOFR', date: '2026-11-16', net: 100e6, f01: 275, days: 1 }])
  })
  it('names what is left out, and knows an empty report', () => {
    expect(notCovered(FX)).toBe('2 caps, 1 swaption'); expect(notCovered({})).toBe('')
    expect(any(FX)).toBe(true); expect(any({ resets: [], settlements: [] })).toBe(false); expect(any(undefined)).toBe(false)
  })
  it('writes a notional in millions with its sign, a small one in full, and a fixing in its own unit', () => {
    expect([125e6, -40e6, 12000, -300, 0, null].map(mn)).toEqual(['+125.0m', '−40.0m', '+12,000', '−300', '0', '—'])
    expect(units(250, 'BTC')).toBe('+250 BTC'); expect(units(-5e6, 'EUR')).toBe('−5,000,000 EUR'); expect(indexName('USD_SOFR')).toBe('USD SOFR')
  })
})

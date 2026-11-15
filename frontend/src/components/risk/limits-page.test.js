// The Limits page: a row for every curve, the other limits, and a size as typed.
import { describe, expect, it } from 'vitest'
import { factorOf, curveRows, otherLimits, standardRows, parseSize } from './limits-page'

const REP = {
  limits: [
    { id: 'standard:IR01:USD_SOFR', metric: 'IR01:USD_SOFR', scope: 'ALL', limit: 50000, warn_pct: 80, value: 17360, utilisation_pct: 34.72, status: 'OK', standard: true, kind: 'IR01' },
    { id: 'a', metric: 'SPOT01:BTC', scope: 'ALL', limit: 40000, warn_pct: 90, value: 32988, utilisation_pct: 82.47, status: 'OK', set_by: 'MIKO' },
    { id: 'standard:VEGA:USD_SWVOL_ATM', metric: 'VEGA:USD_SWVOL_ATM', scope: 'ALL', limit: 25000, warn_pct: 80, value: 6100, utilisation_pct: 24.4, status: 'OK', standard: true },
    { id: 'standard:CRYBASIS01:BTC_FUNDING', metric: 'CRYBASIS01:BTC_FUNDING', scope: 'ALL', limit: 10000, warn_pct: 80, value: 1460, utilisation_pct: 14.6, status: 'OK', standard: true },
    { id: 'v', metric: 'VAR_99_1D', scope: 'ALL', limit: 400000, warn_pct: 80, value: 321000, utilisation_pct: 80.25, status: 'WARN' },
    { id: 'k', metric: 'KR01:USD_SOFR:1-5Y', scope: 'ALL', limit: 15000, warn_pct: 80, value: 12470, utilisation_pct: 83.1, status: 'WARN' },
    { id: 'd', metric: 'IR01:USD_SOFR', scope: 'DESK', scope_name: 'RATES', limit: 1, warn_pct: 80, value: null, utilisation_pct: null, status: 'NA' },
    { id: 'e', metric: 'VEGA:EURUSD_VOL:0-1Y', scope: 'ALL', limit: 1, warn_pct: 80, value: 0, utilisation_pct: 0, status: 'OK' },
  ],
  standards: { IR01: { kind: 'IR01', limit: 50000, built_in: true }, CRY01: { kind: 'CRY01', limit: 60000, built_in: false, id: 's' } },
}

describe('the Limits page', () => {
  it('names the factor a limit is on, where it is on a total', () => {
    expect(factorOf('IR01:USD_SOFR')).toEqual({ name: 'USD SOFR', measure: 'IR01', unit: 'per bp' })
    expect(factorOf('spot01:btc')).toMatchObject({ name: 'BTC', measure: 'SPOT 01' })
    expect(factorOf('VEGA:USD_SWVOL_ATM')).toMatchObject({ name: 'USD swaptions', unit: 'per bp of vol' })
    expect(factorOf('VEGA:EURUSD_VOL')).toMatchObject({ name: 'EURUSD', unit: 'per vol point' })
    expect(factorOf('CRYBASIS01:BTC_FUNDING')).toMatchObject({ name: 'BTC', measure: 'CRYBASIS01' })
    for (const m of ['IR01', 'VAR_99_1D', 'KR01:USD_SOFR:1-5Y', 'VEGA:EURUSD_VOL:0-1Y', 'STRESS:X', '']) expect(factorOf(m), m).toBe(null)
  })
  it('has one row for each curve the book carries, with its own limit or the standard one', () => {
    const rows = curveRows(REP)
    expect(rows.map(r => [r.metric, r.standard, r.limit])).toEqual([['CRYBASIS01:BTC_FUNDING', true, 10000], ['IR01:USD_SOFR', true, 50000], ['SPOT01:BTC', false, 40000], ['VEGA:USD_SWVOL_ATM', true, 25000]])
    expect(rows[2]).toMatchObject({ name: 'BTC', used: 82.47, set_by: 'MIKO', warn_pct: 90 })
    expect(curveRows(null)).toEqual([])
  })
  it('lists the rest apart: VaR, a bucket, a desk\'s; never a standard one', () => {
    expect(otherLimits(REP).map(l => l.id)).toEqual(['v', 'k', 'd', 'e'])
  })
  it('shows the standard size of each kind the report gives, in a fixed order', () => {
    expect(standardRows(REP).map(s => s.kind)).toEqual(['IR01', 'CRY01']); expect(standardRows({})).toEqual([])
  })
  it('reads a size as typed, and nothing that is not a positive number', () => {
    expect(['25,000', '25 000', '2.5e4', ' 25000 '].map(parseSize)).toEqual([25000, 25000, 25000, 25000])
    expect(['', '0', '-5', 'abc', null, undefined].map(parseSize)).toEqual([null, null, null, null, null, null])
  })
})

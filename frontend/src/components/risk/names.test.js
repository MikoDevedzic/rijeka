import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { basis, limitName, spotMeasure } from './names'

describe('one sensitivity, one name and one sign', () => {
  it('reads the basis as CRYBASIS01, and an older report by the negative of its FUND01', () => {
    expect(basis({ crybasis01_total: 316, fund01_total: -316 })).toBe(316)
    expect(basis({ fund01_total: -316 })).toBe(316)
    expect(basis({ fund01_usd: 22 }, '_usd')).toBe(-22)
    expect(basis({ crybasis01_usd: 0, fund01_usd: 5 }, '_usd')).toBe(0)
    expect(basis({})).toBe(0)
    expect(basis(null)).toBe(0)
  })
  it('names a spot delta by what the asset is', () => {
    expect(spotMeasure('EUR')[1]).toBe('FX01')
    expect(spotMeasure('btc')[1]).toBe('CRY01')
  })
  it('names a limit as the home does, not by its stored key', () => {
    expect(limitName('SPOT01:BTC')).toBe('BTC CRY01')
    expect(limitName('SPOT01:EUR')).toBe('EUR FX01')
    expect(limitName('CRYBASIS01:BTC_FUNDING')).toBe('BTC CRYBASIS01')
    expect(limitName('IR01:USD_SOFR')).toBe('IR01 USD SOFR')
    expect(limitName('STRESS:PARALLEL_UP_100', [{ id: 'PARALLEL_UP_100', name: 'Rates +100bp' }])).toBe('STRESS RATES +100BP')
  })
  // The old names are written on no Risk screen: a label there is one of the desk's, or the test says which file.
  it('no Risk screen prints SPOT01, SPOT 01 or FUND01', () => {
    const dir = new URL('.', import.meta.url)
    const screens = readdirSync(dir).filter(f => /\.jsx$/.test(f) || f === 'limits-page.js')
    const printed = (src) => src.replace(/\/\/[^\n]*|\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\//g, '')   // comments say what the names were
      .replace(/startsWith\('SPOT01:'\)|\['SPOT01:<asset>'\]|=== 'SPOT01'/g, '')                     // the stored key, read not shown
    const found = screens.filter(f => /SPOT ?01|FUND01/.test(printed(readFileSync(new URL(f, dir), 'utf8'))))
    expect(found).toEqual([])
  })
})

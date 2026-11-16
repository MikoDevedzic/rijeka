import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { basis, limitName, spotMeasure, vegaByQuote } from './names'

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
    expect(limitName('spot01:btc')).toBe('BTC CRY01')
    // a key the home has no name for is still written in words: no colon, no underscore
    for (const [key, name] of [['STANDARD:IR01', 'STANDARD IR01'], ['EPE:ACME_BANK', 'EPE ACME BANK'], ['PFE:ACME:1-5Y', 'PFE ACME 1-5Y'], ['PFE_PEAK:ACME', 'PFE ACME'], ['KR01:USD_SOFR:1-5Y', 'USD SOFR 1-5Y'], ['VAR_99_1D', 'VAR'], ['NPV', 'NPV']]) expect(limitName(key), key).toBe(name)
    expect(limitName('STRESS:X', null)).toBe('STRESS X')
  })
  // The old names are written on no Risk or P&L screen, in capitals or not: a label there is one of the desk's, or
  // the test says which file. (A field of an answer, `r.spot01`, is read and not shown.)
  it('no Risk or P&L screen prints SPOT01, SPOT 01, spot01 or FUND01', () => {
    const here = new URL('.', import.meta.url), pnl = new URL('../pnl/', import.meta.url)
    const files = (dir) => readdirSync(dir).filter(f => /\.jsx$/.test(f) || ['limits-page.js', 'ipv-page.js'].includes(f)).map(f => new URL(f, dir))
    const printed = (src) => src.replace(/(?<!:)\/\/[^\n]*|\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\//g, '')   // comments say what the names were
      .replace(/startsWith\('SPOT01:'\)|\['SPOT01:<asset>'\]|=== 'SPOT01'/g, '')                     // the stored key, read not shown
    const old = (t) => /SPOT ?01|FUND01/.test(t) || /(?<![.\w])spot ?01\b/i.test(t)                  // not `r.spot01`, a field read
    const found = [...files(here), ...files(pnl)].filter(f => old(printed(readFileSync(f, 'utf8')))).map(f => f.pathname.split('/').slice(-2).join('/'))
    expect(found).toEqual([])
  })
})

describe('vega is summed only with vega quoted the same way', () => {
  it('keeps a vol point and a basis point of normal vol apart', () => {
    const rows = [{ curve: 'BTCUSD_VOL', total: 15000 }, { curve: 'EURUSD_VOL', total: -3000.5 }, { curve: 'USD_SWVOL_ATM', total: 15024.5 }]
    expect(vegaByQuote(rows)).toEqual({ point: 11999.5, normalBp: 15024.5, curves: ['BTCUSD', 'EURUSD', 'USD'] })
  })
  it('says a family the book does not hold is not there, not zero', () => {
    expect(vegaByQuote([{ curve: 'EURUSD_VOL', total: 10 }])).toMatchObject({ point: 10, normalBp: null })
    expect(vegaByQuote([{ curve: 'USD_SWVOL_ATM', total: 7 }])).toMatchObject({ point: null, normalBp: 7 })
    expect(vegaByQuote(undefined)).toEqual({ point: null, normalBp: null, curves: [] })
  })
})


import { describe, it, expect } from 'vitest'
import { passesFilters } from './blotter-filter'

const t = { trade_ref: 'TRD-1', uti: 'UTI9', status: 'PENDING', asset_class: 'CRYPTO', store: 'WORKING', counterparty: { name: 'RIJEKA DEMO BANK AG' }, instrument_type: 'CRYPTO_NDF', structure: 'DOUBLE_BARRIER', desk: 'Macro' }

describe('the blotter\'s filters', () => {
  it('ALL, and the empty value the rail\'s ALL button writes, both let every trade through', () => {
    expect(passesFilters(t, { status: 'ALL', assetClass: 'ALL', store: 'ALL', search: '' })).toBe(true)
    expect(passesFilters(t, { status: '', assetClass: '', store: '', search: '' })).toBe(true)      // was: no trade at all
    expect(passesFilters(t, {})).toBe(true)
  })
  it('a chosen status, class or store keeps its own trades only', () => {
    expect(passesFilters(t, { status: 'PENDING' })).toBe(true); expect(passesFilters(t, { status: 'LIVE' })).toBe(false)
    expect(passesFilters(t, { assetClass: 'CRYPTO' })).toBe(true); expect(passesFilters(t, { assetClass: 'FX' })).toBe(false)
    expect(passesFilters(t, { store: 'WORKING' })).toBe(true); expect(passesFilters(t, { store: 'PRODUCTION' })).toBe(false)
  })
  it('the search reads the references, the counterparty, the desk, the instrument and the structure, in any case', () => {
    for (const q of ['trd-1', 'uti9', 'demo bank', 'macro', 'crypto_ndf', 'double barrier']) expect(passesFilters(t, { search: q }), q).toBe(true)
    expect(passesFilters(t, { search: 'their-7' }, 'THEIR-7')).toBe(true)
    expect(passesFilters(t, { search: 'nothing like it' })).toBe(false)
  })
})

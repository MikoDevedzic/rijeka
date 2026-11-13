// The paper is the signed record and nothing else: values as the record holds them, empty fields left off.
import { describe, it, expect } from 'vitest'
import { grouped, longDate, longStamp, paperOf, pct } from './paper-confirmation'

const A = 'DEMO0000000A00004000', B = 'DEMO0000RIJEKABANK01'
const att = (over = {}) => ({ trade_hash: '0xabc', schema_version: 2, bilateral: false, eip712: { name: 'Rijeka Trade Confirmation', version: '1' },
  anchor: { anchored: false, note: 'No chain configured' },
  parties: { own: { lei: A, address: '0xD7', signature: '0x74', key_source: 'dev' }, counterparty: { lei: B, address: '0x88', signature: '0xe7', key_source: 'dev' } }, ...over })
const ndf = { format: 'rijeka-confirmation-proof', trade_ref: 'TRD-1', trade_hash: '0xabc', generated_at: '2026-11-13T16:26:23.5+00:00', attestation: att(),
  canonical: { schema_version: 2, uti: A + 'X', parties: [A, B], trade: { instrument_type: 'CRYPTO_FORWARD', structure: 'VANILLA', notional: '10', notional_ccy: 'BTC', trade_date: '2026-11-13', effective_date: '2026-11-13', maturity_date: '2027-03-02' },
    product: { product: 'NDF', buyer: A, seller: B, digital_asset: 'BTC', notional_amount: '10', valuation_date: '2027-03-02', settlement_currency: 'USD', calculation_agent: null, forward_price: '108500.36122036983', price_currency: 'USD' } } }
const leg = (type, payer, receiver, more) => ({ leg_type: type, currency: 'USD', notional: '10000000', day_count: 'ACT/360', payment_frequency: 'ANNUAL', bdc: 'MOD_FOLLOWING', payment_lag: '2',
  fixed_rate: '0', spread: '0', index: null, reset_frequency: null, embedded_options: [], custom_cashflows: [], notional_schedule: null, payer, receiver, ...more })
const swap = { trade_ref: 'TRD-2', trade_hash: '0xdef', attestation: att({ bilateral: true, anchor: { anchored: true, chain_id: 11155111, registry: '0x92', block_number: 12127133, tx_hash: '0xbb', explorer_tx: 'https://x/tx', confirmed_at: 1794587040 } }),
  canonical: { schema_version: 2, uti: A + 'Y', parties: [A, B], trade: { instrument_type: 'IR_SWAP', structure: 'VANILLA', notional: '10000000', notional_ccy: 'USD', trade_date: '2026-11-02', effective_date: '2026-11-04', maturity_date: '2031-11-04' },
    legs: [leg('FLOAT', B, A, { index: 'USD_SOFR', reset_frequency: 'DAILY' }), leg('FIXED', A, B, { fixed_rate: '0.0375', spread: null })] } }

describe('a signed record as a sheet of paper', () => {
  it('writes a date out and groups a number without rounding it', () => {
    expect(longDate('2027-03-02')).toBe('2 March 2027')
    expect(longDate('soon')).toBe('soon')
    expect(grouped('108500.36122036983')).toBe('108,500.36122036983')
    expect(grouped('10')).toBe('10')
    expect(grouped('-1500.5')).toBe('−1,500.5')
    expect(grouped('n/a')).toBe('n/a')
  })
  it('a digital asset forward: the buyer and seller by LEI, the price as the record holds it, an empty field left off', () => {
    const p = paperOf(ndf, { [A]: 'Harbour Desk LLC' })
    expect(p.kind).toBe('Non-deliverable forward on a digital asset')
    expect(p.parties).toEqual([{ letter: 'A', lei: A, name: 'Harbour Desk LLC', role: 'Buyer' }, { letter: 'B', lei: B, name: null, role: 'Seller' }])
    expect(p.trade).toContainEqual(['Notional', '10 BTC', 'fig'])
    const rows = Object.fromEntries(p.blocks[0].rows.map(([k, v]) => [k, v]))
    expect(rows['Forward price']).toBe('108,500.36122036983')
    expect(rows['Valuation date']).toBe('2 March 2027')
    expect(rows).not.toHaveProperty('Calculation agent')                       // null in the record
    expect(Object.keys(rows)).not.toContain('Buyer')                            // said under Parties
    expect(p.state).toBe('signed')
    expect(p.record.note).toBe('Not anchored: this record is held by Rijeka and is on no registry.')      // the paper's own words, not the server's note
    expect(p.demo).toBe(true)
    expect(p.signatures[0]).toMatchObject({ label: 'Booked by', letter: 'A', lei: A, name: 'Harbour Desk LLC', key: 'a demonstration key held by Rijeka' })
    expect(p.signatures[1].label).toBe('Counterparty')
  })
  it('a swap: who pays which leg, a rate as a percentage, and where it is anchored', () => {
    const p = paperOf(swap)
    expect(p.kind).toBe('Interest rate swap')
    expect(p.parties.map(x => x.role)).toEqual(['Pays fixed', 'Pays floating'])
    expect(p.blocks.map(b => b.title)).toEqual(['Leg 1 · floating · Party B pays Party A', 'Leg 2 · fixed · Party A pays Party B'])
    const fixed = Object.fromEntries(p.blocks[1].rows.map(([k, v]) => [k, v])), float = Object.fromEntries(p.blocks[0].rows.map(([k, v]) => [k, v]))
    expect(fixed['Fixed rate']).toBe('3.75 %')
    expect(fixed).not.toHaveProperty('Floating rate')
    expect(float['Floating rate']).toBe('USD SOFR')
    expect(float['Payments']).toBe('Annual'); expect(float['Business day convention']).toBe('Modified following')
    expect(float).not.toHaveProperty('Fixed rate')
    expect(float['Spread']).toBe('0 %')
    expect(p.state).toBe('anchored')
    expect(p.demo).toBe(false)
    expect(p.record).toMatchObject({ chain: 11155111, block: 12127133, tx: '0xbb', note: null })
    expect(p.record.at).toMatch(/^\d\d? November 2026, \d\d:\d\d:\d\d UTC$/)
    expect(p.record.testnet).toBe(true)                                      // Sepolia: the foot says it is a test network
    expect(p.signatures[1].label).toBe('Countersigned by')
  })
  it('a rate is moved two places in its text, never through a float; a moment is written as the dates are', () => {
    expect(pct('0.0375')).toBe('3.75 %'); expect(pct('0.03480009')).toBe('3.480009 %'); expect(pct('0')).toBe('0 %')
    expect(pct('0.000000000001')).toBe('0.0000000001 %')                       // a float would print 1e-10
    expect(pct('0.0375000000001')).toBe('3.75000000001 %')                     // and would round this one
    expect(pct('-0.0025')).toBe('−0.25 %'); expect(pct('1.5')).toBe('150 %'); expect(pct('n/a')).toBe('n/a')
    expect(longStamp('2026-11-13T16:26:23.5+00:00')).toBe('13 November 2026, 16:26 UTC')
  })
  it('a signed term is printed unless it is at its plain default; a choice is printed as words, a code as it is', () => {
    const stepped = { ...swap, canonical: { ...swap.canonical, legs: [
      leg('ZERO_COUPON', B, A, { fixed_rate: '0.031', spread: null }),
      leg('FIXED', A, B, { fixed_rate: '0.0375', spread: '0.001', fixed_rate_type: 'STEP_UP', fixed_rate_schedule: [{ from: '2028-11-04', rate: '0.04' }], leverage: '2', notional_type: 'AMORTIZING', stub_type: 'SHORT_FRONT' })] } }
    const p = paperOf(stepped), zc = Object.fromEntries(p.blocks[0].rows.map(([k, v]) => [k, v])), fx = Object.fromEntries(p.blocks[1].rows.map(([k, v, kind]) => [k, [v, kind]]))
    expect(p.blocks[0].title).toBe('Leg 1 · zero coupon · Party B pays Party A')
    expect(zc['Fixed rate']).toBe('3.1 %')                                     // a rate on a leg that is not FIXED is still a signed term
    expect(fx['Spread'][0]).toBe('0.1 %')                                      // so is a spread on a fixed leg
    expect(fx['Fixed rate type']).toEqual(['Step up', 'word'])
    expect(fx['Fixed rate schedule'][0]).toContain('2028-11-04')
    expect(fx['Leverage'][0]).toBe('2'); expect(fx['Notional type']).toEqual(['Amortizing', 'word'])
    expect(fx['Business day convention']).toEqual(['Modified following', 'word'])
    expect(fx['Day count']).toEqual(['ACT/360', 'fig']); expect(fx['Stub']).toEqual(['Short front', 'word'])
    const plainLeg = Object.fromEntries(paperOf(swap).blocks[1].rows.map(([k, v]) => [k, v]))
    for (const k of ['Leverage', 'Notional type', 'Fixed rate type', 'Spread type', 'Spread']) expect(plainLeg, k).not.toHaveProperty(k)
    const agent = paperOf({ ...ndf, canonical: { ...ndf.canonical, product: { ...ndf.canonical.product, calculation_agent: B } } })
    expect(Object.fromEntries(agent.blocks[0].rows.map(([k, v]) => [k, v]))['Calculation agent']).toBe(B)
  })
  it('a package leg is not given a sheet of hashes', () => {
    const pk = paperOf({ trade_ref: 'TRD-3', trade_hash: '0x99', package: { trade_id: 'TRD-3', legs: 2 }, attestation: att(),
      canonical: { schema: 'rijeka-package', schema_version: 1, parties: [A, B], legs: ['0x' + 'ab'.repeat(32), '0x' + 'cd'.repeat(32)] } })
    expect(pk.package).toBe(true); expect(pk.blocks).toEqual([])
  })
  it('a closed record says so, and a pack with nothing in it does not throw', () => {
    expect(paperOf({ ...swap, attestation: { ...swap.attestation, termination: { anchor: { tx_hash: '0xcc' } } } }).state).toBe('closed')
    const empty = paperOf(null)
    expect(empty.parties).toEqual([]); expect(empty.blocks).toEqual([]); expect(empty.kind).toBe('Trade')
  })
})

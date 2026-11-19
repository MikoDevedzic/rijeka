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
  // An option on a rate (0.61.0). A swaption's sheet was a swap's: no buyer, no expiry, no premium, the ticket's
  // unshifted dates, and a sold one's payer the wrong way. A cap's printed its options as the record's JSON.
  const rows = (b) => Object.fromEntries(b.rows.map(([k, v]) => [k, v]))
  const swaption = { trade_ref: 'TRD-9', trade_hash: '0x77', attestation: att(),
    canonical: { schema_version: 3, uti: A + 'S', parties: [A, B], trade: { asset_class: 'RATES', instrument_type: 'IR_SWAPTION', structure: 'EUROPEAN', notional: '10000000', notional_ccy: 'USD', trade_date: '2026-11-19' },
      option: { type: 'SWAPTION', buyer: B, seller: A, right: 'PAYER', exercise_style: 'EUROPEAN', expiry_date: '2027-11-19', exercise_schedule_y: null, strike: '0.03859304',
        settlement: 'PHYSICAL', premium_amount: '165478.07', premium_currency: 'USD', premium_payment_date: '2026-11-23' },
      legs: [leg('FIXED', B, A, { fixed_rate: '0.03859304', effective_date: '2027-11-23', maturity_date: '2032-11-23' }),
        leg('FLOAT', A, B, { index: 'USD_SOFR', reset_frequency: 'DAILY', effective_date: '2027-11-23', maturity_date: '2032-11-23' })] } }
  it('a swaption: who bought it, its right, expiry, strike and premium, then the swap delivered with its own dates', () => {
    const p = paperOf(swaption)
    expect(p.kind).toBe('Interest rate swaption')
    expect(p.parties.map(x => x.role)).toEqual(['Seller', 'Buyer'])
    expect(p.trade.map(([k]) => k)).toEqual(['Notional', 'Trade date'])                 // no date of the ticket's that is neither the option's nor the swap's
    expect(p.blocks.map(b => b.title)).toEqual(['Option · Party B buys from Party A',
      'Swap delivered on exercise · fixed leg · Party B pays Party A', 'Swap delivered on exercise · floating leg · Party A pays Party B'])
    expect(rows(p.blocks[0])).toEqual({ Option: 'Payer swaption: the right to pay the fixed rate', Exercise: 'European', 'Expiry date': '19 November 2027',
      Strike: '3.859304 %', Settlement: 'Physical', Premium: '165,478.07 USD', 'Premium payment date': '23 November 2026', 'Premium paid by': 'Party B to Party A' })
    const fixed = rows(p.blocks[1])
    expect(fixed['Effective date']).toBe('23 November 2027'); expect(fixed['Termination date']).toBe('23 November 2032'); expect(fixed['Fixed rate']).toBe('3.859304 %')
    expect(p.gap).toBeNull()
    // a Bermudan says when it can be exercised; no premium in the record is said, not left blank
    const berm = paperOf({ ...swaption, canonical: { ...swaption.canonical, option: { ...swaption.canonical.option, exercise_style: 'BERMUDAN', exercise_schedule_y: ['1', '2', '3.5'], premium_amount: null, premium_currency: null, premium_payment_date: null } } })
    expect(rows(berm.blocks[0])).toMatchObject({ Exercise: 'Bermudan', 'Exercise times': '1, 2, 3.5 years from the trade date', Premium: 'None in the record' })
    expect(rows(paperOf({ ...swaption, canonical: { ...swaption.canonical, option: { ...swaption.canonical.option, exercise_style: 'BERMUDAN' } } }).blocks[0])['Exercise times']).toBe('On the expiry date only')
  })
  it('a swaption signed before record v3 is printed as its record holds it, and the sheet says what the record does not hold', () => {
    const old = paperOf({ ...swaption, canonical: { ...swaption.canonical, schema_version: 2, option: undefined, trade: { ...swaption.canonical.trade, effective_date: '2026-11-23', maturity_date: '2031-11-23' } } })
    expect(old.gap).toContain('holds the swap a swaption delivers and not the option itself')
    expect(old.blocks[0].title).toMatch(/^Leg 1 · /)
  })
  const capLeg = (options) => leg('FLOAT', B, A, { index: 'USD_SOFR', reset_frequency: 'DAILY', payment_frequency: 'QUARTERLY', leverage: '0', embedded_options: options })
  const cap = (itype, options, option) => ({ trade_ref: 'TRD-8', trade_hash: '0x66', attestation: att(),
    canonical: { schema_version: option ? 3 : 2, uti: A + 'C', parties: [A, B], trade: { instrument_type: itype, structure: null, notional: '10000000', notional_ccy: 'USD', trade_date: '2026-11-19', effective_date: '2026-11-23', maturity_date: '2031-11-23' },
      ...(option ? { option } : {}), legs: [capLeg(options)] } })
  it('a cap: an option with a buyer, a seller and a strike, not a floating leg somebody pays with a leverage of nought', () => {
    const p = paperOf(cap('IR_CAP', [{ type: 'CAP', default_strike: '0.045', strike_schedule: [{ date: '2026-11-23', strike: '0.045' }], buyer: A, seller: B }],
      { type: 'CAP', buyer: A, seller: B, premium_amount: '97322.39', premium_currency: 'USD', premium_payment_date: '2026-11-23', premium_payer: A, premium_receiver: B }))
    expect(p.kind).toBe('Interest rate cap')
    expect(p.parties.map(x => x.role)).toEqual(['Buyer', 'Seller'])
    expect(p.blocks.map(b => b.title)).toEqual(['Cap · Party A buys from Party B', 'The rate and its periods', 'Premium'])
    expect(rows(p.blocks[0])).toEqual({ Strike: '4.5 %' })
    const period = rows(p.blocks[1])
    expect(period['Floating rate']).toBe('USD SOFR'); expect(period['Payments']).toBe('Quarterly')
    for (const k of ['Leverage', 'Spread', 'Embedded options']) expect(period, k).not.toHaveProperty(k)
    expect(rows(p.blocks[2])).toEqual({ Premium: '97,322.39 USD', 'Premium payment date': '23 November 2026', 'Premium paid by': 'Party A to Party B' })
    expect(p.blocks.flatMap(b => b.rows.map(([, v]) => v)).join(' ')).not.toMatch(/[{["]/)   // nothing of the record's JSON on the sheet
  })
  it('a collar: each side buys one option and sells the other; a strike that steps is printed by date; a v2 cap says its record has no premium', () => {
    const p = paperOf(cap('IR_COLLAR', [
      { type: 'CAP', default_strike: '0.045', strike_schedule: [{ date: '2026-11-23', strike: '0.045' }, { date: '2028-11-23', strike: '0.05' }], buyer: A, seller: B },
      { type: 'FLOOR', default_strike: '0.03', strike_schedule: [], buyer: B, seller: A }],
    { type: 'COLLAR', buyer: A, seller: B, premium_amount: '1250.5', premium_currency: 'USD', premium_payment_date: '2026-11-23', premium_payer: B, premium_receiver: A }))
    expect(p.parties.map(x => x.role)).toEqual(['Buys the cap, sells the floor', 'Buys the floor, sells the cap'])
    expect(p.blocks.map(b => b.title)).toEqual(['Cap · Party A buys from Party B', 'Floor · Party B buys from Party A', 'The rate and its periods', 'Premium'])
    expect(rows(p.blocks[0])).toEqual({ 'Strike from 23 November 2026': '4.5 %', 'Strike from 23 November 2028': '5 %' })
    expect(rows(p.blocks[1])).toEqual({ Strike: '3 %' })
    expect(rows(p.blocks[3])['Premium paid by']).toBe('Party B to Party A')
    const old = paperOf(cap('IR_FLOOR', [{ type: 'FLOOR', default_strike: '0.03', strike_schedule: [], buyer: B, seller: A }], null))
    expect(old.parties.map(x => x.role)).toEqual(['Seller', 'Buyer'])
    expect(old.blocks.map(b => b.title)).toEqual(['Floor · Party B buys from Party A', 'The rate and its periods'])
    expect(old.gap).toBe('This record was signed under record schema v2, which does not hold the premium.')
  })
  it('a swap with a cap written on a leg keeps its legs and prints the option beside its leg', () => {
    const capped = paperOf({ ...swap, canonical: { ...swap.canonical, legs: swap.canonical.legs.map(l => (l.leg_type === 'FLOAT'
      ? { ...l, embedded_options: [{ type: 'CAP', default_strike: '0.05', strike_schedule: [], buyer: A, seller: B }] } : l)) } })
    expect(capped.blocks.map(b => b.title)).toEqual(['Leg 1 · floating · Party B pays Party A', 'Leg 1 · cap · Party A buys from Party B', 'Leg 2 · fixed · Party A pays Party B'])
    expect(capped.parties.map(x => x.role)).toEqual(['Pays fixed', 'Pays floating'])
  })
  it('a currency option: an amount is grouped, a yes is a yes, a payout names its currency', () => {
    const fxo = paperOf({ ...ndf, canonical: { ...ndf.canonical, product: { product: 'FX_OPTION', buyer: A, seller: B, currency_pair: 'EURUSD', base_currency: 'EUR', quote_currency: 'USD',
      option_type: 'CALL', style: 'DIGITAL', strike: '1.09008', premium_amount: '487888.05', premium_currency: 'USD', automatic_exercise: true, payout: '1000000', payout_currency: 'QUOTE', barrier_monitoring: 'CONTINUOUS' } } })
    expect(rows(fxo.blocks[0])).toMatchObject({ 'Premium amount': '487,888.05', 'Automatic exercise': 'Yes', Payout: '1,000,000', 'Payout currency': 'USD', 'Barrier monitoring': 'Continuous' })
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

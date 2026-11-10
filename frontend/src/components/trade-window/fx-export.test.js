import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { sheetModel, buildWorkbook } from './fx-export'

const quote = { pair: 'BTCUSD', base_currency: 'BTC', quote_currency: 'USD', shape: 'NDF', direction: 'BUY', valuation_date: '2026-11-10', settlement_date: '2027-02-10',
  npv: 4669, spot: 108250, forward: 108466.36, forward_rate: 108000, df_quote: 0.990487, df_base: 0.992467, quote_curve: 'USD_SOFR', spot_source: 'snapshot 2026-11-02' }
const legs = [
  { name: 'BTC LEG', pay: false, notional: '10.0000 BTC', price: 108466.36, amount: 1084663.6, pv: 1084663.6 * 0.990487 },
  { name: 'USD LEG', pay: true, notional: '1,080,000 USD', price: 108000, amount: -1080000, pv: -1080000 * 0.990487 },
]
const net = 4663.6, pv = 4663.6 * 0.990487

describe('the CASHFLOWS tab as a workbook', () => {
  it('a forward: the two legs, their net, and the market, with the tab\'s own figures', () => {
    const m = sheetModel({ quote, legs, net, pv, crypto: true, ndf: true, dp: 2 })
    expect(m.meta).toContainEqual(['INSTRUMENT', 'CRYPTO NDF'])
    expect(m.tables.map(t => t.name)).toEqual(['CASHFLOWS (USD)', 'MARKET IT WAS PRICED ON'])
    expect(m.tables[0].rows).toHaveLength(2)
    expect(m.tables[0].rows[0][1]).toBe('RECEIVE'); expect(m.tables[0].rows[1][1]).toBe('PAY')
    expect(m.tables[0].total[0]).toBe('NET CASH SETTLEMENT')
  })
  it('writes a present value as amount × DF and the net as a sum, each with the figure the tab showed', async () => {
    const wb = await buildWorkbook(sheetModel({ quote, legs, net, pv, crypto: true, ndf: true, dp: 2 }), ExcelJS, new Date('2026-11-10T12:00:00Z'))
    const ws = wb.getWorksheet('CASHFLOWS')
    let leg = null, total = null
    ws.eachRow(r => { if (r.getCell(1).value === 'BTC LEG') leg = r; if (r.getCell(1).value === 'NET CASH SETTLEMENT') total = r })
    expect(leg.getCell(8).value).toEqual({ formula: `F${leg.number}*G${leg.number}`, result: legs[0].pv })
    expect(total.getCell(6).value).toEqual({ formula: `SUM(F${leg.number}:F${leg.number + 1})`, result: net })
    expect(total.getCell(8).value.result).toBeCloseTo(pv, 6)
    // the workbook writes and reads back
    const back = new ExcelJS.Workbook(); await back.xlsx.load(await wb.xlsx.writeBuffer())
    expect(back.getWorksheet('CASHFLOWS').getCell('A1').value).toBe('RIJEKA')
  })
  it('an option: the premium and the payoff, and the vol it was priced at', () => {
    const m = sheetModel({ quote: { ...quote, shape: 'OPTION', strike: 110000, vol_pct: 38.56 }, crypto: true, dp: 2,
      option: [{ name: 'PREMIUM', date: '2026-11-10', amount: -4669, df: 1 }, { name: 'PAYOFF AT EXPIRY', date: '2027-02-10', amount: 0, df: 0.990487 }] })
    expect(m.tables[0].name).toBe('FLOWS (USD)')
    expect(m.tables[0].rows[0][4]).toMatchObject({ v: -4669 })
    expect(m.tables[1].rows.map(r => r[0])).toContain('VOL %')
  })
})

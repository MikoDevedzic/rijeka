// trade-window/fx-export.js — the CASHFLOWS tab of a forward or an option as an Excel workbook, the way the
// swap's schedule exports. One sheet: what the trade is, the flows as the tab shows them, and the market the
// price was built on. A present value is written as a formula (amount × discount factor) and the net as a sum,
// with the figure the tab showed as its stored result, so the sheet recomputes in Excel and can be checked
// against the screen.
// An option's sheet states the premium and breaks the value into the discounted payoff at today's forward and
// the time value, which add up to it.
//
// `sheetModel` is the content, as plain rows, and is what the tests read; `exportCashflows` writes it with
// ExcelJS (bundled; nothing is fetched at run time) and hands the file to the browser.

// A cell: a plain value, or { v, fmt, f } where f(row) is a formula for the Excel row it lands on.
const money = '#,##0;[Red]-#,##0', df6 = '0.000000'

// { title, meta: [[name, value]], tables: [{ name, head, rows, total }] }
export function sheetModel({ quote, legs = null, net = null, pv = null, option = null, crypto = false, ndf = false, dp = 5 }) {
  const qc = quote.quote_currency, base = quote.base_currency
  const rate = '#,##0.' + '0'.repeat(dp)
  // a figure the quote does not carry is an empty cell, never a NaN
  const num = (v, fmt) => (v == null || !Number.isFinite(Number(v)) ? '' : { v: Number(v), fmt })
  const meta = [
    ['PAIR', quote.pair || `${base}${qc}`],
    ['INSTRUMENT', `${crypto ? 'CRYPTO' : 'FX'} ${quote.shape === 'OPTION' ? 'OPTION' : ndf ? 'NDF' : 'FORWARD'}`],
    ['DIRECTION', `${quote.direction} ${base}`],
    ['VALUATION DATE', quote.valuation_date || ''],
    ['SETTLEMENT DATE', quote.settlement_date || ''],
    ['NPV', num(quote.npv, money)],
    ['NPV CURRENCY', qc],
  ]
  const tables = []
  if (legs) {
    tables.push({
      name: `CASHFLOWS (${qc})`,
      head: ['LEG', 'DIRECTION', 'SETTLEMENT DATE', 'NOTIONAL', 'PRICE', `AMOUNT ${qc}`, 'DF', `PV ${qc}`],
      rows: legs.map(l => [l.name, l.pay ? 'PAY' : 'RECEIVE', quote.settlement_date, l.notional, num(l.price, rate),
        num(l.amount, money), num(quote.df_quote, df6), Number.isFinite(Number(l.pv)) ? { v: Number(l.pv), fmt: money, f: (r) => `F${r}*G${r}` } : '']),
      total: [ndf ? 'NET CASH SETTLEMENT' : 'NET', '', '', '', '', Number.isFinite(Number(net)) ? { v: Number(net), fmt: money, sum: 'F' } : '', '', Number.isFinite(Number(pv)) ? { v: Number(pv), fmt: money, sum: 'H' } : ''],
    })
  }
  if (option) {
    // the value is the discounted payoff at today's forward plus the time value: the two rows add up to it
    const intrinsicPv = Number(option.intrinsic) * Number(option.df)
    meta.push(['PREMIUM', num(option.premium, money)], ['PREMIUM DATE', quote.valuation_date || ''])
    tables.push({
      name: `OPTION VALUE (${qc})`,
      head: ['PART', 'DATE', `AMOUNT ${qc}`, 'DF', `PV ${qc}`],
      rows: [
        [option.payoffName, quote.settlement_date || '', num(option.intrinsic, money), num(option.df, df6), Number.isFinite(intrinsicPv) ? { v: intrinsicPv, fmt: money, f: (r) => `C${r}*D${r}` } : ''],
        ['TIME VALUE', '', '', '', num(Number(quote.npv) - intrinsicPv, money)],
      ],
      total: ['OPTION VALUE', '', '', '', Number.isFinite(Number(quote.npv)) ? { v: Number(quote.npv), fmt: money, sum: 'E' } : ''],
    })
  }
  const market = [
    ['SPOT', num(quote.spot, rate), quote.spot_source || ''],
    ['FAIR FORWARD', num(quote.forward, rate), ''],
    [quote.shape === 'OPTION' ? 'STRIKE' : 'FORWARD PRICE (K)', num(quote.shape === 'OPTION' ? quote.strike : quote.forward_rate, rate), ''],
    [`DF ${qc}`, num(quote.df_quote, df6), quote.quote_curve || ''],
    [`DF ${base}`, num(quote.df_base, df6), quote.base_discounting || ''],
  ]
  if (quote.vol_pct != null) market.push(['VOL %', num(quote.vol_pct, '0.00'), ''])
  tables.push({ name: 'MARKET IT WAS PRICED ON', head: ['ITEM', 'VALUE', 'SOURCE'], rows: market })
  return { title: `${quote.pair || base + qc} ${quote.shape === 'OPTION' ? 'option' : 'forward'} cashflows`, meta, tables }
}

const INK = 'FF1C2240', MUTE = 'FF5D6482', RULE = 'FFB9BECF', HEAD = 'FFF1F2EC'

export async function buildWorkbook(model, ExcelJS, now = new Date()) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Rijeka'; wb.created = now
  const ws = wb.addWorksheet('CASHFLOWS')
  ws.columns = [18, 14, 18, 18, 16, 18, 12, 18].map(width => ({ width }))
  const put = (row, i, cell, style = {}) => {
    const c = row.getCell(i + 1)
    const o = cell != null && typeof cell === 'object' ? cell : { v: cell }
    c.value = o.f ? { formula: o.f(row.number), result: o.v } : o.v
    if (o.fmt) c.numFmt = o.fmt
    c.font = { name: 'Calibri', size: 10, color: { argb: INK }, ...style.font }
    if (typeof o.v === 'number') c.alignment = { horizontal: 'right' }
    if (style.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } }
    if (style.border) c.border = style.border
  }
  const title = ws.addRow(['RIJEKA', model.title])
  title.getCell(1).font = { name: 'Calibri', size: 12, bold: true, color: { argb: INK } }
  title.getCell(2).font = { name: 'Calibri', size: 10, color: { argb: MUTE } }
  const stamp = ws.addRow(['EXPORTED', now.toISOString().slice(0, 19).replace('T', ' ') + ' UTC'])
  stamp.eachCell(c => { c.font = { name: 'Calibri', size: 9, color: { argb: MUTE } } })
  ws.addRow([])
  for (const [k, v] of model.meta) {
    const r = ws.addRow([])
    put(r, 0, k, { font: { color: { argb: MUTE }, size: 9 } }); put(r, 1, v)
  }
  for (const t of model.tables) {
    ws.addRow([])
    const name = ws.addRow([t.name]); name.getCell(1).font = { name: 'Calibri', size: 10, bold: true, color: { argb: INK } }
    const head = ws.addRow([])
    t.head.forEach((h, i) => put(head, i, h, { font: { bold: true, size: 9, color: { argb: MUTE } }, fill: HEAD, border: { bottom: { style: 'thin', color: { argb: RULE } } } }))
    const first = head.number + 1
    for (const cells of t.rows) { const r = ws.addRow([]); cells.forEach((c, i) => put(r, i, c)) }
    const last = head.number + t.rows.length
    if (t.total) {
      const r = ws.addRow([])
      t.total.forEach((c, i) => {
        const cell = c && typeof c === 'object' && c.sum ? { ...c, f: () => `SUM(${c.sum}${first}:${c.sum}${last})` } : c
        put(r, i, cell, { font: { bold: true }, border: { top: { style: 'thin', color: { argb: INK } } } })
      })
    }
  }
  ws.addRow([])
  const foot = ws.addRow(['Generated by Rijeka, the open-source derivatives desk. rijeka.app'])
  foot.getCell(1).font = { name: 'Calibri', size: 8, color: { argb: MUTE } }
  return wb
}

export async function exportCashflows(args) {
  const m = await import('exceljs')
  const ExcelJS = m.default || m
  const model = sheetModel(args)
  const wb = await buildWorkbook(model, ExcelJS)
  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const q = args.quote
  a.href = url; a.download = `rijeka_${q.pair || q.base_currency + q.quote_currency}_${q.settlement_date || 'cashflows'}_cashflows.xlsx`
  a.click(); URL.revokeObjectURL(url)
}

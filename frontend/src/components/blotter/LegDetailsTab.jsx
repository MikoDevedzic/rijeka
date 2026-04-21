import { useState, useEffect, useRef } from 'react'
import CustomCashflowsEditor from './CustomCashflowsEditor'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

const CCY_CURVE = {
  USD:'USD_SOFR', EUR:'EUR_ESTR', GBP:'GBP_SONIA',
  JPY:'JPY_TONAR', CHF:'CHF_SARON', AUD:'AUD_AONIA', CAD:'CAD_CORRA',
}
const INDEX_CURVE = {
  'SOFR':'USD_SOFR','TERM SOFR 3M':'USD_TSOFR_3M','EFFR':'USD_EFFR',
  'ESTR':'EUR_ESTR','EURIBOR 3M':'EUR_EURIBOR_3M','EURIBOR 6M':'EUR_EURIBOR_6M',
  'SONIA':'GBP_SONIA','TONAR':'JPY_TONAR','SARON':'CHF_SARON',
  'AONIA':'AUD_AONIA','BBSW 3M':'AUD_BBSW_3M','CORRA':'CAD_CORRA',
}
const INDEX_PAY_LAG = { SOFR:2, ESTR:2, SONIA:0, TONAR:2, SARON:2, AONIA:0, CORRA:1 }

const BG_BLACK='000000', BG_PANEL='0C0C0C', BG_PANEL2='141414', BG_HDR='050505'
const TEAL='00D4A8', RED='FF6B6B', AMBER='F5C842', WHITE='F0F0F0', MUTED='666666', DIM='444444', BORDER_C='1E1E1E'

// Sprint 11: S and C are exported for CustomCashflowsEditor.
export const C = {
  accent:'#00D4A8', red:'#FF6B6B', blue:'#4A9EFF',
  amber:'#F5C842', panel:'#0C0C0C', panel2:'#141414',
  border:'#1E1E1E', text:'#F0F0F0', muted:'#666', dim:'#444',
}

export const S = {
  root:{ flex:1, overflowY:'auto', padding:'12px 16px', display:'flex', flexDirection:'column', gap:'10px', fontFamily:"'IBM Plex Sans',sans-serif" },
  banner:{ display:'flex', alignItems:'center', gap:'10px', background:C.panel, border:'1px solid '+C.border, borderRadius:'3px', padding:'7px 14px' },
  structLbl:{ fontSize:'10px', color:C.muted, letterSpacing:'0.08em' },
  structVal:{ fontSize:'13px', color:C.accent, fontFamily:"'IBM Plex Mono',monospace", fontWeight:600 },
  zcWrap:{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'6px', cursor:'pointer', fontSize:'10px', color:C.muted, letterSpacing:'0.07em' },
  zcBox:(on)=>({ width:'13px', height:'13px', border:'1px solid '+(on?C.accent:'#333'), borderRadius:'2px', background:on?'rgba(0,212,168,0.15)':'transparent', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'9px', color:C.accent }),
  grid:{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' },
  panel:{ background:C.panel, border:'1px solid '+C.border, borderRadius:'3px', padding:'10px 12px', display:'flex', flexDirection:'column', gap:'8px' },
  panelHdr:{ display:'flex', alignItems:'center', gap:'8px', fontSize:'11px', letterSpacing:'0.1em', color:C.muted, fontWeight:600 },
  badge:(pay)=>({ fontSize:'10px', letterSpacing:'0.07em', fontWeight:600, padding:'2px 8px', borderRadius:'2px', background:pay?'rgba(255,107,107,0.12)':'rgba(0,212,168,0.12)', color:pay?C.red:C.accent, border:'1px solid '+(pay?'rgba(255,107,107,0.3)':'rgba(0,212,168,0.3)') }),
  divider:{ height:'1px', background:'#1A1A1A' },
  secTitle:{ fontSize:'11px', color:C.accent, letterSpacing:'0.08em', fontWeight:600 },
  secHint:{ fontSize:'10px', color:C.dim, marginTop:'2px', marginBottom:'4px' },
  toolbar:{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'4px' },
  toolBtn:(color)=>({ fontSize:'10px', color:color||C.accent, background:color?`rgba(${color===C.red?'255,107,107':color===C.blue?'74,158,255':color===C.amber?'245,200,66':'0,212,168'},0.08)`:'rgba(0,212,168,0.08)', border:`1px solid ${color?`rgba(${color===C.red?'255,107,107':color===C.blue?'74,158,255':color===C.amber?'245,200,66':'0,212,168'},0.25)`:'rgba(0,212,168,0.2)'}`, borderRadius:'2px', padding:'3px 10px', cursor:'pointer', fontFamily:"'IBM Plex Sans',sans-serif", letterSpacing:'0.04em' }),
  tbl:{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' },
  th:{ fontSize:'10px', color:C.dim, letterSpacing:'0.07em', padding:'4px 4px', textAlign:'left', borderBottom:'1px solid '+C.border, fontWeight:400 },
  td:{ padding:'2px 3px', borderBottom:'1px solid #0F0F0F' },
  cell:{ fontSize:'11px', fontFamily:"'IBM Plex Mono',monospace", background:C.panel2, border:'1px solid '+C.border, borderRadius:'2px', padding:'3px 5px', width:'100%', boxSizing:'border-box', outline:'none', color:C.text, WebkitAppearance:'none', MozAppearance:'textfield', appearance:'textfield' },
  cellRo:{ fontSize:'11px', fontFamily:"'IBM Plex Mono',monospace", background:'#080808', border:'1px solid #141414', borderRadius:'2px', padding:'3px 5px', width:'100%', boxSizing:'border-box', color:C.muted, userSelect:'none' },
  cellAmber:{ fontSize:'11px', fontFamily:"'IBM Plex Mono',monospace", background:'rgba(245,200,66,0.06)', border:'1px solid rgba(245,200,66,0.4)', borderRadius:'2px', padding:'3px 5px', width:'100%', boxSizing:'border-box', outline:'none', color:C.amber, WebkitAppearance:'none', MozAppearance:'textfield', appearance:'textfield' },
  del:{ background:'none', border:'none', color:C.red, cursor:'pointer', fontSize:'12px', padding:'0 4px', opacity:0.6 },
  loading:{ fontSize:'11px', color:C.muted, fontStyle:'italic', padding:'8px 2px' },
  emptyRow:{ fontSize:'10px', color:C.dim, fontStyle:'italic', padding:'5px 2px' },
  hintBox:{ fontSize:'10px', color:C.muted, lineHeight:1.6, background:'#080808', border:'1px solid #1A1A1A', borderRadius:'2px', padding:'6px 9px', marginTop:'4px' },
  coming:{ fontSize:'10px', color:C.dim, border:'1px dashed '+C.border, borderRadius:'2px', padding:'8px', textAlign:'center', letterSpacing:'0.05em' },
  dropZone:(active)=>({ border:'1px dashed '+(active?C.accent:'#2A2A2A'), borderRadius:'3px', padding:'10px', textAlign:'center', fontSize:'10px', color:active?C.accent:C.dim, background:active?'rgba(0,212,168,0.04)':'transparent', transition:'all 0.15s', cursor:'pointer', letterSpacing:'0.05em' }),
}

function EditCell({ value, original, onChange, placeholder='' }) {
  const changed = original !== undefined && String(value) !== String(original)
  return <input type='number' placeholder={placeholder} style={changed?S.cellAmber:S.cell} value={value} onChange={e=>onChange(e.target.value)} />
}

function parsePaste(text, isFloat=false) {
  return text.trim().split('\n').map(line => {
    const cols = line.split('\t').map(c=>c.trim())
    return isFloat
      ? { period_start:cols[0]||'', period_end:cols[1]||'', payment_date:cols[2]||'', notional:cols[3]||'', spread_bps:cols[4]||'0', orig_notional:cols[3]||'', orig_spread_bps:cols[4]||'0' }
      : { period_start:cols[0]||'', period_end:cols[1]||'', payment_date:cols[2]||'', notional:cols[3]||'', rate:cols[4]||'0', orig_notional:cols[3]||'', orig_rate:cols[4]||'0' }
  }).filter(r=>r.period_start)
}

async function loadExcelJS() {
  if (window.ExcelJS) return window.ExcelJS
  await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s) })
  return window.ExcelJS
}

async function exportToExcel(fixedRows, floatRows, tradeRef='TRADE', dir='PAY', floatDir='RECEIVE', ccy='USD', index='SOFR', customFixedRows=[], customFloatRows=[]) {
  const ExcelJS = await loadExcelJS()
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Rijeka'; wb.created = new Date()
  const exportDate = new Date().toISOString().slice(0,19).replace('T',' ')
  const border = { top:{style:'thin',color:{argb:'FF'+BORDER_C}}, bottom:{style:'thin',color:{argb:'FF'+BORDER_C}}, left:{style:'thin',color:{argb:'FF'+BORDER_C}}, right:{style:'thin',color:{argb:'FF'+BORDER_C}} }
  const fill = hex=>({ type:'pattern', pattern:'solid', fgColor:{argb:'FF'+hex} })
  const font = (hex,opts={})=>({ name:opts.mono?'Courier New':'Calibri', size:opts.size||9, bold:opts.bold||false, color:{argb:'FF'+hex} })

  const buildSheet = (wb, sheetName, colDefs, dataRows, meta) => {
    const ws = wb.addWorksheet(sheetName, { properties:{tabColor:{argb:'FF00D4A8'}}, views:[{state:'frozen',ySplit:6}] })
    ws.columns = colDefs.map(c=>({width:c.width}))
    const logoRow = ws.addRow([]); logoRow.height=22
    const lc=logoRow.getCell(1); lc.value='RIJEKA'; lc.font=font(TEAL,{mono:true,size:13,bold:true}); lc.fill=fill(BG_BLACK); lc.border=border
    const lb=logoRow.getCell(2); lb.value=meta.label; lb.font=font(MUTED); lb.fill=fill(BG_BLACK); lb.border=border
    for(let i=3;i<=26;i++){const c=logoRow.getCell(i);c.fill=fill(BG_BLACK);c.border=border}
    const metaData=[['TRADE REF',tradeRef,BG_PANEL],['EXPORTED',exportDate,BG_PANEL2],['DIRECTION',meta.direction,BG_PANEL]]
    metaData.forEach(([lbl,val,bg])=>{
      const row=ws.addRow([]); row.height=14
      const lc=row.getCell(1); lc.value=lbl; lc.font=font(MUTED); lc.fill=fill(bg); lc.border=border
      const vc=row.getCell(2); vc.value=val; vc.font=font(WHITE,{mono:true}); vc.fill=fill(bg); vc.border=border
      for(let i=3;i<=26;i++){const c=row.getCell(i);c.fill=fill(bg);c.border=border}
    })
    const spacer=ws.addRow([]); spacer.height=6
    for(let i=1;i<=26;i++){const c=spacer.getCell(i);c.fill=fill(BG_BLACK);c.border=border}
    const hdrRow=ws.addRow(colDefs.map(c=>c.label)); hdrRow.height=16
    colDefs.forEach((col,i)=>{ const c=hdrRow.getCell(i+1); c.font=font(TEAL,{bold:true}); c.fill=fill(BG_HDR); c.border=border; c.alignment={horizontal:col.align||'left',vertical:'middle'} })
    for(let i=colDefs.length+1;i<=26;i++){const c=hdrRow.getCell(i);c.fill=fill(BG_HDR);c.border=border}
    ws.autoFilter={from:{row:6,column:1},to:{row:6,column:colDefs.length}}
    dataRows.forEach((rowData,ri)=>{
      const bg=ri%2===0?BG_PANEL:BG_PANEL2
      const row=ws.addRow([]); row.height=14
      rowData.forEach((cell,ci)=>{ const c=row.getCell(ci+1); c.value=cell.v; c.font=font(cell.color||WHITE,{mono:cell.mono!==false}); c.fill=fill(bg); c.border=border; c.alignment={horizontal:colDefs[ci].align||'left',vertical:'middle'}; if(cell.fmt)c.numFmt=cell.fmt })
      for(let i=rowData.length+1;i<=26;i++){const c=row.getCell(i);c.fill=fill(bg);c.border=border}
    })
    const footer=ws.addRow([]); footer.height=12
    const fc=footer.getCell(1); fc.value='Generated by Rijeka open-source derivatives pricing and risk platform rijeka.app'; fc.font=font(DIM,{size:8}); fc.fill=fill(BG_BLACK); fc.border=border
    for(let i=2;i<=26;i++){const c=footer.getCell(i);c.fill=fill(BG_BLACK);c.border=border}
  }

  const fixedCols=[{label:'ACCRUAL START',width:14},{label:'ACCRUAL END',width:14},{label:'PAY DATE',width:14},{label:'NOTIONAL',width:16,align:'right'},{label:'COUPON %',width:12,align:'right'},{label:'DIRECTION',width:12}]
  const fixedData=fixedRows.map(r=>[{v:r.period_start},{v:r.period_end},{v:r.payment_date},{v:parseFloat(r.notional)||0,fmt:'#,##0',align:'right',color:dir==='PAY'?RED:TEAL},{v:parseFloat(r.rate)||0,fmt:'0.000000',align:'right',color:String(r.rate)!==String(r.orig_rate)?AMBER:WHITE},{v:dir==='PAY'?'PAY':'RECEIVE',color:dir==='PAY'?RED:TEAL}])
  buildSheet(wb,'FIXED LEG',fixedCols,fixedData,{label:'FIXED LEG '+ccy+' '+(dir==='PAY'?'PAY FIXED':'RECEIVE FIXED'),direction:(dir==='PAY'?'PAY FIXED':'RECEIVE FIXED')+' '+ccy})

  const floatCols=[{label:'ACCRUAL START',width:14},{label:'ACCRUAL END',width:14},{label:'PAY DATE',width:14},{label:'NOTIONAL',width:16,align:'right'},{label:'INDEX',width:12},{label:'SPREAD BP',width:12,align:'right'},{label:'DIRECTION',width:12}]
  const floatData=floatRows.map(r=>[{v:r.period_start},{v:r.period_end},{v:r.payment_date},{v:parseFloat(r.notional)||0,fmt:'#,##0',align:'right',color:floatDir==='PAY'?RED:TEAL},{v:index,color:TEAL},{v:parseFloat(r.spread_bps)||0,fmt:'0.00',align:'right',color:String(r.spread_bps)!==String(r.orig_spread_bps)?AMBER:WHITE},{v:floatDir==='PAY'?'PAY':'RECEIVE',color:floatDir==='PAY'?RED:TEAL}])
  buildSheet(wb,'FLOAT LEG',floatCols,floatData,{label:'FLOAT LEG '+ccy+' '+index,direction:(floatDir==='PAY'?'PAY FLOAT':'RECEIVE FLOAT')+' '+ccy+' '+index})

  // Sprint 11 Day 3a: custom cashflow sheets, one per leg side
  const customCashflowCols=[
    {label:'TYPE',      width:16},
    {label:'PAY DATE',  width:14},
    {label:'ACCR START',width:14},
    {label:'ACCR END',  width:14},
    {label:'AMOUNT',    width:18, align:'right'},
    {label:'CCY',       width:8},
    {label:'NOTES',     width:24},
  ]
  const buildCustomData = (rows) => (rows||[]).map(r=>{
    const amt = parseFloat(r.amount)
    const amtColor = isFinite(amt) ? (amt < 0 ? RED : (amt > 0 ? TEAL : WHITE)) : WHITE
    return [
      {v:r.type||'FEE'},
      {v:r.payment_date||''},
      {v:r.accrual_start||''},
      {v:r.accrual_end||''},
      {v:isFinite(amt)?amt:0, fmt:'#,##0.00', align:'right', color:amtColor},
      {v:r.currency||ccy},
      {v:r.notes||''},
    ]
  })
  if ((customFixedRows||[]).length > 0) {
    buildSheet(wb,'FIXED CUSTOM CASHFLOWS',customCashflowCols,buildCustomData(customFixedRows),
      {label:'FIXED LEG CUSTOM CASHFLOWS · '+ccy, direction:(dir==='PAY'?'PAY FIXED':'RECEIVE FIXED')+' · custom'})
  }
  if ((customFloatRows||[]).length > 0) {
    buildSheet(wb,'FLOAT CUSTOM CASHFLOWS',customCashflowCols,buildCustomData(customFloatRows),
      {label:'FLOAT LEG CUSTOM CASHFLOWS · '+ccy+' '+index, direction:(floatDir==='PAY'?'PAY FLOAT':'RECEIVE FLOAT')+' · custom'})
  }

  const buf=await wb.xlsx.writeBuffer()
  const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='rijeka_'+tradeRef+'_schedule.xlsx'; a.click(); URL.revokeObjectURL(url)
}

async function parseExcelFile(file) {
  if (!window.XLSX) {
    await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/xlsx@0.20.3/dist/xlsx.full.min.js'; s.onload=res; s.onerror=rej; document.head.appendChild(s) })
  }
  const XLSX=window.XLSX
  return new Promise((resolve,reject)=>{
    const reader=new FileReader()
    reader.onload=e=>{
      const wb=XLSX.read(e.target.result,{type:'binary'})
      // Sprint 11 Day 3a: find sheet by any of several name variants.
      // Export writes UPPERCASE; old import code looked for title-case.
      // Check both + any case-insensitive match as last resort.
      const findSheet = (wb, names) => {
        for (const n of names) if (wb.Sheets[n]) return wb.Sheets[n]
        const keys = Object.keys(wb.Sheets)
        for (const n of names) {
          const match = keys.find(k => k.toLowerCase() === n.toLowerCase())
          if (match) return wb.Sheets[match]
        }
        return null
      }
      const toJson = sh => sh ? XLSX.utils.sheet_to_json(sh) : []
      const fixed        = toJson(findSheet(wb, ['FIXED LEG','Fixed Leg']))
      const float        = toJson(findSheet(wb, ['FLOAT LEG','Float Leg']))
      const customFixed  = toJson(findSheet(wb, ['FIXED CUSTOM CASHFLOWS','Fixed Custom Cashflows']))
      const customFloat  = toJson(findSheet(wb, ['FLOAT CUSTOM CASHFLOWS','Float Custom Cashflows']))
      resolve({fixed, float, customFixed, customFloat})
    }
    reader.onerror=reject; reader.readAsBinaryString(file)
  })
}

function deriveSchedules(fixedRows, floatRows) {
  return {
    rateSchedule: fixedRows
      .filter(r => r.period_start && String(r.rate) !== String(r.orig_rate) && !isNaN(parseFloat(r.rate)))
      .map(r => ({ date: r.period_start, rate: String(parseFloat(r.rate)) })),
    notionalSchedule: fixedRows
      .filter(r => r.period_start && String(r.notional) !== String(r.orig_notional) && !isNaN(parseFloat(r.notional)))
      .map(r => ({ date: r.period_start, notional: String(parseFloat(r.notional)) })),
    spreadSchedule: floatRows
      .filter(r => r.period_start && String(r.spread_bps) !== String(r.orig_spread_bps) && !isNaN(parseFloat(r.spread_bps)))
      .map(r => ({ date: r.period_start, spread_bps: String(parseFloat(r.spread_bps)) })),
  }
}

export default function LegDetailsTab({
  struct, dir, floatDir, ccy, index,
  effDate, matDate, valDate,
  notionalRef, rateRef, spreadRef, parRate,
  fixedPayFreq, fixedDc, fixedBdc, fixedCal,
  floatPayFreq, floatDc, floatBdc, floatCal, floatResetFreq,
  zcToggle, setZcToggle,
  rateSchedule, setRateSchedule,
  notionalSchedule, setNotionalSchedule,
  spreadSchedule, setSpreadSchedule,
  deriveStructLabel, getSession,
  scheduleRef,
  index2, floatDc2, floatPayFreq2, floatResetFreq2,
  inst,
  feeSchedule, setFeeSchedule,
  feeAmount, feeAmountType, feeSettleDate,
  exerciseType,
  // Sprint 11: custom cashflow state per leg_ref (adapter flattens the map)
  customCashflowsFixed, setCustomCashflowsFixed,
  customCashflowsFloat, setCustomCashflowsFloat,
}) {
  const [fixedRows,  setFixedRows]  = useState([])
  const [floatRows,  setFloatRows]  = useState([])
  const [loading,    setLoading]    = useState(false)
  const [loadErr,    setLoadErr]    = useState('')
  const [dropFixed,  setDropFixed]  = useState(false)
  const [dropFloat,  setDropFloat]  = useState(false)
  const fileInputRef = useRef(null)
  const fileTarget   = useRef(null)
  const prevKey      = useRef('')

  const structLabel = deriveStructLabel ? deriveStructLabel() : struct

  useEffect(() => {
    const rateVal = parRate || parseFloat(rateRef?.current?.value || '0')
    const key = [effDate,matDate,ccy,index,fixedPayFreq,fixedDc,floatPayFreq,floatDc,floatResetFreq,String(rateVal)].join('|')
    if (!effDate || !matDate) return
    if (!rateVal || rateVal === 0) return
    if (key === prevKey.current) return
    prevKey.current = key
    loadSchedule()
  }, [effDate, matDate, ccy, index, fixedPayFreq, fixedDc, floatPayFreq, floatDc, floatResetFreq, parRate])

  // Synchronously update scheduleRef + async update parent state for display
  useEffect(() => {
    const schedules = deriveSchedules(fixedRows, floatRows)
    if (scheduleRef) scheduleRef.current = schedules
    setRateSchedule(schedules.rateSchedule)
    setNotionalSchedule(schedules.notionalSchedule)
    setSpreadSchedule(schedules.spreadSchedule)
  }, [fixedRows, floatRows])

  const loadSchedule = async () => {
    if (!effDate || !matDate) return
    setLoading(true); setLoadErr('')
    try {
      const session = await getSession()
      if (!session) { setLoadErr('Not authenticated'); return }
      const h = { Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' }
      const curveId    = CCY_CURVE[ccy] || 'USD_SOFR'
      const forecastId = INDEX_CURVE[index] || curveId
      const isOIS      = struct === 'OIS'
      const payLag     = INDEX_PAY_LAG[index] != null ? INDEX_PAY_LAG[index] : 2
      const notional   = parseFloat((notionalRef?.current?.value||'10000000').replace(/,/g,''))||10000000
      const rateRaw    = rateRef?.current?.value || (parRate ? String(parRate) : '0')
      const fixedRate  = parseFloat(rateRaw)/100
      const spread     = parseFloat(spreadRef?.current?.value||'0')/10000
      const legs = struct === 'BASIS' ? [
        // BASIS SWAP: two float legs with different indices
        { leg_ref:'FLOAT-1', leg_seq:1, leg_type:'FLOAT', direction:dir, currency:ccy, notional,
          effective_date:effDate, maturity_date:matDate, day_count:floatDc, payment_frequency:floatPayFreq,
          reset_frequency:floatResetFreq, bdc:floatBdc, payment_lag:payLag,
          fixed_rate:0, spread:0, leverage:1.0,
          discount_curve_id:curveId, forecast_curve_id:curveId, ois_compounding:null },
        { leg_ref:'FLOAT-2', leg_seq:2, leg_type:'FLOAT', direction:dir==='PAY'?'RECEIVE':'PAY', currency:ccy, notional,
          effective_date:effDate, maturity_date:matDate,
          day_count:(floatDc2||floatDc), payment_frequency:(floatPayFreq2||floatPayFreq),
          reset_frequency:(floatResetFreq2||floatResetFreq), bdc:floatBdc, payment_lag:payLag,
          fixed_rate:0, spread, leverage:1.0,
          discount_curve_id:curveId, forecast_curve_id:INDEX_CURVE[index2||'EFFR']||curveId, ois_compounding:null },
      ] : [
        { leg_ref:'FIXED-1', leg_seq:1, leg_type:zcToggle?'ZERO_COUPON':'FIXED', direction:dir, currency:ccy, notional, effective_date:effDate, maturity_date:matDate, day_count:fixedDc, payment_frequency:zcToggle?'ZERO_COUPON':fixedPayFreq, bdc:fixedBdc, payment_lag:payLag, fixed_rate:fixedRate, discount_curve_id:curveId, forecast_curve_id:null, ois_compounding:null },
        { leg_ref:'FLOAT-1', leg_seq:2, leg_type:'FLOAT', direction:dir==='PAY'?'RECEIVE':'PAY', currency:ccy, notional, effective_date:effDate, maturity_date:matDate, day_count:floatDc, payment_frequency:floatPayFreq, reset_frequency:isOIS?'DAILY':floatResetFreq, bdc:floatBdc, payment_lag:payLag, fixed_rate:0, spread, leverage:1.0, discount_curve_id:curveId, forecast_curve_id:forecastId, ois_compounding:isOIS?'COMPOUNDING':null },
      ]
      const res = await fetch(API+'/price/preview', { method:'POST', headers:h, body:JSON.stringify({legs, valuation_date:valDate||new Date().toISOString().slice(0,10), curves:[{curve_id:curveId,quotes:[]}]}) })
      if (!res.ok) { setLoadErr('Price the trade first to load schedule.'); return }
      const data = await res.json()
      const fixedLeg = struct === 'BASIS'
        ? data.legs?.find(l=>l.leg_ref==='FLOAT-1')
        : data.legs?.find(l=>l.leg_type==='FIXED'||l.leg_type==='ZERO_COUPON')
      const floatLeg = struct === 'BASIS'
        ? data.legs?.find(l=>l.leg_ref==='FLOAT-2')
        : data.legs?.find(l=>l.leg_type==='FLOAT')
      if (fixedLeg?.cashflows) {
        setFixedRows(fixedLeg.cashflows.map(cf=>({ period_start:cf.period_start, period_end:cf.period_end, payment_date:cf.payment_date, notional:String(Math.round(cf.notional||notional)), rate:String((cf.rate*100).toFixed(8)), orig_notional:String(Math.round(cf.notional||notional)), orig_rate:String((cf.rate*100).toFixed(8)) })))
      }
      if (floatLeg?.cashflows) {
        setFloatRows(floatLeg.cashflows.map(cf=>({ period_start:cf.period_start, period_end:cf.period_end, payment_date:cf.payment_date, notional:String(Math.round(cf.notional||notional)), spread_bps:'0', orig_notional:String(Math.round(cf.notional||notional)), orig_spread_bps:'0' })))
      }
    } catch(e) { setLoadErr('Error: '+e.message) }
    finally { setLoading(false) }
  }

  const updateFixed = (i,k,v) => setFixedRows(p=>p.map((r,j)=>j===i?{...r,[k]:v}:r))
  const updateFloat = (i,k,v) => setFloatRows(p=>p.map((r,j)=>j===i?{...r,[k]:v}:r))

  const handlePasteFixed = async () => { try { const text=await navigator.clipboard.readText(); const rows=parsePaste(text,false); if(rows.length)setFixedRows(rows) } catch(e){} }
  const handlePasteFloat = async () => { try { const text=await navigator.clipboard.readText(); const rows=parsePaste(text,true); if(rows.length)setFloatRows(rows) } catch(e){} }
  const handleExport = () => exportToExcel(fixedRows, floatRows, 'TRADE', dir, floatDir, ccy, index, customCashflowsFixed, customCashflowsFloat)
  const handleFileImport = async (file) => {
    if (!file) return
    try {
      const {fixed, float, customFixed, customFloat} = await parseExcelFile(file)
      if (fixed.length) setFixedRows(fixed.map(r=>({ period_start:r['ACCRUAL START']||'', period_end:r['ACCRUAL END']||'', payment_date:r['PAY DATE']||'', notional:String(r['NOTIONAL']||''), rate:String(r['COUPON %']||'0'), orig_notional:String(r['NOTIONAL']||''), orig_rate:String(r['COUPON %']||'0') })))
      if (float.length) setFloatRows(float.map(r=>({ period_start:r['ACCRUAL START']||'', period_end:r['ACCRUAL END']||'', payment_date:r['PAY DATE']||'', notional:String(r['NOTIONAL']||''), spread_bps:String(r['SPREAD BP']||'0'), orig_notional:String(r['NOTIONAL']||''), orig_spread_bps:String(r['SPREAD BP']||'0') })))
      // Sprint 11 Day 3a: import custom cashflows if present in workbook.
      const VALID_TYPES = ['COUPON','PRINCIPAL','FEE','REBATE','NOTIONAL_EXCHANGE','AMORTIZATION']
      const newCustomId = () => 'cf_' + (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().replace(/-/g,'').slice(0,12)
        : Math.random().toString(36).slice(2,14))
      const parseCustom = (rows) => (rows||[]).map(r => {
        const rawType = String(r['TYPE']||'FEE').toUpperCase().replace(/\s+/g,'_')
        const type = VALID_TYPES.includes(rawType) ? rawType : 'FEE'
        return {
          id:            newCustomId(),
          type,
          payment_date:  String(r['PAY DATE']||''),
          accrual_start: String(r['ACCR START']||''),
          accrual_end:   String(r['ACCR END']||''),
          amount:        String(r['AMOUNT']??''),
          currency:      String(r['CCY']||ccy||'USD').toUpperCase(),
          notes:         String(r['NOTES']||''),
        }
      }).filter(r => r.payment_date || r.amount)
      if (customFixed && customFixed.length && setCustomCashflowsFixed) {
        setCustomCashflowsFixed(parseCustom(customFixed))
      }
      if (customFloat && customFloat.length && setCustomCashflowsFloat) {
        setCustomCashflowsFloat(parseCustom(customFloat))
      }
    } catch(e) { alert('Import failed: '+e.message) }
  }
  const handleDrop = async (e, isFloat) => { e.preventDefault(); isFloat?setDropFloat(false):setDropFixed(false); const file=e.dataTransfer.files[0]; if(file)await handleFileImport(file) }

  const forceReload = () => { prevKey.current=''; loadSchedule() }

  // Reset overrides: reload schedule from par (clears all amber cells)
  const resetFixed = () => { prevKey.current=''; loadSchedule() }
  const resetFloat = () => { prevKey.current=''; loadSchedule() }

  const hasFixedOverrides = fixedRows.some(r=>String(r.notional)!==String(r.orig_notional)||String(r.rate)!==String(r.orig_rate))
  const hasFloatOverrides = floatRows.some(r=>String(r.spread_bps)!==String(r.orig_spread_bps)||String(r.notional)!==String(r.orig_notional))

  return (
    <div className='tbw-no-drag' style={S.root}>
      <div style={S.banner}>
        <span style={S.structLbl}>DERIVED STRUCTURE</span>
        <span style={S.structVal}>{structLabel}</span>
        <div style={S.zcWrap} onClick={()=>setZcToggle(v=>!v)}>
          <div style={S.zcBox(zcToggle)}>{zcToggle?'v':''}</div>
          ZERO COUPON
        </div>
      </div>
      <div style={S.grid}>

        {/* FIXED LEG */}
        <div style={S.panel}>
          <div style={S.panelHdr}>
            {struct === 'BASIS' ? 'FLOAT LEG 1' : 'FIXED LEG'}
            <span style={S.badge(dir==='PAY')}>{struct === 'BASIS' ? (dir==='PAY'?'PAY LEG 1':'RECEIVE LEG 1') : (dir==='PAY'?'PAY FIXED':'RECEIVE FIXED')}</span>
            {hasFixedOverrides && (
              <button onClick={resetFixed} style={{marginLeft:'auto', fontSize:'10px', color:C.amber, background:'rgba(245,200,66,0.06)', border:'1px solid rgba(245,200,66,0.3)', borderRadius:'2px', padding:'2px 8px', cursor:'pointer', fontFamily:"'IBM Plex Sans',sans-serif", letterSpacing:'0.04em'}}>
                RESET TO PAR
              </button>
            )}
          </div>
          <div style={S.divider}/>
          <div style={S.secTitle}>PERIOD SCHEDULE</div>
          <div style={S.secHint}>Edit COUPON % for step-up or NOTIONAL for amortizing. Amber = overridden. Hit PRICE to reprice.</div>
          <div style={S.toolbar}>
            <button style={S.toolBtn()} onClick={forceReload}>REFRESH</button>
            <button style={S.toolBtn()} onClick={handlePasteFixed}>PASTE</button>
            <button style={S.toolBtn(C.blue)} onClick={handleExport}>EXPORT XLS</button>
            <input ref={fileInputRef} type='file' accept='.xlsx,.xls,.csv' style={{display:'none'}} onChange={e=>{handleFileImport(e.target.files[0]);e.target.value=''}} />
            <button style={S.toolBtn(C.blue)} onClick={()=>{fileTarget.current='fixed';fileInputRef.current?.click()}}>IMPORT XLS</button>
          </div>
          <div onDragOver={e=>{e.preventDefault();setDropFixed(true)}} onDragLeave={()=>setDropFixed(false)} onDrop={e=>handleDrop(e,false)}>
            {dropFixed ? <div style={S.dropZone(true)}>DROP EXCEL FILE TO IMPORT FIXED LEG SCHEDULE</div> : (
              <>
                {loading && <div style={S.loading}>Loading schedule...</div>}
                {loadErr && <div style={{...S.loading,color:C.red}}>{loadErr}</div>}
                {!loading && (
                  <table style={S.tbl}>
                    <thead><tr>
                      <th style={{...S.th,width:'19%'}}>ACCR START</th>
                      <th style={{...S.th,width:'19%'}}>ACCR END</th>
                      <th style={{...S.th,width:'19%'}}>PAY DATE</th>
                      <th style={{...S.th,width:'20%'}}>NOTIONAL</th>
                      <th style={{...S.th,width:'17%'}}>COUPON %</th>
                      <th style={{...S.th,width:'6%'}}></th>
                    </tr></thead>
                    <tbody>
                      {fixedRows.length===0&&<tr><td colSpan={6} style={S.td}><div style={S.emptyRow}>Price the trade first or drag/paste a schedule.</div></td></tr>}
                      {fixedRows.map((row,i)=>(
                        <tr key={i}>
                          <td style={S.td}><div style={S.cellRo}>{row.period_start}</div></td>
                          <td style={S.td}><div style={S.cellRo}>{row.period_end}</div></td>
                          <td style={S.td}><div style={S.cellRo}>{row.payment_date}</div></td>
                          <td style={S.td}><EditCell value={row.notional} original={row.orig_notional} placeholder='10000000' onChange={v=>updateFixed(i,'notional',v)}/></td>
                          <td style={S.td}><EditCell value={row.rate} original={row.orig_rate} placeholder='3.500' onChange={v=>updateFixed(i,'rate',v)}/></td>
                          <td style={{...S.td,textAlign:'center'}}><button style={S.del} onClick={()=>setFixedRows(p=>p.filter((_,j)=>j!==i))}>x</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {hasFixedOverrides && <div style={S.hintBox}>Amber = overridden from par. Hit PRICE to reprice, or RESET TO PAR to revert.</div>}
              </>
            )}
          </div>
          <div style={S.divider}/>
          {(inst === 'IR_SWAP' || inst === 'IR_SWAPTION') && (
            <CustomCashflowsEditor
              ccy={ccy}
              rows={customCashflowsFixed}
              setRows={setCustomCashflowsFixed}
            />
          )}
        </div>

        {/* FLOAT LEG */}
        <div style={S.panel}>
          <div style={S.panelHdr}>
            {struct === 'BASIS' ? 'FLOAT LEG 2' : 'FLOAT LEG'}
            <span style={S.badge(floatDir==='PAY')}>{struct === 'BASIS' ? (dir==='PAY'?'RECEIVE LEG 2':'PAY LEG 2') : (floatDir==='PAY'?'PAY FLOAT':'RECEIVE FLOAT')}</span>
            {hasFloatOverrides && (
              <button onClick={resetFloat} style={{marginLeft:'auto', fontSize:'10px', color:C.amber, background:'rgba(245,200,66,0.06)', border:'1px solid rgba(245,200,66,0.3)', borderRadius:'2px', padding:'2px 8px', cursor:'pointer', fontFamily:"'IBM Plex Sans',sans-serif", letterSpacing:'0.04em'}}>
                RESET TO PAR
              </button>
            )}
          </div>
          <div style={S.divider}/>
          <div style={S.secTitle}>PERIOD SCHEDULE</div>
          <div style={S.secHint}>Edit SPREAD BP per period or NOTIONAL for amortizing. Amber = overridden. Hit PRICE to reprice.</div>
          <div style={S.toolbar}>
            <button style={S.toolBtn()} onClick={forceReload}>REFRESH</button>
            <button style={S.toolBtn()} onClick={handlePasteFloat}>PASTE</button>
            <button style={S.toolBtn(C.blue)} onClick={handleExport}>EXPORT XLS</button>
            <button style={S.toolBtn(C.blue)} onClick={()=>{fileTarget.current='float';fileInputRef.current?.click()}}>IMPORT XLS</button>
          </div>
          <div onDragOver={e=>{e.preventDefault();setDropFloat(true)}} onDragLeave={()=>setDropFloat(false)} onDrop={e=>handleDrop(e,true)}>
            {dropFloat ? <div style={S.dropZone(true)}>DROP EXCEL FILE TO IMPORT FLOAT LEG SCHEDULE</div> : (
              <>
                {loading && <div style={S.loading}>Loading schedule...</div>}
                {!loading && (
                  <table style={S.tbl}>
                    <thead><tr>
                      <th style={{...S.th,width:'19%'}}>ACCR START</th>
                      <th style={{...S.th,width:'19%'}}>ACCR END</th>
                      <th style={{...S.th,width:'19%'}}>PAY DATE</th>
                      <th style={{...S.th,width:'17%'}}>NOTIONAL</th>
                      <th style={{...S.th,width:'13%'}}>INDEX</th>
                      <th style={{...S.th,width:'10%'}}>SPRD BP</th>
                      <th style={{...S.th,width:'3%'}}></th>
                    </tr></thead>
                    <tbody>
                      {floatRows.length===0&&<tr><td colSpan={7} style={S.td}><div style={S.emptyRow}>Price the trade first or drag/paste a schedule.</div></td></tr>}
                      {floatRows.map((row,i)=>(
                        <tr key={i}>
                          <td style={S.td}><div style={S.cellRo}>{row.period_start}</div></td>
                          <td style={S.td}><div style={S.cellRo}>{row.period_end}</div></td>
                          <td style={S.td}><div style={S.cellRo}>{row.payment_date}</div></td>
                          <td style={S.td}><EditCell value={row.notional} original={row.orig_notional} placeholder='10000000' onChange={v=>updateFloat(i,'notional',v)}/></td>
                          <td style={S.td}><div style={S.cellRo}>{index}</div></td>
                          <td style={S.td}><EditCell value={row.spread_bps} original={row.orig_spread_bps} placeholder='0' onChange={v=>updateFloat(i,'spread_bps',v)}/></td>
                          <td style={{...S.td,textAlign:'center'}}><button style={S.del} onClick={()=>setFloatRows(p=>p.filter((_,j)=>j!==i))}>x</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {hasFloatOverrides && <div style={S.hintBox}>Amber = overridden from par. Hit PRICE to reprice, or RESET TO PAR to revert.</div>}
              </>
            )}
          </div>
          <div style={S.divider}/>
          {/* ── OPTION FEE SCHEDULE ── shown for IR_SWAPTION ─────────── */}
          {inst === 'IR_SWAPTION' && (
            <div style={{padding:'10px 14px'}}>
              <div style={{fontSize:'0.75rem',fontWeight:700,letterSpacing:'0.12em',
                color:'var(--text-dim)',marginBottom:'8px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                OPTION FEE SCHEDULE
                <span style={{fontSize:'0.6875rem',fontWeight:400,color:'var(--text-dim)',opacity:0.6}}>
                  {exerciseType} · {feeAmount?(feeAmountType==='BP'?`${feeAmount}bp`:`$${parseFloat(feeAmount||0).toLocaleString()}`):'no upfront premium'}
                  {feeSettleDate?` · settle ${feeSettleDate}`:''}
                </span>
              </div>
              <div style={{border:'1px solid var(--border)',borderRadius:'2px',overflow:'hidden'}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 80px 32px',gap:'1px',background:'var(--border)'}}>
                  {['PAY DATE','AMOUNT','UNIT',''].map(h=>(
                    <div key={h} style={{background:'var(--panel)',padding:'5px 8px',fontSize:'0.6875rem',
                      fontWeight:700,letterSpacing:'0.08em',color:'var(--text-dim)'}}>{h}</div>
                  ))}
                  {feeAmount && feeSettleDate && (
                    <>
                      <div style={{background:'rgba(245,200,66,0.04)',padding:'5px 8px',fontSize:'0.875rem',fontFamily:"'IBM Plex Mono',monospace",color:'var(--amber)'}}>{feeSettleDate}</div>
                      <div style={{background:'rgba(245,200,66,0.04)',padding:'5px 8px',fontSize:'0.875rem',fontFamily:"'IBM Plex Mono',monospace",color:'var(--amber)'}}>{feeAmount}</div>
                      <div style={{background:'rgba(245,200,66,0.04)',padding:'5px 8px',fontSize:'0.875rem',color:'var(--text-dim)'}}>{feeAmountType}</div>
                      <div style={{background:'rgba(245,200,66,0.04)',padding:'5px 8px',fontSize:'0.6875rem',color:'var(--text-dim)',display:'flex',alignItems:'center',justifyContent:'center'}}>UPFRT</div>
                    </>
                  )}
                  {(feeSchedule||[]).map((row,i)=>(
                    <>
                      <div style={{background:'var(--bg)',padding:'3px 6px'}}>
                        <input type='date' value={row.date}
                          onChange={e=>setFeeSchedule(s=>s.map((r,j)=>j===i?{...r,date:e.target.value}:r))}
                          style={{width:'100%',background:'transparent',border:'1px solid var(--border)',
                            color:'var(--text)',fontFamily:"'IBM Plex Mono',monospace",fontSize:'0.8125rem',
                            padding:'2px 4px',borderRadius:'2px',outline:'none'}}/>
                      </div>
                      <div style={{background:'var(--bg)',padding:'3px 6px'}}>
                        <input type='text' value={row.amount} placeholder='amount'
                          onChange={e=>setFeeSchedule(s=>s.map((r,j)=>j===i?{...r,amount:e.target.value}:r))}
                          style={{width:'100%',background:'transparent',border:'1px solid var(--border)',
                            color:'var(--text)',fontFamily:"'IBM Plex Mono',monospace",fontSize:'0.8125rem',
                            padding:'2px 4px',borderRadius:'2px',outline:'none'}}/>
                      </div>
                      <div style={{background:'var(--bg)',padding:'5px 8px',fontSize:'0.875rem',color:'var(--text-dim)'}}>{feeAmountType}</div>
                      <div style={{background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <button onClick={()=>setFeeSchedule(s=>s.filter((_,j)=>j!==i))}
                          style={{background:'transparent',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:'1rem',lineHeight:1}}>×</button>
                      </div>
                    </>
                  ))}
                  <div style={{gridColumn:'1/-1',background:'var(--panel)',padding:'4px 8px',borderTop:'1px solid var(--border)'}}>
                    <button onClick={()=>setFeeSchedule(s=>[...(s||[]),{date:'',amount:''}])}
                      style={{background:'transparent',border:'none',color:'var(--accent)',cursor:'pointer',
                        fontSize:'0.75rem',fontWeight:700,letterSpacing:'0.08em',fontFamily:"'IBM Plex Mono',monospace",padding:'0'}}>
                      + ADD PAYMENT DATE
                    </button>
                  </div>
                </div>
              </div>
              <div style={{fontSize:'0.6875rem',color:'var(--text-dim)',marginTop:'4px',opacity:0.6}}>
                Upfront from TRADE tab · Additional rows for deferred / instalment / Bermudan contingent fees
              </div>
            </div>
          )}
          <div style={S.divider}/>
          {(inst === 'IR_SWAP' || inst === 'IR_SWAPTION') && (
            <CustomCashflowsEditor
              ccy={ccy}
              rows={customCashflowsFloat}
              setRows={setCustomCashflowsFloat}
            />
          )}
        </div>

      </div>
    </div>
  )
}

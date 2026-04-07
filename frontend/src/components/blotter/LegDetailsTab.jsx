import { useState, useEffect, useRef } from 'react'

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

const C = {
  accent:'#00D4A8', red:'#FF6B6B', blue:'#4A9EFF',
  amber:'#F5C842', panel:'#0C0C0C', panel2:'#141414',
  border:'#1E1E1E', text:'#F0F0F0', muted:'#666', dim:'#444',
}

const S = {
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
  toolBtn:(color)=>({ fontSize:'10px', color:color||C.accent, background:color?'rgba(74,158,255,0.08)':'rgba(0,212,168,0.08)', border:'1px solid '+(color?'rgba(74,158,255,0.25)':'rgba(0,212,168,0.2)'), borderRadius:'2px', padding:'3px 10px', cursor:'pointer', fontFamily:"'IBM Plex Sans',sans-serif", letterSpacing:'0.04em' }),
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

async function exportToExcel(fixedRows, floatRows, tradeRef='TRADE', dir='PAY', floatDir='RECEIVE', ccy='USD', index='SOFR') {
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
    const fc=footer.getCell(1); fc.value='Generated by Rijeka — open-source derivatives pricing & risk platform — rijeka.app'; fc.font=font(DIM,{size:8}); fc.fill=fill(BG_BLACK); fc.border=border
    for(let i=2;i<=26;i++){const c=footer.getCell(i);c.fill=fill(BG_BLACK);c.border=border}
  }

  const fixedCols=[{label:'ACCRUAL START',width:14,align:'left'},{label:'ACCRUAL END',width:14,align:'left'},{label:'PAY DATE',width:14,align:'left'},{label:'NOTIONAL',width:16,align:'right'},{label:'COUPON %',width:12,align:'right'},{label:'DIRECTION',width:12,align:'left'}]
  const fixedData=fixedRows.map(r=>[{v:r.period_start},{v:r.period_end},{v:r.payment_date},{v:parseFloat(r.notional)||0,fmt:'#,##0',align:'right',color:dir==='PAY'?RED:TEAL},{v:parseFloat(r.rate)||0,fmt:'0.000000',align:'right',color:String(r.rate)!==String(r.orig_rate)?AMBER:WHITE},{v:dir==='PAY'?'PAY':'RECEIVE',color:dir==='PAY'?RED:TEAL}])
  buildSheet(wb,'FIXED LEG',fixedCols,fixedData,{label:'FIXED LEG  ·  '+ccy+'  ·  '+(dir==='PAY'?'PAY FIXED':'RECEIVE FIXED'),direction:(dir==='PAY'?'PAY FIXED':'RECEIVE FIXED')+' · '+ccy})

  const floatCols=[{label:'ACCRUAL START',width:14,align:'left'},{label:'ACCRUAL END',width:14,align:'left'},{label:'PAY DATE',width:14,align:'left'},{label:'NOTIONAL',width:16,align:'right'},{label:'INDEX',width:12,align:'left'},{label:'SPREAD BP',width:12,align:'right'},{label:'DIRECTION',width:12,align:'left'}]
  const floatData=floatRows.map(r=>[{v:r.period_start},{v:r.period_end},{v:r.payment_date},{v:parseFloat(r.notional)||0,fmt:'#,##0',align:'right',color:floatDir==='PAY'?RED:TEAL},{v:index,color:TEAL},{v:parseFloat(r.spread_bps)||0,fmt:'0.00',align:'right',color:String(r.spread_bps)!==String(r.orig_spread_bps)?AMBER:WHITE},{v:floatDir==='PAY'?'PAY':'RECEIVE',color:floatDir==='PAY'?RED:TEAL}])
  buildSheet(wb,'FLOAT LEG',floatCols,floatData,{label:'FLOAT LEG  ·  '+ccy+'  ·  '+index,direction:(floatDir==='PAY'?'PAY FLOAT':'RECEIVE FLOAT')+' · '+ccy+' · '+index})

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
    reader.onload=e=>{ const wb=XLSX.read(e.target.result,{type:'binary'}); const fixed=wb.Sheets['Fixed Leg']?XLSX.utils.sheet_to_json(wb.Sheets['Fixed Leg']):[]; const float=wb.Sheets['Float Leg']?XLSX.utils.sheet_to_json(wb.Sheets['Float Leg']):[]; resolve({fixed,float}) }
    reader.onerror=reject; reader.readAsBinaryString(file)
  })
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
      const legs = [
        { leg_ref:'FIXED-1', leg_seq:1, leg_type:zcToggle?'ZERO_COUPON':'FIXED', direction:dir, currency:ccy, notional, effective_date:effDate, maturity_date:matDate, day_count:fixedDc, payment_frequency:zcToggle?'ZERO_COUPON':fixedPayFreq, bdc:fixedBdc, payment_lag:payLag, fixed_rate:fixedRate, discount_curve_id:curveId, forecast_curve_id:null, ois_compounding:null },
        { leg_ref:'FLOAT-1', leg_seq:2, leg_type:'FLOAT', direction:dir==='PAY'?'RECEIVE':'PAY', currency:ccy, notional, effective_date:effDate, maturity_date:matDate, day_count:floatDc, payment_frequency:floatPayFreq, reset_frequency:isOIS?'DAILY':floatResetFreq, bdc:floatBdc, payment_lag:payLag, fixed_rate:0, spread, leverage:1.0, discount_curve_id:curveId, forecast_curve_id:forecastId, ois_compounding:isOIS?'COMPOUNDING':null },
      ]
      const res = await fetch(API+'/price/preview', { method:'POST', headers:h, body:JSON.stringify({legs, valuation_date:valDate||new Date().toISOString().slice(0,10), curves:[{curve_id:curveId,quotes:[]}]}) })
      if (!res.ok) { setLoadErr('Price the trade first to load schedule.'); return }
      const data = await res.json()
      const fixedLeg = data.legs?.find(l=>l.leg_type==='FIXED'||l.leg_type==='ZERO_COUPON')
      const floatLeg = data.legs?.find(l=>l.leg_type==='FLOAT')
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
  const handleExport = () => exportToExcel(fixedRows, floatRows, 'TRADE', dir, floatDir, ccy, index)
  const handleFileImport = async (file) => {
    if (!file) return
    try {
      const {fixed,float} = await parseExcelFile(file)
      if (fixed.length) setFixedRows(fixed.map(r=>({ period_start:r['ACCRUAL START']||'', period_end:r['ACCRUAL END']||'', payment_date:r['PAY DATE']||'', notional:String(r['NOTIONAL']||''), rate:String(r['COUPON %']||'0'), orig_notional:String(r['NOTIONAL']||''), orig_rate:String(r['COUPON %']||'0') })))
      if (float.length) setFloatRows(float.map(r=>({ period_start:r['ACCRUAL START']||'', period_end:r['ACCRUAL END']||'', payment_date:r['PAY DATE']||'', notional:String(r['NOTIONAL']||''), spread_bps:String(r['SPREAD BP']||'0'), orig_notional:String(r['NOTIONAL']||''), orig_spread_bps:String(r['SPREAD BP']||'0') })))
    } catch(e) { alert('Import failed: '+e.message) }
  }
  const handleDrop = async (e, isFloat) => { e.preventDefault(); isFloat?setDropFloat(false):setDropFixed(false); const file=e.dataTransfer.files[0]; if(file)await handleFileImport(file) }

  const forceReload = () => { prevKey.current=''; loadSchedule() }

  return (
    <div className='tbw-no-drag' style={S.root}>
      <div style={S.banner}>
        <span style={S.structLbl}>DERIVED STRUCTURE</span>
        <span style={S.structVal}>{structLabel}</span>
        <div style={S.zcWrap} onClick={()=>setZcToggle(v=>!v)}>
          <div style={S.zcBox(zcToggle)}>{zcToggle?'✓':''}</div>
          ZERO COUPON
        </div>
      </div>
      <div style={S.grid}>
        <div style={S.panel}>
          <div style={S.panelHdr}>FIXED LEG <span style={S.badge(dir==='PAY')}>{dir==='PAY'?'PAY FIXED':'RECEIVE FIXED'}</span></div>
          <div style={S.divider}/>
          <div style={S.secTitle}>PERIOD SCHEDULE</div>
          <div style={S.secHint}>Accrual dates auto-generated. Edit COUPON or NOTIONAL — amber = overridden.</div>
          <div style={S.toolbar}>
            <button style={S.toolBtn()} onClick={forceReload}>↺ REFRESH</button>
            <button style={S.toolBtn()} onClick={handlePasteFixed}>⎘ PASTE</button>
            <button style={S.toolBtn(C.blue)} onClick={handleExport}>↓ EXPORT XLS</button>
            <input ref={fileInputRef} type='file' accept='.xlsx,.xls,.csv' style={{display:'none'}} onChange={e=>{handleFileImport(e.target.files[0]);e.target.value=''}} />
            <button style={S.toolBtn(C.blue)} onClick={()=>{fileTarget.current='fixed';fileInputRef.current?.click()}}>↑ IMPORT XLS</button>
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
                          <td style={{...S.td,textAlign:'center'}}><button style={S.del} onClick={()=>setFixedRows(p=>p.filter((_,j)=>j!==i))}>×</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {fixedRows.some(r=>String(r.rate)!==String(r.orig_rate)||String(r.notional)!==String(r.orig_notional))&&<div style={S.hintBox}>Amber = overridden from par. Hit PRICE to reprice.</div>}
              </>
            )}
          </div>
          <div style={S.divider}/>
          <div style={S.coming}>CUSTOM CASHFLOWS — SPRINT 5C</div>
        </div>

        <div style={S.panel}>
          <div style={S.panelHdr}>FLOAT LEG <span style={S.badge(floatDir==='PAY')}>{floatDir==='PAY'?'PAY FLOAT':'RECEIVE FLOAT'}</span></div>
          <div style={S.divider}/>
          <div style={S.secTitle}>PERIOD SCHEDULE</div>
          <div style={S.secHint}>Index resets from curve. Edit SPREAD or NOTIONAL per period.</div>
          <div style={S.toolbar}>
            <button style={S.toolBtn()} onClick={forceReload}>↺ REFRESH</button>
            <button style={S.toolBtn()} onClick={handlePasteFloat}>⎘ PASTE</button>
            <button style={S.toolBtn(C.blue)} onClick={handleExport}>↓ EXPORT XLS</button>
            <button style={S.toolBtn(C.blue)} onClick={()=>{fileTarget.current='float';fileInputRef.current?.click()}}>↑ IMPORT XLS</button>
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
                          <td style={{...S.td,textAlign:'center'}}><button style={S.del} onClick={()=>setFloatRows(p=>p.filter((_,j)=>j!==i))}>×</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
          <div style={S.divider}/>
          <div style={S.coming}>RESET OVERRIDES — SPRINT 5C</div>
          <div style={{...S.coming,marginTop:'4px'}}>CUSTOM CASHFLOWS — SPRINT 5C</div>
        </div>
      </div>
    </div>
  )
}

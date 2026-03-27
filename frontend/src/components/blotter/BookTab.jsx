import { useState, useEffect } from 'react'
import { useTradesStore } from '../../store/useTradesStore'
import { useTabStore } from '../../store/useTabStore'
import './BookTab.css'

const AC = { RATES:{c:'var(--accent)',a:'RTS'}, FX:{c:'var(--blue)',a:'FX'}, CREDIT:{c:'var(--amber)',a:'CRD'}, EQUITY:{c:'var(--purple)',a:'EQT'}, COMMODITY:{c:'var(--red)',a:'CMD'} }
const ST = { PENDING:{c:'var(--amber)',l:'PENDING'}, LIVE:{c:'var(--accent)',l:'LIVE'}, MATURED:{c:'#4a5568',l:'MATURED'}, CANCELLED:{c:'var(--red)',l:'CANCELLED'}, TERMINATED:{c:'var(--red)',l:'TERMINATED'} }
const SR = { WORKING:{c:'var(--accent)',l:'W'}, PRODUCTION:{c:'var(--blue)',l:'P'}, HISTORY:{c:'#4a5568',l:'H'} }
const ASSET_CLASSES = ['RATES','FX','CREDIT','EQUITY','COMMODITY']

function fmt(n) {
  if (!n && n !== 0) return '—'
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtD(d) { return d?d.substring(0,10):'—' }
function tenor(t) {
  if (!t.effective_date||!t.maturity_date) return '—'
  const y=(new Date(t.maturity_date)-new Date(t.effective_date))/(365.25*864e5)
  return y>=1?`${y.toFixed(1)}Y`:`${Math.round(y*12)}M`
}

export default function BookTab() {
  const { trades, loading, error, fetchTrades, filters, setFilter, filteredTrades } = useTradesStore()
  const { openTrade, openNewTrade, openComparison } = useTabStore()
  const [sortCol, setSortCol] = useState('trade_date')
  const [sortDir, setSortDir] = useState('desc')
  const [selected, setSelected] = useState(new Set())

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  useEffect(() => { fetchTrades() }, [])

  const sort = col => { if(sortCol===col) setSortDir(d=>d==='asc'?'desc':'asc'); else{setSortCol(col);setSortDir('asc')} }

  const rows = filteredTrades().slice().sort((a,b) => {
    const av=a[sortCol]??'', bv=b[sortCol]??''
    const c=av<bv?-1:av>bv?1:0
    return sortDir==='asc'?c:-c
  })

  const live=trades.filter(t=>t.status==='LIVE').length
  const pending=trades.filter(t=>t.status==='PENDING').length
  const byCCY={}
  trades.filter(t=>t.status==='LIVE'&&t.notional&&t.notional_ccy).forEach(t=>{
    byCCY[t.notional_ccy]=(byCCY[t.notional_ccy]||0)+Number(t.notional)
  })
  const top=Object.entries(byCCY).sort(([,a],[,b])=>b-a).slice(0,3)

  const selectedTrades = rows.filter(t => selected.has(t.id))

  const TH=({col,label})=>(
    <th className={sortCol===col?'th-sort':''} onClick={()=>sort(col)}>
      {label}{sortCol===col?(sortDir==='asc'?' ↑':' ↓'):''}
    </th>
  )

  return (
    <div className="book-tab">
      <div className="book-header">
        <div className="book-title">
          <h2>TRADE BOOK</h2>
          <span className="book-count">{rows.length} of {trades.length} trades</span>
        </div>
        <div style={{display:'flex',gap:'0.5rem',alignItems:'center'}}>
          {selected.size >= 2 && (
            <button
              onClick={() => { openComparison(rows.filter(t=>selected.has(t.id))); setSelected(new Set()) }}
              style={{background:'var(--blue)',color:'#fff',border:'none',padding:'0.4rem 1rem',fontFamily:'var(--mono)',fontSize:'0.65rem',fontWeight:700,letterSpacing:'0.1em',cursor:'pointer',borderRadius:2}}>
              COMPARE ({selected.size})
            </button>
          )}
          {selected.size > 0 && (
            <button onClick={()=>setSelected(new Set())} style={{background:'transparent',border:'1px solid var(--border)',color:'var(--text-dim)',fontFamily:'var(--mono)',fontSize:'0.62rem',padding:'0.4rem 0.65rem',cursor:'pointer',borderRadius:2}}>
              CLEAR
            </button>
          )}
          <button className="btn-book" onClick={()=>openNewTrade()}>+ NEW TRADE</button>
        </div>
      </div>
      <div className="summary-bar">
        <div className="sum-stat"><span className="sum-val">{trades.length}</span><span className="sum-lbl">TOTAL</span></div>
        <div className="sum-div"/>
        <div className="sum-stat"><span className="sum-val" style={{color:'var(--accent)'}}>{live}</span><span className="sum-lbl">LIVE</span></div>
        <div className="sum-div"/>
        <div className="sum-stat"><span className="sum-val" style={{color:'var(--amber)'}}>{pending}</span><span className="sum-lbl">PENDING</span></div>
        {top.map(([ccy,n])=>[
          <div className="sum-div" key={ccy+'-d'}/>,
          <div className="sum-stat" key={ccy}>
            <span className="sum-val">{fmt(n)}<span className="ccy-label">{ccy}</span></span>
            <span className="sum-lbl">LIVE NOTIONAL</span>
          </div>
        ])}
      </div>
      <div className="book-filters">
        <input className="filter-search" placeholder="Search — ref, counterparty, desk, instrument..."
          value={filters.search} onChange={e=>setFilter('search',e.target.value)}/>
        <div className="chip-row">
          {['ALL','PENDING','LIVE','MATURED','CANCELLED'].map(s=>(
            <button key={s} className={`chip ${filters.status===s?'chip-on':''}`}
              style={filters.status===s&&ST[s]?{borderColor:ST[s].c,color:ST[s].c}:{}}
              onClick={()=>setFilter('status',s)}>{s}</button>
          ))}
          <div style={{width:'1px',background:'var(--border)',margin:'0 0.3rem'}}/>
          {['ALL',...ASSET_CLASSES].map(ac=>(
            <button key={ac} className={`chip ${filters.assetClass===ac?'chip-on':''}`}
              style={filters.assetClass===ac&&AC[ac]?{borderColor:AC[ac].c,color:AC[ac].c}:{}}
              onClick={()=>setFilter('assetClass',ac)}>{ac==='ALL'?'ALL CLASSES':ac}</button>
          ))}
          <div style={{width:'1px',background:'var(--border)',margin:'0 0.3rem'}}/>
          {['ALL','WORKING','PRODUCTION','HISTORY'].map(s=>(
            <button key={s} className={`chip ${filters.store===s?'chip-on':''}`}
              onClick={()=>setFilter('store',s)}>{s==='ALL'?'ALL STORES':s}</button>
          ))}
        </div>
      </div>
      <div className="book-grid">
        {loading&&<div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.7rem',letterSpacing:'0.12em'}}>LOADING...</div>}
        {error&&<div style={{padding:'3rem',textAlign:'center',color:'var(--red)',fontSize:'0.7rem'}}>{error}</div>}
        {!loading&&!error&&(
          <table className="book-table">
            <thead><tr>
              <th style={{width:'36px',padding:'0.5rem 0.5rem 0.5rem 1rem'}}>
                <input type="checkbox"
                  checked={selected.size===rows.length&&rows.length>0}
                  onChange={e=>setSelected(e.target.checked?new Set(rows.map(t=>t.id)):new Set())}
                  style={{cursor:'pointer',accentColor:'var(--accent)'}}/>
              </th>
              <TH col="trade_ref" label="REF"/>
              <th>CLASS</th>
              <TH col="instrument_type" label="INSTRUMENT"/>
              <th>COUNTERPARTY</th>
              <TH col="notional" label="NOTIONAL"/>
              <th>TENOR</th>
              <TH col="trade_date" label="TRADE DATE"/>
              <TH col="maturity_date" label="MATURITY"/>
              <TH col="status" label="STATUS"/>
              <th>STORE</th>
            </tr></thead>
            <tbody>
              {rows.length===0
                ? <tr><td colSpan={10} className="empty-cell">{trades.length===0?'NO TRADES — CLICK + NEW TRADE TO BEGIN':'NO TRADES MATCH FILTERS'}</td></tr>
                : rows.map(t=>{
                  const ac=AC[t.asset_class]||{c:'#fff',a:t.asset_class}
                  const st=ST[t.status]||{c:'#fff',l:t.status}
                  const sr=SR[t.store]||{c:'#fff',l:t.store}
                  return (
                    <tr key={t.id} className={`trade-row ${selected.has(t.id)?'trade-row-selected':''}`}
                      style={{borderLeft:`3px solid ${ac.c}`}}>
                      <td style={{padding:'0.45rem 0.5rem 0.45rem 1rem'}} onClick={e=>e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(t.id)}
                          onChange={()=>toggleSelect(t.id)}
                          style={{cursor:'pointer',accentColor:'var(--accent)'}}/>
                      </td>
                      <td className="td-ref" onClick={()=>openTrade(t)} style={{cursor:'pointer'}}>{t.trade_ref}</td>
                      <td><span className="ac-badge" style={{color:ac.c,borderColor:ac.c+'40'}}>{ac.a}</span></td>
                      <td className="td-dim">{t.instrument_type}</td>
                      <td style={{maxWidth:160,overflow:'hidden',textOverflow:'ellipsis'}}>{t.counterparty?.name||'—'}</td>
                      <td className="td-num">{fmt(t.notional)} <span className="ccy-label">{t.notional_ccy}</span></td>
                      <td className="td-dim">{tenor(t)}</td>
                      <td className="td-dim" style={{fontSize:'0.65rem'}}>{fmtD(t.trade_date)}</td>
                      <td className="td-dim" style={{fontSize:'0.65rem'}}>{fmtD(t.maturity_date)}</td>
                      <td><span className="status-pip" style={{background:st.c}}/><span className="status-txt" style={{color:st.c}}>{st.l}</span></td>
                      <td><span className="store-txt" style={{color:sr.c}}>{sr.l}</span></td>
                    </tr>
                  )
                })
              }
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

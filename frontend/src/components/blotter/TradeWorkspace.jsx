import { useState, useEffect } from 'react'
import { useTradesStore } from '../../store/useTradesStore'
import { useTabStore } from '../../store/useTabStore'
import { supabase } from '../../lib/supabase'
import './TradeWorkspace.css'

const AC_COLOR = { RATES:'var(--accent)', FX:'var(--blue)', CREDIT:'var(--amber)', EQUITY:'var(--purple)', COMMODITY:'var(--red)' }
const ST_COLOR = { PENDING:'var(--amber)', LIVE:'var(--accent)', MATURED:'#4a5568', CANCELLED:'var(--red)', TERMINATED:'var(--red)' }
const SR_COLOR = { WORKING:'var(--accent)', PRODUCTION:'var(--blue)', HISTORY:'#4a5568' }

function fmtN(n, ccy) {
  if (!n && n !== 0) return '—'
  const num = Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return ccy ? `${num} ${ccy}` : num
}
function fmtD(d) { return d?d.substring(0,10):'—' }
function tenor(t) {
  if (!t.effective_date||!t.maturity_date) return '—'
  const y=(new Date(t.maturity_date)-new Date(t.effective_date))/(365.25*864e5)
  return y>=1?`${y.toFixed(1)}Y`:`${Math.round(y*12)}M`
}

function genCFs(legs,eff,mat,overrides={}) {
  if (!eff||!mat) return []
  const FM={MONTHLY:1,QUARTERLY:3,'SEMI-ANNUAL':6,ANNUAL:12,SINGLE:null}
  const all=[]
  legs.forEach((leg,li)=>{
    const legEff=leg.effective_date||eff, legMat=leg.maturity_date||mat
    const m=FM[leg.frequency]
    if (!m) { all.push({id:`${li}-0`,leg:li,label:leg.label,dir:leg.direction,date:legMat,type:'SINGLE',ccy:leg.currency,overridden:false}); return }
    let d=new Date(legEff); d.setMonth(d.getMonth()+m)
    const matD=new Date(legMat); let idx=0
    while(d<=matD) {
      const key=`${li}-${idx}`, ov=overrides[key]
      all.push({id:key,leg:li,label:leg.label,dir:leg.direction,date:d.toISOString().substring(0,10),type:leg.leg_type,amount:ov?.amount??null,ccy:ov?.currency||leg.currency,overridden:!!ov,idx})
      d=new Date(d); d.setMonth(d.getMonth()+m); idx++
    }
  })
  return all.sort((a,b)=>a.date<b.date?-1:1)
}

function OverviewPanel({trade:t}) {
  const ac=t.asset_class, acColor=AC_COLOR[ac]||'var(--text)'
  const terms=t.terms||{}, legs=terms.legs||[]
  const fields=[
    ['TRADE REF',t.trade_ref],['ASSET CLASS',t.asset_class],['INSTRUMENT',t.instrument_type],
    ['STATUS',t.status],['STORE',t.store],['COUNTERPARTY',t.counterparty?.name||'—'],
    ['OWN ENTITY',t.own_entity?.short_name||'—'],['NOTIONAL',fmtN(t.notional, t.notional_ccy)],
    ['CURRENCY',t.notional_ccy],['TENOR',tenor(t)],
    ['TRADE DATE',fmtD(t.trade_date)],['EFFECTIVE DATE',fmtD(t.effective_date)],
    ['MATURITY DATE',fmtD(t.maturity_date)],['DESK',t.desk||'—'],['BOOK',t.book||'—'],['LEGS',legs.length||'—'],
  ]
  return (
    <div>
      <div className="ov-grid">
        {fields.map(([l,v])=>(
          <div className="ov-block" key={l}>
            <div className="ov-label">{l}</div>
            <div className="ov-val-sm" style={l==='ASSET CLASS'?{color:acColor}:l==='STATUS'?{color:ST_COLOR[v]||'var(--text)'}:{}}>{v}</div>
          </div>
        ))}
      </div>
      {terms.structure&&(
        <div style={{padding:'1rem 1.25rem',borderBottom:'1px solid var(--border)'}}>
          <div style={{fontSize:'0.6rem',fontWeight:700,letterSpacing:'0.14em',color:'var(--text-dim)',marginBottom:'0.5rem'}}>STRUCTURE</div>
          <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap'}}>
            <span style={{fontSize:'0.65rem',color:'var(--text)',fontWeight:600}}>{terms.structure}</span>
            {terms.notional_exchange&&<span style={{fontSize:'0.6rem',color:'var(--blue)',border:'1px solid var(--blue)',padding:'0.1rem 0.4rem',borderRadius:2}}>NOTIONAL EXCHANGE</span>}
            {terms.instrument_modifier&&<span style={{fontSize:'0.6rem',color:'var(--amber)',border:'1px solid var(--amber)',padding:'0.1rem 0.4rem',borderRadius:2}}>{terms.instrument_modifier}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function LegsPanel({trade:t}) {
  const legs=t.terms?.legs||[]
  if (!legs.length) return <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.7rem',letterSpacing:'0.1em'}}>NO LEG DATA</div>
  const SKIP=['leg_id','label','leg_type','direction','currency','notional_type','notional_schedule','rate_schedule','spread_schedule']
  const fmtKey=k=>k.replace(/_/g,' ').toUpperCase()
  const fmtVal=v=>{ if(v===null||v===undefined||v==='') return '—'; if(typeof v==='boolean') return v?'YES':'NO'; if(Array.isArray(v)) return v.length?`${v.length} entries`:'—'; return String(v) }
  return (
    <div className="legs-view">
      {legs.map((leg,i)=>{
        const dc=leg.direction==='PAY'?'var(--red)':'var(--accent)'
        const fields=Object.entries(leg).filter(([k])=>!SKIP.includes(k))
        return (
          <div className="leg-summary-card" key={i}>
            <div className="leg-summary-hdr">
              <span style={{fontSize:'0.6rem',fontWeight:700,letterSpacing:'0.1em',padding:'0.12rem 0.4rem',border:`1px solid ${dc}60`,borderRadius:2,color:dc}}>{leg.direction}</span>
              <span style={{fontSize:'0.72rem',fontWeight:700,letterSpacing:'0.06em',color:'var(--text)'}}>{leg.label}</span>
              <span style={{fontSize:'0.65rem',color:'var(--text-dim)',marginLeft:'auto'}}>{leg.leg_type}</span>
              <span style={{fontSize:'0.65rem',color:'var(--text-dim)'}}>{leg.currency}</span>
            </div>
            <div className="leg-summary-body">
              <div className="leg-fields-grid">
                {fields.map(([k,v])=>(
                  <div className="lf" key={k}><span className="ll">{fmtKey(k)}</span><span className="lv">{fmtVal(v)}</span></div>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CashflowsPanel({trade:t,onOverride}) {
  const legs=t.terms?.legs||[], overrides=t.terms?.cashflow_overrides||{}
  const [filterLeg,setFilterLeg]=useState('ALL')
  const [editId,setEditId]=useState(null)
  const [editVal,setEditVal]=useState('')
  const cfs=genCFs(legs,t.effective_date,t.maturity_date,overrides)
  const displayed=filterLeg==='ALL'?cfs:cfs.filter(c=>String(c.leg)===String(filterLeg))
  const overrideCount=Object.keys(overrides).length

  const saveEdit=(cf)=>{
    const newOv={...overrides}
    if(editVal==='') { delete newOv[cf.id] } else { newOv[cf.id]={amount:parseFloat(editVal),currency:cf.ccy,modified_by:'user',modified_at:new Date().toISOString()} }
    const newMod=Object.keys(newOv).length>0?(t.terms?.structure?t.terms.structure+' [MODIFIED]':'CUSTOM'):null
    onOverride(newOv,newMod); setEditId(null)
  }

  return (
    <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
      <div className="cf-tab-bar">
        {['ALL',...legs.map((_,i)=>String(i))].map(f=>(
          <button key={f} className={`chip-s ${filterLeg===f?'chip-s-on':''}`} onClick={()=>setFilterLeg(f)}>
            {f==='ALL'?'ALL LEGS':`LEG ${parseInt(f)+1}: ${legs[parseInt(f)]?.label||f}`}
          </button>
        ))}
        {overrideCount>0&&<span style={{marginLeft:'auto',fontSize:'0.62rem',color:'var(--amber)',fontWeight:700}}>{overrideCount} OVERRIDE{overrideCount!==1?'S':''}</span>}
      </div>
      <div className="cf-legend">
        <span style={{color:'var(--red)',fontWeight:700,fontSize:'0.65rem'}}>PAY</span>
        <span style={{color:'var(--accent)',fontWeight:700,fontSize:'0.65rem'}}>RECEIVE</span>
        <span style={{fontSize:'0.62rem',color:'var(--text-dim)'}}>● OVERRIDDEN — click amount to edit</span>
        <span style={{fontSize:'0.62rem',color:'var(--text-dim)',marginLeft:'auto'}}>{displayed.length} cashflows</span>
      </div>
      <div style={{flex:1,overflow:'auto'}}>
        {cfs.length===0
          ? <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.68rem',letterSpacing:'0.1em'}}>NO CASHFLOWS — ADD LEGS WITH DATES</div>
          : <table className="cf-tbl">
              <thead><tr><th>DATE</th><th>LEG</th><th>DIR</th><th>TYPE</th><th>CCY</th><th>AMOUNT</th><th/></tr></thead>
              <tbody>
                {displayed.map(cf=>(
                  <tr key={cf.id} className={cf.overridden?'cf-row-overridden':''}>
                    <td>{cf.date}</td>
                    <td style={{color:'var(--text-dim)',fontSize:'0.62rem'}}>{cf.label}</td>
                    <td><span style={{color:cf.dir==='PAY'?'var(--red)':'var(--accent)',fontWeight:700,fontSize:'0.62rem'}}>{cf.dir}</span></td>
                    <td style={{color:'var(--text-dim)',fontSize:'0.62rem'}}>{cf.type}</td>
                    <td style={{color:'var(--text-dim)'}}>{cf.ccy}</td>
                    <td style={{textAlign:'right',cursor:'pointer'}} onClick={()=>{setEditId(cf.id);setEditVal(cf.amount??'')}}>
                      {editId===cf.id
                        ? <input autoFocus style={{background:'var(--bg)',border:'1px solid var(--accent)',color:'var(--text)',fontFamily:'var(--mono)',fontSize:'0.7rem',padding:'0.15rem 0.3rem',width:120,borderRadius:2,textAlign:'right'}}
                            value={editVal} onChange={e=>setEditVal(e.target.value)}
                            onBlur={()=>saveEdit(cf)} onKeyDown={e=>{if(e.key==='Enter')saveEdit(cf);if(e.key==='Escape')setEditId(null)}}/>
                        : <span style={{color:cf.overridden?'var(--amber)':'var(--text-dim)',fontSize:'0.68rem',fontWeight:cf.overridden?700:400}}>
                            {cf.amount!==null?cf.amount.toLocaleString():'SPRINT 3'}
                            {cf.overridden&&<span className="cf-override-badge">OVERRIDE</span>}
                          </span>
                      }
                    </td>
                    <td><button className="cf-edit-btn" onClick={()=>{setEditId(cf.id);setEditVal(cf.amount??'')}}>✎</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>
    </div>
  )
}

function StubPanel({title,sprint,desc,blocks}) {
  return (
    <div className="stub-panel">
      <div className="stub-title">{title}</div>
      <div className="stub-badge">{sprint}</div>
      <p style={{fontSize:'0.65rem',color:'var(--text-dim)',letterSpacing:'0.04em',marginBottom:'1.5rem'}}>{desc}</p>
      <div className="stub-grid">
        {blocks.map(b=>(
          <div className="stub-block" key={b.label}>
            <div className="stub-block-label">{b.label}</div>
            <div className="stub-block-val">—</div>
            <div className="stub-block-sub">{b.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}


function EditPanel({ trade, onSave, onClose }) {
  const [desks, setDesks] = useState([])
  const [books, setBooks] = useState([])
  const [filteredBooks, setFilteredBooks] = useState([])
  const [deskId, setDeskId] = useState('')
  const [bookId, setBookId] = useState('')
  const [store, setStore] = useState(trade.store || 'WORKING')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('org_nodes').select('*').eq('is_active', true).order('sort_order').then(({data}) => {
      const nodes = data || []
      const d = nodes.filter(n => n.node_type === 'desk')
      const b = nodes.filter(n => n.node_type === 'book')
      setDesks(d)
      setBooks(b)
      // Pre-select current desk and book if they match
      const currentDesk = d.find(x => x.name === trade.desk)
      if (currentDesk) {
        setDeskId(currentDesk.id)
        const fb = b.filter(x => x.parent_id === currentDesk.id)
        setFilteredBooks(fb)
        const currentBook = fb.find(x => x.name === trade.book)
        if (currentBook) setBookId(currentBook.id)
      } else {
        setFilteredBooks(b)
      }
    })
  }, [])

  const submit = async () => {
    setBusy(true); setErr('')
    const desk = desks.find(d => d.id === deskId)
    const book = books.find(b => b.id === bookId)
    const updates = {
      store,
      desk: desk?.name || trade.desk || null,
      book: book?.name || trade.book || null,
    }
    const { error } = await supabase.from('trades').update(updates).eq('id', trade.id)
    if (error) { setErr(error.message); setBusy(false); return }
    onSave({ ...trade, ...updates })
    setBusy(false)
    onClose()
  }

  const fg = { display:'flex', flexDirection:'column', gap:'0.2rem' }
  const lbl = { fontSize:'0.58rem', fontWeight:600, letterSpacing:'0.1em', color:'var(--text-dim)' }
  const inp = { background:'var(--panel-2)', border:'1px solid var(--border)', color:'var(--text)', fontFamily:'var(--mono)', fontSize:'0.7rem', padding:'0.3rem 0.5rem', borderRadius:'2px', outline:'none', width:'100%', boxSizing:'border-box' }

  return (
    <div style={{
      position:'absolute', top:0, right:0, bottom:0,
      width:'320px', background:'var(--panel)',
      borderLeft:'1px solid var(--border)',
      display:'flex', flexDirection:'column',
      zIndex:10, boxShadow:'-4px 0 20px rgba(0,0,0,0.4)',
    }}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'1rem 1.25rem',borderBottom:'1px solid var(--border)',background:'var(--panel-2)',flexShrink:0}}>
        <span style={{fontFamily:'var(--mono)',fontSize:'0.72rem',fontWeight:700,letterSpacing:'0.12em',color:'var(--accent)'}}>EDIT PORTFOLIO</span>
        <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:'0.9rem'}}>✕</button>
      </div>

      <div style={{flex:1,overflow:'auto',padding:'1rem 1.25rem',display:'flex',flexDirection:'column',gap:'0.75rem'}}>
        <div style={{fontSize:'0.6rem',color:'var(--text-dim)',letterSpacing:'0.08em',lineHeight:1.6,padding:'0.5rem',background:'var(--bg-deep)',borderRadius:2,border:'1px solid var(--border)'}}>
          Portfolio fields only — desk, book, store.<br/>
          Economic amendments (notional, rate, dates) available Sprint 4.
        </div>

        <div style={fg}>
          <label style={lbl}>STORE</label>
          <select value={store} onChange={e=>setStore(e.target.value)} style={inp}>
            <option value="WORKING">WORKING</option>
            <option value="PRODUCTION">PRODUCTION</option>
            <option value="HISTORY">HISTORY</option>
          </select>
        </div>

        <div style={fg}>
          <label style={lbl}>DESK</label>
          <select value={deskId} onChange={e=>{
            const id=e.target.value
            setDeskId(id)
            const fb=books.filter(b=>b.parent_id===id)
            setFilteredBooks(fb)
            setBookId('')
          }} style={inp}>
            <option value="">— select desk —</option>
            {desks.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        <div style={fg}>
          <label style={lbl}>BOOK</label>
          <select value={bookId} onChange={e=>setBookId(e.target.value)} style={inp} disabled={!deskId}>
            <option value="">{deskId?'— select book —':'— select desk first —'}</option>
            {filteredBooks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        {err && <div style={{fontSize:'0.68rem',color:'var(--red)',padding:'0.35rem 0.6rem',background:'color-mix(in srgb,var(--red) 8%,transparent)',border:'1px solid color-mix(in srgb,var(--red) 30%,transparent)',borderRadius:2}}>{err}</div>}
      </div>

      <div style={{display:'flex',gap:'0.6rem',padding:'1rem 1.25rem',borderTop:'1px solid var(--border)',background:'var(--panel-2)',flexShrink:0}}>
        <button onClick={onClose} style={{flex:1,background:'transparent',border:'1px solid var(--border)',color:'var(--text-dim)',fontFamily:'var(--mono)',fontSize:'0.65rem',fontWeight:600,letterSpacing:'0.08em',padding:'0.5rem',borderRadius:2,cursor:'pointer'}}>CANCEL</button>
        <button onClick={submit} disabled={busy} style={{flex:2,background:'var(--accent)',border:'none',color:'var(--bg-deep)',fontFamily:'var(--mono)',fontSize:'0.7rem',fontWeight:700,letterSpacing:'0.08em',padding:'0.5rem',borderRadius:2,cursor:'pointer',opacity:busy?0.6:1}}>
          {busy?'SAVING...':'SAVE CHANGES'}
        </button>
      </div>
    </div>
  )
}
export default function TradeWorkspace({tab}) {
  const {updateTradeStatus,trades}=useTradesStore()
  const {setPanel,refreshTrade}=useTabStore()
  const [busy,setBusy]=useState(false)
  const [editing,setEditing]=useState(false)
  const trade=trades.find(t=>t.id===tab.tradeId)||tab.trade
  const panel=tab.panel||'overview'
  const acColor=AC_COLOR[trade?.asset_class]||'var(--text)'
  const stColor=ST_COLOR[trade?.status]||'var(--text)'
  const srColor=SR_COLOR[trade?.store]||'var(--text)'

  const act=async(status)=>{ setBusy(true); await updateTradeStatus(trade.id,status); setBusy(false) }

  const handleOverride=async(newOv,newMod)=>{
    const newTerms={...trade.terms,cashflow_overrides:newOv,instrument_modifier:newMod}
    const {supabase:sb}=await import('../../lib/supabase')
    await sb.from('trades').update({terms:newTerms}).eq('id',trade.id)
    refreshTrade(trade.id,{...trade,terms:newTerms})
  }

  if (!trade) return <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.7rem'}}>TRADE NOT FOUND</div>

  return (
    <div className="tw">
      <div className="tw-strip">
        <span className="tw-ref">{trade.trade_ref}</span>
        <span className="tw-badge" style={{color:acColor,borderColor:acColor+'50'}}>{trade.asset_class}</span>
        <span className="tw-badge" style={{color:'var(--text-dim)',borderColor:'var(--border)'}}>{trade.instrument_type}</span>
        <span className="tw-badge" style={{color:stColor,borderColor:stColor+'50'}}>{trade.status}</span>
        <span className="tw-badge" style={{color:srColor,borderColor:srColor+'50'}}>{trade.store}</span>
        {trade.counterparty&&<span style={{fontSize:'0.65rem',color:'var(--text-dim)'}}>{trade.counterparty.name}</span>}
        <div className="tw-strip-actions">
          <button className="tw-act" style={{borderColor:'var(--blue)',color:'var(--blue)'}} onClick={()=>setEditing(true)}>EDIT PORTFOLIO</button>
          {trade.status==='PENDING'&&<button className="tw-act tw-act-live" onClick={()=>act('LIVE')} disabled={busy}>ACTIVATE</button>}
          {trade.status==='LIVE'&&<button className="tw-act tw-act-mature" onClick={()=>act('MATURED')} disabled={busy}>MATURE</button>}
          {['PENDING','LIVE'].includes(trade.status)&&<button className="tw-act tw-act-cancel" onClick={()=>act('CANCELLED')} disabled={busy}>CANCEL</button>}
        </div>
      </div>
      <div className="tw-tabs">
        {['OVERVIEW','LEGS','CASHFLOWS','PRICING','XVA'].map(p=>(
          <button key={p} className={`tw-tab ${panel===p.toLowerCase()?'tw-tab-active':''}`} onClick={()=>setPanel(tab.id,p.toLowerCase())}>{p}</button>
        ))}
      </div>
      <div style={{flex:1,overflow:'hidden',position:'relative',display:'flex',flexDirection:'column'}}>
        <div className="tw-content">
          {panel==='overview'  && <OverviewPanel trade={trade}/>}
          {panel==='legs'      && <LegsPanel trade={trade}/>}
          {panel==='cashflows' && <CashflowsPanel trade={trade} onOverride={handleOverride}/>}
          {panel==='pricing'   && <StubPanel title="FULL REVALUATION ENGINE" sprint="SPRINT 3"
              desc={`Curve bootstrap → cashflow discounting → full Greeks. Supports: ${trade.asset_class} — ${trade.instrument_type}`}
              blocks={[{label:'NPV (CLEAN)',sub:'USD'},{label:'NPV (DIRTY)',sub:'USD'},{label:'ACCRUED INT.',sub:'USD'},{label:'PV01',sub:'USD/bp'},{label:'DV01',sub:'USD/bp'},{label:'GAMMA',sub:'USD/bp²'},{label:'VEGA',sub:'USD/%'},{label:'THETA',sub:'USD/day'},{label:'CARRY',sub:'USD/year'}]}/>}
          {panel==='xva'       && <StubPanel title="XVA COST STACK" sprint="SPRINT 3"
              desc={`Counterparty: ${trade.counterparty?.name||'—'} · CSA: ${trade.counterparty?.csa_type||'—'}`}
              blocks={[{label:'CVA',sub:'Credit Valuation Adj.'},{label:'DVA',sub:'Debit Valuation Adj.'},{label:'FVA',sub:'Funding Valuation Adj.'},{label:'MVA',sub:'Margin Valuation Adj.'},{label:'KVA',sub:'Capital Valuation Adj.'},{label:'TOTAL XVA',sub:'All-in cost'}]}/>}
        </div>
        {editing && (
          <EditPanel
            trade={trade}
            onSave={(updated) => {
              // Update tab state
              refreshTrade(trade.id, updated)
              // Update trades store so blotter list also reflects change
              useTradesStore.getState().fetchTrades()
              setEditing(false)
            }}
            onClose={() => setEditing(false)}
          />
        )}
      </div>
    </div>
  )
}

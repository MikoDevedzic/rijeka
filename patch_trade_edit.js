const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';

const twPath = path.join(ROOT, 'components', 'blotter', 'TradeWorkspace.jsx');
let src = fs.readFileSync(twPath, 'utf8');

// ── 1. Add edit panel imports and state ───────────────────────────────────────
src = src.replace(
  `import { useState } from 'react'
import { useTradesStore } from '../../store/useTradesStore'
import { useTabStore } from '../../store/useTabStore'
import './TradeWorkspace.css'`,
  `import { useState, useEffect } from 'react'
import { useTradesStore } from '../../store/useTradesStore'
import { useTabStore } from '../../store/useTabStore'
import { supabase } from '../../lib/supabase'
import './TradeWorkspace.css'`
);

// ── 2. Add EditPanel component before TradeWorkspace export ───────────────────
const editPanel = `
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
`;

src = src.replace(
  `export default function TradeWorkspace({tab}) {`,
  editPanel + `export default function TradeWorkspace({tab}) {`
);

// ── 3. Add editing state to TradeWorkspace ────────────────────────────────────
src = src.replace(
  `  const [busy,setBusy]=useState(false)
  const trade=trades.find(t=>t.id===tab.tradeId)||tab.trade`,
  `  const [busy,setBusy]=useState(false)
  const [editing,setEditing]=useState(false)
  const trade=trades.find(t=>t.id===tab.tradeId)||tab.trade`
);

// ── 4. Add EDIT button to the strip actions ───────────────────────────────────
src = src.replace(
  `        <div className="tw-strip-actions">
          {trade.status==='PENDING'&&<button className="tw-act tw-act-live" onClick={()=>act('LIVE')} disabled={busy}>ACTIVATE</button>}
          {trade.status==='LIVE'&&<button className="tw-act tw-act-mature" onClick={()=>act('MATURED')} disabled={busy}>MATURE</button>}
          {['PENDING','LIVE'].includes(trade.status)&&<button className="tw-act tw-act-cancel" onClick={()=>act('CANCELLED')} disabled={busy}>CANCEL</button>}
        </div>`,
  `        <div className="tw-strip-actions">
          <button className="tw-act" style={{borderColor:'var(--blue)',color:'var(--blue)'}} onClick={()=>setEditing(true)}>EDIT PORTFOLIO</button>
          {trade.status==='PENDING'&&<button className="tw-act tw-act-live" onClick={()=>act('LIVE')} disabled={busy}>ACTIVATE</button>}
          {trade.status==='LIVE'&&<button className="tw-act tw-act-mature" onClick={()=>act('MATURED')} disabled={busy}>MATURE</button>}
          {['PENDING','LIVE'].includes(trade.status)&&<button className="tw-act tw-act-cancel" onClick={()=>act('CANCELLED')} disabled={busy}>CANCEL</button>}
        </div>`
);

// ── 5. Wrap content area with relative positioning + add EditPanel ────────────
src = src.replace(
  `      <div className="tw-content">
        {panel==='overview'  && <OverviewPanel trade={trade}/>}
        {panel==='legs'      && <LegsPanel trade={trade}/>}
        {panel==='cashflows' && <CashflowsPanel trade={trade} onOverride={handleOverride}/>}
        {panel==='pricing'   && <StubPanel title="FULL REVALUATION ENGINE" sprint="SPRINT 3"
            desc={\`Curve bootstrap → cashflow discounting → full Greeks. Supports: \${trade.asset_class} — \${trade.instrument_type}\`}
            blocks={[{label:'NPV (CLEAN)',sub:'USD'},{label:'NPV (DIRTY)',sub:'USD'},{label:'ACCRUED INT.',sub:'USD'},{label:'PV01',sub:'USD/bp'},{label:'DV01',sub:'USD/bp'},{label:'GAMMA',sub:'USD/bp²'},{label:'VEGA',sub:'USD/%'},{label:'THETA',sub:'USD/day'},{label:'CARRY',sub:'USD/year'}]}/>}
        {panel==='xva'       && <StubPanel title="XVA COST STACK" sprint="SPRINT 3"
            desc={\`Counterparty: \${trade.counterparty?.name||'—'} · CSA: \${trade.counterparty?.csa_type||'—'}\`}
            blocks={[{label:'CVA',sub:'Credit Valuation Adj.'},{label:'DVA',sub:'Debit Valuation Adj.'},{label:'FVA',sub:'Funding Valuation Adj.'},{label:'MVA',sub:'Margin Valuation Adj.'},{label:'KVA',sub:'Capital Valuation Adj.'},{label:'TOTAL XVA',sub:'All-in cost'}]}/>}
      </div>`,
  `      <div style={{flex:1,overflow:'hidden',position:'relative',display:'flex',flexDirection:'column'}}>
        <div className="tw-content">
          {panel==='overview'  && <OverviewPanel trade={trade}/>}
          {panel==='legs'      && <LegsPanel trade={trade}/>}
          {panel==='cashflows' && <CashflowsPanel trade={trade} onOverride={handleOverride}/>}
          {panel==='pricing'   && <StubPanel title="FULL REVALUATION ENGINE" sprint="SPRINT 3"
              desc={\`Curve bootstrap → cashflow discounting → full Greeks. Supports: \${trade.asset_class} — \${trade.instrument_type}\`}
              blocks={[{label:'NPV (CLEAN)',sub:'USD'},{label:'NPV (DIRTY)',sub:'USD'},{label:'ACCRUED INT.',sub:'USD'},{label:'PV01',sub:'USD/bp'},{label:'DV01',sub:'USD/bp'},{label:'GAMMA',sub:'USD/bp²'},{label:'VEGA',sub:'USD/%'},{label:'THETA',sub:'USD/day'},{label:'CARRY',sub:'USD/year'}]}/>}
          {panel==='xva'       && <StubPanel title="XVA COST STACK" sprint="SPRINT 3"
              desc={\`Counterparty: \${trade.counterparty?.name||'—'} · CSA: \${trade.counterparty?.csa_type||'—'}\`}
              blocks={[{label:'CVA',sub:'Credit Valuation Adj.'},{label:'DVA',sub:'Debit Valuation Adj.'},{label:'FVA',sub:'Funding Valuation Adj.'},{label:'MVA',sub:'Margin Valuation Adj.'},{label:'KVA',sub:'Capital Valuation Adj.'},{label:'TOTAL XVA',sub:'All-in cost'}]}/>}
        </div>
        {editing && (
          <EditPanel
            trade={trade}
            onSave={(updated) => refreshTrade(trade.id, updated)}
            onClose={() => setEditing(false)}
          />
        )}
      </div>`
);

fs.writeFileSync(twPath, src, 'utf8');
console.log('✅  TradeWorkspace — EDIT PORTFOLIO panel added');
console.log('');
console.log('  Click EDIT PORTFOLIO button on any trade');
console.log('  Slide-in panel: Store / Desk (dropdown) / Book (filtered by desk)');
console.log('  Pre-selects current desk/book if they match org_nodes');
console.log('  Saves directly to Supabase, refreshes tab state');
console.log('  Economic fields locked — amendment workflow Sprint 4');

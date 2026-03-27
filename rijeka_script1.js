const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';
function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log('wrote:', rel);
}

// ── useTabStore.js ────────────────────────────────────────────────────────────
write('store/useTabStore.js', `import { create } from 'zustand'

const BOOK_TAB = { id: 'book', type: 'book', label: 'BOOK', closeable: false, dirty: false }

export const useTabStore = create((set, get) => ({
  tabs: [BOOK_TAB],
  activeId: 'book',

  setActive: (id) => set({ activeId: id }),

  openTrade: (trade) => {
    const tabId = \`trade-\${trade.id}\`
    const existing = get().tabs.find(t => t.id === tabId)
    if (existing) { set({ activeId: tabId }); return }
    const tab = { id: tabId, type: 'trade', label: trade.trade_ref, tradeId: trade.id, trade, closeable: true, dirty: false, panel: 'overview' }
    set(s => ({ tabs: [...s.tabs, tab], activeId: tabId }))
  },

  openNewTrade: (prefill = null) => {
    const id = \`new-\${Date.now()}\`
    const tab = { id, type: 'new', label: '+ NEW TRADE', closeable: true, dirty: false, prefill }
    set(s => ({ tabs: [...s.tabs, tab], activeId: id }))
  },

  closeTab: (id) => {
    const { tabs, activeId } = get()
    if (id === 'book') return
    const idx = tabs.findIndex(t => t.id === id)
    const next = tabs.filter(t => t.id !== id)
    const newActive = activeId === id ? (next[Math.max(0, idx - 1)]?.id || 'book') : activeId
    set({ tabs: next, activeId: newActive })
  },

  setDirty: (id, dirty) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, dirty } : t) })),
  setPanel: (id, panel) => set(s => ({ tabs: s.tabs.map(t => t.id === id ? { ...t, panel } : t) })),

  promoteTrade: (newId, trade) => {
    set(s => ({
      tabs: s.tabs.map(t => t.id === newId
        ? { ...t, id: \`trade-\${trade.id}\`, type: 'trade', label: trade.trade_ref, tradeId: trade.id, trade, dirty: false }
        : t),
      activeId: \`trade-\${trade.id}\`,
    }))
  },

  refreshTrade: (tradeId, trade) =>
    set(s => ({ tabs: s.tabs.map(t => t.tradeId === tradeId ? { ...t, trade } : t) })),
}))
`);

// ── BlotterShell.css ──────────────────────────────────────────────────────────
write('components/blotter/BlotterShell.css', `.blotter-shell { display:flex; flex-direction:column; height:100%; overflow:hidden; background:var(--bg); }

.tab-bar {
  display:flex; align-items:stretch; background:var(--bg-deep);
  border-bottom:1px solid var(--border); overflow-x:auto; overflow-y:hidden;
  flex-shrink:0; scrollbar-width:none; min-height:38px;
}
.tab-bar::-webkit-scrollbar { display:none; }
.tab {
  display:flex; align-items:center; gap:0.5rem; padding:0 1rem;
  min-width:100px; max-width:180px; border-right:1px solid var(--border);
  cursor:pointer; font-family:var(--mono); font-size:0.65rem; font-weight:600;
  letter-spacing:0.08em; color:var(--text-dim); white-space:nowrap;
  transition:all 0.12s; flex-shrink:0;
}
.tab:hover { color:var(--text); background:var(--panel); }
.tab-active { color:var(--accent); background:var(--panel); border-bottom:2px solid var(--accent); }
.tab-active.tab-new { color:var(--amber); border-bottom-color:var(--amber); }
.tab-label { overflow:hidden; text-overflow:ellipsis; flex:1; }
.tab-dirty { width:5px; height:5px; border-radius:50%; background:var(--amber); flex-shrink:0; }
.tab-close { background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:0.65rem; padding:0; line-height:1; flex-shrink:0; opacity:0; transition:opacity 0.12s; }
.tab:hover .tab-close { opacity:1; }
.tab-close:hover { color:var(--red); }
.tab-new-btn { display:flex; align-items:center; padding:0 0.85rem; cursor:pointer; font-family:var(--mono); font-size:0.7rem; color:var(--text-dim); border:none; background:none; letter-spacing:0.05em; flex-shrink:0; transition:color 0.12s; }
.tab-new-btn:hover { color:var(--accent); }
.tab-content { flex:1; overflow:hidden; display:flex; flex-direction:column; }
`);

// ── BlotterShell.jsx ──────────────────────────────────────────────────────────
write('components/blotter/BlotterShell.jsx', `import { useTabStore } from '../../store/useTabStore'
import BookTab from './BookTab'
import TradeWorkspace from './TradeWorkspace'
import NewTradeWorkspace from './NewTradeWorkspace'
import './BlotterShell.css'

function TabBar() {
  const { tabs, activeId, setActive, closeTab, openNewTrade } = useTabStore()
  return (
    <div className="tab-bar">
      {tabs.map(tab => (
        <div key={tab.id}
          className={\`tab \${activeId===tab.id?'tab-active':''} \${tab.type==='new'?'tab-new':''}\`}
          onClick={() => setActive(tab.id)}>
          {tab.dirty && <span className="tab-dirty"/>}
          <span className="tab-label">{tab.label}</span>
          {tab.closeable && (
            <button className="tab-close" onClick={e=>{e.stopPropagation();closeTab(tab.id)}}>✕</button>
          )}
        </div>
      ))}
      <button className="tab-new-btn" onClick={() => openNewTrade()}>＋</button>
    </div>
  )
}

export default function BlotterShell() {
  const { tabs, activeId } = useTabStore()
  const activeTab = tabs.find(t => t.id === activeId)
  return (
    <div className="blotter-shell">
      <TabBar />
      <div className="tab-content">
        {activeTab?.type==='book'  && <BookTab />}
        {activeTab?.type==='trade' && <TradeWorkspace tab={activeTab} />}
        {activeTab?.type==='new'   && <NewTradeWorkspace tab={activeTab} />}
      </div>
    </div>
  )
}
`);

// ── BookTab.css ───────────────────────────────────────────────────────────────
write('components/blotter/BookTab.css', `.book-tab { display:flex; flex-direction:column; height:100%; overflow:hidden; }
.book-header { display:flex; align-items:center; justify-content:space-between; padding:0.85rem 1.5rem; border-bottom:1px solid var(--border); background:var(--panel); flex-shrink:0; }
.book-title { display:flex; align-items:baseline; gap:0.6rem; }
.book-title h2 { font-size:0.85rem; font-weight:700; letter-spacing:0.14em; margin:0; color:var(--text); }
.book-count { font-size:0.65rem; color:var(--text-dim); letter-spacing:0.08em; }
.summary-bar { display:flex; align-items:center; gap:1rem; flex-shrink:0; padding:0.5rem 1.5rem; border-bottom:1px solid var(--border); background:var(--bg-deep); }
.sum-stat { display:flex; flex-direction:column; gap:0.05rem; }
.sum-val { font-size:1rem; font-weight:700; line-height:1; font-family:var(--mono); }
.sum-lbl { font-size:0.58rem; color:var(--text-dim); letter-spacing:0.1em; }
.sum-div { width:1px; height:24px; background:var(--border); }
.book-filters { display:flex; flex-direction:column; gap:0.35rem; padding:0.6rem 1.5rem; border-bottom:1px solid var(--border); background:var(--panel); flex-shrink:0; }
.filter-search { background:var(--panel-2); border:1px solid var(--border); color:var(--text); font-family:var(--mono); font-size:0.7rem; padding:0.35rem 0.65rem; border-radius:2px; width:320px; outline:none; transition:border-color 0.15s; }
.filter-search:focus { border-color:var(--accent); }
.filter-search::placeholder { color:var(--text-dim); }
.chip-row { display:flex; gap:0.3rem; flex-wrap:wrap; }
.chip { background:transparent; border:1px solid var(--border); color:var(--text-dim); font-family:var(--mono); font-size:0.62rem; font-weight:600; letter-spacing:0.08em; padding:0.2rem 0.55rem; border-radius:2px; cursor:pointer; transition:all 0.12s; }
.chip:hover { border-color:var(--text-dim); color:var(--text); }
.chip-on { border-color:var(--accent); color:var(--accent); background:color-mix(in srgb, var(--accent) 8%, transparent); }
.book-grid { flex:1; overflow:auto; }
.book-table { width:100%; border-collapse:collapse; font-size:0.7rem; font-family:var(--mono); }
.book-table thead { position:sticky; top:0; z-index:2; background:var(--panel-2); }
.book-table th { padding:0.5rem 0.85rem; text-align:left; font-size:0.6rem; font-weight:700; letter-spacing:0.1em; color:var(--text-dim); border-bottom:1px solid var(--border); white-space:nowrap; cursor:pointer; user-select:none; }
.book-table th:hover { color:var(--text); }
.th-sort { color:var(--accent); }
.trade-row { border-bottom:1px solid color-mix(in srgb, var(--border) 50%, transparent); cursor:pointer; transition:background 0.1s; }
.trade-row:hover { background:var(--panel-2); }
.trade-row td { padding:0.45rem 0.85rem; white-space:nowrap; color:var(--text); }
.td-ref { font-weight:700; }
.td-dim { color:var(--text-dim) !important; }
.td-num { text-align:right; font-variant-numeric:tabular-nums; }
.ccy-label { font-size:0.62rem; opacity:0.5; margin-left:0.2rem; }
.ac-badge { display:inline-block; padding:0.12rem 0.4rem; border-radius:2px; font-size:0.58rem; font-weight:700; letter-spacing:0.08em; border:1px solid; }
.status-pip { display:inline-block; width:6px; height:6px; border-radius:50%; margin-right:0.35rem; vertical-align:middle; }
.status-txt { font-size:0.62rem; font-weight:700; letter-spacing:0.08em; vertical-align:middle; }
.store-txt { font-size:0.62rem; font-weight:700; letter-spacing:0.1em; }
.empty-cell { text-align:center; padding:4rem !important; color:var(--text-dim); font-size:0.68rem; letter-spacing:0.1em; }
.btn-book { background:var(--accent); color:var(--bg-deep); border:none; padding:0.4rem 1rem; font-family:var(--mono); font-size:0.68rem; font-weight:700; letter-spacing:0.1em; cursor:pointer; border-radius:2px; transition:opacity 0.15s; }
.btn-book:hover { opacity:0.85; }
`);

// ── BookTab.jsx ───────────────────────────────────────────────────────────────
write('components/blotter/BookTab.jsx', `import { useState, useEffect } from 'react'
import { useTradesStore } from '../../store/useTradesStore'
import { useTabStore } from '../../store/useTabStore'
import './BookTab.css'

const AC = { RATES:{c:'var(--accent)',a:'RTS'}, FX:{c:'var(--blue)',a:'FX'}, CREDIT:{c:'var(--amber)',a:'CRD'}, EQUITY:{c:'var(--purple)',a:'EQT'}, COMMODITY:{c:'var(--red)',a:'CMD'} }
const ST = { PENDING:{c:'var(--amber)',l:'PENDING'}, LIVE:{c:'var(--accent)',l:'LIVE'}, MATURED:{c:'#4a5568',l:'MATURED'}, CANCELLED:{c:'var(--red)',l:'CANCELLED'}, TERMINATED:{c:'var(--red)',l:'TERMINATED'} }
const SR = { WORKING:{c:'var(--accent)',l:'W'}, PRODUCTION:{c:'var(--blue)',l:'P'}, HISTORY:{c:'#4a5568',l:'H'} }
const ASSET_CLASSES = ['RATES','FX','CREDIT','EQUITY','COMMODITY']

function fmt(n) {
  if (!n) return '—'
  if (n>=1e9) return \`\${(n/1e9).toFixed(1)}B\`
  if (n>=1e6) return \`\${(n/1e6).toFixed(0)}M\`
  if (n>=1e3) return \`\${(n/1e3).toFixed(0)}K\`
  return String(n)
}
function fmtD(d) { return d?d.substring(0,10):'—' }
function tenor(t) {
  if (!t.effective_date||!t.maturity_date) return '—'
  const y=(new Date(t.maturity_date)-new Date(t.effective_date))/(365.25*864e5)
  return y>=1?\`\${y.toFixed(1)}Y\`:\`\${Math.round(y*12)}M\`
}

export default function BookTab() {
  const { trades, loading, error, fetchTrades, filters, setFilter, filteredTrades } = useTradesStore()
  const { openTrade, openNewTrade } = useTabStore()
  const [sortCol, setSortCol] = useState('trade_date')
  const [sortDir, setSortDir] = useState('desc')

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
        <button className="btn-book" onClick={()=>openNewTrade()}>+ NEW TRADE</button>
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
            <button key={s} className={\`chip \${filters.status===s?'chip-on':''}\`}
              style={filters.status===s&&ST[s]?{borderColor:ST[s].c,color:ST[s].c}:{}}
              onClick={()=>setFilter('status',s)}>{s}</button>
          ))}
          <div style={{width:'1px',background:'var(--border)',margin:'0 0.3rem'}}/>
          {['ALL',...ASSET_CLASSES].map(ac=>(
            <button key={ac} className={\`chip \${filters.assetClass===ac?'chip-on':''}\`}
              style={filters.assetClass===ac&&AC[ac]?{borderColor:AC[ac].c,color:AC[ac].c}:{}}
              onClick={()=>setFilter('assetClass',ac)}>{ac==='ALL'?'ALL CLASSES':ac}</button>
          ))}
          <div style={{width:'1px',background:'var(--border)',margin:'0 0.3rem'}}/>
          {['ALL','WORKING','PRODUCTION','HISTORY'].map(s=>(
            <button key={s} className={\`chip \${filters.store===s?'chip-on':''}\`}
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
                    <tr key={t.id} className="trade-row" style={{borderLeft:\`3px solid \${ac.c}\`}} onClick={()=>openTrade(t)}>
                      <td className="td-ref">{t.trade_ref}</td>
                      <td><span className="ac-badge" style={{color:ac.c,borderColor:ac.c+'40'}}>{ac.a}</span></td>
                      <td className="td-dim">{t.instrument_type}</td>
                      <td style={{maxWidth:160,overflow:'hidden',textOverflow:'ellipsis'}}>{t.counterparty?.name||'—'}</td>
                      <td className="td-num">{fmt(t.notional)}<span className="ccy-label">{t.notional_ccy}</span></td>
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
`);

// ── App.jsx ───────────────────────────────────────────────────────────────────
write('App.jsx', `import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/useAuthStore'
import AuthGuard        from './components/auth/AuthGuard'
import LoginPage        from './components/auth/LoginPage'
import SignupPage       from './components/auth/SignupPage'
import ConfirmPage      from './components/auth/ConfirmPage'
import CommandCenter    from './components/CommandCenter'
import AppBar           from './components/layout/AppBar'
import CfgNav           from './components/layout/CfgNav'
import BlotterShell     from './components/blotter/BlotterShell'
import CurvesWorkspace  from './components/market-data/CurvesWorkspace'
import OrgHierarchy     from './components/org/OrgHierarchy'
import LegalEntities    from './components/onboarding/LegalEntities'
import Counterparties   from './components/onboarding/Counterparties'

function BlotterLayout() {
  return (
    <div style={{display:'flex',height:'100vh',flexDirection:'column'}}>
      <AppBar />
      <div style={{flex:1,overflow:'hidden'}}><AuthGuard /></div>
    </div>
  )
}

function ConfigLayout() {
  return (
    <div style={{display:'flex',height:'100vh',flexDirection:'column'}}>
      <AppBar />
      <div style={{display:'flex',flex:1,overflow:'hidden'}}>
        <CfgNav />
        <main style={{flex:1,overflow:'auto',background:'var(--bg)'}}><AuthGuard /></main>
      </div>
    </div>
  )
}

export default function App() {
  const { initAuth, loading } = useAuthStore()
  useEffect(() => { initAuth() }, [])
  if (loading) return (
    <div style={{height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'var(--bg)',color:'var(--accent)',fontFamily:'var(--mono)',fontSize:'0.75rem',letterSpacing:'0.15em'}}>
      INITIALISING...
    </div>
  )
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login"   element={<LoginPage />} />
        <Route path="/signup"  element={<SignupPage />} />
        <Route path="/confirm" element={<ConfirmPage />} />
        <Route element={<AuthGuard />}>
          <Route path="/command-center" element={<CommandCenter />} />
          <Route element={<BlotterLayout />}>
            <Route path="/blotter" element={<BlotterShell />} />
          </Route>
          <Route element={<ConfigLayout />}>
            <Route path="/configurations">
              <Route index element={<Navigate to="market-data/curves" replace />} />
              <Route path="market-data/curves" element={<CurvesWorkspace />} />
              <Route path="org-hierarchy"      element={<OrgHierarchy />} />
              <Route path="legal-entities"     element={<LegalEntities />} />
              <Route path="counterparties"     element={<Counterparties />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/command-center" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
`);

// ── CommandCenter.jsx ─────────────────────────────────────────────────────────
write('components/CommandCenter.jsx', `import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/useAuthStore'
import './CommandCenter.css'

const TILES = [
  { id:'blotter',       label:'BLOTTER',             sub:'Trade Entry · Lifecycle · Positions',      sprint:'LIVE',     live:true,  path:'/blotter',                         color:'var(--accent)' },
  { id:'pricer',        label:'PRICER',               sub:'IRS · CDS · FX · Swaption · XVA',         sprint:'SPRINT 3', live:false, color:'var(--text-dim)' },
  { id:'market-risk',   label:'MARKET RISK',          sub:'VaR · Stress · Greeks · FRTB ES',          sprint:'SPRINT 4', live:false, color:'var(--text-dim)' },
  { id:'pnl',           label:'PNL',                  sub:'Attribution · Desk · Trader',              sprint:'SPRINT 4', live:false, color:'var(--text-dim)' },
  { id:'credit',        label:'COUNTERPARTY CREDIT',  sub:'CVA · Exposure · Limits · IM',             sprint:'SPRINT 5', live:false, color:'var(--text-dim)' },
  { id:'collateral',    label:'COLLATERAL',           sub:'Margin Calls · CSA · Disputes',            sprint:'SPRINT 5', live:false, color:'var(--text-dim)' },
  { id:'confirmations', label:'CONFIRMATIONS',        sub:'ISDA · Matching · Affirmation',            sprint:'SPRINT 6', live:false, color:'var(--text-dim)' },
  { id:'configurations',label:'CONFIGURATIONS',       sub:'Curves · Entities · Counterparties',       sprint:'LIVE',     live:true,  path:'/configurations/market-data/curves', color:'var(--blue)' },
  { id:'methodology',   label:'METHODOLOGY',          sub:'Model Docs · Validation · Governance',     sprint:'SPRINT 6', live:false, color:'var(--text-dim)' },
  { id:'news',          label:'NEWS',                 sub:'Market · Macro · Regulatory',              sprint:'SPRINT 3', live:false, color:'var(--text-dim)' },
  { id:'chat',          label:'CHAT',                 sub:'Desk · Counterparty · AI Assist',          sprint:'SPRINT 6', live:false, color:'var(--text-dim)' },
]

export default function CommandCenter() {
  const canvasRef = useRef(null)
  const navigate  = useNavigate()
  const user      = useAuthStore(s => s.user)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    canvas.width = window.innerWidth; canvas.height = window.innerHeight
    const cols = Math.floor(canvas.width / 20)
    const drops = Array(cols).fill(1)
    const chars = 'アイウエオカキクケコΣΔΨΩ∇∂∫∑0123456789ABCDEF'
    const draw = () => {
      ctx.fillStyle = 'rgba(6,10,14,0.05)'; ctx.fillRect(0,0,canvas.width,canvas.height)
      ctx.fillStyle = '#0ec9a020'; ctx.font = '14px JetBrains Mono, monospace'
      drops.forEach((y,i) => {
        ctx.fillText(chars[Math.floor(Math.random()*chars.length)], i*20, y*20)
        if (y*20>canvas.height && Math.random()>0.975) drops[i]=0
        drops[i]++
      })
    }
    const id = setInterval(draw, 50)
    const resize = () => { canvas.width=window.innerWidth; canvas.height=window.innerHeight }
    window.addEventListener('resize', resize)
    return () => { clearInterval(id); window.removeEventListener('resize', resize) }
  }, [])

  const displayName = user?.email?.split('@')[0]?.toUpperCase() || user?.user_metadata?.full_name?.toUpperCase() || 'TRADER'

  return (
    <div className="cc-root">
      <canvas ref={canvasRef} className="cc-canvas"/>
      <div className="cc-bar">
        <span className="cc-logo">RIJEKA</span>
        <div className="cc-bar-right">
          <span className="cc-read-only">READ ONLY</span>
          <span className="cc-dot">·</span>
          <span className="cc-user">{displayName}</span>
          <button className="cc-exit" onClick={() => useAuthStore.getState().signOut()}>EXIT</button>
        </div>
      </div>
      <div className="cc-center">
        <div className="cc-hero">
          <h1 className="cc-title">R I J E K A</h1>
          <p className="cc-subtitle">RISK SYSTEM</p>
          <p className="cc-welcome">Welcome, {displayName}.</p>
        </div>
        <div className="cc-grid">
          {TILES.map(tile => (
            <div key={tile.id}
              className={\`cc-tile \${tile.live?'cc-tile-live':'cc-tile-locked'}\`}
              style={{'--tile-color':tile.color}}
              onClick={() => tile.live && navigate(tile.path)}>
              <div className="cc-tile-label">{tile.label}</div>
              <div className="cc-tile-sub">{tile.sub}</div>
              <div className={\`cc-tile-sprint \${tile.live?'cc-sprint-live':''}\`}>{tile.sprint}</div>
            </div>
          ))}
          <div className="cc-tile cc-tile-empty"/>
        </div>
        <div className="cc-footer">EARLY ACCESS · READ ONLY · hello@rijeka.app</div>
      </div>
    </div>
  )
}
`);

// ── CommandCenter.css ─────────────────────────────────────────────────────────
write('components/CommandCenter.css', `.cc-root { position:relative; width:100vw; height:100vh; background:var(--bg-deep); overflow:hidden; display:flex; flex-direction:column; }
.cc-canvas { position:absolute; inset:0; z-index:0; opacity:0.6; }
.cc-bar { position:relative; z-index:2; display:flex; align-items:center; justify-content:space-between; padding:0.85rem 2rem; border-bottom:1px solid var(--border); background:rgba(6,10,14,0.7); backdrop-filter:blur(4px); }
.cc-logo { font-size:1rem; font-weight:700; letter-spacing:0.2em; color:var(--accent); }
.cc-bar-right { display:flex; align-items:center; gap:0.75rem; font-size:0.7rem; letter-spacing:0.1em; }
.cc-read-only { color:var(--amber); font-weight:700; }
.cc-dot { color:var(--text-dim); }
.cc-user { color:var(--accent); font-weight:700; }
.cc-exit { background:transparent; border:1px solid var(--border); color:var(--text-dim); font-family:var(--mono); font-size:0.65rem; font-weight:700; letter-spacing:0.1em; padding:0.3rem 0.75rem; cursor:pointer; border-radius:2px; transition:all 0.15s; }
.cc-exit:hover { border-color:var(--text); color:var(--text); }
.cc-center { position:relative; z-index:2; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:1.5rem 2rem; gap:1.5rem; }
.cc-hero { text-align:center; }
.cc-title { font-size:clamp(2rem,6vw,4rem); font-weight:900; letter-spacing:0.3em; color:var(--accent); margin:0; text-shadow:0 0 40px rgba(14,201,160,0.3); }
.cc-subtitle { font-size:0.75rem; letter-spacing:0.3em; color:var(--text-dim); margin:0.25rem 0 0; }
.cc-welcome { font-size:0.8rem; font-style:italic; color:var(--text); margin:0.5rem 0 0; opacity:0.7; }
.cc-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:0.75rem; width:100%; max-width:1100px; }
.cc-tile { background:rgba(11,18,25,0.85); border:1px solid var(--border); padding:1rem 1.25rem; border-radius:3px; backdrop-filter:blur(4px); transition:all 0.2s; min-height:90px; display:flex; flex-direction:column; gap:0.3rem; position:relative; overflow:hidden; }
.cc-tile::before { content:''; position:absolute; top:0; left:0; width:3px; height:100%; background:var(--tile-color,var(--border)); opacity:0.6; transition:opacity 0.2s; }
.cc-tile-live { cursor:pointer; border-color:color-mix(in srgb, var(--tile-color) 25%, var(--border)); }
.cc-tile-live:hover { background:rgba(11,18,25,0.95); border-color:var(--tile-color); transform:translateY(-1px); box-shadow:0 4px 20px rgba(0,0,0,0.4); }
.cc-tile-live:hover::before { opacity:1; }
.cc-tile-locked { opacity:0.45; cursor:default; }
.cc-tile-empty { background:transparent; border-color:transparent; cursor:default; }
.cc-tile-empty::before { display:none; }
.cc-tile-label { font-size:0.72rem; font-weight:700; letter-spacing:0.12em; color:var(--tile-color,var(--text)); }
.cc-tile-sub { font-size:0.62rem; color:var(--text-dim); letter-spacing:0.04em; line-height:1.4; flex:1; }
.cc-tile-sprint { font-size:0.58rem; font-weight:700; letter-spacing:0.12em; color:var(--text-dim); margin-top:0.25rem; }
.cc-sprint-live { color:var(--tile-color); opacity:0.8; }
.cc-footer { font-size:0.6rem; letter-spacing:0.15em; color:var(--text-dim); opacity:0.5; text-align:center; }
@media (max-width:900px) { .cc-grid { grid-template-columns:repeat(2,1fr); } }
@media (max-width:500px) { .cc-grid { grid-template-columns:1fr; } }
`);

// ── CfgNav.jsx ────────────────────────────────────────────────────────────────
write('components/layout/CfgNav.jsx', `import { useState } from 'react'
import { NavLink } from 'react-router-dom'

const SECTIONS = [
  { id:'market-data',    label:'MARKET DATA',    items:[{ label:'RATES CURVES', path:'/configurations/market-data/curves' }] },
  { id:'infrastructure', label:'INFRASTRUCTURE', items:[{ label:'ORG HIERARCHY', path:'/configurations/org-hierarchy' }] },
  { id:'onboarding',     label:'ONBOARDING',     items:[{ label:'LEGAL ENTITIES', path:'/configurations/legal-entities' }, { label:'COUNTERPARTIES', path:'/configurations/counterparties' }] },
]

export default function CfgNav() {
  const [collapsed, setCollapsed] = useState({})
  const toggle = id => setCollapsed(s=>({...s,[id]:!s[id]}))
  return (
    <nav style={{width:'200px',minWidth:'200px',background:'var(--panel)',borderRight:'1px solid var(--border)',overflowY:'auto',padding:'1rem 0'}}>
      {SECTIONS.map(sec => {
        const isOpen = !collapsed[sec.id]
        return (
          <div key={sec.id} style={{marginBottom:'0.25rem'}}>
            <button onClick={()=>toggle(sec.id)} style={{width:'100%',background:'none',border:'none',padding:'0.45rem 1rem',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',fontFamily:'var(--mono)',fontSize:'0.58rem',fontWeight:700,letterSpacing:'0.14em',color:'var(--text-dim)'}}>
              <span>{sec.label}</span>
              <span style={{fontSize:'0.55rem',opacity:0.6}}>{isOpen?'▾':'▸'}</span>
            </button>
            {isOpen && sec.items.map(item => (
              <NavLink key={item.path} to={item.path} style={({isActive})=>({display:'block',padding:'0.35rem 1rem 0.35rem 1.5rem',fontFamily:'var(--mono)',fontSize:'0.68rem',letterSpacing:'0.06em',color:isActive?'var(--accent)':'var(--text)',textDecoration:'none',borderLeft:isActive?'2px solid var(--accent)':'2px solid transparent',background:isActive?'color-mix(in srgb, var(--accent) 6%, transparent)':'transparent',transition:'all 0.12s'})}>
                {item.label}
              </NavLink>
            ))}
          </div>
        )
      })}
    </nav>
  )
}
`);

console.log('\n✅  Script 1 complete — all infrastructure files written');
console.log('Files: useTabStore, BlotterShell, BookTab, App, CommandCenter, CfgNav');

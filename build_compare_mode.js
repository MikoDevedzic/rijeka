const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';

function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log('wrote:', rel);
}

// ── CompareWorkspace.css ───────────────────────────────────────────────────────
write('components/blotter/CompareWorkspace.css', `.cmp { display:flex; flex-direction:column; height:100%; overflow:hidden; background:var(--bg); }

.cmp-header {
  display:flex; align-items:center; gap:1rem; padding:0.75rem 1.5rem;
  border-bottom:1px solid var(--border); background:var(--panel); flex-shrink:0;
}
.cmp-title { font-size:0.8rem; font-weight:700; letter-spacing:0.14em; color:var(--text); }
.cmp-count { font-size:0.65rem; color:var(--text-dim); letter-spacing:0.08em; }
.cmp-section-btns { display:flex; gap:0.35rem; margin-left:auto; }
.cmp-sec-btn {
  background:transparent; border:1px solid var(--border); color:var(--text-dim);
  font-family:var(--mono); font-size:0.62rem; font-weight:600; letter-spacing:0.08em;
  padding:0.25rem 0.65rem; border-radius:2px; cursor:pointer; transition:all 0.12s;
}
.cmp-sec-btn:hover { border-color:var(--text-dim); color:var(--text); }
.cmp-sec-btn-active { border-color:var(--accent); color:var(--accent); background:color-mix(in srgb,var(--accent) 8%,transparent); }
.cmp-close-btn {
  background:transparent; border:1px solid var(--border); color:var(--text-dim);
  font-family:var(--mono); font-size:0.62rem; font-weight:600; letter-spacing:0.08em;
  padding:0.25rem 0.65rem; border-radius:2px; cursor:pointer; transition:all 0.12s;
}
.cmp-close-btn:hover { border-color:var(--red); color:var(--red); }

/* Grid */
.cmp-grid { flex:1; overflow:auto; }
.cmp-table {
  width:100%; border-collapse:collapse; font-family:var(--mono); font-size:0.7rem;
}
/* Row label column */
.cmp-table .row-lbl {
  position:sticky; left:0; z-index:2; background:var(--panel-2);
  border-right:1px solid var(--border); border-bottom:1px solid var(--border);
  padding:0.45rem 1rem; font-size:0.6rem; font-weight:700; letter-spacing:0.1em;
  color:var(--text-dim); white-space:nowrap; min-width:160px;
}
/* Trade header columns */
.cmp-trade-hdr {
  position:sticky; top:0; z-index:3; background:var(--panel-2);
  border-bottom:2px solid var(--border); border-right:1px solid var(--border);
  padding:0.6rem 1rem; min-width:200px; max-width:260px;
}
.cmp-hdr-ref { font-size:0.75rem; font-weight:700; letter-spacing:0.06em; color:var(--text); }
.cmp-hdr-sub { font-size:0.62rem; color:var(--text-dim); margin-top:0.15rem; }

/* Top-left corner cell */
.cmp-corner {
  position:sticky; top:0; left:0; z-index:4; background:var(--panel-2);
  border-right:1px solid var(--border); border-bottom:2px solid var(--border);
  padding:0.6rem 1rem;
}

/* Section header rows */
.cmp-section-row td {
  background:var(--bg-deep) !important;
  font-size:0.58rem; font-weight:700; letter-spacing:0.14em;
  color:var(--accent); padding:0.4rem 1rem;
  border-bottom:1px solid var(--border);
}

/* Data cells */
.cmp-table td.data-cell {
  padding:0.45rem 1rem; border-bottom:1px solid color-mix(in srgb,var(--border) 50%,transparent);
  border-right:1px solid color-mix(in srgb,var(--border) 30%,transparent);
  vertical-align:top; max-width:260px;
}
.cmp-val { font-size:0.72rem; color:var(--text); font-weight:600; }
.cmp-val-dim { font-size:0.72rem; color:var(--text-dim); }
.cmp-val-accent { font-size:0.72rem; color:var(--accent); font-weight:700; }
.cmp-val-amber { font-size:0.72rem; color:var(--amber); font-weight:700; }
.cmp-val-red { font-size:0.72rem; color:var(--red); font-weight:700; }
.cmp-val-stub { font-size:0.65rem; color:var(--text-dim); font-style:italic; }

/* Highlight differences */
.cmp-diff { background:color-mix(in srgb,var(--amber) 5%,transparent) !important; }
`);

// ── CompareWorkspace.jsx ───────────────────────────────────────────────────────
write('components/blotter/CompareWorkspace.jsx', `import { useState } from 'react'
import { useTabStore } from '../../store/useTabStore'
import './CompareWorkspace.css'

const AC_COLOR = { RATES:'var(--accent)', FX:'var(--blue)', CREDIT:'var(--amber)', EQUITY:'var(--purple)', COMMODITY:'var(--red)' }
const ST_COLOR = { PENDING:'var(--amber)', LIVE:'var(--accent)', MATURED:'#4a5568', CANCELLED:'var(--red)', TERMINATED:'var(--red)' }

function fmt(n, ccy) {
  if (!n && n !== 0) return '—'
  const s = Number(n).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})
  return ccy ? s + ' ' + ccy : s
}
function fmtD(d) { return d ? d.substring(0,10) : '—' }
function fmtR(r) { return r ? (parseFloat(r)*100).toFixed(4)+'%' : '—' }
function tenor(t) {
  if (!t.effective_date||!t.maturity_date) return '—'
  const y=(new Date(t.maturity_date)-new Date(t.effective_date))/(365.25*864e5)
  return y>=1?\`\${y.toFixed(1)}Y\`:\`\${Math.round(y*12)}M\`
}

// Check if values differ across trades
function differs(trades, fn) {
  const vals = trades.map(fn)
  return new Set(vals.map(String)).size > 1
}

const SECTIONS = {
  IDENTITY: [
    { label:'TRADE REF',      fn: t => ({ val: t.trade_ref, cls:'cmp-val' }) },
    { label:'STATUS',         fn: t => ({ val: t.status, cls: 'cmp-val', style: {color: ST_COLOR[t.status]||'var(--text)'} }) },
    { label:'STORE',          fn: t => ({ val: t.store, cls:'cmp-val-dim' }) },
    { label:'COUNTERPARTY',   fn: t => ({ val: t.counterparty?.name||'—', cls:'cmp-val' }) },
    { label:'OWN ENTITY',     fn: t => ({ val: t.own_entity?.short_name||'—', cls:'cmp-val-dim' }) },
    { label:'DESK',           fn: t => ({ val: t.desk||'—', cls:'cmp-val-dim' }) },
    { label:'BOOK',           fn: t => ({ val: t.book||'—', cls:'cmp-val-dim' }) },
  ],
  ECONOMICS: [
    { label:'ASSET CLASS',    fn: t => ({ val: t.asset_class, cls:'cmp-val', style:{color:AC_COLOR[t.asset_class]||'var(--text)'} }) },
    { label:'INSTRUMENT',     fn: t => ({ val: t.instrument_type, cls:'cmp-val' }) },
    { label:'NOTIONAL',       fn: t => ({ val: fmt(t.notional, t.notional_ccy), cls:'cmp-val' }) },
    { label:'TENOR',          fn: t => ({ val: tenor(t), cls:'cmp-val-accent' }) },
    { label:'TRADE DATE',     fn: t => ({ val: fmtD(t.trade_date), cls:'cmp-val-dim' }) },
    { label:'EFFECTIVE DATE', fn: t => ({ val: fmtD(t.effective_date), cls:'cmp-val-dim' }) },
    { label:'MATURITY DATE',  fn: t => ({ val: fmtD(t.maturity_date), cls:'cmp-val-dim' }) },
  ],
  LEGS: [
    { label:'LEG COUNT',      fn: t => ({ val: String(t.terms?.legs?.length||'—'), cls:'cmp-val' }) },
    { label:'STRUCTURE',      fn: t => ({ val: t.terms?.structure||'—', cls:'cmp-val-dim' }) },
    { label:'LEG 1 TYPE',     fn: t => ({ val: t.terms?.legs?.[0]?.leg_type||'—', cls:'cmp-val-dim' }) },
    { label:'LEG 1 DIR',      fn: t => ({ val: t.terms?.legs?.[0]?.direction||'—', cls:'cmp-val', style:{color:t.terms?.legs?.[0]?.direction==='PAY'?'var(--red)':'var(--accent)'} }) },
    { label:'LEG 1 CCY',      fn: t => ({ val: t.terms?.legs?.[0]?.currency||'—', cls:'cmp-val-dim' }) },
    { label:'LEG 1 RATE',     fn: t => ({ val: t.terms?.legs?.[0]?.fixed_rate ? fmtR(t.terms.legs[0].fixed_rate) : (t.terms?.legs?.[0]?.index||'—'), cls:'cmp-val' }) },
    { label:'LEG 2 TYPE',     fn: t => ({ val: t.terms?.legs?.[1]?.leg_type||'—', cls:'cmp-val-dim' }) },
    { label:'LEG 2 DIR',      fn: t => ({ val: t.terms?.legs?.[1]?.direction||'—', cls:'cmp-val', style:{color:t.terms?.legs?.[1]?.direction==='PAY'?'var(--red)':'var(--accent)'} }) },
    { label:'LEG 2 INDEX',    fn: t => ({ val: t.terms?.legs?.[1]?.index||'—', cls:'cmp-val-dim' }) },
    { label:'LEG 2 SPREAD',   fn: t => ({ val: t.terms?.legs?.[1]?.spread ? t.terms.legs[1].spread+'bps' : '—', cls:'cmp-val-dim' }) },
    { label:'NOTIONAL EXCH',  fn: t => ({ val: t.terms?.notional_exchange ? 'YES' : 'NO', cls:'cmp-val-dim' }) },
    { label:'MODIFIER',       fn: t => ({ val: t.terms?.instrument_modifier||'—', cls:'cmp-val-amber' }) },
  ],
  PRICING: [
    { label:'NPV (CLEAN)',    fn: t => ({ val: null, stub: 'SPRINT 3' }) },
    { label:'NPV (DIRTY)',    fn: t => ({ val: null, stub: 'SPRINT 3' }) },
    { label:'PV01',           fn: t => ({ val: null, stub: 'SPRINT 3' }) },
    { label:'DV01',           fn: t => ({ val: null, stub: 'SPRINT 3' }) },
    { label:'VEGA',           fn: t => ({ val: null, stub: 'SPRINT 3' }) },
    { label:'THETA',          fn: t => ({ val: null, stub: 'SPRINT 3' }) },
  ],
  XVA: [
    { label:'CVA',            fn: t => ({ val: null, stub: 'SPRINT 3' }) },
    { label:'DVA',            fn: t => ({ val: null, stub: 'SPRINT 3' }) },
    { label:'FVA',            fn: t => ({ val: null, stub: 'SPRINT 3' }) },
    { label:'MVA',            fn: t => ({ val: null, stub: 'SPRINT 3' }) },
    { label:'TOTAL XVA',      fn: t => ({ val: null, stub: 'SPRINT 3' }) },
  ],
}

const ALL_SECTIONS = Object.keys(SECTIONS)

export default function CompareWorkspace({ tab }) {
  const { closeTab, openTrade } = useTabStore()
  const trades = tab.trades || []
  const [activeSections, setActiveSections] = useState(new Set(['IDENTITY','ECONOMICS','LEGS']))

  const toggleSection = (s) => setActiveSections(prev => {
    const next = new Set(prev)
    next.has(s) ? next.delete(s) : next.add(s)
    return next
  })

  if (!trades.length) return (
    <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.7rem',letterSpacing:'0.1em'}}>
      NO TRADES SELECTED
    </div>
  )

  return (
    <div className="cmp">
      <div className="cmp-header">
        <span className="cmp-title">TRADE COMPARISON</span>
        <span className="cmp-count">{trades.length} trades</span>
        <div className="cmp-section-btns">
          {ALL_SECTIONS.map(s => (
            <button key={s}
              className={\`cmp-sec-btn \${activeSections.has(s)?'cmp-sec-btn-active':''}\`}
              onClick={() => toggleSection(s)}>{s}</button>
          ))}
        </div>
        <button className="cmp-close-btn" onClick={() => closeTab(tab.id)}>CLOSE</button>
      </div>

      <div className="cmp-grid">
        <table className="cmp-table">
          <thead>
            <tr>
              <th className="cmp-corner">
                <span style={{fontSize:'0.58rem',fontWeight:700,letterSpacing:'0.1em',color:'var(--text-dim)'}}>FIELD</span>
              </th>
              {trades.map(t => {
                const ac = t.asset_class
                const acColor = AC_COLOR[ac] || 'var(--text)'
                return (
                  <th key={t.id} className="cmp-trade-hdr">
                    <div className="cmp-hdr-ref" style={{borderLeft:\`3px solid \${acColor}\`,paddingLeft:'0.5rem'}}>
                      {t.trade_ref}
                    </div>
                    <div className="cmp-hdr-sub">
                      <span style={{color:acColor,fontWeight:700}}>{t.asset_class}</span>
                      {' · '}{t.instrument_type}
                      {' · '}
                      <span style={{color:ST_COLOR[t.status]||'var(--text)'}}>{t.status}</span>
                    </div>
                    <div style={{marginTop:'0.25rem',display:'flex',gap:'0.35rem'}}>
                      <button onClick={() => openTrade(t)} style={{
                        background:'none',border:'1px solid var(--border)',color:'var(--text-dim)',
                        fontFamily:'var(--mono)',fontSize:'0.58rem',padding:'0.1rem 0.4rem',
                        borderRadius:2,cursor:'pointer',letterSpacing:'0.06em',
                      }}>OPEN →</button>
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {ALL_SECTIONS.filter(s => activeSections.has(s)).map(sectionKey => {
              const rows = SECTIONS[sectionKey]
              return [
                // Section header row
                <tr key={\`sec-\${sectionKey}\`} className="cmp-section-row">
                  <td colSpan={trades.length + 1}>{sectionKey}</td>
                </tr>,
                // Data rows
                ...rows.map(row => {
                  const vals = trades.map(row.fn)
                  const isDiff = differs(trades, t => {
                    const v = row.fn(t)
                    return v.stub ? '—' : (v.val ?? '—')
                  })
                  return (
                    <tr key={\`\${sectionKey}-\${row.label}\`}>
                      <td className="row-lbl">{row.label}</td>
                      {vals.map((v, i) => (
                        <td key={i} className={\`data-cell \${isDiff?'cmp-diff':''}\`}>
                          {v.stub
                            ? <span className="cmp-val-stub">{v.stub}</span>
                            : <span className={v.cls||'cmp-val'} style={v.style||{}}>
                                {v.val ?? '—'}
                              </span>
                          }
                        </td>
                      ))}
                    </tr>
                  )
                })
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
`);

// ── Patch useTabStore — add openComparison ────────────────────────────────────
const storePath = path.join(ROOT, 'store', 'useTabStore.js');
let store = fs.readFileSync(storePath, 'utf8');

store = store.replace(
  `  refreshTrade: (tradeId, trade) =>
    set(s => ({ tabs: s.tabs.map(t => t.tradeId === tradeId ? { ...t, trade } : t) })),`,
  `  refreshTrade: (tradeId, trade) =>
    set(s => ({ tabs: s.tabs.map(t => t.tradeId === tradeId ? { ...t, trade } : t) })),

  openComparison: (trades) => {
    const id = \`compare-\${Date.now()}\`
    const label = \`CMP (\${trades.length})\`
    const tab = { id, type: 'compare', label, trades, closeable: true, dirty: false }
    set(s => ({ tabs: [...s.tabs, tab], activeId: id }))
  },`
);

fs.writeFileSync(storePath, store, 'utf8');
console.log('✅  useTabStore — openComparison added');

// ── Patch BlotterShell — add compare tab type ─────────────────────────────────
const shellPath = path.join(ROOT, 'components', 'blotter', 'BlotterShell.jsx');
let shell = fs.readFileSync(shellPath, 'utf8');

shell = shell.replace(
  `import { useTabStore } from '../../store/useTabStore'
import BookTab from './BookTab'
import TradeWorkspace from './TradeWorkspace'
import NewTradeWorkspace from './NewTradeWorkspace'
import './BlotterShell.css'`,
  `import { useTabStore } from '../../store/useTabStore'
import BookTab from './BookTab'
import TradeWorkspace from './TradeWorkspace'
import NewTradeWorkspace from './NewTradeWorkspace'
import CompareWorkspace from './CompareWorkspace'
import './BlotterShell.css'`
);

shell = shell.replace(
  `        {activeTab?.type==='book'  && <BookTab />}
        {activeTab?.type==='trade' && <TradeWorkspace tab={activeTab} />}
        {activeTab?.type==='new'   && <NewTradeWorkspace tab={activeTab} />}`,
  `        {activeTab?.type==='book'    && <BookTab />}
        {activeTab?.type==='trade'   && <TradeWorkspace tab={activeTab} />}
        {activeTab?.type==='new'     && <NewTradeWorkspace tab={activeTab} />}
        {activeTab?.type==='compare' && <CompareWorkspace tab={activeTab} />}`
);

// Add compare tab styling
shell = shell.replace(
  `  const { tabs, activeId, setActive, closeTab, openNewTrade } = useTabStore()`,
  `  const { tabs, activeId, setActive, closeTab, openNewTrade } = useTabStore()`
);

fs.writeFileSync(shellPath, shell, 'utf8');
console.log('✅  BlotterShell — compare tab type wired');

// ── Patch BookTab — add checkboxes + Compare button ──────────────────────────
const bookPath = path.join(ROOT, 'components', 'blotter', 'BookTab.jsx');
let book = fs.readFileSync(bookPath, 'utf8');

// Add openComparison to imports
book = book.replace(
  `  const { openTrade, openNewTrade } = useTabStore()`,
  `  const { openTrade, openNewTrade, openComparison } = useTabStore()`
);

// Add selected state
book = book.replace(
  `  const [sortCol, setSortCol] = useState('trade_date')
  const [sortDir, setSortDir] = useState('desc')`,
  `  const [sortCol, setSortCol] = useState('trade_date')
  const [sortDir, setSortDir] = useState('desc')
  const [selected, setSelected] = useState(new Set())

  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const selectedTrades = rows.filter(t => selected.has(t.id))`
);

// Add compare button to header
book = book.replace(
  `        <button className="btn-book" onClick={()=>openNewTrade()}>+ NEW TRADE</button>`,
  `        <div style={{display:'flex',gap:'0.5rem',alignItems:'center'}}>
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
        </div>`
);

// Add checkbox column to table header
book = book.replace(
  `            <thead><tr>
              <TH col="trade_ref" label="REF"/>`,
  `            <thead><tr>
              <th style={{width:'36px',padding:'0.5rem 0.5rem 0.5rem 1rem'}}>
                <input type="checkbox"
                  checked={selected.size===rows.length&&rows.length>0}
                  onChange={e=>setSelected(e.target.checked?new Set(rows.map(t=>t.id)):new Set())}
                  style={{cursor:'pointer',accentColor:'var(--accent)'}}/>
              </th>
              <TH col="trade_ref" label="REF"/>`
);

// Add checkbox to each trade row
book = book.replace(
  `                    <tr key={t.id} className="trade-row" style={{borderLeft:\`3px solid \${ac.c}\`}} onClick={()=>openTrade(t)}>
                      <td className="td-ref">{t.trade_ref}</td>`,
  `                    <tr key={t.id} className={\`trade-row \${selected.has(t.id)?'trade-row-selected':''}\`}
                      style={{borderLeft:\`3px solid \${ac.c}\`}}>
                      <td style={{padding:'0.45rem 0.5rem 0.45rem 1rem'}} onClick={e=>e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(t.id)}
                          onChange={()=>toggleSelect(t.id)}
                          style={{cursor:'pointer',accentColor:'var(--accent)'}}/>
                      </td>
                      <td className="td-ref" onClick={()=>openTrade(t)} style={{cursor:'pointer'}}>{t.trade_ref}</td>`
);

// Make other cells also clickable
book = book.replace(
  `                      <td><span className="ac-badge" style={{color:ac.c,borderColor:ac.c+'40'}}>{ac.a}</span></td>
                      <td className="td-dim">{t.instrument_type}</td>
                      <td style={{maxWidth:160,overflow:'hidden',textOverflow:'ellipsis'}}>{t.counterparty?.name||'—'}</td>
                      <td className="td-num">{fmt(t.notional)}<span className="ccy-label">{t.notional_ccy}</span></td>
                      <td className="td-dim">{tenor(t)}</td>
                      <td className="td-dim" style={{fontSize:'0.65rem'}}>{fmtD(t.trade_date)}</td>
                      <td className="td-dim" style={{fontSize:'0.65rem'}}>{fmtD(t.maturity_date)}</td>
                      <td><span className="status-pip" style={{background:st.c}}/><span className="status-txt" style={{color:st.c}}>{st.l}</span></td>
                      <td><span className="store-txt" style={{color:sr.c}}>{sr.l}</span></td>`,
  `                      <td onClick={()=>openTrade(t)} style={{cursor:'pointer'}}><span className="ac-badge" style={{color:ac.c,borderColor:ac.c+'40'}}>{ac.a}</span></td>
                      <td className="td-dim" onClick={()=>openTrade(t)} style={{cursor:'pointer'}}>{t.instrument_type}</td>
                      <td style={{maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',cursor:'pointer'}} onClick={()=>openTrade(t)}>{t.counterparty?.name||'—'}</td>
                      <td className="td-num" onClick={()=>openTrade(t)} style={{cursor:'pointer'}}>{fmt(t.notional)}<span className="ccy-label">{t.notional_ccy}</span></td>
                      <td className="td-dim" onClick={()=>openTrade(t)} style={{cursor:'pointer'}}>{tenor(t)}</td>
                      <td className="td-dim" style={{fontSize:'0.65rem',cursor:'pointer'}} onClick={()=>openTrade(t)}>{fmtD(t.trade_date)}</td>
                      <td className="td-dim" style={{fontSize:'0.65rem',cursor:'pointer'}} onClick={()=>openTrade(t)}>{fmtD(t.maturity_date)}</td>
                      <td onClick={()=>openTrade(t)} style={{cursor:'pointer'}}><span className="status-pip" style={{background:st.c}}/><span className="status-txt" style={{color:st.c}}>{st.l}</span></td>
                      <td onClick={()=>openTrade(t)} style={{cursor:'pointer'}}><span className="store-txt" style={{color:sr.c}}>{sr.l}</span></td>`
);

// Add selected row styling to BookTab.css
const bookCssPath = path.join(ROOT, 'components', 'blotter', 'BookTab.css');
let bookCss = fs.readFileSync(bookCssPath, 'utf8');
bookCss += `\n.trade-row-selected { background:color-mix(in srgb, var(--accent) 5%, transparent) !important; }\n`;
fs.writeFileSync(bookCssPath, bookCss, 'utf8');

fs.writeFileSync(bookPath, book, 'utf8');
console.log('✅  BookTab — checkboxes + Compare button added');

// ── Architecture document ─────────────────────────────────────────────────────
const arch = `# Rijeka — Architecture v9
*Updated: Sprint 2 Complete*

---

## Project
Open-source full revaluation derivatives risk system.
Pure risk analytics: market risk, CCR, XVA, ISDA SIMM, on-chain confirmation.
Croatian/Serbian/Bosnian word for "river" — named after Miko's village in Bosnia.

---

## Infrastructure

| Service   | Purpose                    | URL |
|-----------|---------------------------|-----|
| Netlify   | React app                  | app.rijeka.app |
| Render    | FastAPI backend            | api.rijeka.app |
| Supabase  | Postgres + Auth            | upuewetohnocfshkhafg.supabase.co |
| GitHub    | Monorepo                   | MikoDevedzic/open-source-cross-asset-pricing-and-risk-platform |
| Namecheap | Domain                     | rijeka.app |

---

## Design Invariants (never change)

\`\`\`
--bg:#060a0e  --bg-deep:#03060a  --panel:#0b1219  --panel-2:#0f1820  --panel-3:#141f28
--accent:#0ec9a0  --amber:#e8a020  --blue:#3d8bc8  --purple:#9060cc  --red:#d95040
--mono: JetBrains Mono
\`\`\`

Dark terminal aesthetic. CSS variables only. ISDA SIMM v2.6 naming throughout.

---

## Database Schema (Supabase)

\`\`\`
profiles           — trader_id, role
org_nodes          — firm/division/desk/book/strategy tree (node_type check constraint)
legal_entities     — LEI, own entity flag, regulatory regime, SIMM version
counterparties     — ISDA, CSA type/currency/threshold/MTA, discount curve, IM model
trades             — full trade record + terms JSONB (legs, cashflow_overrides, hashes)
\`\`\`

### Planned (Sprint 3+)
\`\`\`
trade_events       — immutable event stream (BOOKED|ACTIVATED|AMENDED|NOVATED|TERMINATED...)
trade_legs         — dedicated legs table (migrated from JSONB, leg UUIDs as PKs)
cashflows          — generated cashflow schedule (leg_id FK, status, override_amount)
\`\`\`

---

## Trade Data Model

### Current (Sprint 2)
\`\`\`json
trades.terms = {
  "structure": "IR_SWAP",
  "legs": [{
    "leg_id": "uuid-v4",
    "leg_ref": "TRD-12345678-L1",
    "leg_seq": 0,
    "leg_type": "FIXED",
    "direction": "PAY",
    "leg_hash": null,
    "booked_at": "ISO timestamp"
    // ... full leg economics
  }],
  "cashflow_overrides": {},
  "cashflow_hashes": {},
  "instrument_modifier": null,
  "trade_hash": null
}
\`\`\`

### Sprint 3 — Event-Sourced Model
\`\`\`
trade_events:
  id, trade_id, event_type, event_date, effective_date,
  created_at, created_by, payload JSONB,
  pre_state JSONB, post_state JSONB,
  counterparty_confirmed BOOL, confirmation_hash TEXT

event_types:
  BOOKED | ACTIVATED | AMENDED | BOOK_TRANSFER | STORE_CHANGE |
  PARTIAL_TERMINATION | NOVATED | TERMINATED | MATURED | CANCELLED |
  DEFAULTED | COMPRESSION | CREDIT_EVENT
\`\`\`

**The trade row = current-state cache. The event stream = truth.**
All downstream systems read events, not raw trade row.

---

## Trade Lifecycle & Amendment Rules

| Field | Amendable | Event Type | Repricing |
|---|---|---|---|
| Desk / Book / Strategy | Always | BOOK_TRANSFER | No |
| Store | Always | STORE_CHANGE | No |
| Counterparty | Pre-live | AMENDMENT | No |
| Fixed rate | Pre-live | AMENDMENT | Yes |
| Notional (full) | Pre-live | AMENDMENT | Yes |
| Notional (partial) | Live | PARTIAL_TERMINATION | Yes |
| Maturity extension | Live, bilateral | AMENDMENT | Yes |
| Break clause | Live | TERMINATION | Yes |
| Novation | Live | NOVATED | Yes |
| Compression | Live | COMPRESSION | Yes |

---

## Instruments Supported (Sprint 2)

### RATES (10)
IR_SWAP, OIS_SWAP, BASIS_SWAP, XCCY_SWAP (MTM + Non-MTM), FRA,
ZERO_COUPON_SWAP, STEP_UP_SWAP, INFLATION_SWAP (ZC + YoY),
CMS_SWAP, CMS_SPREAD_SWAP

### FX (3)
FX_FORWARD, FX_SWAP, NDF

### CREDIT (5)
CDS, CDS_INDEX, TOTAL_RETURN_SWAP, ASSET_SWAP, RISK_PARTICIPATION
(RPA: funded/unfunded, LMA/BAFT/APLMA, 13 underlying facility types)

### EQUITY (4)
EQUITY_SWAP, VARIANCE_SWAP, DIVIDEND_SWAP, EQUITY_FORWARD

### COMMODITY (4)
COMMODITY_SWAP, COMMODITY_BASIS_SWAP, ASIAN_COMMODITY_SWAP, EMISSIONS_SWAP
(EUA, RGGI, CCA, UKA, NZU, ACCU, KAU)

**Total: 26 linear instruments across 5 asset classes**
Options (all 5 classes) → Sprint 3 pricing engine required

---

## Leg Architecture

Every instrument decomposes into N legs. Each leg:
- UUID (leg_id) — independently addressable
- Human ref (leg_ref: TRD-XXXXXXXX-L1) — for confirmations
- Leg type: FIXED|FLOAT|ZERO_COUPON|INFLATION|CMS|CDS_FEE|CDS_CONTINGENT|
            TOTAL_RETURN|EQUITY_RETURN|EQUITY_FWD|VARIANCE|DIVIDEND|
            COMMODITY_FLOAT|EMISSIONS_FLOAT|RPA_FEE|RPA_CONTINGENT
- Notional schedule: BULLET|LINEAR_AMORT|MORTGAGE|CUSTOM date/amount pairs
- Rate schedule: FLAT or STEP (rollercoaster) with date/rate pairs
- Spread schedule: FLAT or STEP
- Cashflow overrides: per-cashflow amount amendments (flags instrument as MODIFIED)
- Full ISDA schedule params: day count, frequency, BDC, stub type, calendar, payment lag
- Irregular period support: first_period_start, last_period_end

---

## XCCY Swap — MTM Model

\`\`\`
xccy_mtm_type:          NON_MTM | MTM
xccy_fx_pair:           EURUSD, USDJPY... (15 major pairs)
xccy_initial_fx_rate:   locked at inception
xccy_notional_exchange: NONE|INITIAL_ONLY|FINAL_ONLY|BOTH|PERIODIC
xccy_mtm_reset_leg:     which leg resets (typically USD)
xccy_mtm_reset_frequency: MONTHLY|QUARTERLY|SEMI-ANNUAL|ANNUAL
xccy_mtm_fx_source:     WM_REUTERS|ECB_FIXING|BBG_BFIX|FED_H10
xccy_reset_schedule:    [{period, reset_type: MTM|FIXED, fx_rate}]
                        — Sprint 3: hybrid schedules (MTM periods + fixed rate periods)
\`\`\`

---

## Blotter — Window Management

### Current (Sprint 2)
- **Tab system**: BOOK tab (pinned) + dynamic trade/new/compare tabs
- **Comparison mode**: select 2+ trades → COMPARE → side-by-side economics grid
  - Sections: IDENTITY | ECONOMICS | LEGS | PRICING (stub) | XVA (stub)
  - Diff highlighting: amber background on rows where values differ
  - OPEN → button per trade column to jump to full workspace
- **Edit Portfolio**: desk, book, store editable on any trade (non-economic fields)

### Sprint 3 — Tiling Workspace
- Workspace canvas with draggable/resizable trade tiles
- Auto-layout: 1→full, 2→50/50, 3→2+1, 4→2x2, 5+→grid+overflow
- Tile collapse to strip-only (ref + key metrics)
- Each tile: full trade workspace with live pricing numbers
- Multi-monitor: open multiple browser windows, each independent workspace
- localStorage sync for state across windows

---

## Sprint Roadmap

### Sprint 2 ✅ COMPLETE
Auth, CommandCenter (11 tiles), 54 curves, OrgHierarchy (firm/div/desk/book/strategy),
LegalEntities, Counterparties, FastAPI backend, Trades blotter, Tab system,
26-instrument leg builder, Comparison mode, Edit portfolio, Deploy config

### Sprint 3 — Pricing Engine
- trade_events table (foundation for all downstream systems)
- trade_legs table migration (leg UUIDs as proper PKs)
- cashflows table (generated schedule, leg_id FK)
- Full curve bootstrap (OIS→BASIS→XCCY→FUNDING, all 54 curves)
- IR Swap NPV (fixed leg PV + float leg PV, full ISDA schedule)
- FX Forward pricing (discount + FX basis)
- Greeks: PV01, DV01, Gamma, Vega, Theta
- Tiling workspace canvas (pricing numbers make it useful)
- Hybrid XCCY reset schedule builder
- Option booking (all 5 asset classes — economics captured, pricing engine live)

### Sprint 4 — Market Risk + PNL
- VaR (historical simulation, 1Y lookback)
- Stress testing (rate shocks, FX moves, credit spread widening)
- FRTB ES calculation
- PNL attribution by event type, desk, book, trader
- Economic amendment workflow (rate, notional, maturity changes with approval)
- Partial termination, novation, compression workflows

### Sprint 5 — CCR + Collateral + Confirmations
- CVA/DVA (EPE/ENE profiles per counterparty)
- ISDA SIMM v2.6 IM calculation
- Collateral management (margin calls, CSA-aware, dispute workflow)
- Confirmation matching (ISDA protocol, bilateral confirmation)
- Blockchain attestation (trade hash + leg hashes + cashflow hashes)

### Sprint 6 — Regulatory + Infrastructure
- EMIR reporting (UTI, trade reports)
- CFTC reporting (swap data repository)
- MiFID II transaction reporting
- Longevity swap, property derivative, repo, securities lending
- CLN, LCDS, basket credit products
- Electricity swap, freight swap (FFA), weather derivative
- Financing category (repo, sec lending)
- Methodology module (model docs, validation, governance)
- News feed, Chat (desk + counterparty + AI assist)

---

## Blockchain Confirmation Architecture (Sprint 5)

\`\`\`
trade_hash    = SHA256(trade_id + all leg hashes + timestamp)
leg_hash      = SHA256(leg_id + economics + cashflow_schedule_hash)
cashflow_hash = SHA256(cashflow_id + amount + date + currency)

Both counterparties sign trade_hash.
Cashflows settle individually — each recorded on-chain.
Amendments invalidate old hash → new hash → re-confirmation required.
Immutable audit trail: every state change preserved with old+new hash.
\`\`\`

---

## Downstream System Data Consumption

| System | Reads from |
|---|---|
| Pricer | trade_events.post_state → current leg economics |
| PNL | trade_events → attribution by event type + date |
| Market Risk | trade_events → live positions per desk/book |
| CCR | trade_events + counterparties.csa_type → exposure profile |
| Collateral | trades in scope per CSA → margin calculation |
| Confirmations | trade_events → hash chain → blockchain attestation |
| Regulatory | trade_events → UTI, EMIR/CFTC/MiFID stream |

**Rule: never read raw trade row for analytics. Always read event stream.**

---

## Curve Bootstrap Order (never change)
\`\`\`
Pass 1: OIS     → independent, bootstrapped first
Pass 2: BASIS   → depends on OIS
Pass 3: XCCY    → depends on domestic OIS + USD_SOFR + FX spot
Pass 4: FUNDING → depends on OIS, additive spread
\`\`\`

---

## Auth Flow
\`\`\`
/login → /command-center → module tiles → /blotter | /configurations/*
AppBar: HOME | BLOTTER | CONFIGURATIONS (direct nav, no round-trip)
\`\`\`

*Sprint 2 complete: 2026-03-27*
*Rijeka — Croatian/Serbian/Bosnian for "river". Risk flows through it.*
`;

const archPath = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\docs\\ARCHITECTURE_v9.md';
fs.mkdirSync(path.dirname(archPath), { recursive: true });
fs.writeFileSync(archPath, arch, 'utf8');
console.log('✅  docs/ARCHITECTURE_v9.md written');

console.log('\n════════════════════════════════════════════════════════');
console.log('ALL DONE.');
console.log('');
console.log('Comparison mode:');
console.log('  1. Go to BOOK tab');
console.log('  2. Check 2+ trades using the checkboxes');
console.log('  3. Click COMPARE (N) button that appears');
console.log('  4. Side-by-side grid opens as a new tab');
console.log('  5. Toggle sections: IDENTITY | ECONOMICS | LEGS | PRICING | XVA');
console.log('  6. Amber highlight = values differ across trades');
console.log('  7. OPEN → button per column jumps to full trade workspace');
console.log('════════════════════════════════════════════════════════');

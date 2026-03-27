const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';

const cmpPath = path.join(ROOT, 'components', 'blotter', 'CompareWorkspace.jsx');
let src = fs.readFileSync(cmpPath, 'utf8');

// ── 1. Replace full CompareWorkspace.jsx with enhanced version ────────────────
const newFile = `import { useState } from 'react'
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
function differs(trades, fn) {
  const vals = trades.map(t => { const v = fn(t); return v.stub ? '__stub__' : String(v.val ?? '—') })
  return new Set(vals).size > 1
}

const SECTIONS = {
  IDENTITY: [
    { label:'TRADE REF',      fn: t => ({ val: t.trade_ref, cls:'cmp-val' }) },
    { label:'STATUS',         fn: t => ({ val: t.status, cls:'cmp-val', style:{color:ST_COLOR[t.status]||'var(--text)'} }) },
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
    { label:'NPV (CLEAN)',    fn: t => ({ val: null, stub:'SPRINT 3' }) },
    { label:'NPV (DIRTY)',    fn: t => ({ val: null, stub:'SPRINT 3' }) },
    { label:'PV01',           fn: t => ({ val: null, stub:'SPRINT 3' }) },
    { label:'DV01',           fn: t => ({ val: null, stub:'SPRINT 3' }) },
    { label:'VEGA',           fn: t => ({ val: null, stub:'SPRINT 3' }) },
    { label:'THETA',          fn: t => ({ val: null, stub:'SPRINT 3' }) },
  ],
  XVA: [
    { label:'CVA',            fn: t => ({ val: null, stub:'SPRINT 3' }) },
    { label:'DVA',            fn: t => ({ val: null, stub:'SPRINT 3' }) },
    { label:'FVA',            fn: t => ({ val: null, stub:'SPRINT 3' }) },
    { label:'MVA',            fn: t => ({ val: null, stub:'SPRINT 3' }) },
    { label:'TOTAL XVA',      fn: t => ({ val: null, stub:'SPRINT 3' }) },
  ],
}

const ALL_SECTIONS = Object.keys(SECTIONS)

// ── AI Analysis Panel ─────────────────────────────────────────────────────────
function AiAnalysisPanel({ trades, onClose }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)
  const [error, setError]     = useState(null)
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState([])

  const buildTradeContext = () => trades.map((t, i) => {
    const legs = t.terms?.legs || []
    return \`Trade \${i+1}: \${t.trade_ref}
  Asset Class: \${t.asset_class} | Instrument: \${t.instrument_type}
  Status: \${t.status} | Store: \${t.store}
  Counterparty: \${t.counterparty?.name||'—'} | Own Entity: \${t.own_entity?.short_name||'—'}
  Notional: \${fmt(t.notional, t.notional_ccy)}
  Tenor: \${tenor(t)} | Trade Date: \${fmtD(t.trade_date)} | Maturity: \${fmtD(t.maturity_date)}
  Desk: \${t.desk||'—'} | Book: \${t.book||'—'}
  Legs: \${legs.map(l => \`\${l.direction} \${l.leg_type} \${l.currency} \${l.fixed_rate?fmtR(l.fixed_rate):l.index||''} \${l.spread?l.spread+'bps spread':''}\`).join(' | ')}\`
  }).join('\\n\\n')

  const analyse = async (userMsg) => {
    const ctx = buildTradeContext()
    const systemPrompt = \`You are a senior derivatives analyst at a trading desk reviewing trade economics.
You have been given \${trades.length} trades to compare. Be concise, precise, and use proper market terminology.
Focus on: key economic differences, risk implications, structural differences, anything that would matter to a trader or risk manager.
Format your response clearly. Use bullet points for differences. Be direct — no fluff.

TRADE DATA:
\${ctx}\`

    const newMessages = [...messages, { role: 'user', content: userMsg }]
    setMessages(newMessages)
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          system: systemPrompt,
          messages: newMessages,
        })
      })
      const data = await response.json()
      const reply = data.content?.[0]?.text || 'No response received.'
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch (e) {
      setError('Analysis failed: ' + e.message)
    }
    setLoading(false)
  }

  const quickAnalyse = () => analyse('Summarise the key differences between these trades. What should a trader pay attention to?')

  return (
    <div style={{
      borderTop: '1px solid var(--border)',
      background: 'var(--panel)',
      display: 'flex',
      flexDirection: 'column',
      height: '340px',
      flexShrink: 0,
    }}>
      {/* Panel header */}
      <div style={{
        display:'flex', alignItems:'center', gap:'0.75rem',
        padding:'0.6rem 1.25rem', borderBottom:'1px solid var(--border)',
        background:'var(--panel-2)', flexShrink:0,
      }}>
        <span style={{fontFamily:'var(--mono)',fontSize:'0.65rem',fontWeight:700,letterSpacing:'0.12em',color:'var(--purple)'}}>
          ◆ AI TRADE ANALYST
        </span>
        <span style={{fontFamily:'var(--mono)',fontSize:'0.6rem',color:'var(--text-dim)'}}>
          {trades.length} trades loaded · Ask anything about these trades
        </span>
        <div style={{marginLeft:'auto',display:'flex',gap:'0.5rem'}}>
          {messages.length === 0 && (
            <button onClick={quickAnalyse} disabled={loading} style={{
              background:'var(--purple)', border:'none', color:'#fff',
              fontFamily:'var(--mono)', fontSize:'0.65rem', fontWeight:700,
              letterSpacing:'0.1em', padding:'0.3rem 0.85rem', borderRadius:2,
              cursor:'pointer', opacity: loading ? 0.6 : 1,
            }}>
              {loading ? 'ANALYSING...' : 'ANALYSE DIFFERENCES'}
            </button>
          )}
          {messages.length > 0 && (
            <button onClick={() => setMessages([])} style={{
              background:'transparent', border:'1px solid var(--border)',
              color:'var(--text-dim)', fontFamily:'var(--mono)', fontSize:'0.62rem',
              padding:'0.25rem 0.65rem', borderRadius:2, cursor:'pointer',
            }}>CLEAR</button>
          )}
          <button onClick={onClose} style={{
            background:'transparent', border:'1px solid var(--border)',
            color:'var(--text-dim)', fontFamily:'var(--mono)', fontSize:'0.62rem',
            padding:'0.25rem 0.65rem', borderRadius:2, cursor:'pointer',
          }}>HIDE</button>
        </div>
      </div>

      {/* Messages */}
      <div style={{flex:1, overflow:'auto', padding:'0.75rem 1.25rem', display:'flex', flexDirection:'column', gap:'0.6rem'}}>
        {messages.length === 0 && !loading && (
          <div style={{
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
            height:'100%', gap:'0.75rem', color:'var(--text-dim)',
          }}>
            <span style={{fontFamily:'var(--mono)',fontSize:'0.72rem',letterSpacing:'0.1em'}}>
              READY TO ANALYSE {trades.length} TRADES
            </span>
            <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap',justifyContent:'center'}}>
              {[
                'What are the key differences?',
                'Which trade has more curve risk?',
                'Compare the cashflow profiles',
                'Any structural concerns?',
              ].map(q => (
                <button key={q} onClick={() => analyse(q)} style={{
                  background:'transparent', border:'1px solid var(--border)',
                  color:'var(--text-dim)', fontFamily:'var(--mono)', fontSize:'0.62rem',
                  padding:'0.3rem 0.75rem', borderRadius:2, cursor:'pointer',
                  transition:'all 0.12s',
                }}
                onMouseEnter={e=>{e.target.style.borderColor='var(--purple)';e.target.style.color='var(--purple)'}}
                onMouseLeave={e=>{e.target.style.borderColor='var(--border)';e.target.style.color='var(--text-dim)'}}
                >{q}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role==='user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            background: m.role==='user' ? 'color-mix(in srgb,var(--purple) 12%,transparent)' : 'var(--panel-2)',
            border: \`1px solid \${m.role==='user' ? 'color-mix(in srgb,var(--purple) 30%,transparent)' : 'var(--border)'}\`,
            borderRadius: 3, padding: '0.6rem 0.85rem',
          }}>
            <div style={{
              fontFamily:'var(--mono)', fontSize:'0.68rem', lineHeight:1.6,
              color: m.role==='user' ? 'var(--purple)' : 'var(--text)',
              whiteSpace:'pre-wrap',
            }}>{m.content}</div>
          </div>
        ))}
        {loading && (
          <div style={{
            alignSelf:'flex-start', background:'var(--panel-2)',
            border:'1px solid var(--border)', borderRadius:3,
            padding:'0.6rem 0.85rem', fontFamily:'var(--mono)',
            fontSize:'0.68rem', color:'var(--text-dim)', letterSpacing:'0.08em',
          }}>
            ANALYSING TRADES...
          </div>
        )}
        {error && (
          <div style={{fontSize:'0.68rem',color:'var(--red)',padding:'0.4rem 0.6rem',background:'color-mix(in srgb,var(--red) 8%,transparent)',border:'1px solid color-mix(in srgb,var(--red) 30%,transparent)',borderRadius:2}}>
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{display:'flex',gap:'0.5rem',padding:'0.6rem 1.25rem',borderTop:'1px solid var(--border)',background:'var(--panel-2)',flexShrink:0}}>
        <input
          value={question}
          onChange={e=>setQuestion(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter'&&question.trim()){analyse(question.trim());setQuestion('')}}}
          placeholder="Ask about these trades... (Enter to send)"
          style={{
            flex:1, background:'var(--bg)', border:'1px solid var(--border)',
            color:'var(--text)', fontFamily:'var(--mono)', fontSize:'0.7rem',
            padding:'0.35rem 0.65rem', borderRadius:2, outline:'none',
          }}
          onFocus={e=>e.target.style.borderColor='var(--purple)'}
          onBlur={e=>e.target.style.borderColor='var(--border)'}
        />
        <button
          onClick={()=>{if(question.trim()){analyse(question.trim());setQuestion('')}}}
          disabled={loading||!question.trim()}
          style={{
            background:'var(--purple)', border:'none', color:'#fff',
            fontFamily:'var(--mono)', fontSize:'0.68rem', fontWeight:700,
            padding:'0.35rem 0.85rem', borderRadius:2, cursor:'pointer',
            opacity: loading||!question.trim() ? 0.5 : 1,
          }}
        >SEND</button>
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CompareWorkspace({ tab }) {
  const { closeTab, openTrade } = useTabStore()
  const trades = tab.trades || []
  const [activeSections, setActiveSections] = useState(new Set(['IDENTITY','ECONOMICS','LEGS']))
  const [showAi, setShowAi] = useState(false)

  const toggleSection = (s) => setActiveSections(prev => {
    const next = new Set(prev)
    next.has(s) ? next.delete(s) : next.add(s)
    return next
  })

  // Count total differences across all visible sections
  const totalDiffs = ALL_SECTIONS
    .filter(s => activeSections.has(s))
    .flatMap(s => SECTIONS[s])
    .filter(row => differs(trades, row.fn))
    .length

  if (!trades.length) return (
    <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.7rem',letterSpacing:'0.1em'}}>
      NO TRADES SELECTED
    </div>
  )

  return (
    <div className="cmp">
      {/* Header */}
      <div className="cmp-header">
        <span className="cmp-title">TRADE COMPARISON</span>
        <span className="cmp-count">{trades.length} trades</span>
        {totalDiffs > 0 && (
          <span style={{
            fontFamily:'var(--mono)', fontSize:'0.62rem', fontWeight:700,
            color:'var(--amber)', letterSpacing:'0.08em',
            padding:'0.15rem 0.5rem', borderRadius:2,
            background:'color-mix(in srgb,var(--amber) 10%,transparent)',
            border:'1px solid color-mix(in srgb,var(--amber) 30%,transparent)',
          }}>
            {totalDiffs} DIFFERENCE{totalDiffs!==1?'S':''}
          </span>
        )}
        <div className="cmp-section-btns">
          {ALL_SECTIONS.map(s => (
            <button key={s}
              className={\`cmp-sec-btn \${activeSections.has(s)?'cmp-sec-btn-active':''}\`}
              onClick={() => toggleSection(s)}>{s}</button>
          ))}
        </div>
        <button
          onClick={() => setShowAi(v => !v)}
          style={{
            background: showAi ? 'color-mix(in srgb,var(--purple) 15%,transparent)' : 'transparent',
            border: \`1px solid \${showAi ? 'var(--purple)' : 'var(--border)'}\`,
            color: showAi ? 'var(--purple)' : 'var(--text-dim)',
            fontFamily:'var(--mono)', fontSize:'0.62rem', fontWeight:700,
            letterSpacing:'0.08em', padding:'0.25rem 0.75rem',
            borderRadius:2, cursor:'pointer', transition:'all 0.12s',
          }}
        >◆ AI ANALYST</button>
        <button className="cmp-close-btn" onClick={() => closeTab(tab.id)}>CLOSE</button>
      </div>

      {/* Grid + AI layout */}
      <div style={{flex:1, overflow:'hidden', display:'flex', flexDirection:'column'}}>
        <div className="cmp-grid" style={{flex:1, overflow:'auto'}}>
          <table className="cmp-table">
            <thead>
              <tr>
                <th className="cmp-corner">
                  <span style={{fontSize:'0.58rem',fontWeight:700,letterSpacing:'0.1em',color:'var(--text-dim)'}}>FIELD</span>
                </th>
                {trades.map(t => {
                  const acColor = AC_COLOR[t.asset_class] || 'var(--text)'
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
                      <div style={{marginTop:'0.25rem'}}>
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
                const sectionDiffs = rows.filter(r => differs(trades, r.fn)).length
                return [
                  <tr key={\`sec-\${sectionKey}\`} className="cmp-section-row">
                    <td colSpan={trades.length + 1}>
                      {sectionKey}
                      {sectionDiffs > 0 && (
                        <span style={{
                          marginLeft:'0.75rem', fontSize:'0.58rem',
                          color:'var(--amber)', fontWeight:700,
                          background:'color-mix(in srgb,var(--amber) 15%,transparent)',
                          padding:'0.1rem 0.4rem', borderRadius:2,
                        }}>{sectionDiffs} differ</span>
                      )}
                    </td>
                  </tr>,
                  ...rows.map(row => {
                    const vals = trades.map(row.fn)
                    const isDiff = differs(trades, row.fn)
                    return (
                      <tr key={\`\${sectionKey}-\${row.label}\`}>
                        <td className="row-lbl">
                          {row.label}
                          {isDiff && (
                            <span style={{
                              marginLeft:'0.5rem', fontSize:'0.55rem',
                              color:'var(--amber)', fontWeight:700,
                            }}>●</span>
                          )}
                        </td>
                        {vals.map((v, i) => (
                          <td key={i} className={\`data-cell \${isDiff?'cmp-diff':''}\`}
                            style={isDiff ? {
                              boxShadow:'inset 0 0 0 1px color-mix(in srgb,var(--amber) 25%,transparent)',
                            } : {}}>
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

        {/* AI Panel */}
        {showAi && (
          <AiAnalysisPanel trades={trades} onClose={() => setShowAi(false)}/>
        )}
      </div>
    </div>
  )
}
`;

fs.writeFileSync(cmpPath, newFile, 'utf8');
console.log('✅  CompareWorkspace.jsx — AI analyst panel + diff badges added');
console.log('');
console.log('New features:');
console.log('  ● diff badge on each row label where values differ');
console.log('  "X differ" badge on each section header');
console.log('  "X DIFFERENCES" badge in top header bar');
console.log('  ◆ AI ANALYST button — opens AI panel at bottom');
console.log('  Quick question buttons: key differences, curve risk, cashflows, concerns');
console.log('  Free-form chat — ask anything about the selected trades');
console.log('  Multi-turn conversation — follow-up questions work');
console.log('  Purple colour coding for AI panel');

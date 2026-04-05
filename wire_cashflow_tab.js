// wire_cashflow_tab.js
// Run: node C:\Users\mikod\OneDrive\Desktop\Rijeka\wire_cashflow_tab.js

const fs = require('fs');
const PATH = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx';

let f = fs.readFileSync(PATH, 'utf8');

// ── 1. Add CASHFLOWS tab to tabs list ─────────────────────────────────────────
f = f.replace(
  `{[{id:'main',label:bookedTrade?'✓ TRADE':'TRADE'},{id:'price',label:'ALL-IN PRICE'},{id:'confirm',label:'⬡ CONFIRM'}].map(t=>(`,
  `{[{id:'main',label:bookedTrade?'✓ TRADE':'TRADE'},{id:'price',label:'ALL-IN PRICE'},{id:'cashflows',label:'CASHFLOWS'},{id:'confirm',label:'⬡ CONFIRM'}].map(t=>(`
);

// ── 2. Add cashflow tab content before the confirm tab stub ───────────────────
f = f.replace(
  `        {activeTab==='confirm' && <div className="tbw-body tbw-no-drag"><div className="tbw-stub"><div className="tbw-stub-title">⬡ CONFIRM</div><div className="tbw-stub-sub">Cashflow fingerprint · On-chain signing</div><div className="tbw-stub-sprint">SPRINT 6A</div></div></div>}`,
  `        {activeTab==='confirm' && <div className="tbw-body tbw-no-drag"><div className="tbw-stub"><div className="tbw-stub-title">⬡ CONFIRM</div><div className="tbw-stub-sub">Cashflow fingerprint · On-chain signing</div><div className="tbw-stub-sprint">SPRINT 6A</div></div></div>}

        {activeTab==='cashflows' && (
          <div className="tbw-no-drag" style={{flex:1,overflowY:'auto',padding:'10px 16px',display:'flex',flexDirection:'column',gap:'10px'}}>
            {!analytics ? (
              <div style={{fontSize:'0.46rem',color:'var(--text-dim)',fontFamily:'var(--mono)',padding:'12px 0'}}>
                Price the trade first to view cashflow schedule.
              </div>
            ) : (
              <>
                {/* Summary strip */}
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'6px'}}>
                  {[
                    {label:'NET NPV', val:fmtPnl(analytics.npv), color: analytics.npv>=0?'var(--accent)':'var(--red)'},
                    {label:'FIXED LEG PV', val:fmtPnl(legs.find(l=>l.leg_type==='FIXED')?.pv), color:'var(--red)'},
                    {label:'FLOAT LEG PV', val:fmtPnl(legs.find(l=>l.leg_type==='FLOAT')?.pv), color:'var(--accent)'},
                    {label:'PERIODS', val:\`\${legs.find(l=>l.leg_type==='FIXED')?.cashflows?.length||0} + \${legs.find(l=>l.leg_type==='FLOAT')?.cashflows?.length||0}\`, color:'var(--blue)'},
                  ].map(s=>(
                    <div key={s.label} style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',padding:'6px 8px'}}>
                      <div style={{fontSize:'0.38rem',color:'var(--text-dim)',letterSpacing:'0.08em',marginBottom:'2px'}}>{s.label}</div>
                      <div style={{fontSize:'0.58rem',fontWeight:700,fontFamily:'var(--mono)',color:s.color}}>{s.val}</div>
                    </div>
                  ))}
                </div>

                {/* Per-leg cashflow tables */}
                {legs.map((leg,li)=>(
                  <div key={li}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'6px 0 4px',borderBottom:'1px solid var(--border)',marginBottom:'0'}}>
                      <span style={{fontSize:'0.42rem',fontWeight:700,letterSpacing:'0.12em',color:'var(--text-dim)'}}>{leg.leg_type} LEG</span>
                      <span style={{fontSize:'0.38rem',fontWeight:700,padding:'1px 6px',borderRadius:'2px',
                        background: leg.direction==='PAY'?'rgba(224,80,64,0.10)':'rgba(13,212,168,0.10)',
                        border: \`1px solid \${leg.direction==='PAY'?'var(--red)':'var(--accent)'}\`,
                        color: leg.direction==='PAY'?'var(--red)':'var(--accent)',
                      }}>{leg.direction==='PAY'?'→ PAY':'← RECEIVE'}</span>
                      <span style={{fontSize:'0.38rem',color:'var(--text-dim)',marginLeft:'auto'}}>
                        {leg.leg_type==='FIXED'
                          ? \`\${(leg.cashflows?.[0]?.rate*100||0).toFixed(4)}% · \${fixedPayFreq} · \${fixedDc}\`
                          : \`\${index} · DAILY COMPOUND · \${floatPayFreq} · \${floatDc}\`}
                      </span>
                    </div>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',minWidth:'700px'}}>
                        <colgroup>
                          <col style={{width:'11%'}}/><col style={{width:'11%'}}/><col style={{width:'11%'}}/>
                          <col style={{width:'7%'}}/><col style={{width:'13%'}}/><col style={{width:'9%'}}/>
                          <col style={{width:'13%'}}/><col style={{width:'9%'}}/><col style={{width:'10%'}}/>
                          <col style={{width:'6%'}}/>
                        </colgroup>
                        <thead>
                          <tr style={{background:'var(--bg)',borderBottom:'1px solid var(--border)'}}>
                            {['PERIOD START','PERIOD END','PAY DATE','DCF','NOTIONAL',leg.leg_type==='FIXED'?'RATE':'FWD RATE','AMOUNT','DF','PV','ZR%'].map(h=>(
                              <th key={h} style={{fontSize:'0.38rem',color:'var(--text-dim)',padding:'4px 6px',
                                textAlign:['PERIOD START','PERIOD END','PAY DATE'].includes(h)?'left':'right',
                                fontWeight:400,letterSpacing:'0.07em'}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(leg.cashflows||[]).map((cf,ci)=>{
                            const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'}) : '—'
                            const fmtN = n => n==null?'—':Math.round(n).toLocaleString('en-US')
                            const pv = cf.pv ?? (cf.amount * (cf.df||1) * (leg.direction==='PAY'?-1:1))
                            return (
                              <tr key={ci} style={{borderBottom:'1px solid var(--panel-2)'}}>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',color:'var(--text-dim)',fontFamily:'var(--mono)'}}>{fmtDate(cf.period_start)}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',color:'var(--text-dim)',fontFamily:'var(--mono)'}}>{fmtDate(cf.period_end)}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',color: cf.payment_date!==cf.period_end?'var(--amber)':'var(--text-dim)',fontFamily:'var(--mono)'}}>{fmtDate(cf.payment_date)}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--blue)'}}>{cf.dcf?cf.dcf.toFixed(5):'—'}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text-dim)'}}>{fmtN(cf.notional)}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--blue)'}}>{cf.rate!=null?(cf.rate*100).toFixed(4)+'%':'—'}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text)'}}>{fmtN(cf.amount)}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text-dim)'}}>{cf.df?cf.df.toFixed(5):'—'}</td>
                                <td style={{fontSize:'0.48rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',fontWeight:600,
                                  color:pv>=0?'var(--accent)':'var(--red)'}}>{fmtPnl(pv)}</td>
                                <td style={{fontSize:'0.42rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text-dim)'}}>{cf.zero_rate!=null?(cf.zero_rate*100).toFixed(3):'—'}</td>
                              </tr>
                            )
                          })}
                          {/* Total row */}
                          <tr style={{borderTop:'2px solid var(--border)',background:'rgba(255,255,255,0.02)'}}>
                            <td colSpan={6} style={{fontSize:'0.42rem',fontWeight:700,color:'var(--text-dim)',padding:'5px 6px',letterSpacing:'0.08em'}}>TOTAL</td>
                            <td style={{fontSize:'0.48rem',fontWeight:700,padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text)'}}>
                              {Math.round((leg.cashflows||[]).reduce((s,cf)=>s+(cf.amount||0),0)).toLocaleString('en-US')}
                            </td>
                            <td/>
                            <td style={{fontSize:'0.48rem',fontWeight:700,padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',
                              color:leg.pv>=0?'var(--accent)':'var(--red)'}}>
                              {fmtPnl(leg.pv)}
                            </td>
                            <td/>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {/* Footer */}
                <div style={{fontSize:'0.40rem',color:'var(--text-dim)',fontFamily:'var(--mono)',padding:'4px 0'}}>
                  ⟳ {CCY_CURVE[ccy]||'USD_SOFR'} · {analytics.curve_mode} · {analytics.valuation_date}
                  {' · '}pay dates highlighted in amber when shifted by holiday calendar
                </div>
              </>
            )}
          </div>
        )}`
);

fs.writeFileSync(PATH, f, 'utf8');
console.log('Done. CASHFLOW tab wired.');
console.log('');
console.log('Features:');
console.log('  - Summary strip: NET NPV, fixed PV, float PV, period count');
console.log('  - Fixed leg table: period dates, pay date, DCF, notional, rate, amount, DF, PV, zero rate');
console.log('  - Float leg table: same columns + forward rate per period');
console.log('  - Pay dates highlighted amber when shifted vs period end (holiday/weekend)');
console.log('  - Total row per leg');
console.log('  - Footer shows curve/snapshot/valuation date');
console.log('  - Price first → click CASHFLOWS tab to see schedule');

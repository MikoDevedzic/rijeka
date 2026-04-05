// PricerPage.jsx — Sprint 5D+6D — matched to approved rijeka_pricer_v2.html
import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import './PricerPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
async function authHdrs() {
  const { data: { session } } = await supabase.auth.getSession()
  return { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }
}
const QT_MAP = { OISDeposit:'DEPOSIT',Deposit:'DEPOSIT',OIS:'OIS_SWAP',BASIS:'IRS',FRA:'FRA',FUTURES:'FUTURES',IRS:'IRS' }
const mapQt  = qt => QT_MAP[qt]||qt
const today  = () => new Date().toISOString().slice(0,10)
const fmtAmt = v => v==null?'—':(v>=0?'+':'-')+'$'+Math.abs(v).toLocaleString('en-US',{maximumFractionDigits:0})
const fmtPct = v => v==null?'—':(v*100).toFixed(4)+'%'
const fmtDf  = v => v==null?'—':v.toFixed(6)
const npvClr = v => v==null?'#666666':v>=0?'#0dd4a8':'#e05040'
const timestamp = () => { const n=new Date(); return n.toISOString().slice(11,19)+' UTC' }

// ── Tooltip ──────────────────────────────────────────────────────────────────
const TTS = {
  tv:    {t:'TV — THEORETICAL VALUE',b:'Risk-neutral price. No default, no funding, no capital. Mid-market from the swap curve.',f:'TV = Σ N·f(T)·δ·P_OIS(0,T) − K·Σ N·δ·P_OIS(0,T)'},
  cva:   {t:'CVA — CREDIT VALUATION ADJUSTMENT',b:'Cost of counterparty default risk. Driven by CDS spread × expected exposure.',f:'CVA = −(1−R) × Σ EE(t) × ΔPD(t) × P_OIS(0,t)'},
  dva:   {t:'DVA — DEBIT VALUATION ADJUSTMENT',b:'Benefit of own default risk. Required by IFRS 13.',f:'DVA = mirror of CVA on negative exposures (ENE)'},
  fva:   {t:'FVA — FUNDING VALUATION ADJUSTMENT',b:'Cost of funding uncollateralised MtM. When you hedge with CCP but client has no CSA.',f:'FVA = Σ (EE−ENE) × s_fund × P_OIS(0,t)'},
  colva: {t:'ColVA — COLLATERAL VALUATION ADJUSTMENT',b:'Value of optionality in CSA terms. CTD option in collateral agreement.',f:'ColVA = value of cheapest-to-deliver option'},
  mva:   {t:'MVA — MARGIN VALUATION ADJUSTMENT',b:'Cost of funding initial margin under UMR.',f:'MVA = Σ IM(t) × s_fund × P_OIS(0,t)'},
  kva:   {t:'KVA — CAPITAL VALUATION ADJUSTMENT',b:'Cost of holding SA-CCR capital over trade life.',f:'KVA = Σ K_SA-CCR(t) × hurdle_rate × P_OIS(0,t)'},
  ir01:  {t:'IR01 — INTEREST RATE SENSITIVITY',b:'+1bp parallel shift ALL curves. DV01/PV01 BANNED in Rijeka.',f:'IR01 = NPV(forecast+1bp) − NPV(forecast)'},
  ir01d: {t:'IR01_DISC — DISCOUNT CURVE SENSITIVITY',b:'+1bp discount curve only. Forecast curve unchanged.',f:'IR01_DISC = NPV(discount+1bp) − NPV(discount)'},
  theta: {t:'THETA — TIME DECAY',b:'NPV(T+1 day) − NPV(T). Calendar day method.',f:'THETA = NPV(T+1) − NPV(T)'},
}
function Tooltip({ id, children }) {
  const t = TTS[id]; if (!t) return <span>{children}</span>
  const wrapRef=useRef(null); const tipRef=useRef(null)
  const show=()=>{
    const tip=tipRef.current; const wrap=wrapRef.current; if(!tip||!wrap) return
    tip.style.display='block'
    const r=wrap.getBoundingClientRect()
    let left=r.left, top=r.bottom+8
    if (left+280>window.innerWidth-10) left=window.innerWidth-290
    if (top+160>window.innerHeight-10) top=r.top-170
    tip.style.left=left+'px'; tip.style.top=top+'px'
  }
  const hide=()=>{ if(tipRef.current) tipRef.current.style.display='none' }
  return (
    <span ref={wrapRef} className="xr-tt-wrap" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      <div ref={tipRef} className="ttp">
        <div className="ttp-title">{t.t}</div>
        <div style={{marginBottom:4,fontSize:'.48rem',color:'#8ab0c8',lineHeight:1.7}}>{t.b}</div>
        <div className="ttp-formula">{t.f}</div>
      </div>
    </span>
  )
}

// ── XVA row component ─────────────────────────────────────────────────────────
function XvaRow({ label, tip, desc, sub, trad, chain, save, pct, dim, barT=0, barC=0, stub }) {
  return (
    <div className={`xva-r${dim?' xva-dim':''}`}>
      <div className="xr-lbl">
        {tip ? <Tooltip id={tip}>{label} <span className="xr-tt">?</span></Tooltip> : label}
      </div>
      <div>
        <div className="xr-desc">{desc}</div>
        {sub && <div className="xr-sub">{sub}</div>}
        {(barT>0||barC>0) && (
          <div className="xr-bar">
            <div className="xr-bar-t" style={{width:barT+'%'}}/>
            <div className="xr-bar-c" style={{width:barC+'%'}}/>
          </div>
        )}
      </div>
      <div className="xr-trad c-red">
        {stub ? <span className="sprint-stub">SPRINT 5D</span> : (trad!=null?fmtAmt(trad):'—')}
      </div>
      <div className="xr-chain">{chain!=null?fmtAmt(chain):'—'}</div>
      <div className="xr-save c-teal">{save!=null?fmtAmt(save):'—'}</div>
      <div className="xr-pct">
        {pct!=null ? <span className={`pct-badge${pct<0?' pct-good':' pct-neg'}`}>{pct<0?pct+'%':'+'+pct+'%'}</span> : '—'}
      </div>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function PricerPage() {
  const [sp] = useSearchParams()

  // Mode
  const [mode, setMode]     = useState('booked')

  // Booked trade
  const [trades, setTrades] = useState([])
  const [tLd, setTLd]       = useState(true)
  const [selId, setSelId]   = useState(sp.get('trade')||'')
  const [selTrade, setSel]  = useState(null)
  const [valDate, setValDate] = useState(today())

  // Curve state
  const [curveIds, setCurveIds]   = useState([])
  const [snapshots, setSnaps]     = useState({})
  const [overrides, setOvr]       = useState({})  // {cid: {enabled,rate}}
  const [bumps, setBumps]         = useState({})   // {cid: {parallel,tenors}}
  const [curvePillars, setCvPils] = useState({})
  const [curveSource, setCvSrc]   = useState('DB') // DB | MANUAL | BUMP
  const [showPillars, setShowPils] = useState(false)

  // Scenario
  const [scenario, setScen]       = useState('BASE')

  // Results
  const [result, setResult]     = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [cfOpen, setCfOpen]     = useState(false)
  const [promOpen, setPromOpen] = useState(true)
  const [ts, setTs]             = useState('')

  // Quote mode
  const [quoteCps, setQCps]   = useState([])
  const [quoteCpId, setQCpId] = useState('')
  const [quoteInst, setQInst] = useState('IR_SWAP')
  const [quoteDir, setQDir]   = useState('PAY')
  const [quoteNtl, setQNtl]   = useState('10,000,000')
  const [quoteCcy, setQCcy]   = useState('USD')
  const [quoteTenor, setQTnr] = useState('5Y')
  const [urgency, setUrg]     = useState('MEDIUM')

  // Load trades
  useEffect(() => {
    ;(async()=>{
      setTLd(true)
      try { const h=await authHdrs(); const r=await fetch(API+'/api/trades/',{headers:h}); if(r.ok) setTrades(await r.json()) } catch{}
      setTLd(false)
    })()
  },[])

  // On trade select
  useEffect(()=>{
    if (!selId) { setCurveIds([]); setSnaps({}); setResult(null); setSel(null); return }
    setSel(trades.find(t=>t.id===selId)||null)
    setResult(null); setError(null)
    ;(async()=>{
      try {
        const h=await authHdrs()
        const r=await fetch(`${API}/api/trade-legs/${selId}`,{headers:h})
        const legs=r.ok?await r.json():[]
        const ids=new Set()
        ;(Array.isArray(legs)?legs:[]).forEach(l=>{
          if(l.discount_curve_id) ids.add(l.discount_curve_id)
          if(l.forecast_curve_id) ids.add(l.forecast_curve_id)
        })
        if(ids.size===0) ids.add('default')
        const idArr=Array.from(ids)
        setCurveIds(idArr)
        const ov={},bmp={}
        idArr.forEach(id=>{ov[id]={enabled:false,rate:'5.25'};bmp[id]={parallel:'',tenors:{}}})
        setOvr(ov); setBumps(bmp); setCvPils({})
        const snaps={}
        await Promise.all(idArr.map(async cid=>{
          try{const sr=await fetch(`${API}/api/market-data/snapshots/${cid}/latest`,{headers:h}); const sd=await sr.json(); if(sd.exists) snaps[cid]=sd}catch{}
        }))
        setSnaps(snaps)
      } catch(e){setError('Failed to load curves: '+e.message)}
    })()
  },[selId,trades])

  useEffect(()=>{ if(selId&&trades.length>0) setSel(trades.find(t=>t.id===selId)||null) },[trades,selId])

  // Quote mode CPs
  useEffect(()=>{
    if(mode!=='quote') return
    ;(async()=>{ const h=await authHdrs(); const r=await fetch(API+'/api/counterparties/',{headers:h}); if(r.ok) setQCps(await r.json()) })()
  },[mode])

  // Handlers
  const onOvr = useCallback((cid,v)=>setOvr(o=>({...o,[cid]:{...o[cid],enabled:v}})),[])
  const onRate= useCallback((cid,v)=>setOvr(o=>({...o,[cid]:{...o[cid],rate:v}})),[])
  const onPar = useCallback((cid,v)=>setBumps(b=>({...b,[cid]:{...b[cid],parallel:v}})),[])
  const onTnr = useCallback((cid,tenor,v)=>setBumps(b=>({...b,[cid]:{...b[cid],tenors:{...b[cid]?.tenors,[tenor]:v}}})),[])
  const onEditQ= useCallback((cid,idx,v)=>{
    setSnaps(s=>{ const snap=s[cid]; if(!snap?.quotes) return s
      return {...s,[cid]:{...snap,quotes:snap.quotes.map((q,i)=>i===idx?{...q,rate:parseFloat(v)||q.rate}:q)}}
    })
  },[])

  const buildCurves = useCallback(()=>{
    return curveIds.map(cid=>{
      const ov=overrides[cid]||{}; const bmp=bumps[cid]||{}; const snap=snapshots[cid]
      if(ov.enabled||curveSource==='MANUAL') return {curve_id:cid,flat_rate:parseFloat(ov.rate||'5.25')/100}
      if(snap?.quotes?.length>=2){
        const pBps=parseFloat(bmp.parallel||'0')||0
        const bpScen=scenario==='+100'?100:scenario==='-100'?-100:scenario==='STRESS'?200:0
        const quotes=snap.quotes.filter(q=>q.enabled!==false).map(q=>{
          const tBps=parseFloat(bmp.tenors?.[q.tenor]||'0')||0
          return {tenor:q.tenor,quote_type:mapQt(q.quote_type),rate:(q.rate+(tBps+pBps+bpScen)/100)/100}
        })
        if(quotes.length>=2) return {curve_id:cid,quotes}
      }
      if(curveSource==='BUMP'){
        const pBps=parseFloat(bmp.parallel||'0')||0
        if(pBps!==0) return {curve_id:cid,bump_bps:pBps}
      }
      return {curve_id:cid}
    })
  },[curveIds,overrides,bumps,snapshots,curveSource,scenario])

  const handleRun = useCallback(async()=>{
    if(!selId) return
    setLoading(true); setError(null); setResult(null); setCvPils({})
    try {
      const h=await authHdrs()
      const body={trade_id:selId,valuation_date:valDate,curves:buildCurves()}
      const r=await fetch(API+'/price',{method:'POST',headers:h,body:JSON.stringify(body)})
      if(!r.ok){const e=await r.json().catch(()=>({detail:r.statusText})); throw new Error(e.detail||'Pricing failed')}
      const data=await r.json()
      setResult(data); setTs(timestamp())
      if(data.curve_pillars) setCvPils(data.curve_pillars)
    } catch(e){setError(e.message)}
    finally{setLoading(false)}
  },[selId,valDate,buildCurves])

  const ccy = selTrade?.notional_ccy||'USD'
  const xvaData=[
    {label:'CVA',tip:'cva',desc:'Credit Valuation Adjustment',sub:selTrade?.counterparty?.name?`${selTrade.counterparty.name} CDS spread · Recovery 40%`:undefined,trad:result?.cva,barT:63,barC:19},
    {label:'DVA',tip:'dva',desc:'Debit Valuation Adjustment',sub:'Own default benefit · IFRS 13',trad:result?.dva},
    {label:'FVA',tip:'fva',desc:'Funding Valuation Adjustment',sub:'Funding spread · ⬡ atomic settlement eliminates gap',trad:result?.fva,barT:41,barC:4},
    {label:'ColVA',tip:'colva',desc:'Collateral Valuation Adjustment',sub:'USD cash CSA · smart contract removes optionality',trad:result?.colva,dim:true},
    {label:'MVA',tip:'mva',desc:'Margin Valuation Adjustment',sub:'SIMM IM profile · tokenised IM earns yield on-chain',trad:result?.mva,dim:true},
    {label:'KVA',tip:'kva',desc:'Capital Valuation Adjustment',sub:'SA-CCR capital · hurdle 10%',trad:result?.kva,dim:true},
  ]
  const xvaTotal=xvaData.reduce((s,r)=>s+(r.trad||0),0)
  const hasBumps=curveIds.some(cid=>{const b=bumps[cid]||{}; return (parseFloat(b.parallel)||0)!==0||Object.values(b.tenors||{}).some(v=>(parseFloat(v)||0)!==0)})

  // Compact key curve rates for display
  const firstSnap = snapshots[curveIds[0]]
  const keyRates = firstSnap?.quotes?.filter(q=>['2Y','5Y','10Y','30Y'].includes(q.tenor))||[]

  const promText = result
    ? `${selTrade?.trade_ref} — ${selTrade?.instrument_type}. NPV ${fmtAmt(result.npv)} · IR01 ${fmtAmt(result.ir01)}/bp · Theta ${fmtAmt(result.theta)}/day. XVA stubs — backend Sprint 5D.`
    : selId ? `Trade loaded. Review curve inputs and click ▶ RUN PRICER.` : 'Select a trade to begin pricing.'

  return (
    <div className="pp-root">

      {/* ─── LEFT PANEL ─── */}
      <div className="pp-lp">

        {/* Mode toggle */}
        <div className="mode-toggle">
          <button className={`mode-btn${mode==='booked'?' on':''}`} onClick={()=>setMode('booked')}>BOOKED TRADE</button>
          <button className={`mode-btn quote-mode${mode==='quote'?' on':''}`} onClick={()=>setMode('quote')}>NEW QUOTE</button>
        </div>

        <div className="lp-scroll">

          {/* ─ BOOKED TRADE ─ */}
          {mode==='booked' && (<>
            <div className="lp-sect">
              <span className="ll">TRADE</span>
              {tLd
                ? <div className="pp-dim-xs">Loading...</div>
                : <select className="lps" value={selId} onChange={e=>setSelId(e.target.value)}>
                    <option value="">— select trade —</option>
                    {trades.map(t=><option key={t.id} value={t.id}>{t.trade_ref} · {t.instrument_type} · {(t.notional||0).toLocaleString('en-US',{maximumFractionDigits:0})} {t.notional_ccy}</option>)}
                  </select>}
              {selTrade && (
                <div className="trade-card">
                  <div className="tc-id">{selTrade.trade_ref}</div>
                  <div className="tc-row"><span className="tc-lbl">Instrument</span><span className="tc-val">{selTrade.instrument_type}{selTrade.structure?` · ${selTrade.structure}`:''}</span></div>
                  <div className="tc-row"><span className="tc-lbl">Notional</span><span className="tc-val">{(selTrade.notional||0).toLocaleString()} {selTrade.notional_ccy}</span></div>
                  <div className="tc-row"><span className="tc-lbl">Maturity</span><span className="tc-val">{selTrade.maturity_date?.slice(0,10)||'—'}</span></div>
                  <div className="tc-row"><span className="tc-lbl">Counterparty</span><span className="tc-val" style={{color:'#0dd4a8'}}>{selTrade.counterparty?.name||'—'}</span></div>
                  <div className="tc-row"><span className="tc-lbl">CSA</span><span className="tc-val">{selTrade.counterparty?.csa_type||'—'}</span></div>
                  <div className="tc-row"><span className="tc-lbl">⬡ Status</span><span className="tc-val" style={{color:'#666666'}}>NOT ON NETWORK</span></div>
                </div>
              )}
            </div>

            <div className="lp-sect">
              <span className="ll">VALUATION DATE</span>
              <input className="lps" type="date" style={{fontFamily:'JetBrains Mono,monospace'}} value={valDate} onChange={e=>setValDate(e.target.value)}/>
            </div>

            <div className="lp-sect">
              <span className="ll">CURVE SOURCE</span>
              <div className="chip-row" style={{marginBottom:6}}>
                {['DB','MANUAL','BUMP'].map(s=>(
                  <div key={s} className={`chip curve-chip${curveSource===s?' on':''}`} onClick={()=>setCvSrc(s)}>{s}</div>
                ))}
              </div>
              {/* Compact key rates */}
              {curveSource==='DB' && keyRates.map(q=>(
                <div key={q.tenor} className="curve-row">
                  <span className="cr-lbl">{q.tenor} {curveIds[0]?.replace('USD_','')?.replace('_OIS','')}</span>
                  <input className="cr-val" type="text" value={typeof q.rate==='number'?q.rate.toFixed(4):(q.rate||'')}
                    onChange={e=>onEditQ(curveIds[0],firstSnap?.quotes?.indexOf(q),e.target.value)}/>
                  <span className="cr-src">BGN</span>
                </div>
              ))}
              {(curveSource==='MANUAL'||(!firstSnap&&curveIds.length>0)) && curveIds.map(cid=>{
                const ov=overrides[cid]||{rate:'5.25'}
                return (
                  <div key={cid} className="curve-row">
                    <span className="cr-lbl">{cid}</span>
                    <input className="cr-val" type="text" value={ov.rate} onChange={e=>onRate(cid,e.target.value)}/>
                    <span className="cr-src">MAN</span>
                  </div>
                )
              })}
              {curveSource==='BUMP' && curveIds.map(cid=>{
                const bmp=bumps[cid]||{}
                return (
                  <div key={cid} className="curve-row">
                    <span className="cr-lbl">PARALLEL {cid}</span>
                    <input className="cr-val" type="text" value={bmp.parallel} placeholder="0" onChange={e=>onPar(cid,e.target.value)} style={{color:'#f0a020'}}/>
                    <span className="cr-src">bps</span>
                  </div>
                )
              })}
              {/* Full curve toggle */}
              {firstSnap?.quotes?.length>0 && (
                <div className="pp-view-full" onClick={()=>setShowPils(p=>!p)}>
                  {showPillars?'▾ COLLAPSE FULL CURVE':'▸ VIEW FULL CURVE + DF / ZERO'}
                </div>
              )}
              {/* Full pillar table */}
              {showPillars && firstSnap?.quotes?.length>0 && (() => {
                const cid=curveIds[0]
                const bmp=bumps[cid]||{}
                const pils=curvePillars?.[cid]||curvePillars?.['default']||[]
                const pBps=parseFloat(bmp.parallel||'0')||0
                return (
                  <table className="pp-pillar-table">
                    <thead><tr><th>TNR</th><th>QUOTE%</th><th>BMP</th><th>EFF%</th><th>ZERO%</th><th>DF</th><th>FWD%</th></tr></thead>
                    <tbody>
                      {firstSnap.quotes.filter(q=>q.enabled!==false).map((q,i)=>{
                        const tBps=parseFloat(bmp.tenors?.[q.tenor]||'0')||0
                        const eff=(q.rate||0)+(tBps+pBps)/100
                        const pil=pils[i]
                        return (
                          <tr key={i} className={tBps!==0?'pp-row-bumped':''}>
                            <td className="dim">{q.tenor}</td>
                            <td><input className="pp-quote-edit" type="text" value={typeof q.rate==='number'?q.rate.toFixed(3):(q.rate||'')} onChange={e=>onEditQ(cid,i,e.target.value)}/></td>
                            <td><input className="pp-tenor-bump" type="text" value={bmp.tenors?.[q.tenor]||''} placeholder="0" onChange={e=>onTnr(cid,q.tenor,e.target.value)}/></td>
                            <td className={`mono${(tBps||pBps)?' eff-bumped':''}`}>{eff.toFixed(3)}</td>
                            <td className="mono zero-val">{pil?.zero_rate!=null?(pil.zero_rate*100).toFixed(3)+'%':'—'}</td>
                            <td className="mono df-val">{pil?.df!=null?pil.df.toFixed(5):'—'}</td>
                            <td className="mono fwd-val">{pil?.forward_rate!=null?(pil.forward_rate*100).toFixed(3)+'%':'—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )
              })()}
            </div>

            <div className="lp-sect">
              <span className="ll">SCENARIO</span>
              <div className="chip-row">
                {['BASE','+100bp','−100bp','STRESS'].map((s,i)=>{
                  const v=['BASE','+100','-100','STRESS'][i]
                  return <div key={s} className={`chip scen-chip${scenario===v?' on':''}`} onClick={()=>setScen(v)}>{s}</div>
                })}
              </div>
            </div>

            <div className="lp-sect">
              {error && <div className="pp-error">{error}</div>}
              <button className="btn-run" onClick={handleRun} disabled={loading||!selId}>
                {loading?'⟳  PRICING...':hasBumps||scenario!=='BASE'?'▶  RUN SCENARIO':'▶  RUN PRICER'}
              </button>
            </div>
          </>)}

          {/* ─ NEW QUOTE ─ */}
          {mode==='quote' && (<>
            <div className="lp-sect">
              <span className="ll">CLIENT</span>
              <select className="lps" value={quoteCpId} onChange={e=>setQCpId(e.target.value)}>
                <option value="">— select client —</option>
                {quoteCps.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {quoteCpId && (() => { const cp=quoteCps.find(c=>c.id===quoteCpId); return cp ? (
                <div className="client-card">
                  <div className="cl-name">{cp.name}</div>
                  <div className="cl-row"><span className="cl-lbl">CSA type</span><span className="cl-val ok">{cp.csa_type||'—'}</span></div>
                  <div className="cl-row"><span className="cl-lbl">CDS spread</span><span className="cl-val">{cp.cds_spread_bps||'—'}bp</span></div>
                  <div className="cl-row"><span className="cl-lbl">⬡ On network</span><span className="cl-val warn">NOT YET</span></div>
                </div>
              ) : null})()}
            </div>
            <div className="lp-sect">
              <span className="ll">INSTRUMENT</span>
              <select className="lps" value={quoteInst} onChange={e=>setQInst(e.target.value)}>
                <option value="IR_SWAP">IR SWAP · VANILLA OIS</option>
                <option value="IR_SWAP_BASIS">IR SWAP · BASIS</option>
                <option value="IR_SWAPTION">SWAPTION</option>
                <option value="IR_CAP">CAP</option>
                <option value="IR_FLOOR">FLOOR</option>
                <option value="IR_COLLAR">COLLAR</option>
              </select>
            </div>
            <div className="lp-sect">
              <span className="ll">DIRECTION</span>
              <div className="chip-row">
                <div className={`chip pay${quoteDir==='PAY'?' on':''}`} onClick={()=>setQDir('PAY')}>CLIENT PAYS FIXED</div>
                <div className={`chip rec${quoteDir==='RECEIVE'?' on':''}`} onClick={()=>setQDir('RECEIVE')}>CLIENT RECEIVES</div>
              </div>
            </div>
            <div className="lp-sect">
              <span className="ll">ECONOMICS</span>
              <div className="frow c2" style={{marginBottom:5}}>
                <div className="ff"><label className="fl">NOTIONAL</label><input className="fi" value={quoteNtl} onChange={e=>setQNtl(e.target.value)}/></div>
                <div className="ff"><label className="fl">CCY</label><select className="fi" value={quoteCcy} onChange={e=>setQCcy(e.target.value)}>{['USD','EUR','GBP','JPY','CHF'].map(c=><option key={c}>{c}</option>)}</select></div>
              </div>
              <div className="frow c2">
                <div className="ff"><label className="fl">TENOR</label><select className="fi" value={quoteTenor} onChange={e=>setQTnr(e.target.value)}>{['1Y','2Y','3Y','5Y','7Y','10Y','15Y','20Y','30Y'].map(t=><option key={t}>{t}</option>)}</select></div>
                <div className="ff"><label className="fl">FLOAT INDEX</label><select className="fi"><option>SOFR COMPOUND</option><option>EURIBOR 3M</option><option>SONIA</option></select></div>
              </div>
            </div>
            <div className="lp-sect">
              <span className="ll">CLIENT URGENCY</span>
              <div className="urg-row">
                {['LOW','MEDIUM','HIGH'].map(u=><button key={u} className={`urg ${u.toLowerCase()}${urgency===u?' on':''}`} onClick={()=>setUrg(u)}>{u}</button>)}
              </div>
            </div>
            <div className="lp-sect">
              <button className="btn-run quote" disabled>▶ PRICE INSTANTLY — SPRINT 6D</button>
            </div>
          </>)}

          {/* PROMETHEUS — always visible */}
          <div style={{padding:8}}>
            <div className="prom">
              <div className="prom-hdr" onClick={()=>setPromOpen(p=>!p)}>
                <span className="prom-icon">✦</span>
                <span className="prom-lbl">PROMETHEUS</span>
                <span className="prom-tog">{promOpen?'▼':'▶'}</span>
              </div>
              {promOpen && (
                <div className="prom-body">
                  <span>{promText}</span>
                  {result && <div className="prom-flag">→ XVA waterfall stubs will populate in Sprint 5D. Blockchain column requires counterparty on Rijeka Confirms network.</div>}
                </div>
              )}
            </div>
          </div>

        </div>{/* /lp-scroll */}
      </div>{/* /lp */}

      {/* ─── SCROLL CONTENT ─── */}
      <div className="pp-sc">

        {!result && !loading && (
          <div className="pp-empty">
            {mode==='booked'?(selId?'Click ▶ RUN PRICER to price this trade.':'Select a trade to begin.'):'Configure quote parameters and click ▶ PRICE INSTANTLY.'}
          </div>
        )}
        {loading && <div className="pp-empty">Pricing...</div>}

        {result && mode==='booked' && (<>

          {/* Result header */}
          <div className="result-hdr">
            <span className="rh-main">{selTrade?.trade_ref} · {selTrade?.instrument_type} · {selTrade?.notional?.toLocaleString()} {ccy} · {valDate} · FULL REPRICE</span>
            <span className="rh-time">Computed {ts}</span>
            <span className="badge b-ok">✓ PRICING COMPLETE</span>
          </div>

          {/* NPV box — booked trade mode */}
          <div className="quote-box">
            <div className="npv-row">
              <div className="npv-col">
                <div className="npv-lbl">NPV · TRADITIONAL</div>
                <div className="npv-val" style={{color:'#0dd4a8'}}>{fmtAmt(result.npv)}</div>
                <div className="npv-sub">TV {fmtAmt(result.npv)} · XVA stubs pending Sprint 5D</div>
              </div>
              <div className="npv-col">
                <div className="npv-lbl">⬡ NPV · BLOCKCHAIN</div>
                <div className="npv-val" style={{color:'#f07820'}}>—</div>
                <div className="npv-sub">Counterparty not on network</div>
              </div>
              <div className="npv-col">
                <div className="npv-lbl">BLOCKCHAIN PREMIUM</div>
                <div className="npv-val" style={{color:'#ffffff'}}>—</div>
                <div className="npv-sub">same trade · same counterparty</div>
              </div>
            </div>
          </div>

          {/* XVA Waterfall */}
          <div className="waterfall">
            <div className="wf-hdr">
              <span className="wf-title">PRICING WATERFALL — TV → XVA → NPV ALL-IN</span>
              <span style={{fontSize:'.44rem',color:'#666666',marginLeft:4}}>traditional vs ⬡ blockchain · auto-detected from counterparty CSA</span>
              <div style={{marginLeft:'auto',display:'flex',gap:6}}>
                <span className="badge b-ok">{selTrade?.counterparty?.csa_type||'NO CSA'}</span>
                <span className="badge b-dim">⬡ NOT CONFIRMED</span>
              </div>
            </div>
            {/* Column headers */}
            <div className="wf-col-hdrs">
              <div/><div style={{fontSize:'.40rem',fontWeight:700,letterSpacing:'.08em',color:'#666666'}}>COMPONENT</div>
              <div className="col-hdr" style={{color:'#666666'}}>TRADITIONAL</div>
              <div className="col-hdr" style={{color:'#f07820'}}>⬡ BLOCKCHAIN</div>
              <div className="col-hdr" style={{color:'#0dd4a8'}}>SAVING</div>
              <div className="col-hdr" style={{color:'#666666'}}>REDUC.</div>
            </div>
            {/* TV row */}
            <div className="tv-row">
              <div className="tv-lbl"><Tooltip id="tv">TV <span className="xr-tt">?</span></Tooltip></div>
              <div className="tv-desc">Theoretical value · risk-neutral · multi-curve bootstrap</div>
              <div className="tv-val">{fmtAmt(result.npv)}</div>
              <div className="tv-val">{fmtAmt(result.npv)}</div>
              <div style={{textAlign:'right',fontSize:'.44rem',color:'#666666',alignSelf:'center'}}>same</div>
              <div style={{textAlign:'right',fontSize:'.42rem',color:'#666666',alignSelf:'center'}}>—</div>
            </div>
            <div className="xva-sec-lbl">XVA ADJUSTMENTS — 6 COMPONENTS</div>
            {xvaData.map(r=>(
              <XvaRow key={r.label} {...r} stub={r.trad==null} />
            ))}
            {/* XVA Total */}
            <div className="xva-total">
              <div className="xt-lbl">XVA</div>
              <div className="xt-name">Total valuation adjustments</div>
              <div className="xt-trad">{xvaTotal!==0?fmtAmt(xvaTotal):<span className="sprint-stub">SPRINT 5D</span>}</div>
              <div className="xt-chain">—</div>
              <div className="xt-save">—</div>
              <div className="xt-pct">—</div>
            </div>
            {/* NPV All-In */}
            <div className="npv-allin">
              <div className="na-lbl">NPV</div>
              <div><div style={{fontSize:'.50rem',fontWeight:700,color:'#8ab0c8'}}>ALL-IN · TV + XVA</div><div className="na-desc">{selTrade?.counterparty?.name||'—'} · {valDate}</div></div>
              <div><div className="na-trad">{fmtAmt(result.npv+xvaTotal)}</div><div style={{fontSize:'.40rem',color:'#666666',textAlign:'right',marginTop:1}}>traditional</div></div>
              <div><div className="na-chain">—</div><div style={{fontSize:'.40rem',color:'#f07820',textAlign:'right',marginTop:1}}>⬡ blockchain</div></div>
              <div><div className="na-save">—</div><div style={{fontSize:'.40rem',color:'#0dd4a8',textAlign:'right',marginTop:1}}>premium</div></div>
              <div className="na-note">Blockchain XVA available once counterparty joins Rijeka Confirms network.</div>
            </div>
          </div>

          {/* Greeks */}
          <div className="greeks">
            {[
              {id:'ir01',lbl:'IR01',val:result.ir01,sub:'per bp · parallel'},
              {id:'ir01d',lbl:'IR01 DISC',val:result.ir01_disc,sub:'discount only'},
              {id:'theta',lbl:'THETA',val:result.theta,sub:'per calendar day'},
              {id:null,lbl:'CARRY / DAY',val:null,sub:'accrual net of theta',stub:true},
              {id:null,lbl:'IR VEGA',val:null,sub:'linear · no vol exposure',stub:true},
              {id:null,lbl:'CS01',val:null,sub:'no credit leg',stub:true},
            ].map(g=>(
              <div key={g.lbl} className="gk">
                <div className="gk-lbl">
                  {g.id?<Tooltip id={g.id}>{g.lbl} <span className="gk-tt">?</span></Tooltip>:g.lbl}
                </div>
                <div className="gk-val" style={{color:g.stub?'#666666':npvClr(g.val)}}>
                  {g.stub?'—':fmtAmt(g.val)}
                </div>
                <div className="gk-sub">{g.sub}</div>
              </div>
            ))}
          </div>

          {/* Leg PV + cashflow */}
          {result.legs?.length>0 && (
            <div className="panel" style={{overflow:'hidden'}}>
              <div className="p-hdr"><span className="p-title">LEG PV BREAKDOWN</span></div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.54rem',fontFamily:'JetBrains Mono,monospace',tableLayout:'fixed'}}>
                  <thead><tr style={{borderBottom:'1px solid #1E1E1E'}}>
                    <th style={{padding:'4px 9px',textAlign:'left',color:'#666666',fontWeight:400,fontSize:'.44rem'}}>LEG</th>
                    <th style={{padding:'4px 9px',color:'#666666',fontWeight:400,fontSize:'.44rem'}}>TYPE</th>
                    <th style={{padding:'4px 9px',color:'#666666',fontWeight:400,fontSize:'.44rem'}}>DIR</th>
                    <th style={{padding:'4px 9px',color:'#666666',fontWeight:400,fontSize:'.44rem',textAlign:'right'}}>PV</th>
                    <th style={{padding:'4px 9px',color:'#666666',fontWeight:400,fontSize:'.44rem',textAlign:'right'}}>IR01</th>
                    <th style={{padding:'4px 9px',color:'#666666',fontWeight:400,fontSize:'.44rem',textAlign:'right'}}>IR01_DISC</th>
                  </tr></thead>
                  <tbody>
                    {result.legs.map((leg,i)=>(
                      <tr key={i} style={{borderBottom:'1px solid rgba(30,48,69,.4)'}}>
                        <td style={{padding:'5px 9px'}}>{leg.leg_ref}</td>
                        <td style={{padding:'5px 9px',color:'#666666'}}>{leg.leg_type}</td>
                        <td style={{padding:'5px 9px'}}><span style={{color:leg.direction==='PAY'?'#e05040':'#0dd4a8',fontWeight:700,fontSize:'.50rem'}}>{leg.direction}</span></td>
                        <td style={{padding:'5px 9px',textAlign:'right',color:npvClr(leg.pv),fontWeight:700}}>{fmtAmt(leg.pv)}</td>
                        <td style={{padding:'5px 9px',textAlign:'right',color:'#4a9ad4',fontSize:'.50rem'}}>{leg.ir01!=null?fmtAmt(leg.ir01):'—'}</td>
                        <td style={{padding:'5px 9px',textAlign:'right',color:'#666666',fontSize:'.50rem'}}>{leg.ir01_disc!=null?fmtAmt(leg.ir01_disc):'—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Cashflow toggle */}
              {result.legs.some(l=>l.cashflows?.length>0) && (<>
                <div className="pp-cf-toggle" onClick={()=>setCfOpen(o=>!o)}>
                  <span>{cfOpen?'▾':'▸'} CASHFLOW SCHEDULE</span>
                  <span style={{fontSize:'.44rem',color:'#666666'}}>{cfOpen?'COLLAPSE':'EXPAND'}</span>
                </div>
                {cfOpen && (
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%',borderCollapse:'collapse',fontSize:'.52rem',fontFamily:'JetBrains Mono,monospace',tableLayout:'fixed'}}>
                      <thead><tr style={{background:'#0C0C0C',borderBottom:'1px solid #1E1E1E'}}>
                        {['LEG','PAY DATE','START','END','RATE','FWD RATE','DCF','DF','AMOUNT'].map((h,i)=>(
                          <th key={i} style={{padding:'3px 7px',color:'#666666',fontWeight:400,fontSize:'.44rem',textAlign:i>3?'right':'left'}}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {result.legs.flatMap(leg=>(leg.cashflows||[]).map((cf,i)=>(
                          <tr key={`${leg.leg_ref}-${i}`} style={{borderBottom:'1px solid rgba(30,48,69,.3)',borderLeft:`2px solid ${leg.direction==='PAY'?'#e05040':'#0dd4a8'}`}}>
                            <td style={{padding:'3px 7px',color:'#666666'}}>{leg.leg_ref}</td>
                            <td style={{padding:'3px 7px',color:'#666666'}}>{cf.payment_date}</td>
                            <td style={{padding:'3px 7px',color:'#666666'}}>{cf.period_start}</td>
                            <td style={{padding:'3px 7px',color:'#666666'}}>{cf.period_end}</td>
                            <td style={{padding:'3px 7px',textAlign:'right',color:'#4a9ad4'}}>{fmtPct(cf.rate)}</td>
                            <td style={{padding:'3px 7px',textAlign:'right',color:'#8ab0c8'}}>{cf.forward_rate!=null?fmtPct(cf.forward_rate):'—'}</td>
                            <td style={{padding:'3px 7px',textAlign:'right',color:'#666666'}}>{cf.dcf?.toFixed(4)||'—'}</td>
                            <td style={{padding:'3px 7px',textAlign:'right',color:'#666666'}}>{fmtDf(cf.df)}</td>
                            <td style={{padding:'3px 7px',textAlign:'right',color:npvClr(cf.pv||cf.amount),fontWeight:600}}>{fmtAmt(cf.pv||cf.amount)}</td>
                          </tr>
                        )))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>)}
            </div>
          )}

          {/* BOOK ACTION BAR */}
          <div className="book-bar">
            <div className="book-summary">
              Selected: <strong>{selTrade?.counterparty?.name||'—'} · TRADITIONAL</strong> ·
              <span> NPV {fmtAmt(result.npv)}</span> ·
              <span style={{color:'#666666'}}> limit check pending Sprint 5D</span>
            </div>
            <button className="btn btn-exec" onClick={()=>window.location.href='/blotter'}>↗ OPEN BOOKING WINDOW</button>
            <button className="btn btn-book" onClick={()=>alert('BOOK TRADE — wiring in Sprint 5D+6D\nXVA auto-transfer will fire at booking.')}>▶ BOOK TRADE</button>
            <button className="btn btn-chain-book" onClick={()=>alert('⬡ BOOK + CONFIRM — requires counterparty on Rijeka Confirms network.')}>⬡ BOOK + CONFIRM</button>
          </div>

        </>)}
      </div>{/* /sc */}
    </div>
  )
}

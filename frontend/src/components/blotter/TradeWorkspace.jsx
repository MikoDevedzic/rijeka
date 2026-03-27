import { useState, useEffect } from 'react'
import { useTradesStore } from '../../store/useTradesStore'
import { useTabStore } from '../../store/useTabStore'
import { supabase } from '../../lib/supabase'
import usePricerStore, { fmtCcy, fmtBps, fmtPct } from '../../store/usePricerStore'
import useCashflowsStore, { effectiveAmount, CF_STATUS_COLOR } from '../../store/useCashflowsStore'
import './TradeWorkspace.css'

const AC_COLOR = { RATES:'var(--accent)', FX:'var(--blue)', CREDIT:'var(--amber)', EQUITY:'var(--purple)', COMMODITY:'var(--red)' }
const ST_COLOR = { PENDING:'var(--amber)', LIVE:'var(--accent)', MATURED:'#4a5568', CANCELLED:'var(--red)', TERMINATED:'var(--red)' }
const SR_COLOR = { WORKING:'var(--accent)', PRODUCTION:'var(--blue)', HISTORY:'#4a5568' }

function fmtN(n, ccy) {
  if (!n && n !== 0) return '\u2014'
  const num = Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  return ccy ? `${num} ${ccy}` : num
}
function fmtD(d) { return d?d.substring(0,10):'\u2014' }
function tenor(t) {
  if (!t.effective_date||!t.maturity_date) return '\u2014'
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

// ── Collect unique curve IDs from a trade ─────────────────────
function collectCurveIds(trade) {
  const ids = new Set()
  if (trade.discount_curve_id) ids.add(trade.discount_curve_id)
  if (trade.forecast_curve_id) ids.add(trade.forecast_curve_id)
  const legs = trade.terms?.legs || []
  legs.forEach(l => {
    if (l.discount_curve_id) ids.add(l.discount_curve_id)
    if (l.forecast_curve_id) ids.add(l.forecast_curve_id)
  })
  if (ids.size === 0) ids.add('default')
  return [...ids]
}

// ── Formatting helpers ────────────────────────────────────────
function npvColor(v) {
  if (v === null || v === undefined) return 'var(--text)'
  return Number(v) >= 0 ? 'var(--accent)' : 'var(--red)'
}

function MetricBlock({ label, value, sub, color }) {
  return (
    <div style={{
      background:'var(--panel-2)', border:'1px solid var(--border)',
      borderRadius:3, padding:'0.75rem 1rem', minWidth:140,
    }}>
      <div style={{fontSize:'0.58rem',fontWeight:700,letterSpacing:'0.12em',color:'var(--text-dim)',marginBottom:'0.35rem'}}>{label}</div>
      <div style={{fontSize:'0.9rem',fontWeight:700,fontFamily:'var(--mono)',color:color||'var(--text)',lineHeight:1}}>{value}</div>
      {sub && <div style={{fontSize:'0.58rem',color:'var(--text-dim)',marginTop:'0.25rem',letterSpacing:'0.06em'}}>{sub}</div>}
    </div>
  )
}

// ── PRICING PANEL ─────────────────────────────────────────────
function PricingPanel({ trade }) {
  const { priceTrade, resultForTrade, loading, error } = usePricerStore()
  const result = resultForTrade(trade.id)

  // Build initial curve inputs from trade's curve IDs, default 5.25%
  const curveIds = collectCurveIds(trade)
  const [curveInputs, setCurveInputs] = useState(() =>
    curveIds.map(id => ({ curve_id: id, flat_rate: '0.0525' }))
  )
  const [valuationDate, setValuationDate] = useState(
    () => new Date().toISOString().slice(0, 10)
  )
  const [localErr, setLocalErr] = useState(null)

  const handleRateChange = (curve_id, val) => {
    setCurveInputs(prev => prev.map(c => c.curve_id === curve_id ? { ...c, flat_rate: val } : c))
  }

  const handlePrice = async () => {
    setLocalErr(null)
    // Validate rates
    for (const c of curveInputs) {
      const r = parseFloat(c.flat_rate)
      if (isNaN(r) || r < 0 || r > 1) {
        setLocalErr(`Invalid rate for ${c.curve_id} — enter decimal e.g. 0.0525 for 5.25%`)
        return
      }
    }
    const parsed = curveInputs.map(c => ({ curve_id: c.curve_id, flat_rate: parseFloat(c.flat_rate) }))
    // Always include a default fallback
    if (!parsed.find(c => c.curve_id === 'default')) {
      parsed.push({ curve_id: 'default', flat_rate: parsed[0]?.flat_rate || 0.0525 })
    }
    await priceTrade(trade.id, parsed, valuationDate)
  }

  const inp = {
    background:'var(--bg)', border:'1px solid var(--border)', color:'var(--text)',
    fontFamily:'var(--mono)', fontSize:'0.7rem', padding:'0.25rem 0.4rem',
    borderRadius:2, outline:'none', width:110, textAlign:'right',
  }
  const lbl = { fontSize:'0.6rem', fontWeight:600, letterSpacing:'0.1em', color:'var(--text-dim)' }

  return (
    <div style={{ height:'100%', overflow:'auto', padding:'1.25rem' }}>

      {/* ── Curve Input Panel ── */}
      <div style={{
        background:'var(--panel-2)', border:'1px solid var(--border)',
        borderRadius:3, padding:'1rem 1.25rem', marginBottom:'1.25rem',
      }}>
        <div style={{ fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.14em', color:'var(--text-dim)', marginBottom:'0.75rem' }}>
          CURVE INPUTS — FLAT RATES (SPRINT 3 STUB)
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:'0.75rem', alignItems:'flex-end' }}>
          {curveInputs.map(c => (
            <div key={c.curve_id} style={{ display:'flex', flexDirection:'column', gap:'0.2rem' }}>
              <span style={lbl}>{c.curve_id}</span>
              <input
                style={inp}
                value={c.flat_rate}
                onChange={e => handleRateChange(c.curve_id, e.target.value)}
                placeholder="0.0525"
              />
            </div>
          ))}
          <div style={{ display:'flex', flexDirection:'column', gap:'0.2rem' }}>
            <span style={lbl}>VALUATION DATE</span>
            <input
              type="date"
              style={{ ...inp, width:130 }}
              value={valuationDate}
              onChange={e => setValuationDate(e.target.value)}
            />
          </div>
          <button
            onClick={handlePrice}
            disabled={loading}
            style={{
              background: loading ? 'var(--panel-3)' : 'var(--accent)',
              border:'none', color:'var(--bg-deep)',
              fontFamily:'var(--mono)', fontSize:'0.68rem', fontWeight:700,
              letterSpacing:'0.1em', padding:'0.35rem 1rem', borderRadius:2,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1, alignSelf:'flex-end',
            }}
          >
            {loading ? 'PRICING...' : 'RUN PRICER'}
          </button>
        </div>
        {(localErr || error) && (
          <div style={{
            marginTop:'0.6rem', fontSize:'0.65rem', color:'var(--red)',
            padding:'0.3rem 0.6rem', background:'color-mix(in srgb,var(--red) 8%,transparent)',
            border:'1px solid color-mix(in srgb,var(--red) 25%,transparent)', borderRadius:2,
          }}>
            {localErr || error}
          </div>
        )}
        <div style={{ marginTop:'0.5rem', fontSize:'0.58rem', color:'var(--text-dim)', letterSpacing:'0.06em' }}>
          Enter decimal rates — e.g. 0.0525 = 5.25%. Sprint 4: bootstrapped from market data automatically.
        </div>
      </div>

      {/* ── Results ── */}
      {!result && !loading && (
        <div style={{ padding:'3rem', textAlign:'center', color:'var(--text-dim)', fontSize:'0.68rem', letterSpacing:'0.1em' }}>
          ENTER CURVE RATES AND CLICK RUN PRICER
        </div>
      )}

      {result && (
        <>
          {/* Top-line metrics */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:'0.75rem', marginBottom:'1.25rem' }}>
            <MetricBlock
              label="NPV"
              value={fmtCcy(result.npv, trade.notional_ccy)}
              sub={valuationDate}
              color={npvColor(result.npv)}
            />
            <MetricBlock
              label="PV01"
              value={fmtCcy(result.pv01, trade.notional_ccy)}
              sub="+1bp parallel shift"
              color="var(--blue)"
            />
            <MetricBlock
              label="DV01"
              value={fmtCcy(result.dv01, trade.notional_ccy)}
              sub="+1bp discount curve"
              color="var(--blue)"
            />
            <MetricBlock
              label="THETA"
              value={fmtCcy(result.theta, trade.notional_ccy)}
              sub="1-day time decay"
              color={npvColor(result.theta)}
            />
          </div>

          {/* Per-leg PV breakdown */}
          <div style={{
            background:'var(--panel-2)', border:'1px solid var(--border)',
            borderRadius:3, marginBottom:'1.25rem', overflow:'hidden',
          }}>
            <div style={{
              padding:'0.5rem 1rem', borderBottom:'1px solid var(--border)',
              fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.14em', color:'var(--text-dim)',
            }}>
              LEG PV BREAKDOWN
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:'var(--mono)', fontSize:'0.68rem' }}>
              <thead>
                <tr style={{ background:'var(--panel-3)' }}>
                  {['LEG','TYPE','DIR','CCY','PV','CASHFLOWS'].map(h => (
                    <th key={h} style={{ padding:'0.4rem 0.75rem', textAlign: h==='PV'||h==='CASHFLOWS' ? 'right' : 'left', fontSize:'0.58rem', fontWeight:700, letterSpacing:'0.1em', color:'var(--text-dim)', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.legs.map((leg, i) => {
                  const dc = leg.direction === 'PAY' ? 'var(--red)' : 'var(--accent)'
                  return (
                    <tr key={leg.leg_id} style={{ borderBottom:'1px solid var(--border)' }}>
                      <td style={{ padding:'0.5rem 0.75rem', color:'var(--text-dim)', fontSize:'0.62rem' }}>{leg.leg_ref || `L${i+1}`}</td>
                      <td style={{ padding:'0.5rem 0.75rem', color:'var(--text-dim)' }}>{leg.leg_type}</td>
                      <td style={{ padding:'0.5rem 0.75rem' }}>
                        <span style={{ color:dc, fontWeight:700, fontSize:'0.62rem' }}>{leg.direction}</span>
                      </td>
                      <td style={{ padding:'0.5rem 0.75rem', color:'var(--text-dim)' }}>{leg.currency}</td>
                      <td style={{ padding:'0.5rem 0.75rem', textAlign:'right', color:npvColor(leg.pv), fontWeight:700 }}>
                        {fmtCcy(leg.pv, '')}
                      </td>
                      <td style={{ padding:'0.5rem 0.75rem', textAlign:'right', color:'var(--text-dim)', fontSize:'0.62rem' }}>
                        {leg.cashflows?.length || 0}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Cashflow schedule from pricer */}
          {result.legs.some(l => l.cashflows?.length > 0) && (
            <div style={{
              background:'var(--panel-2)', border:'1px solid var(--border)',
              borderRadius:3, overflow:'hidden',
            }}>
              <div style={{
                padding:'0.5rem 1rem', borderBottom:'1px solid var(--border)',
                fontSize:'0.6rem', fontWeight:700, letterSpacing:'0.14em', color:'var(--text-dim)',
              }}>
                PROJECTED CASHFLOW SCHEDULE
              </div>
              <div style={{ maxHeight:300, overflow:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontFamily:'var(--mono)', fontSize:'0.65rem' }}>
                  <thead style={{ position:'sticky', top:0, background:'var(--panel-3)', zIndex:1 }}>
                    <tr>
                      {['PAYMENT DATE','LEG','DIR','NOTIONAL','RATE','DCF','AMOUNT','PV'].map(h => (
                        <th key={h} style={{
                          padding:'0.35rem 0.6rem',
                          textAlign: ['NOTIONAL','RATE','DCF','AMOUNT','PV'].includes(h) ? 'right' : 'left',
                          fontSize:'0.56rem', fontWeight:700, letterSpacing:'0.1em', color:'var(--text-dim)', whiteSpace:'nowrap',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.legs.flatMap(leg =>
                      (leg.cashflows || []).map((cf, ci) => {
                        const dc = leg.direction === 'PAY' ? 'var(--red)' : 'var(--accent)'
                        return (
                          <tr key={`${leg.leg_id}-${ci}`} style={{ borderBottom:'1px solid color-mix(in srgb,var(--border) 50%,transparent)' }}>
                            <td style={{ padding:'0.3rem 0.6rem', color:'var(--text)' }}>{cf.payment_date}</td>
                            <td style={{ padding:'0.3rem 0.6rem', color:'var(--text-dim)', fontSize:'0.6rem' }}>{leg.leg_ref}</td>
                            <td style={{ padding:'0.3rem 0.6rem' }}>
                              <span style={{ color:dc, fontWeight:700, fontSize:'0.6rem' }}>{leg.direction}</span>
                            </td>
                            <td style={{ padding:'0.3rem 0.6rem', textAlign:'right', color:'var(--text-dim)' }}>
                              {Number(cf.notional).toLocaleString('en-US', {maximumFractionDigits:0})}
                            </td>
                            <td style={{ padding:'0.3rem 0.6rem', textAlign:'right', color:'var(--text-dim)' }}>
                              {fmtPct(cf.rate)}
                            </td>
                            <td style={{ padding:'0.3rem 0.6rem', textAlign:'right', color:'var(--text-dim)' }}>
                              {Number(cf.dcf).toFixed(4)}
                            </td>
                            <td style={{ padding:'0.3rem 0.6rem', textAlign:'right', color: leg.direction==='PAY'?'var(--red)':'var(--accent)', fontWeight:600 }}>
                              {Number(cf.amount).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})}
                            </td>
                            <td style={{ padding:'0.3rem 0.6rem', textAlign:'right', color:npvColor(cf.pv), fontWeight:600 }}>
                              {Number(cf.pv).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Existing panels (unchanged) ───────────────────────────────

function OverviewPanel({trade:t}) {
  const ac=t.asset_class, acColor=AC_COLOR[ac]||'var(--text)'
  const terms=t.terms||{}, legs=terms.legs||[]
  const fields=[
    ['TRADE REF',t.trade_ref],['ASSET CLASS',t.asset_class],['INSTRUMENT',t.instrument_type],
    ['STATUS',t.status],['STORE',t.store],['COUNTERPARTY',t.counterparty?.name||'\u2014'],
    ['OWN ENTITY',t.own_entity?.short_name||'\u2014'],['NOTIONAL',fmtN(t.notional, t.notional_ccy)],
    ['CURRENCY',t.notional_ccy],['TENOR',tenor(t)],
    ['TRADE DATE',fmtD(t.trade_date)],['EFFECTIVE DATE',fmtD(t.effective_date)],
    ['MATURITY DATE',fmtD(t.maturity_date)],['DESK',t.desk||'\u2014'],['BOOK',t.book||'\u2014'],['LEGS',legs.length||'\u2014'],
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
  const fmtVal=v=>{ if(v===null||v===undefined||v==='') return '\u2014'; if(typeof v==='boolean') return v?'YES':'NO'; if(Array.isArray(v)) return v.length?`${v.length} entries`:'\u2014'; return String(v) }
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

function CashflowsPanel({trade:t}) {
  const { fetchCashflows, cashflowsForTrade, overrideCashflow, loading } = useCashflowsStore()
  const cfs = cashflowsForTrade(t.id)
  const [filterLeg, setFilterLeg] = useState('ALL')
  const [editId, setEditId] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [fetched, setFetched] = useState(false)

  useEffect(() => {
    if (!fetched) {
      fetchCashflows(t.id).then(() => setFetched(true))
    }
  }, [t.id])

  // Unique leg refs for filter tabs
  const legRefs = [...new Set(cfs.map(c => c.leg_id))]
  const displayed = filterLeg === 'ALL' ? cfs : cfs.filter(c => c.leg_id === filterLeg)
  const overrideCount = cfs.filter(c => c.is_overridden).length

  const saveEdit = async (cf) => {
    const val = editVal === '' ? null : parseFloat(editVal)
    if (val !== null && isNaN(val)) { setEditId(null); return }
    await overrideCashflow(cf.id, t.id, val ?? cf.amount)
    setEditId(null)
  }

  // Find leg ref label for a leg_id
  const legLabel = (legId) => {
    const cf = cfs.find(c => c.leg_id === legId)
    return cf?.leg_ref || legId?.slice(0, 8) || legId
  }

  if (!fetched && loading) {
    return <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.68rem',letterSpacing:'0.1em'}}>LOADING CASHFLOWS...</div>
  }

  return (
    <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
      <div className="cf-tab-bar">
        {['ALL', ...legRefs].map(f => (
          <button key={f} className={`chip-s ${filterLeg===f?'chip-s-on':''}`} onClick={() => setFilterLeg(f)}>
            {f === 'ALL' ? `ALL LEGS (${cfs.length})` : legLabel(f)}
          </button>
        ))}
        {overrideCount > 0 && (
          <span style={{marginLeft:'auto',fontSize:'0.62rem',color:'var(--amber)',fontWeight:700}}>
            {overrideCount} OVERRIDE{overrideCount !== 1 ? 'S' : ''}
          </span>
        )}
        <button
          onClick={() => { setFetched(false); fetchCashflows(t.id).then(() => setFetched(true)) }}
          style={{marginLeft: overrideCount > 0 ? '0.5rem' : 'auto', fontSize:'0.58rem', color:'var(--text-dim)', background:'none', border:'1px solid var(--border)', borderRadius:2, padding:'0.1rem 0.4rem', cursor:'pointer'}}
        >
          &#8635; REFRESH
        </button>
      </div>

      {cfs.length === 0 ? (
        <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.68rem',letterSpacing:'0.1em',lineHeight:1.8}}>
          NO CASHFLOWS IN DATABASE<br/>
          <span style={{fontSize:'0.6rem'}}>Go to PRICING tab &#8594; RUN PRICER to generate the schedule</span>
        </div>
      ) : (
        <div style={{flex:1,overflow:'auto'}}>
          <table className="cf-tbl" style={{fontSize:'0.63rem'}}>
            <thead>
              <tr>
                <th>PERIOD START</th>
                <th>PERIOD END</th>
                <th>PAYMENT DATE</th>
                <th>FIXING DATE</th>
                <th>LEG</th>
                <th>DIR</th>
                <th>CCY</th>
                <th style={{textAlign:'right'}}>NOTIONAL</th>
                <th style={{textAlign:'right'}}>RATE</th>
                <th style={{textAlign:'right'}}>DCF</th>
                <th style={{textAlign:'right'}}>AMOUNT</th>
                <th>STATUS</th>
                <th/>
              </tr>
            </thead>
            <tbody>
              {displayed.map(cf => {
                const amt = effectiveAmount(cf)
                const isNeg = Number(amt) < 0
                const amtColor = cf.is_overridden ? 'var(--amber)' : (isNeg ? 'var(--red)' : 'var(--text-dim)')
                const statusColor = CF_STATUS_COLOR[cf.status] || 'var(--text-dim)'
                return (
                  <tr key={cf.id} style={{borderBottom:'1px solid color-mix(in srgb,var(--border) 60%,transparent)'}}>
                    <td style={{color:'var(--text-dim)'}}>{cf.period_start}</td>
                    <td style={{color:'var(--text-dim)'}}>{cf.period_end}</td>
                    <td style={{color:'var(--text)'}}>{cf.payment_date}</td>
                    <td style={{color:'var(--text-dim)',fontSize:'0.6rem'}}>{cf.fixing_date || '\u2014'}</td>
                    <td style={{color:'var(--text-dim)',fontSize:'0.6rem'}}>{cf.leg_id?.slice(0,8)}...</td>
                    <td>
                      <span style={{color: Number(amt) < 0 ? 'var(--red)' : 'var(--accent)', fontWeight:700, fontSize:'0.6rem'}}>
                        {Number(amt) < 0 ? 'PAY' : 'RCV'}
                      </span>
                    </td>
                    <td style={{color:'var(--text-dim)'}}>{cf.currency}</td>
                    <td style={{textAlign:'right',color:'var(--text-dim)'}}>
                      {cf.notional ? Number(cf.notional).toLocaleString('en-US',{maximumFractionDigits:0}) : '\u2014'}
                    </td>
                    <td style={{textAlign:'right',color:'var(--text-dim)'}}>
                      {cf.rate != null ? (Number(cf.rate)*100).toFixed(4)+'%' : '\u2014'}
                    </td>
                    <td style={{textAlign:'right',color:'var(--text-dim)'}}>
                      {cf.dcf != null ? Number(cf.dcf).toFixed(4) : '\u2014'}
                    </td>
                    <td style={{textAlign:'right',cursor:'pointer'}} onClick={() => {setEditId(cf.id); setEditVal(String(amt))}}>
                      {editId === cf.id ? (
                        <input
                          autoFocus
                          style={{background:'var(--bg)',border:'1px solid var(--accent)',color:'var(--text)',fontFamily:'var(--mono)',fontSize:'0.68rem',padding:'0.1rem 0.3rem',width:110,borderRadius:2,textAlign:'right'}}
                          value={editVal}
                          onChange={e => setEditVal(e.target.value)}
                          onBlur={() => saveEdit(cf)}
                          onKeyDown={e => {if(e.key==='Enter') saveEdit(cf); if(e.key==='Escape') setEditId(null)}}
                        />
                      ) : (
                        <span style={{color:amtColor,fontWeight:cf.is_overridden?700:400}}>
                          {Number(amt).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})}
                          {cf.is_overridden && <span className="cf-override-badge">OVRD</span>}
                        </span>
                      )}
                    </td>
                    <td>
                      <span style={{fontSize:'0.58rem',color:statusColor,fontWeight:600,letterSpacing:'0.06em'}}>{cf.status}</span>
                    </td>
                    <td>
                      <button className="cf-edit-btn" onClick={() => {setEditId(cf.id); setEditVal(String(amt))}}>&#9998;</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
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
            <div className="stub-block-val">&#8212;</div>
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
    const updates = { store, desk: desk?.name || trade.desk || null, book: book?.name || trade.book || null }
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
        <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-dim)',cursor:'pointer',fontSize:'0.9rem'}}>&#10005;</button>
      </div>
      <div style={{flex:1,overflow:'auto',padding:'1rem 1.25rem',display:'flex',flexDirection:'column',gap:'0.75rem'}}>
        <div style={{fontSize:'0.6rem',color:'var(--text-dim)',letterSpacing:'0.08em',lineHeight:1.6,padding:'0.5rem',background:'var(--bg-deep)',borderRadius:2,border:'1px solid var(--border)'}}>
          Portfolio fields only &#8212; desk, book, store.<br/>
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
            const id=e.target.value; setDeskId(id)
            const fb=books.filter(b=>b.parent_id===id); setFilteredBooks(fb); setBookId('')
          }} style={inp}>
            <option value="">&#8212; select desk &#8212;</option>
            {desks.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div style={fg}>
          <label style={lbl}>BOOK</label>
          <select value={bookId} onChange={e=>setBookId(e.target.value)} style={inp} disabled={!deskId}>
            <option value="">{deskId?'&#8212; select book &#8212;':'&#8212; select desk first &#8212;'}</option>
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

// ── Main component ────────────────────────────────────────────
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
          {panel==='cashflows' && <CashflowsPanel trade={trade}/>}
          {panel==='pricing'   && <PricingPanel trade={trade}/>}
          {panel==='xva'       && <StubPanel title="XVA COST STACK" sprint="SPRINT 5"
              desc={`Counterparty: ${trade.counterparty?.name||'\u2014'} \u00B7 CSA: ${trade.counterparty?.csa_type||'\u2014'}`}
              blocks={[{label:'CVA',sub:'Credit Valuation Adj.'},{label:'DVA',sub:'Debit Valuation Adj.'},{label:'FVA',sub:'Funding Valuation Adj.'},{label:'MVA',sub:'Margin Valuation Adj.'},{label:'KVA',sub:'Capital Valuation Adj.'},{label:'TOTAL XVA',sub:'All-in cost'}]}/>}
        </div>
        {editing && (
          <EditPanel
            trade={trade}
            onSave={(updated) => {
              refreshTrade(trade.id, updated)
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

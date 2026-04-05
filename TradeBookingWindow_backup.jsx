import React, { useState, useRef, useEffect } from 'react'
import { useTradesStore } from '../../store/useTradesStore'
import useMarketDataStore from '../../store/useMarketDataStore'
import { supabase } from '../../lib/supabase'
import './TradeBookingWindow.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

const ASSET_CLASSES = ['RATES','FX','CREDIT','EQUITY','COMMODITY']
const LIVE_AC       = ['RATES']
const INSTRUMENTS   = {
  RATES:     ['IR_SWAP','IR_SWAPTION','INTEREST_RATE_CAP','INTEREST_RATE_FLOOR','INTEREST_RATE_COLLAR','FRA'],
  FX:        ['FX_FORWARD','FX_SWAP','NDF'],
  CREDIT:    ['CDS','CDS_INDEX','TOTAL_RETURN_SWAP','ASSET_SWAP'],
  EQUITY:    ['EQUITY_SWAP','VARIANCE_SWAP','DIVIDEND_SWAP','EQUITY_FORWARD'],
  COMMODITY: ['COMMODITY_SWAP','COMMODITY_BASIS_SWAP','ASIAN_COMMODITY_SWAP'],
}
const LIVE_INST   = { RATES: ['IR_SWAP'] }
const IR_STRUCTS  = ['VANILLA','OIS','BASIS','XCCY','ZERO_COUPON','STEP_UP','INFLATION_ZC','CMS','CMS_SPREAD']
const LIVE_STRUCT = ['VANILLA','OIS']
const DAY_COUNTS  = ['ACT/360','ACT/365F','30/360','ACT/ACT ISDA']
const PAY_FREQS   = ['MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','ZERO_COUPON']
const RESET_FREQS = ['DAILY','WEEKLY','MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL']
const BDCS        = ['MOD_FOLLOWING','FOLLOWING','PRECEDING','UNADJUSTED']
const CALENDARS   = ['NEW_YORK','LONDON','TARGET','TOKYO','ZURICH','SYDNEY','TORONTO','NEW_YORK+LONDON','TARGET+LONDON']
const CURRENCIES  = ['USD','EUR','GBP','JPY','CHF','AUD','CAD']
const TENORS      = ['1M','2M','3M','6M','9M','1Y','18M','2Y','3Y','4Y','5Y','6Y','7Y','8Y','9Y','10Y','12Y','15Y','20Y','25Y','30Y','40Y','50Y']

const CCY_CURVE = {
  USD:'USD_SOFR', EUR:'EUR_ESTR', GBP:'GBP_SONIA',
  JPY:'JPY_TONAR', CHF:'CHF_SARON', AUD:'AUD_AONIA', CAD:'CAD_CORRA',
}
const CCY_FLOAT_DC = {
  USD:'ACT/360', EUR:'ACT/360', GBP:'ACT/365F',
  JPY:'ACT/365F', CHF:'ACT/360', AUD:'ACT/365F', CAD:'ACT/365F',
}
const CCY_CAL = {
  USD:'NEW_YORK', EUR:'TARGET', GBP:'LONDON',
  JPY:'TOKYO', CHF:'ZURICH', AUD:'SYDNEY', CAD:'TORONTO',
}
const CCY_INDICES = {
  USD: ['SOFR','TERM SOFR 1M','TERM SOFR 3M','TERM SOFR 6M','EFFR'],
  EUR: ['\u20acSTR','EURIBOR 1M','EURIBOR 3M','EURIBOR 6M'],
  GBP: ['SONIA','TERM SONIA 3M','TERM SONIA 6M'],
  JPY: ['TONAR','TIBOR 3M','TIBOR 6M'],
  CHF: ['SARON','TERM SARON 3M'],
  AUD: ['AONIA','BBSW 3M','BBSW 6M'],
  CAD: ['CORRA'],
}
const INDEX_CURVE = {
  'SOFR':'USD_SOFR','TERM SOFR 1M':'USD_TSOFR_1M','TERM SOFR 3M':'USD_TSOFR_3M',
  'TERM SOFR 6M':'USD_TSOFR_6M','EFFR':'USD_EFFR',
  '\u20acSTR':'EUR_ESTR','EURIBOR 1M':'EUR_ESTR','EURIBOR 3M':'EUR_EURIBOR_3M','EURIBOR 6M':'EUR_EURIBOR_6M',
  'SONIA':'GBP_SONIA','TERM SONIA 3M':'GBP_SONIA_3M','TERM SONIA 6M':'GBP_SONIA_3M',
  'TONAR':'JPY_TONAR','TIBOR 3M':'JPY_TIBOR_3M','TIBOR 6M':'JPY_TIBOR_6M',
  'SARON':'CHF_SARON','TERM SARON 3M':'CHF_SARON_3M',
  'AONIA':'AUD_AONIA','BBSW 3M':'AUD_BBSW_3M','BBSW 6M':'AUD_BBSW_6M',
  'CORRA':'CAD_CORRA',
}
// OIS indices: T+2 payment lag. IBOR/Term: T+0.
const INDEX_PAY_LAG = {
  'SOFR':2,'EFFR':2,'\u20acSTR':2,'SONIA':0,'TONAR':2,'SARON':2,'AONIA':0,'CORRA':2,
  'TERM SOFR 1M':0,'TERM SOFR 3M':0,'TERM SOFR 6M':0,
  'EURIBOR 1M':0,'EURIBOR 3M':0,'EURIBOR 6M':0,
  'TERM SONIA 3M':0,'TERM SONIA 6M':0,'TIBOR 3M':0,'TIBOR 6M':0,
  'TERM SARON 3M':0,'BBSW 3M':0,'BBSW 6M':0,
}
// Reset frequency defaults per index
const INDEX_DEFAULTS = {
  'SOFR':          ['DAILY',      'ANNUAL',      'ACT/360'],
  'TERM SOFR 1M':  ['MONTHLY',    'QUARTERLY',   'ACT/360'],
  'TERM SOFR 3M':  ['QUARTERLY',  'QUARTERLY',   'ACT/360'],
  'TERM SOFR 6M':  ['SEMI_ANNUAL','SEMI_ANNUAL', 'ACT/360'],
  'EFFR':          ['DAILY',      'ANNUAL',      'ACT/360'],
  '\u20acSTR':    ['DAILY',      'ANNUAL',      'ACT/360'],
  'EURIBOR 1M':    ['MONTHLY',    'QUARTERLY',   'ACT/360'],
  'EURIBOR 3M':    ['QUARTERLY',  'SEMI_ANNUAL', 'ACT/360'],
  'EURIBOR 6M':    ['SEMI_ANNUAL','ANNUAL',      'ACT/360'],
  'SONIA':         ['DAILY',      'ANNUAL',      'ACT/365F'],
  'TERM SONIA 3M': ['QUARTERLY',  'SEMI_ANNUAL', 'ACT/365F'],
  'TERM SONIA 6M': ['SEMI_ANNUAL','ANNUAL',      'ACT/365F'],
  'TONAR':         ['DAILY',      'ANNUAL',      'ACT/365F'],
  'TIBOR 3M':      ['QUARTERLY',  'SEMI_ANNUAL', 'ACT/365F'],
  'TIBOR 6M':      ['SEMI_ANNUAL','ANNUAL',      'ACT/365F'],
  'SARON':         ['DAILY',      'ANNUAL',      'ACT/360'],
  'TERM SARON 3M': ['QUARTERLY',  'QUARTERLY',   'ACT/360'],
  'AONIA':         ['DAILY',      'ANNUAL',      'ACT/365F'],
  'BBSW 3M':       ['QUARTERLY',  'QUARTERLY',   'ACT/365F'],
  'BBSW 6M':       ['SEMI_ANNUAL','SEMI_ANNUAL', 'ACT/365F'],
  'CORRA':         ['DAILY',      'ANNUAL',      'ACT/365F'],
}
const TENOR_YEARS = {
  ON:1/365,'1W':7/365,'1M':1/12,'2M':2/12,'3M':3/12,'6M':6/12,'9M':9/12,
  '1Y':1,'18M':1.5,'2Y':2,'3Y':3,'4Y':4,'5Y':5,'6Y':6,'7Y':7,'8Y':8,
  '9Y':9,'10Y':10,'12Y':12,'15Y':15,'20Y':20,'25Y':25,'30Y':30,'40Y':40,'50Y':50,
}

function getParRateFromStore(curves, curveId, tenorYears) {
  const curve = curves.find(c => c.id === curveId)
  if (!curve || !curve.instruments || !curve.instruments.length) return null
  const enabled = curve.instruments.filter(i => i.en !== false && i.quote != null)
  if (!enabled.length) return null
  let best = null, bestDiff = Infinity
  for (const inst of enabled) {
    const y = TENOR_YEARS[inst.tenor]
    if (y == null) continue
    const diff = Math.abs(y - tenorYears)
    if (diff < bestDiff) { bestDiff = diff; best = inst }
  }
  return best ? parseFloat(best.quote).toFixed(8) : null
}

function addBD(d, n) {
  const r = new Date(d)
  let added = 0
  while (added < n) { r.setDate(r.getDate()+1); if (r.getDay()!==0&&r.getDay()!==6) added++ }
  return r
}
function getDefaults() {
  const t = new Date()
  const pad = n => String(n).padStart(2,'0')
  const fmt = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())
  const eff = addBD(t, 2)
  const mat = new Date(eff); mat.setFullYear(mat.getFullYear()+5)
  while (mat.getDay()===0||mat.getDay()===6) mat.setDate(mat.getDate()+1)
  return { tdate: fmt(t), effDate: fmt(eff), matDate: fmt(mat) }
}

const fmtPnl = (n) => {
  if (n == null) return '—'
  const s=n>=0?'+':'-',a=Math.abs(n)
  return s+Math.floor(a).toLocaleString('en-US')+'.'+a.toFixed(2).slice(-2)
}

const inp = {
  background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'2px',
  color:'var(--text)', fontFamily:'var(--mono)', fontSize:'0.58rem',
  padding:'5px 8px', outline:'none', width:'100%', boxSizing:'border-box',
}
const sel = { ...inp }
const lbl = { fontSize:'0.40rem', color:'var(--text-dim)', letterSpacing:'0.08em', marginBottom:'3px' }
const Fld = ({label, flex=1, children}) => (
  <div style={{display:'flex',flexDirection:'column',flex}}>
    <div style={lbl}>{label}</div>
    {children}
  </div>
)
const Row = ({children, mt=0}) => <div style={{display:'flex',gap:'8px',marginTop:mt}}>{children}</div>
const SectionHdr = ({children, mt=10}) => (
  <div style={{fontSize:'0.42rem',fontWeight:700,letterSpacing:'0.12em',color:'var(--text-dim)',
    marginTop:mt,marginBottom:6,display:'flex',alignItems:'center',gap:'8px',
    borderBottom:'1px solid var(--border)',paddingBottom:6}}>
    {children}
  </div>
)
const Badge = ({label, color}) => (
  <span style={{fontSize:'0.40rem',fontWeight:700,letterSpacing:'0.08em',
    padding:'2px 7px',borderRadius:'2px',
    background:'color-mix(in srgb, '+color+' 12%, transparent)',
    border:'1px solid '+color,color}}>
    {label}
  </span>
)
const DirBtn = ({label, active, color, onClick}) => (
  <button onClick={onClick} style={{
    flex:1, padding:'5px 0', fontSize:'0.52rem', fontWeight:700,
    fontFamily:'var(--mono)', letterSpacing:'0.04em', borderRadius:'2px', cursor:'pointer',
    border: active ? '1px solid '+color : '1px solid var(--border)',
    background: active ? 'color-mix(in srgb, '+color+' 12%, transparent)' : 'transparent',
    color: active ? color : 'var(--text-dim)',
  }}>{label}</button>
)

// ── ScenarioTab: fully self-contained, all hooks at top level ────────────────
function ScenarioTab({ ccy, index, dir, struct, effDate, matDate, valDate, curves, analytics,
  notionalRef, rateRef, fixedPayFreq, fixedDc, fixedBdc, floatResetFreq, floatPayFreq, floatDc, floatBdc, getSession }) {

  const TENORS   = ['1W','1M','3M','6M','1Y','2Y','3Y','4Y','5Y','7Y','10Y','15Y','20Y','30Y']
  const TENOR_Y  = {'1W':0.02,'1M':0.083,'3M':0.25,'6M':0.5,'1Y':1,'2Y':2,'3Y':3,'4Y':4,'5Y':5,'7Y':7,'10Y':10,'15Y':15,'20Y':20,'30Y':30}

  const [scenarioKey,        setScenarioKey]        = useState('flat0')
  const [manualShift,        setManualShift]         = useState(0)
  const [interpMode,         setInterpMode]          = useState('LOG_LINEAR')
  const [scenarioBase,       setScenarioBase]        = useState(null)
  const [scenarioCalc,       setScenarioCalc]        = useState(null)
  const [scenarioPricing,    setScenarioPricing]     = useState(false)
  const [scenarioOverrides,  setScenarioOverrides]   = useState({})
  const [thetaApproxVisible, setThetaApproxVisible]  = useState(false)

  const curveId = CCY_CURVE[ccy] || 'USD_SOFR'

  const SCENARIO_DEFS = {
    flat0:      TENORS.map(()=>0),
    up25:       TENORS.map(()=>25),
    up50:       TENORS.map(()=>50),
    up100:      TENORS.map(()=>100),
    dn25:       TENORS.map(()=>-25),
    dn50:       TENORS.map(()=>-50),
    dn100:      TENORS.map(()=>-100),
    bear_steep: TENORS.map(t=>TENOR_Y[t]<=2?50:100),
    bull_flat:  TENORS.map(t=>TENOR_Y[t]<=2?-25:-75),
    bear_flat:  TENORS.map(t=>TENOR_Y[t]<=2?100:50),
    bull_steep: TENORS.map(t=>TENOR_Y[t]<=2?-75:-25),
    hike25:     TENORS.map(t=>TENOR_Y[t]<=1?25:TENOR_Y[t]<=3?10:0),
    cut25:      TENORS.map(t=>TENOR_Y[t]<=1?-25:TENOR_Y[t]<=3?-10:0),
    hike_cycle: TENORS.map(t=>Math.max(0,Math.round(100-TENOR_Y[t]*3.5))),
    manual:     TENORS.map(()=>manualShift||0),
  }

  const getBaseRates = () => {
    const curve = curves.find(c => c.id === curveId)
    const rates = {}
    if (curve && curve.instruments) {
      curve.instruments.forEach(i => { if (i.quote != null) rates[i.tenor] = parseFloat(i.quote) })
    }
    if (analytics && analytics.curve_pillars && analytics.curve_pillars[curveId]) {
      const pillars = analytics.curve_pillars[curveId]
      TENORS.forEach(t => {
        if (!rates[t]) {
          const ty = TENOR_Y[t]
          const near = pillars.reduce((a,b) => Math.abs(b.t-ty) < Math.abs(a.t-ty) ? b : a, pillars[0])
          if (near) rates[t] = near.zero_rate
        }
      })
    }
    return rates
  }

  const baseRates = getBaseRates()
  const shifts    = SCENARIO_DEFS[scenarioKey] || TENORS.map(()=>0)
  const anyShift  = shifts.some(s=>s!==0) || Object.keys(scenarioOverrides).length > 0
  const avgShift  = shifts.reduce((a,b)=>a+b,0)/shifts.length

  const handleRunScenario = async () => {
    if (!effDate || !matDate) return
    setScenarioPricing(true)
    setScenarioBase(null)
    setScenarioCalc(null)
    try {
      const session = await getSession()
      const h = { Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' }
      const notional   = parseFloat(notionalRef.current ? notionalRef.current.value.replace(/,/g,'') : '10000000')
      const rateVal    = parseFloat(rateRef.current ? rateRef.current.value : '0')
      const payLag     = INDEX_PAY_LAG[index] != null ? INDEX_PAY_LAG[index] : 2
      const forecastId = INDEX_CURVE[index] || curveId
      const isOIS      = struct === 'OIS'

      const legs = [
        { leg_ref:'FIXED-1', leg_seq:1, leg_type:'FIXED', direction:dir, currency:ccy, notional,
          effective_date:effDate, maturity_date:matDate, day_count:fixedDc,
          payment_frequency:fixedPayFreq, bdc:fixedBdc, payment_lag:payLag,
          fixed_rate:isNaN(rateVal)?0:rateVal/100, discount_curve_id:curveId, forecast_curve_id:null },
        { leg_ref:'FLOAT-1', leg_seq:2, leg_type:'FLOAT', direction:dir==='PAY'?'RECEIVE':'PAY',
          currency:ccy, notional, effective_date:effDate, maturity_date:matDate,
          day_count:floatDc, payment_frequency:floatPayFreq,
          reset_frequency:isOIS?'DAILY':floatResetFreq, bdc:floatBdc, payment_lag:payLag,
          fixed_rate:0, spread:0, leverage:1.0, discount_curve_id:curveId, forecast_curve_id:forecastId,
          ois_compounding:isOIS?'COMPOUNDING':null },
      ]

      const curveStore = curves.find(c => c.id === curveId)
      const onInst     = curveStore?.instruments?.find(i => i.tenor === 'ON')
      const onRate     = onInst?.quote ? parseFloat(onInst.quote)/100 : 0.0365

      const shockedQuotes = [{ tenor:'ON', quote_type:'DEPOSIT', rate:onRate }]
      TENORS.forEach((t,i) => {
        const base  = baseRates[t] || 3.665
        const final = scenarioOverrides[t] != null
          ? parseFloat(scenarioOverrides[t])
          : base + shifts[i]/100
        shockedQuotes.push({ tenor:t, quote_type:'OIS_SWAP', rate:final/100 })
      })

      const [baseRes, shockedRes] = await Promise.all([
        fetch(API+'/price/preview', { method:'POST', headers:h,
          body: JSON.stringify({ legs, valuation_date:valDate, curves:[{curve_id:curveId, quotes:[]}] }) }),
        fetch(API+'/price/preview', { method:'POST', headers:h,
          body: JSON.stringify({ legs, valuation_date:valDate, curves:[{curve_id:curveId, quotes:shockedQuotes}] }) }),
      ])

      if (baseRes.ok)    setScenarioBase(await baseRes.json())
      if (shockedRes.ok) setScenarioCalc(await shockedRes.json())
    } catch(e) { console.error('[SCENARIO RUN]', e) }
    finally { setScenarioPricing(false) }
  }

  const fmtPnl = n => {
    if (n==null) return '—'
    const s=n>=0?'+':'-',a=Math.abs(n)
    return s+Math.floor(a).toLocaleString('en-US')+'.'+a.toFixed(2).slice(-2)
  }

  return (
    <div className='tbw-no-drag' style={{flex:1,overflowY:'auto',padding:'10px 16px',display:'flex',flexDirection:'column',gap:'8px'}}>

      {/* Notice */}
      <div style={{background:'rgba(240,160,32,0.06)',border:'1px solid rgba(240,160,32,0.25)',borderRadius:'2px',
        padding:'5px 10px',fontSize:'0.40rem',color:'var(--amber)',letterSpacing:'0.05em'}}>
        ⚠ SCENARIO MODE — Changes here are for analysis only. Market data in Configurations is not affected.
      </div>

      {/* Controls */}
      <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
        <span style={{fontSize:'0.38rem',color:'var(--text-dim)',letterSpacing:'0.08em',whiteSpace:'nowrap'}}>SCENARIO</span>
        <select value={scenarioKey} onChange={e=>{setScenarioKey(e.target.value);setScenarioOverrides({})}}
          style={{...{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',color:'var(--text)',fontFamily:'var(--mono)',fontSize:'0.46rem',padding:'4px 7px',outline:'none'},flex:1,minWidth:'180px'}}>
          <optgroup label="── PARALLEL SHIFTS ──">
            <option value="flat0">Base (no shift)</option>
            <option value="up25">Parallel +25bp</option>
            <option value="up50">Parallel +50bp</option>
            <option value="up100">Parallel +100bp</option>
            <option value="dn25">Parallel −25bp</option>
            <option value="dn50">Parallel −50bp</option>
            <option value="dn100">Parallel −100bp</option>
          </optgroup>
          <optgroup label="── CURVE RESHAPING ──">
            <option value="bear_steep">Bear Steepener (S+50 / L+100)</option>
            <option value="bull_flat">Bull Flattener (S−25 / L−75)</option>
            <option value="bear_flat">Bear Flattener (S+100 / L+50)</option>
            <option value="bull_steep">Bull Steepener (S−75 / L−25)</option>
          </optgroup>
          <optgroup label="── CENTRAL BANK ──">
            <option value="hike25">Fed Hike +25bp (front end)</option>
            <option value="cut25">Fed Cut −25bp (front end)</option>
            <option value="hike_cycle">Fed Hike Cycle</option>
          </optgroup>
          <optgroup label="── CUSTOM ──">
            <option value="manual">Manual Shift (bp below)</option>
          </optgroup>
        </select>

        <span style={{fontSize:'0.38rem',color:'var(--text-dim)',letterSpacing:'0.08em',whiteSpace:'nowrap'}}>SHIFT (bp)</span>
        <input type='number' value={manualShift}
          onChange={e=>{setManualShift(parseFloat(e.target.value)||0);setScenarioKey('manual')}}
          style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',color:'var(--blue)',
            fontFamily:'var(--mono)',fontSize:'0.52rem',padding:'4px 7px',outline:'none',width:'64px'}}/>

        <span style={{fontSize:'0.38rem',color:'var(--text-dim)',letterSpacing:'0.08em',whiteSpace:'nowrap'}}>INTERP</span>
        <select value={interpMode} onChange={e=>setInterpMode(e.target.value)}
          style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',color:'var(--text)',
            fontFamily:'var(--mono)',fontSize:'0.44rem',padding:'4px 7px',outline:'none',width:'140px'}}>
          <option value="LOG_LINEAR">Log-Linear (default)</option>
          <option value="LINEAR_ZERO">Linear Zero Rates</option>
          <option value="CUBIC_SPLINE">Cubic Spline</option>
          <option value="STEP">Step Function</option>
        </select>

        {interpMode!=='LOG_LINEAR'&&(
          <span style={{fontSize:'0.38rem',color:'var(--amber)',padding:'2px 6px',border:'1px solid rgba(240,160,32,0.3)',borderRadius:'2px'}}>SCENARIO ONLY</span>
        )}

        {anyShift&&<span style={{fontSize:'0.40rem',fontWeight:700,padding:'2px 8px',borderRadius:'2px',
          background:avgShift>0?'rgba(224,80,64,0.1)':'rgba(13,212,168,0.1)',
          border:avgShift>0?'1px solid rgba(224,80,64,0.4)':'1px solid rgba(13,212,168,0.4)',
          color:avgShift>0?'var(--red)':'var(--accent)',whiteSpace:'nowrap'}}>
          {avgShift>0?'+':''}{avgShift.toFixed(0)}bp AVG
        </span>}

        {Object.keys(scenarioOverrides).length>0&&(
          <button onClick={()=>setScenarioOverrides({})}
            style={{padding:'4px 8px',borderRadius:'2px',cursor:'pointer',fontFamily:'var(--mono)',
              fontSize:'0.40rem',fontWeight:700,letterSpacing:'0.06em',whiteSpace:'nowrap',
              border:'1px solid rgba(240,160,32,0.4)',background:'rgba(240,160,32,0.06)',color:'var(--amber)'}}>
            ✕ CLEAR OVERRIDES
          </button>
        )}

        <button onClick={handleRunScenario} disabled={scenarioPricing}
          style={{padding:'4px 12px',borderRadius:'2px',cursor:scenarioPricing?'default':'pointer',fontFamily:'var(--mono)',
            fontSize:'0.42rem',fontWeight:700,letterSpacing:'0.08em',whiteSpace:'nowrap',
            border:'1px solid '+(scenarioPricing?'var(--border)':'var(--accent)'),
            background:'transparent',color:scenarioPricing?'var(--text-dim)':'var(--accent)',
            opacity:scenarioPricing?0.5:1}}>
          {scenarioPricing?'RUNNING...':'▶ RUN'}
        </button>
      </div>

      {/* Curve header */}
      <div style={{fontSize:'0.40rem',fontWeight:700,letterSpacing:'0.12em',color:'var(--text-dim)',
        borderBottom:'1px solid var(--border)',paddingBottom:4,display:'flex',alignItems:'center',gap:'8px'}}>
        CURVES
        <span style={{fontSize:'0.38rem',fontWeight:700,color:'var(--accent)',padding:'1px 5px',
          border:'1px solid rgba(13,212,168,0.3)',borderRadius:'2px'}}>{curveId}</span>
        <span style={{fontWeight:400,fontSize:'0.38rem',opacity:0.6}}>· {interpMode.replace('_',' ')}</span>
      </div>

      {/* Curve Designer placeholder */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',
        background:'#070d12',border:'1px solid var(--border)',borderRadius:'2px',padding:'10px 14px'}}>
        <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
          <span style={{fontSize:'0.42rem',fontWeight:700,letterSpacing:'0.10em',color:'var(--text)',fontFamily:'var(--mono)'}}>CURVE DESIGNER</span>
          <span style={{fontSize:'0.38rem',color:'var(--text-dim)',fontFamily:'var(--mono)'}}>
            Drag any tenor point to reshape · Gaussian ripple · Live repricing · Base vs shocked overlay
          </span>
        </div>
        <button style={{padding:'6px 14px',borderRadius:'2px',cursor:'not-allowed',fontFamily:'var(--mono)',
          fontSize:'0.44rem',fontWeight:700,letterSpacing:'0.08em',whiteSpace:'nowrap',
          border:'1px solid rgba(74,154,212,0.4)',background:'rgba(74,154,212,0.08)',color:'var(--blue)',opacity:0.6}}
          title="Coming soon — dedicated curve workspace">
          ↗ OPEN CURVE DESIGNER <span style={{fontSize:'0.36rem',opacity:0.7,marginLeft:'4px'}}>SPRINT 5D</span>
        </button>
      </div>

      {/* Curve table */}
      <div style={{overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',minWidth:'580px'}}>
          <thead>
            <tr style={{background:'var(--bg)',borderBottom:'1px solid var(--border)'}}>
              {['TENOR','BASE RATE','SHIFT (bp)','SHOCKED RATE','ZERO RATE','DF','DF CHANGE'].map((h,hi)=>(
                <th key={h} style={{fontSize:'0.36rem',color:'var(--text-dim)',padding:'4px 6px',
                  textAlign:hi===0?'left':'right',fontWeight:400,letterSpacing:'0.07em'}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TENORS.map((t,i)=>{
              const base    = baseRates[t] || 0
              const sh      = shifts[i] || 0
              const shocked = scenarioOverrides[t]!=null ? parseFloat(scenarioOverrides[t]) : base + sh/100
              const yr      = TENOR_Y[t]
              const dfBase  = Math.exp(-base/100*yr)
              const dfShock = Math.exp(-shocked/100*yr)
              const dfDelta = dfShock - dfBase
              const isOverride = scenarioOverrides[t] != null
              return (
                <tr key={t} style={{borderBottom:'1px solid rgba(30,48,69,0.5)'}}>
                  <td style={{fontSize:'0.42rem',padding:'4px 6px',color:'var(--text-dim)',fontFamily:'var(--mono)'}}>{t}</td>
                  <td style={{fontSize:'0.42rem',padding:'4px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--blue)'}}>{base.toFixed(5)}%</td>
                  <td style={{fontSize:'0.42rem',padding:'4px 6px',textAlign:'right',fontFamily:'var(--mono)',
                    fontWeight:sh!==0?700:400,color:sh>0?'var(--red)':sh<0?'var(--accent)':'var(--text-dim)'}}>
                    {sh>0?'+':''}{sh}
                  </td>
                  <td style={{padding:'2px 4px',textAlign:'right'}}>
                    <input type='text'
                      defaultValue={shocked.toFixed(5)}
                      key={t+'-'+shocked.toFixed(5)}
                      onBlur={e=>{
                        const v=parseFloat(e.target.value)
                        if(!isNaN(v)) setScenarioOverrides(o=>({...o,[t]:v.toFixed(5)}))
                      }}
                      style={{background:'transparent',
                        border:'1px solid '+(isOverride?'rgba(240,160,32,0.5)':sh!==0?'rgba(13,212,168,0.2)':'rgba(30,48,69,0.5)'),
                        borderRadius:'2px',
                        color:isOverride?'var(--amber)':sh>0?'var(--red)':sh<0?'var(--accent)':'var(--blue)',
                        fontFamily:'var(--mono)',fontSize:'0.40rem',padding:'2px 5px',
                        outline:'none',width:'88px',textAlign:'right'}}/>
                  </td>
                  <td style={{fontSize:'0.42rem',padding:'4px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text-dim)'}}>{shocked.toFixed(4)}%</td>
                  <td style={{fontSize:'0.42rem',padding:'4px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text-dim)'}}>{dfShock.toFixed(6)}</td>
                  <td style={{fontSize:'0.40rem',padding:'4px 6px',textAlign:'right',fontFamily:'var(--mono)',
                    color:dfDelta<0?'var(--red)':'var(--accent)'}}>
                    {Math.abs(dfDelta)>0.000001?(dfDelta>=0?'+':'')+dfDelta.toFixed(6):'—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Impact analytics */}
      {(scenarioBase||scenarioCalc)&&(
        <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
          <div style={{fontSize:'0.40rem',fontWeight:700,letterSpacing:'0.12em',color:'var(--text-dim)',
            borderBottom:'1px solid var(--border)',paddingBottom:4,display:'flex',alignItems:'center',gap:'8px'}}>
            IMPACT ANALYTICS
            <span style={{fontWeight:400,fontSize:'0.38rem',opacity:0.6}}>· base vs shocked · {curveId}</span>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'6px',marginBottom:'8px'}}>
            {(() => {
              const baseTheta       = scenarioBase?.theta
              const baseIR01        = scenarioBase?.ir01
              const shockIR01       = scenarioCalc?.ir01
              const approxTheta     = (baseTheta!=null&&baseIR01&&shockIR01)
                ? baseTheta + baseTheta*((shockIR01-baseIR01)/Math.abs(baseIR01))
                : null
              const items = [
                {label:'NET NPV', base:scenarioBase?.npv,   shocked:scenarioCalc?.npv,  approx:false},
                {label:'IR01',    base:scenarioBase?.ir01,  shocked:scenarioCalc?.ir01, approx:false},
                {label:'GAMMA',   base:scenarioBase?.gamma, shocked:scenarioCalc?.gamma,approx:false, dp:4},
                {label:'THETA',   base:baseTheta,           shocked:approxTheta,        approx:true},
              ]
              return items.map(item=>{
                const delta  = item.shocked!=null&&item.base!=null ? item.shocked-item.base : null
                const fmt    = n=>n==null?'—':(n>=0?'+':'')+n.toFixed(item.dp||2)
                const fmtBig = n=>n==null?'—':fmtPnl(n)
                const f      = item.dp ? fmt : fmtBig
                return (
                  <div key={item.label} style={{background:'var(--bg)',border:'1px solid var(--border)',borderRadius:'2px',padding:'6px 8px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'5px',marginBottom:'2px'}}>
                      <span style={{fontSize:'0.36rem',color:'var(--text-dim)',letterSpacing:'0.08em'}}>{item.label}</span>
                      {item.approx&&item.shocked!=null&&(
                        <button onClick={()=>setThetaApproxVisible(v=>!v)}
                          style={{fontSize:'0.32rem',fontWeight:700,padding:'1px 4px',borderRadius:'2px',cursor:'pointer',
                            fontFamily:'var(--mono)',border:'1px solid rgba(240,160,32,0.4)',
                            background:'rgba(240,160,32,0.08)',color:'var(--amber)'}}>
                          {thetaApproxVisible?'▴':'▾'} APPROX
                        </button>
                      )}
                    </div>
                    <div style={{fontSize:'0.48rem',fontWeight:700,fontFamily:'var(--mono)',color:'var(--blue)'}}>{f(item.base)}</div>
                    {item.shocked!=null&&<>
                      <div style={{fontSize:'0.36rem',color:'var(--text-dim)',margin:'2px 0'}}>SHOCKED{item.approx?' (~)':''}</div>
                      <div style={{fontSize:'0.48rem',fontWeight:700,fontFamily:'var(--mono)',
                        color:item.shocked>=0?'var(--accent)':'var(--red)'}}>
                        {f(item.shocked)}{item.approx&&<span style={{fontSize:'0.32rem',color:'var(--amber)',marginLeft:'2px'}}>~</span>}
                      </div>
                      {delta!=null&&<div style={{fontSize:'0.36rem',marginTop:'2px',fontFamily:'var(--mono)',
                        color:delta>=0?'var(--accent)':'var(--red)'}}>
                        IMPACT {delta>=0?'+':''}{f(delta)}{item.approx&&<span style={{color:'var(--amber)'}}> ~</span>}
                      </div>}
                      {item.approx&&thetaApproxVisible&&(
                        <div style={{fontSize:'0.32rem',color:'var(--amber)',marginTop:'3px',lineHeight:1.5,
                          borderTop:'1px solid rgba(240,160,32,0.2)',paddingTop:'3px',fontFamily:'var(--mono)'}}>
                          ΔTheta ∝ ΔIR01/IR01. Directional only.
                        </div>
                      )}
                    </>}
                  </div>
                )
              })
            })()}
          </div>
        </div>
      )}

      {!scenarioBase&&!scenarioPricing&&(
        <div style={{fontSize:'0.44rem',color:'var(--text-dim)',fontFamily:'var(--mono)',padding:'8px 0'}}>
          Select a scenario and click ▶ RUN to see impact analytics.
        </div>
      )}
    </div>
  )
}

export default function TradeBookingWindow({ onClose, onViewTrade, initialPos, windowId, trade: initialTrade }) {
  const { fetchTrades } = useTradesStore()
  const { curves }      = useMarketDataStore()
  const dataLoaded  = useRef(false)
  const dragStart   = useRef(null)
  const notionalRef = useRef(null)
  const rateRef     = useRef(null)
  const spreadRef   = useRef(null)
  const leverageRef = useRef(null)

  const defs = getDefaults()
  const [pos,      setPos]      = useState(initialPos || { x:60, y:20 })
  const [dragging, setDragging] = useState(false)
  const [size,     setSize]     = useState({ w: 900, h: 680 })
  const [resizing, setResizing] = useState(null) // {edge, startX, startY, startW, startH}
  const [activeTab,setActiveTab]= useState('main')
  const [cps,         setCps]         = useState([])
  const [ownEntities, setOwnEntities] = useState([])
  const [desks,       setDesks]       = useState([])
  const [books,       setBooks]       = useState([])
  const [ac,     setAc]     = useState('RATES')
  const [inst,   setInst]   = useState('IR_SWAP')
  const [struct, setStruct] = useState('VANILLA')
  const [store,  setStore]  = useState('WORKING')
  const [ownEntityId, setOwnEntityId] = useState('')
  const [cpId,   setCpId]   = useState('')
  const [ccy,    setCcy]    = useState('USD')
  const [tdate,  setTdate]  = useState(defs.tdate)
  const [effDate,setEffDate]= useState(defs.effDate)
  const [matDate,setMatDate]= useState(defs.matDate)
  const [tenor,  setTenor]  = useState('5Y')
  const [desk,   setDesk]   = useState('')
  const [book,   setBook]   = useState('')
  const [dir,    setDir]    = useState('PAY')
  const [fixedPayFreq,  setFixedPayFreq] = useState('ANNUAL')
  const [fixedDc,       setFixedDc]      = useState('ACT/360')
  const [fixedBdc,      setFixedBdc]     = useState('MOD_FOLLOWING')
  const [fixedCal,      setFixedCal]     = useState('NEW_YORK')
  const [index,         setIndex]        = useState('SOFR')
  const [floatResetFreq,setFloatResetFreq]=useState('DAILY')
  const [floatPayFreq,  setFloatPayFreq] = useState('ANNUAL')
  const [floatDc,       setFloatDc]      = useState('ACT/360')
  const [floatBdc,      setFloatBdc]     = useState('MOD_FOLLOWING')
  const [floatCal,      setFloatCal]     = useState('NEW_YORK')
  const [datesLoading,  setDatesLoading] = useState(false)
  const [booking,       setBooking]      = useState(false)
  const [bookingStep,   setBookingStep]  = useState('')
  const [pricing,       setPricing]      = useState(false)
  const [err,           setErr]          = useState('')
  const [bookedTrade,   setBookedTrade]  = useState(null)
  const [analytics,     setAnalytics]    = useState(null)
  const [analyticsErr,  setAnalyticsErr] = useState(null)
  const [valDate,       setValDate]      = useState('')
  // VIEW MODE — set when opening existing trade from blotter
  const [viewTrade,     setViewTrade]    = useState(initialTrade || null)
  const isViewMode = !!viewTrade

  // SCENARIO tab state moved to <ScenarioTab /> component
  const [rateMode,      setRateMode]     = useState('PAR')
  const [parRate,       setParRate]      = useState(null)
  const [targetNpv,     setTargetNpv]    = useState('')
  const [solvingNpv,    setSolvingNpv]   = useState(false)

  const applyIndexDefaults = (idx) => {
    const [reset, pay, dc] = INDEX_DEFAULTS[idx] || ['DAILY','ANNUAL','ACT/360']
    setFloatResetFreq(reset); setFloatPayFreq(pay); setFloatDc(dc)
  }

  const getSession = async () => {
    const { data:{ session } } = await supabase.auth.getSession()
    return session
  }

  const localDate = () => {
    const n = new Date()
    const p = x => String(x).padStart(2,'0')
    return n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate())
  }

  // Fetch par rate from backend bisection solver
  const fetchParRate = async (effD, matD, ccyVal, idxVal, fxPayFreq, fxDc, fxBdc, fxLag, fltReset, fltPay, fltDc, fltBdc, fltLag) => {
    if (!effD || !matD) return
    if (rateRef.current && rateRef.current.dataset.userEdited) return
    try {
      const session = await getSession()
      if (!session) return
      const curveId = CCY_CURVE[ccyVal] || 'USD_SOFR'
      const payload = {
        curve_id: curveId,
        valuation_date: localDate(),
        effective_date: effD,
        maturity_date: matD,
        currency: ccyVal,
        notional: parseFloat((notionalRef.current ? notionalRef.current.value : '10000000').replace(/,/g,'')),
        direction: dir,
        fixed_pay_freq: fxPayFreq,
        fixed_day_count: fxDc,
        fixed_bdc: fxBdc,
        fixed_payment_lag: fxLag,
        float_index: idxVal,
        float_reset_freq: fltReset,
        float_pay_freq: fltPay,
        float_day_count: fltDc,
        float_bdc: fltBdc,
        float_payment_lag: fltLag,
        spread: parseFloat(spreadRef.current ? spreadRef.current.value : '0') / 10000,
        leverage: parseFloat(leverageRef.current ? leverageRef.current.value : '1.0'),
      }
      const res = await fetch(API + '/api/price/par-rate', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) return
      const data = await res.json()
      if (data.par_rate && rateRef.current && !rateRef.current.dataset.userEdited) {
        rateRef.current.value = data.par_rate.toFixed(4)
        console.log('[RIJEKA] Par rate: ' + data.par_rate.toFixed(4) + '% | NPV check: ' + data.npv_check)
      }
    } catch(e) { /* silent */ }
  }

  // Fetch schedule dates from backend + auto-fetch par rate
  const fetchScheduleDates = async (newTenor, newCcy, newTdate) => {
    setDatesLoading(true)
    try {
      const session = await getSession()
      if (!session) return
      const res = await fetch(API + '/api/schedules/preview', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade_date: newTdate || tdate, tenor: newTenor || tenor, currency: newCcy || ccy }),
      })
      if (!res.ok) return
      const data = await res.json()
      setEffDate(data.effective_date)
      setMatDate(data.maturity_date)
      // dates set — par rate will auto-populate from store via useEffect
    } catch(e) { /* silent */ }
    finally { setDatesLoading(false) }
  }

  const handleTenorChange = (t) => {
    setTenor(t)
    if (rateRef.current) rateRef.current.dataset.userEdited = ''
    fetchScheduleDates(t, ccy, tdate)
  }

  const handleIndexChange = (idx) => {
    setIndex(idx)
    applyIndexDefaults(idx)
    if (rateRef.current) rateRef.current.dataset.userEdited = ''
    const lag = INDEX_PAY_LAG[idx] != null ? INDEX_PAY_LAG[idx] : 2
    fetchParRate(effDate, matDate, ccy, idx,
      fixedPayFreq, fixedDc, fixedBdc, lag,
      (INDEX_DEFAULTS[idx]||['DAILY'])[0], (INDEX_DEFAULTS[idx]||['DAILY','ANNUAL'])[1],
      (INDEX_DEFAULTS[idx]||['DAILY','ANNUAL','ACT/360'])[2], floatBdc, lag)
  }

  // Reset on CCY change
  useEffect(() => {
    const newIdx = (CCY_INDICES[ccy] || ['SOFR'])[0]
    setIndex(newIdx); applyIndexDefaults(newIdx)
    const cal = CCY_CAL[ccy] || 'NEW_YORK'
    setFixedCal(cal); setFloatCal(cal)
    setFixedDc('ACT/360'); setFloatDc(CCY_FLOAT_DC[ccy]||'ACT/360')
    if (rateRef.current) rateRef.current.dataset.userEdited = ''
    fetchScheduleDates(tenor, ccy, tdate)
  }, [ccy])

  // Set valuation date on mount
  useEffect(() => { setValDate(localDate()) }, [])

  // VIEW MODE: pre-populate fields from existing trade
  useEffect(() => {
    if (!viewTrade) return
    const t = viewTrade
    const terms = t.terms || {}
    // Set CCY + direction
    if (t.notional_ccy) setCcy(t.notional_ccy)
    if (terms.direction) setDir(terms.direction)
    // Set dates
    if (t.effective_date) setEffDate(t.effective_date.substring(0,10))
    if (t.maturity_date)  setMatDate(t.maturity_date.substring(0,10))
    if (t.trade_date)     setTdate(t.trade_date.substring(0,10))
    // Set notional
    if (notionalRef.current && t.notional)
      notionalRef.current.value = Number(t.notional).toLocaleString('en-US')
    // Set fixed rate
    if (rateRef.current && terms.fixed_rate != null) {
      rateRef.current.value = (terms.fixed_rate * 100).toFixed(8)
      rateRef.current.dataset.userEdited = '1'
    }
    // Set float params
    if (terms.float_index) setIndex(terms.float_index)
    if (terms.float_reset_freq) setFloatResetFreq(terms.float_reset_freq)
    if (terms.float_pay_freq)   setFloatPayFreq(terms.float_pay_freq)
    if (terms.float_day_count)  setFloatDc(terms.float_day_count)
    if (terms.float_bdc)        setFloatBdc(terms.float_bdc)
    if (terms.fixed_pay_freq)   setFixedPayFreq(terms.fixed_pay_freq)
    if (terms.fixed_day_count)  setFixedDc(terms.fixed_day_count)
    if (terms.fixed_bdc)        setFixedBdc(terms.fixed_bdc)
    // Set structure
    if (t.structure) setStruct(t.structure)
    // Set desk/book/counterparty
    if (t.desk) setDesk(t.desk)
    if (t.book) setBook(t.book)
    if (t.counterparty_id) setCpId(t.counterparty_id)
    if (t.own_legal_entity_id) setOwnEntityId(t.own_legal_entity_id)
  }, [])

  // Fetch dates on mount
  useEffect(() => { fetchScheduleDates('5Y','USD',tdate) }, [])

  // Populate fixed rate from market data store when dates are set
  // For vanilla OIS: the market quote IS the par rate by definition
  useEffect(() => {
    if (!effDate || !matDate) return
    if (rateRef.current && rateRef.current.dataset.userEdited) return
    const tenorY = (new Date(matDate) - new Date(effDate)) / (365.25 * 24 * 3600 * 1000)
    if (tenorY <= 0) return
    const curveId = CCY_CURVE[ccy] || 'USD_SOFR'
    const rate = getParRateFromStore(curves, curveId, tenorY)
    if (rate && rateRef.current && !rateRef.current.dataset.userEdited) {
      rateRef.current.value = rate
      setParRate(parseFloat(rate))
    } else if (!rate) {
      // Store empty — fall back to backend solver
      const payLag = INDEX_PAY_LAG[index] != null ? INDEX_PAY_LAG[index] : 2
      fetchParRate(effDate, matDate, ccy, index, fixedPayFreq, fixedDc, fixedBdc, payLag, floatResetFreq, floatPayFreq, floatDc, floatBdc, payLag)
    }
  }, [effDate, matDate, ccy, curves])

  useEffect(() => {
    if (dataLoaded.current) return; dataLoaded.current = true
    ;(async () => {
      const session = await getSession()
      if (!session) return
      const h = { Authorization:'Bearer '+session.access_token }
      const [cpR, orgR, leR] = await Promise.all([
        fetch(API+'/api/counterparties/',{headers:h}),
        fetch(API+'/nodes',{headers:h}),
        fetch(API+'/api/legal-entities/',{headers:h}),
      ])
      if (cpR.ok) setCps(await cpR.json())
      if (orgR.ok) { const n=await orgR.json(); setDesks(n.filter(x=>x.node_type==='desk'&&x.is_active!==false)); setBooks(n.filter(x=>x.node_type==='book'&&x.is_active!==false)) }
      if (leR.ok) { const les=await leR.json(); setOwnEntities(les); const own=les.filter(e=>e.is_own_entity); if(own.length>0) setOwnEntityId(own[0].id) }
    })()
  }, [])

  useEffect(() => {
    if (!dragging) return
    const mv = e => setPos({x:dragStart.current.px+e.clientX-dragStart.current.mx, y:dragStart.current.py+e.clientY-dragStart.current.my})
    const up = () => setDragging(false)
    window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up)
    return () => { window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up) }
  }, [dragging])

  useEffect(() => {
    if (!resizing) return
    const mv = e => {
      const dx = e.clientX - resizing.startX
      const dy = e.clientY - resizing.startY
      setSize(s => {
        let w = s.w, h = s.h
        if (resizing.edge.includes('e')) w = Math.max(600, Math.min(window.innerWidth - 40, resizing.startW + dx))
        if (resizing.edge.includes('s')) h = Math.max(400, Math.min(window.innerHeight - 40, resizing.startH + dy))
        if (resizing.edge.includes('w')) {
          const nw = Math.max(600, resizing.startW - dx)
          setPos(p => ({ ...p, x: resizing.startX + (resizing.startW - nw) + (e.clientX - resizing.startX) - (resizing.startW - nw) }))
          w = nw
        }
        return { w, h }
      })
    }
    const up = () => setResizing(null)
    window.addEventListener('mousemove', mv)
    window.addEventListener('mouseup', up)
    return () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up) }
  }, [resizing])

  const floatDir = dir === 'PAY' ? 'RECEIVE' : 'PAY'

  const buildLegs = (tradeId, notional) => {
    const curveId    = CCY_CURVE[ccy] || 'USD_SOFR'
    const forecastId = INDEX_CURVE[index] || curveId
    const isOIS      = struct === 'OIS'
    const fixedRate  = parseFloat(rateRef.current ? rateRef.current.value : '0') / 100
    const spreadVal  = parseFloat(spreadRef.current ? spreadRef.current.value : '0') / 10000
    const leverageVal= parseFloat(leverageRef.current ? leverageRef.current.value : '1.0')
    const payLag     = INDEX_PAY_LAG[index] != null ? INDEX_PAY_LAG[index] : 2
    return [
      { id:crypto.randomUUID(), trade_id:tradeId, leg_ref:'FIXED-1', leg_seq:1, leg_type:'FIXED',
        direction:dir, currency:ccy, notional, notional_type:'BULLET',
        effective_date:effDate, maturity_date:matDate,
        day_count:fixedDc, payment_frequency:fixedPayFreq,
        bdc:fixedBdc, payment_calendar:fixedCal,
        stub_type:'SHORT_FRONT', payment_lag:payLag, fixed_rate:fixedRate,
        discount_curve_id:curveId, forecast_curve_id:null, ois_compounding:null },
      { id:crypto.randomUUID(), trade_id:tradeId, leg_ref:'FLOAT-1', leg_seq:2, leg_type:'FLOAT',
        direction:floatDir, currency:ccy, notional, notional_type:'BULLET',
        effective_date:effDate, maturity_date:matDate,
        day_count:floatDc, payment_frequency:floatPayFreq,
        reset_frequency: isOIS ? 'DAILY' : floatResetFreq,
        bdc:floatBdc, payment_calendar:floatCal,
        stub_type:'SHORT_FRONT', payment_lag:payLag, fixed_rate:0,
        spread:isNaN(spreadVal)?0:spreadVal, leverage:isNaN(leverageVal)?1.0:leverageVal,
        discount_curve_id:curveId, forecast_curve_id:forecastId,
        ois_compounding: isOIS ? 'COMPOUNDING' : null },
    ]
  }

  const executeBooking = async (finalBook=false) => {
    const raw = notionalRef.current ? notionalRef.current.value.replace(/,/g,'') : ''
    if (!raw || isNaN(parseFloat(raw))) { setErr('Notional is required.'); return null }
    if (!effDate||!matDate) { setErr('Dates are required.'); return null }
    const notional = parseFloat(raw)
    const rateVal  = parseFloat(rateRef.current ? rateRef.current.value : '0')
    const session = await getSession()
    const h = { Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' }
    const tradeRes = await fetch(API+'/api/trades/', { method:'POST', headers:h, body:JSON.stringify({
      status:'PENDING', store: finalBook?store:'WORKING',
      asset_class:ac, instrument_type:inst, structure:inst==='IR_SWAP'?struct:null,
      own_legal_entity_id:ownEntityId||null, counterparty_id:cpId||null,
      notional, notional_ccy:ccy, trade_date:tdate, effective_date:effDate, maturity_date:matDate,
      desk:desk||null, book:book||null,
      terms:{ direction:dir, float_direction:floatDir,
        fixed_rate:isNaN(rateVal)?null:rateVal/100,
        fixed_pay_freq:fixedPayFreq, fixed_day_count:fixedDc, fixed_bdc:fixedBdc, fixed_calendar:fixedCal,
        float_index:index, float_reset_freq:floatResetFreq, float_pay_freq:floatPayFreq,
        float_day_count:floatDc, float_bdc:floatBdc, float_calendar:floatCal,
        spread:parseFloat(spreadRef.current ? spreadRef.current.value : '0')/10000,
        leverage:parseFloat(leverageRef.current ? leverageRef.current.value : '1.0'),
      }
    })})
    if (!tradeRes.ok) { const e=await tradeRes.json().catch(()=>({})); throw new Error(e.detail||'Booking failed') }
    const trade  = await tradeRes.json()
    const tradeId = trade.id||trade.trade_id
    const legs   = buildLegs(tradeId, notional)
    await Promise.all(legs.map(leg => fetch(API+'/api/trade-legs/',{method:'POST',headers:h,body:JSON.stringify(leg)})))
    const curveId = CCY_CURVE[ccy]||'USD_SOFR'
    const vd = valDate
    const priceRes = await fetch(API+'/price',{method:'POST',headers:h,
      body:JSON.stringify({trade_id:tradeId,valuation_date:vd,curves:[{curve_id:curveId,quotes:[]}]})})
    if (!priceRes.ok) throw new Error('Pricing failed')
    return { trade, priceData: await priceRes.json() }
  }

  // Stateless pre-trade pricer — calls /price/preview, zero DB writes
  const pricePreview = async () => {
    const raw = notionalRef.current ? notionalRef.current.value.replace(/,/g,'') : ''
    if (!raw || isNaN(parseFloat(raw))) throw new Error('Notional is required.')
    if (!effDate || !matDate) throw new Error('Dates are required.')
    const notional   = parseFloat(raw)
    const rateVal    = parseFloat(rateRef.current ? rateRef.current.value : '0')
    const spreadVal  = parseFloat(spreadRef.current ? spreadRef.current.value : '0') / 10000
    const leverageVal= parseFloat(leverageRef.current ? leverageRef.current.value : '1.0')
    const payLag     = INDEX_PAY_LAG[index] != null ? INDEX_PAY_LAG[index] : 2
    const curveId    = CCY_CURVE[ccy] || 'USD_SOFR'
    const forecastId = INDEX_CURVE[index] || curveId
    const isOIS      = struct === 'OIS'
    const session    = await getSession()
    const h = { Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' }

    const legs = [
      {
        leg_ref:'FIXED-1', leg_seq:1, leg_type:'FIXED',
        direction:dir, currency:ccy, notional,
        effective_date:effDate, maturity_date:matDate,
        day_count:fixedDc, payment_frequency:fixedPayFreq,
        bdc:fixedBdc, payment_lag:payLag,
        fixed_rate: isNaN(rateVal) ? 0 : rateVal / 100,
        discount_curve_id:curveId, forecast_curve_id:null,
        ois_compounding:null,
      },
      {
        leg_ref:'FLOAT-1', leg_seq:2, leg_type:'FLOAT',
        direction: dir==='PAY'?'RECEIVE':'PAY',
        currency:ccy, notional,
        effective_date:effDate, maturity_date:matDate,
        day_count:floatDc, payment_frequency:floatPayFreq,
        reset_frequency: isOIS ? 'DAILY' : floatResetFreq,
        bdc:floatBdc, payment_lag:payLag,
        fixed_rate:0,
        spread: isNaN(spreadVal) ? 0 : spreadVal,
        leverage: isNaN(leverageVal) ? 1.0 : leverageVal,
        discount_curve_id:curveId, forecast_curve_id:forecastId,
        ois_compounding: isOIS ? 'COMPOUNDING' : null,
      },
    ]

    const res = await fetch(API + '/price/preview', {
      method:'POST', headers:h,
      body: JSON.stringify({
        legs,
        valuation_date: valDate,
        curves: [{ curve_id: curveId, quotes: [] }],
      }),
    })
    if (!res.ok) {
      const e = await res.json().catch(()=>({}))
      throw new Error(e.detail || 'Pricing failed')
    }
    return await res.json()
  }

  const repriceExisting = async () => {
    const session = await getSession()
    const h = { Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' }
    const curveId = CCY_CURVE[viewTrade.notional_ccy || ccy] || 'USD_SOFR'
    const res = await fetch(API+'/price', {
      method:'POST', headers:h,
      body: JSON.stringify({
        trade_id: viewTrade.id,
        valuation_date: valDate,
        curves: [{ curve_id: curveId, quotes: [] }],
      }),
    })
    if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.detail||'Pricing failed') }
    return await res.json()
  }

  const handlePrice = async () => {
    setErr(''); setAnalyticsErr(null); setPricing(true); setAnalytics(null)
    try {
      const data = viewTrade ? await repriceExisting() : await pricePreview()
      setAnalytics(data)
    }
    catch(e) { setAnalyticsErr(e.message) }
    finally { setPricing(false) }
  }
  const handleBook = async () => {
    setErr(''); setBooking(true)
    try {
      setBookingStep('Creating trade...')
      const r = await executeBooking(true)
      if (r) { await fetchTrades(); setBookedTrade(r.trade); setAnalytics(r.priceData); setAnalyticsErr(null) }
    } catch(e) { setErr(e.message) }
    finally { setBooking(false); setBookingStep('') }
  }
  const handleNewTrade = () => {
    setBookedTrade(null); setAnalytics(null); setAnalyticsErr(null); setErr('')
    if(rateRef.current){rateRef.current.value='';rateRef.current.dataset.userEdited=''}
    if(spreadRef.current) spreadRef.current.value='0'
    if(leverageRef.current) leverageRef.current.value='1.0'
  }
  const handleViewTrade = () => {
    const id = bookedTrade ? (bookedTrade.trade_id||bookedTrade.id) : null
    if(onViewTrade&&id) onViewTrade(id); else onClose()
  }

  const Chip = ({label,active,live=true,onClick}) => (
    <button className={'tbw-chip '+(active?'active':'')} onClick={live?onClick:undefined}
      style={!live?{opacity:0.35,cursor:'not-allowed'}:{}} title={!live?'Coming soon':''}>
      {label}{!live&&<span style={{fontSize:'0.42rem',marginLeft:'4px',color:'var(--text-dim)'}}>SOON</span>}
    </button>
  )

  const npv   = analytics ? analytics.npv   : null
  const ir01  = analytics ? analytics.ir01  : null
  const ir01d = analytics ? analytics.ir01_disc : null
  const theta = analytics ? analytics.theta : null
  const gamma = analytics ? analytics.gamma : null

  // Tooltip state for analytics column headers
  const [tooltip, setTooltip] = useState(null)
  const GREEK_TIPS = {
    'PV':       'Present value of this leg discounted to today. Positive = asset, negative = liability.',
    'IR01':     'Dollar sensitivity to a +1bp parallel shift in ALL rate curves (discount + forecast). Full interest rate risk. Also called DV01 by some desks — banned here.',
    'IR01 DISC':'Dollar sensitivity to +1bp on DISCOUNT curves only, forecast held flat. Isolates funding cost from rate expectations. Typically 10–20% of IR01 for vanilla IRS.',
    'GAMMA':    'Dollar convexity: rate of change of IR01 per 1bp move. NPV(+1bp) + NPV(−1bp) − 2×NPV(0). Near-zero for vanilla IRS, significant for swaptions and long-dated structures.',
    'THETA':    'Daily time decay: NPV(tomorrow) − NPV(today) with unchanged market rates. Carry + roll-down combined. Negative for OTM pay-fixed positions.',
  }
  const legs  = analytics ? (analytics.legs || []) : []

  const fmtDate = d => {
    if (!d) return '—'
    const parts = d.split('-')
    return new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]))
      .toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'})
  }
  const fmtN = n => n==null ? '—' : Math.round(n).toLocaleString('en-US')

  return (
    <div className='tbw-overlay'>
      {/* ── Handle layer: sibling to window, always on top ── */}
      <div style={{
        position:'absolute',
        left: pos.x, top: pos.y,
        width: size.w, height: size.h,
        pointerEvents: 'none',
        zIndex: 9999,
      }}>
        {/* MOVE: top edge */}
        <div style={{position:'absolute',top:-4,left:16,width:'calc(100% - 32px)',height:8,cursor:'move',pointerEvents:'all'}}
          onMouseDown={e=>{e.preventDefault();e.stopPropagation();dragStart.current={mx:e.clientX,my:e.clientY,px:pos.x,py:pos.y};setDragging(true)}}/>
        {/* MOVE: bottom edge */}
        <div style={{position:'absolute',bottom:-4,left:16,width:'calc(100% - 32px)',height:8,cursor:'move',pointerEvents:'all'}}
          onMouseDown={e=>{e.preventDefault();e.stopPropagation();dragStart.current={mx:e.clientX,my:e.clientY,px:pos.x,py:pos.y};setDragging(true)}}/>
        {/* MOVE: left edge */}
        <div style={{position:'absolute',top:16,left:-4,width:8,height:'calc(100% - 32px)',cursor:'move',pointerEvents:'all'}}
          onMouseDown={e=>{e.preventDefault();e.stopPropagation();dragStart.current={mx:e.clientX,my:e.clientY,px:pos.x,py:pos.y};setDragging(true)}}/>
        {/* MOVE: right edge */}
        <div style={{position:'absolute',top:16,right:-4,width:8,height:'calc(100% - 32px)',cursor:'move',pointerEvents:'all'}}
          onMouseDown={e=>{e.preventDefault();e.stopPropagation();dragStart.current={mx:e.clientX,my:e.clientY,px:pos.x,py:pos.y};setDragging(true)}}/>
        {/* MOVE: NW corner */}
        <div style={{position:'absolute',top:-4,left:-4,width:16,height:16,cursor:'move',pointerEvents:'all'}}
          onMouseDown={e=>{e.preventDefault();e.stopPropagation();dragStart.current={mx:e.clientX,my:e.clientY,px:pos.x,py:pos.y};setDragging(true)}}/>
        {/* MOVE: NE corner */}
        <div style={{position:'absolute',top:-4,right:-4,width:16,height:16,cursor:'move',pointerEvents:'all'}}
          onMouseDown={e=>{e.preventDefault();e.stopPropagation();dragStart.current={mx:e.clientX,my:e.clientY,px:pos.x,py:pos.y};setDragging(true)}}/>
        {/* MOVE: SW corner */}
        <div style={{position:'absolute',bottom:-4,left:-4,width:16,height:16,cursor:'move',pointerEvents:'all'}}
          onMouseDown={e=>{e.preventDefault();e.stopPropagation();dragStart.current={mx:e.clientX,my:e.clientY,px:pos.x,py:pos.y};setDragging(true)}}/>
        {/* RESIZE: SE corner only — grab bottom-right corner to resize */}
        <div style={{position:'absolute',bottom:-4,right:-4,width:16,height:16,cursor:'se-resize',pointerEvents:'all'}}
          onMouseDown={e=>{e.preventDefault();e.stopPropagation();setResizing({edge:'se',startX:e.clientX,startY:e.clientY,startW:size.w,startH:size.h})}}/>
      </div>

      <div className='tbw-window' style={{
        left:pos.x, top:pos.y,
        width: size.w+'px', height: size.h+'px',
        display:'flex', flexDirection:'column', overflow:'hidden',
        userSelect: resizing ? 'none' : 'auto',
      }}>
        {/* Handles moved to sibling overlay below */}
        <div className='tbw-titlebar' onMouseDown={e=>{
          if(e.target.closest('.tbw-no-drag')) return
          setDragging(true); dragStart.current={mx:e.clientX,my:e.clientY,px:pos.x,py:pos.y}
        }}>
          <div className='tbw-dots'>
            <span className='tbw-dot tbw-dot-red' onClick={onClose}/>
            <span className='tbw-dot tbw-dot-amber'/>
            <span className='tbw-dot tbw-dot-green'/>
          </div>
          <span className='tbw-title'>
            {bookedTrade ? 'BOOKED · '+(bookedTrade.trade_ref||bookedTrade.id) : viewTrade ? (viewTrade.trade_ref||viewTrade.id) : 'NEW TRADE'}
          </span>
          <span className='tbw-store-badge tbw-no-drag' style={{display:'flex',gap:'6px',alignItems:'center'}}>
            {bookedTrade ? (
              <>
                <button onClick={handleViewTrade} style={{fontSize:'0.44rem',fontWeight:700,padding:'2px 8px',borderRadius:'2px',cursor:'pointer',fontFamily:'var(--mono)',background:'rgba(13,212,168,0.08)',border:'1px solid var(--accent)',color:'var(--accent)'}}>VIEW IN BLOTTER</button>
                <button onClick={handleNewTrade} style={{fontSize:'0.44rem',fontWeight:700,padding:'2px 8px',borderRadius:'2px',cursor:'pointer',fontFamily:'var(--mono)',background:'transparent',border:'1px solid var(--border)',color:'var(--text-dim)'}}>NEW TRADE</button>
              </>
            ) : viewTrade ? (
              <span style={{
                fontSize:'0.48rem',fontWeight:700,letterSpacing:'0.1em',
                padding:'2px 10px',borderRadius:'2px',fontFamily:'var(--mono)',
                background: viewTrade.status==='LIVE' ? 'rgba(13,212,168,0.10)' :
                            viewTrade.status==='CONFIRMED' ? 'rgba(74,154,212,0.10)' :
                            'rgba(240,160,32,0.10)',
                border: viewTrade.status==='LIVE' ? '1px solid rgba(13,212,168,0.4)' :
                        viewTrade.status==='CONFIRMED' ? '1px solid rgba(74,154,212,0.4)' :
                        '1px solid rgba(240,160,32,0.4)',
                color: viewTrade.status==='LIVE' ? 'var(--accent)' :
                       viewTrade.status==='CONFIRMED' ? 'var(--blue)' :
                       'var(--amber)',
              }}>
                {viewTrade.status || 'PENDING'}
              </span>
            ) : null}
          </span>
        </div>
        <div className='tbw-tabs tbw-no-drag'>
          {[{id:'main',label:bookedTrade?'✓ TRADE':'TRADE'},{id:'price',label:'ALL-IN PRICE'},{id:'cashflows',label:'CASHFLOWS'},{id:'scenario',label:'SCENARIO'},{id:'confirm',label:'⯁ CONFIRM'}].map(t=>(
            <button key={t.id} className={'tbw-tab '+(activeTab===t.id?'active':'')}
              onClick={()=>setActiveTab(t.id)}
              style={t.id==='main'&&bookedTrade?{color:'var(--accent)'}:{}}
            >{t.label}</button>
          ))}
        </div>
        {activeTab==='scenario' && (
          <ScenarioTab
            ccy={ccy}
            index={index}
            dir={dir}
            struct={struct}
            effDate={effDate}
            matDate={matDate}
            valDate={valDate}
            curves={curves}
            analytics={analytics}
            notionalRef={notionalRef}
            rateRef={rateRef}
            fixedPayFreq={fixedPayFreq}
            fixedDc={fixedDc}
            fixedBdc={fixedBdc}
            floatResetFreq={floatResetFreq}
            floatPayFreq={floatPayFreq}
            floatDc={floatDc}
            floatBdc={floatBdc}
            getSession={getSession}
          />
        )}
        {activeTab==='price' && <div className='tbw-body tbw-no-drag'><div className='tbw-stub'><div className='tbw-stub-title'>ALL-IN PRICE</div><div className='tbw-stub-sub'>XVA waterfall · CVA · DVA · FVA</div><div className='tbw-stub-sprint'>SPRINT 6D</div></div></div>}
        {activeTab==='confirm' && <div className='tbw-body tbw-no-drag'><div className='tbw-stub'><div className='tbw-stub-title'>⯁ CONFIRM</div><div className='tbw-stub-sub'>Cashflow fingerprint · On-chain signing</div><div className='tbw-stub-sprint'>SPRINT 6A</div></div></div>}

        {activeTab==='cashflows' && (
          <div className='tbw-no-drag' style={{flex:1,overflowY:'auto',padding:'10px 16px',display:'flex',flexDirection:'column',gap:'10px'}}>
            {!analytics ? (
              <div style={{fontSize:'0.46rem',color:'var(--text-dim)',fontFamily:'var(--mono)',padding:'12px 0'}}>Price the trade first to view cashflow schedule.</div>
            ) : (
              <>
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'6px'}}>
                  {[
                    {label:'NET NPV', val:fmtPnl(npv), color: npv!=null&&npv>=0?'var(--accent)':'var(--red)'},
                    {label:'FIXED LEG PV', val:fmtPnl(legs.find(l=>l.leg_type==='FIXED')?(legs.find(l=>l.leg_type==='FIXED').pv):null), color:'var(--red)'},
                    {label:'FLOAT LEG PV', val:fmtPnl(legs.find(l=>l.leg_type==='FLOAT')?(legs.find(l=>l.leg_type==='FLOAT').pv):null), color:'var(--accent)'},
                    {label:'PERIODS', val:(legs.find(l=>l.leg_type==='FIXED')?((legs.find(l=>l.leg_type==='FIXED').cashflows||[]).length):0)+' + '+(legs.find(l=>l.leg_type==='FLOAT')?((legs.find(l=>l.leg_type==='FLOAT').cashflows||[]).length):0), color:'var(--blue)'},
                  ].map(s=>(
                    <div key={s.label} style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',padding:'6px 8px'}}>
                      <div style={{fontSize:'0.38rem',color:'var(--text-dim)',letterSpacing:'0.08em',marginBottom:'2px'}}>{s.label}</div>
                      <div style={{fontSize:'0.58rem',fontWeight:700,fontFamily:'var(--mono)',color:s.color}}>{s.val}</div>
                    </div>
                  ))}
                </div>
                {legs.map((leg,li)=>(
                  <div key={li}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'6px 0 4px',borderBottom:'1px solid var(--border)',marginBottom:'0'}}>
                      <span style={{fontSize:'0.42rem',fontWeight:700,letterSpacing:'0.12em',color:'var(--text-dim)'}}>{leg.leg_type} LEG</span>
                      <span style={{fontSize:'0.38rem',fontWeight:700,padding:'1px 6px',borderRadius:'2px',
                        background: leg.direction==='PAY'?'rgba(224,80,64,0.10)':'rgba(13,212,168,0.10)',
                        border: '1px solid '+(leg.direction==='PAY'?'var(--red)':'var(--accent)'),
                        color: leg.direction==='PAY'?'var(--red)':'var(--accent)',
                      }}>{leg.direction==='PAY'?'→ PAY':'← RECEIVE'}</span>
                    </div>
                    <div style={{overflowX:'auto'}}>
                      <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',minWidth:'680px'}}>
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
                            const pv = cf.pv != null ? cf.pv : (cf.amount * (cf.df||1) * (leg.direction==='PAY'?-1:1))
                            return (
                              <tr key={ci} style={{borderBottom:'1px solid var(--panel-2)'}}>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',color:'var(--text-dim)',fontFamily:'var(--mono)'}}>{fmtDate(cf.period_start)}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',color:'var(--text-dim)',fontFamily:'var(--mono)'}}>{fmtDate(cf.period_end)}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',fontFamily:'var(--mono)',
                                  color: cf.payment_date!==cf.period_end?'var(--amber)':'var(--text-dim)'}}>{fmtDate(cf.payment_date)}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--blue)'}}>{cf.dcf!=null?cf.dcf.toFixed(5):'—'}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text-dim)'}}>{fmtN(cf.notional)}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--blue)'}}>{cf.rate!=null?(cf.rate*100).toFixed(4)+'%':'—'}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text)'}}>{fmtN(cf.amount)}</td>
                                <td style={{fontSize:'0.44rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text-dim)'}}>{cf.df!=null?cf.df.toFixed(5):'—'}</td>
                                <td style={{fontSize:'0.48rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',fontWeight:600,
                                  color:pv>=0?'var(--accent)':'var(--red)'}}>{fmtPnl(pv)}</td>
                                <td style={{fontSize:'0.42rem',padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text-dim)'}}>{cf.zero_rate!=null?(cf.zero_rate*100).toFixed(3):'—'}</td>
                              </tr>
                            )
                          })}
                          <tr style={{borderTop:'2px solid var(--border)',background:'rgba(255,255,255,0.02)'}}>
                            <td colSpan={6} style={{fontSize:'0.42rem',fontWeight:700,color:'var(--text-dim)',padding:'5px 6px',letterSpacing:'0.08em'}}>TOTAL</td>
                            <td style={{fontSize:'0.48rem',fontWeight:700,padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text)'}}>
                              {Math.round((leg.cashflows||[]).reduce((s,cf)=>s+(cf.amount||0),0)).toLocaleString('en-US')}
                            </td>
                            <td/>
                            <td style={{fontSize:'0.48rem',fontWeight:700,padding:'5px 6px',textAlign:'right',fontFamily:'var(--mono)',
                              color:leg.pv>=0?'var(--accent)':'var(--red)'}}>{fmtPnl(leg.pv)}</td>
                            <td/>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                <div style={{fontSize:'0.40rem',color:'var(--text-dim)',fontFamily:'var(--mono)',padding:'4px 0'}}>
                  {CCY_CURVE[ccy]||'USD_SOFR'} · {analytics.curve_mode} · {analytics.valuation_date}
                  {' · amber = pay date shifted by calendar'}
                </div>
              </>
            )}
          </div>
        )}

        {activeTab==='main' && (
          <div className='tbw-no-drag' style={{flex:1,overflowY:'auto',padding:'10px 16px 0',display:'flex',flexDirection:'column'}}>
            {bookedTrade&&(
              <div style={{background:'rgba(13,212,168,0.06)',border:'1px solid rgba(13,212,168,0.18)',borderRadius:'2px',padding:'5px 10px',marginBottom:'6px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <span style={{fontSize:'0.48rem',fontFamily:'var(--mono)',color:'var(--accent)'}}>✓ {bookedTrade.trade_ref||bookedTrade.id}</span>
                <button onClick={()=>navigator.clipboard.writeText(String(bookedTrade.trade_ref||bookedTrade.id))} style={{fontSize:'0.40rem',color:'var(--text-dim)',background:'transparent',border:'1px solid var(--border)',borderRadius:'2px',padding:'2px 6px',cursor:'pointer',fontFamily:'var(--mono)'}}>COPY</button>
              </div>
            )}
            <SectionHdr mt={0}>INSTRUMENT</SectionHdr>
            <div className='tbw-chip-row'>
              {ASSET_CLASSES.map(a=><Chip key={a} label={a} active={ac===a} live={LIVE_AC.includes(a)} onClick={()=>{setAc(a);setInst(INSTRUMENTS[a][0])}}/>)}
            </div>
            <div className='tbw-chip-row' style={{marginTop:'3px'}}>
              {(INSTRUMENTS[ac]||[]).map(i=><Chip key={i} label={i.replace(/_/g,' ')} active={inst===i} live={(LIVE_INST[ac]||[]).includes(i)} onClick={()=>setInst(i)}/>)}
            </div>
            {inst==='IR_SWAP'&&(
              <div className='tbw-chip-row' style={{marginTop:'3px'}}>
                {IR_STRUCTS.map(s=><Chip key={s} label={s.replace(/_/g,' ')} active={struct===s} live={LIVE_STRUCT.includes(s)} onClick={()=>setStruct(s)}/>)}
              </div>
            )}
            <SectionHdr>COUNTERPARTY + BOOK</SectionHdr>
            <Row>
              <Fld label='OWN ENTITY' flex={2}><select style={sel} value={ownEntityId} onChange={e=>setOwnEntityId(e.target.value)}><option value=''>— select —</option>{ownEntities.map(e=><option key={e.id} value={e.id}>{e.short_name||e.name}</option>)}</select></Fld>
              <Fld label='COUNTERPARTY' flex={2}><select style={sel} value={cpId} onChange={e=>setCpId(e.target.value)}><option value=''>— select —</option>{cps.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Fld>
              <Fld label='TRADE DATE' flex={1.4}><input style={inp} type='date' value={tdate} onChange={e=>{setTdate(e.target.value);fetchScheduleDates(tenor,ccy,e.target.value)}}/></Fld>
              <Fld label='DESK' flex={1}><select style={sel} value={desk} onChange={e=>{setDesk(e.target.value);setBook('')}}><option value=''>—</option>{desks.map(d=><option key={d.id} value={d.name}>{d.name}</option>)}</select></Fld>
              <Fld label='BOOK' flex={1}><select style={sel} value={book} onChange={e=>setBook(e.target.value)}><option value=''>—</option>{books.map(b=><option key={b.id} value={b.name}>{b.name}</option>)}</select></Fld>
            </Row>
            <SectionHdr>PRIMARY ECONOMICS</SectionHdr>
            <Row>
              <Fld label='NOTIONAL' flex={2.5}><input ref={notionalRef} style={{...inp,fontSize:'0.68rem',fontWeight:700}} type='text' defaultValue='10,000,000' placeholder='10,000,000' autoComplete='off' onBlur={e=>{const r=e.target.value.replace(/[^0-9]/g,'');e.target.value=r?Number(r).toLocaleString('en-US'):''}}/></Fld>
              <Fld label='CCY' flex={0.9}><select style={{...sel,fontSize:'0.68rem',fontWeight:700}} value={ccy} onChange={e=>setCcy(e.target.value)}>{CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</select></Fld>
              <Fld label='DIRECTION' flex={1.8}>
                <div style={{display:'flex',gap:'5px',height:'31px'}}>
                  <DirBtn label='PAY FIXED'     active={dir==='PAY'}     color='var(--red)'    onClick={()=>setDir('PAY')}/>
                  <DirBtn label='RECEIVE FIXED' active={dir==='RECEIVE'} color='var(--accent)' onClick={()=>setDir('RECEIVE')}/>
                </div>
              </Fld>
              <Fld label='TENOR' flex={1.0}><select style={{...sel,fontSize:'0.68rem',fontWeight:700}} value={tenor} onChange={e=>handleTenorChange(e.target.value)}>{TENORS.map(t=><option key={t} value={t}>{t}</option>)}</select></Fld>
              <Fld label={'EFF DATE'+(datesLoading?' ⟳':'')} flex={1.5}><input style={{...inp,fontSize:'0.60rem',color:datesLoading?'var(--text-dim)':'var(--text)'}} type='date' value={effDate} onChange={e=>setEffDate(e.target.value)}/></Fld>
              <Fld label={'MAT DATE'+(datesLoading?' ⟳':'')} flex={1.5}><input style={{...inp,fontSize:'0.60rem',color:datesLoading?'var(--text-dim)':'var(--text)'}} type='date' value={matDate} onChange={e=>setMatDate(e.target.value)}/></Fld>
            </Row>
            <SectionHdr>
              FIXED LEG
              <Badge label={dir==='PAY'?'→ PAY FIXED':'← RECEIVE FIXED'} color={dir==='PAY'?'var(--red)':'var(--accent)'}/>
            </SectionHdr>
            <Row>
              <Fld label='COUPON (%)' flex={1.4}>
                <div style={{display:'flex',gap:'4px',alignItems:'stretch'}}>
                  <input ref={rateRef}
                    style={{...inp,fontSize:'0.68rem',fontWeight:700,flex:1,
                      color: rateMode==='PAR' ? 'var(--accent)' : 'var(--amber)',
                      borderColor: rateMode==='PAR' ? 'rgba(13,212,168,0.4)' : 'rgba(240,160,32,0.4)',
                    }}
                    type='text' placeholder='—' autoComplete='off'
                    readOnly={rateMode==='PAR'}
                    onChange={()=>{ if(rateRef.current) rateRef.current.dataset.userEdited='1' }}
                  />
                  <button
                    onClick={()=>{
                      if (rateMode==='PAR') {
                        setRateMode('FIXED')
                        if (rateRef.current) rateRef.current.dataset.userEdited='1'
                      } else {
                        setRateMode('PAR')
                        if (rateRef.current) { rateRef.current.dataset.userEdited=''; rateRef.current.value='' }
                        const tenorY = (new Date(matDate) - new Date(effDate)) / (365.25 * 24 * 3600 * 1000)
                        const curveId = CCY_CURVE[ccy] || 'USD_SOFR'
                        const rate = getParRateFromStore(curves, curveId, tenorY)
                        if (rate && rateRef.current) { rateRef.current.value = rate; setParRate(parseFloat(rate)) }
                        setAnalytics(null)
                      }
                    }}
                    style={{
                      padding:'0 8px', borderRadius:'2px', cursor:'pointer',
                      fontFamily:'var(--mono)', fontSize:'0.42rem', fontWeight:700,
                      letterSpacing:'0.06em', whiteSpace:'nowrap',
                      border: rateMode==='PAR'
                        ? '1px solid rgba(13,212,168,0.5)'
                        : '1px solid rgba(240,160,32,0.5)',
                      background: rateMode==='PAR'
                        ? 'rgba(13,212,168,0.08)'
                        : 'rgba(240,160,32,0.08)',
                      color: rateMode==='PAR' ? 'var(--accent)' : 'var(--amber)',
                    }}
                  >
                    {rateMode==='PAR' ? '◉ PAR' : '◎ FIXED'}
                  </button>
                </div>
              </Fld>
              <Fld label='PAY FREQ' flex={1.5}><select style={sel} value={fixedPayFreq} onChange={e=>setFixedPayFreq(e.target.value)}>{PAY_FREQS.map(f=><option key={f} value={f}>{f}</option>)}</select></Fld>
              <Fld label='DAY COUNT' flex={1.4}><select style={sel} value={fixedDc} onChange={e=>setFixedDc(e.target.value)}>{DAY_COUNTS.map(d=><option key={d} value={d}>{d}</option>)}</select></Fld>
              <Fld label='BDC' flex={1.6}><select style={sel} value={fixedBdc} onChange={e=>setFixedBdc(e.target.value)}>{BDCS.map(b=><option key={b} value={b}>{b}</option>)}</select></Fld>
              <Fld label='CALENDAR' flex={1.8}><select style={sel} value={fixedCal} onChange={e=>setFixedCal(e.target.value)}>{CALENDARS.map(c=><option key={c} value={c}>{c}</option>)}</select></Fld>
            </Row>
            <SectionHdr>
              FLOATING LEG
              <Badge label={floatDir==='RECEIVE'?'← RECEIVE FLOAT':'→ PAY FLOAT'} color={floatDir==='RECEIVE'?'var(--accent)':'var(--red)'}/>
            </SectionHdr>
            <Row>
              <Fld label='INDEX' flex={1.8}><select style={{...sel,fontSize:'0.62rem',fontWeight:600}} value={index} onChange={e=>handleIndexChange(e.target.value)}>{(CCY_INDICES[ccy]||[]).map(idx=><option key={idx} value={idx}>{idx}</option>)}</select></Fld>
              <Fld label='SPREAD (bp)' flex={0.9}><input ref={spreadRef} style={inp} type='text' defaultValue='0' placeholder='0' autoComplete='off'/></Fld>
              <Fld label='LEVERAGE' flex={0.9}><input ref={leverageRef} style={inp} type='text' defaultValue='1.0' placeholder='1.0' autoComplete='off'/></Fld>
              <Fld label='RESET FREQ' flex={1.4}><select style={sel} value={floatResetFreq} onChange={e=>setFloatResetFreq(e.target.value)}>{RESET_FREQS.map(f=><option key={f} value={f}>{f}</option>)}</select></Fld>
              <Fld label='PAY FREQ' flex={1.4}><select style={sel} value={floatPayFreq} onChange={e=>setFloatPayFreq(e.target.value)}>{PAY_FREQS.map(f=><option key={f} value={f}>{f}</option>)}</select></Fld>
              <Fld label='DAY COUNT' flex={1.3}><select style={sel} value={floatDc} onChange={e=>setFloatDc(e.target.value)}>{DAY_COUNTS.map(d=><option key={d} value={d}>{d}</option>)}</select></Fld>
              <Fld label='BDC' flex={1.6}><select style={sel} value={floatBdc} onChange={e=>setFloatBdc(e.target.value)}>{BDCS.map(b=><option key={b} value={b}>{b}</option>)}</select></Fld>
              <Fld label='CALENDAR' flex={1.8}><select style={sel} value={floatCal} onChange={e=>setFloatCal(e.target.value)}>{CALENDARS.map(c=><option key={c} value={c}>{c}</option>)}</select></Fld>
            </Row>
            <SectionHdr>
              ANALYTICS
              {viewTrade && (
                <span style={{
                  fontSize:'0.38rem',fontWeight:700,padding:'2px 6px',borderRadius:'2px',
                  background:'rgba(240,160,32,0.08)',border:'1px solid rgba(240,160,32,0.3)',
                  color:'var(--amber)',letterSpacing:'0.08em',
                }}>{viewTrade.status || 'PENDING'}</span>
              )}
              {analytics && analytics.valuation_date && (
                <span style={{fontWeight:400,opacity:0.6,fontSize:'0.40rem'}}>
                  {CCY_CURVE[ccy]||'USD_SOFR'} · {analytics.curve_mode} · {analytics.valuation_date}
                </span>
              )}
              <div style={{display:'flex',alignItems:'center',gap:'5px',marginLeft:'auto'}}>
                <span style={{fontSize:'0.38rem',color:'var(--text-dim)',letterSpacing:'0.08em',whiteSpace:'nowrap'}}>VAL DATE</span>
                <input type='date' value={valDate} onChange={e=>setValDate(e.target.value)}
                  style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',
                    color:'var(--text)',fontFamily:'var(--mono)',fontSize:'0.48rem',
                    padding:'2px 5px',outline:'none'}}/>
              </div>
              <button onClick={handlePrice} disabled={pricing||booking} style={{
                fontSize:'0.44rem',fontWeight:700,letterSpacing:'0.08em',
                padding:'3px 10px',borderRadius:'2px',cursor:pricing?'default':'pointer',
                fontFamily:'var(--mono)',background:'transparent',
                border:'1px solid '+(pricing?'var(--border)':'var(--accent)'),
                color:pricing?'var(--text-dim)':'var(--accent)',opacity:pricing?0.5:1,
              }}>{pricing?'PRICING...':'▶ PRICE'}</button>
            </SectionHdr>
            {analyticsErr&&!pricing&&(
              <div style={{fontSize:'0.46rem',color:'var(--amber)',fontFamily:'var(--mono)',marginBottom:'4px'}}>\u26a0 {analyticsErr}</div>
            )}
            {!analytics&&!pricing&&!analyticsErr&&(
              <div style={{fontSize:'0.46rem',color:'var(--text-dim)',fontFamily:'var(--mono)',padding:'4px 0 8px'}}>
                Click ▶ PRICE for pre-trade analytics, or BOOK TRADE to book and price simultaneously.
              </div>
            )}
            {pricing&&(
              <div style={{display:'flex',alignItems:'center',gap:'8px',color:'var(--text-dim)',fontSize:'0.46rem',marginBottom:'8px'}}>
                <div style={{width:'12px',height:'12px',border:'2px solid var(--border)',borderTop:'2px solid var(--accent)',borderRadius:'50%',animation:'spin 0.8s linear infinite',flexShrink:0}}/>
                Running analytics...
                <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
              </div>
            )}
            {analytics&&(<>
              <div style={{border:'1px solid var(--border)',borderRadius:'2px',overflow:'hidden',marginBottom:'12px'}}>
                <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
                  <colgroup>
                    <col style={{width:'11%'}}/><col style={{width:'8%'}}/><col style={{width:'8%'}}/>
                    <col style={{width:'6%'}}/><col style={{width:'16%'}}/><col style={{width:'12%'}}/>
                    <col style={{width:'12%'}}/><col style={{width:'12%'}}/><col style={{width:'15%'}}/>
                  </colgroup>
                  <thead>
                    <tr style={{borderBottom:'1px solid var(--border)',background:'var(--bg)'}}>
                      {['LEG','TYPE','DIR','CCY','PV','IR01','IR01 DISC','GAMMA','THETA'].map(h=>{
                        const hasTip = !!GREEK_TIPS[h]
                        return (
                          <th key={h}
                            onMouseEnter={hasTip ? (e)=>{
                              const r = e.currentTarget.getBoundingClientRect()
                              setTooltip({text:GREEK_TIPS[h], x:r.left+r.width/2, y:r.top-8})
                            } : undefined}
                            onMouseLeave={hasTip ? ()=>setTooltip(null) : undefined}
                            style={{fontSize:'0.40rem',padding:'5px 8px',
                              textAlign:['PV','IR01','IR01 DISC','GAMMA','THETA'].includes(h)?'right':'left',
                              fontWeight:400,letterSpacing:'0.08em',
                              color: hasTip ? 'var(--accent)' : 'var(--text-dim)',
                              borderBottom: hasTip ? '1px dashed rgba(13,212,168,0.4)' : 'none',
                              cursor: hasTip ? 'help' : 'default',
                            }}>{h}</th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{borderBottom:'2px solid var(--border)',background:'rgba(255,255,255,0.02)'}}>
                      <td style={{fontSize:'0.44rem',fontWeight:700,color:'var(--text-dim)',padding:'7px 8px',letterSpacing:'0.08em'}}>NET</td>
                      <td/><td/><td/>
                      <td style={{fontSize:'0.58rem',fontWeight:700,padding:'7px 8px',textAlign:'right',fontFamily:'var(--mono)',color:npv==null?'var(--text-dim)':npv>=0?'var(--accent)':'var(--red)'}}>{fmtPnl(npv)}</td>
                      <td style={{fontSize:'0.58rem',fontWeight:700,padding:'7px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--blue)'}}>{fmtPnl(ir01)}</td>
                      <td style={{fontSize:'0.58rem',fontWeight:700,padding:'7px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--blue)'}}>{fmtPnl(ir01d)}</td>
                      <td style={{fontSize:'0.52rem',fontWeight:700,padding:'7px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--blue)',opacity:0.7}}>{gamma!=null?(gamma>=0?'+':'')+gamma.toFixed(4):'—'}</td>
                      <td style={{fontSize:'0.58rem',fontWeight:700,padding:'7px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--amber)'}}>{fmtPnl(theta)}</td>
                    </tr>
                    {legs.map((leg,i)=>(
                      <tr key={i} style={{borderBottom:'1px solid var(--panel-2)'}}>
                        <td style={{fontSize:'0.46rem',color:'var(--text-dim)',padding:'6px 8px',fontFamily:'var(--mono)'}}>{leg.leg_ref||(i+1)}</td>
                        <td style={{fontSize:'0.46rem',padding:'6px 8px',color:leg.leg_type==='FIXED'?'var(--blue)':'var(--accent)'}}>{leg.leg_type}</td>
                        <td style={{fontSize:'0.46rem',padding:'6px 8px',color:leg.direction==='PAY'?'var(--red)':'var(--accent)'}}>{leg.direction}</td>
                        <td style={{fontSize:'0.46rem',padding:'6px 8px',color:'var(--text-dim)'}}>{leg.currency}</td>
                        <td style={{fontSize:'0.50rem',padding:'6px 8px',textAlign:'right',fontFamily:'var(--mono)',fontWeight:600,color:leg.pv==null?'var(--text-dim)':leg.pv>=0?'var(--accent)':'var(--red)'}}>{fmtPnl(leg.pv)}</td>
                        <td style={{fontSize:'0.50rem',padding:'6px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--blue)'}}>{fmtPnl(leg.ir01)}</td>
                        <td style={{fontSize:'0.50rem',padding:'6px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--blue)'}}>{fmtPnl(leg.ir01_disc)}</td>
                        <td style={{fontSize:'0.50rem',padding:'6px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text-dim)'}}>{leg.gamma!=null?(leg.gamma>=0?'+':'')+leg.gamma.toFixed(4):'—'}</td>
                        <td style={{fontSize:'0.50rem',padding:'6px 8px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text-dim)'}}>—</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Off-market banner */}
              {analytics && rateMode==='FIXED' && parRate != null && rateRef.current && (() => {
                const bookedR = parseFloat(rateRef.current.value)
                const offBps  = ((bookedR - parRate) * 100).toFixed(1)
                if (isNaN(bookedR)) return null
                const isOff = Math.abs(bookedR - parRate) > 0.00005
                return (
                  <div style={{
                    display:'flex',alignItems:'center',gap:'12px',
                    padding:'6px 10px',marginBottom:'6px',
                    background:'rgba(240,160,32,0.06)',
                    border:'1px solid rgba(240,160,32,0.25)',
                    borderRadius:'2px',fontFamily:'var(--mono)',fontSize:'0.42rem',
                  }}>
                    <span style={{color:'var(--text-dim)'}}>PAR</span>
                    <span style={{color:'var(--accent)',fontWeight:700}}>{parRate.toFixed(4)}%</span>
                    <span style={{color:'var(--text-dim)'}}>YOU</span>
                    <span style={{color:'var(--amber)',fontWeight:700}}>{bookedR.toFixed(4)}%</span>
                    {isOff && <>
                      <span style={{color:'var(--text-dim)'}}>SPREAD</span>
                      <span style={{color:parseFloat(offBps)>=0?'var(--red)':'var(--accent)',fontWeight:700}}>
                        {parseFloat(offBps)>=0?'+':''}{offBps}bp
                      </span>
                    </>}
                    {npv != null && isOff && <>
                      <span style={{color:'var(--text-dim)'}}>NPV</span>
                      <span style={{fontWeight:700,color:npv>=0?'var(--accent)':'var(--red)'}}>
                        {npv>=0?'+':''}{Math.round(npv).toLocaleString('en-US')}
                      </span>
                    </>}
                    <span style={{marginLeft:'auto',color:'var(--text-dim)',opacity:0.6,fontSize:'0.38rem'}}>OFF-MARKET</span>
                  </div>
                )
              })()}

              {/* NPV → Rate solver */}
              <div style={{
                display:'flex',alignItems:'center',gap:'8px',
                padding:'6px 10px',marginBottom:'8px',
                background:'var(--bg)',border:'1px solid var(--border)',borderRadius:'2px',
              }}>
                <span style={{fontSize:'0.40rem',color:'var(--text-dim)',fontFamily:'var(--mono)',letterSpacing:'0.08em',whiteSpace:'nowrap'}}>SOLVE RATE AT NPV</span>
                <input
                  type='text' value={targetNpv}
                  onChange={e=>setTargetNpv(e.target.value)}
                  placeholder='e.g. 50000'
                  style={{...inp,fontSize:'0.52rem',fontWeight:600,flex:1,
                    color:'var(--blue)',borderColor:'rgba(74,154,212,0.3)'}}
                />
                <button
                  disabled={solvingNpv||!analytics}
                  onClick={async ()=>{
                    const target = parseFloat(String(targetNpv).replace(/,/g,''))
                    if (isNaN(target)||!analytics||!analytics.ir01) return
                    setSolvingNpv(true)
                    try {
                      const currentNpv  = analytics.npv || 0
                      const deltaNpv    = target - currentNpv
                      const ir01PerUnit = analytics.ir01 / 0.0001
                      const deltaRate   = -deltaNpv / ir01PerUnit
                      const currentRate = parseFloat(rateRef.current ? rateRef.current.value : '0')
                      const newRate     = currentRate + deltaRate * 100
                      if (rateRef.current) {
                        rateRef.current.value = Math.max(0, newRate).toFixed(8)
                        rateRef.current.dataset.userEdited = '1'
                      }
                      setRateMode('FIXED')
                      setTargetNpv('')
                      setErr(''); setAnalyticsErr(null); setPricing(true); setAnalytics(null)
                      const r = await executeBooking(false)
                      if (r) setAnalytics(r.priceData)
                    } catch(e) { setAnalyticsErr(e.message) }
                    finally { setSolvingNpv(false); setPricing(false) }
                  }}
                  style={{
                    padding:'4px 10px',borderRadius:'2px',cursor:'pointer',
                    fontFamily:'var(--mono)',fontSize:'0.42rem',fontWeight:700,
                    letterSpacing:'0.06em',whiteSpace:'nowrap',
                    border:'1px solid rgba(74,154,212,0.5)',
                    background:'rgba(74,154,212,0.08)',
                    color:'var(--blue)',
                    opacity:solvingNpv||!analytics?0.4:1,
                  }}
                >{solvingNpv?'SOLVING...':'→ SOLVE'}</button>
                <button
                  onClick={()=>{
                    setRateMode('PAR')
                    if (rateRef.current) { rateRef.current.dataset.userEdited=''; rateRef.current.value='' }
                    const tenorY = (new Date(matDate) - new Date(effDate)) / (365.25 * 24 * 3600 * 1000)
                    const curveId = CCY_CURVE[ccy] || 'USD_SOFR'
                    const rate = getParRateFromStore(curves, curveId, tenorY)
                    if (rate && rateRef.current) { rateRef.current.value = rate; setParRate(parseFloat(rate)) }
                    setAnalytics(null); setTargetNpv('')
                  }}
                  style={{
                    padding:'4px 8px',borderRadius:'2px',cursor:'pointer',
                    fontFamily:'var(--mono)',fontSize:'0.40rem',fontWeight:700,
                    letterSpacing:'0.06em',whiteSpace:'nowrap',
                    border:'1px solid rgba(13,212,168,0.4)',
                    background:'rgba(13,212,168,0.06)',
                    color:'var(--accent)',
                  }}
                >◉ RESET TO PAR</button>
              </div>

            </>)}
          </div>
        )}
        {/* Floating tooltip portal */}
        {tooltip && (
          <div style={{
            position:'fixed',
            left: tooltip.x,
            top: tooltip.y,
            transform:'translate(-50%, -100%)',
            background:'var(--panel)',
            border:'1px solid var(--accent)',
            borderRadius:'2px',
            padding:'7px 10px',
            maxWidth:'280px',
            fontSize:'0.44rem',
            fontFamily:'var(--mono)',
            color:'var(--text)',
            lineHeight:1.6,
            zIndex:9999,
            pointerEvents:'none',
            boxShadow:'0 4px 20px rgba(0,0,0,0.6)',
          }}>
            <div style={{color:'var(--accent)',fontWeight:700,marginBottom:'3px',letterSpacing:'0.08em'}}>{Object.keys(GREEK_TIPS).find(k=>GREEK_TIPS[k]===tooltip.text)}</div>
            {tooltip.text}
            <div style={{
              position:'absolute',bottom:'-5px',left:'50%',transform:'translateX(-50%)',
              width:0,height:0,
              borderLeft:'5px solid transparent',borderRight:'5px solid transparent',
              borderTop:'5px solid var(--accent)',
            }}/>
          </div>
        )}
        {activeTab==='main'&&!bookedTrade&&(
          <div className='tbw-footer tbw-no-drag'>
            {err&&<div className='tbw-error'>{err}</div>}
            <div className='tbw-footer-btns'>
              {viewTrade ? (
                <>
                  <button className='tbw-btn-cancel' onClick={onClose}>CLOSE</button>
                  <button
                    className='tbw-btn-book'
                    style={{background: viewTrade.status==='PENDING' ? 'var(--accent)' : 'var(--text-dim)',
                            cursor: viewTrade.status==='PENDING' ? 'pointer' : 'not-allowed',
                            color: 'var(--bg-deep)'}}
                    disabled={viewTrade.status !== 'PENDING' || booking}
                    onClick={async () => {
                      if (viewTrade.status !== 'PENDING') return
                      setBooking(true)
                      try {
                        const session = await getSession()
                        const h = { Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' }
                        await fetch(API+'/api/trades/'+viewTrade.id, {
                          method:'PATCH', headers:h,
                          body: JSON.stringify({ status: 'CONFIRMED' }),
                        })
                        setViewTrade({ ...viewTrade, status: 'CONFIRMED' })
                        await fetchTrades()
                      } catch(e) { setErr(e.message) }
                      finally { setBooking(false) }
                    }}
                  >
                    {booking ? 'CONFIRMING...' : viewTrade.status==='PENDING' ? '▶ CONFIRM TRADE' : viewTrade.status.toUpperCase()}
                  </button>
                </>
              ) : (
                <>
                  <button className='tbw-btn-cancel' onClick={onClose}>CANCEL</button>
                  <button className='tbw-btn-book' onClick={handleBook} disabled={booking||pricing}>
                    {booking?(bookingStep||'BOOKING...'):'▶ BOOK TRADE'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
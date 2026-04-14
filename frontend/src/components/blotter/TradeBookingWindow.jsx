import React, { useState, useRef, useEffect } from 'react'
import CurveDesignerWindow from './CurveDesignerWindow'
import LegDetailsTab from './LegDetailsTab'
import { useTradesStore } from '../../store/useTradesStore'
import useMarketDataStore from '../../store/useMarketDataStore'
import { supabase } from '../../lib/supabase'
import './TradeBookingWindow.css'
import XVATab from './XVATab'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

const ASSET_CLASSES = ['RATES','FX','CREDIT','EQUITY','COMMODITY']
const LIVE_AC       = ['RATES']
const INSTRUMENTS   = {
  RATES:     ['IR_SWAP','IR_SWAPTION','INTEREST_RATE_CAP','INTEREST_RATE_FLOOR','INTEREST_RATE_COLLAR'],
  FX:        ['FX_FORWARD','FX_SWAP','NDF'],
  CREDIT:    ['CDS','CDS_INDEX','TOTAL_RETURN_SWAP','ASSET_SWAP'],
  EQUITY:    ['EQUITY_SWAP','VARIANCE_SWAP','DIVIDEND_SWAP','EQUITY_FORWARD'],
  COMMODITY: ['COMMODITY_SWAP','COMMODITY_BASIS_SWAP','ASIAN_COMMODITY_SWAP'],
}
const LIVE_INST   = { RATES: ['IR_SWAP', 'IR_SWAPTION'] }
const IR_STRUCTS  = ['VANILLA','OIS','BASIS','XCCY','ZERO_COUPON','STEP_UP','INFLATION_ZC','CMS','CMS_SPREAD']
const LIVE_STRUCT = ['VANILLA','OIS','BASIS']
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
  color:'var(--text)', fontFamily:"'IBM Plex Mono',var(--mono)", fontSize:'0.875rem',
  padding:'5px 8px', outline:'none', width:'100%', boxSizing:'border-box',
}
const sel = { ...inp }
const lbl = { fontFamily:"'IBM Plex Sans',var(--sans)", fontSize:'0.75rem', fontWeight:500, color:'var(--text-dim)', letterSpacing:'0.07em', marginBottom:'3px' }
const Fld = ({label, flex=1, children}) => (
  <div style={{display:'flex',flexDirection:'column',flex}}>
    <div style={lbl}>{label}</div>
    {children}
  </div>
)
const Row = ({children, mt=0}) => <div style={{display:'flex',gap:'8px',marginTop:mt}}>{children}</div>
const SectionHdr = ({children, mt=10}) => (
  <div style={{fontFamily:"'IBM Plex Sans',var(--sans)",fontSize:'0.75rem',fontWeight:600,
    letterSpacing:'0.10em',color:'var(--text-dim)',
    marginTop:mt,marginBottom:6,display:'flex',alignItems:'center',gap:'8px',
    borderBottom:'1px solid var(--border)',paddingBottom:5}}>
    {children}
  </div>
)
const Badge = ({label, color}) => (
  <span style={{fontSize:'0.8125rem',fontWeight:700,letterSpacing:'0.08em',
    padding:'2px 7px',borderRadius:'2px',
    background:'color-mix(in srgb, '+color+' 12%, transparent)',
    border:'1px solid '+color,color}}>
    {label}
  </span>
)
const DirBtn = ({label, active, color, onClick}) => (
  <button onClick={onClick} style={{
    flex:1, padding:'5px 4px', fontSize:'0.8125rem', fontWeight:700,
    fontFamily:"'IBM Plex Sans',var(--sans)", letterSpacing:'0.04em',
    borderRadius:'2px', cursor:'pointer', whiteSpace:'nowrap',
    lineHeight:1.2, textAlign:'center',
    border: active ? '1px solid '+color : '1px solid var(--border)',
    background: active ? 'color-mix(in srgb, '+color+' 12%, transparent)' : 'transparent',
    color: active ? color : 'var(--text-dim)',
  }}>{label}</button>
)

// ── ScenarioTab: fully self-contained, all hooks at top level ────────────────
function ScenarioTab({ ccy, index, dir, struct, effDate, matDate, valDate, curves, analytics,
  notionalRef, rateRef, fixedPayFreq, fixedDc, fixedBdc, floatResetFreq, floatPayFreq, floatDc, floatBdc, getSession,
  inst, swaptionExpiry, swaptionTenor, swaptionVol, swaptionResult, curveId: curveIdProp }) {

  const TENORS  = ['1W','1M','3M','6M','1Y','2Y','3Y','4Y','5Y','7Y','10Y','15Y','20Y','30Y']
  const TENOR_Y = {'1W':0.02,'1M':0.083,'3M':0.25,'6M':0.5,'1Y':1,'2Y':2,'3Y':3,'4Y':4,'5Y':5,'7Y':7,'10Y':10,'15Y':15,'20Y':20,'30Y':30}
  const PRESETS = {
    flat0:TENORS.map(()=>0), up25:TENORS.map(()=>25), up50:TENORS.map(()=>50), up100:TENORS.map(()=>100),
    dn25:TENORS.map(()=>-25), dn50:TENORS.map(()=>-50), dn100:TENORS.map(()=>-100),
    bear_steep:TENORS.map(t=>TENOR_Y[t]<=2?50:100), bull_flat:TENORS.map(t=>TENOR_Y[t]<=2?-25:-75),
    bear_flat:TENORS.map(t=>TENOR_Y[t]<=2?100:50), bull_steep:TENORS.map(t=>TENOR_Y[t]<=2?-75:-25),
    hike25:TENORS.map(t=>TENOR_Y[t]<=1?25:TENOR_Y[t]<=3?10:0),
    cut25:TENORS.map(t=>TENOR_Y[t]<=1?-25:TENOR_Y[t]<=3?-10:0),
    hike_cycle:TENORS.map(t=>Math.max(0,Math.round(100-TENOR_Y[t]*3.5))),
  }
  const CAP=300, BPpx=0.4
  const curveId = CCY_CURVE[ccy]||'USD_SOFR'

  // Refs
  const canvasRef    = useRef(null)
  const shiftsRef    = useRef(TENORS.map(()=>0))
  const sigmaRef     = useRef(4)
  const dragRef      = useRef(null)
  const rafRef       = useRef(null)

  // State
  const [presetKey,    setPresetKey]    = useState('flat0')
  const [sigma,        setSigma]        = useState(4)
  const [confirmed,    setConfirmed]    = useState(true)
  const [dragTip,      setDragTip]      = useState(null)
  const [hoverInfo,    setHoverInfo]    = useState(null)
  const [baseOverrides,setBaseOverrides]= useState({})
  const [tick,         setTick]         = useState(0)
  const [scenarioBase, setScenarioBase] = useState(null)
  const [scenarioCalc, setScenarioCalc] = useState(null)
  const [scenarioPricing,setScenarioPricing]=useState(false)
  const [thetaApproxVisible,setThetaApproxVisible]=useState(false)


  // ── Vol scenario (swaption only) ─────────────────────────────────────────
  const IS_SWPN = inst === 'IR_SWAPTION'
  const EXPIRY_Y_MAP = {'3M':0.25,'6M':0.5,'1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'10Y':10}
  const TENOR_Y_MAP  = {'1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'9Y':9,'10Y':10,'15Y':15,'20Y':20,'30Y':30}

  const SABR_BASE = [
    {T:0.25,F:0.03595,alpha:0.0940,rho:-0.320,nu:1.350},
    {T:0.50,F:0.03610,alpha:0.0915,rho:-0.220,nu:1.050},
    {T:1.00,F:0.03650,alpha:0.0851,rho:-0.061,nu:0.675},
    {T:2.00,F:0.03562,alpha:0.0878,rho:-0.042,nu:0.510},
    {T:3.00,F:0.03600,alpha:0.0850,rho:-0.020,nu:0.410},
    {T:5.00,F:0.03672,alpha:0.0835,rho: 0.018,nu:0.315},
    {T:7.00,F:0.03900,alpha:0.0820,rho: 0.038,nu:0.255},
    {T:10.0,F:0.04050,alpha:0.0782,rho: 0.052,nu:0.200},
  ]
  const VOL_SCEN = {
    base:  {l:'BASE',           d:'Live calibrated surface',                   f:(p)=>({...p})},
    up15:  {l:'PARALLEL +15bp', d:'Surface-wide vol expansion',                f:(p)=>({...p,alpha:p.alpha+0.0015})},
    dn15:  {l:'PARALLEL −15bp', d:'Vol compression',                           f:(p)=>({...p,alpha:p.alpha-0.0015})},
    skew:  {l:'RECEIVER SKEW',  d:'ρ → −0.40 — rate/vol correlation spike',   f:(p)=>({...p,rho:Math.min(p.rho-0.25,-0.30)})},
    wing:  {l:'WING EXPANSION', d:'ν × 1.5 — smile curvature increase',       f:(p)=>({...p,nu:p.nu*1.5})},
    stress:{l:'STRESS +30bp',   d:'Full surface +30bp — 2020 analogue',        f:(p)=>({...p,alpha:p.alpha+0.0030})},
    flat:  {l:'TERM FLATTEN',   d:'Short vol up · long end anchored',          f:(p,i)=>({...p,alpha:p.alpha+0.0025*(1-i/7)})},
    custom:{l:'CUSTOM RESHAPE',  d:'Manually deformed via drag',                f:(p)=>({...p})},
  }

  function sabrVolCalc(F, K, T, alpha, rho, nu) {
    if (T <= 0) return alpha * 10000
    const x = K - F, c = 1 + ((2 - 3*rho*rho)/24)*nu*nu*T
    if (Math.abs(x) < 1e-8) return Math.max(alpha * c * 10000, 1)
    const z = (nu/alpha)*x
    const chi = Math.log((Math.sqrt(1-2*rho*z+z*z)+z-rho)/(1-rho))
    return Math.abs(chi) < 1e-10 ? Math.max(alpha*c*10000,1) : Math.max(alpha*(z/chi)*c*10000,1)
  }

  const [volScenKey, setVolScenKey] = useState('base')
  const [isVolThreeReady, setIsVolThreeReady] = useState(false)
  const [volMode, setVolMode] = useState('rotate')  // 'rotate' | 'reshape'
  const [activeVolP, setActiveVolP] = useState(SABR_BASE.map(p=>({...p})))
  const [jointResult, setJointResult] = useState(null)
  const [unsavedVol,  setUnsavedVol]  = useState(false) // {rateOnly, volOnly, joint, base}
  const smileCanvasRef = useRef(null)  // kept for compat but unused
  const volCanvasRef   = useRef(null)
  const volWrapRef     = useRef(null)
  const volThreeRef    = useRef(null)   // { renderer, scene, camera, meshes, sph, alive }
  const volSphRef      = useRef({ r:11, th:0.52, ph:0.50 })
  const volDragRef     = useRef(null)   // { ds, dsph }

  const getShockedVolBp = (volParams) => {
    if (!IS_SWPN) return parseFloat(swaptionVol) || 85
    const expY = EXPIRY_Y_MAP[swaptionExpiry] || 1
    const ei = volParams.reduce((best,p,i) => Math.abs(p.T-expY)<Math.abs(volParams[best].T-expY)?i:best, 0)
    const p = volParams[ei]
    const F = swaptionResult?.forward_rate || p.F
    return sabrVolCalc(F, F, expY, p.alpha, p.rho, p.nu)
  }

  const applyVolScen = (key) => {
    const newP = SABR_BASE.map((p,i) => VOL_SCEN[key].f(p,i))
    setVolScenKey(key)
    setActiveVolP(newP)
    setConfirmed(false)
    setJointResult(null)
  }

  // ── Three.js vol surface (3D) ────────────────────────────────────────────
  const SABR_STRIKES = []; for(let s=-200;s<=200;s+=20) SABR_STRIKES.push(s)
  const NS3 = SABR_STRIKES.length  // 21

  function sabrV(F,K,T,a,rho,nu){
    if(T<=0)return a*10000; const x=K-F,c=1+((2-3*rho*rho)/24)*nu*nu*T
    if(Math.abs(x)<1e-8)return Math.max(a*c*10000,1)
    const z=(nu/a)*x,chi=Math.log((Math.sqrt(1-2*rho*z+z*z)+z-rho)/(1-rho))
    return Math.abs(chi)<1e-10?Math.max(a*c*10000,1):Math.max(a*(z/chi)*c*10000,1)
  }
  function baseClr(sp){
    if(sp<-15)return[0.18,0.48,0.95]; if(sp<0){const t=(sp+15)/15;return[0.18*(1-t),0.48+t*0.35,0.95*(1-t)+0.66*t]}
    if(sp<6)return[0,0.83,0.66]; if(sp<20){const t=(sp-6)/14;return[t*0.96,0.83-t*0.09,0.66-t*0.40]}
    if(sp<45){const t=(sp-20)/25;return[0.96+t*0.04,0.74-t*0.32,0.26-t*0.10]}; return[1,0.42,0.42]
  }
  function shockClr(d){
    if(d>30)return[1,0.35,0.35]; if(d>12)return[0.96,0.62,0.20]; if(d>4)return[0.96,0.78,0.26]
    if(d>0)return[0.90,0.88,0.50]; if(d>-4)return[0,0.83,0.66]; if(d>-12)return[0.29,0.62,0.99]
    return[0.10,0.35,0.92]
  }

  function buildVolGeom(THREE, params, colorFn, rMinV, rMaxV){
    const verts=[],cols=[],idx=[],grid=[]
    for(let ei=0;ei<SABR_BASE.length;ei++){
      const row=[],{T,F,alpha,rho,nu}=params[ei]
      for(let si=0;si<NS3;si++) row.push(sabrV(F,F+SABR_STRIKES[si]/10000,T,alpha,rho,nu))
      grid.push(row)
    }
    const all=grid.flat()
    const minV=rMinV??Math.min(...all),maxV=rMaxV??Math.max(...all),range=maxV-minV||1
    const XS=8,ZS=6,YS=3.8
    for(let ei=0;ei<SABR_BASE.length;ei++)
      for(let si=0;si<NS3;si++){
        verts.push((si/(NS3-1)-0.5)*XS,((grid[ei][si]-minV)/range)*YS,(ei/(SABR_BASE.length-1)-0.5)*ZS)
        cols.push(...colorFn(grid[ei][si],grid[ei][10],ei,si))
      }
    for(let ei=0;ei<SABR_BASE.length-1;ei++)
      for(let si=0;si<NS3-1;si++){const a=ei*NS3+si,b=a+1,c=a+NS3,d=c+1;idx.push(a,b,c,b,d,c)}
    const geo=new THREE.BufferGeometry()
    geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3))
    geo.setAttribute('color',new THREE.Float32BufferAttribute(cols,3))
    geo.setIndex(idx); geo.computeVertexNormals()
    return{geo,grid,minV,maxV,range,YS}
  }

  function rebuildVolSurf(){
    const t=volThreeRef.current; if(!t||!t.THREE)return
    const{THREE,scene,meshes,alive}=t; if(!alive)return
    const isBase=volScenKey==='base'
    const bd=buildVolGeom(THREE,SABR_BASE,(vol,atm)=>baseClr(vol-atm),null,null)
    if(meshes.bm){scene.remove(meshes.bm);meshes.bm.geometry.dispose()}
    if(meshes.bw){scene.remove(meshes.bw);meshes.bw.geometry.dispose()}
    meshes.bm=new THREE.Mesh(bd.geo,new THREE.MeshLambertMaterial({vertexColors:true,transparent:true,opacity:isBase?0.88:0.25,side:THREE.DoubleSide}))
    scene.add(meshes.bm)
    meshes.bw=new THREE.Mesh(bd.geo.clone(),new THREE.MeshBasicMaterial({color:isBase?0x00D4A8:0x0D1A14,wireframe:true,transparent:true,opacity:isBase?0.09:0.03}))
    scene.add(meshes.bw)
    if(meshes.sm){scene.remove(meshes.sm);meshes.sm.geometry.dispose()}
    if(meshes.sw){scene.remove(meshes.sw);meshes.sw.geometry.dispose()}
    meshes.sm=null;meshes.sw=null
    if(!isBase){
      const sd=buildVolGeom(THREE,activeVolP,(vol,atm,ei,si)=>{
        const bv=sabrV(SABR_BASE[ei].F,SABR_BASE[ei].F+SABR_STRIKES[si]/10000,SABR_BASE[ei].T,SABR_BASE[ei].alpha,SABR_BASE[ei].rho,SABR_BASE[ei].nu)
        return shockClr(vol-bv)
      },bd.minV,bd.maxV)
      meshes.sm=new THREE.Mesh(sd.geo,new THREE.MeshLambertMaterial({vertexColors:true,transparent:true,opacity:0.88,side:THREE.DoubleSide}))
      scene.add(meshes.sm)
      meshes.sw=new THREE.Mesh(sd.geo.clone(),new THREE.MeshBasicMaterial({color:0xF5C842,wireframe:true,transparent:true,opacity:0.09}))
      scene.add(meshes.sw)
    }
    // Trade strike marker
    if(meshes.mk){scene.remove(meshes.mk)}
    const expY=EXPIRY_Y_MAP[swaptionExpiry]||1
    const tradeEi=SABR_BASE.reduce((b,p,i)=>Math.abs(p.T-expY)<Math.abs(SABR_BASE[b].T-expY)?i:b,0)
    const vol=bd.grid[tradeEi][10]
    const x=(10/(NS3-1)-0.5)*8, z=(tradeEi/(SABR_BASE.length-1)-0.5)*6, y=((vol-bd.minV)/bd.range)*bd.YS+0.2
    const mg=new THREE.SphereGeometry(0.18,8,8)
    meshes.mk=new THREE.Mesh(mg,new THREE.MeshBasicMaterial({color:0xF5C842}))
    meshes.mk.position.set(x,y,z)
    scene.add(meshes.mk)
    // Dots
    if(meshes.dm){scene.remove(meshes.dm);meshes.dm.geometry.dispose()}
    const dp=[],dc=[]
    bd.grid.forEach((row,ei)=>{[0,10,NS3-1].forEach(si=>{
      dp.push((si/(NS3-1)-0.5)*8,((row[si]-bd.minV)/bd.range)*bd.YS+0.1,(ei/(SABR_BASE.length-1)-0.5)*6)
      dc.push(...(si===10?[0,0.83,0.66]:[1,0.42,0.42]))
    })})
    const dg=new THREE.BufferGeometry()
    dg.setAttribute('position',new THREE.Float32BufferAttribute(dp,3))
    dg.setAttribute('color',new THREE.Float32BufferAttribute(dc,3))
    meshes.dm=new THREE.Points(dg,new THREE.PointsMaterial({vertexColors:true,size:4,sizeAttenuation:false,transparent:true,opacity:0.8}))
    scene.add(meshes.dm)
  }

  function volCamUpdate(){
    const t=volThreeRef.current; if(!t)return
    const{r,th,ph}=volSphRef.current
    t.camera.position.set(r*Math.sin(ph)*Math.sin(th),r*Math.cos(ph)+1.2,r*Math.sin(ph)*Math.cos(th))
    t.camera.lookAt(0,1.2,0)
  }

  useEffect(()=>{
    if(!IS_SWPN)return
    const load=()=>new Promise(res=>{
      if(window.THREE){res();return}
      const s=document.createElement('script')
      s.src='https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
      s.onload=res; document.head.appendChild(s)
    })
    load().then(()=>{
      const canvas=volCanvasRef.current,wrap=volWrapRef.current
      if(!canvas||!wrap)return
      const THREE=window.THREE
      const renderer=new THREE.WebGLRenderer({canvas,antialias:true})
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.setClearColor(0x0A0A0E)
      const scene=new THREE.Scene()
      const camera=new THREE.PerspectiveCamera(42,1,0.1,200)
      scene.add(new THREE.AmbientLight(0x203040,1.5))
      const dl=new THREE.DirectionalLight(0x00D4A8,0.5);dl.position.set(5,10,8);scene.add(dl)
      const dl2=new THREE.DirectionalLight(0x4A9EFF,0.25);dl2.position.set(-5,4,-4);scene.add(dl2)
      const gh=new THREE.GridHelper(12,12,0x181B24,0x101318);gh.position.y=-0.05;scene.add(gh)
      volThreeRef.current={THREE,renderer,scene,camera,meshes:{},alive:true}
      volCamUpdate()
      const resize=()=>{
        if(!wrap||!volThreeRef.current?.alive)return
        const W=wrap.clientWidth,H=wrap.clientHeight
        renderer.setSize(W,H); camera.aspect=W/H; camera.updateProjectionMatrix()
      }
      const ro=new ResizeObserver(resize); ro.observe(wrap)
      volThreeRef.current.ro=ro
      resize()
      rebuildVolSurf()
      setIsVolThreeReady(true)
      let alive=true
      const loop=()=>{if(!alive)return;requestAnimationFrame(loop);renderer.render(scene,camera)}
      loop()
      volThreeRef.current.stopLoop=()=>{alive=false}

      // Native mouse/wheel events — React synthetic events don't work reliably with Three.js
      const onDown=e=>{
        volDragRef.current={ds:{x:e.clientX,y:e.clientY},dsph:{...volSphRef.current}}
        canvas.style.cursor='grabbing'
      }
      const onMove=e=>{
        if(!volDragRef.current)return
        const{ds,dsph}=volDragRef.current
        volSphRef.current.th=dsph.th-(e.clientX-ds.x)*0.005
        volSphRef.current.ph=Math.max(0.08,Math.min(1.5,dsph.ph-(e.clientY-ds.y)*0.005))
        volCamUpdate()
      }
      const onUp=()=>{ volDragRef.current=null; canvas.style.cursor='grab' }
      const onWheel=e=>{
        volSphRef.current.r=Math.max(5,Math.min(22,volSphRef.current.r+e.deltaY*0.012))
        volCamUpdate(); e.preventDefault()
      }
    })
    return()=>{
      const t=volThreeRef.current; if(!t)return
      t.alive=false; t.stopLoop?.(); t.ro?.disconnect(); t.renderer?.dispose()
    }
  },[IS_SWPN])

  // Vol surface mouse controls — re-attaches when mode or ready state changes
  useEffect(()=>{
    if(!IS_SWPN || !isVolThreeReady) return
    const canvas=volCanvasRef.current
    if(!canvas) return

    // ROTATE mode
    const onDownRotate=e=>{
      volDragRef.current={ds:{x:e.clientX,y:e.clientY},dsph:{...volSphRef.current}}
      canvas.style.cursor='grabbing'
    }
    const onMoveRotate=e=>{
      if(!volDragRef.current) return
      const{ds,dsph}=volDragRef.current
      volSphRef.current.th=dsph.th-(e.clientX-ds.x)*0.005
      volSphRef.current.ph=Math.max(0.08,Math.min(1.55,dsph.ph-(e.clientY-ds.y)*0.005))
      volCamUpdate()
    }
    const onUpRotate=()=>{volDragRef.current=null; canvas.style.cursor='grab'}

    // RESHAPE mode — raycast to find exact mesh point, drag Y to shift vol
    const onDownReshape=e=>{
      const t=volThreeRef.current; if(!t?.alive) return
      const rect=canvas.getBoundingClientRect()
      const mx=((e.clientX-rect.left)/rect.width)*2-1
      const my=-((e.clientY-rect.top)/rect.height)*2+1
      const THREE=t.THREE
      const ray=new THREE.Raycaster()
      const mv2=new THREE.Vector2(mx,my)
      ray.setFromCamera(mv2,t.camera)
      const hits=ray.intersectObjects([t.meshes.sm||t.meshes.bm].filter(Boolean))
      if(!hits.length) return
      const pt=hits[0].point
      // Map Z coordinate back to expiry index (ZS=6, range -3 to +3)
      const ei=Math.max(0,Math.min(SABR_BASE.length-1,
        Math.round((pt.z/6+0.5)*(SABR_BASE.length-1))))
      volDragRef.current={ei, startY:e.clientY, startAlpha:activeVolP[ei].alpha}
      canvas.style.cursor='ns-resize'
    }
    const onMoveReshape=e=>{
      if(!volDragRef.current) return
      const{ei,startY,startAlpha}=volDragRef.current
      const dy=(startY-e.clientY)*0.00030
      const newP=activeVolP.map((p,i)=>i===ei?{...p,alpha:Math.max(0.025,startAlpha+dy)}:{...p})
      // Update ref immediately so next move uses latest value
      volDragRef.current.startAlpha=Math.max(0.025,startAlpha+dy)
      volDragRef.current.startY=e.clientY
      setActiveVolP(newP)
      // Live rebuild shocked mesh only (fast path)
      const t=volThreeRef.current; if(!t?.alive) return
      const{THREE,scene,meshes}=t
      const bd2=buildVolGeom(THREE,SABR_BASE,(vol,atm)=>baseClr(vol-atm),null,null)
      const sd2=buildVolGeom(THREE,newP,(vol,atm,ei2,si)=>{
        const bv=sabrV(SABR_BASE[ei2].F,SABR_BASE[ei2].F+SABR_STRIKES[si]/10000,
          SABR_BASE[ei2].T,SABR_BASE[ei2].alpha,SABR_BASE[ei2].rho,SABR_BASE[ei2].nu)
        return shockClr(vol-bv)
      },bd2.minV,bd2.maxV)
      if(meshes.sm){scene.remove(meshes.sm);meshes.sm.geometry.dispose()}
      meshes.sm=new THREE.Mesh(sd2.geo,new THREE.MeshLambertMaterial(
        {vertexColors:true,transparent:true,opacity:0.88,side:THREE.DoubleSide}))
      scene.add(meshes.sm)
      if(meshes.bm) meshes.bm.material.opacity=0.25
    }
    const onUpReshape=()=>{
      if(volDragRef.current){
        volDragRef.current=null
        canvas.style.cursor='crosshair'
        setVolScenKey('custom')
        setUnsavedVol(true)
      }
    }

    const onWheel=e=>{
      volSphRef.current.r=Math.max(5,Math.min(22,volSphRef.current.r+e.deltaY*0.012))
      volCamUpdate(); e.preventDefault()
    }

    const isReshape = volMode==='reshape'
    canvas.style.cursor = isReshape ? 'crosshair' : 'grab'

    const onDown = isReshape ? onDownReshape : onDownRotate
    const onMove = isReshape ? onMoveReshape : onMoveRotate
    const onUp   = isReshape ? onUpReshape   : onUpRotate

    canvas.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    canvas.addEventListener('wheel',     onWheel, {passive:false})
    return()=>{
      canvas.removeEventListener('mousedown', onDown)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
      canvas.removeEventListener('wheel',     onWheel)
    }
  },[IS_SWPN, isVolThreeReady, volMode, activeVolP])

  useEffect(()=>{
    if(IS_SWPN && volThreeRef.current?.alive) rebuildVolSurf()
  },[volScenKey, IS_SWPN])

  // ── End vol scenario state ────────────────────────────────────────────────

  const getBaseMarket = (t) => {
    const curve=curves.find(c=>c.id===curveId)
    if(curve&&curve.instruments){const inst=curve.instruments.find(i=>i.tenor===t);if(inst&&inst.quote!=null)return parseFloat(inst.quote)}
    if(analytics&&analytics.curve_pillars&&analytics.curve_pillars[curveId]){
      const pillars=analytics.curve_pillars[curveId],ty=TENOR_Y[t]
      const near=pillars.reduce((a,b)=>Math.abs(b.t-ty)<Math.abs(a.t-ty)?b:a,pillars[0])
      if(near)return near.zero_rate
    }
    return 3.665
  }
  const getBase = (t) => baseOverrides[t]!=null ? parseFloat(baseOverrides[t]) : getBaseMarket(t)

  // ── Canvas draw ──────────────────────────────────────────────
  const draw = () => {
    const canvas=canvasRef.current; if(!canvas)return
    const ctx=canvas.getContext('2d')
    const dpr=window.devicePixelRatio||2
    const W=canvas.width/dpr, H=canvas.height/dpr
    const PAD={l:14,r:14,t:32,b:36},CW=W-PAD.l-PAD.r,CH=H-PAD.t-PAD.b
    const sh=shiftsRef.current
    const baseRts=TENORS.map(t=>getBase(t))
    const shockRts=TENORS.map((t,i)=>getBase(t)+Math.max(-CAP,Math.min(CAP,sh[i]))/100)
    const midR=baseRts.reduce((a,b)=>a+b,0)/baseRts.length
    const visHalf=Math.max(0.65,Math.max(...sh.map(Math.abs))/100+0.25)
    const minR=midR-visHalf, maxR=midR+visHalf
    const xS=t=>PAD.l+Math.sqrt(t/30)*CW
    const yS=r=>PAD.t+CH-(r-minR)/(maxR-minR)*CH

    ctx.fillStyle='#0C0C0C'; ctx.fillRect(0,0,W,H)

    // Grid
    const gStep=visHalf>0.5?0.25:0.1
    ctx.font='9px DM Mono,JetBrains Mono,monospace'
    for(let r=Math.ceil(minR/gStep)*gStep;r<=maxR+0.001;r=Math.round((r+gStep)*10000)/10000){
      const y=yS(r); if(y<PAD.t-2||y>H-PAD.b+2)continue
      ctx.strokeStyle='rgba(40,40,40,0.8)'; ctx.lineWidth=0.5
      ctx.beginPath(); ctx.moveTo(PAD.l,y); ctx.lineTo(W-PAD.r,y); ctx.stroke()
    }
    // X axis + labels
    ctx.strokeStyle='rgba(40,40,40,0.6)'; ctx.lineWidth=0.5
    ctx.beginPath(); ctx.moveTo(PAD.l,H-PAD.b); ctx.lineTo(W-PAD.r,H-PAD.b); ctx.stroke()
    ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillStyle='#666666'
    ;['1M','6M','1Y','2Y','5Y','10Y','20Y','30Y'].forEach(t=>{
      const x=xS(TENOR_Y[t]); ctx.fillText(t,x,H-PAD.b+6)
      ctx.strokeStyle='rgba(40,40,40,0.4)'; ctx.lineWidth=0.4
      ctx.beginPath(); ctx.moveTo(x,PAD.t); ctx.lineTo(x,H-PAD.b); ctx.stroke()
    })

    const avgSh=sh.reduce((a,b)=>a+b,0)/sh.length
    const shClr=avgSh<=0?'#4A9EFF':'#FF6B6B'
    const shClrRgb=avgSh<=0?'74,158,255':'255,107,107'
    const anyShift=sh.some(s=>Math.abs(s)>0.05)

    // Base fill + glow + line
    ctx.beginPath()
    TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(baseRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
    ctx.lineTo(xS(TENOR_Y[TENORS[TENORS.length-1]]),H-PAD.b); ctx.lineTo(xS(TENOR_Y[TENORS[0]]),H-PAD.b); ctx.closePath()
    const gBase=ctx.createLinearGradient(0,PAD.t,0,H-PAD.b)
    gBase.addColorStop(0,'rgba(0,212,168,0.12)'); gBase.addColorStop(1,'rgba(0,212,168,0)')
    ctx.fillStyle=gBase; ctx.fill()
    ctx.setLineDash([]); ctx.lineJoin='round'; ctx.lineCap='round'
    ctx.beginPath()
    TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(baseRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
    ctx.strokeStyle='rgba(0,212,168,0.15)'; ctx.lineWidth=7; ctx.stroke()
    ctx.beginPath()
    TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(baseRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
    ctx.strokeStyle='#00D4A8'; ctx.lineWidth=2; ctx.stroke()
    TENORS.forEach((t,i)=>{
      const cx=xS(TENOR_Y[t]),cy=yS(baseRts[i])
      ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.strokeStyle='rgba(0,212,168,0.25)'; ctx.lineWidth=3; ctx.stroke()
      ctx.beginPath(); ctx.arc(cx,cy,3,0,Math.PI*2); ctx.fillStyle='#00D4A8'; ctx.fill()
    })

    // Shocked curve
    if(anyShift){
      ctx.beginPath()
      TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(baseRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
      ;[...TENORS].reverse().forEach(t=>{const i=TENORS.indexOf(t);ctx.lineTo(xS(TENOR_Y[t]),yS(shockRts[i]))})
      ctx.closePath(); ctx.fillStyle=avgSh>0?'rgba(255,107,107,0.06)':'rgba(74,158,255,0.06)'; ctx.fill()
      ctx.setLineDash([5,3])
      ctx.beginPath()
      TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(shockRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
      ctx.strokeStyle=`rgba(${shClrRgb},0.2)`; ctx.lineWidth=7; ctx.stroke()
      ctx.beginPath()
      TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(shockRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
      ctx.strokeStyle=shClr; ctx.lineWidth=2; ctx.stroke(); ctx.setLineDash([])
      TENORS.forEach((t,i)=>{
        const cx=xS(TENOR_Y[t]),cy=yS(shockRts[i]),cyB=yS(baseRts[i])
        const bp=Math.round(sh[i]),isActive=dragRef.current?.idx===i
        if(Math.abs(bp)>0.5){ctx.strokeStyle=`rgba(${shClrRgb},0.2)`;ctx.lineWidth=0.8;ctx.setLineDash([2,2]);ctx.beginPath();ctx.moveTo(cx,cyB);ctx.lineTo(cx,cy);ctx.stroke();ctx.setLineDash([])}
        if(isActive){ctx.shadowColor=shClr;ctx.shadowBlur=14;ctx.beginPath();ctx.arc(cx,cy,5.5,0,Math.PI*2);ctx.fillStyle=shClr;ctx.fill();ctx.shadowBlur=0;ctx.beginPath();ctx.arc(cx,cy,5.5,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,0.7)';ctx.lineWidth=1;ctx.stroke()}
        else{ctx.beginPath();ctx.arc(cx,cy,4.5,0,Math.PI*2);ctx.strokeStyle=`rgba(${shClrRgb},0.3)`;ctx.lineWidth=3;ctx.stroke();ctx.beginPath();ctx.arc(cx,cy,3,0,Math.PI*2);ctx.fillStyle=shClr;ctx.fill()}
      })
    }

    // Legend
    ctx.font='9px DM Mono,JetBrains Mono,monospace'; ctx.textBaseline='middle'; ctx.setLineDash([])
    ctx.strokeStyle='#00D4A8'; ctx.lineWidth=2
    ctx.beginPath(); ctx.moveTo(PAD.l,PAD.t-14); ctx.lineTo(PAD.l+20,PAD.t-14); ctx.stroke()
    ctx.fillStyle='#00D4A8'; ctx.textAlign='left'; ctx.fillText('BASE',PAD.l+24,PAD.t-14)
    if(anyShift){
      ctx.setLineDash([4,2]); ctx.strokeStyle=shClr
      ctx.beginPath(); ctx.moveTo(PAD.l+66,PAD.t-14); ctx.lineTo(PAD.l+86,PAD.t-14); ctx.stroke(); ctx.setLineDash([])
      ctx.fillStyle=shClr; ctx.fillText('SHOCKED',PAD.l+90,PAD.t-14)
      const avgBp=Math.round(avgSh)
      ctx.fillStyle=avgBp>0?'#FF6B6B':'#4A9EFF'; ctx.textAlign='right'
      ctx.fillText((avgBp>0?'+':'')+avgBp+'bp AVG',W-PAD.r,PAD.t-14)
    }
  }

  const scheduleDraw=()=>{if(rafRef.current)cancelAnimationFrame(rafRef.current);rafRef.current=requestAnimationFrame(draw)}

  const sizeCanvas=()=>{
    const c=canvasRef.current; if(!c)return
    const p=c.parentElement; const dpr=window.devicePixelRatio||2
    c.width=p.offsetWidth*dpr; c.height=p.offsetHeight*dpr
    c.style.width=p.offsetWidth+'px'; c.style.height=p.offsetHeight+'px'
    const ctx=c.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr,dpr)
    scheduleDraw()
  }

  useEffect(()=>{sizeCanvas()},[tick])
  useEffect(()=>{const t=setTimeout(sizeCanvas,60);return()=>clearTimeout(t)},[])

  // Canvas events
  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas)return
    const getHit=(mx,my)=>{
      const rect=canvas.getBoundingClientRect(),W=rect.width,H=rect.height
      const PAD={l:14,r:14,t:32,b:36},CW=W-PAD.l-PAD.r,CH=H-PAD.t-PAD.b
      const sh=shiftsRef.current
      const baseRts=TENORS.map(t=>getBase(t)),shockRts=TENORS.map((t,i)=>getBase(t)+Math.max(-CAP,Math.min(CAP,sh[i]))/100)
      const midR=baseRts.reduce((a,b)=>a+b,0)/baseRts.length
      const visHalf=Math.max(0.65,Math.max(...sh.map(Math.abs))/100+0.25)
      const minR=midR-visHalf,maxR=midR+visHalf
      const xS=t=>PAD.l+Math.sqrt(t/30)*CW,yS=r=>PAD.t+CH-(r-minR)/(maxR-minR)*CH
      let bi=-1,bd=9999
      TENORS.forEach((t,i)=>{const d=Math.hypot(mx-xS(TENOR_Y[t]),my-yS(shockRts[i]));if(d<bd){bd=d;bi=i}})
      return bd<30?bi:-1
    }
    const onDown=e=>{const r=canvas.getBoundingClientRect();const idx=getHit(e.clientX-r.left,e.clientY-r.top);if(idx>=0){e.preventDefault();dragRef.current={idx,startY:e.clientY,origShifts:[...shiftsRef.current]};scheduleDraw()}}
    const onMove=e=>{
      const r=canvas.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top
      if(dragRef.current){
        const{idx,startY,origShifts}=dragRef.current
        const dy=startY-e.clientY,bpDelta=dy*BPpx,sig=sigmaRef.current,dty=TENOR_Y[TENORS[idx]]
        shiftsRef.current=origShifts.map((s,i)=>{const dist=TENOR_Y[TENORS[i]]-dty;return Math.max(-CAP,Math.min(CAP,Math.round((s+bpDelta*Math.exp(-(dist*dist)/(2*sig*sig)))*10)/10))})
        const bp=Math.round(shiftsRef.current[idx])
        setDragTip({x:mx+14,y:my-32,bp,tenor:TENORS[idx]});scheduleDraw();setTick(t=>t+1);return
      }
      const hIdx=getHit(mx,my)
      canvas.style.cursor=hIdx>=0?'ns-resize':'crosshair'
      if(hIdx>=0){const t=TENORS[hIdx],base=getBase(t),bp=Math.round(shiftsRef.current[hIdx]);setHoverInfo({x:mx,y:my,tenor:t,base,shocked:base+bp/100,bp})}
      else setHoverInfo(null)
    }
    const onUp=()=>{if(dragRef.current){dragRef.current=null;setDragTip(null);setHoverInfo(null);setConfirmed(false);setTick(t=>t+1);scheduleDraw()}}
    const onLeave=()=>setHoverInfo(null)
    canvas.addEventListener('mousedown',onDown);canvas.addEventListener('mousemove',onMove);canvas.addEventListener('mouseleave',onLeave);window.addEventListener('mouseup',onUp)
    return()=>{canvas.removeEventListener('mousedown',onDown);canvas.removeEventListener('mousemove',onMove);canvas.removeEventListener('mouseleave',onLeave);window.removeEventListener('mouseup',onUp)}
  },[])

  // Run scenario
  const handleRunScenario=async(overrides)=>{
    if(!effDate||!matDate)return
    setScenarioPricing(true);setScenarioBase(null);setScenarioCalc(null)
    try{
      const session=await getSession(),h={Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'}
      const notional=parseFloat(notionalRef.current?notionalRef.current.value.replace(/,/g,''):'10000000')
      const rateVal=parseFloat(rateRef.current?rateRef.current.value:'0')
      const payLag=INDEX_PAY_LAG[index]!=null?INDEX_PAY_LAG[index]:2
      const forecastId=INDEX_CURVE[index]||curveId,isOIS=struct==='OIS'
      const legs=[
        {leg_ref:'FIXED-1',leg_seq:1,leg_type:'FIXED',direction:dir,currency:ccy,notional,effective_date:effDate,maturity_date:matDate,day_count:fixedDc,payment_frequency:fixedPayFreq,bdc:fixedBdc,payment_lag:payLag,fixed_rate:isNaN(rateVal)?0:rateVal/100,discount_curve_id:curveId,forecast_curve_id:null},
        {leg_ref:'FLOAT-1',leg_seq:2,leg_type:'FLOAT',direction:dir==='PAY'?'RECEIVE':'PAY',currency:ccy,notional,effective_date:effDate,maturity_date:matDate,day_count:floatDc,payment_frequency:floatPayFreq,reset_frequency:isOIS?'DAILY':floatResetFreq,bdc:floatBdc,payment_lag:payLag,fixed_rate:0,spread:0,leverage:1.0,discount_curve_id:curveId,forecast_curve_id:forecastId,ois_compounding:isOIS?'COMPOUNDING':null},
      ]
      const curveStore=curves.find(c=>c.id===curveId),onInst=curveStore?.instruments?.find(i=>i.tenor==='ON')
      const onRate=onInst?.quote?parseFloat(onInst.quote)/100:0.0365
      const shockedQuotes=[{tenor:'ON',quote_type:'DEPOSIT',rate:onRate}]
      TENORS.forEach((t,i)=>{const base=getBase(t);const fr=overrides&&overrides[t]!=null?parseFloat(overrides[t]):base+shiftsRef.current[i]/100;shockedQuotes.push({tenor:t,quote_type:'OIS_SWAP',rate:fr/100})})
      const [bR,sR]=await Promise.all([
        fetch(API+'/price/preview',{method:'POST',headers:h,body:JSON.stringify({legs,valuation_date:valDate,curves:[curveObj(curveId)]})}),
        fetch(API+'/price/preview',{method:'POST',headers:h,body:JSON.stringify({legs,valuation_date:valDate,curves:[curveObj(curveId, shockedQuotes)]})}),
      ])
      if(bR.ok)setScenarioBase(await bR.json())
      if(sR.ok)setScenarioCalc(await sR.json())

      // ── Swaption joint repricing ────────────────────────────────────────────
      if (IS_SWPN && swaptionResult) {
        try {
          const expY  = EXPIRY_Y_MAP[swaptionExpiry] || 1
          const tenY  = TENOR_Y_MAP[swaptionTenor]   || 5
          const baseVol   = parseFloat(swaptionVol) || 85
          const shockVol  = getShockedVolBp(activeVolP)
          const curveIdU  = curveIdProp || curveId
          const swpBase = {
            notional, expiry_y: expY, tenor_y: tenY,
            strike: swaptionResult.strike || null,
            is_payer: dir === 'PAY',
            pay_freq_y: 1.0, valuation_date: valDate,
            effective_date: swaptionResult.effective_date || effDate,
            maturity_date:  swaptionResult.maturity_date  || matDate,
            curve_id: curveIdU,
          }
          const [r1,r2,r3,r4] = await Promise.all([
            // 1. base rate + base vol
            fetch(API+'/api/price/swaption',{method:'POST',headers:h,body:JSON.stringify({...swpBase, vol_bp:baseVol})}),
            // 2. shocked rate + base vol
            fetch(API+'/api/price/swaption',{method:'POST',headers:h,body:JSON.stringify({...swpBase, vol_bp:baseVol, shocked_quotes:shockedQuotes})}),
            // 3. base rate + shocked vol
            fetch(API+'/api/price/swaption',{method:'POST',headers:h,body:JSON.stringify({...swpBase, vol_bp:shockVol})}),
            // 4. shocked rate + shocked vol (JOINT)
            fetch(API+'/api/price/swaption',{method:'POST',headers:h,body:JSON.stringify({...swpBase, vol_bp:shockVol, shocked_quotes:shockedQuotes})}),
          ])
          const [d1,d2,d3,d4] = await Promise.all([r1.json(),r2.json(),r3.json(),r4.json()])
          if(r1.ok && r2.ok && r3.ok && r4.ok) {
            const base   = d1.npv, rateOnly = d2.npv, volOnly = d3.npv, joint = d4.npv
            const dRate  = rateOnly - base
            const dVol   = volOnly  - base
            const dJoint = joint    - base
            const dCross = dJoint   - dRate - dVol
            setJointResult({ base, rateOnly, volOnly, joint, dRate, dVol, dJoint, dCross,
              baseVol, shockVol, volScenLabel: VOL_SCEN[volScenKey]?.l })
          }
        } catch(eSwpn) { console.error('[JOINT SWPN]', eSwpn) }
      }
    }catch(e){console.error('[SCENARIO]',e)}
    finally{setScenarioPricing(false)}
  }

  const applyPreset=key=>{setPresetKey(key);shiftsRef.current=[...(PRESETS[key]||PRESETS.flat0)];setConfirmed(false);setTick(t=>t+1);scheduleDraw()}
  const handleReset=()=>{
    shiftsRef.current=TENORS.map(()=>0)
    setPresetKey('flat0'); setBaseOverrides({})
    setConfirmed(true); setScenarioBase(null); setScenarioCalc(null)
    setTick(t=>t+1); scheduleDraw()
    // Also reset vol scenario
    setVolScenKey('base')
    setActiveVolP(SABR_BASE.map(p=>({...p})))
    setUnsavedVol(false)
    setJointResult(null)
    setVolMode('rotate')
  }
  const handleConfirm=()=>{setConfirmed(true);const ov={};TENORS.forEach((t,i)=>{ov[t]=(getBase(t)+shiftsRef.current[i]/100).toFixed(5)});handleRunScenario(ov)}

  const sh=shiftsRef.current
  const anyShift=sh.some(s=>Math.abs(s)>0.05)
  const avgBp=Math.round(sh.reduce((a,b)=>a+b,0)/TENORS.length)
  const fmtPnl=n=>n==null?'—':(n>=0?'+':'-')+'$'+Math.abs(Math.round(n)).toLocaleString('en-US')
  const fmtG=n=>n==null?'—':(n>=0?'+':'')+n.toFixed(4)

  // Compute stats for cards
  const df30 = Math.exp(-getBase('30Y')/100*30)
  const zero5 = getBase('5Y') + (sh[TENORS.indexOf('5Y')]||0)/100
  const df5  = Math.exp(-getBase('5Y')/100*5)
  const df10 = Math.exp(-getBase('10Y')/100*10)
  const fwd5y5y = df5>0&&df10>0 ? (-Math.log(df10/df5)/5)*100 : 0

  const inp = {background:'#0C0C0C',border:'1px solid #1E1E1E',borderRadius:'3px',color:'#F0F0F0',fontFamily:'DM Mono,monospace',fontSize:'0.875rem',padding:'4px 8px',outline:'none',width:'100%'}

  return (
    <div className='tbw-no-drag' style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:'#000000'}}>

      {/* Notice bar */}
      <div style={{background:'rgba(240,160,32,0.06)',borderBottom:'1px solid rgba(240,160,32,0.15)',
        padding:'5px 16px',fontSize:'0.8125rem',color:'#F5C842',letterSpacing:'0.02em',flexShrink:0,
        fontFamily:"'IBM Plex Sans',var(--sans)"}}>
        {IS_SWPN
          ? '⚠ Curve + Vol Scenario — joint rate & vol shock. Changes are for analysis only.'
          : '⚠ Curve Scenario — changes are for analysis only and are not saved to Configurations.'}
      </div>

      {/* Two-column body */}
      <div style={{flex:1,display:'grid',gridTemplateColumns:'340px 1fr',minHeight:0,overflow:'hidden'}}>

        {/* LEFT PANEL */}
        <div style={{borderRight:'1px solid #1E1E1E',display:'flex',flexDirection:'column',overflow:'hidden'}}>

          {/* Controls */}
          <div style={{padding:'14px 16px',borderBottom:'1px solid #1E1E1E',flexShrink:0}}>
            <div style={{fontSize:'0.75rem',fontWeight:600,letterSpacing:'0.08em',color:'#666666',
              fontFamily:"'IBM Plex Sans',var(--sans)",marginBottom:'10px'}}>
              SCENARIO CONTROLS
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
              <select value={presetKey} onChange={e=>applyPreset(e.target.value)}
                style={{...inp,fontFamily:"'IBM Plex Sans',var(--sans)"}}>
                <optgroup label="── Parallel Shifts ──">
                  <option value="flat0">Base (no shift)</option>
                  <option value="up25">+25bp parallel</option><option value="up50">+50bp parallel</option><option value="up100">+100bp parallel</option>
                  <option value="dn25">−25bp parallel</option><option value="dn50">−50bp parallel</option><option value="dn100">−100bp parallel</option>
                </optgroup>
                <optgroup label="── Curve Reshaping ──">
                  <option value="bear_steep">Bear Steepener (S+50 / L+100)</option>
                  <option value="bull_flat">Bull Flattener (S−25 / L−75)</option>
                  <option value="bear_flat">Bear Flattener (S+100 / L+50)</option>
                  <option value="bull_steep">Bull Steepener (S−75 / L−25)</option>
                </optgroup>
                <optgroup label="── Central Bank ──">
                  <option value="hike25">Fed Hike +25bp</option>
                  <option value="cut25">Fed Cut −25bp</option>
                  <option value="hike_cycle">Fed Hike Cycle</option>
                </optgroup>
              </select>
              <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                <span style={{fontSize:'0.8125rem',color:'#666666',fontFamily:"'IBM Plex Sans',var(--sans)",whiteSpace:'nowrap'}}>Ripple width</span>
                <input type='range' min='1' max='10' value={sigma} step='1' style={{flex:1,accentColor:'#00D4A8'}}
                  onChange={e=>{const v=parseFloat(e.target.value);setSigma(v);sigmaRef.current=v}}/>
                <span style={{fontSize:'0.875rem',fontWeight:600,color:'#4A9EFF',fontFamily:'DM Mono,monospace',minWidth:'28px'}}>{sigma}Y</span>
              </div>
              <div style={{display:'flex',gap:'8px'}}>
                <button onClick={handleReset}
                  style={{flex:1,padding:'7px',borderRadius:'3px',cursor:'pointer',fontFamily:"'IBM Plex Sans',var(--sans)",
                    fontSize:'0.8125rem',fontWeight:500,border:'1px solid #1E1E1E',background:'transparent',color:'#666666'}}>
                  Reset
                </button>
                <button onClick={handleConfirm} disabled={(!anyShift&&!unsavedVol)||confirmed||scenarioPricing}
                  style={{flex:2,padding:'7px',borderRadius:'3px',
                    cursor:(!anyShift||confirmed||scenarioPricing)?'not-allowed':'pointer',
                    fontFamily:"'IBM Plex Sans',var(--sans)",fontSize:'0.8125rem',fontWeight:600,
                    border:anyShift&&!confirmed?'1px solid rgba(0,212,168,0.6)':'1px solid #1E1E1E',
                    background:anyShift&&!confirmed?'rgba(0,212,168,0.1)':'transparent',
                    color:anyShift&&!confirmed?'#00D4A8':'#666666'}}>
                  {scenarioPricing?'Repricing...':(anyShift&&!confirmed)?(IS_SWPN?'Confirm & reprice (rate+vol) →':'Confirm & reprice →'):'Confirm shape'}
                </button>
              </div>
              {anyShift&&!confirmed&&(
                <div style={{fontSize:'0.75rem',color:'#F5C842',fontFamily:"'IBM Plex Sans',var(--sans)",
                  background:'rgba(245,200,66,0.06)',border:'1px solid rgba(245,200,66,0.2)',
                  borderRadius:'3px',padding:'4px 8px'}}>
                  Shape unsaved — confirm to reprice · avg {avgBp>0?'+':''}{avgBp}bp
                </div>
              )}

              {/* Vol scenario controls — swaption only */}
              {IS_SWPN && (
                <div style={{marginTop:'12px',paddingTop:'12px',borderTop:'1px solid #1E1E1E'}}>
                  <div style={{fontSize:'0.75rem',fontWeight:600,letterSpacing:'0.08em',
                    color:'#F5C842',fontFamily:"'IBM Plex Sans',var(--sans)",marginBottom:'8px',
                    display:'flex',alignItems:'center',gap:'8px'}}>
                    VOL SCENARIO
                    <span style={{fontSize:'0.6875rem',fontWeight:400,color:'#444'}}>β=0 Normal SABR</span>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:'2px'}}>
                    {Object.entries(VOL_SCEN).map(([key,sc]) => (
                      <button key={key} onClick={()=>applyVolScen(key)}
                        style={{display:'flex',alignItems:'center',gap:'7px',padding:'5px 7px',
                          border:'1px solid '+(volScenKey===key?(key==='base'?'rgba(0,212,168,.5)':'rgba(245,200,66,.5)'):'#1A1A1A'),
                          borderRadius:'2px',cursor:'pointer',background:volScenKey===key?(key==='base'?'rgba(0,212,168,.07)':'rgba(245,200,66,.06)'):'transparent',
                          color:volScenKey===key?(key==='base'?'#00D4A8':'#F5C842'):'#555',
                          fontFamily:"'IBM Plex Sans',var(--sans)",fontSize:'0.8125rem',
                          transition:'all .12s',textAlign:'left'}}>
                        <span style={{width:5,height:5,borderRadius:'50%',flexShrink:0,
                          background:key==='base'?'#00D4A8':key==='dn15'?'#4A9EFF':key==='stress'?'#FF6B6B':'#F5C842',
                          display:'inline-block'}}/>
                        <span>{sc.l}</span>
                        {volScenKey===key&&key!=='base'&&(
                          <span style={{fontSize:'0.6875rem',color:'#555',marginLeft:'auto'}}>{sc.d.slice(0,24)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                  {volScenKey!=='base'&&(
                    <div style={{marginTop:'6px',fontSize:'0.75rem',color:'#F5C842',
                      background:'rgba(245,200,66,0.04)',border:'1px solid rgba(245,200,66,0.15)',
                      borderRadius:'2px',padding:'4px 8px',fontFamily:"'IBM Plex Mono',monospace"}}>
                      σ base: {(parseFloat(swaptionVol)||85).toFixed(1)}bp → shocked: {getShockedVolBp(activeVolP).toFixed(1)}bp
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* PAR RATES table */}
          <div style={{padding:'10px 16px 6px',borderBottom:'1px solid #1E1E1E',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
              <span style={{fontSize:'0.75rem',fontWeight:600,letterSpacing:'0.08em',color:'#666666',fontFamily:"'IBM Plex Sans',var(--sans)"}}>
                PAR RATES — {curveId.replace('_',' ')} &nbsp;
                <span style={{fontWeight:400,color:'#2A2A2A'}}>% p.a.</span>
              </span>
              {Object.keys(baseOverrides).length>0&&(
                <button onClick={()=>setBaseOverrides({})}
                  style={{fontSize:'0.75rem',padding:'2px 8px',borderRadius:'2px',cursor:'pointer',
                    fontFamily:"'IBM Plex Sans',var(--sans)",border:'1px solid rgba(245,200,66,0.3)',
                    background:'rgba(245,200,66,0.06)',color:'#F5C842'}}>
                  clear overrides
                </button>
              )}
            </div>
          </div>

          {/* Scrollable rate rows */}
          <div style={{flex:1,overflowY:'auto',padding:'0 16px 12px'}}>
            {TENORS.map((t,i)=>{
              const marketBase=getBaseMarket(t)
              const base=getBase(t)
              const isOverride=baseOverrides[t]!=null
              const shBp=Math.max(-CAP,Math.min(CAP,sh[i]))
              const shocked=base+shBp/100
              const yr=TENOR_Y[t]
              const df=Math.exp(-shocked/100*yr)
              const shiftClr=shBp>0?'#FF6B6B':shBp<0?'#4A9EFF':'#666666'
              return(
                <div key={t} style={{padding:'6px 0',borderBottom:'1px solid rgba(30,34,53,0.5)'}}>
                  <div style={{display:'grid',gridTemplateColumns:'36px 1fr 70px',alignItems:'center',gap:'8px',marginBottom:'4px'}}>
                    <span style={{fontSize:'0.875rem',fontWeight:700,color:'#00D4A8',fontFamily:'DM Mono,monospace'}}>{t}</span>
                    <input type='text' defaultValue={base.toFixed(8)}
                      key={t+'-'+(isOverride?baseOverrides[t]:marketBase.toFixed(8))}
                      onBlur={e=>{const v=parseFloat(e.target.value);if(!isNaN(v)&&v>0&&v<20){setBaseOverrides(o=>({...o,[t]:v.toFixed(4)}));setTick(x=>x+1);scheduleDraw()}else e.target.value=base.toFixed(8)}}
                      style={{background:'transparent',border:'1px solid '+(isOverride?'rgba(245,200,66,0.5)':'rgba(40,40,40,0.6)'),borderRadius:'2px',color:isOverride?'#F5C842':'#E8EAF0',fontFamily:'DM Mono,monospace',fontSize:'0.875rem',padding:'3px 8px',outline:'none',textAlign:'right'}}/>
                    <span style={{fontSize:'0.8125rem',fontWeight:shBp!==0?700:400,color:shiftClr,fontFamily:'DM Mono,monospace',textAlign:'right'}}>
                      {shBp===0?'—':(shBp>0?'+':'')+shBp.toFixed(1)+'bp'}
                    </span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'36px 1fr 1fr 1fr',gap:'4px'}}>
                    <span/>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:'0.72rem',color:'#2A2A2A',fontFamily:"'IBM Plex Sans',var(--sans)"}}>SHOCKED</div>
                      <div style={{fontSize:'0.8125rem',fontWeight:600,color:shBp===0?'#666666':shiftClr,fontFamily:'DM Mono,monospace'}}>{shocked.toFixed(4)}%</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:'0.72rem',color:'#2A2A2A',fontFamily:"'IBM Plex Sans',var(--sans)"}}>ZERO</div>
                      <div style={{fontSize:'0.8125rem',color:'#666666',fontFamily:'DM Mono,monospace'}}>{shocked.toFixed(4)}%</div>
                    </div>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:'0.72rem',color:'#2A2A2A',fontFamily:"'IBM Plex Sans',var(--sans)"}}>DF</div>
                      <div style={{fontSize:'0.8125rem',color:'#666666',fontFamily:'DM Mono,monospace'}}>{df.toFixed(5)}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* RIGHT PANEL — chart + stats */}
        <div style={{display:'flex',flexDirection:'column',overflow:'hidden',flex:1,minHeight:0}}>

          {/* Stats cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',background:'#1E1E1E',borderBottom:'1px solid #1E1E1E',flexShrink:0}}>
            {[
              {label:'30Y DISCOUNT FACTOR', value:df30.toFixed(4), color:'#4A9EFF'},
              {label:'5Y ZERO RATE',         value:zero5.toFixed(3)+'%', color:'#00D4A8'},
              {label:'10Y FWD RATE (5Y×5Y)',  value:fwd5y5y.toFixed(3)+'%', color:'#F5C842'},
            ].map(s=>(
              <div key={s.label} style={{background:'#000000',padding:'12px 16px'}}>
                <div style={{fontSize:'0.75rem',fontWeight:600,letterSpacing:'0.08em',color:'#666666',
                  fontFamily:"'IBM Plex Sans',var(--sans)",marginBottom:'4px'}}>{s.label}</div>
                <div style={{fontSize:'1.25rem',fontWeight:700,color:s.color,fontFamily:'DM Mono,monospace'}}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Charts container — rate + vol stacked */}
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minHeight:0}}>
          {/* Chart — rate curve */}
          <div style={{flex:IS_SWPN?'0 0 52%':'1',position:'relative',background:'#0C0C0C',overflow:'hidden',minHeight:'160px'}}>
            <canvas ref={canvasRef} style={{display:'block',cursor:'crosshair'}}/>
            {dragTip&&(
              <div style={{position:'absolute',left:dragTip.x,top:dragTip.y,pointerEvents:'none',zIndex:10,
                background:'#0C0C0C',border:'1px solid '+(dragTip.bp>=0?'rgba(255,107,107,0.7)':'rgba(74,158,255,0.7)'),
                borderRadius:'3px',padding:'5px 12px',fontSize:'0.875rem',fontFamily:'DM Mono,monospace',
                fontWeight:700,color:dragTip.bp>=0?'#FF6B6B':'#4A9EFF',whiteSpace:'nowrap',
                boxShadow:'0 4px 16px rgba(0,0,0,0.9)'}}>
                {dragTip.bp>=0?'+':''}{dragTip.bp}bp @ {dragTip.tenor}
              </div>
            )}
            {hoverInfo&&!dragTip&&(
              <div style={{position:'absolute',left:Math.min(hoverInfo.x+14,600),top:Math.max(hoverInfo.y-80,4),
                pointerEvents:'none',zIndex:10,background:'#0C0C0C',border:'1px solid #1E1E1E',
                borderRadius:'3px',padding:'10px 14px',minWidth:'160px',boxShadow:'0 4px 20px rgba(0,0,0,0.9)'}}>
                <div style={{fontSize:'0.9375rem',fontWeight:700,letterSpacing:'0.08em',color:'#F0F0F0',
                  fontFamily:'DM Mono,monospace',marginBottom:'7px'}}>{hoverInfo.tenor}</div>
                <div style={{display:'flex',justifyContent:'space-between',gap:'16px',marginBottom:'4px'}}>
                  <span style={{fontSize:'0.8125rem',color:'#666666',fontFamily:"'IBM Plex Sans',var(--sans)"}}>Base</span>
                  <span style={{fontSize:'0.875rem',fontWeight:600,color:'#00D4A8',fontFamily:'DM Mono,monospace'}}>{hoverInfo.base.toFixed(4)}%</span>
                </div>
                {hoverInfo.bp!==0&&<>
                  <div style={{display:'flex',justifyContent:'space-between',gap:'16px',marginBottom:'4px'}}>
                    <span style={{fontSize:'0.8125rem',color:'#666666',fontFamily:"'IBM Plex Sans',var(--sans)"}}>Shocked</span>
                    <span style={{fontSize:'0.875rem',fontWeight:600,color:hoverInfo.bp>0?'#FF6B6B':'#4A9EFF',fontFamily:'DM Mono,monospace'}}>{hoverInfo.shocked.toFixed(4)}%</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',gap:'16px',borderTop:'1px solid #1E1E1E',paddingTop:'5px',marginTop:'4px'}}>
                    <span style={{fontSize:'0.8125rem',color:'#666666',fontFamily:"'IBM Plex Sans',var(--sans)"}}>Shift</span>
                    <span style={{fontSize:'0.875rem',fontWeight:700,color:hoverInfo.bp>0?'#FF6B6B':'#4A9EFF',fontFamily:'DM Mono,monospace'}}>{hoverInfo.bp>0?'+':''}{hoverInfo.bp}bp</span>
                  </div>
                </>}
              </div>
            )}
            <div style={{position:'absolute',bottom:6,right:12,fontSize:'0.75rem',color:'rgba(107,122,153,0.4)',
              fontFamily:"'IBM Plex Sans',var(--sans)",pointerEvents:'none'}}>
              Drag any point to reshape · Gaussian ripple
            </div>
          </div>

          {/* Impact analytics */}
          {/* 3D Vol surface — swaption only, hover-activated orbit */}
          {IS_SWPN && (
            <div ref={volWrapRef}
              style={{flex:'1 1 0',borderTop:'1px solid #1E1E1E',background:'#0A0A0E',
                position:'relative',minHeight:'180px',overflow:'hidden'}}
>
              <div style={{position:'absolute',top:5,left:8,fontSize:'0.5rem',
                color:'#F5C842',letterSpacing:'.10em',fontFamily:"'IBM Plex Mono',monospace",zIndex:2}}>
                VOL SURFACE — β=0 NORMAL SABR {volScenKey!=='base'&&<span style={{color:'#555',marginLeft:6}}>· {VOL_SCEN[volScenKey]?.l}</span>}
              </div>
              {/* Mode button — top right of vol pane */}
              <div style={{position:'absolute',top:5,right:8,zIndex:3,display:'flex',gap:3}}>
                <button
                  onClick={()=>setVolMode('rotate')}
                  style={{padding:'3px 8px',fontSize:'0.5rem',fontWeight:600,letterSpacing:'.08em',
                    cursor:'pointer',borderRadius:'1px',fontFamily:"'IBM Plex Mono',monospace",
                    border: volMode==='rotate'?'1px solid rgba(74,158,255,.5)':'1px solid #1a1c26',
                    color: volMode==='rotate'?'#4A9EFF':'#444',
                    background: volMode==='rotate'?'rgba(74,158,255,.07)':'transparent'}}>
                  ⟳ ROTATE
                </button>
                <button
                  onClick={()=>setVolMode(m=>m==='reshape'?'rotate':'reshape')}
                  style={{padding:'3px 8px',fontSize:'0.5rem',fontWeight:600,letterSpacing:'.08em',
                    cursor:'pointer',borderRadius:'1px',fontFamily:"'IBM Plex Mono',monospace",
                    border: volMode==='reshape'?'1px solid rgba(245,200,66,.5)':'1px solid #1a1c26',
                    color: volMode==='reshape'?'#F5C842':'#444',
                    background: volMode==='reshape'?'rgba(245,200,66,.07)':'transparent'}}>
                  ✦ {volMode==='reshape'?'RESHAPING...':'RESHAPE'}
                </button>
              </div>
              <div style={{position:'absolute',bottom:6,right:8,fontSize:'0.4375rem',
                color:'#1E2028',letterSpacing:'.07em',fontFamily:"'IBM Plex Mono',monospace",zIndex:2}}>
                {volMode==='rotate'?'DRAG TO ROTATE · SCROLL TO ZOOM':'DRAG UP/DOWN TO DEFORM VOL · REPRICE FOR ΔP&L'}
              </div>
              {!isVolThreeReady && (
                <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',
                  justifyContent:'center',color:'#2A2A2A',fontSize:'0.75rem',
                  fontFamily:"'IBM Plex Mono',monospace",letterSpacing:'.08em'}}>
                  PRICE SWAPTION FIRST TO LOAD SURFACE
                </div>
              )}
              {/* Legend */}
              <div style={{position:'absolute',bottom:6,left:8,display:'flex',flexDirection:'column',
                gap:4,pointerEvents:'none',zIndex:2}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <div style={{width:16,height:2,background:'rgba(0,212,168,.6)',borderRadius:1}}/>
                  <span style={{fontSize:'0.4375rem',color:'rgba(0,212,168,.5)',letterSpacing:'.07em',fontFamily:"'IBM Plex Mono',monospace"}}>BASE</span>
                </div>
                {volScenKey!=='base'&&(
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <div style={{width:16,height:2,background:'#F5C842',borderRadius:1}}/>
                    <span style={{fontSize:'0.4375rem',color:'#F5C842',letterSpacing:'.07em',fontFamily:"'IBM Plex Mono',monospace"}}>SHOCKED</span>
                  </div>
                )}
              </div>
              <canvas ref={volCanvasRef}
                style={{display:'block',width:'100%',height:'100%',cursor:'grab'}}
              />
            </div>
          )}
          </div>{/* /charts container */}

          {/* Joint P&L attribution — swaption only */}
          {IS_SWPN && jointResult && (
            <div style={{flexShrink:0,borderTop:'1px solid #1E1E1E',background:'#000'}}>
              <div style={{padding:'6px 14px 4px',display:'flex',alignItems:'center',gap:'10px'}}>
                <span style={{fontSize:'0.75rem',fontWeight:600,letterSpacing:'.08em',
                  color:'#666',fontFamily:"'IBM Plex Sans',var(--sans)"}}>
                  JOINT RATE + VOL P&L ATTRIBUTION
                </span>
                <span style={{fontSize:'0.6875rem',color:'#F5C842',
                  fontFamily:"'IBM Plex Mono',monospace"}}>
                  Vol: {jointResult.volScenLabel}
                </span>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'1px',
                background:'#1E1E1E',margin:'0 0 0 0'}}>
                {[
                  {l:'ΔNPV RATE ONLY',   v:jointResult.dRate,  c:'#4A9EFF',
                   s:'rate shock · vol held'},
                  {l:'ΔNPV VOL ONLY',    v:jointResult.dVol,   c:'#F5C842',
                   s:`${jointResult.baseVol?.toFixed(1)}→${jointResult.shockVol?.toFixed(1)}bp`},
                  {l:'ΔNPV JOINT',       v:jointResult.dJoint, c:'#00D4A8',
                   s:'rate + vol combined'},
                  {l:'ΔNPV CROSS-GAMMA', v:jointResult.dCross,
                   c:Math.abs(jointResult.dCross)<500?'#666':'#FF6B6B',
                   s:'joint − sum (non-linear)'},
                ].map(({l,v,c,s}) => (
                  <div key={l} style={{background:'#050505',padding:'8px 10px'}}>
                    <div style={{fontSize:'0.6875rem',fontWeight:600,letterSpacing:'.08em',
                      color:'#444',fontFamily:"'IBM Plex Sans',var(--sans)",marginBottom:3}}>{l}</div>
                    <div style={{fontSize:'1rem',fontWeight:700,color:v!=null?c:'#333',
                      fontFamily:"'IBM Plex Mono',monospace",marginBottom:2}}>
                      {v!=null ? (v>=0?'+':'-')+'$'+Math.abs(Math.round(v)).toLocaleString() : '—'}
                    </div>
                    <div style={{fontSize:'0.6875rem',color:'#333'}}>{s}</div>
                  </div>
                ))}
              </div>
              <div style={{padding:'4px 14px',fontSize:'0.6875rem',color:'#1A1A1A',
                fontFamily:"'IBM Plex Mono',monospace"}}>
                Cross-gamma = joint P&L − (rate P&L + vol P&L) · Non-zero = rate and vol move are correlated
              </div>
            </div>
          )}

          {(scenarioBase||scenarioCalc)&&(
            <div style={{flexShrink:0,borderTop:'1px solid #1E1E1E',
              display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'1px',background:'#1E1E1E'}}>
              {(()=>{
                const bTheta=scenarioBase?.theta,bIR01=scenarioBase?.ir01,sIR01=scenarioCalc?.ir01
                const approxTheta=bTheta!=null&&bIR01&&sIR01?bTheta+bTheta*((sIR01-bIR01)/Math.abs(bIR01)):null
                return[
                  {label:'NET NPV',base:scenarioBase?.npv,shocked:scenarioCalc?.npv,fmt:fmtPnl},
                  {label:'IR01',base:scenarioBase?.ir01,shocked:scenarioCalc?.ir01,fmt:fmtPnl},
                  {label:'GAMMA',base:scenarioBase?.gamma,shocked:scenarioCalc?.gamma,fmt:fmtG,dp:4},
                  {label:'THETA',base:bTheta,shocked:approxTheta,fmt:fmtPnl,approx:true},
                ].map(item=>{
                  const delta=item.shocked!=null&&item.base!=null?item.shocked-item.base:null
                  const fmt=n=>n==null?'—':item.dp?(n>=0?'+':'')+n.toFixed(item.dp):item.fmt(n)
                  return(
                    <div key={item.label} style={{background:'#000000',padding:'10px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:3}}>
                        <span style={{fontSize:'0.75rem',fontWeight:600,letterSpacing:'0.08em',color:'#666666',
                          fontFamily:"'IBM Plex Sans',var(--sans)"}}>{item.label}</span>
                        {item.approx&&item.shocked!=null&&(
                          <button onClick={()=>setThetaApproxVisible(v=>!v)}
                            style={{fontSize:'0.75rem',padding:'1px 5px',borderRadius:'2px',cursor:'pointer',
                              fontFamily:"'IBM Plex Sans',var(--sans)",border:'1px solid rgba(245,200,66,0.3)',
                              background:'rgba(245,200,66,0.06)',color:'#F5C842'}}>
                            {thetaApproxVisible?'▴':'▾'} ~
                          </button>
                        )}
                      </div>
                      <div style={{fontSize:'1rem',fontWeight:700,fontFamily:'DM Mono,monospace',color:'#4A9EFF'}}>{fmt(item.base)}</div>
                      {item.shocked!=null&&<>
                        <div style={{fontSize:'1rem',fontWeight:700,fontFamily:'DM Mono,monospace',
                          color:item.shocked>=0?'#00D4A8':'#FF6B6B'}}>
                          {fmt(item.shocked)}{item.approx&&<span style={{fontSize:'0.75rem',color:'#F5C842',marginLeft:2}}>~</span>}
                        </div>
                        {delta!=null&&<div style={{fontSize:'0.8125rem',marginTop:2,fontFamily:'DM Mono,monospace',
                          color:delta>=0?'#00D4A8':'#FF6B6B'}}>{delta>=0?'+':''}{fmt(delta)}</div>}
                        {item.approx&&thetaApproxVisible&&<div style={{fontSize:'0.75rem',color:'#F5C842',marginTop:3,
                          borderTop:'1px solid rgba(245,200,66,0.2)',paddingTop:3,fontFamily:"'IBM Plex Sans',var(--sans)"}}>
                          ΔTheta ∝ ΔIR01/IR01 — directional only
                        </div>}
                      </>}
                    </div>
                  )
                })
              })()}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


function xvaCalc(xva, notionalRef, rateRef, effDate, matDate, parRate) {
  try {
    const n = parseFloat((notionalRef.current?.value||'10000000').replace(/,/g,''))
    const m = (effDate&&matDate)?(new Date(matDate)-new Date(effDate))/(365.25*24*3600*1000):5
    const dv = (isNaN(n)?10000000:n)*m/10000
    const bp = [xva.cva,xva.dva,xva.fva,xva.fba,xva.kva,xva.mva].reduce((s,v)=>s+(v||0),0)/dv
    const par = parRate||parseFloat(rateRef.current?.value||'3.665')
    return { allIn:par+bp/100, bp, dv01:dv, par }
  } catch(_) { return { allIn:3.665, bp:0, dv01:1, par:3.665 } }
}

function XvaFooterRate({xva,notionalRef,rateRef,effDate,matDate,parRate}) {
  const {allIn} = xvaCalc(xva,notionalRef,rateRef,effDate,matDate,parRate)
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'1px',padding:'0 10px',borderLeft:'1px solid rgba(0,212,168,0.3)',marginLeft:'4px'}}>
      <span style={{fontSize:'9px',color:'#00D4A8',letterSpacing:'0.08em',fontFamily:"'IBM Plex Sans',sans-serif"}}>ALL-IN RATE</span>
      <span style={{fontSize:'13px',fontWeight:700,color:'#00D4A8',fontFamily:"'IBM Plex Mono',monospace"}}>{allIn.toFixed(3)}%</span>
    </div>
  )
}

function XvaBookLabel({xva,notionalRef,rateRef,effDate,matDate,parRate}) {
  const {allIn} = xvaCalc(xva,notionalRef,rateRef,effDate,matDate,parRate)
  return <>▶ BOOK AT {allIn.toFixed(3)}%</>
}

function XvaInlinePanel({xva,notionalRef,rateRef,effDate,matDate,parRate,onApply}) {
  const {allIn,bp:xvaBp,dv01,par:cur} = xvaCalc(xva,notionalRef,rateRef,effDate,matDate,parRate)
  const fD = v => { if(v==null) return '—'; return (v>=0?'+':'-')+String.fromCharCode(36)+Math.abs(Math.round(v)).toLocaleString('en-US') }
  const fB = v => v==null?'—':(v>=0?'+':'')+v.toFixed(1)+'bp'
  const cells = [
    {k:'npv',   l:'NPV',    v:xva.npv,    col:'var(--text)',   b:cur.toFixed(3)+'%',   s:'par rate'},
    {k:'cva',   l:'CVA',    v:xva.cva,    col:'var(--red)',    b:fB(xva.cva/dv01),     s:'bp on rate'},
    {k:'dva',   l:'DVA',    v:xva.dva,    col:'var(--blue)',   b:fB(xva.dva/dv01),     s:'bp on rate'},
    {k:'fva',   l:'FVA',    v:xva.fva,    col:'var(--red)',    b:fB(xva.fva/dv01),     s:'bp on rate'},
    {k:'fba',   l:'FBA',    v:xva.fba,    col:'var(--blue)',   b:fB(xva.fba/dv01),     s:'bp on rate'},
    {k:'kva',   l:'KVA',    v:xva.kva,    col:'var(--red)',    b:fB(xva.kva/dv01),     s:'bp on rate'},
    {k:'mva',   l:'MVA~',   v:xva.mva,    col:'var(--amber)',  b:fB(xva.mva/dv01),     s:'bp on rate'},
    {k:'all_in',l:'ALL-IN', v:xva.all_in, col:'var(--accent)', b:allIn.toFixed(3)+'%', s:'all-in rate'},
  ]
  return (
    <>
      <div style={{display:'flex',alignItems:'center',gap:'14px',padding:'8px 12px',background:'rgba(0,212,168,0.04)',border:'1px solid rgba(0,212,168,0.2)',borderRadius:'2px',marginBottom:'8px'}}>
        <div style={{display:'flex',flexDirection:'column',gap:'2px',minWidth:'90px'}}>
          <div style={{fontSize:'0.75rem',fontWeight:700,letterSpacing:'.10em',color:'var(--accent)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>ALL-IN RATE</div>
          <div style={{fontSize:'1.25rem',fontWeight:700,color:'var(--accent)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>{allIn.toFixed(3)}%</div>
        </div>
        <div style={{width:'1px',height:'40px',background:'var(--border)',flexShrink:0}}/>
        <div style={{display:'flex',flexDirection:'column',gap:'3px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <span style={{fontSize:'0.8125rem',color:'var(--text-dim)',minWidth:'64px'}}>PAR rate</span>
            <span style={{fontSize:'0.875rem',fontWeight:600,fontFamily:"'IBM Plex Mono',var(--mono)"}}>{cur.toFixed(4)}%</span>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <span style={{fontSize:'0.8125rem',color:'var(--text-dim)',minWidth:'64px'}}>XVA cost</span>
            <span style={{fontSize:'0.875rem',fontWeight:600,color:'var(--red)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>{fD(xva.all_in)} / {fB(xvaBp)}</span>
          </div>
          <div style={{height:'1px',background:'var(--border)'}}/>
          <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
            <span style={{fontSize:'0.8125rem',color:'var(--accent)',minWidth:'64px'}}>All-in NPV</span>
            <span style={{fontSize:'0.875rem',fontWeight:600,color:'var(--red)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>{fD(xva.all_in)}</span>
          </div>
        </div>
        <div style={{marginLeft:'auto',display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'4px'}}>
          <button onClick={onApply} style={{padding:'4px 12px',borderRadius:'2px',fontSize:'0.8125rem',fontWeight:700,cursor:'pointer',fontFamily:"'IBM Plex Mono',var(--mono)",border:'1px solid rgba(0,212,168,0.4)',background:'rgba(0,212,168,0.07)',color:'var(--accent)'}}>APPLY TO RATE</button>
          <div style={{fontSize:'0.75rem',color:'var(--text-dim)'}}>embed {fB(xvaBp)} into fixed rate</div>
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:'1px',background:'var(--border)',borderRadius:'2px',overflow:'hidden'}}>
        {cells.map(({k,l,v,col,b,s}) => (
          <div key={k} style={{background:k==='all_in'?'rgba(0,212,168,0.04)':'var(--bg)',padding:'7px 8px',borderLeft:k==='all_in'?'1px solid rgba(0,212,168,0.15)':'none'}}>
            <div style={{fontSize:'0.6875rem',fontWeight:700,letterSpacing:'.10em',color:'var(--text-dim)',fontFamily:"'IBM Plex Mono',var(--mono)",marginBottom:'3px'}}>{l}</div>
            <div style={{fontSize:'0.9375rem',fontWeight:700,color:col,fontFamily:"'IBM Plex Mono',var(--mono)",marginBottom:'2px'}}>{fD(v)}</div>
            <div style={{borderTop:'1px solid var(--panel-2)',paddingTop:'2px'}}>
              <div style={{fontSize:'0.75rem',fontWeight:600,color:col,fontFamily:"'IBM Plex Mono',var(--mono)",opacity:.8}}>{b}</div>
              <div style={{fontSize:'0.6875rem',color:'var(--text-dim)',opacity:.5}}>{s}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}


// ── Swaption theta decay sparkline ───────────────────────────────────────────
function SwaptionDecayChart({ result, expiry }) {
  const ref = useRef(null)
  const EXPIRY_Y = {'1M':1/12,'3M':0.25,'6M':0.5,'1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'10Y':10}
  const T = EXPIRY_Y[expiry] || 1

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !result) return
    const dpr = window.devicePixelRatio || 2
    const W = canvas.parentElement.offsetWidth || 500
    const H = 90
    canvas.width = W * dpr; canvas.height = H * dpr
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')
    ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr, dpr)

    const NPV = result.npv
    const sigma = parseFloat(result.vol_bp||86.5) / 10000
    const PAD = {l:8, r:60, t:10, b:20}
    const CW = W - PAD.l - PAD.r
    const CH = H - PAD.t - PAD.b

    ctx.fillStyle = '#0D0F17'; ctx.fillRect(0,0,W,H)

    // Generate decay curve using Bachelier time value approximation
    // V(t) ≈ NPV × sqrt((T-t)/T) — approximate convex decay
    const N = 80
    const pts = []
    for (let i = 0; i <= N; i++) {
      const frac = i / N
      const t_rem = T * (1 - frac)
      const v = Math.abs(NPV) * Math.sqrt(t_rem / T)
      pts.push({x: PAD.l + frac * CW, y: PAD.t + CH - (v / Math.abs(NPV)) * CH})
    }

    // Gradient fill
    const grad = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b)
    grad.addColorStop(0, 'rgba(74,158,255,0.15)')
    grad.addColorStop(1, 'rgba(74,158,255,0)')
    ctx.beginPath()
    pts.forEach((p,i) => i===0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
    ctx.lineTo(pts[pts.length-1].x, H-PAD.b)
    ctx.lineTo(pts[0].x, H-PAD.b)
    ctx.closePath()
    ctx.fillStyle = grad; ctx.fill()

    // Glow
    ctx.beginPath()
    pts.forEach((p,i) => i===0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
    ctx.strokeStyle = 'rgba(74,158,255,0.2)'; ctx.lineWidth = 6; ctx.lineJoin='round'; ctx.stroke()

    // Line
    ctx.beginPath()
    pts.forEach((p,i) => i===0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
    ctx.strokeStyle = '#4A9EFF'; ctx.lineWidth = 1.5; ctx.stroke()

    // Today dot
    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 3, 0, Math.PI*2)
    ctx.strokeStyle='rgba(74,158,255,.3)'; ctx.lineWidth=3; ctx.stroke()
    ctx.beginPath(); ctx.arc(pts[0].x, pts[0].y, 2, 0, Math.PI*2)
    ctx.fillStyle='#4A9EFF'; ctx.fill()

    // X labels
    ctx.fillStyle='#555'; ctx.font='9px DM Mono,monospace'; ctx.textBaseline='top'
    ctx.textAlign='left'; ctx.fillText('Today', PAD.l, H-PAD.b+3)
    ctx.textAlign='right'; ctx.fillText('Expiry', W-PAD.r+4, H-PAD.b+3)

    // Y label
    ctx.textAlign='right'; ctx.textBaseline='middle'; ctx.fillStyle='#4A9EFF'
    ctx.fillText('$'+Math.round(Math.abs(NPV)).toLocaleString(), W-4, pts[0].y)
    ctx.fillStyle='#555'
    ctx.fillText('$0', W-4, H-PAD.b)

  }, [result?.npv, expiry])

  return <canvas ref={ref} style={{display:'block'}}/>
}

export default function TradeBookingWindow({ onClose, onViewTrade, initialPos, windowId, trade: initialTrade }) {
  const { fetchTrades } = useTradesStore()
  const { curves, curveInterp } = useMarketDataStore()
  const dataLoaded    = useRef(false)
  const dragStart     = useRef(null)
  const analyticsRef  = useRef(null)
  const notionalRef = useRef(null)
  const rateRef     = useRef(null)
  const spreadRef   = useRef(null)
  const leverageRef = useRef(null)

  const defs = getDefaults()
  const [pos,      setPos]      = useState(initialPos || { x:40, y:20 })
  const [dragging, setDragging] = useState(false)
  const [size,     setSize]     = useState({ w: Math.min(1170, Math.round(window.innerWidth*0.846)), h: Math.round(window.innerHeight*0.873) })
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
  // Clear stale errors on mount
  React.useEffect(()=>{setAnalyticsErr(null)},[])
  const [xvaResult,     setXvaResult]    = useState(null)
  const [xvaPricing,    setXvaPricing]   = useState(false)
  const [xvaApplied,    setXvaApplied]   = useState(false)
  const xvaParamsRef = useRef(null) // populated by XVATab on every param change
  const [xvaErr,        setXvaErr]       = useState(null)
  const [valDate,       setValDate]      = useState('')
  // VIEW MODE — set when opening existing trade from blotter
  const [viewTrade,     setViewTrade]    = useState(initialTrade || null)
  const isViewMode = !!viewTrade

  // SCENARIO tab state moved to <ScenarioTab /> component
  const [parRate,       setParRate]      = useState(null)
  const [notionalState, setNotionalState] = useState(10000000)
  const [fraDay,         setFraDay]         = useState('ACT/360')
  const [index2,         setIndex2]         = useState('EFFR')
  const [floatResetFreq2,setFloatResetFreq2] = useState('DAILY')
  const [floatPayFreq2,  setFloatPayFreq2]   = useState('ANNUAL')
  const [floatDc2,       setFloatDc2]        = useState('ACT/360')
  // ── Swaption state ────────────────────────────────────────────────────────
  const [swaptionExpiry,       setSwaptionExpiry]       = useState('1Y')
  const [swaptionVol,          setSwaptionVol]          = useState('86.5')
  const [swaptionStrike,       setSwaptionStrike]       = useState('')    // blank = ATM
  const [exerciseType,         setExerciseType]         = useState('EUROPEAN')  // EUROPEAN | BERMUDAN | AMERICAN
  const [bermudanFirst,        setBermudanFirst]        = useState('')
  const [bermudanLast,         setBermudanLast]         = useState('')
  const [bermudanFreq,         setBermudanFreq]         = useState('3M')
  const [feeAmount,            setFeeAmount]            = useState('')
  const [feeAmountType,        setFeeAmountType]        = useState('BP')        // BP | $
  const [feeSettleDate,        setFeeSettleDate]        = useState('')
  const [showFeeSchedule,      setShowFeeSchedule]      = useState(false)
  const [feeSchedule,          setFeeSchedule]          = useState([{date:'',amount:''}])
  const [swaptionResult,       setSwaptionResult]       = useState(null)
  const [swaptionPricing,      setSwaptionPricing]      = useState(false)
  const [swaptionErr,          setSwaptionErr]          = useState('')
  const [zcToggle,      setZcToggle]      = useState(false)
  const [rateSchedule,  setRateSchedule]  = useState([])
  const [notionalSchedule,setNotionalSchedule] = useState([])
  const [spreadSchedule,setSpreadSchedule]= useState([])
  const [rateMode,      setRateMode]      = useState('PAR')
  const [targetNpv,     setTargetNpv]    = useState('')
  const [solvingNpv,    setSolvingNpv]   = useState(false)

  // Auto-price on mount when dates are available
  useEffect(() => {
    if (effDate && matDate && !viewTrade) {
      const timer = setTimeout(() => {
        if (notionalRef.current && rateRef.current) handlePrice()
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [effDate, matDate])

  const applyIndexDefaults = (idx) => {
    const [reset, pay, dc] = INDEX_DEFAULTS[idx] || ['DAILY','ANNUAL','ACT/360']
    setFloatResetFreq(reset); setFloatPayFreq(pay); setFloatDc(dc)
  }

  const deriveStructLabel = () => {
    const hasRate     = rateSchedule.filter(r => r.date && r.rate !== '').length > 0
    const hasNotional = notionalSchedule.filter(r => r.date && r.notional !== '').length > 0
    const hasSpread   = spreadSchedule.filter(r => r.date && r.spread_bps !== '').length > 0
    const features    = [hasRate, hasNotional, hasSpread].filter(Boolean).length
    if (zcToggle && features > 0) return 'CUSTOM_SWAP'
    if (zcToggle)                 return 'ZERO_COUPON'
    if (features === 0)           return struct
    if (features >= 3)            return 'CUSTOM_SWAP'
    if (hasRate   && hasSpread)   return 'STEP_UP_SPREAD'
    if (hasRate   && hasNotional) return 'STEP_UP_AMORTIZING'
    if (hasNotional && hasSpread) return 'AMORTIZING_SPREAD'
    if (hasRate)                  return 'STEP_UP'
    if (hasNotional)              return 'AMORTIZING'
    if (hasSpread)                return 'SPREAD_SWAP'
    return struct
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
        rateRef.current.value = data.par_rate.toFixed(8)
        setParRate(data.par_rate)
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
    if (isViewMode) return
    if (inst === 'FRA') return  // FRA has no par rate — forward rate shown after pricing
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
    const structLabel = deriveStructLabel()
    const curveId     = CCY_CURVE[ccy] || 'USD_SOFR'
    const forecastId  = INDEX_CURVE[index] || curveId
    const isOIS       = struct === 'OIS'
    const isZC        = zcToggle
    const fixedRate   = parRate ? parRate/100 : parseFloat(rateRef.current ? rateRef.current.value : '0') / 100
    const spreadVal   = parseFloat(spreadRef.current ? spreadRef.current.value : '0') / 10000
    const leverageVal = parseFloat(leverageRef.current ? leverageRef.current.value : '1.0')
    const payLag      = INDEX_PAY_LAG[index] != null ? INDEX_PAY_LAG[index] : 2
    const rateSchedDecimal = rateSchedule.filter(r=>r.date&&r.rate!=='').map(r=>({date:r.date,rate:parseFloat(r.rate)/100}))
    const spreadSchedDecimal = spreadSchedule.filter(r=>r.date&&r.spread_bps!=='').map(r=>({date:r.date,spread:parseFloat(r.spread_bps)/10000}))

    // ── FRA: single settlement leg ──────────────────────────────────────────
    if (inst === 'FRA') {
      return [{
        id: crypto.randomUUID(), trade_id: tradeId,
        leg_ref: 'FRA-1', leg_seq: 1, leg_type: 'FRA',
        direction: dir, currency: ccy, notional, notional_type: 'BULLET',
        effective_date: effDate, maturity_date: matDate,
        day_count: fraDay || 'ACT/360',
        payment_frequency: 'ANNUAL', bdc: 'MOD_FOLLOWING',
        stub_type: 'SHORT_FRONT', payment_lag: 0,
        fixed_rate: fixedRate,
        discount_curve_id: curveId, forecast_curve_id: forecastId,
        ois_compounding: null,
      }]
    }

    // ── BASIS SWAP: two float legs ─────────────────────────────────────────
    if (struct === 'BASIS') {
      const forecastId2 = INDEX_CURVE[index2] || curveId
      return [
        {
          id:crypto.randomUUID(), trade_id:tradeId, leg_ref:'FLOAT-1', leg_seq:1, leg_type:'FLOAT',
          direction:dir, currency:ccy, notional, notional_type:'BULLET',
          effective_date:effDate, maturity_date:matDate,
          day_count:floatDc, payment_frequency:floatPayFreq,
          reset_frequency:floatResetFreq,
          bdc:floatBdc, payment_calendar:floatCal,
          stub_type:'SHORT_FRONT', payment_lag:payLag,
          fixed_rate:0, spread:0, leverage:1.0,
          discount_curve_id:curveId, forecast_curve_id:forecastId,
          ois_compounding:null,
        },
        {
          id:crypto.randomUUID(), trade_id:tradeId, leg_ref:'FLOAT-2', leg_seq:2, leg_type:'FLOAT',
          direction:dir==='PAY'?'RECEIVE':'PAY',
          currency:ccy, notional, notional_type:'BULLET',
          effective_date:effDate, maturity_date:matDate,
          day_count:floatDc2, payment_frequency:floatPayFreq2,
          reset_frequency:floatResetFreq2,
          bdc:floatBdc, payment_calendar:floatCal,
          stub_type:'SHORT_FRONT', payment_lag:payLag,
          fixed_rate:0, spread:isNaN(spreadVal)?0:spreadVal, leverage:1.0,
          discount_curve_id:curveId, forecast_curve_id:forecastId2,
          ois_compounding:null,
        },
      ]
    }

    const fixedLeg = {
      id:crypto.randomUUID(), trade_id:tradeId, leg_ref:'FIXED-1', leg_seq:1,
      leg_type: isZC ? 'ZERO_COUPON' : 'FIXED',
      direction:dir, currency:ccy, notional, notional_type:'BULLET',
      effective_date:effDate, maturity_date:matDate,
      day_count:fixedDc, payment_frequency: isZC ? 'ZERO_COUPON' : fixedPayFreq,
      bdc:fixedBdc, payment_calendar:fixedCal,
      stub_type:'SHORT_FRONT', payment_lag:payLag, fixed_rate:fixedRate,
      fixed_rate_schedule: rateSchedDecimal.length > 0 ? rateSchedDecimal : null,
      discount_curve_id:curveId, forecast_curve_id:null, ois_compounding:null,
    }
    const floatLeg = {
      id:crypto.randomUUID(), trade_id:tradeId, leg_ref:'FLOAT-1', leg_seq:2, leg_type:'FLOAT',
      direction:floatDir, currency:ccy, notional, notional_type:'BULLET',
      effective_date:effDate, maturity_date:matDate,
      day_count:floatDc, payment_frequency:floatPayFreq,
      reset_frequency: isOIS ? 'DAILY' : floatResetFreq,
      bdc:floatBdc, payment_calendar:floatCal,
      stub_type:'SHORT_FRONT', payment_lag:payLag, fixed_rate:0,
      spread: isNaN(spreadVal) ? 0 : spreadVal,
      spread_schedule: spreadSchedDecimal.length > 0 ? spreadSchedDecimal : null,
      leverage: isNaN(leverageVal) ? 1.0 : leverageVal,
      discount_curve_id:curveId, forecast_curve_id:forecastId,
      ois_compounding: isOIS ? 'COMPOUNDING' : null,
    }
    return [fixedLeg, floatLeg]
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
      terms: inst === 'FRA' ? {
        direction: dir,
        fixed_rate: isNaN(rateVal) ? null : rateVal/100,
        float_index: index,
        fra_day_count: fraDay || 'ACT/360',
      } : struct === 'BASIS' ? {
        direction: dir,
        index1: index, index2: index2,
        spread: isNaN(parseFloat(spreadRef.current?.value)) ? 0 : parseFloat(spreadRef.current.value)/10000,
        float_reset_freq: floatResetFreq, float_pay_freq: floatPayFreq,
        float_day_count: floatDc, float_bdc: floatBdc,
        float_reset_freq2: floatResetFreq2, float_pay_freq2: floatPayFreq2,
        float_day_count2: floatDc2,
      } : { direction:dir, float_direction:floatDir,
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
      body:JSON.stringify({trade_id:tradeId,valuation_date:vd,curves:[curveObj(curveId)]})})
    if (!priceRes.ok) throw new Error('Pricing failed')
    return { trade, priceData: await priceRes.json() }
  }

  // Stateless pre-trade pricer — calls /price/preview, zero DB writes
  const pricePreview = async () => {
    const raw = notionalRef.current ? notionalRef.current.value.replace(/,/g,'') : ''
    if (!raw && !notionalState) throw new Error('Notional is required.')
    if (!effDate || !matDate) throw new Error('Dates are required.')
    const notional   = parseFloat(raw) || notionalState
    const rateVal    = inst === 'FRA'
      ? (parseFloat(rateRef.current ? rateRef.current.value : '0') || 0)
      : (parRate || parseFloat(rateRef.current ? rateRef.current.value : '0'))
    const spreadVal  = parseFloat(spreadRef.current ? spreadRef.current.value : '0') / 10000
    const leverageVal= parseFloat(leverageRef.current ? leverageRef.current.value : '1.0')
    const payLag     = INDEX_PAY_LAG[index] != null ? INDEX_PAY_LAG[index] : 2
    const curveId    = CCY_CURVE[ccy] || 'USD_SOFR'
    const forecastId = INDEX_CURVE[index] || curveId
    const isOIS      = struct === 'OIS'
    const isZC       = zcToggle
    const rateSchedPrev = rateSchedule.filter(r=>r.date&&r.rate!=='').map(r=>({date:r.date,rate:parseFloat(r.rate)/100}))
    const spreadSchedPrev = spreadSchedule.filter(r=>r.date&&r.spread_bps!=='').map(r=>({date:r.date,spread:parseFloat(r.spread_bps)/10000}))
    const session    = await getSession()
    const h = { Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' }

    // ── FRA: single settlement cashflow leg ──────────────────────────────────
    let legs
    if (inst === 'FRA') {
      legs = [{
        leg_ref: 'FRA-1', leg_seq: 1, leg_type: 'FRA',
        direction: dir, currency: ccy, notional,
        effective_date: effDate, maturity_date: matDate,
        day_count: fraDay || 'ACT/360',
        payment_frequency: 'ANNUAL',
        bdc: 'MOD_FOLLOWING', payment_lag: 0,
        fixed_rate: isNaN(rateVal) ? 0 : rateVal / 100,
        discount_curve_id: curveId,
        forecast_curve_id: forecastId,
      }]
    } else if (struct === 'BASIS') {
      // ── BASIS SWAP: two float legs, different indices ────────────────────
      const forecastId2 = INDEX_CURVE[index2] || curveId
      legs = [
        {
          leg_ref:'FLOAT-1', leg_seq:1, leg_type:'FLOAT',
          direction:dir, currency:ccy, notional,
          effective_date:effDate, maturity_date:matDate,
          day_count:floatDc, payment_frequency:floatPayFreq,
          reset_frequency:floatResetFreq,
          bdc:floatBdc, payment_lag:payLag,
          fixed_rate:0, spread:0, leverage:1.0,
          discount_curve_id:curveId, forecast_curve_id:forecastId,
          ois_compounding:null,
        },
        {
          leg_ref:'FLOAT-2', leg_seq:2, leg_type:'FLOAT',
          direction:dir==='PAY'?'RECEIVE':'PAY',
          currency:ccy, notional,
          effective_date:effDate, maturity_date:matDate,
          day_count:floatDc2, payment_frequency:floatPayFreq2,
          reset_frequency:floatResetFreq2,
          bdc:floatBdc, payment_lag:payLag,
          fixed_rate:0, spread:isNaN(spreadVal)?0:spreadVal, leverage:1.0,
          discount_curve_id:curveId, forecast_curve_id:forecastId2,
          ois_compounding:null,
        },
      ]
    } else {
      legs = [
        {
          leg_ref:'FIXED-1', leg_seq:1, leg_type: isZC ? 'ZERO_COUPON' : 'FIXED',
          direction:dir, currency:ccy, notional,
          effective_date:effDate, maturity_date:matDate,
          day_count:fixedDc, payment_frequency:fixedPayFreq,
          bdc:fixedBdc, payment_lag:payLag,
          fixed_rate: isNaN(rateVal) ? 0 : rateVal / 100,
          fixed_rate_schedule: rateSchedPrev.length > 0 ? rateSchedPrev : null,
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
    }

    const res = await fetch(API + '/price/preview', {
      method:'POST', headers:h,
      body: JSON.stringify({
        legs,
        valuation_date: valDate,
        curves: [curveObj(curveId)],
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
      method:'POST', headers:h, body: JSON.stringify({
        trade_id: viewTrade.id,
        valuation_date: valDate,
        curves: [curveObj(curveId)],
      }),
    })
    if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.detail||'Pricing failed') }
    return await res.json()
  }

  const handlePrice = async () => {
    setErr(''); setAnalyticsErr(null); setPricing(true); setAnalytics(null)
    const timeoutPromise = new Promise((_,reject) => setTimeout(() => reject(new Error('TIMEOUT')), 15000))
    try {
      const data = await Promise.race([
        viewTrade ? repriceExisting() : pricePreview(),
        timeoutPromise
      ])
      setAnalytics(data)
      setTimeout(()=>{ analyticsRef.current?.scrollIntoView({ behavior:'smooth', block:'nearest' }) }, 120)
    }
    catch(e) {
      if (e?.message === 'TIMEOUT') setAnalyticsErr('Pricing timed out — check backend connection')
      else setAnalyticsErr(e?.message||String(e))
    }
    finally { setPricing(false) }
  }
  // Helper: build curve input with selected interpolation method
  const curveObj = (curveId, quotes = []) => ({
    curve_id: curveId,
    quotes,
    interp_method: curveInterp?.[curveId] || 'LogLinearDiscount',
  })

  const handlePriceSwaption = async () => {
    setSwaptionPricing(true); setSwaptionErr(''); setSwaptionResult(null)
    try {
      const session = await getSession()
      const h = { Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' }
      const notional = parseFloat((notionalRef.current?.value||'10000000').replace(/,/g,'')) || 10000000
      // Strike: use dedicated swaptionStrike state — blank means ATM (backend computes forward)
      const strike = swaptionStrike.trim() ? parseFloat(swaptionStrike) / 100 : null
      const curveId  = CCY_CURVE[ccy] || 'USD_SOFR'
      // is_payer: PAY FIXED = Payer swaption (right to enter as fixed payer)
      const is_payer = dir === 'PAY'
      // Expiry in years
      const EXPIRY_Y = {'1M':1/12,'3M':0.25,'6M':0.5,'1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'10Y':10}
      const expiry_y = EXPIRY_Y[swaptionExpiry] || 1.0
      // Underlying tenor from main tenor selector
      const TENOR_Y  = {'1Y':1,'2Y':2,'3Y':3,'4Y':4,'5Y':5,'6Y':6,'7Y':7,'8Y':8,'9Y':9,'10Y':10,'12Y':12,'15Y':15,'20Y':20,'25Y':25,'30Y':30}
      const tenor_y  = TENOR_Y[tenor] || 5.0
      // Fee economics
      const feeAmt = feeAmount ? parseFloat(feeAmount) : 0
      const feeDlr = feeAmountType === 'BP' ? (feeAmt / 10000) * notional : feeAmt
      // Forward swap dates: shift effDate/matDate forward by expiry_y years
      // These carry the correct T+2 spot lag from the schedule calculation
      const fwdEffDate = (() => {
        const d = new Date(effDate)
        d.setDate(d.getDate() + Math.round(expiry_y * 365.25))
        return d.toISOString().slice(0,10)
      })()
      const fwdMatDate = (() => {
        const d = new Date(matDate)
        d.setDate(d.getDate() + Math.round(expiry_y * 365.25))
        return d.toISOString().slice(0,10)
      })()

      const res = await fetch(API + '/api/price/swaption', {
        method: 'POST', headers: h,
        body: JSON.stringify({
          notional, expiry_y, tenor_y,
          strike: strike || null,
          vol_bp: parseFloat(swaptionVol) || 86.5,
          is_payer,
          pay_freq_y: 1.0,
          valuation_date: valDate,
          effective_date: fwdEffDate,
          maturity_date:  fwdMatDate,
          curve_id: curveId,
          exercise_type: exerciseType,
        })
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Swaption pricing failed')
      setSwaptionResult({...d, fee_usd: feeDlr, pnl: d.npv - feeDlr})

      // ── Generate forward swap cashflow schedule ─────────────────────────────
      // The swaption delivers into a forward-starting swap on exercise.
      // Call /cashflows/generate with swaption_expiry_y to shift leg dates forward.
      // This populates the CASHFLOWS tab with the underlying swap's period schedule.
      if (viewTrade?.id) {
        try {
          const cfRes = await fetch(API + '/cashflows/generate', {
            method: 'POST', headers: h,
            body: JSON.stringify({
              trade_id: viewTrade.id,
              valuation_date: localDate(),
              curves: [curveObj(curveId)],
              swaption_expiry_y: expiry_y,
            }),
          })
          if (cfRes.ok) {
            // Re-fetch the price to get legs with cashflows populated
            const priceRes = await fetch(API + '/price', {
              method: 'POST', headers: h,
              body: JSON.stringify({
                trade_id: viewTrade.id,
                valuation_date: localDate(),
                curves: [curveObj(curveId)],
              }),
            })
            if (priceRes.ok) {
              const priceData = await priceRes.json()
              // Merge swaption analytics with IRS leg cashflows
              setAnalytics({
                ...priceData,
                npv: d.npv,
                ir01: d.ir01,
                ir01_disc: d.ir01,
                theta: d.theta,
                _swaption_cashflows: true,
              })
            } else {
              setAnalytics({ npv: d.npv, ir01: d.ir01, ir01_disc: d.ir01, theta: d.theta, legs: [] })
            }
          } else {
            setAnalytics({ npv: d.npv, ir01: d.ir01, ir01_disc: d.ir01, theta: d.theta, legs: [] })
          }
        } catch {
          setAnalytics({ npv: d.npv, ir01: d.ir01, ir01_disc: d.ir01, theta: d.theta, legs: [] })
        }
      } else {
        // ── Pre-trade: build forward swap legs and call /price/preview ────────
        // Shift effective and maturity dates forward by expiry_y years
        try {
          const fwdEff2 = new Date(effDate); fwdEff2.setDate(fwdEff2.getDate() + Math.round(expiry_y * 365.25))
          const fwdMat2 = new Date(matDate); fwdMat2.setDate(fwdMat2.getDate() + Math.round(expiry_y * 365.25))
          const fmt = dt => dt.toISOString().slice(0,10)

          const K = strike || d.forward_rate  // ATM strike from swaption result
          const fwdLegs = [
            { leg_ref:'FIXED-1', leg_seq:1, leg_type:'FIXED',
              direction: dir, currency: ccy, notional,
              effective_date: fmt(fwdEff2), maturity_date: fmt(fwdMat2),
              day_count: fixedDc, payment_frequency: fixedPayFreq,
              bdc: fixedBdc, payment_lag: 0,
              fixed_rate: K,
              discount_curve_id: curveId, forecast_curve_id: null },
            { leg_ref:'FLOAT-1', leg_seq:2, leg_type:'FLOAT',
              direction: dir==='PAY'?'RECEIVE':'PAY', currency: ccy, notional,
              effective_date: fmt(fwdEff2), maturity_date: fmt(fwdMat2),
              day_count: floatDc, payment_frequency: floatPayFreq,
              reset_frequency: 'DAILY', bdc: floatBdc, payment_lag: 0,
              fixed_rate: 0, spread: 0, leverage: 1.0,
              discount_curve_id: curveId, forecast_curve_id: curveId,
              ois_compounding: 'COMPOUNDING' },
          ]
          const previewRes = await fetch(API + '/price/preview', {
            method: 'POST', headers: h,
            body: JSON.stringify({ legs: fwdLegs, valuation_date: valDate, curves: [curveObj(curveId)] }),
          })
          if (previewRes.ok) {
            const previewData = await previewRes.json()
            setAnalytics({
              ...previewData,
              npv: d.npv,
              ir01: d.ir01,
              ir01_disc: d.ir01,
              theta: d.theta,
              _swaption_cashflows: true,
            })
          } else {
            setAnalytics({ npv: d.npv, ir01: d.ir01, ir01_disc: d.ir01, theta: d.theta, legs: [] })
          }
        } catch {
          setAnalytics({ npv: d.npv, ir01: d.ir01, ir01_disc: d.ir01, theta: d.theta, legs: [] })
        }
      }
    } catch(e) { setSwaptionErr(e.message) }
    finally { setSwaptionPricing(false) }
  }

  const handlePriceXva = async () => {
    setXvaPricing(true); setXvaErr(null)
    try {
      const session = await getSession()
      const n = parseFloat((notionalRef.current?.value||'10000000').replace(/,/g,''))
      const fr = parseFloat(rateRef.current?.value||'3.665') / 100
      const matY = (new Date(matDate)-new Date(effDate))/(365.25*24*3600*1000)
      const res = await fetch(API+'/api/xva/simulate', {
        method:'POST',
        headers:{ Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' },
        body: JSON.stringify(Object.assign(
          { notional:isNaN(n)?10000000:n, maturity_y:Math.max(0.5,matY), fixed_rate:isNaN(fr)?0.0365:fr, paths:2000 },
          // Swaption-specific fields — add expiry/vol/direction for 2-phase EE
          inst === 'IR_SWAPTION' ? (() => {
            const EXPIRY_Y = {'1M':1/12,'3M':0.25,'6M':0.5,'1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'10Y':10}
            const TENOR_Y  = {'1Y':1,'2Y':2,'3Y':3,'4Y':4,'5Y':5,'6Y':6,'7Y':7,'8Y':8,'9Y':9,'10Y':10,'12Y':12,'15Y':15,'20Y':20,'25Y':25,'30Y':30}
            return {
              instrument_type:    'IR_SWAPTION',
              swaption_expiry_y:  EXPIRY_Y[swaptionExpiry] || 1.0,
              swaption_tenor_y:   TENOR_Y[tenor] || 5.0,
              swaption_vol_bp:    parseFloat(swaptionVol) || 84.0,
              swaption_is_payer:  dir === 'PAY',
              direction:          dir === 'PAY' ? 'PAY' : 'RECEIVE',
              // Override maturity to full swaption life (expiry + tenor)
              maturity_y: (EXPIRY_Y[swaptionExpiry]||1) + (TENOR_Y[tenor]||5),
              // Strike: ATM forward if blank
              fixed_rate: swaptionResult?.forward_rate || isNaN(fr) ? 0.0365 : fr,
            }
          })() : {},
          typeof xvaParamsRef.current === 'function' ? xvaParamsRef.current() : (xvaParamsRef.current || {})
        ))
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail||'XVA failed')
      setXvaResult(d); setXvaApplied(false)
      try { sessionStorage.setItem('rijeka_xva_sim', JSON.stringify(d)) } catch(_) {}
    } catch(e) { setXvaErr(e.message) }
    finally { setXvaPricing(false) }
  }

  const handleApplyXvaToRate = () => {
    if (!xvaResult?.xva||!rateRef.current||xvaApplied) return
    const n = parseFloat((notionalRef.current?.value||'10000000').replace(/,/g,''))
    const matY = (new Date(matDate)-new Date(effDate))/(365.25*24*3600*1000)
    const dv = (isNaN(n)?10000000:n)*matY/10000
    const bp = [xvaResult.xva.cva,xvaResult.xva.dva,xvaResult.xva.fva,xvaResult.xva.fba,xvaResult.xva.kva,xvaResult.xva.mva].reduce((s,v)=>s+(v||0),0)/dv
    const cur = parseFloat(rateRef.current.value||'0')
    rateRef.current.value = (cur + bp/100).toFixed(6)
    rateRef.current.dataset.userEdited = '1'
    setXvaApplied(true)
    setRateMode('FIXED'); setAnalytics(null)
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
      {label}{!live&&<span style={{fontSize:'0.8125rem',marginLeft:'4px',color:'var(--text-dim)'}}>SOON</span>}
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
                <button onClick={handleViewTrade} style={{fontSize:'0.8125rem',fontWeight:700,padding:'2px 8px',borderRadius:'2px',cursor:'pointer',fontFamily:"'IBM Plex Mono',var(--mono)",background:'rgba(13,212,168,0.08)',border:'1px solid var(--accent)',color:'var(--accent)'}}>VIEW IN BLOTTER</button>
                <button onClick={handleNewTrade} style={{fontSize:'0.8125rem',fontWeight:700,padding:'2px 8px',borderRadius:'2px',cursor:'pointer',fontFamily:"'IBM Plex Mono',var(--mono)",background:'transparent',border:'1px solid var(--border)',color:'var(--text-dim)'}}>NEW TRADE</button>
              </>
            ) : viewTrade ? (
              <span style={{
                fontSize:'0.875rem',fontWeight:700,letterSpacing:'0.1em',
                padding:'2px 10px',borderRadius:'2px',fontFamily:"'IBM Plex Mono',var(--mono)",
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
          {[{id:'main',label:bookedTrade?'✓ TRADE':'TRADE'},...(inst==='IR_SWAPTION'?[{id:'options',label:'OPTIONS ANALYTICS'}]:[]),{id:'details',label:'DETAILS'},{id:'cashflows',label:'CASHFLOWS'},{id:'price',label:'XVA'},{id:'scenario',label:'CURVE SCENARIO'},{id:'confirm',label:'⯁ CONFIRM'}].map(t=>(
            <button key={t.id} className={'tbw-tab '+(activeTab===t.id?'active':'')}
              onClick={()=>setActiveTab(t.id)}
              style={t.id==='main'&&bookedTrade?{color:'var(--accent)'}:t.id==='options'?{color:'var(--blue)',borderBottomColor:activeTab==='options'?'var(--blue)':'transparent'}:{}}
            >{t.label}</button>
          ))}
        </div>
        {activeTab==='details' && (
          <LegDetailsTab
            struct={struct} dir={dir} floatDir={floatDir}
            ccy={ccy} index={index} effDate={effDate} matDate={matDate} valDate={valDate}
            notionalRef={notionalRef} rateRef={rateRef} spreadRef={spreadRef} parRate={parRate}
            fixedPayFreq={fixedPayFreq} fixedDc={fixedDc} fixedBdc={fixedBdc} fixedCal={fixedCal}
            floatPayFreq={floatPayFreq} floatDc={floatDc} floatBdc={floatBdc} floatCal={floatCal}
            floatResetFreq={floatResetFreq}
            zcToggle={zcToggle} setZcToggle={setZcToggle}
            rateSchedule={rateSchedule} setRateSchedule={setRateSchedule}
            notionalSchedule={notionalSchedule} setNotionalSchedule={setNotionalSchedule}
            spreadSchedule={spreadSchedule} setSpreadSchedule={setSpreadSchedule}
            deriveStructLabel={deriveStructLabel} getSession={getSession}
            index2={index2} floatDc2={floatDc2} floatPayFreq2={floatPayFreq2} floatResetFreq2={floatResetFreq2}
            inst={inst}
            feeSchedule={feeSchedule} setFeeSchedule={setFeeSchedule}
            feeAmount={feeAmount} feeAmountType={feeAmountType} feeSettleDate={feeSettleDate}
            exerciseType={exerciseType}
          />
        )}
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
            inst={inst}
            swaptionExpiry={swaptionExpiry}
            swaptionTenor={tenor}
            swaptionVol={swaptionVol}
            swaptionResult={swaptionResult}
          />
        )}
        <div className='tbw-body tbw-no-drag' style={{display:activeTab==='price'?'flex':'none',flexDirection:'column',overflow:'hidden'}}>
          {/* Swaption XVA context banner */}
          {inst==='IR_SWAPTION' && (
            <div style={{
              background:'rgba(74,158,255,0.05)',border:'1px solid rgba(74,158,255,0.2)',
              borderRadius:'2px',margin:'8px 12px 0',padding:'7px 12px',
              display:'flex',flexDirection:'column',gap:'3px',flexShrink:0,
            }}>
              <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                <span style={{fontSize:'0.6875rem',fontWeight:700,letterSpacing:'.12em',
                  color:'var(--blue)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>
                  SWAPTION XVA — 2-PHASE EE
                </span>
                <span style={{fontSize:'0.6875rem',padding:'1px 6px',borderRadius:'2px',
                  background:'rgba(74,158,255,0.1)',border:'1px solid rgba(74,158,255,0.3)',
                  color:'var(--blue)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>
                  {swaptionExpiry}×{tenor} · {dir==='PAY'?'Payer':'Receiver'}
                </span>
                <span style={{fontSize:'0.6875rem',color:'var(--text-dim)',
                  fontFamily:"'IBM Plex Mono',var(--mono)"}}>
                  Andersen-Piterbarg approximation · HW1F paths · {swaptionVol}bp Normal Vol
                </span>
              </div>
              <div style={{fontSize:'0.75rem',color:'var(--text-dim)',fontFamily:"'IBM Plex Mono',var(--mono)",lineHeight:1.6}}>
                <span style={{color:'var(--accent)'}}>Pre-expiry (0→{swaptionExpiry}):</span>
                {' '}EE = E[Bachelier(F(t),K,T_exp−t,σ)] on HW1F paths — option always ≥0, no negative exposure.
                &nbsp;·&nbsp;
                <span style={{color:'var(--blue)'}}>Post-expiry ({swaptionExpiry}→{swaptionExpiry}+{tenor}):</span>
                {' '}EE = E[max(IRS NPV,0) × 1(F(T_exp){dir==='PAY'?'>':'<'}K)] — exercised paths only.
              </div>
            </div>
          )}
          <XVATab trade={null} notionalRef={notionalRef} rateRef={rateRef} effDate={effDate} matDate={matDate} getSession={getSession} analytics={analytics} parRate={parRate} xvaParamsRef={xvaParamsRef} onSimResult={(d)=>{setXvaResult(d);setXvaApplied(false)}} direction={dir} instrumentType={inst} swaptionExpiry={swaptionExpiry} swaptionTenor={tenor} swaptionVol={swaptionVol} swaptionResult={swaptionResult}/>
        </div>
        {activeTab==='confirm' && <div className='tbw-body tbw-no-drag'><div className='tbw-stub'><div className='tbw-stub-title'>⯁ CONFIRM</div><div className='tbw-stub-sub'>Cashflow fingerprint · On-chain signing</div><div className='tbw-stub-sprint'>SPRINT 6A</div></div></div>}

        <div className='tbw-body tbw-no-drag' style={{display:activeTab==='price'?'flex':'none',flexDirection:'column',overflow:'hidden'}}>
          {/* Swaption XVA context banner */}
          {inst==='IR_SWAPTION' && (
            <div style={{
              background:'rgba(74,158,255,0.05)',border:'1px solid rgba(74,158,255,0.2)',
              borderRadius:'2px',margin:'8px 12px 0',padding:'7px 12px',
              display:'flex',flexDirection:'column',gap:'3px',flexShrink:0,
            }}>
              <div style={{display:'flex',alignItems:'center',gap:'8px',flexWrap:'wrap'}}>
                <span style={{fontSize:'0.6875rem',fontWeight:700,letterSpacing:'.12em',
                  color:'var(--blue)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>
                  SWAPTION XVA — 2-PHASE EE
                </span>
                <span style={{fontSize:'0.6875rem',padding:'1px 6px',borderRadius:'2px',
                  background:'rgba(74,158,255,0.1)',border:'1px solid rgba(74,158,255,0.3)',
                  color:'var(--blue)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>
                  {swaptionExpiry}×{tenor} · {dir==='PAY'?'Payer':'Receiver'}
                </span>
                <span style={{fontSize:'0.6875rem',color:'var(--text-dim)',
                  fontFamily:"'IBM Plex Mono',var(--mono)"}}>
                  Andersen-Piterbarg approximation · HW1F paths · {swaptionVol}bp Normal Vol
                </span>
              </div>
              <div style={{fontSize:'0.75rem',color:'var(--text-dim)',fontFamily:"'IBM Plex Mono',var(--mono)",lineHeight:1.6}}>
                <span style={{color:'var(--accent)'}}>Pre-expiry (0→{swaptionExpiry}):</span>
                {' '}EE = E[Bachelier(F(t),K,T_exp−t,σ)] on HW1F paths — option always ≥0, no negative exposure.
                &nbsp;·&nbsp;
                <span style={{color:'var(--blue)'}}>Post-expiry ({swaptionExpiry}→{swaptionExpiry}+{tenor}):</span>
                {' '}EE = E[max(IRS NPV,0) × 1(F(T_exp){dir==='PAY'?'>':'<'}K)] — exercised paths only.
              </div>
            </div>
          )}
          <XVATab trade={null} notionalRef={notionalRef} rateRef={rateRef} effDate={effDate} matDate={matDate} getSession={getSession} analytics={analytics} parRate={parRate} xvaParamsRef={xvaParamsRef} onSimResult={(d)=>{setXvaResult(d);setXvaApplied(false)}} direction={dir} instrumentType={inst} swaptionExpiry={swaptionExpiry} swaptionTenor={tenor} swaptionVol={swaptionVol} swaptionResult={swaptionResult}/>
        </div>
        {activeTab==='confirm' && <div className='tbw-body tbw-no-drag'><div className='tbw-stub'><div className='tbw-stub-title'>⯁ CONFIRM</div><div className='tbw-stub-sub'>Cashflow fingerprint · On-chain signing</div><div className='tbw-stub-sprint'>SPRINT 6A</div></div></div>}

        {/* ── OPTIONS ANALYTICS TAB ─────────────────────────────────── */}
        {activeTab==='options' && (
          <div className='tbw-no-drag' style={{flex:1,overflowY:'auto',padding:'10px 16px',display:'flex',flexDirection:'column',gap:'10px'}}>
            {!swaptionResult ? (
              <div style={{fontSize:'0.875rem',color:'var(--text-dim)',fontFamily:"'IBM Plex Mono',var(--mono)",padding:'12px 0'}}>
                Price the swaption first — go to TRADE tab and click ▶ PRICE.
              </div>
            ) : (
              <>
                {/* Identity strip */}
                <div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'0.6875rem',fontWeight:700,letterSpacing:'.08em',padding:'2px 7px',borderRadius:'2px',
                    background:'rgba(74,158,255,.1)',color:'var(--blue)',border:'1px solid rgba(74,158,255,.3)'}}>
                    {exerciseType} · {swaptionExpiry}×{tenor}
                  </span>
                  <span style={{fontSize:'0.6875rem',fontWeight:700,letterSpacing:'.06em',padding:'2px 7px',borderRadius:'2px',
                    background:dir==='PAY'?'rgba(255,107,107,.1)':'rgba(0,212,168,.1)',
                    color:dir==='PAY'?'var(--red)':'var(--accent)',
                    border:`1px solid ${dir==='PAY'?'rgba(255,107,107,.3)':'rgba(0,212,168,.3)'}`}}>
                    {dir==='PAY'?'PAYER':'RECEIVER'}
                  </span>
                  <span style={{fontSize:'0.6875rem',fontWeight:700,letterSpacing:'.06em',padding:'2px 7px',borderRadius:'2px',
                    background:'rgba(0,212,168,.06)',color:'var(--accent)',border:'1px solid rgba(0,212,168,.2)'}}>
                    PHYSICAL SETTLEMENT
                  </span>
                  <span style={{fontSize:'0.6875rem',padding:'2px 7px',borderRadius:'2px',color:'var(--text-dim)',
                    background:'rgba(255,255,255,.03)',border:'1px solid var(--border)'}}>
                    Normal vol {swaptionVol}bp
                  </span>
                  <span style={{marginLeft:'auto',fontSize:'0.6875rem',color:'var(--text-dim)',letterSpacing:'.06em'}}>
                    USD_SOFR · VAL {valDate}
                  </span>
                </div>

                {/* Primary option analytics */}
                <div>
                  <div style={{fontSize:'0.75rem',fontWeight:700,letterSpacing:'.12em',color:'var(--text-dim)',marginBottom:'6px'}}>OPTION ANALYTICS</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'1px',background:'var(--border)',border:'1px solid var(--border)',borderRadius:'2px',overflow:'hidden'}}>
                    {[
                      {l:'OPTION NPV',    v:swaptionResult.npv,           color:'var(--accent)', fmt:v=>(v>=0?'+':'')+' $'+Math.round(v).toLocaleString(), sub:`${(Math.abs(swaptionResult.npv)/parseFloat((notionalRef.current?.value||'10000000').replace(/,/g,''))*100).toFixed(3)}% of notional`},
                      {l:'VEGA / 1bp',    v:swaptionResult.vega,          color:'var(--blue)',   fmt:v=>(v>=0?'+':'')+' $'+Math.round(v).toLocaleString(), sub:`${swaptionResult.vega_pct_premium?.toFixed(2)}% of premium`},
                      {l:'IR01 (DELTA)',  v:swaptionResult.ir01,          color:'var(--blue)',   fmt:v=>(v>=0?'+':'')+' $'+Math.round(v).toLocaleString(), sub:`N(d) = ${swaptionResult.n_d?.toFixed(4)}`},
                      {l:'THETA / day',   v:swaptionResult.theta,         color:'var(--amber)',  fmt:v=>(v>=0?'+':'')+' $'+Math.round(v).toLocaleString(), sub:`${swaptionResult.theta!=null?(swaptionResult.theta/swaptionResult.npv*100).toFixed(3):'—'}% / day`},
                      {l:'FORWARD RATE',  v:swaptionResult.forward_pct,   color:'var(--accent)', fmt:v=>v.toFixed(4)+'%', sub:'ATM strike'},
                      {l:'MONEYNESS',     v:swaptionResult.moneyness_bp,  color:'var(--text-dim)', fmt:v=>`${Math.abs(v).toFixed(1)}bp ${v>=0?'ITM':'OTM'}`, sub:`d = ${swaptionResult.d?.toFixed(3)}`},
                    ].map(({l,v,color,fmt,sub})=>(
                      <div key={l} style={{background:'var(--bg)',padding:'8px 10px'}}>
                        <div style={{fontSize:'0.625rem',fontWeight:700,letterSpacing:'.10em',color:'var(--text-dim)',marginBottom:'3px'}}>{l}</div>
                        <div style={{fontSize:'0.9375rem',fontWeight:700,color,fontFamily:"'IBM Plex Mono',var(--mono)"}}>{v!=null?fmt(v):'—'}</div>
                        <div style={{fontSize:'0.6875rem',color:'var(--text-dim)',marginTop:'2px',opacity:.7}}>{sub}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Second-order sensitivities */}
                <div>
                  <div style={{fontSize:'0.75rem',fontWeight:700,letterSpacing:'.12em',color:'var(--text-dim)',marginBottom:'6px',display:'flex',alignItems:'center',gap:'8px'}}>
                    SECOND-ORDER SENSITIVITIES
                    <span style={{fontSize:'0.6875rem',color:'var(--blue)',fontWeight:400,letterSpacing:'.04em'}}>hover each for definition</span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'1px',background:'rgba(74,158,255,.15)',border:'1px solid rgba(74,158,255,.2)',borderRadius:'2px',overflow:'hidden'}}>
                    {[
                      {l:'VOLGA / (1bp)²',   v:swaptionResult.volga,             color:'var(--blue)',    fmt:v=>(v>=0?'+':'')+' $'+Math.abs(v).toFixed(2), sub:'vol convexity',    tip:'∂²V/∂σ². ATM=0, grows with moneyness. Long on every long option.'},
                      {l:'VANNA / (bp×bp)',   v:swaptionResult.vanna,             color:'var(--blue)',    fmt:v=>(v>=0?'+':'')+' $'+Math.abs(v).toFixed(2), sub:'rate-vol cross',   tip:'∂²V/∂F∂σ. P&L when rates and vol move together. Dominant risk in stress regimes.'},
                      {l:'$ GAMMA / (1bp)²',  v:swaptionResult.dollar_gamma,     color:'var(--blue)',    fmt:v=>'$'+Math.abs(v).toFixed(2),                 sub:'rate convexity',   tip:'½∂²V/∂F². P&L from rate convexity per 1bp² move.'},
                      {l:'B/E VOL bp/day',    v:swaptionResult.break_even_vol_bp,
                        color:swaptionResult.break_even_vol_bp<2?'var(--accent)':'var(--amber)',
                        fmt:v=>v.toFixed(2)+'bp', sub:swaptionResult.break_even_vol_bp<2?'cheap ← <2bp':'expensive → >2bp',
                        tip:'|Theta|/Vega. Vol must move this much daily to cover decay. <2bp = cheap.'},
                      {l:'Δ HEDGE NOTIONAL',  v:swaptionResult.delta_hedge_notl,  color:'var(--text-dim)', fmt:v=>'$'+Math.round(v/1e6*10)/10+'M IRS',       sub:'to go delta-flat',  tip:'IRS notional to delta-neutralize. Enter opposite-direction IRS of this size.'},
                      {l:'VEGA % PREMIUM',    v:swaptionResult.vega_pct_premium,  color:'var(--blue)',    fmt:v=>v.toFixed(2)+'%',                            sub:'normalized vega',  tip:'Vega as % of option premium. Normalized across strikes and tenors for comparison.'},
                    ].map(({l,v,color,fmt,sub,tip})=>(
                      <div key={l} style={{background:'var(--bg)',padding:'7px 10px',cursor:'help'}} title={tip}>
                        <div style={{fontSize:'0.5625rem',fontWeight:700,letterSpacing:'.08em',color:'var(--blue)',marginBottom:'2px',lineHeight:1.3}}>{l}</div>
                        <div style={{fontSize:'0.875rem',fontWeight:700,color,fontFamily:"'IBM Plex Mono',var(--mono)"}}>{v!=null?fmt(v):'—'}</div>
                        <div style={{fontSize:'0.6875rem',color:'var(--text-dim)',marginTop:'2px',opacity:.7}}>{sub}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* HW1F cross-check */}
                {/* Vol source tier badge */}
                {swaptionResult.vol_tier && swaptionResult.vol_tier !== 'MANUAL' && (
                  <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'4px'}}>
                    <span style={{fontSize:'0.6875rem',fontWeight:700,letterSpacing:'.10em',color:'var(--text-dim)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>
                      VOL SOURCE
                    </span>
                    {[{tier:'QUOTED',  color:'var(--accent)', bg:'rgba(13,212,168,0.08)',  bd:'rgba(13,212,168,0.3)',  desc:'Market quote — Bloomberg SMKO snap'},
                      {tier:'AUTO',    color:'var(--accent)', bg:'rgba(13,212,168,0.08)',  bd:'rgba(13,212,168,0.3)',  desc:'SABR calibrated from market quotes'},
                      {tier:'INTERPOLATED', color:'var(--amber)', bg:'rgba(245,200,66,0.08)', bd:'rgba(245,200,66,0.3)', desc:'SABR bilinear interpolation — no market data for this bucket'},
                      {tier:'MANUAL',  color:'var(--text-dim)', bg:'transparent', bd:'var(--border)', desc:'User-entered vol — no surface loaded'},
                    ].filter(t => t.tier === (swaptionResult.vol_tier==='AUTO'?'AUTO':swaptionResult.vol_tier)).map(t => (
                      <span key={t.tier} title={t.desc} style={{
                        fontSize:'0.75rem',fontWeight:700,letterSpacing:'.08em',
                        padding:'2px 8px',borderRadius:'2px',
                        color:t.color,background:t.bg,border:`1px solid ${t.bd}`,
                        fontFamily:"'IBM Plex Mono',var(--mono)",cursor:'help',
                      }}>{t.tier==='AUTO'?'SABR QUOTED':t.tier==='INTERPOLATED'?'SABR INTERP':t.tier}</span>
                    ))}
                    {swaptionResult.sabr_vol_bp && (
                      <span style={{fontSize:'0.875rem',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--text-dim)'}}>
                        σ(K) = <strong style={{color:swaptionResult.vol_tier==='INTERPOLATED'?'var(--amber)':'var(--accent)'}}>{swaptionResult.sabr_vol_bp.toFixed(2)}bp</strong>
                        <span style={{fontSize:'0.75rem',color:'var(--text-dim)',marginLeft:'4px'}}>
                          vs ATM {swaptionResult.vol_bp?.toFixed(1)}bp
                          ({swaptionResult.sabr_vol_bp > swaptionResult.vol_bp ? '+' : ''}{(swaptionResult.sabr_vol_bp - swaptionResult.vol_bp)?.toFixed(2)}bp smile adj)
                        </span>
                      </span>
                    )}
                  </div>
                )}
                {swaptionResult.hw1f_vol_bp && (
                  <div style={{border:'1px solid rgba(74,158,255,.15)',borderRadius:'2px',background:'rgba(74,158,255,.02)',
                    padding:'8px 12px',display:'flex',gap:'16px',alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{fontSize:'0.6875rem',fontWeight:700,letterSpacing:'.10em',color:'var(--text-dim)'}}>HW1F CROSS-CHECK</span>
                    <span style={{fontSize:'0.875rem',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--blue)'}}>
                      Model: <strong style={{color:'var(--text)'}}>{swaptionResult.hw1f_vol_bp.toFixed(1)}bp</strong>
                    </span>
                    <span style={{fontSize:'0.875rem',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--text-dim)'}}>
                      Mkt: <strong style={{color:'var(--text)'}}>{swaptionResult.vol_bp.toFixed(1)}bp</strong>
                    </span>
                    <span style={{fontSize:'0.875rem',fontFamily:"'IBM Plex Mono',var(--mono)",
                      color:Math.abs(swaptionResult.hw1f_error_bp)<2?'var(--accent)':'var(--amber)'}}>
                      Δ {swaptionResult.hw1f_error_bp>0?'+':''}{swaptionResult.hw1f_error_bp.toFixed(2)}bp
                      {Math.abs(swaptionResult.hw1f_error_bp)<2?' ✓':' ⚠'}
                    </span>
                    {swaptionResult.hw1f_npv!=null && (
                      <span style={{marginLeft:'auto',fontSize:'0.875rem',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--blue)'}}>
                        HW1F NPV: {swaptionResult.hw1f_npv>=0?'+':''} ${Math.round(swaptionResult.hw1f_npv).toLocaleString()}
                      </span>
                    )}
                    <span style={{fontSize:'0.75rem',color:'var(--text-dim)'}}>
                      a={swaptionResult.hw1f_params?.a?.toFixed(4)} · σ={swaptionResult.hw1f_params?.sigma_bp?.toFixed(1)}bp
                    </span>
                  </div>
                )}

                {/* Theta decay profile */}
                <div>
                  <div style={{fontSize:'0.75rem',fontWeight:700,letterSpacing:'.12em',color:'var(--text-dim)',marginBottom:'6px'}}>
                    THETA DECAY PROFILE — time value remaining
                  </div>
                  <div style={{border:'1px solid var(--border)',borderRadius:'2px',background:'#0D0F17',overflow:'hidden',height:'90px'}}>
                    <SwaptionDecayChart result={swaptionResult} expiry={swaptionExpiry}/>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab==='cashflows' && (
          <div className='tbw-no-drag' style={{flex:1,overflowY:'auto',padding:'10px 16px',display:'flex',flexDirection:'column',gap:'10px'}}>
            {!analytics ? (
              <div style={{fontSize:'0.875rem',color:'var(--text-dim)',fontFamily:"'IBM Plex Mono',var(--mono)",padding:'12px 0'}}>Price the trade first to view cashflow schedule.</div>
            ) : (
              <>
                {/* ── Swaption context banner ─────────────────────────── */}
                {inst==='IR_SWAPTION' && (
                  <div style={{background:'rgba(74,158,255,0.05)',border:'1px solid rgba(74,158,255,0.2)',borderRadius:'2px',padding:'8px 12px',display:'flex',flexDirection:'column',gap:'3px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                      <span style={{fontSize:'0.6875rem',fontWeight:700,letterSpacing:'.12em',color:'var(--blue)'}}>UNDERLYING FORWARD SWAP CASHFLOWS</span>
                      <span style={{fontSize:'0.6875rem',padding:'1px 6px',borderRadius:'2px',background:'rgba(74,158,255,0.1)',border:'1px solid rgba(74,158,255,0.3)',color:'var(--blue)'}}>
                        {swaptionExpiry}×{tenor} · Physical Settlement
                      </span>
                    </div>
                    <div style={{fontSize:'0.8125rem',color:'var(--text-dim)',letterSpacing:'.03em'}}>
                      On exercise, this swaption delivers into the swap schedule below.
                      Effective date shifts forward by {swaptionExpiry} from today.
                      Sum of PV column = forward swap NPV (= $0 at ATM strike).
                      Annuity = Σ (DCF × DF) = {analytics.legs?.find(l=>l.leg_type==='FIXED')?.cashflows
                        ?.reduce((s,cf)=>s+(cf.dcf||1)*(cf.df||1),0)?.toFixed(6) || '—'}.
                    </div>
                  </div>
                )}
                <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'6px'}}>
                  {[
                    {label: inst==='IR_SWAPTION' ? 'OPTION NPV' : 'NET NPV',
                     val: fmtPnl(npv),
                     color: npv!=null&&npv>=0?'var(--accent)':'var(--red)'},
                    {label: inst==='IR_SWAPTION' ? 'FWD FIXED LEG PV' : 'FIXED LEG PV',
                     val: fmtPnl(inst==='FRA' ? null : legs.find(l=>l.leg_type==='FIXED')?(legs.find(l=>l.leg_type==='FIXED').pv):null),
                     color:'var(--red)'},
                    {label: inst==='IR_SWAPTION' ? 'FWD FLOAT LEG PV' : (inst==='FRA' ? 'FRA LEG PV' : 'FLOAT LEG PV'),
                     val: fmtPnl(inst==='FRA' ? legs.find(l=>l.leg_type==='FRA')?.pv : legs.find(l=>l.leg_type==='FLOAT')?(legs.find(l=>l.leg_type==='FLOAT').pv):null),
                     color:'var(--accent)'},
                    {label:'PERIODS',
                     val:(legs.find(l=>l.leg_type==='FIXED')?((legs.find(l=>l.leg_type==='FIXED').cashflows||[]).length):0)+' + '+(legs.find(l=>l.leg_type==='FLOAT')?((legs.find(l=>l.leg_type==='FLOAT').cashflows||[]).length):0),
                     color:'var(--blue)'},
                  ].map(s=>(
                    <div key={s.label} style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',padding:'6px 8px'}}>
                      <div style={{fontSize:'0.875rem',color:'var(--text-dim)',letterSpacing:'0.08em',marginBottom:'2px'}}>{s.label}</div>
                      <div style={{fontSize:'0.9375rem',fontWeight:700,fontFamily:"'IBM Plex Mono',var(--mono)",color:s.color}}>{s.val}</div>
                    </div>
                  ))}
                </div>
                {legs.map((leg,li)=>(
                  <div key={li}>
                    <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'6px 0 4px',borderBottom:'1px solid var(--border)',marginBottom:'0'}}>
                      <span style={{fontSize:'0.8125rem',fontWeight:700,letterSpacing:'0.12em',color:'var(--text-dim)'}}>{leg.leg_type} LEG</span>
                      <span style={{fontSize:'0.875rem',fontWeight:700,padding:'1px 6px',borderRadius:'2px',
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
                              <th key={h} style={{fontSize:'0.875rem',color:'var(--text-dim)',padding:'4px 6px',
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
                                <td style={{fontSize:'0.8125rem',padding:'5px 6px',color:'var(--text-dim)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>{fmtDate(cf.period_start)}</td>
                                <td style={{fontSize:'0.8125rem',padding:'5px 6px',color:'var(--text-dim)',fontFamily:"'IBM Plex Mono',var(--mono)"}}>{fmtDate(cf.period_end)}</td>
                                <td style={{fontSize:'0.8125rem',padding:'5px 6px',fontFamily:"'IBM Plex Mono',var(--mono)",
                                  color: cf.payment_date!==cf.period_end?'var(--amber)':'var(--text-dim)'}}>{fmtDate(cf.payment_date)}</td>
                                <td style={{fontSize:'0.8125rem',padding:'5px 6px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--blue)'}}>{cf.dcf!=null?cf.dcf.toFixed(5):'—'}</td>
                                <td style={{fontSize:'0.8125rem',padding:'5px 6px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--text-dim)'}}>{fmtN(cf.notional)}</td>
                                <td style={{fontSize:'0.8125rem',padding:'5px 6px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--blue)'}}>{cf.rate!=null?(cf.rate*100).toFixed(4)+'%':'—'}</td>
                                <td style={{fontSize:'0.8125rem',padding:'5px 6px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--text)'}}>{fmtN(cf.amount)}</td>
                                <td style={{fontSize:'0.8125rem',padding:'5px 6px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--text-dim)'}}>{cf.df!=null?cf.df.toFixed(5):'—'}</td>
                                <td style={{fontSize:'0.875rem',padding:'5px 6px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",fontWeight:600,
                                  color:pv>=0?'var(--accent)':'var(--red)'}}>{fmtPnl(pv)}</td>
                                <td style={{fontSize:'0.8125rem',padding:'5px 6px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--text-dim)'}}>{cf.zero_rate!=null?(cf.zero_rate*100).toFixed(3):'—'}</td>
                              </tr>
                            )
                          })}
                          <tr style={{borderTop:'2px solid var(--border)',background:'rgba(255,255,255,0.02)'}}>
                            <td colSpan={6} style={{fontSize:'0.8125rem',fontWeight:700,color:'var(--text-dim)',padding:'5px 6px',letterSpacing:'0.08em'}}>TOTAL</td>
                            <td style={{fontSize:'0.875rem',fontWeight:700,padding:'5px 6px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--text)'}}>
                              {Math.round((leg.cashflows||[]).reduce((s,cf)=>s+(cf.amount||0),0)).toLocaleString('en-US')}
                            </td>
                            <td/>
                            <td style={{fontSize:'0.875rem',fontWeight:700,padding:'5px 6px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",
                              color:leg.pv>=0?'var(--accent)':'var(--red)'}}>{fmtPnl(leg.pv)}</td>
                            <td/>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                <div style={{fontSize:'0.8125rem',color:'var(--text-dim)',fontFamily:"'IBM Plex Mono',var(--mono)",padding:'4px 0'}}>
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
                <span style={{fontSize:'0.875rem',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--accent)'}}>✓ {bookedTrade.trade_ref||bookedTrade.id}</span>
                <button onClick={()=>navigator.clipboard.writeText(String(bookedTrade.trade_ref||bookedTrade.id))} style={{fontSize:'0.8125rem',color:'var(--text-dim)',background:'transparent',border:'1px solid var(--border)',borderRadius:'2px',padding:'2px 6px',cursor:'pointer',fontFamily:"'IBM Plex Mono',var(--mono)"}}>COPY</button>
              </div>
            )}
            <SectionHdr mt={0}>INSTRUMENT</SectionHdr>
            <div className='tbw-chip-row'>
              {ASSET_CLASSES.map(a=><Chip key={a} label={a} active={ac===a} live={LIVE_AC.includes(a)} onClick={()=>{setAc(a);setInst(INSTRUMENTS[a][0])}}/>)}
            </div>
            <div className='tbw-chip-row' style={{marginTop:'3px'}}>
              {(INSTRUMENTS[ac]||[]).map(i=><Chip key={i} label={i.replace(/_/g,' ')} active={inst===i} live={(LIVE_INST[ac]||[]).includes(i)} onClick={()=>{ setInst(i); if(i==='FRA'){ setParRate(null); if(rateRef.current){ rateRef.current.value=''; rateRef.current.dataset.userEdited='' } } }}/>)}
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
              <Fld label='NOTIONAL' flex={2.5}><input ref={notionalRef} style={{...inp,fontSize:'1.0625rem',fontWeight:700}} type='text' value={notionalState.toLocaleString('en-US')} placeholder='10,000,000' autoComplete='off' onChange={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))setNotionalState(r)}} onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))setNotionalState(r)}}/></Fld>
              <Fld label='CCY' flex={0.9}><select style={{...sel,fontSize:'1.0625rem',fontWeight:700}} value={ccy} onChange={e=>setCcy(e.target.value)}>{CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}</select></Fld>
              <Fld label='DIRECTION' flex={1.8}>
                <div style={{display:'flex',gap:'5px',minHeight:'34px'}}>
                  <DirBtn label={struct==='BASIS'?'PAY LEG 1':'PAY FIXED'}         active={dir==='PAY'}     color='var(--red)'    onClick={()=>setDir('PAY')}/>
                  <DirBtn label={struct==='BASIS'?'RECEIVE LEG 1':'RECEIVE FIXED'} active={dir==='RECEIVE'} color='var(--accent)' onClick={()=>setDir('RECEIVE')}/>
                </div>
              </Fld>
              <Fld label='TENOR' flex={1.0}><select style={{...sel,fontSize:'1.0625rem',fontWeight:700}} value={tenor} onChange={e=>handleTenorChange(e.target.value)}>{TENORS.map(t=><option key={t} value={t}>{t}</option>)}</select></Fld>
              <Fld label={'EFF DATE'+(datesLoading?' ⟳':'')} flex={1.5}><input style={{...inp,fontSize:'1rem',color:datesLoading?'var(--text-dim)':'var(--text)'}} type='date' value={effDate} onChange={e=>setEffDate(e.target.value)}/></Fld>
              <Fld label={'MAT DATE'+(datesLoading?' ⟳':'')} flex={1.5}><input style={{...inp,fontSize:'1rem',color:datesLoading?'var(--text-dim)':'var(--text)'}} type='date' value={matDate} onChange={e=>setMatDate(e.target.value)}/></Fld>
            </Row>
            {inst === 'IR_SWAPTION' && (
              <>
                {/* ── SWAPTION EXERCISE TERMS ── addon on top of swap legs ── */}
                <SectionHdr>
                  OPTION TERMS
                  <Badge
                    label={dir==='PAY' ? '→ PAYER (right to pay fixed)' : '← RECEIVER (right to receive fixed)'}
                    color={dir==='PAY' ? 'var(--red)' : 'var(--accent)'}
                  />
                </SectionHdr>
                <Row>
                  {/* Exercise type */}
                  <Fld label='EXERCISE TYPE' flex={1.6}>
                    <div style={{display:'flex',gap:'5px',height:'34px'}}>
                      {['EUROPEAN','BERMUDAN','AMERICAN'].map(t=>(
                        <DirBtn key={t} label={t} active={exerciseType===t} color='var(--blue)'
                          onClick={()=>setExerciseType(t)}/>
                      ))}
                    </div>
                  </Fld>
                  {/* Expiry — varies by exercise type */}
                  {exerciseType === 'EUROPEAN' && (
                    <Fld label='OPTION EXPIRY' flex={1.0}>
                      <select style={{...sel,fontSize:'1.0625rem',fontWeight:700}}
                        value={swaptionExpiry} onChange={e=>setSwaptionExpiry(e.target.value)}>
                        {['1M','3M','6M','1Y','2Y','3Y','5Y','7Y','10Y'].map(t=><option key={t}>{t}</option>)}
                      </select>
                    </Fld>
                  )}
                  {exerciseType === 'BERMUDAN' && (<>
                    <Fld label='FIRST EXERCISE' flex={1.0}>
                      <input type='date' style={{...inp,fontSize:'0.9375rem'}}
                        value={bermudanFirst} onChange={e=>setBermudanFirst(e.target.value)}/>
                    </Fld>
                    <Fld label='LAST EXERCISE' flex={1.0}>
                      <input type='date' style={{...inp,fontSize:'0.9375rem'}}
                        value={bermudanLast} onChange={e=>setBermudanLast(e.target.value)}/>
                    </Fld>
                    <Fld label='FREQ' flex={0.6}>
                      <select style={sel} value={bermudanFreq} onChange={e=>setBermudanFreq(e.target.value)}>
                        {['1M','3M','6M','1Y'].map(t=><option key={t}>{t}</option>)}
                      </select>
                    </Fld>
                  </>)}
                  {exerciseType === 'AMERICAN' && (<>
                    <Fld label='EXERCISE START' flex={1.0}>
                      <input type='date' style={{...inp,fontSize:'0.9375rem'}}
                        value={bermudanFirst} onChange={e=>setBermudanFirst(e.target.value)}/>
                    </Fld>
                    <Fld label='EXERCISE END' flex={1.0}>
                      <input type='date' style={{...inp,fontSize:'0.9375rem'}}
                        value={bermudanLast} onChange={e=>setBermudanLast(e.target.value)}/>
                    </Fld>
                  </>)}
                  {/* Normal vol — always shown */}
                  <Fld label='NORMAL VOL (bp)' flex={0.9}>
                    <input style={{...inp,fontSize:'1.0625rem',fontWeight:700,color:'var(--blue)',borderColor:'rgba(74,158,255,0.4)'}}
                      type='text' value={swaptionVol} placeholder='86.5'
                      onChange={e=>setSwaptionVol(e.target.value)} autoComplete='off'/>
                  </Fld>
                  {/* Strike — blank = ATM */}
                  <Fld label='STRIKE (%) blank=ATM' flex={1.1}>
                    <input
                      style={{...inp,fontSize:'1.0625rem',fontWeight:700,color:'var(--amber)',
                        borderColor:swaptionStrike?'rgba(240,160,32,0.5)':'var(--border)'}}
                      type='text'
                      value={swaptionStrike}
                      placeholder={swaptionResult ? swaptionResult.forward_pct?.toFixed(4) : 'ATM'}
                      autoComplete='off'
                      onChange={e=>setSwaptionStrike(e.target.value)}
                    />
                  </Fld>
                </Row>
                <div style={{fontSize:'0.6875rem',color:'var(--text-dim)',padding:'2px 0 4px',letterSpacing:'0.06em',opacity:0.6}}>
                  {exerciseType==='EUROPEAN'?'Black/Bachelier normal vol · HW1F cross-check':exerciseType==='BERMUDAN'?'HW1F trinomial tree — Sprint 8':'American approximation — Sprint 8'}
                  {' · Physical settlement · Strike blank = ATM forward (computed from OIS curve)'}
                  {swaptionResult && !swaptionStrike && ` · ATM = ${swaptionResult.forward_pct?.toFixed(4)}%`}
                </div>

                {/* ── OPTION FEE ────────────────────────────────────────────── */}
                <SectionHdr>
                  OPTION FEE
                  <span style={{fontSize:'0.6875rem',color:'var(--text-dim)',fontWeight:400,letterSpacing:'0.04em',marginLeft:'8px'}}>
                    {feeAmount ? (feeAmountType==='BP' ? `${feeAmount}bp upfront` : `$${parseFloat(feeAmount).toLocaleString()} upfront`) : 'no premium entered'}
                    {feeSchedule.filter(r=>r.date&&r.amount).length > 0 && ` · ${feeSchedule.filter(r=>r.date&&r.amount).length} scheduled payments`}
                  </span>
                  <span style={{marginLeft:'auto',fontSize:'0.6875rem',color:'var(--accent)',letterSpacing:'0.04em',cursor:'pointer'}}
                    onClick={()=>{ /* switch to details tab handled by parent */ }}>
                    full schedule → DETAILS tab
                  </span>
                </SectionHdr>
                <Row>
                  <Fld label='PREMIUM AMOUNT' flex={1.2}>
                    <div style={{display:'flex',gap:'4px',height:'34px'}}>
                      <input style={{...inp,fontSize:'1.0625rem',fontWeight:700,color:'var(--amber)',flex:1}}
                        type='text' value={feeAmount} placeholder='0.00'
                        onChange={e=>setFeeAmount(e.target.value)} autoComplete='off'/>
                      <div style={{display:'flex',gap:'2px'}}>
                        {['BP','$'].map(t=>(
                          <DirBtn key={t} label={t} active={feeAmountType===t} color='var(--amber)'
                            onClick={()=>setFeeAmountType(t)}/>
                        ))}
                      </div>
                    </div>
                  </Fld>
                  <Fld label='SETTLE DATE' flex={1.0}>
                    <input type='date' style={{...inp,fontSize:'0.9375rem'}}
                      value={feeSettleDate} onChange={e=>setFeeSettleDate(e.target.value)}/>
                  </Fld>
                  <Fld label='' flex={1.6}>
                    <div style={{height:'34px',display:'flex',alignItems:'center',
                      fontSize:'0.75rem',color:'var(--text-dim)',letterSpacing:'0.06em'}}>
                      Multi-payment schedule available in DETAILS tab
                    </div>
                  </Fld>
                </Row>

                {/* ── Swaption analytics ────────────────────────────────────── */}
                {swaptionResult && (
                  <div style={{marginTop:'8px',border:'1px solid var(--border)',borderRadius:'2px',overflow:'hidden'}}>
                    {/* ── Primary analytics grid ─────────────────────────── */}
                    <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'1px',background:'var(--border)'}}>
                      {[
                        {l:'OPTION NPV',   v:swaptionResult.npv,         color:'var(--accent)', fmt:v=>(v>=0?'+':'')+' $'+Math.round(v).toLocaleString()},
                        {l:'PREMIUM PAID', v:swaptionResult.fee_usd||0,  color:'var(--amber)',  fmt:v=>v?'-$'+Math.round(Math.abs(v)).toLocaleString():'—'},
                        {l:'P&L',          v:swaptionResult.pnl,         color:(swaptionResult.pnl||0)>=0?'var(--accent)':'var(--red)', fmt:v=>(v>=0?'+':'')+' $'+Math.round(v).toLocaleString()},
                        {l:'VEGA / 1bp',   v:swaptionResult.vega,        color:'var(--blue)',   fmt:v=>(v>=0?'+':'')+' $'+Math.round(v).toLocaleString()},
                        {l:'IR01',         v:swaptionResult.ir01,        color:'var(--blue)',   fmt:v=>(v>=0?'+':'')+' $'+Math.round(v).toLocaleString()},
                        {l:'FWD RATE',     v:swaptionResult.forward_pct, color:'var(--accent)', fmt:v=>v.toFixed(4)+'%'},
                      ].map(({l,v,color,fmt})=>(
                        <div key={l} style={{background:'var(--bg)',padding:'7px 10px'}}>
                          <div style={{fontSize:'0.625rem',fontWeight:700,letterSpacing:'.10em',color:'var(--text-dim)',marginBottom:'3px'}}>{l}</div>
                          <div style={{fontSize:'0.875rem',fontWeight:700,color,fontFamily:"'IBM Plex Mono',var(--mono)"}}>{v!=null?fmt(v):'—'}</div>
                        </div>
                      ))}
                    </div>

                    {/* ── HW1F cross-check ──────────────────────────────── */}
                    {swaptionResult.hw1f_vol_bp && (
                      <div style={{background:'rgba(74,158,255,0.03)',padding:'5px 10px',borderTop:'1px solid var(--border)',
                        display:'flex',gap:'16px',alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{fontSize:'0.6875rem',fontWeight:700,letterSpacing:'0.10em',color:'var(--text-dim)'}}>HW1F CROSS-CHECK</span>
                        <span style={{fontSize:'0.8125rem',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--blue)'}}>
                          Model: {swaptionResult.hw1f_vol_bp.toFixed(1)}bp
                        </span>
                        <span style={{fontSize:'0.8125rem',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--text-dim)'}}>
                          Mkt: {swaptionResult.vol_bp.toFixed(1)}bp
                        </span>
                        <span style={{fontSize:'0.8125rem',fontFamily:"'IBM Plex Mono',var(--mono)",
                          color:Math.abs(swaptionResult.hw1f_error_bp)<2?'var(--accent)':'var(--amber)'}}>
                          Δ {swaptionResult.hw1f_error_bp>0?'+':''}{swaptionResult.hw1f_error_bp.toFixed(2)}bp
                          {Math.abs(swaptionResult.hw1f_error_bp)<2?' ✓':' ⚠'}
                        </span>
                        {swaptionResult.hw1f_npv!=null && (
                          <span style={{marginLeft:'auto',fontSize:'0.8125rem',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--blue)'}}>
                            HW1F: {swaptionResult.hw1f_npv>=0?'+':''} ${Math.round(swaptionResult.hw1f_npv).toLocaleString()}
                          </span>
                        )}
                      </div>
                    )}
                    {swaptionErr && <div style={{padding:'5px 10px',color:'var(--red)',fontSize:'0.8125rem'}}>{swaptionErr}</div>}
                  </div>
                )}
                {swaptionErr && !swaptionResult && (
                  <div style={{color:'var(--red)',fontSize:'0.8125rem',padding:'4px 0'}}>{swaptionErr}</div>
                )}
              </>
            )}
            {inst === 'FRA' ? (
              <>
                {/* ── FRA TERMS — single settlement cashflow ─────────────────── */}
                <SectionHdr>
                  FRA TERMS
                  <Badge label={dir==='PAY'?'→ PAY FRA RATE (short rate)':'← RECEIVE FRA RATE (long rate)'} color={dir==='PAY'?'var(--red)':'var(--accent)'}/>
                </SectionHdr>
                <Row>
                  <Fld label='CONTRACT RATE (%)' flex={1.6}>
                    <input ref={rateRef}
                      style={{...inp,fontSize:'1.0625rem',fontWeight:700,color:'var(--amber)',borderColor:'rgba(240,160,32,0.4)'}}
                      type='text' placeholder='0.000000 — at-market = 0' autoComplete='off'
                      defaultValue=''
                      onChange={e=>{ if(rateRef.current) rateRef.current.dataset.userEdited='1' }}
                    />
                  </Fld>
                  <Fld label='REFERENCE INDEX' flex={1.6}>
                    <select style={{...sel,fontSize:'1rem',fontWeight:600}} value={index} onChange={e=>handleIndexChange(e.target.value)}>
                      {(CCY_INDICES[ccy]||[]).map(idx=><option key={idx} value={idx}>{idx}</option>)}
                    </select>
                  </Fld>
                  <Fld label='DAY COUNT' flex={1.3}>
                    <select style={sel} value={fraDay} onChange={e=>setFraDay(e.target.value)}>
                      {DAY_COUNTS.map(d=><option key={d} value={d}>{d}</option>)}
                    </select>
                  </Fld>
                </Row>
                <div style={{fontSize:'0.75rem',color:'var(--text-dim)',fontFamily:"'IBM Plex Sans',var(--sans)",padding:'4px 0 2px',opacity:0.7}}>
                  Eff Date = Ts (fixing/settlement) · Mat Date = Te (accrual end) · NPV = N × (fwd − K) × δ × P(0,Te)
                </div>
              </>
            ) : (
              <>
                {struct === 'BASIS' ? (
                  <>
                    {/* ── BASIS SWAP: FLOAT LEG 1 ─────────────────────────────── */}
                    <SectionHdr>
                      FLOAT LEG 1
                      <Badge label={dir==='PAY'?'→ PAY':'← RECEIVE'} color={dir==='PAY'?'var(--red)':'var(--accent)'}/>
                    </SectionHdr>
                    <Row>
                      <Fld label='INDEX 1' flex={1.8}><select style={{...sel,fontSize:'1rem',fontWeight:600}} value={index} onChange={e=>handleIndexChange(e.target.value)}>{(CCY_INDICES[ccy]||[]).map(idx=><option key={idx} value={idx}>{idx}</option>)}</select></Fld>
                      <Fld label='RESET FREQ' flex={1.4}><select style={sel} value={floatResetFreq} onChange={e=>setFloatResetFreq(e.target.value)}>{RESET_FREQS.map(f=><option key={f} value={f}>{f}</option>)}</select></Fld>
                      <Fld label='PAY FREQ' flex={1.4}><select style={sel} value={floatPayFreq} onChange={e=>setFloatPayFreq(e.target.value)}>{PAY_FREQS.map(f=><option key={f} value={f}>{f}</option>)}</select></Fld>
                      <Fld label='DAY COUNT' flex={1.3}><select style={sel} value={floatDc} onChange={e=>setFloatDc(e.target.value)}>{DAY_COUNTS.map(d=><option key={d} value={d}>{d}</option>)}</select></Fld>
                      <Fld label='BDC' flex={1.6}><select style={sel} value={floatBdc} onChange={e=>setFloatBdc(e.target.value)}>{BDCS.map(b=><option key={b} value={b}>{b}</option>)}</select></Fld>
                    </Row>
                    {/* ── BASIS SWAP: FLOAT LEG 2 ─────────────────────────────── */}
                    <SectionHdr>
                      FLOAT LEG 2
                      <Badge label={dir==='PAY'?'← RECEIVE':'→ PAY'} color={dir==='PAY'?'var(--accent)':'var(--red)'}/>
                    </SectionHdr>
                    <Row>
                      <Fld label='INDEX 2' flex={1.8}><select style={{...sel,fontSize:'1rem',fontWeight:600}} value={index2} onChange={e=>setIndex2(e.target.value)}>{(CCY_INDICES[ccy]||[]).map(idx=><option key={idx} value={idx}>{idx}</option>)}</select></Fld>
                      <Fld label='BASIS SPREAD (bp)' flex={1.0}><input ref={spreadRef} style={inp} type='text' defaultValue='0' placeholder='0' autoComplete='off'/></Fld>
                      <Fld label='RESET FREQ' flex={1.4}><select style={sel} value={floatResetFreq2} onChange={e=>setFloatResetFreq2(e.target.value)}>{RESET_FREQS.map(f=><option key={f} value={f}>{f}</option>)}</select></Fld>
                      <Fld label='PAY FREQ' flex={1.4}><select style={sel} value={floatPayFreq2} onChange={e=>setFloatPayFreq2(e.target.value)}>{PAY_FREQS.map(f=><option key={f} value={f}>{f}</option>)}</select></Fld>
                      <Fld label='DAY COUNT' flex={1.3}><select style={sel} value={floatDc2} onChange={e=>setFloatDc2(e.target.value)}>{DAY_COUNTS.map(d=><option key={d} value={d}>{d}</option>)}</select></Fld>
                      <Fld label='BDC' flex={1.6}><select style={sel} value={floatBdc} onChange={e=>setFloatBdc(e.target.value)}>{BDCS.map(b=><option key={b} value={b}>{b}</option>)}</select></Fld>
                    </Row>
                  </>
                ) : (
                  <>
                    {/* ── FIXED LEG ───────────────────────────────────────────────── */}
                    <SectionHdr>
                      FIXED LEG
                      <Badge label={dir==='PAY'?'→ PAY FIXED':'← RECEIVE FIXED'} color={dir==='PAY'?'var(--red)':'var(--accent)'}/>
                    </SectionHdr>
                    <Row>
                      <Fld label='COUPON (%)' flex={1.4}>
                        <div style={{display:'flex',gap:'4px',alignItems:'stretch'}}>
                          <input ref={rateRef}
                            style={{...inp,fontSize:'1.0625rem',fontWeight:700,flex:1,
                              color: rateMode==='PAR' ? 'var(--accent)' : 'var(--amber)',
                              borderColor: rateMode==='PAR' ? 'rgba(13,212,168,0.4)' : 'rgba(240,160,32,0.4)',
                            }}
                            type='text' placeholder='—' autoComplete='off'
                            defaultValue={parRate != null ? String(parRate) : ''}
                            onChange={e=>{ if(rateRef.current) rateRef.current.dataset.userEdited='1' }}
                            onBlur={e=>{ const v=parseFloat(e.target.value); if(!isNaN(v)) setParRate(v) }}
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
                              fontFamily:"'IBM Plex Sans',var(--sans)", fontSize:'0.8125rem', fontWeight:700,
                              letterSpacing:'0.06em', whiteSpace:'nowrap',
                              border: rateMode==='PAR' ? '1px solid rgba(13,212,168,0.5)' : '1px solid rgba(240,160,32,0.5)',
                              background: rateMode==='PAR' ? 'rgba(13,212,168,0.08)' : 'rgba(240,160,32,0.08)',
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
                    {/* ── FLOATING LEG ─────────────────────────────────────────────── */}
                    <SectionHdr>
                      FLOATING LEG
                      <Badge label={floatDir==='RECEIVE'?'← RECEIVE FLOAT':'→ PAY FLOAT'} color={floatDir==='RECEIVE'?'var(--accent)':'var(--red)'}/>
                    </SectionHdr>
                    <Row>
                      <Fld label='INDEX' flex={1.8}><select style={{...sel,fontSize:'1rem',fontWeight:600}} value={index} onChange={e=>handleIndexChange(e.target.value)}>{(CCY_INDICES[ccy]||[]).map(idx=><option key={idx} value={idx}>{idx}</option>)}</select></Fld>
                      <Fld label='SPREAD (bp)' flex={0.9}><input ref={spreadRef} style={inp} type='text' defaultValue='0' placeholder='0' autoComplete='off'/></Fld>
                      <Fld label='LEVERAGE' flex={0.9}><input ref={leverageRef} style={inp} type='text' defaultValue='1.0' placeholder='1.0' autoComplete='off'/></Fld>
                      <Fld label='RESET FREQ' flex={1.4}><select style={sel} value={floatResetFreq} onChange={e=>setFloatResetFreq(e.target.value)}>{RESET_FREQS.map(f=><option key={f} value={f}>{f}</option>)}</select></Fld>
                      <Fld label='PAY FREQ' flex={1.4}><select style={sel} value={floatPayFreq} onChange={e=>setFloatPayFreq(e.target.value)}>{PAY_FREQS.map(f=><option key={f} value={f}>{f}</option>)}</select></Fld>
                      <Fld label='DAY COUNT' flex={1.3}><select style={sel} value={floatDc} onChange={e=>setFloatDc(e.target.value)}>{DAY_COUNTS.map(d=><option key={d} value={d}>{d}</option>)}</select></Fld>
                      <Fld label='BDC' flex={1.6}><select style={sel} value={floatBdc} onChange={e=>setFloatBdc(e.target.value)}>{BDCS.map(b=><option key={b} value={b}>{b}</option>)}</select></Fld>
                      <Fld label='CALENDAR' flex={1.8}><select style={sel} value={floatCal} onChange={e=>setFloatCal(e.target.value)}>{CALENDARS.map(c=><option key={c} value={c}>{c}</option>)}</select></Fld>
                    </Row>
                  </>
                )}
              </>
            )}

            <div ref={analyticsRef}/>
            <SectionHdr>
              ANALYTICS
              {viewTrade && (
                <span style={{
                  fontSize:'0.875rem',fontWeight:700,padding:'2px 6px',borderRadius:'2px',
                  background:'rgba(240,160,32,0.08)',border:'1px solid rgba(240,160,32,0.3)',
                  color:'var(--amber)',letterSpacing:'0.08em',
                }}>{viewTrade.status || 'PENDING'}</span>
              )}
              {analytics && analytics.valuation_date && (
                <span style={{fontWeight:400,opacity:0.6,fontSize:'0.8125rem'}}>
                  {CCY_CURVE[ccy]||'USD_SOFR'} · {analytics.curve_mode} · {analytics.valuation_date}
                </span>
              )}
              <div style={{display:'flex',alignItems:'center',gap:'5px',marginLeft:'auto'}}>
                <span style={{fontSize:'0.875rem',color:'var(--text-dim)',letterSpacing:'0.08em',whiteSpace:'nowrap'}}>VAL DATE</span>
                <input type='date' value={valDate} onChange={e=>setValDate(e.target.value)}
                  style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',
                    color:'var(--text)',fontFamily:"'IBM Plex Mono',var(--mono)",fontSize:'0.875rem',
                    padding:'2px 5px',outline:'none'}}/>
              </div>
              
            </SectionHdr>
            {false&&(
              <div style={{fontSize:'0.875rem',color:'var(--amber)',fontFamily:"'IBM Plex Mono',var(--mono)",marginBottom:'4px'}}>\u26a0 {analyticsErr}</div>
            )}
            {pricing&&(
              <div style={{display:'flex',alignItems:'center',gap:'8px',color:'var(--text-dim)',fontSize:'0.875rem',marginBottom:'8px'}}>
                <div style={{width:'12px',height:'12px',border:'2px solid var(--border)',borderTop:'2px solid var(--accent)',borderRadius:'50%',animation:'spin 0.8s linear infinite',flexShrink:0}}/>
                Running analytics...
                <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
              </div>
            )}
            {true&&(<>
              <div style={{border:'1px solid var(--border)',borderRadius:'2px',overflow:'hidden',marginBottom:'12px'}}>
                <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed'}}>
                  <colgroup>
                    {inst==='IR_SWAPTION' ? (<>
                      <col style={{width:'10%'}}/><col style={{width:'7%'}}/><col style={{width:'7%'}}/>
                      <col style={{width:'5%'}}/><col style={{width:'14%'}}/><col style={{width:'11%'}}/>
                      <col style={{width:'11%'}}/><col style={{width:'11%'}}/><col style={{width:'12%'}}/>
                      <col style={{width:'12%'}}/>
                    </>) : (<>
                      <col style={{width:'11%'}}/><col style={{width:'8%'}}/><col style={{width:'8%'}}/>
                      <col style={{width:'6%'}}/><col style={{width:'16%'}}/><col style={{width:'12%'}}/>
                      <col style={{width:'12%'}}/><col style={{width:'12%'}}/><col style={{width:'15%'}}/>
                    </>)}
                  </colgroup>
                  <thead>
                    <tr style={{borderBottom:'1px solid var(--border)',background:'var(--bg)'}}>
                      {['LEG','TYPE','DIR','CCY','PV','IR01','IR01 DISC','GAMMA','THETA',...(inst==='IR_SWAPTION'?['VEGA']:[])].map(h=>{
                        const hasTip = !!GREEK_TIPS[h]
                        return (
                          <th key={h}
                            onMouseEnter={hasTip ? (e)=>{
                              const r = e.currentTarget.getBoundingClientRect()
                              setTooltip({text:GREEK_TIPS[h], x:r.left+r.width/2, y:r.top-8})
                            } : undefined}
                            onMouseLeave={hasTip ? ()=>setTooltip(null) : undefined}
                            style={{fontSize:'0.8125rem',padding:'5px 8px',
                              textAlign:['PV','IR01','IR01 DISC','GAMMA','THETA','VEGA'].includes(h)?'right':'left',
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
                      <td style={{fontSize:'0.8125rem',fontWeight:700,color:'var(--text-dim)',padding:'7px 8px',letterSpacing:'0.08em'}}>NET</td>
                      <td/><td/><td/>
                      <td style={{fontSize:'0.9375rem',fontWeight:700,padding:'7px 8px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:npv==null?'var(--text-dim)':npv>=0?'var(--accent)':'var(--red)'}}>{fmtPnl(npv)}</td>
                      <td style={{fontSize:'0.9375rem',fontWeight:700,padding:'7px 8px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--blue)'}}>{fmtPnl(ir01)}</td>
                      <td style={{fontSize:'0.9375rem',fontWeight:700,padding:'7px 8px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--blue)'}}>{fmtPnl(ir01d)}</td>
                      <td style={{fontSize:'0.875rem',fontWeight:700,padding:'7px 8px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--blue)',opacity:0.7}}>{gamma!=null?(gamma>=0?'+':'')+gamma.toFixed(4):'—'}</td>
                      <td style={{fontSize:'0.9375rem',fontWeight:700,padding:'7px 8px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--amber)'}}>{fmtPnl(theta)}</td>
                      {inst==='IR_SWAPTION' && (
                        <td style={{fontSize:'0.9375rem',fontWeight:700,padding:'7px 8px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--blue)'}}>
                          {swaptionResult?.vega!=null ? fmtPnl(swaptionResult.vega) : '—'}
                        </td>
                      )}
                    </tr>
                    {legs.map((leg,i)=>(
                      <tr key={i} style={{borderBottom:'1px solid var(--panel-2)'}}>
                        <td style={{fontSize:'0.875rem',color:'var(--text-dim)',padding:'6px 8px',fontFamily:"'IBM Plex Mono',var(--mono)"}}>{leg.leg_ref||(i+1)}</td>
                        <td style={{fontSize:'0.875rem',padding:'6px 8px',color:leg.leg_type==='FIXED'?'var(--blue)':'var(--accent)'}}>{leg.leg_type}</td>
                        <td style={{fontSize:'0.875rem',padding:'6px 8px',color:leg.direction==='PAY'?'var(--red)':'var(--accent)'}}>{leg.direction}</td>
                        <td style={{fontSize:'0.875rem',padding:'6px 8px',color:'var(--text-dim)'}}>{leg.currency}</td>
                        <td style={{fontSize:'0.875rem',padding:'6px 8px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",fontWeight:600,color:leg.pv==null?'var(--text-dim)':leg.pv>=0?'var(--accent)':'var(--red)'}}>{fmtPnl(leg.pv)}</td>
                        <td style={{fontSize:'0.875rem',padding:'6px 8px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--blue)'}}>{fmtPnl(leg.ir01)}</td>
                        <td style={{fontSize:'0.875rem',padding:'6px 8px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--blue)'}}>{fmtPnl(leg.ir01_disc)}</td>
                        <td style={{fontSize:'0.875rem',padding:'6px 8px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--text-dim)'}}>{leg.gamma!=null?(leg.gamma>=0?'+':'')+leg.gamma.toFixed(4):'—'}</td>
                        <td style={{fontSize:'0.875rem',padding:'6px 8px',textAlign:'right',fontFamily:"'IBM Plex Mono',var(--mono)",color:'var(--text-dim)'}}>—</td>
                        {inst==='IR_SWAPTION' && <td style={{padding:'6px 8px'}}>—</td>}
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
                    borderRadius:'2px',fontFamily:"'IBM Plex Sans',var(--sans)",fontSize:'0.8125rem',
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
                    <span style={{marginLeft:'auto',color:'var(--text-dim)',opacity:0.6,fontSize:'0.875rem'}}>OFF-MARKET</span>
                  </div>
                )
              })()}

            </>)}
          {/* XVA → see XVA tab for full simulation */}
          {activeTab==='main' && !xvaResult && (
            <div style={{margin:'0 16px 12px',borderTop:'1px solid var(--border)',paddingTop:'8px',
              display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',flexDirection:'column',gap:'2px'}}>
                <span style={{fontSize:'0.75rem',fontWeight:700,letterSpacing:'.12em',color:'#2a2a2a'}}>XVA</span>
                <span style={{fontSize:'0.8125rem',color:'#333',letterSpacing:'.03em'}}>
                  CVA · DVA · FVA · FBA · KVA · MVA · All-In rate
                </span>
              </div>
              <span style={{fontSize:'0.8125rem',color:'#444',letterSpacing:'.04em',fontFamily:"'IBM Plex Mono',var(--mono)"}}>
                → SIMULATE in XVA tab
              </span>
            </div>
          )}
          {activeTab==='main' && xvaResult?.xva && (
            <div style={{margin:'0 16px 12px',borderTop:'1px solid rgba(0,212,168,0.15)',paddingTop:'10px'}}>
              <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}>
                <span style={{fontSize:'0.75rem',fontWeight:700,letterSpacing:'.12em',color:'var(--accent)'}}>XVA</span>
                {xvaResult?.params && (
                  <span style={{fontSize:'0.8125rem',color:'var(--text-dim)',letterSpacing:'.03em'}}>
                    HW1F · a={xvaResult.params.a.toFixed(4)} · σ={xvaResult.params.sigma_bp.toFixed(1)}bp · {xvaResult.n_paths.toLocaleString()} paths
                  </span>
                )}
                <div style={{marginLeft:'auto',display:'flex',gap:'6px',alignItems:'center'}}>
                  {xvaErr && <span style={{fontSize:'0.8125rem',color:'var(--red)'}}>{xvaErr}</span>}
                </div>
              </div>
              <XvaInlinePanel
                xva={xvaResult.xva}
                notionalRef={notionalRef}
                rateRef={rateRef}
                effDate={effDate}
                matDate={matDate}
                parRate={parRate}
                onApply={handleApplyXvaToRate}
              />
            </div>
          )}
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
            fontSize:'0.8125rem',
            fontFamily:"'IBM Plex Mono',var(--mono)",
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
        <div className='tbw-footer tbw-no-drag'>
            {err&&<div className='tbw-error'>{err}</div>}
            {activeTab!=='scenario' && <div style={{display:'flex',alignItems:'center',borderBottom:'1px solid #1E1E1E',background:'#050505',padding:'5px 14px',gap:'0',marginBottom:'6px'}}>
              {[
                {label:'NET NPV',val:analytics!=null&&analytics.npv!=null?(analytics.npv>=0?'+':'-')+String.fromCharCode(36)+Math.abs(Math.round(analytics.npv)).toLocaleString('en-US'):'—',color:analytics!=null&&analytics.npv!=null?(analytics.npv>=0?'#00D4A8':'#FF6B6B'):'#444'},
                {label:'IR01',val:analytics!=null&&analytics.ir01!=null?(analytics.ir01>=0?'+':'-')+String.fromCharCode(36)+Math.abs(Math.round(analytics.ir01)).toLocaleString('en-US'):'—',color:'#4A9EFF'},
                {label:'IR01 DISC',val:analytics!=null&&analytics.ir01_disc!=null?(analytics.ir01_disc>=0?'+':'-')+String.fromCharCode(36)+Math.abs(Math.round(analytics.ir01_disc)).toLocaleString('en-US'):'—',color:'#4A9EFF'},
                {label:'THETA',val:analytics!=null&&analytics.theta!=null?(analytics.theta>=0?'+':'-')+String.fromCharCode(36)+Math.abs(Math.round(analytics.theta)).toLocaleString('en-US'):'—',color:'#FF6B6B'},
              ].map((m,i)=>(
                <div key={i} style={{display:'flex',flexDirection:'column',gap:'1px',padding:'0 10px',borderRight:'1px solid #1E1E1E'}}>
                  <span style={{fontSize:'9px',color:'#444',letterSpacing:'0.08em',fontFamily:"'IBM Plex Sans',sans-serif"}}>{m.label}</span>
                  <span style={{fontSize:'11px',color:m.color,fontFamily:"'IBM Plex Mono',monospace",fontWeight:600}}>{m.val}</span>
                </div>
              ))}
              <div style={{display:'flex',flexDirection:'column',gap:'1px',padding:'0 10px',borderRight:'1px solid #1E1E1E'}}>
                <span style={{fontSize:'9px',color:'#444',letterSpacing:'0.08em',fontFamily:"'IBM Plex Sans',sans-serif"}}>STRUCTURE</span>
                <span style={{fontSize:'9px',color:'#F5C842',fontFamily:"'IBM Plex Mono',monospace",letterSpacing:'0.04em'}}>{struct||'VANILLA'}</span>
              </div>
              {xvaResult?.xva && <XvaFooterRate xva={xvaResult.xva} notionalRef={notionalRef} rateRef={rateRef} effDate={effDate} matDate={matDate} parRate={parRate}/>}
              {activeTab==='scenario' ? (
                <button style={{marginLeft:'auto',background:anyShift&&!confirmed?'rgba(0,212,168,0.1)':'rgba(255,255,255,0.04)',border:anyShift&&!confirmed?'1px solid rgba(0,212,168,0.3)':'1px solid #1E1E1E',color:anyShift&&!confirmed?'#00D4A8':'#666',borderRadius:'2px',padding:'3px 14px',fontSize:'11px',letterSpacing:'0.07em',cursor:(!anyShift||confirmed||scenarioPricing)?'not-allowed':'pointer',fontFamily:"'IBM Plex Sans',sans-serif"}} onClick={handleConfirm} disabled={!anyShift||confirmed||scenarioPricing}>
                  {scenarioPricing?'REPRICING...':(anyShift&&!confirmed)?'CONFIRM SHAPE →':'SHAPE CONFIRMED'}
                </button>
              ) : (
                <>
                <button style={{marginLeft:'auto',background:'rgba(245,200,66,0.08)',border:'1px solid rgba(245,200,66,0.4)',color:'#F5C842',borderRadius:'2px',padding:'5px 18px',fontSize:'12px',fontWeight:700,letterSpacing:'0.08em',cursor:(pricing||swaptionPricing)?'not-allowed':'pointer',opacity:(pricing||swaptionPricing)?0.5:1,fontFamily:"'IBM Plex Mono',monospace"}}
                  onClick={inst==='IR_SWAPTION' ? handlePriceSwaption : handlePrice}
                  disabled={pricing||swaptionPricing}>
                  {(pricing||swaptionPricing)?'PRICING...':'▶ PRICE'}
                </button>
              {!xvaResult && <span style={{fontSize:'10px',color:'#444',fontFamily:"'IBM Plex Mono',monospace",letterSpacing:'0.04em',padding:'0 8px'}}>XVA → SIMULATE to price</span>}
                </>
              )}
            </div>}
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
                  <button className='tbw-btn-book' onClick={handleBook} disabled={booking||pricing} style={xvaResult?.xva?{background:'#00D4A8',color:'#000'}:{}}>
                    {booking?(bookingStep||'BOOKING...'):xvaResult?.xva?<XvaBookLabel xva={xvaResult.xva} notionalRef={notionalRef} rateRef={rateRef} effDate={effDate} matDate={matDate} parRate={parRate}/>:'▶ BOOK TRADE'}
                  </button>
                </>
              )}
            </div>
          </div>
      </div>
    </div>
  )
}
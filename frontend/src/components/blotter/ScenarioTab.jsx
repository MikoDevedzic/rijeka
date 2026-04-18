// blotter/ScenarioTab.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// Extracted from TradeBookingWindow.jsx (Patch 22) to enable use in the
// unified TradeWindow shell. Legacy TBW keeps its inline copy untouched;
// this file is a standalone duplicate for the new architecture.
//
// Contains the Sprint 5 draggable yield curve scenario runner, the
// Sprint 8 3D SABR vol surface (Three.js r128, β=0 Normal SABR, Hagan
// 2002), parallel-curve shock presets, and the 4-parallel-call P&L
// decomposition for rate+vol joint scenarios.
// ────────────────────────────────────────────────────────────────────────────────────

import React, { useState, useRef, useEffect } from 'react'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

const CCY_CURVE = {
  USD:'USD_SOFR', EUR:'EUR_ESTR', GBP:'GBP_SONIA',
  JPY:'JPY_TONAR', CHF:'CHF_SARON', AUD:'AUD_AONIA', CAD:'CAD_CORRA',
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

const INDEX_PAY_LAG = {
  'SOFR':2,'EFFR':2,'\u20acSTR':2,'SONIA':0,'TONAR':2,'SARON':2,'AONIA':0,'CORRA':2,
  'TERM SOFR 1M':0,'TERM SOFR 3M':0,'TERM SOFR 6M':0,
  'EURIBOR 1M':0,'EURIBOR 3M':0,'EURIBOR 6M':0,
  'TERM SONIA 3M':0,'TERM SONIA 6M':0,'TIBOR 3M':0,'TIBOR 6M':0,
  'TERM SARON 3M':0,'BBSW 3M':0,'BBSW 6M':0,
}

export default function ScenarioTab({ ccy, index, dir, struct, effDate, matDate, valDate, curves, analytics,
  notionalRef, rateRef, fixedPayFreq, fixedDc, fixedBdc, floatResetFreq, floatPayFreq, floatDc, floatBdc, getSession,
  inst, swaptionExpiry, swaptionTenor, swaptionVol, swaptionResult, curveId: curveIdProp,
  capResult, capVolOverride, setCapVolOverride, handleCapFloorPrice }) {

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
  const IS_CAPFLOOR = inst==='INTEREST_RATE_CAP'||inst==='INTEREST_RATE_FLOOR'||inst==='INTEREST_RATE_COLLAR'
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
  const capVolCanvasRef = useRef(null)
  const capVolWrapRef  = useRef(null)
  const capThreeRef    = useRef(null)
  const capSphRef      = useRef({th:0.6,ph:0.55,r:14})
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

  // Cap vol surface — Three.js 3D mesh from surface_rows
  useEffect(()=>{
    if(!IS_CAPFLOOR) return
    const wrap = capVolWrapRef.current
    const canvas = capVolCanvasRef.current
    if(!wrap || !canvas) return
    let alive = true
    const sphRef = capSphRef.current

    const camUpdate = () => {
      const t = capThreeRef.current; if(!t) return
      const {camera} = t
      const {th,ph,r} = sphRef
      camera.position.set(r*Math.cos(ph)*Math.sin(th), r*Math.sin(ph), r*Math.cos(ph)*Math.cos(th))
      camera.lookAt(0,0,0)
    }

    const buildSurface = (THREE, scene, meshRef) => {
      const rows = capResult?.surface_rows || []
      const baseVol = parseFloat(capVolOverride) || capResult?.vol_bp || 85

      // Tenors from data; fallback to standard cap grid
      const tenorSet = [...new Set(rows.map(r=>parseFloat(r.cap_tenor_y)))].sort((a,b)=>a-b)
      const TENORS_CAP = tenorSet.length >= 2 ? tenorSet : [1,2,3,5,7,10]

      // Use signed spreads directly. USCNQ tickers are absolute strikes so
      // surface_rows contains both ITM (negative spread) and OTM (positive
      // spread) points — no mirroring needed.
      const spreadSet = [...new Set(rows.map(r=>parseFloat(r.strike_spread_bp)))].sort((a,b)=>a-b)
      const SPREADS = spreadSet.length >= 2
        ? spreadSet
        : [-400,-200,-100,0,100,200,400]
      const NT = TENORS_CAP.length, NS = SPREADS.length

      // Per-tenor piecewise-linear vol lookup in signed spread, flat extrapolation
      const volFn = new Map()
      for(const tY of TENORS_CAP){
        const pts = rows
          .filter(r=>Math.abs(parseFloat(r.cap_tenor_y)-tY)<0.01)
          .map(r=>({k:parseFloat(r.strike_spread_bp),v:parseFloat(r.flat_vol_bp)}))
          .sort((a,b)=>a.k-b.k)
        if(pts.length===0){ volFn.set(tY,()=>baseVol); continue }
        if(pts.length===1){ const v=pts[0].v; volFn.set(tY,()=>v); continue }
        volFn.set(tY,(x)=>{
          if(x<=pts[0].k) return pts[0].v
          if(x>=pts[pts.length-1].k) return pts[pts.length-1].v
          for(let i=0;i<pts.length-1;i++){
            if(x>=pts[i].k && x<=pts[i+1].k){
              const t=(x-pts[i].k)/(pts[i+1].k-pts[i].k)
              return pts[i].v + t*(pts[i+1].v-pts[i].v)
            }
          }
          return pts[pts.length-1].v
        })
      }

      const grid = []
      for(let ti=0; ti<NT; ti++){
        const fn = volFn.get(TENORS_CAP[ti])
        const row = []
        for(let si=0; si<NS; si++){ row.push(fn(SPREADS[si])) }
        grid.push(row)
      }

      const allV = grid.flat()
      const minV = Math.min(...allV), maxV = Math.max(...allV), range = maxV - minV || 1
      const XS=8, ZS=6, YS=3.5

      const verts=[], cols=[], idx=[]
      for(let ti=0;ti<NT;ti++){
        for(let si=0;si<NS;si++){
          const v = grid[ti][si]
          const x = (si/(NS-1)-0.5)*XS
          const y = ((v-minV)/range)*YS
          const z = (ti/(NT-1)-0.5)*ZS
          verts.push(x,y,z)
          // Teal gradient — consistent with rebuild path and Rijeka theme
          const t = (v-minV)/range
          cols.push(0, t*0.83+0.17, (1-t)*0.53+0.47)
        }
      }
      for(let ti=0;ti<NT-1;ti++)
        for(let si=0;si<NS-1;si++){
          const a=ti*NS+si,b=a+1,c=a+NS,d=c+1
          idx.push(a,b,c,b,d,c)
        }

      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts,3))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols,3))
      geo.setIndex(idx); geo.computeVertexNormals()

      if(meshRef.current){ scene.remove(meshRef.current); meshRef.current.geometry.dispose() }
      if(meshRef.wireRef){ scene.remove(meshRef.wireRef); meshRef.wireRef.geometry.dispose() }

      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({vertexColors:true,transparent:true,opacity:0.88,side:THREE.DoubleSide}))
      const wire = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({color:0x00D4A8,wireframe:true,transparent:true,opacity:0.09}))
      scene.add(mesh); scene.add(wire)
      meshRef.current = mesh; meshRef.wireRef = wire
    }

    const meshRef = {current:null}

    const load = () => new Promise(res=>{
      if(window.THREE){res();return}
      const s=document.createElement('script')
      s.src='https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
      s.onload=res; document.head.appendChild(s)
    })

    load().then(()=>{
      if(!alive) return
      const THREE = window.THREE
      const renderer = new THREE.WebGLRenderer({canvas, antialias:true})
      renderer.setPixelRatio(window.devicePixelRatio)
      renderer.setClearColor(0x0A0A0E)
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(42,1,0.1,200)
      scene.add(new THREE.AmbientLight(0x203040,1.5))
      const dl=new THREE.DirectionalLight(0x00D4A8,0.5); dl.position.set(5,10,8); scene.add(dl)
      const dl2=new THREE.DirectionalLight(0x4A9EFF,0.25); dl2.position.set(-5,4,-4); scene.add(dl2)
      const gh=new THREE.GridHelper(12,12,0x181B24,0x101318); gh.position.y=-0.05; scene.add(gh)
      capThreeRef.current = {THREE,renderer,scene,camera,alive:true}
      camUpdate()

      const resize=()=>{
        if(!wrap||!capThreeRef.current?.alive) return
        const W=wrap.clientWidth, H=wrap.clientHeight
        renderer.setSize(W,H); camera.aspect=W/H; camera.updateProjectionMatrix()
      }
      const ro=new ResizeObserver(resize); ro.observe(wrap)
      capThreeRef.current.ro=ro
      resize()
      buildSurface(THREE, scene, meshRef)

      let drag=null
      const onDown=e=>{drag={ds:{x:e.clientX,y:e.clientY},dsph:{...sphRef}}; canvas.style.cursor='grabbing'}
      const onMove=e=>{
        if(!drag) return
        sphRef.th=drag.dsph.th-(e.clientX-drag.ds.x)*0.005
        sphRef.ph=Math.max(0.08,Math.min(1.5,drag.dsph.ph-(e.clientY-drag.ds.y)*0.005))
        camUpdate()
      }
      const onUp=()=>{drag=null; canvas.style.cursor='grab'}
      const onWheel=e=>{sphRef.r=Math.max(5,Math.min(22,sphRef.r+e.deltaY*0.012)); camUpdate(); e.preventDefault()}
      canvas.addEventListener('mousedown',onDown)
      canvas.addEventListener('mousemove',onMove)
      canvas.addEventListener('mouseup',onUp)
      canvas.addEventListener('mouseleave',onUp)
      canvas.addEventListener('wheel',onWheel,{passive:false})
      capThreeRef.current.cleanup=()=>{
        canvas.removeEventListener('mousedown',onDown)
        canvas.removeEventListener('mousemove',onMove)
        canvas.removeEventListener('mouseup',onUp)
        canvas.removeEventListener('mouseleave',onUp)
        canvas.removeEventListener('wheel',onWheel)
      }

      const loop=()=>{if(!alive)return;requestAnimationFrame(loop);renderer.render(scene,camera)}
      loop()
    })

    return()=>{
      alive=false
      const t=capThreeRef.current; if(!t) return
      t.alive=false; t.cleanup?.(); t.ro?.disconnect(); t.renderer?.dispose()
      capThreeRef.current=null
    }
  },[IS_CAPFLOOR])

  // Rebuild cap surface when capResult changes
  useEffect(()=>{
    if(!IS_CAPFLOOR || !capThreeRef.current?.alive) return
    const {THREE, scene} = capThreeRef.current
    const meshRef = capThreeRef.current.meshRef || {}
    capThreeRef.current.meshRef = meshRef
    // rebuild geometry inline
    const rows = capResult?.surface_rows || []
    const baseVol = parseFloat(capVolOverride) || capResult?.vol_bp || 85
    const tenorSet = [...new Set(rows.map(r=>parseFloat(r.cap_tenor_y)))].sort((a,b)=>a-b)
    const TENORS_CAP = tenorSet.length >= 2 ? tenorSet : [1,2,3,5,7,10]
    const spreadSet = [...new Set(rows.map(r=>parseFloat(r.strike_spread_bp)))].sort((a,b)=>a-b)
    const SPREADS = spreadSet.length >= 2 ? spreadSet : [-400,-200,-100,0,100,200,400]
    const NT = TENORS_CAP.length, NS = SPREADS.length
    const volFn = new Map()
    for(const tY of TENORS_CAP){
      const pts = rows
        .filter(r=>Math.abs(parseFloat(r.cap_tenor_y)-tY)<0.01)
        .map(r=>({k:parseFloat(r.strike_spread_bp),v:parseFloat(r.flat_vol_bp)}))
        .sort((a,b)=>a.k-b.k)
      if(pts.length===0){ volFn.set(tY,()=>baseVol); continue }
      if(pts.length===1){ const v=pts[0].v; volFn.set(tY,()=>v); continue }
      volFn.set(tY,(x)=>{
        if(x<=pts[0].k) return pts[0].v
        if(x>=pts[pts.length-1].k) return pts[pts.length-1].v
        for(let i=0;i<pts.length-1;i++){
          if(x>=pts[i].k && x<=pts[i+1].k){
            const t=(x-pts[i].k)/(pts[i+1].k-pts[i].k)
            return pts[i].v + t*(pts[i+1].v-pts[i].v)
          }
        }
        return pts[pts.length-1].v
      })
    }
    const grid = []
    for(let ti=0;ti<NT;ti++){
      const fn = volFn.get(TENORS_CAP[ti])
      const row = []
      for(let si=0;si<NS;si++){ row.push(fn(SPREADS[si])) }
      grid.push(row)
    }
    const allV=grid.flat(),minV=Math.min(...allV),maxV=Math.max(...allV),range=maxV-minV||1
    const XS=8,ZS=6,YS=3.5
    const verts=[],cols=[],idx=[]
    for(let ti=0;ti<NT;ti++) for(let si=0;si<NS;si++){
      const v=grid[ti][si]
      verts.push((si/(NS-1)-0.5)*XS,((v-minV)/range)*YS,(ti/(NT-1)-0.5)*ZS)
      const t=(v-minV)/range
      cols.push(0,t*0.83+0.17,(1-t)*0.53+0.47)  // teal gradient
    }
    for(let ti=0;ti<NT-1;ti++) for(let si=0;si<NS-1;si++){
      const a=ti*NS+si,b=a+1,c=a+NS,d=c+1; idx.push(a,b,c,b,d,c)
    }
    const geo=new THREE.BufferGeometry()
    geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3))
    geo.setAttribute('color',new THREE.Float32BufferAttribute(cols,3))
    geo.setIndex(idx); geo.computeVertexNormals()
    if(meshRef.m){scene.remove(meshRef.m);meshRef.m.geometry.dispose()}
    if(meshRef.w){scene.remove(meshRef.w);meshRef.w.geometry.dispose()}
    meshRef.m=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({vertexColors:true,transparent:true,opacity:0.88,side:THREE.DoubleSide}))
    meshRef.w=new THREE.Mesh(geo.clone(),new THREE.MeshBasicMaterial({color:0x00D4A8,wireframe:true,transparent:true,opacity:0.09}))
    scene.add(meshRef.m); scene.add(meshRef.w)
  },[capResult, capVolOverride, IS_CAPFLOOR])

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
                    <span style={{fontSize:'0.6875rem',fontWeight:400,color:'#444'}}>&#946;=0 Normal SABR</span>
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

              {/* Cap/Floor/Collar vol scenario */}
              {IS_CAPFLOOR && (
                <div style={{marginTop:'12px',paddingTop:'12px',borderTop:'1px solid #1E1E1E'}}>
                  <div style={{fontSize:'0.75rem',fontWeight:600,letterSpacing:'0.08em',
                    color:'#F5C842',fontFamily:"'IBM Plex Sans',var(--sans)",marginBottom:'8px',
                    display:'flex',alignItems:'center',gap:'8px'}}>
                    CAP VOL SCENARIO
                    <span style={{fontSize:'0.6875rem',fontWeight:400,color:'#444'}}>Bachelier Normal · flat vol shift</span>
                  </div>
                  {[
                    {l:'BASE',          d:null,    shift:0},
                    {l:'PARALLEL +15bp',d:'+15bp', shift:15},
                    {l:'PARALLEL −15bp',d:'−15bp', shift:-15},
                    {l:'PARALLEL +30bp',d:'+30bp', shift:30},
                    {l:'PARALLEL −30bp',d:'−30bp', shift:-30},
                    {l:'STRESS +50bp',  d:'+50bp', shift:50},
                  ].map(sc=>{
                    const baseVol = parseFloat(capVolOverride)||85
                    const shockedVol = Math.max(1, baseVol + sc.shift)
                    const isActive = sc.shift===0?(capVolOverride===String(baseVol)||!sc.d):false
                    return (
                      <button key={sc.l}
                        onClick={()=>{
                          if(sc.shift===0){
                            // reset to base — reprice without vol override changes
                          } else {
                            setCapVolOverride(shockedVol.toFixed(1))
                          }
                          if(handleCapFloorPrice) setTimeout(handleCapFloorPrice,50)
                        }}
                        style={{display:'flex',alignItems:'center',gap:'7px',padding:'5px 7px',
                          marginBottom:'2px',width:'100%',
                          border:'1px solid #1A1A1A',borderRadius:'2px',cursor:'pointer',
                          background:'transparent',color:'#555',
                          fontFamily:"'IBM Plex Sans',var(--sans)",fontSize:'0.8125rem',textAlign:'left'}}>
                        <span style={{width:5,height:5,borderRadius:'50%',flexShrink:0,
                          background:sc.shift===0?'#00D4A8':sc.shift>0?'#FF6B6B':'#4A9EFF',
                          display:'inline-block'}}/>
                        <span>{sc.l}</span>
                        {sc.d && <span style={{fontSize:'0.6875rem',color:'#444',marginLeft:'auto'}}>
                          {baseVol.toFixed(1)} → {shockedVol.toFixed(1)}bp
                        </span>}
                      </button>
                    )
                  })}
                  {capResult && (
                    <div style={{marginTop:'6px',fontSize:'0.75rem',color:'#F5C842',
                      background:'rgba(245,200,66,0.04)',border:'1px solid rgba(245,200,66,0.15)',
                      borderRadius:'2px',padding:'4px 8px',fontFamily:"'IBM Plex Mono',monospace"}}>
                      vol: {parseFloat(capVolOverride||capResult.vol_bp||85).toFixed(1)}bp · NPV: {capResult.npv!=null?'$'+Math.round(capResult.npv).toLocaleString():'—'}
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
          {/* 3D Vol surface — swaption SABR or cap vol surface */}
          {IS_SWPN && (
            <div ref={volWrapRef}
              style={{flex:'1 1 0',borderTop:'1px solid #1E1E1E',background:'#0A0A0E',
                position:'relative',minHeight:'180px',overflow:'hidden'}}
>
              <div style={{position:'absolute',top:5,left:8,fontSize:'0.5rem',
                color:'#F5C842',letterSpacing:'.10em',fontFamily:"'IBM Plex Mono',monospace",zIndex:2}}>
                VOL SURFACE — β​=0 NORMAL SABR {volScenKey!=='base'&&<span style={{color:'#555',marginLeft:6}}>· {VOL_SCEN[volScenKey]?.l}</span>}
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
          {IS_CAPFLOOR && (
            <div ref={capVolWrapRef}
              style={{flex:'1 1 0',borderTop:'1px solid #1E1E1E',background:'#0A0A0E',
                position:'relative',minHeight:'180px',overflow:'hidden'}}>
              <div style={{position:'absolute',top:5,left:8,fontSize:'0.5rem',
                color:'#F5C842',letterSpacing:'.10em',fontFamily:"'IBM Plex Mono',monospace",zIndex:2}}>
                CAP VOL SURFACE — BACHELIER NORMAL
              </div>
              <div style={{position:'absolute',bottom:6,right:8,fontSize:'0.4375rem',
                color:'#1E2028',letterSpacing:'.07em',fontFamily:"'IBM Plex Mono',monospace",zIndex:2}}>
                DRAG TO ROTATE · SCROLL TO ZOOM · STRIKE SPREAD (bp) × TENOR (Y)
              </div>
              {!capResult && (
                <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',
                  justifyContent:'center',color:'#2A2A2A',fontSize:'0.75rem',
                  fontFamily:"'IBM Plex Mono',monospace",letterSpacing:'.08em'}}>
                  PRICE CAP/FLOOR FIRST TO LOAD SURFACE
                </div>
              )}
              <div style={{position:'absolute',bottom:6,left:8,display:'flex',flexDirection:'column',gap:4,pointerEvents:'none',zIndex:2}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  <div style={{width:16,height:2,background:'rgba(0,212,168,.6)',borderRadius:1}}/>
                  <span style={{fontSize:'0.4375rem',color:'rgba(0,212,168,.5)',letterSpacing:'.07em',fontFamily:"'IBM Plex Mono',monospace"}}>
                    {(parseFloat(capVolOverride)||capResult?.vol_bp||85).toFixed(1)}bp · {capResult?.vol_tier||'—'}
                  </span>
                </div>
              </div>
              <canvas ref={capVolCanvasRef}
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
              {[
                {label:'NET NPV',base:scenarioBase?.npv,shocked:scenarioCalc?.npv,fmt:fmtPnl,approx:false},
                {label:'IR01',base:scenarioBase?.ir01,shocked:scenarioCalc?.ir01,fmt:fmtPnl,approx:false},
                {label:'GAMMA',base:scenarioBase?.gamma,shocked:scenarioCalc?.gamma,fmt:fmtG,dp:4,approx:false},
                {label:'THETA',base:scenarioBase?.theta,shocked:(scenarioBase?.theta!=null&&scenarioBase?.ir01&&scenarioCalc?.ir01)?scenarioBase.theta+scenarioBase.theta*((scenarioCalc.ir01-scenarioBase.ir01)/Math.abs(scenarioBase.ir01)):null,fmt:fmtPnl,approx:true},
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
              }
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

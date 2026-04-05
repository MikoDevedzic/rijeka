// redesign_scenario_tab.js
// Complete rewrite of ScenarioTab matching sofr_bootstrapper.html aesthetic.
// Two-column layout: left = controls + editable table, right = large interactive chart.
// Space Grotesk for labels, DM Mono for numbers.
// No equalizer bars. Clean generous whitespace.
// Run from: C:\Users\mikod\OneDrive\Desktop\Rijeka

const fs   = require('fs')
const path = require('path')
const TBW  = path.join('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx')

let src = fs.readFileSync(TBW, 'utf8')
const START = src.indexOf('function ScenarioTab(')
const END   = src.indexOf('\nexport default function TradeBookingWindow(')
if (START===-1||END===-1){console.error('Boundaries not found');process.exit(1)}

const TAB = `function ScenarioTab({ ccy, index, dir, struct, effDate, matDate, valDate, curves, analytics,
  notionalRef, rateRef, fixedPayFreq, fixedDc, fixedBdc, floatResetFreq, floatPayFreq, floatDc, floatBdc, getSession }) {

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

    ctx.fillStyle='#0D0F17'; ctx.fillRect(0,0,W,H)

    // Grid
    const gStep=visHalf>0.5?0.25:0.1
    ctx.font='9px DM Mono,JetBrains Mono,monospace'
    for(let r=Math.ceil(minR/gStep)*gStep;r<=maxR+0.001;r=Math.round((r+gStep)*10000)/10000){
      const y=yS(r); if(y<PAD.t-2||y>H-PAD.b+2)continue
      ctx.strokeStyle='rgba(30,34,53,0.8)'; ctx.lineWidth=0.5
      ctx.beginPath(); ctx.moveTo(PAD.l,y); ctx.lineTo(W-PAD.r,y); ctx.stroke()
    }
    // X axis + labels
    ctx.strokeStyle='rgba(30,34,53,0.6)'; ctx.lineWidth=0.5
    ctx.beginPath(); ctx.moveTo(PAD.l,H-PAD.b); ctx.lineTo(W-PAD.r,H-PAD.b); ctx.stroke()
    ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillStyle='#6B7A99'
    ;['1M','6M','1Y','2Y','5Y','10Y','20Y','30Y'].forEach(t=>{
      const x=xS(TENOR_Y[t]); ctx.fillText(t,x,H-PAD.b+6)
      ctx.strokeStyle='rgba(30,34,53,0.4)'; ctx.lineWidth=0.4
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
      ctx.strokeStyle=\`rgba(\${shClrRgb},0.2)\`; ctx.lineWidth=7; ctx.stroke()
      ctx.beginPath()
      TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(shockRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
      ctx.strokeStyle=shClr; ctx.lineWidth=2; ctx.stroke(); ctx.setLineDash([])
      TENORS.forEach((t,i)=>{
        const cx=xS(TENOR_Y[t]),cy=yS(shockRts[i]),cyB=yS(baseRts[i])
        const bp=Math.round(sh[i]),isActive=dragRef.current?.idx===i
        if(Math.abs(bp)>0.5){ctx.strokeStyle=\`rgba(\${shClrRgb},0.2)\`;ctx.lineWidth=0.8;ctx.setLineDash([2,2]);ctx.beginPath();ctx.moveTo(cx,cyB);ctx.lineTo(cx,cy);ctx.stroke();ctx.setLineDash([])}
        if(isActive){ctx.shadowColor=shClr;ctx.shadowBlur=14;ctx.beginPath();ctx.arc(cx,cy,5.5,0,Math.PI*2);ctx.fillStyle=shClr;ctx.fill();ctx.shadowBlur=0;ctx.beginPath();ctx.arc(cx,cy,5.5,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,0.7)';ctx.lineWidth=1;ctx.stroke()}
        else{ctx.beginPath();ctx.arc(cx,cy,4.5,0,Math.PI*2);ctx.strokeStyle=\`rgba(\${shClrRgb},0.3)\`;ctx.lineWidth=3;ctx.stroke();ctx.beginPath();ctx.arc(cx,cy,3,0,Math.PI*2);ctx.fillStyle=shClr;ctx.fill()}
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
        fetch(API+'/price/preview',{method:'POST',headers:h,body:JSON.stringify({legs,valuation_date:valDate,curves:[{curve_id:curveId,quotes:[]}]})}),
        fetch(API+'/price/preview',{method:'POST',headers:h,body:JSON.stringify({legs,valuation_date:valDate,curves:[{curve_id:curveId,quotes:shockedQuotes}]})}),
      ])
      if(bR.ok)setScenarioBase(await bR.json())
      if(sR.ok)setScenarioCalc(await sR.json())
    }catch(e){console.error('[SCENARIO]',e)}
    finally{setScenarioPricing(false)}
  }

  const applyPreset=key=>{setPresetKey(key);shiftsRef.current=[...(PRESETS[key]||PRESETS.flat0)];setConfirmed(false);setTick(t=>t+1);scheduleDraw()}
  const handleReset=()=>{shiftsRef.current=TENORS.map(()=>0);setPresetKey('flat0');setBaseOverrides({});setConfirmed(true);setScenarioBase(null);setScenarioCalc(null);setTick(t=>t+1);scheduleDraw()}
  const handleConfirm=()=>{setConfirmed(true);const ov={};TENORS.forEach((t,i)=>{ov[t]=(getBase(t)+shiftsRef.current[i]/100).toFixed(5)});handleRunScenario(ov)}

  const sh=shiftsRef.current
  const anyShift=sh.some(s=>Math.abs(s)>0.05)
  const avgBp=Math.round(sh.reduce((a,b)=>a+b,0)/TENORS.length)
  const fmtPnl=n=>n==null?'\u2014':(n>=0?'+':'-')+'$'+Math.abs(Math.round(n)).toLocaleString('en-US')
  const fmtG=n=>n==null?'\u2014':(n>=0?'+':'')+n.toFixed(4)

  // Compute stats for cards
  const df30 = Math.exp(-getBase('30Y')/100*30)
  const zero5 = getBase('5Y') + (sh[TENORS.indexOf('5Y')]||0)/100
  const df5  = Math.exp(-getBase('5Y')/100*5)
  const df10 = Math.exp(-getBase('10Y')/100*10)
  const fwd5y5y = df5>0&&df10>0 ? (-Math.log(df10/df5)/5)*100 : 0

  const inp = {background:'#0D0F17',border:'1px solid #1E2235',borderRadius:'3px',color:'#E8EAF0',fontFamily:'DM Mono,monospace',fontSize:'0.875rem',padding:'4px 8px',outline:'none',width:'100%'}

  return (
    <div className='tbw-no-drag' style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',background:'#07080D'}}>

      {/* Notice bar */}
      <div style={{background:'rgba(240,160,32,0.06)',borderBottom:'1px solid rgba(240,160,32,0.15)',
        padding:'5px 16px',fontSize:'0.8125rem',color:'#F5C842',letterSpacing:'0.02em',flexShrink:0,
        fontFamily:"'Space Grotesk',var(--mono)"}}>
        ⚠ Scenario mode \u2014 changes here are for analysis only and are not saved to Configurations.
      </div>

      {/* Two-column body */}
      <div style={{flex:1,display:'grid',gridTemplateColumns:'340px 1fr',minHeight:0,overflow:'hidden'}}>

        {/* LEFT PANEL */}
        <div style={{borderRight:'1px solid #1E2235',display:'flex',flexDirection:'column',overflow:'hidden'}}>

          {/* Controls */}
          <div style={{padding:'14px 16px',borderBottom:'1px solid #1E2235',flexShrink:0}}>
            <div style={{fontSize:'0.75rem',fontWeight:600,letterSpacing:'0.08em',color:'#6B7A99',
              fontFamily:"'Space Grotesk',var(--mono)",marginBottom:'10px'}}>
              SCENARIO CONTROLS
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
              <select value={presetKey} onChange={e=>applyPreset(e.target.value)}
                style={{...inp,fontFamily:"'Space Grotesk',var(--mono)"}}>
                <optgroup label="\u2500\u2500 Parallel Shifts \u2500\u2500">
                  <option value="flat0">Base (no shift)</option>
                  <option value="up25">+25bp parallel</option><option value="up50">+50bp parallel</option><option value="up100">+100bp parallel</option>
                  <option value="dn25">\u221225bp parallel</option><option value="dn50">\u221250bp parallel</option><option value="dn100">\u2212100bp parallel</option>
                </optgroup>
                <optgroup label="\u2500\u2500 Curve Reshaping \u2500\u2500">
                  <option value="bear_steep">Bear Steepener (S+50 / L+100)</option>
                  <option value="bull_flat">Bull Flattener (S\u221225 / L\u221275)</option>
                  <option value="bear_flat">Bear Flattener (S+100 / L+50)</option>
                  <option value="bull_steep">Bull Steepener (S\u221275 / L\u221225)</option>
                </optgroup>
                <optgroup label="\u2500\u2500 Central Bank \u2500\u2500">
                  <option value="hike25">Fed Hike +25bp</option>
                  <option value="cut25">Fed Cut \u221225bp</option>
                  <option value="hike_cycle">Fed Hike Cycle</option>
                </optgroup>
              </select>
              <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                <span style={{fontSize:'0.8125rem',color:'#6B7A99',fontFamily:"'Space Grotesk',var(--mono)",whiteSpace:'nowrap'}}>Ripple width</span>
                <input type='range' min='1' max='10' value={sigma} step='1' style={{flex:1,accentColor:'#00D4A8'}}
                  onChange={e=>{const v=parseFloat(e.target.value);setSigma(v);sigmaRef.current=v}}/>
                <span style={{fontSize:'0.875rem',fontWeight:600,color:'#4A9EFF',fontFamily:'DM Mono,monospace',minWidth:'28px'}}>{sigma}Y</span>
              </div>
              <div style={{display:'flex',gap:'8px'}}>
                <button onClick={handleReset}
                  style={{flex:1,padding:'7px',borderRadius:'3px',cursor:'pointer',fontFamily:"'Space Grotesk',var(--mono)",
                    fontSize:'0.8125rem',fontWeight:500,border:'1px solid #1E2235',background:'transparent',color:'#6B7A99'}}>
                  Reset
                </button>
                <button onClick={handleConfirm} disabled={!anyShift||confirmed||scenarioPricing}
                  style={{flex:2,padding:'7px',borderRadius:'3px',
                    cursor:(!anyShift||confirmed||scenarioPricing)?'not-allowed':'pointer',
                    fontFamily:"'Space Grotesk',var(--mono)",fontSize:'0.8125rem',fontWeight:600,
                    border:anyShift&&!confirmed?'1px solid rgba(0,212,168,0.6)':'1px solid #1E2235',
                    background:anyShift&&!confirmed?'rgba(0,212,168,0.1)':'transparent',
                    color:anyShift&&!confirmed?'#00D4A8':'#6B7A99'}}>
                  {scenarioPricing?'Repricing...':(anyShift&&!confirmed)?'Confirm & reprice \u2192':'Confirm shape'}
                </button>
              </div>
              {anyShift&&!confirmed&&(
                <div style={{fontSize:'0.75rem',color:'#F5C842',fontFamily:"'Space Grotesk',var(--mono)",
                  background:'rgba(245,200,66,0.06)',border:'1px solid rgba(245,200,66,0.2)',
                  borderRadius:'3px',padding:'4px 8px'}}>
                  Shape unsaved \u2014 confirm to reprice · avg {avgBp>0?'+':''}{avgBp}bp
                </div>
              )}
            </div>
          </div>

          {/* PAR RATES table */}
          <div style={{padding:'10px 16px 6px',borderBottom:'1px solid #1E2235',flexShrink:0}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
              <span style={{fontSize:'0.75rem',fontWeight:600,letterSpacing:'0.08em',color:'#6B7A99',fontFamily:"'Space Grotesk',var(--mono)"}}>
                PAR RATES \u2014 {curveId.replace('_',' ')} &nbsp;
                <span style={{fontWeight:400,color:'#3D4560'}}>% p.a.</span>
              </span>
              {Object.keys(baseOverrides).length>0&&(
                <button onClick={()=>setBaseOverrides({})}
                  style={{fontSize:'0.75rem',padding:'2px 8px',borderRadius:'2px',cursor:'pointer',
                    fontFamily:"'Space Grotesk',var(--mono)",border:'1px solid rgba(245,200,66,0.3)',
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
              const shiftClr=shBp>0?'#FF6B6B':shBp<0?'#4A9EFF':'#6B7A99'
              return(
                <div key={t} style={{display:'grid',gridTemplateColumns:'36px 1fr auto',alignItems:'center',
                  gap:'8px',padding:'5px 0',borderBottom:'1px solid rgba(30,34,53,0.5)'}}>
                  <span style={{fontSize:'0.875rem',fontWeight:700,color:'#00D4A8',fontFamily:'DM Mono,monospace'}}>{t}</span>
                  <input
                    type='text'
                    defaultValue={base.toFixed(2)}
                    key={t+'-'+(isOverride?baseOverrides[t]:marketBase.toFixed(4))}
                    onBlur={e=>{
                      const v=parseFloat(e.target.value)
                      if(!isNaN(v)&&v>0&&v<20){setBaseOverrides(o=>({...o,[t]:v.toFixed(4)}));setTick(x=>x+1);scheduleDraw()}
                      else e.target.value=base.toFixed(2)
                    }}
                    style={{background:'transparent',
                      border:'1px solid '+(isOverride?'rgba(245,200,66,0.5)':'rgba(30,34,53,0.6)'),
                      borderRadius:'2px',color:isOverride?'#F5C842':'#E8EAF0',
                      fontFamily:'DM Mono,monospace',fontSize:'0.875rem',
                      padding:'4px 8px',outline:'none',textAlign:'right'}}
                  />
                  <span style={{fontSize:'0.8125rem',fontWeight:shBp!==0?700:400,color:shiftClr,
                    fontFamily:'DM Mono,monospace',minWidth:'52px',textAlign:'right'}}>
                    {shBp===0?'\u2014':(shBp>0?'+':'')+shBp.toFixed(1)+'bp'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* RIGHT PANEL — chart + stats */}
        <div style={{display:'flex',flexDirection:'column',overflow:'hidden'}}>

          {/* Stats cards */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'1px',background:'#1E2235',borderBottom:'1px solid #1E2235',flexShrink:0}}>
            {[
              {label:'30Y DISCOUNT FACTOR', value:df30.toFixed(4), color:'#4A9EFF'},
              {label:'5Y ZERO RATE',         value:zero5.toFixed(3)+'%', color:'#00D4A8'},
              {label:'10Y FWD RATE (5Y\xd75Y)',  value:fwd5y5y.toFixed(3)+'%', color:'#F5C842'},
            ].map(s=>(
              <div key={s.label} style={{background:'#07080D',padding:'12px 16px'}}>
                <div style={{fontSize:'0.75rem',fontWeight:600,letterSpacing:'0.08em',color:'#6B7A99',
                  fontFamily:"'Space Grotesk',var(--mono)",marginBottom:'4px'}}>{s.label}</div>
                <div style={{fontSize:'1.25rem',fontWeight:700,color:s.color,fontFamily:'DM Mono,monospace'}}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div style={{flex:1,position:'relative',background:'#0D0F17',overflow:'hidden',minHeight:'200px'}}>
            <canvas ref={canvasRef} style={{display:'block',cursor:'crosshair'}}/>
            {dragTip&&(
              <div style={{position:'absolute',left:dragTip.x,top:dragTip.y,pointerEvents:'none',zIndex:10,
                background:'#0D0F17',border:'1px solid '+(dragTip.bp>=0?'rgba(255,107,107,0.7)':'rgba(74,158,255,0.7)'),
                borderRadius:'3px',padding:'5px 12px',fontSize:'0.875rem',fontFamily:'DM Mono,monospace',
                fontWeight:700,color:dragTip.bp>=0?'#FF6B6B':'#4A9EFF',whiteSpace:'nowrap',
                boxShadow:'0 4px 16px rgba(0,0,0,0.9)'}}>
                {dragTip.bp>=0?'+':''}{dragTip.bp}bp @ {dragTip.tenor}
              </div>
            )}
            {hoverInfo&&!dragTip&&(
              <div style={{position:'absolute',left:Math.min(hoverInfo.x+14,600),top:Math.max(hoverInfo.y-80,4),
                pointerEvents:'none',zIndex:10,background:'#0D0F17',border:'1px solid #1E2235',
                borderRadius:'3px',padding:'10px 14px',minWidth:'160px',boxShadow:'0 4px 20px rgba(0,0,0,0.9)'}}>
                <div style={{fontSize:'0.9375rem',fontWeight:700,letterSpacing:'0.08em',color:'#E8EAF0',
                  fontFamily:'DM Mono,monospace',marginBottom:'7px'}}>{hoverInfo.tenor}</div>
                <div style={{display:'flex',justifyContent:'space-between',gap:'16px',marginBottom:'4px'}}>
                  <span style={{fontSize:'0.8125rem',color:'#6B7A99',fontFamily:"'Space Grotesk',var(--mono)"}}>Base</span>
                  <span style={{fontSize:'0.875rem',fontWeight:600,color:'#00D4A8',fontFamily:'DM Mono,monospace'}}>{hoverInfo.base.toFixed(4)}%</span>
                </div>
                {hoverInfo.bp!==0&&<>
                  <div style={{display:'flex',justifyContent:'space-between',gap:'16px',marginBottom:'4px'}}>
                    <span style={{fontSize:'0.8125rem',color:'#6B7A99',fontFamily:"'Space Grotesk',var(--mono)"}}>Shocked</span>
                    <span style={{fontSize:'0.875rem',fontWeight:600,color:hoverInfo.bp>0?'#FF6B6B':'#4A9EFF',fontFamily:'DM Mono,monospace'}}>{hoverInfo.shocked.toFixed(4)}%</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',gap:'16px',borderTop:'1px solid #1E2235',paddingTop:'5px',marginTop:'4px'}}>
                    <span style={{fontSize:'0.8125rem',color:'#6B7A99',fontFamily:"'Space Grotesk',var(--mono)"}}>Shift</span>
                    <span style={{fontSize:'0.875rem',fontWeight:700,color:hoverInfo.bp>0?'#FF6B6B':'#4A9EFF',fontFamily:'DM Mono,monospace'}}>{hoverInfo.bp>0?'+':''}{hoverInfo.bp}bp</span>
                  </div>
                </>}
              </div>
            )}
            <div style={{position:'absolute',bottom:6,right:12,fontSize:'0.75rem',color:'rgba(107,122,153,0.4)',
              fontFamily:"'Space Grotesk',var(--mono)",pointerEvents:'none'}}>
              Drag any point to reshape \u00b7 Gaussian ripple
            </div>
          </div>

          {/* Impact analytics */}
          {(scenarioBase||scenarioCalc)&&(
            <div style={{flexShrink:0,borderTop:'1px solid #1E2235',
              display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'1px',background:'#1E2235'}}>
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
                  const fmt=n=>n==null?'\u2014':item.dp?(n>=0?'+':'')+n.toFixed(item.dp):item.fmt(n)
                  return(
                    <div key={item.label} style={{background:'#07080D',padding:'10px 14px'}}>
                      <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:3}}>
                        <span style={{fontSize:'0.75rem',fontWeight:600,letterSpacing:'0.08em',color:'#6B7A99',
                          fontFamily:"'Space Grotesk',var(--mono)"}}>{item.label}</span>
                        {item.approx&&item.shocked!=null&&(
                          <button onClick={()=>setThetaApproxVisible(v=>!v)}
                            style={{fontSize:'0.75rem',padding:'1px 5px',borderRadius:'2px',cursor:'pointer',
                              fontFamily:"'Space Grotesk',var(--mono)",border:'1px solid rgba(245,200,66,0.3)',
                              background:'rgba(245,200,66,0.06)',color:'#F5C842'}}>
                            {thetaApproxVisible?'\u25b4':'\u25be'} ~
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
                          borderTop:'1px solid rgba(245,200,66,0.2)',paddingTop:3,fontFamily:"'Space Grotesk',var(--mono)"}}>
                          \u0394Theta \u221d \u0394IR01/IR01 \u2014 directional only
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

`

src = src.slice(0, START) + TAB + src.slice(END)
fs.writeFileSync(TBW, src, 'utf8')
console.log('✅ ScenarioTab redesigned — bootstrapper aesthetic.')
console.log('Lines:', src.split('\n').length)

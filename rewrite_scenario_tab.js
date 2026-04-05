// rewrite_scenario_tab.js
// Completely replaces ScenarioTab with embedded curve designer.
// Chart is the hero. 14-row table is collapsible. Pills row shows shifts.
// Run from: C:\Users\mikod\OneDrive\Desktop\Rijeka

const fs   = require('fs')
const path = require('path')

const TBW = path.join('C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src\\components\\blotter\\TradeBookingWindow.jsx')
let src = fs.readFileSync(TBW, 'utf8')

const START = src.indexOf('function ScenarioTab(')
const END   = src.indexOf('\nexport default function TradeBookingWindow(')

if (START === -1 || END === -1) { console.error('Boundaries not found'); process.exit(1) }

const NEW_SCENARIO_TAB = `function ScenarioTab({ ccy, index, dir, struct, effDate, matDate, valDate, curves, analytics,
  notionalRef, rateRef, fixedPayFreq, fixedDc, fixedBdc, floatResetFreq, floatPayFreq, floatDc, floatBdc, getSession }) {

  const TENORS  = ['1W','1M','3M','6M','1Y','2Y','3Y','4Y','5Y','7Y','10Y','15Y','20Y','30Y']
  const TENOR_Y = {'1W':0.02,'1M':0.083,'3M':0.25,'6M':0.5,'1Y':1,'2Y':2,'3Y':3,'4Y':4,'5Y':5,'7Y':7,'10Y':10,'15Y':15,'20Y':20,'30Y':30}
  const PRESETS = {
    flat0:TENORS.map(()=>0), up25:TENORS.map(()=>25), up50:TENORS.map(()=>50), up100:TENORS.map(()=>100),
    dn25:TENORS.map(()=>-25), dn50:TENORS.map(()=>-50), dn100:TENORS.map(()=>-100),
    bear_steep:TENORS.map(t=>TENOR_Y[t]<=2?50:100), bull_flat:TENORS.map(t=>TENOR_Y[t]<=2?-25:-75),
    bear_flat:TENORS.map(t=>TENOR_Y[t]<=2?100:50),  bull_steep:TENORS.map(t=>TENOR_Y[t]<=2?-75:-25),
    hike25:TENORS.map(t=>TENOR_Y[t]<=1?25:TENOR_Y[t]<=3?10:0),
    cut25:TENORS.map(t=>TENOR_Y[t]<=1?-25:TENOR_Y[t]<=3?-10:0),
    hike_cycle:TENORS.map(t=>Math.max(0,Math.round(100-TENOR_Y[t]*3.5))),
  }
  const CAP   = 300
  const BPpx  = 0.4
  const curveId = CCY_CURVE[ccy] || 'USD_SOFR'

  // ── Canvas refs (mutable, used in event handlers) ─────────────────
  const canvasRef  = useRef(null)
  const shiftsRef  = useRef(TENORS.map(()=>0))
  const sigmaRef   = useRef(4)
  const dragRef    = useRef(null)
  const rafRef     = useRef(null)

  // ── UI state ──────────────────────────────────────────────────────
  const [presetKey,    setPresetKey]    = useState('flat0')
  const [sigma,        setSigma]        = useState(4)
  const [interpMode,   setInterpMode]   = useState('LOG_LINEAR')
  const [confirmed,    setConfirmed]    = useState(true)
  const [dragTip,      setDragTip]      = useState(null)
  const [showDetail,   setShowDetail]   = useState(false)
  const [tick,         setTick]         = useState(0)
  const [scenarioBase, setScenarioBase] = useState(null)
  const [scenarioCalc, setScenarioCalc] = useState(null)
  const [scenarioPricing,setScenarioPricing] = useState(false)
  const [thetaApproxVisible,setThetaApproxVisible] = useState(false)

  // ── Base rates from store or analytics pillars ────────────────────
  const getBase = (t) => {
    const curve = curves.find(c => c.id === curveId)
    if (curve && curve.instruments) {
      const inst = curve.instruments.find(i => i.tenor === t)
      if (inst && inst.quote != null) return parseFloat(inst.quote)
    }
    if (analytics && analytics.curve_pillars && analytics.curve_pillars[curveId]) {
      const pillars = analytics.curve_pillars[curveId]
      const ty = TENOR_Y[t]
      const near = pillars.reduce((a,b)=>Math.abs(b.t-ty)<Math.abs(a.t-ty)?b:a, pillars[0])
      if (near) return near.zero_rate
    }
    return 3.665
  }

  // ── Draw ──────────────────────────────────────────────────────────
  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width/2, H = canvas.height/2
    const PAD = {l:56,r:20,t:26,b:40}
    const CW = W-PAD.l-PAD.r, CH = H-PAD.t-PAD.b
    const sh = shiftsRef.current
    const baseRts  = TENORS.map(t=>getBase(t))
    const shockRts = TENORS.map((t,i)=>getBase(t)+Math.max(-CAP,Math.min(CAP,sh[i]))/100)
    const midR     = baseRts.reduce((a,b)=>a+b,0)/baseRts.length
    const visHalf  = Math.max(0.75, Math.max(...sh.map(Math.abs))/100+0.3)
    const minR = midR-visHalf, maxR = midR+visHalf
    const xS = t => PAD.l + Math.sqrt(t/30)*CW
    const yS = r => PAD.t + CH - (r-minR)/(maxR-minR)*CH

    ctx.clearRect(0,0,W,H)
    ctx.font = '10px JetBrains Mono'

    // Y grid
    const gStep = visHalf>0.6?0.25:0.1
    for(let r=Math.ceil(minR/gStep)*gStep; r<=maxR+0.001; r=Math.round((r+gStep)*10000)/10000){
      const y=yS(r); if(y<PAD.t-2||y>H-PAD.b+2)continue
      ctx.strokeStyle='#1a2a3a'; ctx.lineWidth=0.5
      ctx.beginPath(); ctx.moveTo(PAD.l,y); ctx.lineTo(W-PAD.r,y); ctx.stroke()
      ctx.fillStyle='#526878'; ctx.textAlign='right'; ctx.textBaseline='middle'
      ctx.fillText(r.toFixed(2)+'%',PAD.l-4,y)
    }
    ctx.strokeStyle='#1e3045'; ctx.lineWidth=0.5
    ctx.beginPath(); ctx.moveTo(PAD.l,H-PAD.b); ctx.lineTo(W-PAD.r,H-PAD.b); ctx.stroke()
    ctx.textAlign='center'; ctx.textBaseline='top'; ctx.fillStyle='#526878'
    ;['1M','6M','1Y','2Y','5Y','10Y','20Y','30Y'].forEach(t=>{
      const x=xS(TENOR_Y[t])
      ctx.fillText(t,x,H-PAD.b+6)
      ctx.strokeStyle='#1e3045'; ctx.lineWidth=0.3
      ctx.beginPath(); ctx.moveTo(x,H-PAD.b); ctx.lineTo(x,H-PAD.b+4); ctx.stroke()
    })

    const avgSh  = sh.reduce((a,b)=>a+b,0)/sh.length
    const shClr  = avgSh<=0?'#0dd4a8':'#e05040'
    const anyShift = sh.some(s=>Math.abs(s)>0.05)

    if(anyShift){
      ctx.beginPath()
      TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(baseRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
      ;[...TENORS].reverse().forEach(t=>{const i=TENORS.indexOf(t);ctx.lineTo(xS(TENOR_Y[t]),yS(shockRts[i]))})
      ctx.closePath()
      ctx.fillStyle=avgSh>0?'rgba(224,80,64,0.06)':'rgba(13,212,168,0.06)'; ctx.fill()
    }

    ctx.setLineDash([]); ctx.strokeStyle='#0dd4a8'; ctx.lineWidth=1.5
    ctx.beginPath()
    TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(baseRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
    ctx.stroke()
    TENORS.forEach((t,i)=>{ctx.beginPath();ctx.arc(xS(TENOR_Y[t]),yS(baseRts[i]),2.5,0,Math.PI*2);ctx.fillStyle='#0dd4a8';ctx.fill()})

    ctx.setLineDash([5,2.5]); ctx.strokeStyle=shClr; ctx.lineWidth=1.5
    ctx.beginPath()
    TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(shockRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
    ctx.stroke(); ctx.setLineDash([])

    TENORS.forEach((t,i)=>{
      const cx=xS(TENOR_Y[t]),cy=yS(shockRts[i]),cyB=yS(baseRts[i]),bp=Math.round(sh[i])
      if(Math.abs(bp)>0.5){
        ctx.strokeStyle=bp>0?'rgba(224,80,64,0.3)':'rgba(13,212,168,0.3)'; ctx.lineWidth=0.8; ctx.setLineDash([2,2])
        ctx.beginPath(); ctx.moveTo(cx,cyB); ctx.lineTo(cx,cy); ctx.stroke(); ctx.setLineDash([])
      }
      const isActive=dragRef.current?.idx===i
      ctx.beginPath(); ctx.arc(cx,cy,isActive?7:5,0,Math.PI*2); ctx.fillStyle=shClr; ctx.fill()
      if(isActive){ctx.beginPath();ctx.arc(cx,cy,7,0,Math.PI*2);ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke()}
      if(Math.abs(bp)>0.5&&!dragRef.current){
        ctx.font='9px JetBrains Mono'; ctx.fillStyle=bp>0?'#e05040':'#0dd4a8'
        ctx.textAlign='center'; ctx.textBaseline='bottom'
        ctx.fillText((bp>0?'+':'')+bp+'bp',cx,cy-9)
      }
    })

    ctx.font='10px JetBrains Mono'; ctx.textBaseline='middle'; ctx.setLineDash([])
    ctx.strokeStyle='#0dd4a8'; ctx.lineWidth=1.5
    ctx.beginPath(); ctx.moveTo(PAD.l,PAD.t-10); ctx.lineTo(PAD.l+22,PAD.t-10); ctx.stroke()
    ctx.fillStyle='#0dd4a8'; ctx.textAlign='left'; ctx.fillText('BASE',PAD.l+26,PAD.t-10)
    ctx.setLineDash([4,2]); ctx.strokeStyle=shClr
    ctx.beginPath(); ctx.moveTo(PAD.l+70,PAD.t-10); ctx.lineTo(PAD.l+92,PAD.t-10); ctx.stroke(); ctx.setLineDash([])
    ctx.fillStyle=shClr; ctx.fillText('SHOCKED',PAD.l+96,PAD.t-10)
    if(anyShift){
      const avgBp=Math.round(avgSh)
      ctx.fillStyle=avgBp>0?'#e05040':'#0dd4a8'; ctx.textAlign='right'
      ctx.fillText((avgBp>0?'+':'')+avgBp+'bp AVG',W-PAD.r,PAD.t-10)
    }
  }

  const scheduleDraw = () => {
    if(rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(draw)
  }

  const sizeCanvas = () => {
    const canvas=canvasRef.current; if(!canvas)return
    const p=canvas.parentElement
    canvas.width=p.offsetWidth*2; canvas.height=p.offsetHeight*2
    canvas.style.width=p.offsetWidth+'px'; canvas.style.height=p.offsetHeight+'px'
    const ctx=canvas.getContext('2d'); ctx.setTransform(1,0,0,1,0,0); ctx.scale(2,2)
    scheduleDraw()
  }

  useEffect(()=>{ sizeCanvas() }, [tick])
  useEffect(()=>{ const t=setTimeout(sizeCanvas,50); return()=>clearTimeout(t) }, [])

  // Canvas events — attached once, all mutable via refs
  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas)return
    const getHit=(mx,my)=>{
      const rect=canvas.getBoundingClientRect()
      const W=rect.width,H=rect.height,PAD={l:56,r:20,t:26,b:40},CW=W-PAD.l-PAD.r,CH=H-PAD.t-PAD.b
      const sh=shiftsRef.current
      const baseRts=TENORS.map(t=>getBase(t))
      const shockRts=TENORS.map((t,i)=>getBase(t)+Math.max(-CAP,Math.min(CAP,sh[i]))/100)
      const midR=baseRts.reduce((a,b)=>a+b,0)/baseRts.length
      const visHalf=Math.max(0.75,Math.max(...sh.map(Math.abs))/100+0.3)
      const minR=midR-visHalf,maxR=midR+visHalf
      const xS=t=>PAD.l+Math.sqrt(t/30)*CW
      const yS=r=>PAD.t+CH-(r-minR)/(maxR-minR)*CH
      let bi=-1,bd=9999
      TENORS.forEach((t,i)=>{const d=Math.hypot(mx-xS(TENOR_Y[t]),my-yS(shockRts[i]));if(d<bd){bd=d;bi=i}})
      return bd<30?bi:-1
    }
    const onDown=e=>{
      const r=canvas.getBoundingClientRect()
      const idx=getHit(e.clientX-r.left,e.clientY-r.top)
      if(idx>=0){e.preventDefault();dragRef.current={idx,startY:e.clientY,origShifts:[...shiftsRef.current]};scheduleDraw()}
    }
    const onMove=e=>{
      const r=canvas.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top
      if(dragRef.current){
        const{idx,startY,origShifts}=dragRef.current
        const dy=startY-e.clientY,bpDelta=dy*BPpx,sig=sigmaRef.current,dty=TENOR_Y[TENORS[idx]]
        const newShifts=origShifts.map((s,i)=>{
          const dist=TENOR_Y[TENORS[i]]-dty
          return Math.max(-CAP,Math.min(CAP,Math.round((s+bpDelta*Math.exp(-(dist*dist)/(2*sig*sig)))*10)/10))
        })
        shiftsRef.current=newShifts
        setDragTip({x:mx+16,y:my-32,bp:Math.round(newShifts[idx]),tenor:TENORS[idx]})
        scheduleDraw(); return
      }
      canvas.style.cursor=getHit(mx,my)>=0?'ns-resize':'crosshair'
    }
    const onUp=()=>{
      if(dragRef.current){dragRef.current=null;setDragTip(null);setConfirmed(false);setTick(t=>t+1);scheduleDraw()}
    }
    canvas.addEventListener('mousedown',onDown)
    canvas.addEventListener('mousemove',onMove)
    window.addEventListener('mouseup',onUp)
    return()=>{canvas.removeEventListener('mousedown',onDown);canvas.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp)}
  },[])

  // ── Run scenario against backend ──────────────────────────────────
  const handleRunScenario = async (overrides) => {
    if (!effDate || !matDate) return
    setScenarioPricing(true); setScenarioBase(null); setScenarioCalc(null)
    try {
      const session = await getSession()
      const h = { Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' }
      const notional  = parseFloat(notionalRef.current ? notionalRef.current.value.replace(/,/g,'') : '10000000')
      const rateVal   = parseFloat(rateRef.current ? rateRef.current.value : '0')
      const payLag    = INDEX_PAY_LAG[index] != null ? INDEX_PAY_LAG[index] : 2
      const forecastId= INDEX_CURVE[index] || curveId
      const isOIS     = struct === 'OIS'
      const legs = [
        { leg_ref:'FIXED-1',leg_seq:1,leg_type:'FIXED',direction:dir,currency:ccy,notional,
          effective_date:effDate,maturity_date:matDate,day_count:fixedDc,payment_frequency:fixedPayFreq,
          bdc:fixedBdc,payment_lag:payLag,fixed_rate:isNaN(rateVal)?0:rateVal/100,
          discount_curve_id:curveId,forecast_curve_id:null },
        { leg_ref:'FLOAT-1',leg_seq:2,leg_type:'FLOAT',direction:dir==='PAY'?'RECEIVE':'PAY',
          currency:ccy,notional,effective_date:effDate,maturity_date:matDate,
          day_count:floatDc,payment_frequency:floatPayFreq,reset_frequency:isOIS?'DAILY':floatResetFreq,
          bdc:floatBdc,payment_lag:payLag,fixed_rate:0,spread:0,leverage:1.0,
          discount_curve_id:curveId,forecast_curve_id:forecastId,ois_compounding:isOIS?'COMPOUNDING':null },
      ]
      const curveStore = curves.find(c=>c.id===curveId)
      const onInst = curveStore?.instruments?.find(i=>i.tenor==='ON')
      const onRate = onInst?.quote ? parseFloat(onInst.quote)/100 : 0.0365
      const shockedQuotes = [{tenor:'ON',quote_type:'DEPOSIT',rate:onRate}]
      TENORS.forEach((t,i)=>{
        const base=getBase(t)
        const finalRate = overrides && overrides[t]!=null ? parseFloat(overrides[t]) : base+shiftsRef.current[i]/100
        shockedQuotes.push({tenor:t,quote_type:'OIS_SWAP',rate:finalRate/100})
      })
      const [baseRes,shockedRes] = await Promise.all([
        fetch(API+'/price/preview',{method:'POST',headers:h,body:JSON.stringify({legs,valuation_date:valDate,curves:[{curve_id:curveId,quotes:[]}]})}),
        fetch(API+'/price/preview',{method:'POST',headers:h,body:JSON.stringify({legs,valuation_date:valDate,curves:[{curve_id:curveId,quotes:shockedQuotes}]})}),
      ])
      if(baseRes.ok)    setScenarioBase(await baseRes.json())
      if(shockedRes.ok) setScenarioCalc(await shockedRes.json())
    } catch(e){ console.error('[SCENARIO]',e) }
    finally{ setScenarioPricing(false) }
  }

  const applyPreset = key => {
    setPresetKey(key)
    shiftsRef.current = [...(PRESETS[key]||PRESETS.flat0)]
    setConfirmed(false); setTick(t=>t+1); scheduleDraw()
  }

  const handleReset = () => {
    shiftsRef.current = TENORS.map(()=>0)
    setPresetKey('flat0'); setConfirmed(true)
    setScenarioBase(null); setScenarioCalc(null)
    setTick(t=>t+1); scheduleDraw()
  }

  const handleConfirmShape = () => {
    setConfirmed(true)
    const overrides = {}
    TENORS.forEach((t,i)=>{ overrides[t] = (getBase(t)+shiftsRef.current[i]/100).toFixed(5) })
    handleRunScenario(overrides)
  }

  const sh = shiftsRef.current
  const anyShift = sh.some(s=>Math.abs(s)>0.05)
  const avgBp = Math.round(sh.reduce((a,b)=>a+b,0)/TENORS.length)

  const fmtPnl = n => n==null?'—':(n>=0?'+':'-')+'$'+Math.abs(Math.round(n)).toLocaleString('en-US')
  const fmtG   = n => n==null?'—':(n>=0?'+':'')+n.toFixed(4)
  const inp = {background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',
    color:'var(--text)',fontFamily:'var(--mono)',fontSize:'0.44rem',padding:'4px 7px',outline:'none'}

  return (
    <div className='tbw-no-drag' style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

      {/* Notice */}
      <div style={{background:'rgba(240,160,32,0.06)',borderBottom:'1px solid rgba(240,160,32,0.2)',
        padding:'4px 14px',fontSize:'0.38rem',color:'var(--amber)',letterSpacing:'0.05em',flexShrink:0}}>
        ⚠ SCENARIO MODE — Drag curve points to reshape. Confirm once to reprice. Changes are not saved to Configurations.
      </div>

      {/* Compact toolbar */}
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'6px 14px',
        borderBottom:'1px solid var(--border)',flexShrink:0,flexWrap:'wrap'}}>
        <span style={{fontSize:'0.36rem',color:'var(--text-dim)',letterSpacing:'0.08em'}}>PRESET</span>
        <select value={presetKey} onChange={e=>applyPreset(e.target.value)} style={{...inp,width:'155px'}}>
          <optgroup label="\u2500\u2500 PARALLEL SHIFTS \u2500\u2500">
            <option value="flat0">Base (no shift)</option>
            <option value="up25">+25bp</option><option value="up50">+50bp</option><option value="up100">+100bp</option>
            <option value="dn25">\u221225bp</option><option value="dn50">\u221250bp</option><option value="dn100">\u2212100bp</option>
          </optgroup>
          <optgroup label="\u2500\u2500 CURVE RESHAPING \u2500\u2500">
            <option value="bear_steep">Bear Steepener</option><option value="bull_flat">Bull Flattener</option>
            <option value="bear_flat">Bear Flattener</option><option value="bull_steep">Bull Steepener</option>
          </optgroup>
          <optgroup label="\u2500\u2500 CENTRAL BANK \u2500\u2500">
            <option value="hike25">Fed Hike +25bp</option><option value="cut25">Fed Cut \u221225bp</option>
            <option value="hike_cycle">Fed Hike Cycle</option>
          </optgroup>
        </select>

        <span style={{fontSize:'0.36rem',color:'var(--text-dim)',letterSpacing:'0.08em'}}>RIPPLE</span>
        <input type='range' min='1' max='10' value={sigma} step='1' style={{width:70,accentColor:'var(--accent)'}}
          onChange={e=>{const v=parseFloat(e.target.value);setSigma(v);sigmaRef.current=v}}/>
        <span style={{fontSize:'0.42rem',color:'var(--blue)',minWidth:'24px'}}>{sigma}Y</span>

        <span style={{fontSize:'0.36rem',color:'var(--text-dim)',letterSpacing:'0.08em'}}>INTERP</span>
        <select value={interpMode} onChange={e=>setInterpMode(e.target.value)} style={{...inp,width:'130px'}}>
          <option value="LOG_LINEAR">Log-Linear (default)</option>
          <option value="LINEAR_ZERO">Linear Zero Rates</option>
          <option value="CUBIC_SPLINE">Cubic Spline</option>
          <option value="STEP">Step Function</option>
        </select>
        {interpMode!=='LOG_LINEAR'&&(
          <span style={{fontSize:'0.34rem',fontWeight:700,padding:'2px 5px',borderRadius:'2px',
            border:'1px solid rgba(240,160,32,0.3)',background:'rgba(240,160,32,0.06)',color:'var(--amber)'}}>
            SCENARIO ONLY
          </span>
        )}
        <button onClick={handleReset}
          style={{padding:'3px 10px',borderRadius:'2px',cursor:'pointer',fontFamily:'var(--mono)',
            fontSize:'0.38rem',fontWeight:700,letterSpacing:'0.06em',marginLeft:'auto',
            border:'1px solid rgba(82,104,120,0.4)',background:'rgba(82,104,120,0.06)',color:'var(--text-dim)'}}>
          RESET
        </button>
      </div>

      {/* Hero chart */}
      <div style={{flex:'1 1 220px',position:'relative',background:'#070d12',minHeight:'220px',overflow:'hidden'}}>
        <canvas ref={canvasRef} style={{display:'block',cursor:'crosshair'}}/>
        {dragTip&&(
          <div style={{position:'absolute',left:dragTip.x,top:dragTip.y,pointerEvents:'none',zIndex:10,
            background:'var(--panel)',
            border:'1px solid '+(dragTip.bp>=0?'rgba(224,80,64,0.7)':'rgba(13,212,168,0.7)'),
            borderRadius:'2px',padding:'3px 10px',fontSize:'0.44rem',fontFamily:'var(--mono)',
            fontWeight:700,color:dragTip.bp>=0?'var(--red)':'var(--accent)',
            whiteSpace:'nowrap',boxShadow:'0 4px 16px rgba(0,0,0,0.9)'}}>
            {dragTip.bp>=0?'+':''}{dragTip.bp}bp @ {dragTip.tenor}
          </div>
        )}
        <div style={{position:'absolute',bottom:5,left:'50%',transform:'translateX(-50%)',
          fontSize:'0.32rem',color:'rgba(82,104,120,0.4)',fontFamily:'var(--mono)',
          letterSpacing:'0.06em',whiteSpace:'nowrap',pointerEvents:'none'}}>
          DRAG ANY TENOR POINT \u00b7 RIPPLE CONTROLS SPREAD \u00b7 \u00b1300bp CAP
        </div>
      </div>

      {/* Tenor pills row */}
      <div style={{display:'flex',gap:'1px',borderTop:'1px solid var(--border)',
        flexShrink:0,background:'var(--border)',overflowX:'auto'}}>
        {TENORS.map((t,i)=>{
          const bp=Math.round(sh[i])
          const clr=bp>0?'var(--red)':bp<0?'var(--accent)':'var(--text-dim)'
          return(
            <div key={t} style={{background:'var(--bg)',padding:'4px 8px',minWidth:'50px',textAlign:'center',flexShrink:0}}>
              <div style={{fontSize:'0.32rem',color:'var(--text-dim)',marginBottom:'1px',fontFamily:'var(--mono)'}}>{t}</div>
              <div style={{fontSize:'0.40rem',fontWeight:700,fontFamily:'var(--mono)',color:clr}}>
                {bp===0?'\u2014':(bp>0?'+':'')+bp+'bp'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Collapsible curve detail table */}
      <div style={{flexShrink:0,borderTop:'1px solid var(--border)'}}>
        <button
          onClick={()=>setShowDetail(v=>!v)}
          style={{width:'100%',padding:'5px 14px',background:'var(--bg)',border:'none',
            borderBottom:showDetail?'1px solid var(--border)':'none',
            cursor:'pointer',fontFamily:'var(--mono)',fontSize:'0.38rem',
            color:'var(--text-dim)',fontWeight:700,letterSpacing:'0.08em',
            display:'flex',alignItems:'center',gap:'6px',justifyContent:'flex-start'}}>
          <span style={{color:showDetail?'var(--accent)':'var(--text-dim)'}}>{showDetail?'\u25be':'\u25b8'}</span>
          CURVE DETAIL
          <span style={{fontWeight:400,opacity:0.5,marginLeft:'4px'}}>base rate \u00b7 shift \u00b7 shocked rate \u00b7 zero rate \u00b7 DF \u00b7 DF change</span>
        </button>
        {showDetail&&(
          <div style={{overflowX:'auto',maxHeight:'180px',overflowY:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',minWidth:'580px'}}>
              <thead>
                <tr style={{background:'var(--bg)',position:'sticky',top:0}}>
                  {['TENOR','BASE RATE','SHIFT (bp)','SHOCKED RATE','ZERO RATE','DF','DF CHANGE'].map((h,hi)=>(
                    <th key={h} style={{fontSize:'0.34rem',color:'var(--text-dim)',padding:'4px 6px',
                      textAlign:hi===0?'left':'right',fontWeight:400,letterSpacing:'0.07em',
                      borderBottom:'1px solid var(--border)'}}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {TENORS.map((t,i)=>{
                  const base    = getBase(t)
                  const shiftBp = Math.max(-CAP,Math.min(CAP,sh[i]))
                  const shocked = base + shiftBp/100
                  const yr      = TENOR_Y[t]
                  const dfBase  = Math.exp(-base/100*yr)
                  const dfShock = Math.exp(-shocked/100*yr)
                  const dfDelta = dfShock - dfBase
                  return(
                    <tr key={t} style={{borderBottom:'1px solid rgba(30,48,69,0.4)'}}>
                      <td style={{fontSize:'0.40rem',padding:'3px 6px',color:'var(--text-dim)',fontFamily:'var(--mono)'}}>{t}</td>
                      <td style={{fontSize:'0.40rem',padding:'3px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--blue)'}}>{base.toFixed(5)}%</td>
                      <td style={{fontSize:'0.40rem',padding:'3px 6px',textAlign:'right',fontFamily:'var(--mono)',
                        fontWeight:shiftBp!==0?700:400,
                        color:shiftBp>0?'var(--red)':shiftBp<0?'var(--accent)':'var(--text-dim)'}}>
                        {shiftBp>0?'+':''}{shiftBp}
                      </td>
                      <td style={{fontSize:'0.40rem',padding:'3px 6px',textAlign:'right',fontFamily:'var(--mono)',
                        color:shiftBp>0?'var(--red)':shiftBp<0?'var(--accent)':'var(--blue)'}}>
                        {shocked.toFixed(5)}%
                      </td>
                      <td style={{fontSize:'0.40rem',padding:'3px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text-dim)'}}>{shocked.toFixed(4)}%</td>
                      <td style={{fontSize:'0.40rem',padding:'3px 6px',textAlign:'right',fontFamily:'var(--mono)',color:'var(--text-dim)'}}>{dfShock.toFixed(6)}</td>
                      <td style={{fontSize:'0.38rem',padding:'3px 6px',textAlign:'right',fontFamily:'var(--mono)',
                        color:dfDelta<0?'var(--red)':'var(--accent)'}}>
                        {Math.abs(dfDelta)>0.000001?(dfDelta>=0?'+':'')+dfDelta.toFixed(6):'—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Impact analytics — shown after RUN */}
      {(scenarioBase||scenarioCalc)&&(
        <div style={{flexShrink:0,borderTop:'1px solid var(--border)'}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'1px',background:'var(--border)'}}>
            {(()=>{
              const baseTheta=scenarioBase?.theta,baseIR01=scenarioBase?.ir01,shockIR01=scenarioCalc?.ir01
              const approxTheta=(baseTheta!=null&&baseIR01&&shockIR01)
                ?baseTheta+baseTheta*((shockIR01-baseIR01)/Math.abs(baseIR01)):null
              const items=[
                {label:'NET NPV', base:scenarioBase?.npv,   shocked:scenarioCalc?.npv,  approx:false},
                {label:'IR01',    base:scenarioBase?.ir01,  shocked:scenarioCalc?.ir01, approx:false},
                {label:'GAMMA',   base:scenarioBase?.gamma, shocked:scenarioCalc?.gamma,approx:false,dp:4},
                {label:'THETA',   base:baseTheta,           shocked:approxTheta,        approx:true},
              ]
              return items.map(item=>{
                const delta=item.shocked!=null&&item.base!=null?item.shocked-item.base:null
                const fmt=n=>n==null?'—':item.dp?(n>=0?'+':'')+n.toFixed(item.dp):fmtPnl(n)
                const shClr=item.shocked>=0?'var(--accent)':'var(--red)'
                const dClr=delta!=null&&delta>=0?'var(--accent)':'var(--red)'
                return(
                  <div key={item.label} style={{background:'var(--bg)',padding:'6px 10px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:'4px',marginBottom:'2px'}}>
                      <span style={{fontSize:'0.34rem',color:'var(--text-dim)',letterSpacing:'0.08em'}}>{item.label}</span>
                      {item.approx&&item.shocked!=null&&(
                        <button onClick={()=>setThetaApproxVisible(v=>!v)}
                          style={{fontSize:'0.30rem',padding:'1px 4px',borderRadius:'2px',cursor:'pointer',
                            fontFamily:'var(--mono)',border:'1px solid rgba(240,160,32,0.4)',
                            background:'rgba(240,160,32,0.06)',color:'var(--amber)'}}>
                          {thetaApproxVisible?'\u25b4':'\u25be'} APPROX
                        </button>
                      )}
                    </div>
                    <div style={{fontSize:'0.46rem',fontWeight:700,fontFamily:'var(--mono)',color:'var(--blue)'}}>{fmt(item.base)}</div>
                    {item.shocked!=null&&<>
                      <div style={{fontSize:'0.46rem',fontWeight:700,fontFamily:'var(--mono)',color:shClr}}>
                        {fmt(item.shocked)}{item.approx&&<span style={{fontSize:'0.30rem',color:'var(--amber)',marginLeft:'2px'}}>~</span>}
                      </div>
                      {delta!=null&&<div style={{fontSize:'0.34rem',marginTop:'1px',fontFamily:'var(--mono)',color:dClr}}>
                        {delta>=0?'+':''}{fmt(delta)}{item.approx&&<span style={{color:'var(--amber)'}}> ~</span>}
                      </div>}
                      {item.approx&&thetaApproxVisible&&(
                        <div style={{fontSize:'0.30rem',color:'var(--amber)',marginTop:'2px',lineHeight:1.5,
                          borderTop:'1px solid rgba(240,160,32,0.2)',paddingTop:'2px',fontFamily:'var(--mono)'}}>
                          \u0394Theta \u221d \u0394IR01/IR01. Directional only.
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

      {/* Confirm bar */}
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',
        borderTop:'1px solid var(--border)',background:'#070d12',flexShrink:0}}>
        <span style={{fontSize:'0.36rem',color:'var(--text-dim)',fontFamily:'var(--mono)',letterSpacing:'0.05em'}}>
          DRAG POINTS TO SHAPE \u00b7 CONFIRM ONCE TO REPRICE
        </span>
        {anyShift&&!confirmed&&(
          <span style={{fontSize:'0.34rem',fontWeight:700,padding:'2px 7px',borderRadius:'2px',
            background:'rgba(240,160,32,0.08)',border:'1px solid rgba(240,160,32,0.35)',
            color:'var(--amber)',fontFamily:'var(--mono)',whiteSpace:'nowrap'}}>
            UNSAVED SHAPE
          </span>
        )}
        {scenarioPricing&&(
          <span style={{fontSize:'0.38rem',color:'var(--accent)',fontFamily:'var(--mono)'}}>REPRICING...</span>
        )}
        <button onClick={handleConfirmShape} disabled={!anyShift||confirmed||scenarioPricing}
          style={{padding:'5px 16px',borderRadius:'2px',
            cursor:(!anyShift||confirmed||scenarioPricing)?'not-allowed':'pointer',
            fontFamily:'var(--mono)',fontSize:'0.42rem',fontWeight:700,letterSpacing:'0.08em',
            whiteSpace:'nowrap',marginLeft:'auto',transition:'all 0.15s',
            border:anyShift&&!confirmed?'1px solid rgba(240,160,32,0.6)':'1px solid rgba(82,104,120,0.4)',
            background:anyShift&&!confirmed?'rgba(240,160,32,0.1)':'rgba(82,104,120,0.06)',
            color:anyShift&&!confirmed?'var(--amber)':'var(--text-dim)'}}>
          {anyShift&&!confirmed
            ? 'CONFIRM SHAPE ('+(avgBp>0?'+':'')+avgBp+'bp avg) \u2192'
            : 'CONFIRM SHAPE'}
        </button>
      </div>
    </div>
  )
}

`

src = src.slice(0, START) + NEW_SCENARIO_TAB + src.slice(END)
fs.writeFileSync(TBW, src, 'utf8')
console.log('✅ ScenarioTab rewritten with embedded curve designer.')
console.log('Lines:', src.split('\n').length)
console.log('')
console.log('What changed:')
console.log('  Chart is now embedded inline — no pop-out window')
console.log('  Hero chart takes 220px+ of height, fully draggable')
console.log('  Tenor pills row: slim single row showing shifts at a glance')
console.log('  CURVE DETAIL: collapsible toggle (base, shift, shocked, zero, DF, DF change)')
console.log('  CONFIRM SHAPE: triggers backend reprice once, shows impact analytics')
console.log('  No RUN button — confirm shape does everything')

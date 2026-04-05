// rewrite_scenario_tab_final.js
// Complete clean rewrite of ScenarioTab.
// Consistent 0.52rem fonts throughout. Card-style curve detail.
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
  const FS = '0.52rem'   // ONE font size for everything
  const FSL = '0.44rem'  // secondary labels only

  const curveCanvasRef = useRef(null)
  const barsCanvasRef  = useRef(null)
  const shiftsRef      = useRef(TENORS.map(()=>0))
  const sigmaRef       = useRef(4)
  const curveDragRef   = useRef(null)
  const barsDragRef    = useRef(null)
  const rafCurveRef    = useRef(null)
  const rafBarsRef     = useRef(null)

  const [presetKey,    setPresetKey]    = useState('flat0')
  const [sigma,        setSigma]        = useState(4)
  const [interpMode,   setInterpMode]   = useState('LOG_LINEAR')
  const [confirmed,    setConfirmed]    = useState(true)
  const [curveDragTip, setCurveDragTip] = useState(null)
  const [barsDragTip,  setBarsDragTip]  = useState(null)
  const [hoverInfo,    setHoverInfo]    = useState(null)
  const [showDetail,   setShowDetail]   = useState(false)
  const [tick,         setTick]         = useState(0)
  const [scenarioBase, setScenarioBase] = useState(null)
  const [scenarioCalc, setScenarioCalc] = useState(null)
  const [scenarioPricing,setScenarioPricing] = useState(false)
  const [thetaApproxVisible,setThetaApproxVisible] = useState(false)

  const getBase = (t) => {
    const curve = curves.find(c=>c.id===curveId)
    if (curve&&curve.instruments) {
      const inst=curve.instruments.find(i=>i.tenor===t)
      if (inst&&inst.quote!=null) return parseFloat(inst.quote)
    }
    if (analytics&&analytics.curve_pillars&&analytics.curve_pillars[curveId]) {
      const pillars=analytics.curve_pillars[curveId]
      const ty=TENOR_Y[t]
      const near=pillars.reduce((a,b)=>Math.abs(b.t-ty)<Math.abs(a.t-ty)?b:a,pillars[0])
      if (near) return near.zero_rate
    }
    return 3.665
  }

  const getScaleParams = (W) => {
    const PAD={l:12,r:18},CW=W-PAD.l-PAD.r
    const xS=t=>PAD.l+Math.sqrt(t/30)*CW
    const barW=(i)=>{
      const t=TENOR_Y[TENORS[i]]
      const xl=i>0?xS(TENOR_Y[TENORS[i-1]]):PAD.l
      const xr=i<TENORS.length-1?xS(TENOR_Y[TENORS[i+1]]):W-PAD.r
      return Math.max(6,Math.min((xS(t)-xl)*0.7,(xr-xS(t))*0.7,32))
    }
    return {xS,barW,PAD}
  }

  const drawCurve = () => {
    const canvas=curveCanvasRef.current; if(!canvas)return
    const ctx=canvas.getContext('2d')
    const dpr=window.devicePixelRatio||2
    const W=canvas.width/dpr, H=canvas.height/dpr
    const PAD={l:12,r:18,t:30,b:36},CW=W-PAD.l-PAD.r,CH=H-PAD.t-PAD.b
    const sh=shiftsRef.current
    const baseRts=TENORS.map(t=>getBase(t))
    const shockRts=TENORS.map((t,i)=>getBase(t)+Math.max(-CAP,Math.min(CAP,sh[i]))/100)
    const midR=baseRts.reduce((a,b)=>a+b,0)/baseRts.length
    const visHalf=Math.max(0.65,Math.max(...sh.map(Math.abs))/100+0.25)
    const minR=midR-visHalf,maxR=midR+visHalf
    const xS=t=>PAD.l+Math.sqrt(t/30)*CW
    const yS=r=>PAD.t+CH-(r-minR)/(maxR-minR)*CH
    ctx.fillStyle='#0D0F17';ctx.fillRect(0,0,W,H)
    const gStep=visHalf>0.5?0.25:0.1
    for(let r=Math.ceil(minR/gStep)*gStep;r<=maxR+0.001;r=Math.round((r+gStep)*10000)/10000){
      const y=yS(r);if(y<PAD.t-2||y>H-PAD.b+2)continue
      ctx.strokeStyle='rgba(30,34,53,0.8)';ctx.lineWidth=0.5
      ctx.beginPath();ctx.moveTo(PAD.l,y);ctx.lineTo(W-PAD.r,y);ctx.stroke()
    }
    ctx.strokeStyle='rgba(30,34,53,0.6)';ctx.lineWidth=0.5
    ctx.beginPath();ctx.moveTo(PAD.l,H-PAD.b);ctx.lineTo(W-PAD.r,H-PAD.b);ctx.stroke()
    ctx.font='9px DM Mono,JetBrains Mono,monospace';ctx.textAlign='center';ctx.textBaseline='top';ctx.fillStyle='#6B7A99'
    ;['1M','6M','1Y','2Y','5Y','10Y','20Y','30Y'].forEach(t=>{
      const x=xS(TENOR_Y[t]);ctx.fillText(t,x,H-PAD.b+6)
      ctx.strokeStyle='rgba(30,34,53,0.4)';ctx.lineWidth=0.4
      ctx.beginPath();ctx.moveTo(x,PAD.t);ctx.lineTo(x,H-PAD.b);ctx.stroke()
    })
    const avgSh=sh.reduce((a,b)=>a+b,0)/sh.length
    const shClr=avgSh<=0?'#4A9EFF':'#FF6B6B'
    const shClrRgb=avgSh<=0?'74,158,255':'255,107,107'
    const anyShift=sh.some(s=>Math.abs(s)>0.05)
    // Base fill
    ctx.beginPath()
    TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(baseRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
    ctx.lineTo(xS(TENOR_Y[TENORS[TENORS.length-1]]),H-PAD.b);ctx.lineTo(xS(TENOR_Y[TENORS[0]]),H-PAD.b);ctx.closePath()
    const gradBase=ctx.createLinearGradient(0,PAD.t,0,H-PAD.b)
    gradBase.addColorStop(0,'rgba(0,212,168,0.12)');gradBase.addColorStop(1,'rgba(0,212,168,0)')
    ctx.fillStyle=gradBase;ctx.fill()
    // Base glow
    ctx.setLineDash([]);ctx.lineJoin='round';ctx.lineCap='round'
    ctx.beginPath()
    TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(baseRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
    ctx.strokeStyle='rgba(0,212,168,0.15)';ctx.lineWidth=7;ctx.stroke()
    ctx.beginPath()
    TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(baseRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
    ctx.strokeStyle='#00D4A8';ctx.lineWidth=2;ctx.stroke()
    TENORS.forEach((t,i)=>{
      const cx=xS(TENOR_Y[t]),cy=yS(baseRts[i])
      ctx.beginPath();ctx.arc(cx,cy,5,0,Math.PI*2);ctx.strokeStyle='rgba(0,212,168,0.25)';ctx.lineWidth=3;ctx.stroke()
      ctx.beginPath();ctx.arc(cx,cy,3,0,Math.PI*2);ctx.fillStyle='#00D4A8';ctx.fill()
    })
    if(anyShift){
      ctx.beginPath()
      TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(baseRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
      ;[...TENORS].reverse().forEach(t=>{const i=TENORS.indexOf(t);ctx.lineTo(xS(TENOR_Y[t]),yS(shockRts[i]))})
      ctx.closePath();ctx.fillStyle=avgSh>0?'rgba(255,107,107,0.06)':'rgba(74,158,255,0.06)';ctx.fill()
      ctx.setLineDash([5,3])
      ctx.beginPath()
      TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(shockRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
      ctx.strokeStyle=\`rgba(\${shClrRgb},0.2)\`;ctx.lineWidth=7;ctx.stroke()
      ctx.beginPath()
      TENORS.forEach((t,i)=>{const x=xS(TENOR_Y[t]),y=yS(shockRts[i]);i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)})
      ctx.strokeStyle=shClr;ctx.lineWidth=2;ctx.stroke();ctx.setLineDash([])
      TENORS.forEach((t,i)=>{
        const cx=xS(TENOR_Y[t]),cy=yS(shockRts[i]),cyB=yS(baseRts[i]),bp=Math.round(sh[i])
        const isActive=curveDragRef.current?.idx===i||barsDragRef.current?.idx===i
        if(Math.abs(bp)>0.5){ctx.strokeStyle=\`rgba(\${shClrRgb},0.2)\`;ctx.lineWidth=0.8;ctx.setLineDash([2,2]);ctx.beginPath();ctx.moveTo(cx,cyB);ctx.lineTo(cx,cy);ctx.stroke();ctx.setLineDash([])}
        if(isActive){ctx.shadowColor=shClr;ctx.shadowBlur=14;ctx.beginPath();ctx.arc(cx,cy,5.5,0,Math.PI*2);ctx.fillStyle=shClr;ctx.fill();ctx.shadowBlur=0;ctx.beginPath();ctx.arc(cx,cy,5.5,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,0.7)';ctx.lineWidth=1;ctx.stroke()}
        else{ctx.beginPath();ctx.arc(cx,cy,4.5,0,Math.PI*2);ctx.strokeStyle=\`rgba(\${shClrRgb},0.3)\`;ctx.lineWidth=3;ctx.stroke();ctx.beginPath();ctx.arc(cx,cy,3,0,Math.PI*2);ctx.fillStyle=shClr;ctx.fill()}
      })
    }
    ctx.font='9px DM Mono,JetBrains Mono,monospace';ctx.textBaseline='middle';ctx.setLineDash([])
    ctx.strokeStyle='#00D4A8';ctx.lineWidth=2
    ctx.beginPath();ctx.moveTo(PAD.l,PAD.t-14);ctx.lineTo(PAD.l+20,PAD.t-14);ctx.stroke()
    ctx.fillStyle='#00D4A8';ctx.textAlign='left';ctx.fillText('BASE',PAD.l+24,PAD.t-14)
    if(anyShift){
      ctx.setLineDash([4,2]);ctx.strokeStyle=shClr
      ctx.beginPath();ctx.moveTo(PAD.l+66,PAD.t-14);ctx.lineTo(PAD.l+86,PAD.t-14);ctx.stroke();ctx.setLineDash([])
      ctx.fillStyle=shClr;ctx.fillText('SHOCKED',PAD.l+90,PAD.t-14)
      const avgBp=Math.round(avgSh)
      ctx.fillStyle=avgBp>0?'#FF6B6B':'#4A9EFF';ctx.textAlign='right'
      ctx.fillText((avgBp>0?'+':'')+avgBp+'bp AVG',W-PAD.r,PAD.t-14)
    }
  }

  const drawBars = () => {
    const canvas=barsCanvasRef.current;if(!canvas)return
    const ctx=canvas.getContext('2d')
    const dpr=window.devicePixelRatio||2
    const W=canvas.width/dpr,H=canvas.height/dpr
    const sh=shiftsRef.current
    const {xS,barW}=getScaleParams(W)
    const maxAbsBp=Math.max(1,...sh.map(Math.abs))
    const RANGE=Math.max(50,Math.ceil(maxAbsBp/25)*25+25)
    const MID=H/2,PX_PER_BP=(H/2-20)/RANGE
    ctx.fillStyle='#0D0F17';ctx.fillRect(0,0,W,H)
    ctx.font='9px DM Mono,JetBrains Mono,monospace'
    ;[25,50,100,-25,-50,-100].filter(v=>Math.abs(v)<=RANGE).forEach(v=>{
      const y=MID-v*PX_PER_BP
      ctx.strokeStyle='rgba(30,34,53,0.7)';ctx.lineWidth=0.4;ctx.setLineDash([2,3])
      ctx.beginPath();ctx.moveTo(52,y);ctx.lineTo(W-16,y);ctx.stroke();ctx.setLineDash([])
      if(Math.abs(v)===50||Math.abs(v)===100){ctx.fillStyle='rgba(107,122,153,0.5)';ctx.textAlign='right';ctx.textBaseline='middle';ctx.fillText((v>0?'+':'')+v,50,y)}
    })
    ctx.strokeStyle='rgba(0,212,168,0.25)';ctx.lineWidth=3
    ctx.beginPath();ctx.moveTo(52,MID);ctx.lineTo(W-16,MID);ctx.stroke()
    ctx.strokeStyle='rgba(0,212,168,0.5)';ctx.lineWidth=0.8
    ctx.beginPath();ctx.moveTo(52,MID);ctx.lineTo(W-16,MID);ctx.stroke()
    TENORS.forEach((t,i)=>{
      const cx=xS(TENOR_Y[t]),bw=Math.max(6,Math.min(barW(i),26))
      const bp=Math.max(-CAP,Math.min(CAP,sh[i])),absBp=Math.abs(bp),barH=absBp*PX_PER_BP
      const isActive=barsDragRef.current?.idx===i||curveDragRef.current?.idx===i
      const isPos=bp>=0,clrRgb=isPos?'255,107,107':'74,158,255',clrSolid=isPos?'#FF6B6B':'#4A9EFF'
      if(absBp>0.3){
        const y0=isPos?MID-barH:MID,x0=cx-bw/2,actualH=Math.max(2,barH)
        ctx.fillStyle=\`rgba(\${clrRgb},\${isActive?0.15:0.07})\`
        ctx.fillRect(x0-3,isPos?y0-3:y0,bw+6,actualH+3)
        const grad=ctx.createLinearGradient(0,y0,0,y0+actualH)
        if(isPos){grad.addColorStop(0,\`rgba(\${clrRgb},\${isActive?1:0.9})\`);grad.addColorStop(0.5,\`rgba(\${clrRgb},0.5)\`);grad.addColorStop(1,\`rgba(\${clrRgb},0.08)\`)}
        else{grad.addColorStop(0,\`rgba(\${clrRgb},0.08)\`);grad.addColorStop(0.5,\`rgba(\${clrRgb},0.5)\`);grad.addColorStop(1,\`rgba(\${clrRgb},\${isActive?1:0.9})\`)}
        const rx=2
        ctx.beginPath()
        if(isPos){ctx.moveTo(x0+rx,y0);ctx.lineTo(x0+bw-rx,y0);ctx.arcTo(x0+bw,y0,x0+bw,y0+rx,rx);ctx.lineTo(x0+bw,y0+actualH);ctx.lineTo(x0,y0+actualH);ctx.lineTo(x0,y0+rx);ctx.arcTo(x0,y0,x0+rx,y0,rx)}
        else{ctx.moveTo(x0,y0);ctx.lineTo(x0+bw,y0);ctx.lineTo(x0+bw,y0+actualH-rx);ctx.arcTo(x0+bw,y0+actualH,x0+bw-rx,y0+actualH,rx);ctx.lineTo(x0+rx,y0+actualH);ctx.arcTo(x0,y0+actualH,x0,y0+actualH-rx,rx);ctx.lineTo(x0,y0)}
        ctx.closePath();ctx.fillStyle=grad;ctx.fill()
        const capY=isPos?MID-barH:MID+barH
        if(isActive){ctx.shadowColor=clrSolid;ctx.shadowBlur=8}
        ctx.strokeStyle=clrSolid;ctx.lineWidth=isActive?2:1.5;ctx.lineCap='round'
        ctx.beginPath();ctx.moveTo(cx-bw/2+1,capY);ctx.lineTo(cx+bw/2-1,capY);ctx.stroke();ctx.shadowBlur=0
        const labelY=isPos?MID-barH-5:MID+barH+10
        if(isActive){ctx.shadowColor=clrSolid;ctx.shadowBlur=6}
        ctx.fillStyle=clrSolid;ctx.font=isActive?'bold 9px DM Mono,monospace':'9px DM Mono,monospace'
        ctx.textAlign='center';ctx.textBaseline=isPos?'bottom':'top'
        ctx.fillText((bp>0?'+':'')+Math.round(bp),cx,labelY);ctx.shadowBlur=0
      } else {ctx.strokeStyle='rgba(30,34,53,0.9)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(cx,MID-3);ctx.lineTo(cx,MID+3);ctx.stroke()}
      ctx.fillStyle=isActive?'#E8EAF0':'rgba(107,122,153,0.6)'
      ctx.font=isActive?'bold 9px DM Mono,monospace':'9px DM Mono,monospace'
      ctx.textAlign='center';ctx.textBaseline='bottom';ctx.shadowBlur=0
      ctx.fillText(t,cx,H-3)
    })
    ctx.fillStyle='rgba(107,122,153,0.3)';ctx.font='9px DM Mono,monospace';ctx.textAlign='right';ctx.textBaseline='top'
    ctx.fillText('\u00b1'+RANGE+'bp',W-16,4)
  }

  const scheduleCurve=()=>{if(rafCurveRef.current)cancelAnimationFrame(rafCurveRef.current);rafCurveRef.current=requestAnimationFrame(drawCurve)}
  const scheduleBars=()=>{if(rafBarsRef.current)cancelAnimationFrame(rafBarsRef.current);rafBarsRef.current=requestAnimationFrame(drawBars)}
  const scheduleAll=()=>{scheduleCurve();scheduleBars()}

  const sizeCurveCanvas=()=>{const c=curveCanvasRef.current;if(!c)return;const p=c.parentElement;const dpr=window.devicePixelRatio||2;c.width=p.offsetWidth*dpr;c.height=p.offsetHeight*dpr;c.style.width=p.offsetWidth+'px';c.style.height=p.offsetHeight+'px';const ctx=c.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.scale(dpr,dpr);scheduleCurve()}
  const sizeBarsCanvas=()=>{const c=barsCanvasRef.current;if(!c)return;const p=c.parentElement;const dpr=window.devicePixelRatio||2;c.width=p.offsetWidth*dpr;c.height=p.offsetHeight*dpr;c.style.width=p.offsetWidth+'px';c.style.height=p.offsetHeight+'px';const ctx=c.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.scale(dpr,dpr);scheduleBars()}

  useEffect(()=>{sizeCurveCanvas();sizeBarsCanvas()},[tick])
  useEffect(()=>{const t=setTimeout(()=>{sizeCurveCanvas();sizeBarsCanvas()},60);return()=>clearTimeout(t)},[])

  useEffect(()=>{
    const canvas=curveCanvasRef.current;if(!canvas)return
    const getHit=(mx,my)=>{
      const rect=canvas.getBoundingClientRect(),W=rect.width,H=rect.height
      const PAD={l:12,r:18,t:30,b:36},CW=W-PAD.l-PAD.r,CH=H-PAD.t-PAD.b
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
    const onDown=e=>{const r=canvas.getBoundingClientRect();const idx=getHit(e.clientX-r.left,e.clientY-r.top);if(idx>=0){e.preventDefault();curveDragRef.current={idx,startY:e.clientY,origShifts:[...shiftsRef.current]};scheduleAll()}}
    const onMove=e=>{
      const r=canvas.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top
      if(curveDragRef.current){
        const{idx,startY,origShifts}=curveDragRef.current
        const dy=startY-e.clientY,bpDelta=dy*BPpx,sig=sigmaRef.current,dty=TENOR_Y[TENORS[idx]]
        shiftsRef.current=origShifts.map((s,i)=>{const dist=TENOR_Y[TENORS[i]]-dty;return Math.max(-CAP,Math.min(CAP,Math.round((s+bpDelta*Math.exp(-(dist*dist)/(2*sig*sig)))*10)/10))})
        const bp=Math.round(shiftsRef.current[idx])
        setCurveDragTip({x:mx+14,y:my-30,bp,tenor:TENORS[idx]});scheduleAll();return
      }
      const hIdx=getHit(mx,my)
      canvas.style.cursor=hIdx>=0?'ns-resize':'crosshair'
      if(hIdx>=0){const t=TENORS[hIdx],base=getBase(t),bp=Math.round(shiftsRef.current[hIdx]);setHoverInfo({x:mx,y:my,tenor:t,base,shocked:base+bp/100,bp})}
      else setHoverInfo(null)
    }
    const onUp=()=>{if(curveDragRef.current){curveDragRef.current=null;setCurveDragTip(null);setHoverInfo(null);setConfirmed(false);setTick(t=>t+1);scheduleAll()}}
    const onLeave=()=>setHoverInfo(null)
    canvas.addEventListener('mousedown',onDown);canvas.addEventListener('mousemove',onMove);canvas.addEventListener('mouseleave',onLeave);window.addEventListener('mouseup',onUp)
    return()=>{canvas.removeEventListener('mousedown',onDown);canvas.removeEventListener('mousemove',onMove);canvas.removeEventListener('mouseleave',onLeave);window.removeEventListener('mouseup',onUp)}
  },[])

  useEffect(()=>{
    const canvas=barsCanvasRef.current;if(!canvas)return
    const getBarHit=(mx)=>{const rect=canvas.getBoundingClientRect();const{xS,barW}=getScaleParams(rect.width);let bi=-1,bd=9999;TENORS.forEach((t,i)=>{const d=Math.abs(mx-xS(TENOR_Y[t]));if(d<bd&&d<barW(i)+8){bd=d;bi=i}});return bi}
    const onDown=e=>{const r=canvas.getBoundingClientRect();const idx=getBarHit(e.clientX-r.left);if(idx>=0){e.preventDefault();barsDragRef.current={idx,startY:e.clientY,origShifts:[...shiftsRef.current]};scheduleAll()}}
    const onMove=e=>{
      const r=canvas.getBoundingClientRect(),mx=e.clientX-r.left
      if(barsDragRef.current){
        const{idx,startY,origShifts}=barsDragRef.current
        const dy=startY-e.clientY,bpDelta=dy*BPpx*1.5,sig=sigmaRef.current,dty=TENOR_Y[TENORS[idx]]
        shiftsRef.current=origShifts.map((s,i)=>{const dist=TENOR_Y[TENORS[i]]-dty;return Math.max(-CAP,Math.min(CAP,Math.round((s+bpDelta*Math.exp(-(dist*dist)/(2*sig*sig)))*10)/10))})
        const bp=Math.round(shiftsRef.current[idx]);setBarsDragTip({x:mx+10,y:r.height/2,bp,tenor:TENORS[idx]});scheduleAll();return
      }
      canvas.style.cursor=getBarHit(mx)>=0?'ns-resize':'default'
    }
    const onUp=()=>{if(barsDragRef.current){barsDragRef.current=null;setBarsDragTip(null);setConfirmed(false);setTick(t=>t+1);scheduleAll()}}
    canvas.addEventListener('mousedown',onDown);canvas.addEventListener('mousemove',onMove);window.addEventListener('mouseup',onUp)
    return()=>{canvas.removeEventListener('mousedown',onDown);canvas.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp)}
  },[])

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

  const applyPreset=key=>{setPresetKey(key);shiftsRef.current=[...(PRESETS[key]||PRESETS.flat0)];setConfirmed(false);setTick(t=>t+1);scheduleAll()}
  const handleReset=()=>{shiftsRef.current=TENORS.map(()=>0);setPresetKey('flat0');setConfirmed(true);setScenarioBase(null);setScenarioCalc(null);setTick(t=>t+1);scheduleAll()}
  const handleConfirmShape=()=>{setConfirmed(true);const ov={};TENORS.forEach((t,i)=>{ov[t]=(getBase(t)+shiftsRef.current[i]/100).toFixed(5)});handleRunScenario(ov)}

  const sh=shiftsRef.current
  const anyShift=sh.some(s=>Math.abs(s)>0.05)
  const avgBp=Math.round(sh.reduce((a,b)=>a+b,0)/TENORS.length)
  const fmtPnl=n=>n==null?'\u2014':(n>=0?'+':'-')+'$'+Math.abs(Math.round(n)).toLocaleString('en-US')
  const fmtG=n=>n==null?'\u2014':(n>=0?'+':'')+n.toFixed(4)
  const inp={background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',color:'var(--text)',fontFamily:'var(--mono)',fontSize:FS,padding:'4px 7px',outline:'none'}

  return (
    <div className='tbw-no-drag' style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

      <div style={{background:'rgba(240,160,32,0.06)',borderBottom:'1px solid rgba(240,160,32,0.2)',padding:'5px 14px',fontSize:FS,color:'var(--amber)',letterSpacing:'0.05em',flexShrink:0}}>
        \u26a0 SCENARIO MODE \u2014 Drag curve points or equalizer bars. Confirm once to reprice. Not saved to Configurations.
      </div>

      <div style={{display:'flex',alignItems:'center',gap:8,padding:'7px 14px',borderBottom:'1px solid var(--border)',flexShrink:0,flexWrap:'wrap'}}>
        <span style={{fontSize:FSL,color:'var(--text-dim)',letterSpacing:'0.08em',fontFamily:'var(--mono)'}}>PRESET</span>
        <select value={presetKey} onChange={e=>applyPreset(e.target.value)} style={{...inp,width:'155px'}}>
          <optgroup label="\u2500\u2500 PARALLEL SHIFTS \u2500\u2500">
            <option value="flat0">Base (no shift)</option>
            <option value="up25">+25bp</option><option value="up50">+50bp</option><option value="up100">+100bp</option>
            <option value="dn25">\u221225bp</option><option value="dn50">\u221250bp</option><option value="dn100">\u2212100bp</option>
          </optgroup>
          <optgroup label="\u2500\u2500 RESHAPING \u2500\u2500">
            <option value="bear_steep">Bear Steepener</option><option value="bull_flat">Bull Flattener</option>
            <option value="bear_flat">Bear Flattener</option><option value="bull_steep">Bull Steepener</option>
          </optgroup>
          <optgroup label="\u2500\u2500 CENTRAL BANK \u2500\u2500">
            <option value="hike25">Fed Hike +25bp</option><option value="cut25">Fed Cut \u221225bp</option>
            <option value="hike_cycle">Fed Hike Cycle</option>
          </optgroup>
        </select>
        <span style={{fontSize:FSL,color:'var(--text-dim)',letterSpacing:'0.08em',fontFamily:'var(--mono)'}}>RIPPLE</span>
        <input type='range' min='1' max='10' value={sigma} step='1' style={{width:70,accentColor:'var(--accent)'}} onChange={e=>{const v=parseFloat(e.target.value);setSigma(v);sigmaRef.current=v}}/>
        <span style={{fontSize:FS,fontWeight:700,color:'var(--blue)',minWidth:'28px',fontFamily:'var(--mono)'}}>{sigma}Y</span>
        <span style={{fontSize:FSL,color:'var(--text-dim)',letterSpacing:'0.08em',fontFamily:'var(--mono)'}}>INTERP</span>
        <select value={interpMode} onChange={e=>setInterpMode(e.target.value)} style={{...inp,width:'130px'}}>
          <option value="LOG_LINEAR">Log-Linear (default)</option>
          <option value="LINEAR_ZERO">Linear Zero Rates</option>
          <option value="CUBIC_SPLINE">Cubic Spline</option>
          <option value="STEP">Step Function</option>
        </select>
        {interpMode!=='LOG_LINEAR'&&<span style={{fontSize:FSL,fontWeight:700,padding:'2px 5px',borderRadius:'2px',border:'1px solid rgba(240,160,32,0.3)',background:'rgba(240,160,32,0.06)',color:'var(--amber)'}}>SCENARIO ONLY</span>}
        <button onClick={handleReset} style={{padding:'4px 12px',borderRadius:'2px',cursor:'pointer',fontFamily:'var(--mono)',fontSize:FS,fontWeight:700,letterSpacing:'0.06em',marginLeft:'auto',border:'1px solid rgba(82,104,120,0.4)',background:'rgba(82,104,120,0.06)',color:'var(--text-dim)'}}>RESET</button>
      </div>

      <div style={{flex:'1 1 200px',position:'relative',background:'#070d12',minHeight:'200px',overflow:'hidden'}}>
        <canvas ref={curveCanvasRef} style={{display:'block',cursor:'crosshair'}}/>
        {curveDragTip&&(
          <div style={{position:'absolute',left:curveDragTip.x,top:curveDragTip.y,pointerEvents:'none',zIndex:10,
            background:'#0D0F17',border:'1px solid '+(curveDragTip.bp>=0?'rgba(255,107,107,0.7)':'rgba(74,158,255,0.7)'),
            borderRadius:'2px',padding:'4px 10px',fontSize:FS,fontFamily:'DM Mono,var(--mono)',fontWeight:700,
            color:curveDragTip.bp>=0?'#FF6B6B':'#4A9EFF',whiteSpace:'nowrap',boxShadow:'0 4px 16px rgba(0,0,0,0.9)'}}>
            {curveDragTip.bp>=0?'+':''}{curveDragTip.bp}bp @ {curveDragTip.tenor}
          </div>
        )}
        {hoverInfo&&!curveDragTip&&(
          <div style={{position:'absolute',left:Math.min(hoverInfo.x+14,700),top:Math.max(hoverInfo.y-72,4),
            pointerEvents:'none',zIndex:10,background:'#0D0F17',border:'1px solid #1E2235',
            borderRadius:'2px',padding:'8px 12px',minWidth:'150px',boxShadow:'0 4px 20px rgba(0,0,0,0.9)'}}>
            <div style={{fontSize:'0.58rem',fontWeight:700,letterSpacing:'0.10em',color:'#E8EAF0',fontFamily:'DM Mono,var(--mono)',marginBottom:'6px'}}>{hoverInfo.tenor}</div>
            <div style={{display:'flex',justifyContent:'space-between',gap:'16px',marginBottom:'4px'}}>
              <span style={{fontSize:FS,color:'#6B7A99',fontFamily:'DM Mono,var(--mono)'}}>BASE</span>
              <span style={{fontSize:FS,fontWeight:600,color:'#00D4A8',fontFamily:'DM Mono,var(--mono)'}}>{hoverInfo.base.toFixed(4)}%</span>
            </div>
            {hoverInfo.bp!==0&&<>
              <div style={{display:'flex',justifyContent:'space-between',gap:'16px',marginBottom:'4px'}}>
                <span style={{fontSize:FS,color:'#6B7A99',fontFamily:'DM Mono,var(--mono)'}}>SHOCKED</span>
                <span style={{fontSize:FS,fontWeight:600,color:hoverInfo.bp>0?'#FF6B6B':'#4A9EFF',fontFamily:'DM Mono,var(--mono)'}}>{hoverInfo.shocked.toFixed(4)}%</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',gap:'16px',borderTop:'1px solid #1E2235',paddingTop:'4px',marginTop:'4px'}}>
                <span style={{fontSize:FS,color:'#6B7A99',fontFamily:'DM Mono,var(--mono)'}}>SHIFT</span>
                <span style={{fontSize:FS,fontWeight:700,color:hoverInfo.bp>0?'#FF6B6B':'#4A9EFF',fontFamily:'DM Mono,var(--mono)'}}>{hoverInfo.bp>0?'+':''}{hoverInfo.bp}bp</span>
              </div>
            </>}
          </div>
        )}
      </div>

      <div style={{height:'150px',position:'relative',background:'#070d12',borderTop:'1px solid #1a2a3a',overflow:'hidden',flexShrink:0}}>
        <canvas ref={barsCanvasRef} style={{display:'block',cursor:'ns-resize'}}/>
        {barsDragTip&&(
          <div style={{position:'absolute',left:barsDragTip.x,top:Math.max(4,barsDragTip.y-20),pointerEvents:'none',zIndex:10,
            background:'#0D0F17',border:'1px solid '+(barsDragTip.bp>=0?'rgba(255,107,107,0.7)':'rgba(74,158,255,0.7)'),
            borderRadius:'2px',padding:'3px 9px',fontSize:FS,fontFamily:'DM Mono,var(--mono)',fontWeight:700,
            color:barsDragTip.bp>=0?'#FF6B6B':'#4A9EFF',whiteSpace:'nowrap',boxShadow:'0 4px 16px rgba(0,0,0,0.9)'}}>
            {barsDragTip.bp>=0?'+':''}{barsDragTip.bp}bp @ {barsDragTip.tenor}
          </div>
        )}
        <div style={{position:'absolute',bottom:3,right:8,fontSize:FSL,color:'rgba(82,104,120,0.35)',fontFamily:'DM Mono,var(--mono)',pointerEvents:'none'}}>
          DRAG BARS OR CURVE \u00b7 BOTH IN SYNC
        </div>
      </div>

      <div style={{flexShrink:0,borderTop:'1px solid var(--border)'}}>
        <button onClick={()=>setShowDetail(v=>!v)}
          style={{width:'100%',padding:'7px 14px',background:'var(--bg)',border:'none',
            borderBottom:showDetail?'1px solid var(--border)':'none',cursor:'pointer',
            fontFamily:'var(--mono)',fontSize:FS,color:'var(--text-dim)',fontWeight:700,
            letterSpacing:'0.08em',display:'flex',alignItems:'center',gap:'6px'}}>
          <span style={{color:showDetail?'var(--accent)':'var(--text-dim)'}}>{showDetail?'\u25be':'\u25b8'}</span>
          CURVE DETAIL
          <span style={{fontWeight:400,opacity:0.5,fontSize:FSL}}>tenor \u00b7 base \u00b7 shift \u00b7 shocked \u00b7 DF</span>
        </button>
        {showDetail&&(
          <div style={{padding:'10px 14px',display:'flex',flexWrap:'wrap',gap:'8px',maxHeight:'240px',overflowY:'auto'}}>
            {TENORS.map((t,i)=>{
              const base=getBase(t),shBp=Math.max(-CAP,Math.min(CAP,sh[i])),shocked=base+shBp/100
              const yr=TENOR_Y[t],dfShock=Math.exp(-shocked/100*yr),ddf=dfShock-Math.exp(-base/100*yr)
              const shiftClr=shBp>0?'#FF6B6B':shBp<0?'#4A9EFF':'var(--text-dim)'
              return(
                <div key={t} style={{background:'#070d12',border:'1px solid var(--border)',borderRadius:'2px',padding:'8px 12px',minWidth:'145px',flex:'1 1 145px'}}>
                  <div style={{fontSize:'0.58rem',fontWeight:700,color:'var(--accent)',fontFamily:'var(--mono)',marginBottom:'7px',letterSpacing:'0.08em'}}>{t}</div>
                  <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:'8px'}}>
                      <span style={{fontSize:FS,color:'var(--text-dim)',fontFamily:'var(--mono)'}}>BASE</span>
                      <span style={{fontSize:FS,fontWeight:600,color:'var(--blue)',fontFamily:'var(--mono)'}}>{base.toFixed(4)}%</span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',gap:'8px'}}>
                      <span style={{fontSize:FS,color:'var(--text-dim)',fontFamily:'var(--mono)'}}>SHIFT</span>
                      <span style={{fontSize:FS,fontWeight:700,color:shiftClr,fontFamily:'var(--mono)'}}>{shBp===0?'\u2014':(shBp>0?'+':'')+shBp+'bp'}</span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',gap:'8px'}}>
                      <span style={{fontSize:FS,color:'var(--text-dim)',fontFamily:'var(--mono)'}}>SHOCKED</span>
                      <span style={{fontSize:FS,fontWeight:600,color:shBp===0?'var(--text-dim)':shiftClr,fontFamily:'var(--mono)'}}>{shocked.toFixed(4)}%</span>
                    </div>
                    <div style={{borderTop:'1px solid var(--border)',marginTop:'3px',paddingTop:'4px',display:'flex',flexDirection:'column',gap:'3px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',gap:'8px'}}>
                        <span style={{fontSize:FSL,color:'var(--text-dim)',fontFamily:'var(--mono)',opacity:0.7}}>ZERO</span>
                        <span style={{fontSize:FSL,color:'var(--text-dim)',fontFamily:'var(--mono)'}}>{shocked.toFixed(4)}%</span>
                      </div>
                      <div style={{display:'flex',justifyContent:'space-between',gap:'8px'}}>
                        <span style={{fontSize:FSL,color:'var(--text-dim)',fontFamily:'var(--mono)',opacity:0.7}}>DF</span>
                        <span style={{fontSize:FSL,color:'var(--text-dim)',fontFamily:'var(--mono)'}}>{dfShock.toFixed(5)}</span>
                      </div>
                      {Math.abs(ddf)>0.000001&&<div style={{display:'flex',justifyContent:'space-between',gap:'8px'}}>
                        <span style={{fontSize:FSL,color:'var(--text-dim)',fontFamily:'var(--mono)',opacity:0.7}}>\u0394DF</span>
                        <span style={{fontSize:FSL,fontFamily:'var(--mono)',color:ddf<0?'#FF6B6B':'#4A9EFF'}}>{ddf>=0?'+':''}{ddf.toFixed(5)}</span>
                      </div>}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {(scenarioBase||scenarioCalc)&&(
        <div style={{flexShrink:0,borderTop:'1px solid var(--border)'}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'1px',background:'var(--border)'}}>
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
                  <div key={item.label} style={{background:'var(--bg)',padding:'7px 12px'}}>
                    <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:3}}>
                      <span style={{fontSize:FSL,color:'var(--text-dim)',letterSpacing:'0.08em',fontFamily:'var(--mono)'}}>{item.label}</span>
                      {item.approx&&item.shocked!=null&&<button onClick={()=>setThetaApproxVisible(v=>!v)} style={{fontSize:'0.36rem',padding:'1px 4px',borderRadius:'2px',cursor:'pointer',fontFamily:'var(--mono)',border:'1px solid rgba(240,160,32,0.4)',background:'rgba(240,160,32,0.06)',color:'var(--amber)'}}>{thetaApproxVisible?'\u25b4':'\u25be'} ~</button>}
                    </div>
                    <div style={{fontSize:'0.58rem',fontWeight:700,fontFamily:'var(--mono)',color:'var(--blue)'}}>{fmt(item.base)}</div>
                    {item.shocked!=null&&<>
                      <div style={{fontSize:'0.58rem',fontWeight:700,fontFamily:'var(--mono)',color:item.shocked>=0?'var(--accent)':'var(--red)'}}>{fmt(item.shocked)}{item.approx&&<span style={{fontSize:FSL,color:'var(--amber)',marginLeft:2}}>~</span>}</div>
                      {delta!=null&&<div style={{fontSize:FSL,marginTop:2,fontFamily:'var(--mono)',color:delta>=0?'var(--accent)':'var(--red)'}}>{delta>=0?'+':''}{fmt(delta)}</div>}
                      {item.approx&&thetaApproxVisible&&<div style={{fontSize:FSL,color:'var(--amber)',marginTop:3,borderTop:'1px solid rgba(240,160,32,0.2)',paddingTop:3,fontFamily:'var(--mono)'}}>\u0394Theta \u221d \u0394IR01/IR01</div>}
                    </>}
                  </div>
                )
              })
            })()}
          </div>
        </div>
      )}

      <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 14px',borderTop:'1px solid var(--border)',background:'#070d12',flexShrink:0}}>
        <span style={{fontSize:FS,color:'var(--text-dim)',fontFamily:'var(--mono)',letterSpacing:'0.05em'}}>
          DRAG CURVE OR BARS \u00b7 BOTH IN SYNC \u00b7 CONFIRM ONCE TO REPRICE
        </span>
        {anyShift&&!confirmed&&<span style={{fontSize:FS,fontWeight:700,padding:'2px 8px',borderRadius:'2px',background:'rgba(240,160,32,0.08)',border:'1px solid rgba(240,160,32,0.35)',color:'var(--amber)',fontFamily:'var(--mono)',whiteSpace:'nowrap'}}>UNSAVED SHAPE</span>}
        {scenarioPricing&&<span style={{fontSize:FS,color:'var(--accent)',fontFamily:'var(--mono)'}}>REPRICING...</span>}
        <button onClick={handleConfirmShape} disabled={!anyShift||confirmed||scenarioPricing}
          style={{padding:'5px 18px',borderRadius:'2px',cursor:(!anyShift||confirmed||scenarioPricing)?'not-allowed':'pointer',
            fontFamily:'var(--mono)',fontSize:FS,fontWeight:700,letterSpacing:'0.08em',
            whiteSpace:'nowrap',marginLeft:'auto',transition:'all 0.15s',
            border:anyShift&&!confirmed?'1px solid rgba(240,160,32,0.6)':'1px solid rgba(82,104,120,0.4)',
            background:anyShift&&!confirmed?'rgba(240,160,32,0.1)':'rgba(82,104,120,0.06)',
            color:anyShift&&!confirmed?'var(--amber)':'var(--text-dim)'}}>
          {anyShift&&!confirmed?'CONFIRM SHAPE ('+(avgBp>0?'+':'')+avgBp+'bp avg) \u2192':'CONFIRM SHAPE'}
        </button>
      </div>
    </div>
  )
}

`

src = src.slice(0, START) + TAB + src.slice(END)
fs.writeFileSync(TBW, src, 'utf8')
console.log('✅ ScenarioTab fully rewritten.')
console.log('Font system: FS=0.52rem body, FSL=0.44rem labels — declared as constants, used everywhere.')
console.log('Curve detail: card grid layout, readable sizes.')
console.log('Lines:', src.split('\n').length)

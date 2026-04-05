import { useState, useRef, useEffect } from 'react'

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
const CAP = 300  // max bp shift in either direction
const BP_PER_PX = 0.4  // fixed sensitivity — never dynamic

export default function CurveDesignerWindow({ onClose, curveId, baseRates, analytics, tradeRef, onConfirm }) {
  const canvasRef    = useRef(null)
  const shiftsRef    = useRef(TENORS.map(()=>0))
  const sigmaRef     = useRef(4)
  const baseRatesRef = useRef(baseRates)
  const dragRef      = useRef(null)
  const rafRef       = useRef(null)

  const [pos,        setPos]        = useState({x:80,y:60})
  const [size,       setSize]       = useState({w:940,h:560})
  const [presetKey,  setPresetKey]  = useState('flat0')
  const [sigma,      setSigma]      = useState(4)
  const [interpMode, setInterpMode] = useState('LOG_LINEAR')
  const [confirmed,  setConfirmed]  = useState(true)
  const [dragTip,    setDragTip]    = useState(null)
  const [tick,       setTick]       = useState(0)

  useEffect(()=>{ baseRatesRef.current = baseRates },[baseRates])
  const getBase = t => (baseRatesRef.current && baseRatesRef.current[t] != null) ? parseFloat(baseRatesRef.current[t]) : 3.665

  const draw = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const W = canvas.width/2, H = canvas.height/2
    const PAD = {l:56,r:20,t:24,b:40}
    const CW = W - PAD.l - PAD.r
    const CH = H - PAD.t - PAD.b
    const sh = shiftsRef.current

    // Compute rates — base rates + shifts (capped)
    const baseRts  = TENORS.map(t => getBase(t))
    const shockRts = TENORS.map((t,i) => getBase(t) + Math.max(-CAP,Math.min(CAP,sh[i]))/100)

    // Y axis: fixed visible range = base ± 1.5% + a little padding
    const midR   = baseRts.reduce((a,b)=>a+b,0)/baseRts.length
    const visHalf = Math.max(0.75, Math.max(...sh.map(Math.abs))/100 + 0.3)
    const minR = midR - visHalf
    const maxR = midR + visHalf

    // Scale functions
    const xS = t  => PAD.l + Math.sqrt(t/30) * CW   // duration-weighted
    const yS = r  => PAD.t + CH - (r - minR)/(maxR - minR) * CH

    ctx.clearRect(0,0,W,H)
    ctx.font = '10px JetBrains Mono'

    // Y grid lines + labels
    const gridStep = visHalf > 0.6 ? 0.25 : 0.1
    for (let r = Math.ceil(minR/gridStep)*gridStep; r <= maxR + 0.001; r = Math.round((r+gridStep)*10000)/10000) {
      const y = yS(r)
      if (y < PAD.t - 2 || y > H - PAD.b + 2) continue
      ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 0.5
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke()
      ctx.fillStyle = '#666666'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
      ctx.fillText(r.toFixed(2)+'%', PAD.l - 4, y)
    }

    // X axis line
    ctx.strokeStyle = '#1E1E1E'; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(PAD.l, H-PAD.b); ctx.lineTo(W-PAD.r, H-PAD.b); ctx.stroke()

    // X labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = '#666666'
    ;['1M','6M','1Y','2Y','5Y','10Y','20Y','30Y'].forEach(t => {
      const x = xS(TENOR_Y[t])
      ctx.fillText(t, x, H - PAD.b + 6)
      ctx.strokeStyle='#1E1E1E'; ctx.lineWidth=0.3
      ctx.beginPath(); ctx.moveTo(x, H-PAD.b); ctx.lineTo(x, H-PAD.b+4); ctx.stroke()
    })

    const avgSh  = sh.reduce((a,b)=>a+b,0)/sh.length
    const shClr  = avgSh <= 0 ? '#0dd4a8' : '#e05040'
    const anyShift = sh.some(s=>Math.abs(s)>0.05)

    // Shaded area between base and shocked
    if (anyShift) {
      ctx.beginPath()
      TENORS.forEach((t,i) => { const x=xS(TENOR_Y[t]),y=yS(baseRts[i]); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y) })
      ;[...TENORS].reverse().forEach(t => { const i=TENORS.indexOf(t); ctx.lineTo(xS(TENOR_Y[t]),yS(shockRts[i])) })
      ctx.closePath()
      ctx.fillStyle = avgSh > 0 ? 'rgba(224,80,64,0.07)' : 'rgba(13,212,168,0.07)'
      ctx.fill()
    }

    // Base curve — solid teal
    ctx.setLineDash([]); ctx.strokeStyle='#0dd4a8'; ctx.lineWidth=1.5
    ctx.beginPath()
    TENORS.forEach((t,i)=>{ const x=xS(TENOR_Y[t]),y=yS(baseRts[i]); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y) })
    ctx.stroke()
    TENORS.forEach((t,i)=>{ ctx.beginPath(); ctx.arc(xS(TENOR_Y[t]),yS(baseRts[i]),2.5,0,Math.PI*2); ctx.fillStyle='#0dd4a8'; ctx.fill() })

    // Shocked curve — dashed
    ctx.setLineDash([5,2.5]); ctx.strokeStyle=shClr; ctx.lineWidth=1.5
    ctx.beginPath()
    TENORS.forEach((t,i)=>{ const x=xS(TENOR_Y[t]),y=yS(shockRts[i]); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y) })
    ctx.stroke(); ctx.setLineDash([])

    // Draggable dots + delta lines + bp labels
    TENORS.forEach((t,i)=>{
      const cx=xS(TENOR_Y[t]), cy=yS(shockRts[i]), cyB=yS(baseRts[i])
      const bp=Math.round(sh[i])
      // Delta line
      if(Math.abs(bp)>0.5){
        ctx.strokeStyle=bp>0?'rgba(224,80,64,0.3)':'rgba(13,212,168,0.3)'
        ctx.lineWidth=0.8; ctx.setLineDash([2,2])
        ctx.beginPath(); ctx.moveTo(cx,cyB); ctx.lineTo(cx,cy); ctx.stroke(); ctx.setLineDash([])
      }
      // Dot
      const isActive = dragRef.current?.idx===i
      ctx.beginPath(); ctx.arc(cx,cy,isActive?7:5,0,Math.PI*2); ctx.fillStyle=shClr; ctx.fill()
      if(isActive){ ctx.beginPath(); ctx.arc(cx,cy,7,0,Math.PI*2); ctx.strokeStyle='#ffffff'; ctx.lineWidth=1.5; ctx.stroke() }
      // Bp label (only when not dragging to avoid flicker)
      if(Math.abs(bp)>0.5 && !dragRef.current){
        ctx.font='9px JetBrains Mono'; ctx.fillStyle=bp>0?'#e05040':'#0dd4a8'; ctx.textAlign='center'; ctx.textBaseline='bottom'
        ctx.fillText((bp>0?'+':'')+bp+'bp', cx, cy-9)
      }
    })

    // Legend
    ctx.font='10px JetBrains Mono'; ctx.textBaseline='middle'
    ctx.setLineDash([]); ctx.strokeStyle='#0dd4a8'; ctx.lineWidth=1.5
    ctx.beginPath(); ctx.moveTo(PAD.l,PAD.t-10); ctx.lineTo(PAD.l+22,PAD.t-10); ctx.stroke()
    ctx.fillStyle='#0dd4a8'; ctx.textAlign='left'; ctx.fillText('BASE',PAD.l+26,PAD.t-10)
    ctx.setLineDash([4,2]); ctx.strokeStyle=shClr
    ctx.beginPath(); ctx.moveTo(PAD.l+70,PAD.t-10); ctx.lineTo(PAD.l+92,PAD.t-10); ctx.stroke(); ctx.setLineDash([])
    ctx.fillStyle=shClr; ctx.fillText('SHOCKED',PAD.l+96,PAD.t-10)
    if(anyShift){
      const avgBp=Math.round(avgSh)
      ctx.fillStyle=avgBp>0?'#e05040':'#0dd4a8'; ctx.textAlign='right'
      ctx.fillText((avgBp>0?'+':'')+avgBp+'bp AVG', W-PAD.r, PAD.t-10)
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

  useEffect(()=>{ sizeCanvas() },[size])

  // Attach canvas events ONCE — all mutable access via refs
  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas)return

    const getHitParams = () => {
      const rect  = canvas.getBoundingClientRect()
      const W=rect.width, H=rect.height
      const PAD={l:56,r:20,t:24,b:40}
      const CW=W-PAD.l-PAD.r, CH=H-PAD.t-PAD.b
      const sh=shiftsRef.current
      const baseRts  = TENORS.map(t=>getBase(t))
      const shockRts = TENORS.map((t,i)=>getBase(t)+Math.max(-CAP,Math.min(CAP,sh[i]))/100)
      const midR = baseRts.reduce((a,b)=>a+b,0)/baseRts.length
      const visHalf = Math.max(0.75, Math.max(...sh.map(Math.abs))/100 + 0.3)
      const minR=midR-visHalf, maxR=midR+visHalf
      const xS = t => PAD.l + Math.sqrt(t/30)*CW
      const yS = r => PAD.t + CH - (r-minR)/(maxR-minR)*CH
      return {xS,yS,shockRts,rect,PAD,minR,maxR,CH}
    }

    const findNearest = (mx,my) => {
      const{xS,yS,shockRts}=getHitParams()
      let bestIdx=-1, bestDist=9999
      TENORS.forEach((t,i)=>{
        const d=Math.hypot(mx-xS(TENOR_Y[t]),my-yS(shockRts[i]))
        if(d<bestDist){bestDist=d;bestIdx=i}
      })
      return bestDist<30?bestIdx:-1
    }

    const onDown = e => {
      const rect=canvas.getBoundingClientRect()
      const idx=findNearest(e.clientX-rect.left, e.clientY-rect.top)
      if(idx>=0){
        e.preventDefault()
        dragRef.current={idx,startY:e.clientY,origShifts:[...shiftsRef.current]}
        scheduleDraw()
      }
    }

    const onMove = e => {
      const rect=canvas.getBoundingClientRect()
      const mx=e.clientX-rect.left, my=e.clientY-rect.top

      if(dragRef.current){
        const{idx,startY,origShifts}=dragRef.current
        // FIXED sensitivity: BP_PER_PX bp per pixel, never dynamic
        const dy = startY - e.clientY
        const bpDelta = dy * BP_PER_PX
        const sig=sigmaRef.current
        const dragTY=TENOR_Y[TENORS[idx]]
        const newShifts=origShifts.map((s,i)=>{
          const dist=TENOR_Y[TENORS[i]]-dragTY
          const weight=Math.exp(-(dist*dist)/(2*sig*sig))
          // Cap each shift to prevent runaway
          return Math.max(-CAP, Math.min(CAP, Math.round((s+bpDelta*weight)*10)/10))
        })
        shiftsRef.current=newShifts
        setDragTip({x:mx+16,y:my-32,bp:Math.round(newShifts[idx]),tenor:TENORS[idx]})
        scheduleDraw()
        return
      }
      canvas.style.cursor=findNearest(mx,my)>=0?'ns-resize':'crosshair'
    }

    const onUp=()=>{
      if(dragRef.current){
        dragRef.current=null; setDragTip(null); setConfirmed(false); setTick(t=>t+1); scheduleDraw()
      }
    }

    canvas.addEventListener('mousedown',onDown)
    canvas.addEventListener('mousemove',onMove)
    window.addEventListener('mouseup',onUp)
    return()=>{
      canvas.removeEventListener('mousedown',onDown)
      canvas.removeEventListener('mousemove',onMove)
      window.removeEventListener('mouseup',onUp)
    }
  },[])

  const applyPreset=key=>{
    setPresetKey(key)
    shiftsRef.current=[...(PRESETS[key]||PRESETS.flat0)]
    setConfirmed(false); setTick(t=>t+1); scheduleDraw()
  }
  const handleReset=()=>{
    shiftsRef.current=TENORS.map(()=>0)
    setPresetKey('flat0'); setConfirmed(true); setTick(t=>t+1); scheduleDraw()
  }
  const handleConfirm=()=>{
    setConfirmed(true)
    if(onConfirm){
      const s=[...shiftsRef.current]
      const overrides={}
      TENORS.forEach((t,i)=>{ overrides[t]=(getBase(t)+s[i]/100).toFixed(5) })
      onConfirm({shifts:s,overrides})
    }
  }

  const sh=shiftsRef.current
  const anyShift=sh.some(s=>Math.abs(s)>0.05)
  const avgBp=Math.round(sh.reduce((a,b)=>a+b,0)/TENORS.length)
  const inp={background:'#000000',border:'1px solid #1E1E1E',borderRadius:'2px',
    color:'#e8f0f8',fontFamily:'JetBrains Mono,monospace',fontSize:'0.8125rem',padding:'4px 7px',outline:'none'}

  const startWinDrag=e=>{
    if(e.target.closest('[data-nodrag]'))return
    const p0={x:pos.x,y:pos.y},m0={x:e.clientX,y:e.clientY}
    const mv=ev=>setPos({x:p0.x+ev.clientX-m0.x,y:p0.y+ev.clientY-m0.y})
    const up=()=>{window.removeEventListener('mousemove',mv);window.removeEventListener('mouseup',up)}
    window.addEventListener('mousemove',mv);window.addEventListener('mouseup',up)
  }
  const startResize=e=>{
    const s0={w:size.w,h:size.h},m0={x:e.clientX,y:e.clientY}
    const mv=ev=>setSize({w:Math.max(700,s0.w+ev.clientX-m0.x),h:Math.max(450,s0.h+ev.clientY-m0.y)})
    const up=()=>{window.removeEventListener('mousemove',mv);window.removeEventListener('mouseup',up)}
    window.addEventListener('mousemove',mv);window.addEventListener('mouseup',up)
  }

  const edgeHandles=[
    {t:pos.y-4,        l:pos.x+16,        w:size.w-32,h:8},
    {t:pos.y+16,       l:pos.x-4,         w:8,h:size.h-32},
    {t:pos.y+16,       l:pos.x+size.w-4,  w:8,h:size.h-32},
    {t:pos.y+size.h-4, l:pos.x+16,        w:size.w-32,h:8},
    {t:pos.y-4,        l:pos.x-4,         w:16,h:16},
    {t:pos.y-4,        l:pos.x+size.w-12, w:16,h:16},
    {t:pos.y+size.h-12,l:pos.x-4,         w:16,h:16},
  ]

  return (
    <div style={{position:'fixed',inset:0,zIndex:300,pointerEvents:'none'}}>
      {edgeHandles.map((h,i)=>(
        <div key={i} style={{position:'absolute',top:h.t,left:h.l,width:h.w,height:h.h,cursor:'move',pointerEvents:'all'}}
          onMouseDown={e=>{e.preventDefault();startWinDrag(e)}}/>
      ))}
      <div style={{position:'absolute',top:pos.y+size.h-12,left:pos.x+size.w-12,width:16,height:16,cursor:'se-resize',pointerEvents:'all'}}
        onMouseDown={e=>{e.preventDefault();startResize(e)}}/>

      <div style={{position:'absolute',left:pos.x,top:pos.y,width:size.w,height:size.h,
        background:'#0C0C0C',border:'1px solid #1E1E1E',borderRadius:'2px',
        display:'flex',flexDirection:'column',overflow:'hidden',pointerEvents:'all',
        fontFamily:'JetBrains Mono,monospace',boxShadow:'0 8px 40px rgba(0,0,0,0.8)'}}>

        {/* Titlebar */}
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'7px 14px',
          background:'#000000',borderBottom:'1px solid #1E1E1E',flexShrink:0,
          cursor:'move',userSelect:'none'}} onMouseDown={startWinDrag}>
          <div style={{display:'flex',gap:5}}>
            <span style={{width:11,height:11,borderRadius:'50%',background:'#e05040',display:'inline-block',cursor:'pointer'}} onClick={onClose}/>
            <span style={{width:11,height:11,borderRadius:'50%',background:'#f0a020',display:'inline-block'}}/>
            <span style={{width:11,height:11,borderRadius:'50%',background:'#0dd4a8',display:'inline-block'}}/>
          </div>
          <span style={{fontSize:'1rem',fontWeight:700,letterSpacing:'0.12em',color:'#e8f0f8',flex:1}}>
            CURVE DESIGNER — {curveId||'USD_SOFR'}
          </span>
          {tradeRef&&<span style={{fontSize:'0.8125rem',color:'#666666'}}>{tradeRef}</span>}
          <span style={{fontSize:'0.875rem',color:'#666666',padding:'2px 6px',border:'1px solid #1E1E1E',borderRadius:'2px'}}>
            SENSITIVITY {BP_PER_PX}bp/px
          </span>
        </div>

        {/* Notice */}
        <div style={{background:'rgba(240,160,32,0.06)',borderBottom:'1px solid rgba(240,160,32,0.2)',
          padding:'4px 14px',fontSize:'0.875rem',color:'#f0a020',letterSpacing:'0.05em',flexShrink:0}}>
          ⚠ SCENARIO MODE — Drag points to shape the curve. Click CONFIRM SHAPE to reprice. Changes are not saved to Configurations.
        </div>

        {/* Toolbar */}
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'7px 14px',
          borderBottom:'1px solid #1E1E1E',flexShrink:0,flexWrap:'wrap'}} data-nodrag='1'>
          <span style={{fontSize:'0.875rem',color:'#666666',letterSpacing:'0.08em'}}>PRESET</span>
          <select value={presetKey} onChange={e=>applyPreset(e.target.value)} style={{...inp,width:'160px'}}>
            <optgroup label='── PARALLEL SHIFTS ──'>
              <option value='flat0'>Base (no shift)</option>
              <option value='up25'>+25bp</option><option value='up50'>+50bp</option><option value='up100'>+100bp</option>
              <option value='dn25'>−25bp</option><option value='dn50'>−50bp</option><option value='dn100'>−100bp</option>
            </optgroup>
            <optgroup label='── CURVE RESHAPING ──'>
              <option value='bear_steep'>Bear Steepener</option><option value='bull_flat'>Bull Flattener</option>
              <option value='bear_flat'>Bear Flattener</option><option value='bull_steep'>Bull Steepener</option>
            </optgroup>
            <optgroup label='── CENTRAL BANK ──'>
              <option value='hike25'>Fed Hike +25bp</option><option value='cut25'>Fed Cut −25bp</option>
              <option value='hike_cycle'>Fed Hike Cycle</option>
            </optgroup>
          </select>
          <span style={{fontSize:'0.875rem',color:'#666666',letterSpacing:'0.08em'}}>RIPPLE</span>
          <input type='range' min='1' max='10' value={sigma} step='1' style={{width:80,accentColor:'#0dd4a8'}}
            onChange={e=>{const v=parseFloat(e.target.value);setSigma(v);sigmaRef.current=v}} data-nodrag='1'/>
          <span style={{fontSize:'0.8125rem',color:'#4a9ad4',minWidth:'28px'}}>{sigma}Y</span>
          <span style={{fontSize:'0.875rem',color:'#666666',letterSpacing:'0.08em'}}>INTERP</span>
          <select value={interpMode} onChange={e=>setInterpMode(e.target.value)} style={{...inp,width:'136px'}} data-nodrag='1'>
            <option value='LOG_LINEAR'>Log-Linear (default)</option>
            <option value='LINEAR_ZERO'>Linear Zero Rates</option>
            <option value='CUBIC_SPLINE'>Cubic Spline</option>
            <option value='STEP'>Step Function</option>
          </select>
          {interpMode!=='LOG_LINEAR'&&(
            <span style={{fontSize:'0.875rem',fontWeight:700,padding:'2px 5px',borderRadius:'2px',
              border:'1px solid rgba(240,160,32,0.3)',background:'rgba(240,160,32,0.06)',color:'#f0a020'}}>
              SCENARIO ONLY
            </span>
          )}
          <button onClick={handleReset} data-nodrag='1'
            style={{padding:'3px 10px',borderRadius:'2px',cursor:'pointer',fontFamily:'JetBrains Mono,monospace',
              fontSize:'0.875rem',fontWeight:700,letterSpacing:'0.06em',marginLeft:'auto',
              border:'1px solid rgba(82,104,120,0.4)',background:'rgba(82,104,120,0.06)',color:'#666666'}}>
            RESET
          </button>
        </div>

        {/* Chart */}
        <div style={{flex:1,position:'relative',background:'#000000',overflow:'hidden'}}>
          <canvas ref={canvasRef} style={{display:'block',cursor:'crosshair'}}/>
          {dragTip&&(
            <div style={{position:'absolute',left:dragTip.x,top:dragTip.y,pointerEvents:'none',zIndex:10,
              background:'#0C0C0C',
              border:`1px solid ${dragTip.bp>=0?'rgba(224,80,64,0.7)':'rgba(13,212,168,0.7)'}`,
              borderRadius:'2px',padding:'4px 10px',
              fontSize:'0.875rem',fontFamily:'JetBrains Mono,monospace',fontWeight:700,
              color:dragTip.bp>=0?'#e05040':'#0dd4a8',
              whiteSpace:'nowrap',boxShadow:'0 4px 16px rgba(0,0,0,0.9)'}}>
              {dragTip.bp>=0?'+':''}{dragTip.bp}bp @ {dragTip.tenor}
            </div>
          )}
          <div style={{position:'absolute',bottom:6,left:'50%',transform:'translateX(-50%)',
            fontSize:'0.875rem',color:'rgba(82,104,120,0.5)',fontFamily:'JetBrains Mono,monospace',
            letterSpacing:'0.06em',whiteSpace:'nowrap',pointerEvents:'none'}}>
            DRAG ANY TENOR POINT TO RESHAPE · RIPPLE CONTROLS GAUSSIAN SPREAD · SHIFTS CAPPED AT ±300bp
          </div>
        </div>

        {/* Shifts summary bar */}
        <div style={{display:'flex',gap:'1px',borderTop:'1px solid #1E1E1E',flexShrink:0,background:'#1E1E1E',overflowX:'auto'}}>
          {TENORS.map((t,i)=>{
            const bp=Math.round(sh[i])
            const clr=bp>0?'#e05040':bp<0?'#0dd4a8':'#666666'
            return(
              <div key={t} style={{background:'#0C0C0C',padding:'5px 8px',minWidth:'52px',textAlign:'center'}}>
                <div style={{fontSize:'0.875rem',color:'#666666',marginBottom:'2px',fontFamily:'JetBrains Mono,monospace'}}>{t}</div>
                <div style={{fontSize:'0.8125rem',fontWeight:700,fontFamily:'JetBrains Mono,monospace',color:clr}}>
                  {bp===0?'—':(bp>0?'+':'')+bp+'bp'}
                </div>
              </div>
            )
          })}
        </div>

        {/* Confirm bar */}
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 14px',
          borderTop:'1px solid #1E1E1E',background:'#000000',flexShrink:0}} data-nodrag='1'>
          <span style={{fontSize:'0.875rem',color:'#666666',fontFamily:'JetBrains Mono,monospace',letterSpacing:'0.05em'}}>
            SHAPE THE CURVE ABOVE · EACH POINT IS INDEPENDENTLY DRAGGABLE · CONFIRM ONCE TO REPRICE
          </span>
          {anyShift&&!confirmed&&(
            <span style={{fontSize:'0.875rem',fontWeight:700,padding:'2px 8px',borderRadius:'2px',
              background:'rgba(240,160,32,0.08)',border:'1px solid rgba(240,160,32,0.35)',
              color:'#f0a020',fontFamily:'JetBrains Mono,monospace',whiteSpace:'nowrap'}}>
              UNSAVED SHAPE
            </span>
          )}
          <button onClick={handleConfirm} disabled={!anyShift||confirmed} data-nodrag='1'
            style={{padding:'5px 18px',borderRadius:'2px',
              cursor:(!anyShift||confirmed)?'not-allowed':'pointer',
              fontFamily:'JetBrains Mono,monospace',fontSize:'0.8125rem',fontWeight:700,
              letterSpacing:'0.08em',whiteSpace:'nowrap',marginLeft:'auto',transition:'all 0.2s',
              border:anyShift&&!confirmed?'1px solid rgba(240,160,32,0.6)':'1px solid rgba(82,104,120,0.4)',
              background:anyShift&&!confirmed?'rgba(240,160,32,0.1)':'rgba(82,104,120,0.06)',
              color:anyShift&&!confirmed?'#f0a020':'#666666'}}>
            {anyShift&&!confirmed
              ? `CONFIRM SHAPE (${avgBp>0?'+':''}${avgBp}bp avg) →`
              : 'CONFIRM SHAPE'}
          </button>
        </div>
      </div>
    </div>
  )
}
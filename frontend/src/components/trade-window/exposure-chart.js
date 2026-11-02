// trade-window/exposure-chart.js — the exposure chart every XVA tab draws: the simulated MtM paths as a faint
// fan, EE with its gradient, ENE, PFE 95 %, the axis in thousands, years along the bottom. Lifted from the
// rates XVA tab so the FX and digital-asset tickets show the same picture.
export function drawExposureChart(canvas, ee, ene, pfe, highlightCurve, samplePaths) {
  if (!canvas || !ee || !ee.length) return
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 2
  const W = canvas.width / dpr
  const H = canvas.height / dpr
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#0C1015'
  ctx.fillRect(0, 0, W, H)
  const PAD = { l:52, r:16, t:20, b:28 }
  const CW = W - PAD.l - PAD.r
  const CH = H - PAD.t - PAD.b
  const n = ee.length
  let maxV = Math.max(...pfe.map(Math.abs), ...ee.map(Math.abs), 1)
  let minV = Math.min(...ene, 0)
  if (samplePaths && samplePaths.length) {
    const flat = samplePaths.flat()
    maxV = Math.max(maxV, Math.max(...flat) * 0.7)
    minV = Math.min(minV, Math.min(...flat) * 0.7)
  }
  const range = maxV - minV || 1
  const xS = i => PAD.l + (i / (n-1)) * CW
  const yS = v => PAD.t + CH - ((v - minV) / range) * CH
  ctx.font='10px JetBrains Mono,monospace'
  ctx.fillStyle = '#26303C'; ctx.textAlign = 'right'
  for (let i = 0; i <= 4; i++) {
    const v = minV + (range/4)*i; const y = yS(v)
    if (y < PAD.t-2 || y > H-PAD.b+2) continue
    ctx.strokeStyle = 'rgba(30,30,30,0.9)'; ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W-PAD.r, y); ctx.stroke()
    ctx.fillStyle = '#26303C'; ctx.fillText((v/1000).toFixed(0)+'K', PAD.l-3, y+3)
  }
  const y0 = yS(0)
  ctx.strokeStyle = 'rgba(80,80,80,0.6)'; ctx.lineWidth = 0.8; ctx.setLineDash([3,3])
  ctx.beginPath(); ctx.moveTo(PAD.l, y0); ctx.lineTo(W-PAD.r, y0); ctx.stroke(); ctx.setLineDash([])
  if (samplePaths && samplePaths.length) {
    samplePaths.forEach(path => {
      ctx.beginPath()
      path.forEach((v,i) => i===0 ? ctx.moveTo(xS(i),yS(v)) : ctx.lineTo(xS(i),yS(v)))
      ctx.strokeStyle = path[path.length-1] >= 0 ? 'rgba(13,212,168,0.06)' : 'rgba(74,154,212,0.06)'
      ctx.lineWidth = 0.5; ctx.lineJoin = 'round'; ctx.stroke()
    })
  }
  const drawCurve = (data, color, dash, glowW, lineW, fillGrad) => {
    if (!data || !data.length) return
    const isHL = highlightCurve === data._name
    if (fillGrad) {
      ctx.beginPath()
      data.forEach((v,i) => { const x=xS(i),y=yS(Math.max(v,0)); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y) })
      ctx.lineTo(xS(n-1), y0); ctx.lineTo(xS(0), y0); ctx.closePath()
      const g = ctx.createLinearGradient(0,PAD.t,0,H-PAD.b)
      g.addColorStop(0, color+(isHL?'40':'1A')); g.addColorStop(1, color+'00')
      ctx.fillStyle = g; ctx.fill()
    }
    ctx.setLineDash(dash||[]); ctx.lineJoin='round'; ctx.lineCap='round'
    ctx.beginPath()
    data.forEach((v,i) => i===0?ctx.moveTo(xS(i),yS(v)):ctx.lineTo(xS(i),yS(v)))
    ctx.strokeStyle = color+(isHL?'60':'25'); ctx.lineWidth = isHL?glowW*1.5:glowW; ctx.stroke()
    ctx.beginPath()
    data.forEach((v,i) => i===0?ctx.moveTo(xS(i),yS(v)):ctx.lineTo(xS(i),yS(v)))
    ctx.strokeStyle = isHL?'#F4F7FA':color; ctx.lineWidth = isHL?lineW*1.5:lineW; ctx.stroke()
    if (isHL || data._name==='EE') {
      const step = Math.max(1, Math.floor(n/5))
      for (let i=0; i<n; i+=step) {
        const x=xS(i),y=yS(data[i])
        ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.strokeStyle=color+'30'; ctx.lineWidth=3; ctx.stroke()
        ctx.beginPath(); ctx.arc(x,y,2,0,Math.PI*2); ctx.fillStyle=color; ctx.fill()
      }
    }
    ctx.setLineDash([])
  }
  const eeArr=[...ee]; eeArr._name='EE'
  const eneArr=[...ene]; eneArr._name='ENE'
  const pfeArr=[...pfe]; pfeArr._name='PFE'
  drawCurve(eneArr,'#4a9ad4',[5,3],7,1.5,true)
  drawCurve(pfeArr,'#f0a020',[3,2],5,1.2,false)
  drawCurve(eeArr, '#0dd4a8',[],   8,2.0,true)
  ctx.fillStyle='#5F6C7B'; ctx.textAlign='center'; ctx.font='10px JetBrains Mono,monospace'
  ;[0,0.25,0.5,0.75,1].forEach(frac => {
    const i=Math.round(frac*(n-1)); ctx.fillText((i/12).toFixed(0)+'Y', xS(i), H-PAD.b+10)
  })
}

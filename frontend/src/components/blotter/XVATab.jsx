// XVATab.jsx — Sprint 6A (final)
import { useState, useEffect, useRef } from 'react'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const TENORS_6 = ['1Y','2Y','3Y','5Y','7Y','10Y']

const VA_DEFS = {
  npv:    { label:'NPV',    color:'#F4F7FA', desc:'Present value at mid-market. Positive = asset to you. This is the base price before any XVA adjustments.', curve:'none' },
  cva:    { label:'CVA',    color:'#e05040', desc:'Credit Valuation Adjustment = -LGD x Sum[ EE(t) x (PD_cp(t) - PD_cp(t-dt)) x DF(t) ]. Cost of counterparty default risk over the EE profile. Always negative.', curve:'EE' },
  dva:    { label:'DVA',    color:'#4a9ad4', desc:'Debt Valuation Adjustment = +LGD x Sum[ |ENE(t)| x (PD_own(t) - PD_own(t-dt)) x DF(t) ]. Benefit from your own default risk. Always positive. Excluded from regulatory capital.', curve:'ENE' },
  fva:    { label:'FVA',    color:'#e05040', desc:'Funding Valuation Adjustment = -(FTP/10000) x Sum[ EE(t) x dt x DF(t) ]. Cost of funding positive exposure when no CSA. Always negative.', curve:'EE' },
  fba:    { label:'FBA',    color:'#4a9ad4', desc:'Funding Benefit Adjustment = +(FTP x ratio/10000) x Sum[ |ENE(t)| x dt x DF(t) ]. Benefit when counterparty funds your negative MTM. FBA/FTP ratio typically 0.5-0.7.', curve:'ENE' },
  kva:    { label:'KVA',    color:'#e05040', desc:'Capital Valuation Adjustment = -(Hurdle/100) x Sum[ Capital(t) x dt x DF(t) ]. Capital(t) = SA-CCR EAD x 8% RWA. Often the largest VA for vanilla IRS.', curve:'EE' },
  mva:    { label:'MVA',    color:'#f0a020', desc:'Margin Valuation Adjustment = -Sum[ IM(t) x FTP(t) x dt x DF(t) ]. Cost of funding SIMM initial margin. IM is derived from the ISDA SIMM IR delta risk weight applied to the trade IR01, and amortises with residual maturity.', curve:'none' },
  all_in: { label:'ALL-IN', color:'#0dd4a8', desc:'NPV + CVA + DVA + FVA + FBA + KVA + MVA. Full economic cost of the trade. Client pays ALL-IN rate; desk runs NPV.', curve:'none' },
}

const TIPS = {
  a: { title: 'Mean reversion  a',
    body: 'Speed at which rates snap back toward the long-run level.\nHW1F SDE: dr = (theta - a x r) dt + sigma x dW\n\nLow a (0.01-0.02): rates drift slowly, wide exposure profiles, larger CVA/FVA.\nHigh a (0.10+): rates revert fast, narrow long-dated exposure.\n\nCALIBRATION: L-BFGS-B minimises RMSE between hw1f_vol(a, sigma, T_e, 5Y) and market ATM vol across the 5Y-tenor column. a controls the slope of the vol term structure.' },
  sigma: { title: 'Vol sigma (bp normal)',
    body: 'Instantaneous short-rate vol in bp/year. Sets the level of all exposure profiles.\n\nFORMULA: sigma_n = sigma x w x sqrt(V(T_e) / T_e)\nwhere w = Sum[ alpha_i x P(0,T_i) x B*(T_e,T_i) ] / A(0)\nV(T_e) = (1 - exp(-2aT_e)) / (2a)\n\nWith a=0.01 and 5Y vols ~85bp, calibrated sigma ~32bp. Lower than quoted vol because the swap rate averages future short rates.\n\nHigher sigma -> wider EE/ENE -> higher CVA, DVA, FVA, FBA, KVA.' },
  theta: { title: 'Long-run rate theta',
    body: 'Drift anchor. Each Monte Carlo step:\nr(t+dt) = r(t) x exp(-a x dt) + theta x (1 - exp(-a x dt)) + sigma x sqrt((1-exp(-2a x dt))/(2a)) x Z\n\nTaken from the 5Y SOFR OIS swap rate on your bootstrapped curve. A full Hull-White calibration uses time-dependent theta(t) to exactly reprice today\'s yield curve. Flat approximation is adequate for XVA.' },
  paths: { title: 'Monte Carlo paths',
    body: 'Number of simulated short-rate scenarios, monthly time steps.\n\nEE(t) = (1/N) x Sum[ max(NPV_i(t), 0) ] - converges at ~500 paths\nENE(t) = (1/N) x Sum[ min(NPV_i(t), 0) ] - converges at ~500 paths\nPFE 95th percentile - needs ~2,000 for stable tail\nXVA integrals - converge at ~1,000 paths\n\nSeed fixed at 42 for reproducibility.' },
  wwr: { title: 'Wrong-way risk x',
    body: 'Multiplier on EE before CVA integration.\n\nWWR_CVA = -LGD x Sum[ (WWR x EE(t)) x dPD_cp(t) x DF(t) ]\n\n1.0 = no WWR. 1.5 = 50% amplification. SA-CCR embeds supervisory alpha=1.4 for general WWR - this slider adds a desk overlay.\n\nExample: receive-fixed IRS with a leveraged fund. Rates spike -> IRS in the money -> fund is under stress from rate-sensitive liabilities. EE and default probability move together.' },
  rmse: { title: 'Calibration RMSE (bp)',
    body: 'Root Mean Square Error between market ATM normal swaption vols and HW1F model-implied vols.\n\nRMSE = sqrt( Sum[ (sigma_model - sigma_mkt)^2 ] / N )\n\nUnder 1bp = excellent. 1-3bp = acceptable. Above 5bp = poor.\n\nWhy it matters: RMSE directly measures how accurately HW1F reproduces the market view of rate uncertainty. Low RMSE means EE/ENE and XVA are grounded in real market swaption prices, not ad-hoc choices.' },
  cpCds: { title: 'Counterparty CDS (bp)',
    body: 'Counterparty default swap spread. Drives CVA.\n\nh_cp = CDS_bp / (LGD x 10000)\nPD_cp(t) = 1 - exp(-h_cp x t)\nCVA = -LGD x Sum[ EE(t) x (PD(t) - PD(t-dt)) x DF(t) ]\n\nTypical IG bank: 40-80bp. IG corporate: 60-120bp. EM sovereign: 150-400bp.' },
  ownCds: { title: 'Own CDS spread (bp)',
    body: 'Your institution\'s CDS spread. Drives DVA.\n\nh_own = ownCDS_bp / (LGD x 10000)\nDVA = +LGD x Sum[ |ENE(t)| x (PD_own(t) - PD_own(t-dt)) x DF(t) ]\n\nDVA = gain from your own default option on negative exposure. Recognised in P&L under IFRS 9 but excluded from regulatory capital. Some desks zero it by policy.' },
  ftp: { title: 'FTP - Funding Transfer Price (bp)',
    body: 'Internal funding cost charged by treasury for uncollateralised exposure.\n\nFVA = -(FTP/10000) x Sum[ EE(t) x dt x DF(t) ]\nFBA = +(FTP x ratio/10000) x Sum[ |ENE(t)| x dt x DF(t) ]\n\nFVA: cost of borrowing to fund positive MTM with no CSA.\nFBA: benefit when counterparty funds your negative MTM.\nFTP ~= own CDS + liquidity spread. Typical: 40-70bp.' },
  lgd: { title: 'LGD - Loss Given Default (%)',
    body: 'Fraction of exposure lost on default. LGD = 1 - Recovery Rate.\n\nAppears twice:\n1. Loss scaling: CVA proportional to LGD x EE\n2. Hazard rate: h = CDS_bp / (LGD x 10000). Higher LGD -> lower h -> fewer expected defaults. The two effects partially offset.\n\nISDA standard: LGD=40% (60% recovery). With daily VM CSA, effective LGD can be under 5%.' },
  fbaRatio: { title: 'FBA / FTP ratio',
    body: 'Fraction of funding benefit you recognise.\n\nFBA = FTP x ratio x Sum[ |ENE(t)| x dt x DF(t) ]\n\n1.0 = full benefit. 0.5 = conservative. Most desks use 0.5-0.7.\n\nRationale for < 1: if the counterparty defaults while out of the money, you lose the benefit. Conservative booking discounts it.' },
  hurdle: { title: 'Hurdle rate (%)',
    body: 'Required return on regulatory capital.\n\nKVA = -(Hurdle/100) x Sum[ Capital(t) x dt x DF(t) ]\nCapital(t) = SA-CCR EAD(t) x 8% (Basel III RWA)\n\nTypical: 10-15% for investment banks. At 12% hurdle, a 5Y $10M IRS generates ~$70-80K KVA. KVA is often larger than CVA for vanilla rates trades.' },
  simmIm: { title: 'SIMM IM ($M)',
    body: 'ISDA SIMM initial margin for the inter-dealer hedge in $M. Linear MVA proxy:\n\nMVA~ = -(IM x $1M) x (FTP/10000) x T/2\n\nAssumes flat IM for T/2 years on average.\n\nFull Sprint 6B: IM(path, t) computed on each Monte Carlo path using ISDA SIMM delta sensitivities. MVA = -(FTP/10000) x Sum[ IM(t) x dt x DF(t) ].' },
  settlement: { title: 'Settlement / CSA',
    body: 'How the trade is margined. Every VA is computed on the RESIDUAL exposure after collateral:\n\nE+(t) = max(V(t) − VM(t) − IM_recv, 0)\n\nUNCOLLATERALISED — no variation margin. Full MtM at risk. IM may still be posted (legacy MVA).\n\nBILATERAL — daily VM under a CSA, thresholds and MTA apply, 10 business-day margin period of risk (BCBS-IOSCO floor for non-cleared). SIMM IM exchanged.\n\nON-CHAIN — atomic settlement: continuous VM, zero threshold and MTA, 5bd MPoR (the cleared floor). SIMM risk weights scale by sqrt(5/10) = 0.707, so IM and MVA fall 29.3%; SA-CCR margined maturity factor 1.5·sqrt(MPoR/250) cuts KVA by the same factor.' },
  mpor: { title: 'Margin period of risk (bd)',
    body: 'Business days between the last collateral call that would be honoured and close-out. VM held at t is what was called against V(t − MPoR); the exposure over that window is the residual.\n\nV(t − MPoR) sits between monthly grid points and is sampled from the Brownian bridge, which preserves the variance of the margin-period move.\n\nSIMM IM scales with sqrt(MPoR / 10). Bilateral floor 10bd; cleared / on-chain floor 5bd.' },
  threshold: { title: 'Threshold ($)',
    body: 'Exposure below which the counterparty posts no collateral. Uncollateralised up to this amount — adds straight back to EE and CVA. Zero under standard on-chain terms.' },
  mtaTip: { title: 'Minimum transfer amount ($)',
    body: 'Collateral calls smaller than this are not made. Modelled as: no VM held while |call| < MTA. Also enters SA-CCR replacement cost as TH + MTA − NICA.' },
  imYield: { title: 'IM yield pickup (bp)',
    body: 'Yield earned on posted initial margin, netted against its funding cost: MVA = −Σ IM(t) × (FTP − pickup) × dt × DF(t).\n\nTokenised sovereign collateral (e.g. tokenised T-bills) earns while posted; cash IM at a CCP typically does not. Leave blank for none.' },
  compare: { title: 'Compare on-chain',
    body: 'Runs a second simulation on the SAME paths under the ON-CHAIN preset (continuous VM, 5bd MPoR) and shows each VA side by side with the current settlement. Same seed, so the difference is purely the collateral terms.' },
  capModel: { title: 'Capital model',
    body: 'Regulatory CCR capital framework for KVA.\n\nSA-CCR (current standard): EAD = 1.4 x (RC + AddOn). RC = max(NPV,0). AddOn = Notional x SF x MF. SF(IRS)=0.5%. MF=sqrt(min(M,1)).\n\nCEM (legacy): EAD = max(NPV,0) + Notional x addon%. Addon: 0.5% (1-5Y IRS). Simpler, less risk-sensitive.\n\nIMM: full MC EPE with supervisory approval. Sprint 8.' },
}

function fmtDollar(v) {
  if (v == null) return '—'
  const sign = v >= 0 ? '+' : '-'
  return sign + '$' + Math.abs(Math.round(v)).toLocaleString('en-US')
}

function drawExposureChart(canvas, ee, ene, pfe, highlightCurve, samplePaths) {
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

// ── Calibration Proof Panel ────────────────────────────────────────────
const CalibProofPanel = ({ calib }) => {
  const [open, setOpen] = useState(false)
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!open || !calib?.fit_details || !canvasRef.current) return
    const canvas = canvasRef.current
    const dpr    = window.devicePixelRatio || 1
    const W = canvas.offsetWidth, H = 140
    canvas.width  = W * dpr
    canvas.height = H * dpr
    canvas.style.height = H + 'px'
    const ctx = canvas.getContext('2d')
    ctx.scale(dpr, dpr)

    const rows  = calib.fit_details
    const n     = rows.length
    const pad   = { l:40, r:12, t:14, b:28 }
    const cw    = (W - pad.l - pad.r) / n
    const barW  = Math.min(cw * 0.32, 14)
    const gap   = 3
    const vols  = rows.flatMap(r => [r.mkt_vol_bp||0, r.mdl_vol_bp||0])
    const maxV  = Math.max(...vols) * 1.15 || 100
    const scaleY = v => pad.t + (H - pad.t - pad.b) * (1 - v / maxV)

    // background
    ctx.fillStyle = '#0C1015'
    ctx.fillRect(0, 0, W, H)

    // gridlines
    const ticks = 4
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth   = 1
    for (let i = 0; i <= ticks; i++) {
      const y = pad.t + (H - pad.t - pad.b) * (i / ticks)
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke()
      const val = maxV * (1 - i / ticks)
      ctx.fillStyle = '#5F6C7B'
      ctx.font='10px JetBrains Mono,monospace'
      ctx.textAlign = 'right'
      ctx.fillText(val.toFixed(0), pad.l - 3, y + 3)
    }

    // bars + labels
    rows.forEach((row, i) => {
      const cx = pad.l + i * cw + cw / 2
      const mkt = row.mkt_vol_bp || 0
      const mdl = row.mdl_vol_bp || 0

      // market bar (teal glow)
      const x1 = cx - barW - gap / 2
      const y1 = scaleY(mkt)
      const bh1 = H - pad.b - y1
      ctx.shadowColor = '#0dd4a8'; ctx.shadowBlur = 6
      ctx.fillStyle = '#0dd4a8'
      ctx.fillRect(x1, y1, barW, bh1)

      // model bar (amber glow)
      const x2 = cx + gap / 2
      const y2 = scaleY(mdl)
      const bh2 = H - pad.b - y2
      ctx.shadowColor = '#f0a020'; ctx.shadowBlur = 6
      ctx.fillStyle = '#f0a020'
      ctx.fillRect(x2, y2, barW, bh2)

      ctx.shadowBlur = 0

      // x label
      ctx.fillStyle = '#5F6C7B'
      ctx.font='10px JetBrains Mono,monospace'
      ctx.textAlign = 'center'
      const label = row.ticker ? row.ticker.replace('USD', '').replace(' ICPL Curncy','') : (row.expiry_y + 'Y×' + row.tenor_y + 'Y')
      ctx.fillText(label, cx, H - pad.b + 10)
    })

    // legend
    ctx.shadowBlur = 0
    ctx.fillStyle = '#0dd4a8'; ctx.fillRect(W - 90, 4, 8, 8)
    ctx.fillStyle = '#8B98A8'; ctx.font='10px JetBrains Mono,monospace'; ctx.textAlign = 'left'
    ctx.fillText('Market', W - 79, 12)
    ctx.fillStyle = '#f0a020'; ctx.fillRect(W - 35, 4, 8, 8)
    ctx.fillStyle = '#8B98A8'; ctx.fillText('Model', W - 24, 12)
  }, [open, calib])

  if (!calib?.fit_details) return null

  const errColor = e => {
    if (e == null) return 'var(--text-mute)'
    const abs = Math.abs(e)
    if (abs < 0.5) return 'var(--accent)'
    if (abs < 2.0) return 'var(--amber)'
    return 'var(--red)'
  }

  return (
    <div style={{marginBottom:'10px'}}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{display:'flex',alignItems:'center',gap:'6px',cursor:'pointer',
          padding:'4px 7px',borderRadius:'2px',
          background:'rgba(255,255,255,0.02)',border:'1px solid var(--border)',
          marginBottom: open ? '8px' : '0'}}
      >
        <span style={{fontSize:'0.8rem',fontWeight:700,letterSpacing:'.10em',
          color:'var(--text-mute)',fontFamily:'var(--mono)'}}>
          {open ? '▼' : '►'} CALIBRATION PROOF
        </span>
        <span style={{marginLeft:'auto',fontSize:'0.8rem',color: calib.fit_rmse_bp < 1 ? 'var(--accent)' : calib.fit_rmse_bp < 3 ? 'var(--amber)' : 'var(--red)',
          fontFamily:'var(--mono)',fontWeight:700}}>
          RMSE {calib.fit_rmse_bp?.toFixed(2)}bp
        </span>
      </div>
      {open && (
        <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'2px',padding:'8px',marginBottom:'4px'}}>
          {/* Chart */}
          <canvas ref={canvasRef} style={{width:'100%',display:'block',marginBottom:'8px'}}/>
          {/* Table */}
          <table style={{width:'100%',borderCollapse:'collapse',tableLayout:'fixed',fontFamily:'var(--mono)',fontSize:'0.8rem'}}>
            <thead>
              <tr style={{borderBottom:'1px solid var(--border)'}}>
                {['INSTRUMENT','EXPIRY','TENOR','MKT VOL','MDL VOL','ERROR'].map(h => (
                  <th key={h} style={{padding:'3px 5px',textAlign: h==='INSTRUMENT'?'left':'right',
                    color:'var(--text-mute)',fontWeight:700,letterSpacing:'.08em'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {calib.fit_details.map((row, i) => (
                <tr key={i} style={{borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                  <td style={{padding:'3px 5px',color:'var(--text-dim)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {row.ticker || (row.expiry_y + 'Y×' + row.tenor_y + 'Y')}
                  </td>
                  <td style={{padding:'3px 5px',textAlign:'right',color:'var(--text-dim)'}}>{row.expiry_y}Y</td>
                  <td style={{padding:'3px 5px',textAlign:'right',color:'var(--text-dim)'}}>{row.tenor_y}Y</td>
                  <td style={{padding:'3px 5px',textAlign:'right',color:'var(--accent)',fontWeight:600}}>{row.mkt_vol_bp?.toFixed(1)}</td>
                  <td style={{padding:'3px 5px',textAlign:'right',color:'var(--amber)',fontWeight:600}}>{row.mdl_vol_bp?.toFixed(1)}</td>
                  <td style={{padding:'3px 5px',textAlign:'right',color: errColor(row.error_bp),fontWeight:700}}>
                    {row.error_bp != null ? (row.error_bp >= 0 ? '+' : '') + row.error_bp.toFixed(2) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Footer */}
          <div style={{display:'flex',gap:'12px',marginTop:'6px',paddingTop:'6px',borderTop:'1px solid var(--border)'}}>
            <span style={{fontSize:'0.8rem',color:'var(--text-mute)',fontFamily:'var(--mono)'}}>
              Basket: {calib.basket_size} instruments · 5Y-tenor column
            </span>
            <span style={{marginLeft:'auto',fontSize:'0.8rem',fontFamily:'var(--mono)',
              color: calib.converged ? 'var(--accent)' : 'var(--red)'}}>
              {calib.converged ? '✔ CONVERGED' : '⚠ NOT CONVERGED'} · {calib.iterations} iter
            </span>
          </div>
        </div>
      )}
    </div>
  )
}


export default function XVATab({ trade, notionalRef, rateRef, effDate, matDate, valDate, curveId, getSession, analytics, parRate: parRateProp, xvaParamsRef, onSimResult, direction, instrumentType, swaptionExpiry, swaptionTenor, swaptionVol, swaptionResult }) {
  const canvasRef = useRef(null)
  const [tooltip, setTooltip] = useState(null)
  const [calib, setCalibState] = useState(() => {
    try { const s = sessionStorage.getItem('rijeka_xva_calib'); return s ? JSON.parse(s) : null } catch(_) { return null }
  })
  const setCalib = (v) => {
    setCalibState(v)
    try { if (v) sessionStorage.setItem('rijeka_xva_calib', JSON.stringify(v)); else sessionStorage.removeItem('rijeka_xva_calib') } catch(_) {}
  }
  const [calibErr, setCalibErr] = useState(null)
  const [calibrating, setCalibrating] = useState(false)
  const [simulating, setSimulating] = useState(false)
  const [simResult, setSimResultState] = useState(() => {
    try { const s = sessionStorage.getItem('rijeka_xva_sim'); return s ? JSON.parse(s) : null } catch(_) { return null }
  })
  const setSimResult = (v) => {
    setSimResultState(v)
    try { if (v) sessionStorage.setItem('rijeka_xva_sim', JSON.stringify(v)); else sessionStorage.removeItem('rijeka_xva_sim') } catch(_) {}
  }
  const [simErr, setSimErr] = useState(null)
  const [paths, setPaths] = useState(2000)
  const [aOverride, setAOverride] = useState('')
  const [sigOverride, setSigOverride] = useState('')
  const CP_DEFAULTS  = {'1Y':'72','2Y':'78','3Y':'83','5Y':'91','7Y':'97','10Y':'105'}
  const OWN_DEFAULTS = {'1Y':'38','2Y':'41','3Y':'44','5Y':'48','7Y':'51','10Y':'55'}
  const FTP_DEFAULTS = {'1Y':'42','2Y':'46','3Y':'50','5Y':'55','7Y':'58','10Y':'62'}
  const cpCdsRef  = useRef({...CP_DEFAULTS})
  const ownCdsRef = useRef({...OWN_DEFAULTS})
  const ftpRef    = useRef({...FTP_DEFAULTS})
  const [lgd, setLgd] = useState('40')
  const [fbaRatio, setFbaRatio] = useState('55')
  const [hurdle, setHurdle] = useState('12')
  const [capModel, setCapModel] = useState('sa_ccr')
  const [wwr, setWwr] = useState(1.0)
  // Blank => derive from ISDA SIMM (RW x IR01) server-side. A hardcoded
  // 0.85 was ~3x this trade's actual IM and flowed straight into MVA.
  const [simmIm, setSimmIm] = useState('')
  // Settlement / CSA. Default keeps the legacy numbers: no VM, IM posted.
  const [settlement, setSettlement] = useState('UNCOLLATERALISED')
  const [thresholdCp, setThresholdCp] = useState('')
  const [mta, setMta] = useState('')
  const [mporDays, setMporDays] = useState('')
  const [imExchanged, setImExchanged] = useState(false)
  const [imYieldBp, setImYieldBp] = useState('')
  const [compareOnChain, setCompareOnChain] = useState(false)
  const [compareResult, setCompareResultState] = useState(() => {
    try { const s = sessionStorage.getItem('rijeka_xva_cmp'); return s ? JSON.parse(s) : null } catch(_) { return null }
  })
  const setCompareResult = (v) => {
    setCompareResultState(v)
    try { if (v) sessionStorage.setItem('rijeka_xva_cmp', JSON.stringify(v)); else sessionStorage.removeItem('rijeka_xva_cmp') } catch(_) {}
  }
  const num = (v) => { const n = parseFloat(String(v).replace(/,/g,'')); return isNaN(n) ? null : n }
  const csaBody = (preset) => {
    const o = { preset, im_exchanged: imExchanged }
    if (preset === 'BILATERAL') {
      if (num(thresholdCp) != null) o.threshold_cp = num(thresholdCp)
      if (num(mta) != null)         o.mta          = num(mta)
      if (num(mporDays) != null)    o.mpor_days    = num(mporDays)
    }
    if (preset === 'ON_CHAIN') {
      if (num(mporDays) != null && settlement === 'ON_CHAIN') o.mpor_days = num(mporDays)
      if (num(imYieldBp) != null) o.im_yield_pickup_bp = num(imYieldBp)
    }
    return o
  }
  const [highlightCurve, setHighlightCurve] = useState(null)
  const [expandedVa, setExpandedVa] = useState(null)

  const tip = (key, e) => {
    const r = e.currentTarget.getBoundingClientRect()
    setTooltip({ key, x: r.right + 10, y: r.top })
  }

  useEffect(() => {
    ;(async () => {
      try {
        const session = await getSession()
        const res = await fetch(API + '/api/xva/calibration/latest', { headers: { Authorization: 'Bearer ' + session.access_token } })
        if (res.ok) { const d = await res.json(); if (d.exists) setCalib(d) }
      } catch(_) {}
    })()
  }, [])

  useEffect(() => {
    if (!simResult || !canvasRef.current) return
    const canvas = canvasRef.current
    const dpr = window.devicePixelRatio || 2
    const p = canvas.parentElement
    canvas.width = p.offsetWidth * dpr; canvas.height = p.offsetHeight * dpr
    canvas.style.width = p.offsetWidth + 'px'; canvas.style.height = p.offsetHeight + 'px'
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr)
    drawExposureChart(canvas, simResult.ee, simResult.ene, simResult.pfe, highlightCurve, simResult.sample_paths)
  }, [simResult, highlightCurve])

  const handleCalibrate = async () => {
    setCalibrating(true); setCalibErr(null)
    try {
      const session = await getSession()
      const res = await fetch(API + '/api/xva/calibrate', {
        method:'POST', headers:{ Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' },
        body: JSON.stringify({})
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Calibration failed')
      setCalib(d)
    } catch(e) { setCalibErr(e.message) }
    finally { setCalibrating(false) }
  }

  const handleSimulate = async () => {
    setSimulating(true); setSimErr(null)
    try {
      const session = await getSession()
      const notional = trade ? parseFloat(trade.notional) : parseFloat((notionalRef?.current?.value||'10000000').replace(/,/g,''))
      // The simulated swap must be struck at the trade's actual coupon. rateRef
      // is unmounted while this tab is showing, so falling back to it (and then
      // to a hardcoded 3.665) would strike the Monte Carlo ~45bp away from the
      // real trade. Prefer the solved par rate passed down as a prop.
      const rateFromRef  = parseFloat(rateRef?.current?.value)
      const rateFromProp = typeof parRateProp === 'number' ? parRateProp : parseFloat(parRateProp)
      const uiRate = isFinite(rateFromRef) && rateFromRef > 0
        ? rateFromRef
        : (isFinite(rateFromProp) && rateFromProp > 0 ? rateFromProp : NaN)
      const fixedRate = trade
        ? (trade.terms?.fixed_rate || 0.0365)
        : (isFinite(uiRate) ? uiRate / 100 : 0.0365)
      const matYears = (() => {
        const eff = trade ? trade.effective_date : effDate
        const mat = trade ? trade.maturity_date  : matDate
        if (!eff||!mat) return 5
        return (new Date(mat) - new Date(eff)) / (365.25*24*3600*1000)
      })()
      const TENOR_YEARS = {'1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'10Y':10}
      const toCurve = obj => Object.entries(TENOR_YEARS).map(([k,t]) => ({ t, spread_bp: parseFloat(obj[k]) || 0 }))
      const flatSpread = obj => {
        const raw = obj['5Y']
        const v = (raw !== null && raw !== undefined && raw !== '') ? raw
          : (Object.values(obj).find(x => x !== null && x !== undefined && x !== '') ?? '85')
        const n = parseFloat(v)
        return isNaN(n) ? 85 : n
      }
      const EXPIRY_Y = {'1M':1/12,'3M':0.25,'6M':0.5,'1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'10Y':10}
      const TENOR_Y  = {'1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'9Y':9,'10Y':10,'15Y':15,'20Y':20,'30Y':30}
      const body = {
        notional: isNaN(notional) ? 10000000 : notional,
        maturity_y: Math.max(0.5, matYears),
        fixed_rate: isNaN(fixedRate) ? 0.0365 : fixedRate,
        paths,
        direction: direction || trade?.direction || 'PAY',
        a:        aOverride   ? parseFloat(aOverride)   : undefined,
        sigma_bp: sigOverride ? parseFloat(sigOverride) : undefined,
        cp_cds_curve:  toCurve(cpCdsRef.current),
        own_cds_curve: toCurve(ownCdsRef.current),
        lgd:           parseFloat(lgd)/100,
        ftp_curve:     toCurve(ftpRef.current),
        fba_ratio:   parseFloat(fbaRatio)/100,
        hurdle_rate: parseFloat(hurdle)/100,
        capital_model: capModel,
        wwr_multiplier: wwr,
        csa: csaBody(settlement),
        // Blank = derive IM from ISDA SIMM (RW x IR01) rather than a guess.
        simm_im_m: (simmIm === '' || isNaN(parseFloat(simmIm))) ? null : parseFloat(simmIm),
        // TV and IR01 from the pricer: XVA is an adjustment to TV, not a
        // standalone number, and IR01 drives the SIMM IM behind MVA.
        npv:  analytics?.npv  != null ? Number(analytics.npv)  : null,
        ir01: analytics?.ir01 != null ? Number(analytics.ir01) : null,
        // Generate paths from the same curve, on the same date, that the pricer
        // values against — otherwise the exposure profile belongs to a
        // different market than the TV it is adjusting.
        valuation_date: valDate || undefined,
        curve_id: curveId || 'USD_SOFR',
        // Swaption-specific
        ...(instrumentType === 'IR_SWAPTION' ? {
          instrument_type:   'IR_SWAPTION',
          swaption_expiry_y: EXPIRY_Y[swaptionExpiry] || 1.0,
          swaption_tenor_y:  TENOR_Y[swaptionTenor]  || 5.0,
          swaption_vol_bp:   parseFloat(swaptionVol)  || 84.0,
          swaption_is_payer: (direction || 'PAY') === 'PAY',
          maturity_y: (EXPIRY_Y[swaptionExpiry]||1) + (TENOR_Y[swaptionTenor]||5),
          fixed_rate: swaptionResult?.forward_rate || (isNaN(fixedRate) ? 0.0365 : fixedRate),
        } : {}),
      }
      const res = await fetch(API + '/api/xva/simulate', {
        method:'POST', headers:{ Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' },
        body: JSON.stringify(body)
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.detail || 'Simulation failed')
      setSimResult(d)
      if (onSimResult) onSimResult(d)
      if (compareOnChain && settlement !== 'ON_CHAIN') {
        const res2 = await fetch(API + '/api/xva/simulate', {
          method:'POST', headers:{ Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' },
          body: JSON.stringify({ ...body, csa: csaBody('ON_CHAIN') })
        })
        const d2 = await res2.json()
        if (!res2.ok) throw new Error(d2.detail || 'On-chain comparison failed')
        setCompareResult(d2)
      } else {
        setCompareResult(null)
      }
    } catch(e) { setSimErr(e.message) }
    finally { setSimulating(false) }
  }

  const inp = { background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'2px',
    color:'var(--text-hi)', fontFamily:'var(--mono)', fontSize:'0.8125rem',
    padding:'3px 6px', outline:'none', width:'100%' }
  const lbl = { fontSize:'0.75rem', color:'var(--accent)', letterSpacing:'0.07em',
    fontFamily:'var(--sans)', marginBottom:'2px',
    borderBottom:'1px dashed rgba(13,212,168,0.4)', cursor:'help', paddingBottom:'1px' }
  const secHdr = { fontSize:'11px', fontWeight:700, letterSpacing:'0.18em', color:'var(--text)',
    fontFamily:'var(--sans)', paddingLeft:'10px', borderLeft:'3px solid var(--accent)', lineHeight:1.2,
    marginTop:'14px', marginBottom:'8px' }

  // Called by TradeBookingWindow at simulate time to get current XVA params
  if (xvaParamsRef) {
    xvaParamsRef.current = () => {
      const TMAP = {'1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'10Y':10}
      const toCurveP = obj => Object.entries(TMAP).map(([k,t]) => ({ t, spread_bp: parseFloat(obj[k]) || 0 }))
      const flat = obj => {
        const raw = obj['5Y']
        const v = (raw !== null && raw !== undefined && raw !== '') ? raw
          : (Object.values(obj).find(x => x !== null && x !== undefined && x !== '') ?? '85')
        const n = parseFloat(v)
        return isNaN(n) ? 0 : n
      }
      return {
        cp_cds_curve:  toCurveP(cpCdsRef.current),
        own_cds_curve: toCurveP(ownCdsRef.current),
        ftp_curve:     toCurveP(ftpRef.current),
        lgd:          parseFloat(lgd)/100,
        fba_ratio:    parseFloat(fbaRatio)/100,
        hurdle_rate:  parseFloat(hurdle)/100,
        capital_model: capModel,
        wwr_multiplier: wwr,
        csa: csaBody(settlement),
        simm_im_m:    (simmIm === '' || isNaN(parseFloat(simmIm))) ? null : parseFloat(simmIm),
        npv:  analytics?.npv  != null ? Number(analytics.npv)  : null,
        ir01: analytics?.ir01 != null ? Number(analytics.ir01) : null,
        // Generate paths from the same curve, on the same date, that the pricer
        // values against — otherwise the exposure profile belongs to a
        // different market than the TV it is adjusting.
        valuation_date: valDate || undefined,
        curve_id: curveId || 'USD_SOFR',
        paths,
      }
    }
  }
  const SpreadRow = ({ label, stateRef, tipKey }) => (
    <div style={{ marginBottom:'4px' }}>
      <div style={{ display:'grid', gridTemplateColumns:'56px repeat(6,1fr)', gap:'3px', alignItems:'center' }}>
        <div onMouseEnter={e=>tip(tipKey,e)} onMouseLeave={()=>setTooltip(null)}
          style={{ fontSize:'0.75rem', color:'var(--accent)', fontFamily:'var(--mono)',
            letterSpacing:'0.03em', borderBottom:'1px dashed rgba(13,212,168,0.4)',
            cursor:'help', paddingBottom:'1px' }}>{label}</div>
        {TENORS_6.map(t => (
          <input key={t} type='text' inputMode='decimal'
            placeholder='—' defaultValue={stateRef.current[t]||''}
            onBlur={e => { stateRef.current[t] = e.target.value }}
            style={{ ...inp, textAlign:'right', padding:'4px 6px', fontSize:'0.875rem',
              color: stateRef.current[t] ? 'var(--accent)' : 'var(--text-mute)',
              fontWeight: stateRef.current[t] ? 600 : 400 }} />
        ))}
      </div>
    </div>
  )

  const xva = simResult?.xva
  const tradeN = (() => { try { const n=trade?parseFloat(trade.notional):parseFloat((notionalRef?.current?.value||'10000000').replace(/,/g,'')); return isNaN(n)?10000000:n } catch(_){return 10000000} })()
  const matY = simResult ? simResult.steps/12 : 5
  const dv01 = tradeN * matY / 10000
  // Prefer the solved par rate passed down as a prop. Reading rateRef here is
  // unreliable: that input lives in the TRADE tab, which is unmounted while
  // this tab is showing, so the ref is null and the old code silently fell
  // back to a hardcoded 3.665 — which is why this panel could disagree with
  // the footer's all-in rate on the very same screen.
  const parRate = (() => {
    const p = typeof parRateProp === 'number' ? parRateProp : parseFloat(parRateProp)
    if (isFinite(p) && p > 0) return p
    try { const r = parseFloat(rateRef?.current?.value); return isFinite(r) && r > 0 ? r : NaN } catch (_) { return NaN }
  })()
  const parRateKnown = isFinite(parRate)
  const xvaTotalBp = xva ? [xva.cva,xva.dva,xva.fva,xva.fba,xva.kva,xva.mva].reduce((s,v)=>s+(v||0),0)/dv01 : 0
  const allInRate = parRate + xvaTotalBp/100

  return (
    <div style={{ flex:1, display:'flex', overflow:'hidden', background:'var(--bg)' }}>

      {/* LEFT PANEL */}
      <div style={{ width:'320px', minWidth:'320px', borderRight:'1px solid var(--border)',
        overflowY:'auto', padding:'12px', display:'flex', flexDirection:'column' }}>

        <div style={secHdr}>HW1F MODEL</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 100px', gap:'4px', marginBottom:'6px' }}>
          {[
            { label:'Mean reversion a', val: aOverride||(calib?.a?.toFixed(6)||'—'), set:setAOverride, tk:'a' },
            { label:'Vol σ bp (normal)', val: sigOverride||(calib?.sigma_bp?.toFixed(2)||'—'), set:setSigOverride, tk:'sigma' },
            { label:'Long-run θ %', val: calib?.theta!=null?(calib.theta*100).toFixed(4):'3.665', set:null, tk:'theta' },
          ].map(({ label, val, set, tk }) => (
            <div key={label} style={{ display:'contents' }}>
              <div onMouseEnter={e=>tip(tk,e)} onMouseLeave={()=>setTooltip(null)} style={{...lbl,alignSelf:'center'}}>{label}</div>
              <div style={{ display:'flex', alignItems:'center', gap:'3px' }}>
                {set ? (
                  <input type='text' value={val} onChange={e=>set(e.target.value)}
                    style={{ ...inp, textAlign:'right', color: val&&val!=='—'?'var(--accent)':'var(--text-dim)', borderColor: val?'rgba(13,212,168,0.3)':'var(--border)' }} />
                ) : (
                  <div style={{ ...inp, textAlign:'right', color:'var(--text-dim)' }}>{val}</div>
                )}
                {calib && set && <span style={{ fontSize:'0.8rem', color:'var(--accent)', whiteSpace:'nowrap', background:'rgba(13,212,168,0.08)', border:'1px solid rgba(13,212,168,0.2)', padding:'1px 3px', borderRadius:'2px' }}>CALIB</span>}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
          <div onMouseEnter={e=>tip('paths',e)} onMouseLeave={()=>setTooltip(null)} style={{...lbl,whiteSpace:'nowrap',marginBottom:0}}>PATHS</div>
          <input type='range' min='500' max='5000' step='500' value={paths} onChange={e=>setPaths(parseInt(e.target.value))} style={{flex:1,accentColor:'var(--accent)'}}/>
          <span style={{fontSize:'0.8125rem',color:'var(--blue)',fontFamily:'var(--mono)',minWidth:'40px',textAlign:'right'}}>{paths.toLocaleString()}</span>
        </div>

        <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
          <div onMouseEnter={e=>tip('wwr',e)} onMouseLeave={()=>setTooltip(null)} style={{...lbl,whiteSpace:'nowrap',marginBottom:0}}>WWR ×</div>
          <input type='range' min='1.0' max='2.0' step='0.1' value={wwr} onChange={e=>setWwr(parseFloat(e.target.value))} style={{flex:1,accentColor:'var(--amber)'}}/>
          <span style={{fontSize:'0.8125rem',color:'var(--amber)',fontFamily:'var(--mono)',minWidth:'30px',textAlign:'right'}}>{wwr.toFixed(1)}</span>
        </div>

        {calib ? (
          <div onMouseEnter={e=>tip('rmse',e)} onMouseLeave={()=>setTooltip(null)}
            style={{fontSize:'0.75rem',color:'var(--accent)',background:'rgba(13,212,168,0.05)',
            border:'1px solid rgba(13,212,168,0.15)',borderRadius:'2px',padding:'4px 7px',
            marginBottom:'8px',lineHeight:1.5,cursor:'help',borderBottom:'1px dashed rgba(13,212,168,0.3)'}}>
            ✔ CALIBRATED {calib.valuation_date} · RMSE {calib.fit_rmse_bp?.toFixed(2)}bp · {calib.basket_size} instruments
          </div>
        ) : (
          <div style={{fontSize:'0.75rem',color:'var(--text-mute)',marginBottom:'8px'}}>No master calibration — go to Configurations → XVA Parameters to calibrate.</div>
        )}
        {calibErr && <div style={{fontSize:'0.75rem',color:'var(--red)',marginBottom:'6px'}}>✘ {calibErr}</div>}

        <div style={{display:'flex',gap:'6px',marginBottom:'12px'}}>
          <button onClick={handleSimulate} disabled={simulating}
            style={{flex:1,padding:'6px',fontSize:'0.8125rem',fontWeight:700,letterSpacing:'0.06em',cursor:'pointer',borderRadius:'2px',fontFamily:'var(--mono)',border:'1px solid rgba(13,212,168,0.4)',background:'rgba(13,212,168,0.06)',color:'var(--accent)',opacity:simulating?0.5:1}}>
            {simulating?'SIMULATING...':'▶ SIMULATE'}
          </button>
        </div>
        <CalibProofPanel calib={calib}/>
        {simErr && <div style={{fontSize:'0.75rem',color:'var(--red)',marginBottom:'6px'}}>✘ {simErr}</div>}

        <div style={secHdr}>SPREAD CURVES (bp)</div>
        <div style={{display:'grid',gridTemplateColumns:'56px repeat(6,1fr)',gap:'3px',marginBottom:'4px'}}>
          <div/>
          {TENORS_6.map(t=>(<div key={t} style={{fontSize:'0.75rem',color:'var(--text-mute)',textAlign:'center',fontFamily:'var(--mono)'}}>{t}</div>))}
        </div>
        <SpreadRow label='CP CDS'  stateRef={cpCdsRef}  tipKey='cpCds' />
        <SpreadRow label='OWN CDS' stateRef={ownCdsRef} tipKey='ownCds' />
        <SpreadRow label='FTP bp'  stateRef={ftpRef}    tipKey='ftp' />

        <div style={secHdr}>SETTLEMENT</div>
        <div onMouseEnter={e=>tip('settlement',e)} onMouseLeave={()=>setTooltip(null)}
          style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'3px',marginBottom:'6px'}}>
          {[['UNCOLLATERALISED','NO CSA','var(--red)'],['BILATERAL','BILATERAL','var(--blue)'],['ON_CHAIN','ON-CHAIN','var(--accent)']].map(([k,label,c])=>(
            <button key={k} onClick={()=>{ setSettlement(k); setImExchanged(k!=='UNCOLLATERALISED') }}
              style={{padding:'5px 2px',fontSize:'0.8rem',fontWeight:700,letterSpacing:'0.06em',cursor:'pointer',borderRadius:'2px',
                fontFamily:'var(--mono)',
                border:settlement===k?'1px solid '+c:'1px solid var(--border)',
                background:settlement===k?c+'14':'transparent',color:settlement===k?c:'var(--text-mute)'}}>
              {label}
            </button>
          ))}
        </div>
        <div style={{fontSize:'0.8rem',color:'var(--text-mute)',lineHeight:1.5,marginBottom:'6px',fontFamily:'var(--sans)'}}>
          {settlement==='UNCOLLATERALISED' && 'No variation margin — full MtM at risk.'}
          {settlement==='BILATERAL' && 'Daily VM under CSA · 10bd MPoR floor · SIMM IM exchanged.'}
          {settlement==='ON_CHAIN' && 'Atomic settlement · continuous VM · zero TH/MTA · 5bd MPoR · SIMM IM × 0.707.'}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 80px',gap:'4px 8px'}}>
          {settlement==='BILATERAL' && [
            {label:'Threshold $',val:thresholdCp,set:setThresholdCp,tk:'threshold',ph:'0'},
            {label:'MTA $',val:mta,set:setMta,tk:'mtaTip',ph:'0'},
            {label:'MPoR bd',val:mporDays,set:setMporDays,tk:'mpor',ph:'10'},
          ].map(({label,val,set,tk,ph})=>(
            <div key={label} style={{display:'contents'}}>
              <div onMouseEnter={e=>tip(tk,e)} onMouseLeave={()=>setTooltip(null)} style={{...lbl,alignSelf:'center',marginBottom:0}}>{label}</div>
              <input type='text' value={val} placeholder={ph} onChange={e=>set(e.target.value)} style={{...inp,textAlign:'right'}}/>
            </div>
          ))}
          {settlement==='ON_CHAIN' && [
            {label:'MPoR bd',val:mporDays,set:setMporDays,tk:'mpor',ph:'5'},
            {label:'IM yield bp',val:imYieldBp,set:setImYieldBp,tk:'imYield',ph:'0'},
          ].map(({label,val,set,tk,ph})=>(
            <div key={label} style={{display:'contents'}}>
              <div onMouseEnter={e=>tip(tk,e)} onMouseLeave={()=>setTooltip(null)} style={{...lbl,alignSelf:'center',marginBottom:0}}>{label}</div>
              <input type='text' value={val} placeholder={ph} onChange={e=>set(e.target.value)} style={{...inp,textAlign:'right'}}/>
            </div>
          ))}
          <div style={{...lbl,alignSelf:'center',marginBottom:0,borderBottom:'none',cursor:'default'}}>SIMM IM exchanged</div>
          <label style={{display:'flex',justifyContent:'flex-end',alignItems:'center',cursor:'pointer'}}>
            <input type='checkbox' checked={imExchanged} onChange={e=>setImExchanged(e.target.checked)} style={{accentColor:'var(--amber)'}}/>
          </label>
          {settlement!=='ON_CHAIN' && (<>
            <div onMouseEnter={e=>tip('compare',e)} onMouseLeave={()=>setTooltip(null)} style={{...lbl,alignSelf:'center',marginBottom:0}}>Compare on-chain</div>
            <label style={{display:'flex',justifyContent:'flex-end',alignItems:'center',cursor:'pointer'}}>
              <input type='checkbox' checked={compareOnChain} onChange={e=>setCompareOnChain(e.target.checked)} style={{accentColor:'var(--accent)'}}/>
            </label>
          </>)}
        </div>

        <div style={secHdr}>ASSUMPTIONS</div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 80px',gap:'4px 8px'}}>
          {[
            {label:'LGD %',val:lgd,set:setLgd,tk:'lgd'},
            {label:'FBA/FTP ratio',val:fbaRatio,set:setFbaRatio,tk:'fbaRatio'},
            {label:'Hurdle rate %',val:hurdle,set:setHurdle,tk:'hurdle'},
            {label:'SIMM IM $M',val:simmIm,set:setSimmIm,tk:'simmIm'},
          ].map(({label,val,set,tk})=>(
            <div key={label} style={{display:'contents'}}>
              <div onMouseEnter={e=>tip(tk,e)} onMouseLeave={()=>setTooltip(null)} style={{...lbl,alignSelf:'center',marginBottom:0}}>{label}</div>
              <input type='text' value={val} onChange={e=>set(e.target.value)} style={{...inp,textAlign:'right'}}/>
            </div>
          ))}
          <div onMouseEnter={e=>tip('capModel',e)} onMouseLeave={()=>setTooltip(null)} style={{...lbl,alignSelf:'center',marginBottom:0}}>Capital model</div>
          <select value={capModel} onChange={e=>setCapModel(e.target.value)} style={{...inp,cursor:'pointer'}}>
            <option value='sa_ccr'>SA-CCR</option>
            <option value='cem'>CEM</option>
            <option value='imm'>IMM</option>
          </select>
        </div>
        <div style={{marginTop:'8px',fontSize:'0.8rem',color:'var(--text-mute)',lineHeight:1.5,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:'2px',padding:'5px 7px'}}>
          MVA = −Σ IM(t) × FTP(t) × dt × DF(t) · IM from ISDA SIMM IR delta (RW × IR01), amortising to maturity
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Swaption 2-phase EE context */}
        {instrumentType === 'IR_SWAPTION' && (
          <div style={{flexShrink:0, background:'rgba(74,154,212,0.04)',
            borderBottom:'1px solid rgba(74,154,212,0.15)', padding:'8px 12px'}}>
            <div style={{display:'flex', alignItems:'center', gap:'10px',
              marginBottom:'5px', flexWrap:'wrap'}}>
              <span style={{fontSize:'0.8rem', fontWeight:700, letterSpacing:'0.10em',
                color:'var(--blue)', fontFamily:'var(--mono)'}}>
                SWAPTION XVA — ANDERSEN-PITERBARG 2-PHASE EE
              </span>
              {swaptionExpiry && swaptionTenor && (
                <span style={{fontSize:'0.8rem', padding:'1px 6px', borderRadius:'2px',
                  background:'rgba(74,154,212,0.1)', border:'1px solid rgba(74,154,212,0.25)',
                  color:'var(--blue)', fontFamily:'var(--mono)'}}>
                  {swaptionExpiry}×{swaptionTenor} · {(direction||'PAY')==='PAY'?'Payer':'Receiver'}
                </span>
              )}
              {swaptionVol && (
                <span style={{fontSize:'0.8rem', color:'var(--text-mute)',
                  fontFamily:'var(--mono)'}}>
                  σ_N = {swaptionVol}bp
                  {swaptionResult?.sabr_vol_bp ? ` (SABR at K=${((swaptionResult.forward_rate||0.036)*100).toFixed(3)}%)` : ' (ATM)'}
                </span>
              )}
            </div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr',
              gap:'6px', fontSize:'0.75rem', fontFamily:'var(--mono)'}}>
              <div style={{background:'rgba(13,212,168,0.04)', border:'1px solid rgba(13,212,168,0.12)',
                borderRadius:'2px', padding:'6px 8px'}}>
                <div style={{color:'var(--accent)', fontWeight:700, marginBottom:'3px', fontSize:'0.8rem',
                  letterSpacing:'0.08em'}}>
                  PHASE 1 — PRE-EXPIRY (0 → {swaptionExpiry||'T_exp'})
                </div>
                <div style={{color:'var(--text-dim)', lineHeight:1.6, fontFamily:'var(--sans)'}}>
                  Long option → V(t) ≥ 0 always → <strong style={{color:'var(--text-hi)'}}>no negative exposure.</strong>
                  <br/>
                  EE(t) = E[N·A(t)·Bachelier(F(t), K, T_exp−t, σ_N)]
                  <br/>
                  F(t) from HW1F short rate paths. σ_N from SABR surface at strike K.
                </div>
              </div>
              <div style={{background:'rgba(74,154,212,0.04)', border:'1px solid rgba(74,154,212,0.12)',
                borderRadius:'2px', padding:'6px 8px'}}>
                <div style={{color:'var(--blue)', fontWeight:700, marginBottom:'3px', fontSize:'0.8rem',
                  letterSpacing:'0.08em'}}>
                  PHASE 2 — POST-EXPIRY ({swaptionExpiry||'T_exp'} → {swaptionExpiry||'T_exp'}+{swaptionTenor||'tenor'})
                </div>
                <div style={{color:'var(--text-dim)', lineHeight:1.6, fontFamily:'var(--sans)'}}>
                  Exercise if F(T_exp) {(direction||'PAY')==='PAY' ? '>' : '<'} K.
                  <strong style={{color:'var(--text-hi)'}}> Unexercised paths → EE = 0.</strong>
                  <br/>
                  EE(t) = E[max(IRS NPV(t), 0) · <strong>1</strong>(F(T_exp){(direction||'PAY')==='PAY'?'>':'<'}K)]
                  <br/>
                  CVA substantially lower than equivalent IRS — option caps pre-expiry exposure.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Exposure chart */}
        <div style={{flex:1,position:'relative',background:'var(--panel)',borderBottom:'1px solid var(--border)',minHeight:'160px'}}>
          <canvas ref={canvasRef} style={{display:'block',width:'100%',height:'100%'}}/>
          {!simResult && (
            <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
              <div style={{fontSize:'0.8125rem',color:'var(--text-mute)',letterSpacing:'0.08em',fontFamily:'var(--mono)'}}>EE / ENE / PFE — press SIMULATE</div>
            </div>
          )}
          {simResult && (
            <div style={{position:'absolute',top:'8px',right:'12px',display:'flex',gap:'12px'}}>
              {[{l:'EE',c:'var(--accent)',n:'EE'},{l:'ENE',c:'var(--blue)',n:'ENE'},{l:'PFE 95%',c:'var(--amber)',n:'PFE'}].map(({l,c,n})=>(
                <div key={n} onMouseEnter={()=>setHighlightCurve(n)} onMouseLeave={()=>setHighlightCurve(null)}
                  style={{display:'flex',alignItems:'center',gap:'5px',cursor:'pointer',fontSize:'0.75rem',color:highlightCurve===n?'var(--text-hi)':'var(--text-mute)',fontFamily:'var(--mono)'}}>
                  <div style={{width:'16px',height:'2px',background:c,opacity:highlightCurve===n?1:0.6}}/>{l}
                </div>
              ))}
            </div>
          )}
          {simResult && (
            <div style={{position:'absolute',bottom:'6px',right:'12px',fontSize:'0.8rem',color:'var(--text-mute)',fontFamily:'var(--mono)'}}>
              {simResult.n_paths.toLocaleString()} paths · HW1F · a={simResult.params.a.toFixed(4)} σ={simResult.params.sigma_bp.toFixed(1)}bp
              {simResult.csa && (
                <span style={{color:simResult.csa.collateralised?'var(--accent)':'var(--red)', marginLeft:'8px'}}>
                  · {simResult.csa.preset.replace('_','-')}{simResult.csa.collateralised ? ` · ${simResult.csa.mpor_days}bd MPoR` : ''}{simResult.csa.im_exchanged ? ' · IM' : ''}
                  {simResult.csa.collateralised && simResult.ee_gross && (() => {
                    const g = Math.max(...simResult.ee_gross), r = Math.max(...simResult.ee)
                    return <span style={{color:'var(--accent-dim)'}}> · peak EE gross {fmtDollar(g)} → residual {fmtDollar(r)} ({g>0?(-100*(1-r/g)).toFixed(0):'0'}%)</span>
                  })()}
                </span>
              )}
              {simResult.instrument_type==='IR_SWAPTION' && simResult.swaption && (
                <span style={{color:'var(--text-mute)', marginLeft:'8px'}}>
                  · 2-phase EE · expiry={simResult.swaption.expiry_y}Y · σ_N={simResult.swaption.vol_bp?.toFixed(1)}bp
                </span>
              )}
            </div>
          )}
        </div>

        {/* Unified XVA waterfall - $ and bp in same cell */}
        <div style={{flexShrink:0,overflowY:'auto',maxHeight:'280px'}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:'1px',background:'var(--border)'}}>
            {Object.entries(VA_DEFS).map(([key,def])=>{
              const val = xva?.[key]
              const isExp = expandedVa===key
              const bp = (val!=null && dv01>0 && key!=='npv' && key!=='all_in') ? (val/dv01).toFixed(1) : null
              return (
                <div key={key}
                  onClick={()=>setExpandedVa(isExp?null:key)}
                  onMouseEnter={()=>def.curve!=='none'&&setHighlightCurve(def.curve)}
                  onMouseLeave={()=>setHighlightCurve(null)}
                  style={{background:'var(--bg)',padding:'8px 8px 6px',cursor:'pointer',
                    borderTop:isExp?'2px solid '+def.color:'2px solid transparent'}}>
                  <div style={{fontSize:'0.8rem',fontWeight:700,letterSpacing:'0.10em',color:'var(--text-mute)',fontFamily:'var(--mono)',marginBottom:'4px'}}>{def.label}</div>
                  <div style={{fontSize:'0.9375rem',fontWeight:700,color:val!=null?def.color:'var(--text-mute)',fontFamily:'var(--mono)',marginBottom:'3px'}}>
                    {key==='npv' ? fmtDollar(val)
                     : key==='all_in' && xva ? fmtDollar(xva.all_in)
                     : fmtDollar(val)}
                  </div>
                  <div style={{borderTop:'1px solid var(--border)',paddingTop:'3px'}}>
                    {key==='npv' && <div style={{fontSize:'0.75rem',fontWeight:600,color:'var(--text-dim)',fontFamily:'var(--mono)'}}>{parRateKnown?parRate.toFixed(3)+'%':'—'}</div>}
                    {key==='npv' && <div style={{fontSize:'0.8rem',color:'var(--text-mute)',fontFamily:'var(--sans)'}}>par rate</div>}
                    {key==='all_in' && <div style={{fontSize:'0.75rem',fontWeight:700,color:'var(--accent)',fontFamily:'var(--mono)'}}>{parRateKnown?allInRate.toFixed(3)+'%':'—'}</div>}
                    {key==='all_in' && <div style={{fontSize:'0.8rem',color:'var(--accent)',fontFamily:'var(--sans)'}}>all-in rate</div>}
                    {bp!=null && <div style={{fontSize:'0.75rem',fontWeight:600,color:def.color+'AA',fontFamily:'var(--mono)'}}>{parseFloat(bp)>=0?'+':''}{bp}bp</div>}
                    {bp!=null && <div style={{fontSize:'0.8rem',color:'var(--text-mute)',fontFamily:'var(--sans)'}}>bp on rate</div>}
                  </div>
                </div>
              )
            })}
          </div>
          {expandedVa && VA_DEFS[expandedVa] && (
            <div style={{background:'var(--bg)',border:'1px solid var(--border)',borderTop:'none',padding:'10px 14px',fontSize:'0.8125rem',color:'var(--text-dim)',lineHeight:1.7,fontFamily:'var(--sans)'}}>
              <span style={{color:VA_DEFS[expandedVa].color,fontWeight:700,fontFamily:'var(--mono)',marginRight:'8px'}}>{VA_DEFS[expandedVa].label}</span>
              {VA_DEFS[expandedVa].desc}
              {VA_DEFS[expandedVa].curve!=='none' && <span style={{marginLeft:'8px',fontSize:'0.75rem',color:'var(--text-mute)'}}>· Driven by {VA_DEFS[expandedVa].curve} curve</span>}
            </div>
          )}
          {compareResult?.xva && xva && (
            <div style={{background:'var(--bg)',borderTop:'1px solid var(--border)'}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(8,1fr)',gap:'1px',background:'var(--border)'}}>
                {Object.keys(VA_DEFS).map(key=>{
                  const cur = xva[key], oc = compareResult.xva[key]
                  const delta = (cur!=null && oc!=null) ? oc - cur : null
                  const pct = (delta!=null && key!=='npv' && Math.abs(cur)>1) ? (delta/Math.abs(cur))*100 : null
                  const better = key==='all_in' ? (delta>0) : (delta!=null && Math.abs(oc) < Math.abs(cur))
                  return (
                    <div key={key} style={{background:'var(--bg-deep)',padding:'6px 8px'}}>
                      <div style={{fontSize:'0.8rem',letterSpacing:'0.10em',color:'var(--accent)',fontFamily:'var(--mono)',marginBottom:'2px'}}>{key==='npv'?'ON-CHAIN':''}</div>
                      <div style={{fontSize:'0.8125rem',fontWeight:700,color:oc!=null?'var(--accent)':'var(--text-mute)',fontFamily:'var(--mono)'}}>{fmtDollar(oc)}</div>
                      {pct!=null && key!=='all_in' && (
                        <div style={{fontSize:'0.8rem',color:better?'var(--accent)':'var(--red)',fontFamily:'var(--mono)'}}>
                          {delta>=0?'+':''}{fmtDollar(delta)} · {pct>=0?'+':''}{pct.toFixed(0)}%
                        </div>
                      )}
                      {key==='all_in' && delta!=null && (
                        <div style={{fontSize:'0.8rem',color:delta>=0?'var(--accent)':'var(--red)',fontFamily:'var(--mono)'}}>
                          {delta>=0?'+':''}{fmtDollar(delta)} vs {simResult.csa?.preset?.replace('_','-')}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div style={{padding:'4px 14px',fontSize:'0.8rem',color:'var(--accent-dim)',fontFamily:'var(--mono)',background:'var(--bg)'}}>
                Same {compareResult.n_paths?.toLocaleString()} paths, same seed · ON-CHAIN = continuous VM · {compareResult.csa?.mpor_days}bd MPoR · SIMM IM × {compareResult.csa?.simm_mpor_scale?.toFixed(3)} · IM {fmtDollar(compareResult.capital?.im_0)} vs {fmtDollar(simResult.capital?.im_0)}
              </div>
            </div>
          )}
          <div style={{padding:'4px 14px',fontSize:'0.8rem',color:'var(--text-mute)',fontFamily:'var(--mono)',background:'var(--bg)',borderTop:'1px solid var(--border)'}}>
            ALL-IN = NPV + CVA + DVA + FVA + FBA + KVA + MVA~ · Click any VA to expand · bp = VA / DV01
          </div>
        </div>
      </div>

      {/* Floating tooltip */}
      {tooltip && TIPS[tooltip.key] && (
        <div onMouseLeave={()=>setTooltip(null)}
          style={{position:'fixed',left:Math.min(tooltip.x,window.innerWidth-360),top:Math.max(8,tooltip.y-8),width:'340px',background:'var(--panel)',border:'1px solid rgba(13,212,168,0.4)',borderRadius:'2px',padding:'10px 12px',zIndex:9999,boxShadow:'0 4px 24px rgba(0,0,0,0.8)',pointerEvents:'none'}}>
          <div style={{fontSize:'0.8125rem',fontWeight:700,letterSpacing:'0.08em',color:'var(--accent)',fontFamily:'var(--mono)',marginBottom:'6px',borderBottom:'1px solid var(--border)',paddingBottom:'5px'}}>{TIPS[tooltip.key].title}</div>
          <div style={{fontSize:'0.75rem',color:'var(--text-dim)',lineHeight:1.7,fontFamily:'var(--sans)',whiteSpace:'pre-wrap'}}>{TIPS[tooltip.key].body}</div>
        </div>
      )}
    </div>
  )
}
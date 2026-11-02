// XVATab.jsx — Sprint 6A (final)
// The rates XVA tab. Its layout pieces (sliders, spread grid, settlement, assumptions, chart
// readouts, VA strip, on-chain row, tooltip) are shared with the FX / digital-asset panel through
// trade-window/xva-shared.jsx; the HW1F model block, the calibration proof and the swaption
// context stay here.
import { useState, useEffect, useRef } from 'react'
import ExposureCanvas from '../trade-window/ExposureCanvas'
import {
  SectionHeader, TipLabel, PathsWwrSliders, ModelBadge, SimulateButtons, ProofExpander,
  SpreadCurvesGrid, SettlementBlock, AssumptionsBlock, RunReadout, ChartReadout,
  VaStrip, OnChainCompareRow, VaFooter, FloatingTip,
} from '../trade-window/xva-shared.jsx'
import {
  INP, LEFT_COL, defaultSpreads, fmtDollar, tipAt, spreadCurvePayload, simmImValue,
  buildVaRows, onChainCompareRows,
} from '../trade-window/xva-shared'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

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

  const rmse = (
    <span style={{marginLeft:'auto',fontSize:'0.8rem',color: calib.fit_rmse_bp < 1 ? 'var(--accent)' : calib.fit_rmse_bp < 3 ? 'var(--amber)' : 'var(--red)',
      fontFamily:'var(--mono)',fontWeight:700}}>
      RMSE {calib.fit_rmse_bp?.toFixed(2)}bp
    </span>
  )

  return (
    <ProofExpander title='CALIBRATION PROOF' right={rmse} open={open} onToggle={() => setOpen(o => !o)}>
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
    </ProofExpander>
  )
}


export default function XVATab({ trade, notionalRef, rateRef, effDate, matDate, valDate, curveId, getSession, analytics, parRate: parRateProp, xvaParamsRef, onSimResult, direction, instrumentType, swaptionExpiry, swaptionTenor, swaptionVol, swaptionResult }) {
  const [tooltip, setTooltip] = useState(null)
  const [calib, setCalibState] = useState(() => {
    try { const s = sessionStorage.getItem('rijeka_xva_calib'); return s ? JSON.parse(s) : null } catch { return null }
  })
  const setCalib = (v) => {
    setCalibState(v)
    try { if (v) sessionStorage.setItem('rijeka_xva_calib', JSON.stringify(v)); else sessionStorage.removeItem('rijeka_xva_calib') } catch { /* ignore: sessionStorage unavailable */ }
  }
  const [calibErr] = useState(null)
  const [simulating, setSimulating] = useState(false)
  const [simResult, setSimResultState] = useState(() => {
    try { const s = sessionStorage.getItem('rijeka_xva_sim'); return s ? JSON.parse(s) : null } catch { return null }
  })
  const setSimResult = (v) => {
    setSimResultState(v)
    try { if (v) sessionStorage.setItem('rijeka_xva_sim', JSON.stringify(v)); else sessionStorage.removeItem('rijeka_xva_sim') } catch { /* ignore: sessionStorage unavailable */ }
  }
  const [simErr, setSimErr] = useState(null)
  const [paths, setPaths] = useState(2000)
  const [aOverride, setAOverride] = useState('')
  const [sigOverride, setSigOverride] = useState('')
  // The spread tenor grids; the cells commit on blur, before any SIMULATE click lands.
  const [spreads, setSpreads] = useState(defaultSpreads)
  const setSpread = (g, t, v) => setSpreads(s => ({ ...s, [g]: { ...s[g], [t]: v } }))
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
    try { const s = sessionStorage.getItem('rijeka_xva_cmp'); return s ? JSON.parse(s) : null } catch { return null }
  })
  const setCompareResult = (v) => {
    setCompareResultState(v)
    try { if (v) sessionStorage.setItem('rijeka_xva_cmp', JSON.stringify(v)); else sessionStorage.removeItem('rijeka_xva_cmp') } catch { /* ignore: sessionStorage unavailable */ }
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

  const tip = (key, e) => setTooltip({ key, ...tipAt(e) })
  const untip = () => setTooltip(null)

  useEffect(() => {
    ;(async () => {
      try {
        const session = await getSession()
        const res = await fetch(API + '/api/xva/calibration/latest', { headers: { Authorization: 'Bearer ' + session.access_token } })
        if (res.ok) { const d = await res.json(); if (d.exists) setCalib(d) }
      } catch { /* ignore: stale comparison state */ }
    })()
  }, [])

  const handleSimulate = async (useSeed = 42) => {      // 42 repeats exactly; RE-ROLL passes a fresh seed
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
      const EXPIRY_Y = {'1M':1/12,'3M':0.25,'6M':0.5,'1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'10Y':10}
      const TENOR_Y  = {'1Y':1,'2Y':2,'3Y':3,'5Y':5,'7Y':7,'9Y':9,'10Y':10,'15Y':15,'20Y':20,'30Y':30}
      const body = {
        notional: isNaN(notional) ? 10000000 : notional,
        maturity_y: Math.max(0.5, matYears),
        fixed_rate: isNaN(fixedRate) ? 0.0365 : fixedRate,
        paths,
        seed: Number.isFinite(useSeed) ? useSeed : 42,
        direction: direction || trade?.direction || 'PAY',
        a:        aOverride   ? parseFloat(aOverride)   : undefined,
        sigma_bp: sigOverride ? parseFloat(sigOverride) : undefined,
        ...spreadCurvePayload(spreads.cp, spreads.own, spreads.ftp),
        lgd:           parseFloat(lgd)/100,
        fba_ratio:   parseFloat(fbaRatio)/100,
        hurdle_rate: parseFloat(hurdle)/100,
        capital_model: capModel,
        wwr_multiplier: wwr,
        csa: csaBody(settlement),
        // Blank = derive IM from ISDA SIMM (RW x IR01) rather than a guess.
        simm_im_m: simmImValue(simmIm),
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

  // Called by TradeBookingWindow at simulate time to get current XVA params
  if (xvaParamsRef) {
    xvaParamsRef.current = () => {
      return {
        ...spreadCurvePayload(spreads.cp, spreads.own, spreads.ftp),
        lgd:          parseFloat(lgd)/100,
        fba_ratio:    parseFloat(fbaRatio)/100,
        hurdle_rate:  parseFloat(hurdle)/100,
        capital_model: capModel,
        wwr_multiplier: wwr,
        csa: csaBody(settlement),
        simm_im_m:    simmImValue(simmIm),
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

  const xva = simResult?.xva
  const tradeN = (() => { try { const n=trade?parseFloat(trade.notional):parseFloat((notionalRef?.current?.value||'10000000').replace(/,/g,'')); return isNaN(n)?10000000:n } catch {return 10000000} })()
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
    try { const r = parseFloat(rateRef?.current?.value); return isFinite(r) && r > 0 ? r : NaN } catch { return NaN }
  })()
  const xvaTotalBp = xva ? [xva.cva,xva.dva,xva.fva,xva.fba,xva.kva,xva.mva].reduce((s,v)=>s+(v||0),0)/dv01 : 0
  const allInRate = parRate + xvaTotalBp/100
  const vaRows = buildVaRows(xva, { kind: 'rate', dv01, parRate, allInRate })
  const cmpRows = onChainCompareRows(xva, compareResult?.xva)

  const settlementFields = settlement==='BILATERAL' ? [
    {label:'Threshold $',val:thresholdCp,set:setThresholdCp,tk:'threshold',ph:'0'},
    {label:'MTA $',val:mta,set:setMta,tk:'mtaTip',ph:'0'},
    {label:'MPoR bd',val:mporDays,set:setMporDays,tk:'mpor',ph:'10'},
  ] : settlement==='ON_CHAIN' ? [
    {label:'MPoR bd',val:mporDays,set:setMporDays,tk:'mpor',ph:'5'},
    {label:'IM yield bp',val:imYieldBp,set:setImYieldBp,tk:'imYield',ph:'0'},
  ] : []

  return (
    <div style={{ flex:1, display:'flex', overflow:'hidden', background:'var(--bg)' }}>

      {/* LEFT PANEL */}
      <div style={LEFT_COL}>

        <SectionHeader>HW1F MODEL</SectionHeader>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 100px', gap:'4px', marginBottom:'6px' }}>
          {[
            { label:'Mean reversion a', val: aOverride||(calib?.a?.toFixed(6)||'—'), set:setAOverride, tk:'a' },
            { label:'Vol σ bp (normal)', val: sigOverride||(calib?.sigma_bp?.toFixed(2)||'—'), set:setSigOverride, tk:'sigma' },
            { label:'Long-run θ %', val: calib?.theta!=null?(calib.theta*100).toFixed(4):'3.665', set:null, tk:'theta' },
          ].map(({ label, val, set, tk }) => (
            <div key={label} style={{ display:'contents' }}>
              <TipLabel tipKey={tk} tip={tip} untip={untip} style={{ alignSelf:'center' }}>{label}</TipLabel>
              <div style={{ display:'flex', alignItems:'center', gap:'3px' }}>
                {set ? (
                  <input type='text' value={val} onChange={e=>set(e.target.value)}
                    style={{ ...INP, textAlign:'right', color: val&&val!=='—'?'var(--accent)':'var(--text-dim)', borderColor: val?'rgba(13,212,168,0.3)':'var(--border)' }} />
                ) : (
                  <div style={{ ...INP, textAlign:'right', color:'var(--text-dim)' }}>{val}</div>
                )}
                {calib && set && <span style={{ fontSize:'0.8rem', color:'var(--accent)', whiteSpace:'nowrap', background:'rgba(13,212,168,0.08)', border:'1px solid rgba(13,212,168,0.2)', padding:'1px 3px', borderRadius:'2px' }}>CALIB</span>}
              </div>
            </div>
          ))}
        </div>

        <PathsWwrSliders paths={paths} setPaths={setPaths} wwr={wwr} setWwr={setWwr} tip={tip} untip={untip} />

        {calib ? (
          <ModelBadge kind='ok' tipKey='rmse' tip={tip} untip={untip}>
            ✔ CALIBRATED {calib.valuation_date} · RMSE {calib.fit_rmse_bp?.toFixed(2)}bp · {calib.basket_size} instruments
          </ModelBadge>
        ) : (
          <ModelBadge kind='muted'>No master calibration — go to Configurations → XVA Parameters to calibrate.</ModelBadge>
        )}
        {calibErr && <div style={{fontSize:'0.75rem',color:'var(--red)',marginBottom:'6px'}}>✘ {calibErr}</div>}

        <SimulateButtons simulating={simulating} hasResult={!!simResult}
          onSimulate={()=>handleSimulate(42)} onReroll={()=>handleSimulate(1+Math.floor(Math.random()*2147483000))} />
        <CalibProofPanel calib={calib}/>
        {simErr && <div style={{fontSize:'0.75rem',color:'var(--red)',marginBottom:'6px'}}>✘ {simErr}</div>}

        <SpreadCurvesGrid spreads={spreads} onChange={setSpread} tip={tip} untip={untip} />

        <SettlementBlock settlement={settlement} setSettlement={setSettlement}
          imExchanged={imExchanged} setImExchanged={setImExchanged}
          compareOnChain={compareOnChain} setCompareOnChain={setCompareOnChain}
          fields={settlementFields} tip={tip} untip={untip} />

        <AssumptionsBlock lgd={lgd} setLgd={setLgd} fbaRatio={fbaRatio} setFbaRatio={setFbaRatio}
          hurdle={hurdle} setHurdle={setHurdle} simmIm={simmIm} setSimmIm={setSimmIm}
          capModel={capModel} setCapModel={setCapModel} tip={tip} untip={untip} />
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
        <ExposureCanvas result={simResult} height='fill' highlight={highlightCurve} onHighlight={setHighlightCurve}
          style={{flex:1,border:'none',borderBottom:'1px solid var(--border)',borderRadius:0,minHeight:'160px'}}>
          <RunReadout result={simResult} />
          <ChartReadout result={simResult}
            model={<>HW1F · a={simResult?.params?.a?.toFixed(4)} σ={simResult?.params?.sigma_bp?.toFixed(1)}bp</>}>
            {simResult?.instrument_type==='IR_SWAPTION' && simResult.swaption && (
              <span style={{color:'var(--text-mute)', marginLeft:'8px'}}>
                · 2-phase EE · expiry={simResult.swaption.expiry_y}Y · σ_N={simResult.swaption.vol_bp?.toFixed(1)}bp
              </span>
            )}
          </ChartReadout>
        </ExposureCanvas>

        {/* Unified XVA waterfall - $ and bp in same cell */}
        <div style={{flexShrink:0,overflowY:'auto',maxHeight:'280px'}}>
          <VaStrip rows={vaRows} fmt={fmtDollar} expanded={expandedVa} setExpanded={setExpandedVa} onHighlight={setHighlightCurve} />
          <OnChainCompareRow rows={cmpRows} current={simResult} compare={compareResult} fmt={fmtDollar} />
          <VaFooter>ALL-IN = NPV + CVA + DVA + FVA + FBA + KVA + MVA~ · Click any VA to expand · bp = VA / IR01</VaFooter>
        </div>
      </div>

      {/* Floating tooltip */}
      <FloatingTip tooltip={tooltip} onLeave={untip} />
    </div>
  )
}

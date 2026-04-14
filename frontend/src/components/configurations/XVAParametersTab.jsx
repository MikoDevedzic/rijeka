// XVAParametersTab.jsx — Sprint 6A
import { useEffect, useState } from 'react';
import useXVAStore from '../../store/useXVAStore';
import { SWAPTION_EXPIRIES, SWAPTION_TENORS, HW1F_CALIBRATION_BASKET } from '../../data/swaptionVols';
import './XVAParametersTab.css';
import { supabase as _supa } from '../../lib/supabase';
const _API  = import.meta.env?.VITE_API_URL || 'http://localhost:8000';

const INNER_TABS = ['RATES · HW1F','FX','CREDIT','EQUITY'];
const BASKET_KEYS = new Set(HW1F_CALIBRATION_BASKET.map((b)=>b.expiry+'|'+b.tenor));
const isBasket=(e,t)=>BASKET_KEYS.has(e+'|'+t);

function VolCell({expiry,tenor,ticker,vol_bp}){
  const updateVol=useXVAStore((s)=>s.updateVol);
  return(
    <td className={'xva-td'+(isBasket(expiry,tenor)?' basket':'')}>
      <div className='xva-ticker'>{ticker.replace(' Curncy','')}</div>
      <input
        className='xva-vol-input'
        type='text' inputMode='decimal' placeholder='—'
        value={vol_bp!==null&&vol_bp!==undefined?vol_bp:''}
        onChange={(e)=>updateVol(expiry,tenor,e.target.value)}
      />
    </td>
  );
}

function RatesHW1FTab(){
  const grid           = useXVAStore((s)=>s.grid);
  const snapshotSaving = useXVAStore((s)=>s.snapshotSaving);
  const snapshotSaved  = useXVAStore((s)=>s.snapshotSaved);
  const snapshotError  = useXVAStore((s)=>s.snapshotError);
  const saveSnapshot   = useXVAStore((s)=>s.saveSnapshot);
  const loadLatest     = useXVAStore((s)=>s.loadLatestSnapshot);
  const filledCount    = useXVAStore((s)=>s.filledCount);
  const [saveDate,setSaveDate]=useState(new Date().toISOString().slice(0,10));
  const [calibrating,setCalibrating]=useState(false);
  const [calibResult,setCalibResult]=useState(null);
  const [calibErr,setCalibErr]=useState(null);
  const [showMethod,setShowMethod]=useState(false);
  useEffect(()=>{loadLatest();},[]);

  const handleCalibrate = async () => {
    setCalibrating(true); setCalibErr(null);
    try {
      const { data:{ session } } = await _supa.auth.getSession();
      const res = await fetch(_API + '/api/xva/calibrate', {
        method:'POST',
        headers:{ Authorization:'Bearer '+session.access_token, 'Content-Type':'application/json' },
        body: JSON.stringify({ curve_id:'USD_SOFR', valuation_date: saveDate })
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail||'Calibration failed');
      setCalibResult(d);
    } catch(e) { setCalibErr(e.message); }
    finally { setCalibrating(false); }
  };

  const filled=filledCount();
  const total=SWAPTION_EXPIRIES.length*SWAPTION_TENORS.length;

  const mono = { fontFamily:"'IBM Plex Mono',monospace" };
  const methodSection = (title, color, children) => (
    <div style={{ marginBottom:'12px' }}>
      <div style={{ fontSize:'0.6875rem', fontWeight:700, letterSpacing:'0.12em',
        color, ...mono, marginBottom:'5px', paddingBottom:'3px',
        borderBottom:`1px solid ${color}22` }}>{title}</div>
      {children}
    </div>
  );
  const row = (label, value, note) => (
    <div style={{ display:'grid', gridTemplateColumns:'180px 1fr', gap:'8px',
      marginBottom:'4px', alignItems:'baseline' }}>
      <span style={{ fontSize:'0.75rem', color:'#888', ...mono }}>{label}</span>
      <span style={{ fontSize:'0.8125rem', color:'#F0F0F0', ...mono, lineHeight:1.5 }}>
        {value}
        {note && <span style={{ color:'#555', fontSize:'0.6875rem', marginLeft:'6px' }}>{note}</span>}
      </span>
    </div>
  );

  return(
    <div className='xva-rates-tab'>

      {/* ── Methodology panel ─────────────────────────────────────────── */}
      <div style={{ background:'#050505', border:'1px solid #1E1E1E', borderRadius:'2px',
        marginBottom:'10px' }}>
        <div onClick={()=>setShowMethod(!showMethod)}
          style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'7px 12px', cursor:'pointer',
            borderBottom: showMethod ? '1px solid #1E1E1E' : 'none' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <span style={{ fontSize:'0.6875rem', fontWeight:700, letterSpacing:'0.12em',
              color:'#00D4A8', ...mono }}>WHAT IS BEING CALIBRATED AND WHY</span>
            <span style={{ fontSize:'0.6875rem', color:'#444', ...mono }}>
              Hull-White 1-Factor · Q-measure · ATM swaption basket
            </span>
          </div>
          <span style={{ color:'#444', fontSize:'0.75rem' }}>{showMethod ? '▲' : '▼'}</span>
        </div>

        {showMethod && (
          <div style={{ padding:'12px 14px', display:'grid', gridTemplateColumns:'1fr 1fr',
            gap:'0 24px' }}>

            {methodSection('THE MODEL — Hull-White 1-Factor (HW1F)', '#00D4A8',
              <div style={{ fontSize:'0.8125rem', color:'#888', lineHeight:1.7,
                fontFamily:"'IBM Plex Sans',sans-serif" }}>
                HW1F simulates the evolution of the short rate <em>r(t)</em> under the risk-neutral
                measure Q. The stochastic differential equation is:
                <div style={{ margin:'6px 0', padding:'6px 10px', background:'#0A0A0A',
                  border:'1px solid #1E1E1E', borderRadius:'2px', ...mono,
                  fontSize:'0.8125rem', color:'#F5C842', letterSpacing:'0.02em' }}>
                  dr = (θ − a·r) dt + σ dW
                </div>
                This gives us the distribution of rates at every future time step, from which we
                compute bond prices P(t,T), annuities A(t), forward swap rates F(t), and
                ultimately the NPV of your trade on each simulated path.
              </div>
            )}

            {methodSection('THE TWO PARAMETERS', '#4A9EFF',
              <div>
                {row('a  (mean reversion)', 'Speed at which rates snap back to θ',
                  'Low a → slow mean reversion → wide EE profiles → higher CVA/FVA')}
                {row('σ  (short rate vol bp/yr)', 'Instantaneous volatility of the short rate',
                  'Higher σ → wider paths → larger all XVA components')}
                {row('θ  (long-run level)', 'Fixed from 5Y SOFR OIS rate',
                  'Not calibrated — taken directly from your bootstrapped curve')}
                <div style={{ fontSize:'0.75rem', color:'#555', marginTop:'6px', lineHeight:1.6,
                  fontFamily:"'IBM Plex Sans',sans-serif" }}>
                  Note: Full HW1F uses time-dependent θ(t) to exactly reprice the yield curve.
                  Flat θ is adequate for XVA — the error on CVA is second-order.
                </div>
              </div>
            )}

            {methodSection('CALIBRATION TARGET — Why ATM swaptions?', '#F5C842',
              <div style={{ fontSize:'0.8125rem', color:'#888', lineHeight:1.7,
                fontFamily:"'IBM Plex Sans',sans-serif" }}>
                XVA depends on the <strong style={{color:'#F0F0F0'}}>risk-neutral distribution</strong> of
                future rates — not the statistical (P-measure) distribution. ATM swaption prices encode
                exactly this: they are the market's consensus on future rate uncertainty under Q.
                <br/><br/>
                A swaption expiring at T_e on a swap of tenor T_s has normal vol:
                <div style={{ margin:'6px 0', padding:'6px 10px', background:'#0A0A0A',
                  border:'1px solid #1E1E1E', borderRadius:'2px', ...mono,
                  fontSize:'0.8125rem', color:'#F5C842' }}>
                  σ_N = σ · w(T_e, T_s) · √(V(T_e) / T_e)
                </div>
                where w is the annuity-weighted B* factor and V(T_e) = (1−e<sup>−2aT_e</sup>)/(2a).
                Calibrating to the 5Y-tenor column gives (a, σ) that reproduce market vol
                term structure — ensuring EE profiles are grounded in real market prices.
              </div>
            )}

            {methodSection('CALIBRATION BASKET', '#4A9EFF',
              <div style={{ fontSize:'0.8125rem', color:'#888', lineHeight:1.7,
                fontFamily:"'IBM Plex Sans',sans-serif" }}>
                <strong style={{color:'#F0F0F0'}}>5Y-tenor diagonal</strong> (1Y×5Y, 2Y×5Y, 3Y×5Y, 5Y×5Y, 7Y×5Y, 10Y×5Y)
                — spans the full expiry range with a single tenor, giving a stable identification of
                (a, σ) without cross-tenor noise. The 5Y swap covers the typical IRS maturity range
                most relevant for XVA.
                <br/><br/>
                Optimizer: L-BFGS-B minimizing weighted RMSE. Longer expiries get lower weights
                (0.8× at 7Y, 0.6× at 10Y) since HW1F fit degrades at long horizons.
              </div>
            )}

            {methodSection('HOW THIS FLOWS INTO XVA', '#00D4A8',
              <div style={{ fontSize:'0.8125rem', lineHeight:1.7,
                fontFamily:"'IBM Plex Sans',sans-serif" }}>
                <div style={{ display:'flex', alignItems:'center', gap:'6px', flexWrap:'wrap',
                  ...mono, fontSize:'0.75rem', color:'#666' }}>
                  {['ATM vols (USSNA)', '→', 'HW1F calibration', '→', '(a, σ)',
                    '→', 'MC paths r(t)', '→', 'P(t,T), F(t), NPV(t)',
                    '→', 'EE / ENE / PFE', '→', 'CVA · DVA · FVA · KVA'
                  ].map((s,i) => (
                    <span key={i} style={{ color: s==='→' ? '#333' :
                      s.includes('CVA') ? '#FF6B6B' :
                      s.includes('ATM') ? '#F5C842' :
                      s.includes('a, σ') ? '#4A9EFF' : '#888' }}>{s}</span>
                  ))}
                </div>
                <div style={{ marginTop:'8px', color:'#555', fontSize:'0.75rem' }}>
                  <strong style={{color:'#F0F0F0'}}>For IR_SWAPTION:</strong> same (a, σ) drive the paths.
                  Pre-expiry EE uses Bachelier(F(t), K, T_exp−t, σ_N) — the SABR surface vol at strike K.
                  Post-expiry EE filters to exercised paths only (Andersen-Piterbarg approximation).
                </div>
              </div>
            )}

            {methodSection('QUALITY INDICATOR — RMSE', '#F5C842',
              <div>
                {row('RMSE < 1bp', '✓ Excellent', 'EE profiles closely match market swaption prices')}
                {row('RMSE 1–3bp', '~ Acceptable', 'Small model error, standard for vanilla XVA')}
                {row('RMSE > 5bp', '✗ Poor', 'Check vol data quality or basket composition')}
                <div style={{ fontSize:'0.75rem', color:'#555', marginTop:'6px', lineHeight:1.6,
                  fontFamily:"'IBM Plex Sans',sans-serif" }}>
                  HW1F cannot fit the full swaption surface (it has only 2 free parameters).
                  The 5Y-tenor column fit is the industry standard compromise for XVA purposes.
                </div>
              </div>
            )}

          </div>
        )}
      </div>

      <div className='xva-header-strip'>
        <div className='xva-header-left'>
          <span className='xva-header-title'>USD ATM NORMAL VOL SURFACE</span>
          <span className='xva-header-sub'>bp · SOFR · ATM straddle · Bloomberg USSNA[expiry][tenor] Curncy · leave source blank</span>
        </div>
        <div className='xva-header-right'>
          {snapshotSaved&&<span className='xva-saved-badge'>SAVED {snapshotSaved.date} · {snapshotSaved.source}</span>}
          <span className='xva-filled-badge'>{filled}/{total} cells</span>
        </div>
      </div>
      <div className='xva-grid-wrap'>
        <table className='xva-grid'>
          <thead><tr>
            <th className='xva-th-corner'>EXP \ TEN</th>
            {SWAPTION_TENORS.map((t)=>(<th key={t} className='xva-th-tenor'>{t}</th>))}
          </tr></thead>
          <tbody>
            {grid.map((row)=>(
              <tr key={row.expiry}>
                <td className='xva-th-expiry'>{row.expiry}</td>
                {row.cells.map((cell)=>(
                  <VolCell key={cell.tenor} expiry={row.expiry} tenor={cell.tenor} ticker={cell.ticker} vol_bp={cell.vol_bp}/>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className='xva-legend'>
        <span className='xva-legend-dot basket-dot'></span>
        <span className='xva-legend-label'>HW1F calibration basket — co-terminal + diagonal + long-end anchors</span>
      </div>
      <div className='xva-save-bar'>
        <div className='xva-save-left'>
          <label className='xva-date-label'>VALUATION DATE</label>
          <input className='xva-date-input' type='date' value={saveDate} onChange={(e)=>setSaveDate(e.target.value)}/>
          <span className='xva-source-badge'>SOURCE · BLOOMBERG</span>
        </div>
        <div className='xva-save-right'>
          {snapshotError&&<span className='xva-error-msg'>{snapshotError}</span>}
          <button className='xva-save-btn' onClick={()=>saveSnapshot(saveDate)} disabled={snapshotSaving||filled===0}>
            {snapshotSaving?'↻  SAVING…':'↓  SAVE TO DB'}
          </button>
          <button className='xva-calib-btn' onClick={handleCalibrate} disabled={calibrating||filled===0}>
            {calibrating?'CALIBRATING...':'⎋  CALIBRATE HW1F'}
          </button>
        </div>
      </div>
      {calibErr&&<div style={{fontSize:'0.75rem',color:'#FF6B6B',padding:'4px 0'}}>✘ {calibErr}</div>}
      {calibResult&&(
        <div style={{padding:'8px 10px',background:'rgba(0,212,168,0.04)',
          border:'1px solid rgba(0,212,168,0.2)',borderRadius:'2px',marginTop:'6px'}}>
          <div style={{fontSize:'0.6875rem',fontWeight:700,letterSpacing:'0.10em',
            color:'#00D4A8',fontFamily:"'IBM Plex Mono',monospace",marginBottom:'5px'}}>
            ✔ CALIBRATION COMPLETE
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'6px'}}>
            {[
              {l:'Mean reversion a', v:calibResult.a?.toFixed(6), c:'#4A9EFF',
               note:'Controls EE profile shape'},
              {l:'Short rate vol σ', v:(calibResult.sigma_bp?.toFixed(2)||'—')+'bp',
               c:'#4A9EFF', note:'Drives EE/ENE width'},
              {l:'Fit RMSE', v:(calibResult.fit_rmse_bp?.toFixed(3)||'—')+'bp',
               c:calibResult.fit_rmse_bp<1?'#00D4A8':calibResult.fit_rmse_bp<3?'#F5C842':'#FF6B6B',
               note:calibResult.fit_rmse_bp<1?'Excellent':calibResult.fit_rmse_bp<3?'Acceptable':'Poor'},
              {l:'Basket size', v:calibResult.basket_size+' instruments',
               c:'#888', note:'5Y-tenor diagonal'},
            ].map(({l,v,c,note})=>(
              <div key={l} style={{background:'#050505',border:'1px solid #1E1E1E',
                borderRadius:'2px',padding:'5px 8px'}}>
                <div style={{fontSize:'0.6rem',color:'#555',letterSpacing:'0.08em',
                  fontFamily:"'IBM Plex Mono',monospace",marginBottom:'2px'}}>{l}</div>
                <div style={{fontSize:'0.875rem',fontWeight:700,color:c,
                  fontFamily:"'IBM Plex Mono',monospace"}}>{v}</div>
                <div style={{fontSize:'0.6rem',color:'#444',marginTop:'1px'}}>{note}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:'0.6875rem',color:'#555',marginTop:'6px',
            fontFamily:"'IBM Plex Mono',monospace",lineHeight:1.6}}>
            Stored as master calibration · Auto-loads into all trade XVA simulations (IRS + IR_SWAPTION)
          </div>
        </div>
      )}
      <div className='xva-calib-note' style={{marginTop:'8px',lineHeight:1.7,
        fontSize:'0.8125rem',color:'#444',fontFamily:"'IBM Plex Sans',sans-serif",
        background:'#050505',border:'1px solid #0F0F0F',borderRadius:'2px',padding:'8px 10px'}}>
        <strong style={{color:'#888'}}>Workflow:</strong> (1) Ensure vol surface is populated above.
        (2) Hit <strong style={{color:'#00D4A8'}}>⎋ CALIBRATE HW1F</strong> to fit (a, σ) to the 5Y-tenor basket.
        (3) Calibrated params auto-load into every XVA simulation — no manual entry needed.
        <br/>
        <strong style={{color:'#888'}}>For OTM swaption XVA:</strong> HW1F drives rate paths. 
        SABR surface (Swaption Vol ATM → OTM Skew tab) provides σ_N(K) for pre-expiry Bachelier pricing.
        Both must be calibrated for accurate swaption XVA.
      </div>
    </div>
  );
}

function StubTab({label}){
  return(<div className='xva-stub-tab'><span className='xva-stub-label'>{label}</span><span className='xva-stub-sub'>Coming in Sprint 7</span></div>);
}

export default function XVAParametersTab(){
  const [innerTab,setInnerTab]=useState('RATES · HW1F');
  return(
    <div className='xva-params-root'>
      <div className='xva-inner-tabs'>
        {INNER_TABS.map((tab)=>(<button key={tab} className={'xva-inner-tab'+(innerTab===tab?' active':'')} onClick={()=>setInnerTab(tab)}>{tab}</button>))}
      </div>
      <div className='xva-inner-content'>
        {innerTab==='RATES · HW1F'&&<RatesHW1FTab/>}
        {innerTab==='FX'&&<StubTab label='FX VOL SURFACE'/>}
        {innerTab==='CREDIT'&&<StubTab label='CREDIT SPREADS'/>}
        {innerTab==='EQUITY'&&<StubTab label='EQUITY VOL SURFACE'/>}
      </div>
    </div>
  );
}
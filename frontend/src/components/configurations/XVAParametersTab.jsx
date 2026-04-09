// XVAParametersTab.jsx — Sprint 6A
import { useEffect, useState } from 'react';
import useXVAStore from '../../store/useXVAStore';
import { SWAPTION_EXPIRIES, SWAPTION_TENORS, HW1F_CALIBRATION_BASKET } from '../../data/swaptionVols';
import './XVAParametersTab.css';

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
  useEffect(()=>{loadLatest();},[]);
  const filled=filledCount();
  const total=SWAPTION_EXPIRIES.length*SWAPTION_TENORS.length;
  return(
    <div className='xva-rates-tab'>
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
        </div>
      </div>
      <div className='xva-calib-note'>
        After saving, hit <strong>↻ CALIBRATE</strong> in the XVA tab of any trade window to fit HW1F
        parameters a and σ from this surface (Q-measure, ATM swaptions). Calibrated values persist in
        Supabase and load automatically on next simulation.
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
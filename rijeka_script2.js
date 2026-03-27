const fs = require('fs');
const path = require('path');
const ROOT = 'C:\\Users\\mikod\\OneDrive\\Desktop\\Rijeka\\frontend\\src';
function write(rel, content) {
  const full = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
  console.log('wrote:', rel);
}

// ── NewTradeWorkspace.css ─────────────────────────────────────────────────────
write('components/blotter/NewTradeWorkspace.css', `.ntw { display:flex; flex-direction:column; height:100%; overflow:hidden; }
.ntw-header { display:flex; align-items:center; justify-content:space-between; padding:0.75rem 1.5rem; border-bottom:1px solid var(--border); background:var(--panel); flex-shrink:0; gap:1rem; }
.ntw-title { font-size:0.8rem; font-weight:700; letter-spacing:0.14em; color:var(--amber); }
.ntw-instrument-row { display:flex; align-items:center; gap:0.75rem; flex:1; }
.ntw-body { display:flex; flex:1; overflow:hidden; }
.ntw-left { width:55%; min-width:520px; border-right:1px solid var(--border); display:flex; flex-direction:column; overflow:hidden; }
.ntw-section-hdr { padding:0.6rem 1.25rem; border-bottom:1px solid var(--border); font-size:0.6rem; font-weight:700; letter-spacing:0.14em; color:var(--text-dim); background:var(--bg-deep); flex-shrink:0; }
.ntw-scroll { flex:1; overflow-y:auto; padding:0.75rem 1.25rem; display:flex; flex-direction:column; gap:0.75rem; }
.ntw-right { flex:1; display:flex; flex-direction:column; overflow:hidden; }
.cf-preview { flex:1; overflow-y:auto; }
.cf-table { width:100%; border-collapse:collapse; font-size:0.68rem; font-family:var(--mono); }
.cf-table th { padding:0.4rem 0.75rem; text-align:left; font-size:0.58rem; font-weight:700; letter-spacing:0.1em; color:var(--text-dim); border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--panel-2); z-index:1; }
.cf-table td { padding:0.4rem 0.75rem; border-bottom:1px solid color-mix(in srgb, var(--border) 40%, transparent); }
.cf-stub { color:var(--text-dim); font-style:italic; font-size:0.6rem; }
.leg-card { border:1px solid var(--border); border-radius:3px; background:var(--panel); overflow:hidden; }
.leg-card-hdr { display:flex; align-items:center; gap:0.75rem; padding:0.6rem 1rem; cursor:pointer; background:var(--panel-2); border-bottom:1px solid var(--border); transition:background 0.12s; }
.leg-card-hdr:hover { background:var(--panel-3); }
.leg-dir-badge { font-size:0.6rem; font-weight:700; letter-spacing:0.1em; padding:0.15rem 0.45rem; border-radius:2px; border:1px solid; }
.leg-type-label { font-size:0.68rem; font-weight:700; letter-spacing:0.08em; color:var(--text); }
.leg-ccy { font-size:0.62rem; color:var(--text-dim); }
.leg-notional { font-size:0.68rem; font-weight:600; color:var(--text); margin-left:auto; }
.leg-chevron { color:var(--text-dim); font-size:0.6rem; margin-left:0.5rem; transition:transform 0.15s; }
.leg-chevron-open { transform:rotate(180deg); }
.leg-body { padding:0.85rem 1rem; display:flex; flex-direction:column; gap:0.5rem; }
.leg-tabs { display:flex; gap:0; border-bottom:1px solid var(--border); margin-bottom:0.6rem; }
.leg-tab { padding:0.35rem 0.85rem; font-family:var(--mono); font-size:0.62rem; font-weight:600; letter-spacing:0.08em; color:var(--text-dim); cursor:pointer; border-bottom:2px solid transparent; transition:all 0.12s; background:none; border-top:none; border-left:none; border-right:none; }
.leg-tab:hover { color:var(--text); }
.leg-tab-active { color:var(--accent); border-bottom-color:var(--accent); }
.fg { display:flex; flex-direction:column; gap:0.2rem; }
.fg label { font-size:0.58rem; font-weight:600; letter-spacing:0.1em; color:var(--text-dim); }
.fg input, .fg select { background:var(--panel-2); border:1px solid var(--border); color:var(--text); font-family:var(--mono); font-size:0.7rem; padding:0.3rem 0.5rem; border-radius:2px; outline:none; transition:border-color 0.15s; width:100%; box-sizing:border-box; }
.fg input:focus, .fg select:focus { border-color:var(--accent); }
.fg input::placeholder { color:var(--text-dim); opacity:0.5; }
.fg select option { background:var(--panel-3); }
.row2 { display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; }
.row3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.5rem; }
.row4 { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:0.5rem; }
.sec-lbl { font-size:0.58rem; font-weight:700; letter-spacing:0.14em; color:var(--accent); padding-bottom:0.25rem; border-bottom:1px solid color-mix(in srgb,var(--border) 60%,transparent); margin-top:0.25rem; }
.sched-table { width:100%; border-collapse:collapse; font-size:0.68rem; font-family:var(--mono); }
.sched-table th { padding:0.3rem 0.5rem; text-align:left; font-size:0.58rem; font-weight:700; letter-spacing:0.1em; color:var(--text-dim); border-bottom:1px solid var(--border); }
.sched-table td { padding:0.25rem 0.25rem; }
.sched-table input { background:var(--bg); border:1px solid var(--border); color:var(--text); font-family:var(--mono); font-size:0.68rem; padding:0.2rem 0.4rem; border-radius:2px; width:100%; outline:none; }
.sched-table input:focus { border-color:var(--accent); }
.btn-row-add { background:none; border:1px dashed var(--border); color:var(--text-dim); font-family:var(--mono); font-size:0.62rem; padding:0.25rem 0.75rem; cursor:pointer; border-radius:2px; width:100%; margin-top:0.3rem; transition:all 0.12s; }
.btn-row-add:hover { border-color:var(--accent); color:var(--accent); }
.btn-row-del { background:none; border:none; color:var(--text-dim); cursor:pointer; padding:0.1rem 0.3rem; font-size:0.65rem; }
.btn-row-del:hover { color:var(--red); }
.btn-add-leg { background:none; border:1px dashed var(--border); color:var(--text-dim); font-family:var(--mono); font-size:0.65rem; letter-spacing:0.08em; padding:0.5rem; cursor:pointer; border-radius:2px; transition:all 0.15s; width:100%; }
.btn-add-leg:hover { border-color:var(--blue); color:var(--blue); }
.ntw-footer { display:flex; gap:0.6rem; padding:0.85rem 1.25rem; border-top:1px solid var(--border); background:var(--panel-2); flex-shrink:0; }
.btn-cancel { flex:1; background:transparent; border:1px solid var(--border); color:var(--text-dim); font-family:var(--mono); font-size:0.65rem; font-weight:600; letter-spacing:0.08em; padding:0.5rem; border-radius:2px; cursor:pointer; transition:all 0.15s; }
.btn-cancel:hover { border-color:var(--text-dim); color:var(--text); }
.btn-book-trade { flex:3; background:var(--amber); border:none; color:var(--bg-deep); font-family:var(--mono); font-size:0.7rem; font-weight:700; letter-spacing:0.1em; padding:0.5rem; border-radius:2px; cursor:pointer; transition:opacity 0.15s; }
.btn-book-trade:hover:not(:disabled) { opacity:0.85; }
.btn-book-trade:disabled { opacity:0.5; cursor:not-allowed; }
.form-err { font-size:0.68rem; color:var(--red); padding:0.35rem 0.6rem; background:color-mix(in srgb,var(--red) 8%,transparent); border:1px solid color-mix(in srgb,var(--red) 30%,transparent); border-radius:2px; }
.chip-s { background:transparent; border:1px solid var(--border); color:var(--text-dim); font-family:var(--mono); font-size:0.6rem; font-weight:600; letter-spacing:0.08em; padding:0.2rem 0.55rem; border-radius:2px; cursor:pointer; transition:all 0.12s; }
.chip-s:hover { border-color:var(--text-dim); color:var(--text); }
.chip-s-on { border-color:var(--accent); color:var(--accent); background:color-mix(in srgb,var(--accent) 8%,transparent); }
.notional-types { display:flex; gap:0.3rem; }
.nt-btn { background:transparent; border:1px solid var(--border); color:var(--text-dim); font-family:var(--mono); font-size:0.6rem; padding:0.2rem 0.5rem; cursor:pointer; border-radius:2px; transition:all 0.12s; }
.nt-btn:hover { border-color:var(--text-dim); }
.nt-btn-on { border-color:var(--blue); color:var(--blue); }
`);

// ── NewTradeWorkspace.jsx — FINAL COMPLETE VERSION ────────────────────────────
write('components/blotter/NewTradeWorkspace.jsx', `import { useState, useEffect } from 'react'
import { useTradesStore } from '../../store/useTradesStore'
import { useTabStore } from '../../store/useTabStore'
import { supabase } from '../../lib/supabase'
import './NewTradeWorkspace.css'

const ASSET_CLASSES = ['RATES','FX','CREDIT','EQUITY','COMMODITY']
const AC_COLOR = { RATES:'var(--accent)', FX:'var(--blue)', CREDIT:'var(--amber)', EQUITY:'var(--purple)', COMMODITY:'var(--red)' }

const INSTRUMENTS = {
  RATES:     ['IR_SWAP','OIS_SWAP','BASIS_SWAP','XCCY_SWAP','FRA','ZERO_COUPON_SWAP','STEP_UP_SWAP','INFLATION_SWAP','CMS_SWAP','CMS_SPREAD_SWAP'],
  FX:        ['FX_FORWARD','FX_SWAP','NDF'],
  CREDIT:    ['CDS','CDS_INDEX','TOTAL_RETURN_SWAP','ASSET_SWAP','RISK_PARTICIPATION'],
  EQUITY:    ['EQUITY_SWAP','VARIANCE_SWAP','DIVIDEND_SWAP','EQUITY_FORWARD'],
  COMMODITY: ['COMMODITY_SWAP','COMMODITY_BASIS_SWAP','ASIAN_COMMODITY_SWAP','EMISSIONS_SWAP'],
}

const DAY_COUNTS   = ['ACT/360','ACT/365','ACT/ACT','30/360','30E/360']
const FREQS        = ['MONTHLY','QUARTERLY','SEMI-ANNUAL','ANNUAL']
const BDCS         = ['MODIFIED_FOLLOWING','FOLLOWING','PRECEDING','NO_ADJUSTMENT']
const STUBS        = ['SHORT_FIRST','LONG_FIRST','SHORT_LAST','LONG_LAST']
const CALENDARS    = ['USD','EUR','GBP','JPY','CHF','CAD','AUD','JOINT']
const COMPOUNDINGS = ['NONE','FLAT','STRAIGHT','OIS_COMPOUND','OIS_AVERAGE']
const INDICES      = ['USD_SOFR','USD_LIBOR_3M','EUR_EURIBOR_3M','EUR_EURIBOR_6M','GBP_SONIA','JPY_TONAR','CHF_SARON','CAD_CORRA','AUD_AONIA']
const CCYS         = ['USD','EUR','GBP','JPY','CHF','CAD','AUD','NOK','SEK','DKK','SGD','HKD']
const COMMODITY_INDICES  = ['WTI_CRUDE','BRENT_CRUDE','HH_GAS','TTF_GAS','GOLD','SILVER','COPPER','CORN','WHEAT','SOYBEANS']
const SENIORITY    = ['SENIOR_UNSECURED','SUBORDINATED','SENIOR_SECURED']
const ASSET_TYPES  = ['BOND','EQUITY','LOAN','INDEX','BASKET']
const INFLATION_INDICES = ['USD_CPI_U','USD_CPI_W','EUR_HICP','GBP_RPI','GBP_CPI','JPY_CPI','CHF_CPI','AUD_CPI','CAD_CPI']
const EMISSIONS_INDICES = ['EUA','RGGI','CCA','UKA','NZU','ACCU','KAU']
const CMS_TENORS   = ['1Y','2Y','3Y','5Y','7Y','10Y','15Y','20Y','30Y']

// ── Leg defaults ──────────────────────────────────────────────────────────────
const LD = {
  FIXED: (dir='PAY',ccy='USD',notional='10000000') => ({
    leg_type:'FIXED',label:'FIXED LEG',direction:dir,currency:ccy,notional,
    notional_type:'BULLET',notional_schedule:[],
    day_count:'ACT/360',frequency:'SEMI-ANNUAL',bdc:'MODIFIED_FOLLOWING',
    calendar:'USD',stub_type:'SHORT_FIRST',roll_convention:'NONE',
    rate_type:'FLAT',fixed_rate:'',rate_schedule:[],
    payment_lag:'0',effective_date:'',maturity_date:'',
    first_period_start:'',last_period_end:'',
  }),
  FLOAT: (dir='RECEIVE',ccy='USD',idx='USD_SOFR',notional='10000000') => ({
    leg_type:'FLOAT',label:'FLOAT LEG',direction:dir,currency:ccy,notional,
    notional_type:'BULLET',notional_schedule:[],
    day_count:'ACT/360',frequency:'QUARTERLY',bdc:'MODIFIED_FOLLOWING',
    calendar:'USD',stub_type:'SHORT_FIRST',
    index:idx,leverage:'1.0',spread_type:'FLAT',spread:'0',spread_schedule:[],
    compounding:'NONE',cap:'',floor:'',fixing_lag:'2',lookback:'0',payment_lag:'0',
    effective_date:'',maturity_date:'',
  }),
  ZERO_COUPON: (dir='PAY',ccy='USD') => ({
    leg_type:'ZERO_COUPON',label:'ZC FIXED LEG',direction:dir,currency:ccy,notional:'10000000',
    day_count:'ACT/365',bdc:'MODIFIED_FOLLOWING',calendar:'USD',
    zc_rate:'',zc_compounding:'ANNUAL',effective_date:'',maturity_date:'',
  }),
  INFLATION: (dir='PAY',type='ZERO_COUPON') => ({
    leg_type:'INFLATION',label:'INFLATION LEG',direction:dir,currency:'USD',notional:'10000000',
    notional_type:'BULLET',notional_schedule:[],
    inflation_type:type,index:'USD_CPI_U',base_index:'',interpolation:'LINEAR',
    lag_months:'3',floor:'0',cap:'',
    day_count:'ACT/365',frequency:'ANNUAL',bdc:'MODIFIED_FOLLOWING',
    calendar:'USD',stub_type:'SHORT_FIRST',effective_date:'',maturity_date:'',
  }),
  CMS: (dir='RECEIVE',tenor='10Y') => ({
    leg_type:'CMS',label:\`CMS \${tenor} LEG\`,direction:dir,currency:'USD',notional:'10000000',
    notional_type:'BULLET',notional_schedule:[],
    cms_tenor:tenor,spread:'0',leverage:'1.0',cap:'',floor:'',fixing_lag:'2',
    day_count:'ACT/360',frequency:'SEMI-ANNUAL',bdc:'MODIFIED_FOLLOWING',
    calendar:'USD',stub_type:'SHORT_FIRST',effective_date:'',maturity_date:'',
  }),
  CDS_FEE: (dir='PAY') => ({
    leg_type:'CDS_FEE',label:'PROTECTION FEE',direction:dir,currency:'USD',notional:'10000000',
    spread_bps:'',frequency:'QUARTERLY',day_count:'ACT/360',bdc:'MODIFIED_FOLLOWING',
    effective_date:'',maturity_date:'',
  }),
  CDS_CONTINGENT: (dir='RECEIVE') => ({
    leg_type:'CDS_CONTINGENT',label:'CONTINGENT LEG',direction:dir,currency:'USD',notional:'10000000',
    recovery_rate:'0.40',seniority:'SENIOR_UNSECURED',settlement_type:'PHYSICAL',
    reference_entity:'',reference_isin:'',
  }),
  TOTAL_RETURN: (dir='PAY') => ({
    leg_type:'TOTAL_RETURN',label:'TOTAL RETURN LEG',direction:dir,currency:'USD',notional:'10000000',
    reference_asset:'',reference_asset_type:'BOND',reference_isin:'',
    return_type:'TOTAL_RETURN',dividend_treatment:'PASS_THROUGH',
    credit_event_settlement:'PHYSICAL',recovery_rate:'0.40',
    effective_date:'',maturity_date:'',
  }),
  EQUITY_RETURN: (dir='PAY') => ({
    leg_type:'EQUITY_RETURN',label:'EQUITY RETURN LEG',direction:dir,currency:'USD',notional:'10000000',
    reference:'',reference_type:'INDEX',return_type:'TOTAL_RETURN',
    initial_price:'',price_fixing_date:'',dividend_treatment:'PASS_THROUGH',
    effective_date:'',maturity_date:'',
  }),
  EQUITY_FWD: (dir='PAY') => ({
    leg_type:'EQUITY_FWD',label:'EQUITY FORWARD LEG',direction:dir,currency:'USD',notional:'10000000',
    reference:'',reference_type:'SINGLE_NAME',quantity:'',initial_price:'',forward_price:'',
    price_fixing_date:'',settlement_type:'CASH',dividend_treatment:'EXCLUDED',
    effective_date:'',maturity_date:'',
  }),
  COMMODITY_FLOAT: (dir='RECEIVE',idx='WTI_CRUDE') => ({
    leg_type:'COMMODITY_FLOAT',label:'COMMODITY FLOAT LEG',direction:dir,currency:'USD',notional:'10000000',
    commodity_index:idx,fixing_type:'AVERAGE_MONTHLY',fixing_source:'PLATTS',
    unit:'BBL',quantity:'',averaging_type:'ARITHMETIC',
    effective_date:'',maturity_date:'',
  }),
  EMISSIONS: (dir='RECEIVE',idx='EUA') => ({
    leg_type:'EMISSIONS_FLOAT',label:'EMISSIONS FLOAT LEG',direction:dir,currency:'EUR',notional:'10000000',
    emissions_index:idx,vintage_year:'',quantity:'',unit:'EUA',
    fixing_type:'AVERAGE_MONTHLY',fixing_source:'ICE',
    day_count:'ACT/360',frequency:'ANNUAL',bdc:'MODIFIED_FOLLOWING',calendar:'EUR',
    effective_date:'',maturity_date:'',
  }),
  VARIANCE: (dir='PAY') => ({
    leg_type:'VARIANCE',label:'VARIANCE LEG',direction:dir,currency:'USD',notional:'10000000',
    reference:'',variance_strike:'',vega_notional:'',
    observation_frequency:'DAILY',annualization_factor:'252',cap_variance:'',
    effective_date:'',maturity_date:'',
  }),
  DIVIDEND: (dir='PAY') => ({
    leg_type:'DIVIDEND',label:'DIVIDEND LEG',direction:dir,currency:'USD',notional:'10000000',
    reference:'',dividend_multiplier:'1.0',include_specials:'true',
    effective_date:'',maturity_date:'',
  }),
  RPA_FEE: (dir='RECEIVE') => ({
    leg_type:'RPA_FEE',label:'PARTICIPATION FEE',direction:dir,currency:'USD',notional:'10000000',
    participation_pct:'100',fee_bps:'',frequency:'QUARTERLY',
    day_count:'ACT/360',bdc:'MODIFIED_FOLLOWING',documentation:'LMA',
    effective_date:'',maturity_date:'',
  }),
  RPA_CONTINGENT: (dir='PAY') => ({
    leg_type:'RPA_CONTINGENT',label:'CONTINGENT LOSS LEG',direction:dir,currency:'USD',notional:'10000000',
    participation_pct:'100',funded:'UNFUNDED',
    underlying_obligor:'',underlying_facility:'',underlying_facility_type:'LOAN',
    recovery_rate:'0.40',documentation:'LMA',underlying_trade_id:'',
  }),
}

// ── Templates ─────────────────────────────────────────────────────────────────
const TEMPLATES = {
  IR_SWAP:           () => [LD.FIXED('PAY'), LD.FLOAT('RECEIVE')],
  OIS_SWAP:          () => [LD.FIXED('PAY'), {...LD.FLOAT('RECEIVE','USD','USD_SOFR'), compounding:'OIS_COMPOUND',frequency:'ANNUAL',label:'OIS FLOAT LEG'}],
  BASIS_SWAP:        () => [{...LD.FLOAT('PAY','USD','USD_SOFR'), label:'LEG 1 (SOFR)'}, {...LD.FLOAT('RECEIVE','USD','USD_LIBOR_3M'), label:'LEG 2 (LIBOR)'}],
  XCCY_SWAP:         () => [{...LD.FLOAT('PAY','EUR','EUR_EURIBOR_3M'), label:'EUR FLOAT (PAY)'}, {...LD.FLOAT('RECEIVE','USD','USD_SOFR'), label:'USD FLOAT (RECEIVE)'}],
  FRA:               () => [{...LD.FIXED('PAY'), label:'FRA FIXED',frequency:'SINGLE'}, {...LD.FLOAT('RECEIVE'), label:'FRA FLOAT',frequency:'SINGLE'}],
  ZERO_COUPON_SWAP:  () => [LD.ZERO_COUPON('PAY'), LD.FLOAT('RECEIVE')],
  STEP_UP_SWAP:      () => [{...LD.FIXED('PAY'), rate_type:'STEP', label:'STEP FIXED LEG'}, LD.FLOAT('RECEIVE')],
  INFLATION_SWAP:    () => [LD.INFLATION('PAY','ZERO_COUPON'), LD.FLOAT('RECEIVE')],
  CMS_SWAP:          () => [{...LD.CMS('RECEIVE','10Y'), label:'CMS 10Y LEG'}, LD.FLOAT('PAY')],
  CMS_SPREAD_SWAP:   () => [{...LD.CMS('RECEIVE','10Y'), label:'CMS 10Y LEG'}, {...LD.CMS('PAY','2Y'), label:'CMS 2Y LEG'}],
  FX_FORWARD:        () => [{...LD.FIXED('PAY','EUR'), label:'PAY LEG',frequency:'SINGLE'}, {...LD.FIXED('RECEIVE','USD'), label:'RECEIVE LEG',frequency:'SINGLE'}],
  FX_SWAP:           () => [{...LD.FIXED('PAY','EUR'), label:'NEAR PAY',frequency:'SINGLE'},{...LD.FIXED('RECEIVE','USD'), label:'NEAR RECEIVE',frequency:'SINGLE'},{...LD.FIXED('RECEIVE','EUR'), label:'FAR PAY',frequency:'SINGLE'},{...LD.FIXED('PAY','USD'), label:'FAR RECEIVE',frequency:'SINGLE'}],
  NDF:               () => [{...LD.FIXED('PAY'), label:'NDF FIXED',frequency:'SINGLE'}, {...LD.FIXED('RECEIVE'), label:'NDF FLOAT PROXY',frequency:'SINGLE'}],
  CDS:               () => [LD.CDS_FEE('PAY'), LD.CDS_CONTINGENT('RECEIVE')],
  CDS_INDEX:         () => [{...LD.CDS_FEE('PAY'), label:'INDEX FEE LEG'}, {...LD.CDS_CONTINGENT('RECEIVE'), label:'INDEX CONTINGENT'}],
  TOTAL_RETURN_SWAP: () => [LD.TOTAL_RETURN('PAY'), {...LD.FLOAT('RECEIVE','USD','USD_SOFR'), label:'FUNDING LEG'}],
  ASSET_SWAP:        () => [LD.FIXED('PAY'), LD.FLOAT('RECEIVE')],
  RISK_PARTICIPATION:() => [LD.RPA_FEE('RECEIVE'), LD.RPA_CONTINGENT('PAY')],
  EQUITY_SWAP:       () => [LD.EQUITY_RETURN('PAY'), {...LD.FLOAT('RECEIVE','USD','USD_SOFR'), label:'FUNDING LEG'}],
  VARIANCE_SWAP:     () => [LD.VARIANCE('PAY')],
  DIVIDEND_SWAP:     () => [LD.DIVIDEND('PAY'), {...LD.FIXED('RECEIVE'), label:'DIVIDEND FIXED LEG'}],
  EQUITY_FORWARD:    () => [LD.EQUITY_FWD('PAY'), {...LD.FIXED('RECEIVE'), label:'FORWARD PROCEEDS',frequency:'SINGLE'}],
  COMMODITY_SWAP:    () => [LD.COMMODITY_FLOAT('RECEIVE','WTI_CRUDE'), LD.FIXED('PAY')],
  COMMODITY_BASIS_SWAP: () => [{...LD.COMMODITY_FLOAT('PAY','WTI_CRUDE'), label:'NEAR MONTH'}, {...LD.COMMODITY_FLOAT('RECEIVE','WTI_CRUDE'), label:'FAR MONTH'}],
  ASIAN_COMMODITY_SWAP: () => [{...LD.COMMODITY_FLOAT('RECEIVE','WTI_CRUDE'), fixing_type:'AVERAGE_DAILY', label:'ASIAN FLOAT LEG'}, LD.FIXED('PAY')],
  EMISSIONS_SWAP:    () => [LD.EMISSIONS('RECEIVE','EUA'), LD.FIXED('PAY')],
}

// ── Cashflow generator ────────────────────────────────────────────────────────
function genCFs(legs, eff, mat) {
  if (!eff||!mat) return []
  const FM = {MONTHLY:1,QUARTERLY:3,'SEMI-ANNUAL':6,ANNUAL:12,SINGLE:null}
  const all = []
  legs.forEach((leg,li) => {
    const m = FM[leg.frequency]
    if (!m) { all.push({leg:li,label:leg.label,dir:leg.direction,date:mat,type:'SINGLE',ccy:leg.currency}); return }
    let d = new Date(eff); d.setMonth(d.getMonth()+m)
    const matD = new Date(mat)
    while(d<=matD) {
      all.push({leg:li,label:leg.label,dir:leg.direction,date:d.toISOString().substring(0,10),type:leg.leg_type,ccy:leg.currency})
      d=new Date(d); d.setMonth(d.getMonth()+m)
    }
  })
  return all.sort((a,b)=>a.date<b.date?-1:1)
}

// ── Shared sub-components ─────────────────────────────────────────────────────
function CommonLegFields({leg,set}) {
  return (<>
    <div className="row2">
      <div className="fg"><label>CURRENCY</label><select value={leg.currency} onChange={e=>set('currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>DIRECTION</label><select value={leg.direction} onChange={e=>set('direction',e.target.value)}><option>PAY</option><option>RECEIVE</option></select></div>
    </div>
    <div className="fg"><label>NOTIONAL TYPE</label>
      <div className="notional-types">
        {['BULLET','LINEAR_AMORT','MORTGAGE','CUSTOM'].map(nt=>(
          <button key={nt} className={\`nt-btn \${leg.notional_type===nt?'nt-btn-on':''}\`} onClick={()=>set('notional_type',nt)}>{nt}</button>
        ))}
      </div>
    </div>
    {leg.notional_type==='BULLET'&&<div className="fg"><label>NOTIONAL</label><input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}/></div>}
    {['LINEAR_AMORT','MORTGAGE'].includes(leg.notional_type)&&<div className="row2">
      <div className="fg"><label>INITIAL NOTIONAL</label><input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}/></div>
      <div className="fg"><label>FINAL NOTIONAL</label><input placeholder="0" value={leg.final_notional||''} onChange={e=>set('final_notional',e.target.value)}/></div>
    </div>}
    {leg.notional_type==='CUSTOM'&&<NotionalSched leg={leg} set={set}/>}
  </>)
}

function SchedFields({leg,set}) {
  return (<>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
    <div className="row4">
      <div className="fg"><label>DAY COUNT</label><select value={leg.day_count} onChange={e=>set('day_count',e.target.value)}>{DAY_COUNTS.map(d=><option key={d}>{d}</option>)}</select></div>
      <div className="fg"><label>FREQUENCY</label><select value={leg.frequency} onChange={e=>set('frequency',e.target.value)}>{FREQS.map(f=><option key={f}>{f}</option>)}</select></div>
      <div className="fg"><label>BDC</label><select value={leg.bdc} onChange={e=>set('bdc',e.target.value)}>{BDCS.map(b=><option key={b}>{b}</option>)}</select></div>
      <div className="fg"><label>STUB</label><select value={leg.stub_type} onChange={e=>set('stub_type',e.target.value)}>{STUBS.map(s=><option key={s}>{s}</option>)}</select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>CALENDAR</label><select value={leg.calendar} onChange={e=>set('calendar',e.target.value)}>{CALENDARS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>PAYMENT LAG (days)</label><input placeholder="0" value={leg.payment_lag||''} onChange={e=>set('payment_lag',e.target.value)}/></div>
    </div>
    <div className="row2">
      <div className="fg"><label>FIRST IRREG. START</label><input type="date" value={leg.first_period_start||''} onChange={e=>set('first_period_start',e.target.value)}/></div>
      <div className="fg"><label>LAST IRREG. END</label><input type="date" value={leg.last_period_end||''} onChange={e=>set('last_period_end',e.target.value)}/></div>
    </div>
  </>)
}

function NotionalSched({leg,set}) {
  const rows=leg.notional_schedule||[]
  return (<div>
    <table className="sched-table"><thead><tr><th>DATE</th><th>NOTIONAL</th><th/></tr></thead>
      <tbody>{rows.map((r,i)=>(<tr key={i}>
        <td><input type="date" value={r.date} onChange={e=>set('notional_schedule',rows.map((x,j)=>j===i?{...x,date:e.target.value}:x))}/></td>
        <td><input placeholder="10,000,000" value={r.notional} onChange={e=>set('notional_schedule',rows.map((x,j)=>j===i?{...x,notional:e.target.value}:x))}/></td>
        <td><button className="btn-row-del" onClick={()=>set('notional_schedule',rows.filter((_,j)=>j!==i))}>✕</button></td>
      </tr>))}</tbody>
    </table>
    <button className="btn-row-add" onClick={()=>set('notional_schedule',[...rows,{date:'',notional:''}])}>+ ADD NOTIONAL DATE</button>
  </div>)
}

function RateSched({leg,set}) {
  const rows=leg.rate_schedule||[]
  return (<div>
    <table className="sched-table"><thead><tr><th>FROM DATE</th><th>RATE</th><th/></tr></thead>
      <tbody>{rows.map((r,i)=>(<tr key={i}>
        <td><input type="date" value={r.from_date} onChange={e=>set('rate_schedule',rows.map((x,j)=>j===i?{...x,from_date:e.target.value}:x))}/></td>
        <td><input placeholder="0.0425" value={r.rate} onChange={e=>set('rate_schedule',rows.map((x,j)=>j===i?{...x,rate:e.target.value}:x))}/></td>
        <td><button className="btn-row-del" onClick={()=>set('rate_schedule',rows.filter((_,j)=>j!==i))}>✕</button></td>
      </tr>))}</tbody>
    </table>
    <button className="btn-row-add" onClick={()=>set('rate_schedule',[...rows,{from_date:'',rate:''}])}>+ ADD RATE STEP</button>
  </div>)
}

function SpreadSched({leg,set}) {
  const rows=leg.spread_schedule||[]
  return (<div>
    <table className="sched-table"><thead><tr><th>FROM DATE</th><th>SPREAD (bps)</th><th/></tr></thead>
      <tbody>{rows.map((r,i)=>(<tr key={i}>
        <td><input type="date" value={r.from_date} onChange={e=>set('spread_schedule',rows.map((x,j)=>j===i?{...x,from_date:e.target.value}:x))}/></td>
        <td><input placeholder="0" value={r.spread} onChange={e=>set('spread_schedule',rows.map((x,j)=>j===i?{...x,spread:e.target.value}:x))}/></td>
        <td><button className="btn-row-del" onClick={()=>set('spread_schedule',rows.filter((_,j)=>j!==i))}>✕</button></td>
      </tr>))}</tbody>
    </table>
    <button className="btn-row-add" onClick={()=>set('spread_schedule',[...rows,{from_date:'',spread:''}])}>+ ADD SPREAD STEP</button>
  </div>)
}

// ── Leg forms ─────────────────────────────────────────────────────────────────
function FixedForm({leg,set}) {
  const [tab,setTab]=useState('terms')
  return (<>
    <div className="leg-tabs">{['terms','schedule','rates'].map(t=><button key={t} className={\`leg-tab \${tab===t?'leg-tab-active':''}\`} onClick={()=>setTab(t)}>{t.toUpperCase()}</button>)}</div>
    {tab==='terms'&&<><CommonLegFields leg={leg} set={set}/>
      <div className="sec-lbl">RATE</div>
      <div className="row2">
        <div className="fg"><label>RATE TYPE</label><select value={leg.rate_type} onChange={e=>set('rate_type',e.target.value)}><option value="FLAT">FLAT</option><option value="STEP">STEP (ROLLERCOASTER)</option></select></div>
        {leg.rate_type==='FLAT'&&<div className="fg"><label>FIXED RATE</label><input placeholder="0.0425" value={leg.fixed_rate} onChange={e=>set('fixed_rate',e.target.value)}/></div>}
      </div></>}
    {tab==='schedule'&&<SchedFields leg={leg} set={set}/>}
    {tab==='rates'&&<>{leg.rate_type==='STEP'?<RateSched leg={leg} set={set}/>:<div style={{fontSize:'0.65rem',color:'var(--text-dim)'}}>Switch to STEP rate type to enable rollercoaster rates.</div>}</>}
  </>)
}

function FloatForm({leg,set}) {
  const [tab,setTab]=useState('terms')
  return (<>
    <div className="leg-tabs">{['terms','schedule','spread'].map(t=><button key={t} className={\`leg-tab \${tab===t?'leg-tab-active':''}\`} onClick={()=>setTab(t)}>{t.toUpperCase()}</button>)}</div>
    {tab==='terms'&&<><CommonLegFields leg={leg} set={set}/>
      <div className="sec-lbl">FLOATING RATE</div>
      <div className="row2">
        <div className="fg"><label>FLOAT INDEX</label><select value={leg.index} onChange={e=>set('index',e.target.value)}>{INDICES.map(i=><option key={i}>{i}</option>)}</select></div>
        <div className="fg"><label>LEVERAGE</label><input placeholder="1.0" value={leg.leverage} onChange={e=>set('leverage',e.target.value)}/></div>
      </div>
      <div className="row2">
        <div className="fg"><label>SPREAD TYPE</label><select value={leg.spread_type} onChange={e=>set('spread_type',e.target.value)}><option>FLAT</option><option>STEP</option></select></div>
        {leg.spread_type==='FLAT'&&<div className="fg"><label>SPREAD (bps)</label><input placeholder="0" value={leg.spread} onChange={e=>set('spread',e.target.value)}/></div>}
      </div>
      <div className="row4">
        <div className="fg"><label>COMPOUNDING</label><select value={leg.compounding} onChange={e=>set('compounding',e.target.value)}>{COMPOUNDINGS.map(c=><option key={c}>{c}</option>)}</select></div>
        <div className="fg"><label>CAP</label><input placeholder="none" value={leg.cap} onChange={e=>set('cap',e.target.value)}/></div>
        <div className="fg"><label>FLOOR</label><input placeholder="none" value={leg.floor} onChange={e=>set('floor',e.target.value)}/></div>
        <div className="fg"><label>FIX LAG (d)</label><input placeholder="2" value={leg.fixing_lag} onChange={e=>set('fixing_lag',e.target.value)}/></div>
      </div></>}
    {tab==='schedule'&&<SchedFields leg={leg} set={set}/>}
    {tab==='spread'&&<>{leg.spread_type==='STEP'?<SpreadSched leg={leg} set={set}/>:<div style={{fontSize:'0.65rem',color:'var(--text-dim)'}}>Switch spread type to STEP for a spread schedule.</div>}</>}
  </>)
}

function InflationForm({leg,set}) {
  return (<><CommonLegFields leg={leg} set={set}/>
    <div className="sec-lbl">INFLATION PARAMETERS</div>
    <div className="row2">
      <div className="fg"><label>INFLATION TYPE</label><select value={leg.inflation_type} onChange={e=>set('inflation_type',e.target.value)}><option value="ZERO_COUPON">ZERO COUPON (ZC)</option><option value="YOY">YEAR-ON-YEAR (YoY)</option></select></div>
      <div className="fg"><label>INFLATION INDEX</label><select value={leg.index} onChange={e=>set('index',e.target.value)}>{INFLATION_INDICES.map(i=><option key={i}>{i}</option>)}</select></div>
    </div>
    <div className="row3">
      <div className="fg"><label>BASE INDEX FIXING</label><input placeholder="auto at effective" value={leg.base_index||''} onChange={e=>set('base_index',e.target.value)}/></div>
      <div className="fg"><label>LAG (months)</label><input placeholder="3" value={leg.lag_months} onChange={e=>set('lag_months',e.target.value)}/></div>
      <div className="fg"><label>INTERPOLATION</label><select value={leg.interpolation} onChange={e=>set('interpolation',e.target.value)}><option>LINEAR</option><option>NONE</option></select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>FLOOR</label><input placeholder="0" value={leg.floor} onChange={e=>set('floor',e.target.value)}/></div>
      <div className="fg"><label>CAP</label><input placeholder="none" value={leg.cap} onChange={e=>set('cap',e.target.value)}/></div>
    </div>
    <div style={{fontSize:'0.62rem',color:'var(--text-dim)',padding:'0.4rem 0',lineHeight:1.6}}>
      {leg.inflation_type==='ZERO_COUPON'?'● ZC: Single payment at maturity = Notional × (Index_final / Index_base − 1)':'● YoY: Annual payments = Notional × (Index_t / Index_{t-1} − 1)'}
    </div>
    <SchedFields leg={leg} set={set}/>
  </>)
}

function CmsForm({leg,set}) {
  return (<><CommonLegFields leg={leg} set={set}/>
    <div className="sec-lbl">CMS PARAMETERS</div>
    <div className="row2">
      <div className="fg"><label>CMS TENOR</label><select value={leg.cms_tenor} onChange={e=>set('cms_tenor',e.target.value)}>{CMS_TENORS.map(t=><option key={t}>{t}</option>)}</select></div>
      <div className="fg"><label>LEVERAGE</label><input placeholder="1.0" value={leg.leverage} onChange={e=>set('leverage',e.target.value)}/></div>
    </div>
    <div className="row3">
      <div className="fg"><label>SPREAD (bps)</label><input placeholder="0" value={leg.spread} onChange={e=>set('spread',e.target.value)}/></div>
      <div className="fg"><label>CAP</label><input placeholder="none" value={leg.cap} onChange={e=>set('cap',e.target.value)}/></div>
      <div className="fg"><label>FLOOR</label><input placeholder="none" value={leg.floor} onChange={e=>set('floor',e.target.value)}/></div>
    </div>
    <div className="fg"><label>FIXING LAG (days)</label><input placeholder="2" value={leg.fixing_lag} onChange={e=>set('fixing_lag',e.target.value)}/></div>
    <SchedFields leg={leg} set={set}/>
  </>)
}

function ZcForm({leg,set}) {
  return (<><CommonLegFields leg={leg} set={set}/>
    <div className="sec-lbl">ZC PARAMETERS</div>
    <div className="row2">
      <div className="fg"><label>ZC RATE</label><input placeholder="0.0425" value={leg.zc_rate} onChange={e=>set('zc_rate',e.target.value)}/></div>
      <div className="fg"><label>COMPOUNDING</label><select value={leg.zc_compounding} onChange={e=>set('zc_compounding',e.target.value)}>{FREQS.map(f=><option key={f}>{f}</option>)}</select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
  </>)
}

function CdsFeeForm({leg,set}) {
  return (<><CommonLegFields leg={leg} set={set}/>
    <div className="sec-lbl">CDS FEE</div>
    <div className="row2">
      <div className="fg"><label>SPREAD (bps)</label><input placeholder="120" value={leg.spread_bps} onChange={e=>set('spread_bps',e.target.value)}/></div>
      <div className="fg"><label>FREQUENCY</label><select value={leg.frequency} onChange={e=>set('frequency',e.target.value)}>{FREQS.map(f=><option key={f}>{f}</option>)}</select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
  </>)
}

function CdsContingentForm({leg,set}) {
  return (<>
    <div className="sec-lbl">REFERENCE ENTITY</div>
    <div className="row2">
      <div className="fg"><label>REFERENCE ENTITY</label><input placeholder="APPLE INC" value={leg.reference_entity} onChange={e=>set('reference_entity',e.target.value)}/></div>
      <div className="fg"><label>REFERENCE ISIN</label><input placeholder="US0378331005" value={leg.reference_isin} onChange={e=>set('reference_isin',e.target.value)}/></div>
    </div>
    <div className="row3">
      <div className="fg"><label>RECOVERY RATE</label><input placeholder="0.40" value={leg.recovery_rate} onChange={e=>set('recovery_rate',e.target.value)}/></div>
      <div className="fg"><label>SENIORITY</label><select value={leg.seniority} onChange={e=>set('seniority',e.target.value)}>{SENIORITY.map(s=><option key={s}>{s}</option>)}</select></div>
      <div className="fg"><label>SETTLEMENT</label><select value={leg.settlement_type} onChange={e=>set('settlement_type',e.target.value)}><option>PHYSICAL</option><option>CASH</option><option>BOTH</option></select></div>
    </div>
  </>)
}

function TotalReturnForm({leg,set}) {
  return (<><CommonLegFields leg={leg} set={set}/>
    <div className="sec-lbl">REFERENCE ASSET</div>
    <div className="row2">
      <div className="fg"><label>ASSET NAME</label><input placeholder="APPLE 2.65% 2027" value={leg.reference_asset} onChange={e=>set('reference_asset',e.target.value)}/></div>
      <div className="fg"><label>ISIN</label><input placeholder="US0378331005" value={leg.reference_isin} onChange={e=>set('reference_isin',e.target.value)}/></div>
    </div>
    <div className="row3">
      <div className="fg"><label>ASSET TYPE</label><select value={leg.reference_asset_type} onChange={e=>set('reference_asset_type',e.target.value)}>{ASSET_TYPES.map(a=><option key={a}>{a}</option>)}</select></div>
      <div className="fg"><label>RETURN TYPE</label><select value={leg.return_type} onChange={e=>set('return_type',e.target.value)}><option>TOTAL_RETURN</option><option>PRICE_RETURN</option></select></div>
      <div className="fg"><label>DIVIDENDS</label><select value={leg.dividend_treatment} onChange={e=>set('dividend_treatment',e.target.value)}><option>PASS_THROUGH</option><option>REINVESTED</option><option>EXCLUDED</option></select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
  </>)
}

function EquityReturnForm({leg,set}) {
  return (<><CommonLegFields leg={leg} set={set}/>
    <div className="sec-lbl">EQUITY REFERENCE</div>
    <div className="row2">
      <div className="fg"><label>REFERENCE</label><input placeholder="SPX / AAPL" value={leg.reference} onChange={e=>set('reference',e.target.value)}/></div>
      <div className="fg"><label>TYPE</label><select value={leg.reference_type} onChange={e=>set('reference_type',e.target.value)}><option>INDEX</option><option>SINGLE_NAME</option><option>BASKET</option></select></div>
    </div>
    <div className="row3">
      <div className="fg"><label>RETURN TYPE</label><select value={leg.return_type} onChange={e=>set('return_type',e.target.value)}><option>TOTAL_RETURN</option><option>PRICE_RETURN</option></select></div>
      <div className="fg"><label>INITIAL PRICE</label><input placeholder="5000.00" value={leg.initial_price} onChange={e=>set('initial_price',e.target.value)}/></div>
      <div className="fg"><label>DIVIDENDS</label><select value={leg.dividend_treatment} onChange={e=>set('dividend_treatment',e.target.value)}><option>PASS_THROUGH</option><option>REINVESTED</option><option>EXCLUDED</option></select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
  </>)
}

function EquityForwardForm({leg,set}) {
  return (<>
    <div className="sec-lbl">EQUITY FORWARD</div>
    <div className="row2">
      <div className="fg"><label>REFERENCE</label><input placeholder="AAPL / SPX" value={leg.reference} onChange={e=>set('reference',e.target.value)}/></div>
      <div className="fg"><label>TYPE</label><select value={leg.reference_type} onChange={e=>set('reference_type',e.target.value)}><option>SINGLE_NAME</option><option>INDEX</option><option>BASKET</option></select></div>
    </div>
    <div className="row3">
      <div className="fg"><label>QUANTITY</label><input placeholder="10,000" value={leg.quantity} onChange={e=>set('quantity',e.target.value)}/></div>
      <div className="fg"><label>INITIAL PRICE</label><input placeholder="180.00" value={leg.initial_price} onChange={e=>set('initial_price',e.target.value)}/></div>
      <div className="fg"><label>FORWARD PRICE</label><input placeholder="185.00" value={leg.forward_price} onChange={e=>set('forward_price',e.target.value)}/></div>
    </div>
    <div className="row3">
      <div className="fg"><label>PRICE FIX DATE</label><input type="date" value={leg.price_fixing_date||''} onChange={e=>set('price_fixing_date',e.target.value)}/></div>
      <div className="fg"><label>SETTLEMENT</label><select value={leg.settlement_type} onChange={e=>set('settlement_type',e.target.value)}><option>CASH</option><option>PHYSICAL</option></select></div>
      <div className="fg"><label>DIVIDENDS</label><select value={leg.dividend_treatment} onChange={e=>set('dividend_treatment',e.target.value)}><option>EXCLUDED</option><option>PASS_THROUGH</option></select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>CURRENCY</label><select value={leg.currency} onChange={e=>set('currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>DIRECTION</label><select value={leg.direction} onChange={e=>set('direction',e.target.value)}><option>PAY</option><option>RECEIVE</option></select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>DELIVERY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
  </>)
}

function VarianceForm({leg,set}) {
  return (<><CommonLegFields leg={leg} set={set}/>
    <div className="sec-lbl">VARIANCE PARAMETERS</div>
    <div className="row2">
      <div className="fg"><label>REFERENCE</label><input placeholder="SPX" value={leg.reference} onChange={e=>set('reference',e.target.value)}/></div>
      <div className="fg"><label>VARIANCE STRIKE</label><input placeholder="0.0225" value={leg.variance_strike} onChange={e=>set('variance_strike',e.target.value)}/></div>
    </div>
    <div className="row3">
      <div className="fg"><label>VEGA NOTIONAL</label><input placeholder="100,000" value={leg.vega_notional} onChange={e=>set('vega_notional',e.target.value)}/></div>
      <div className="fg"><label>OBS FREQUENCY</label><select value={leg.observation_frequency} onChange={e=>set('observation_frequency',e.target.value)}><option>DAILY</option><option>WEEKLY</option></select></div>
      <div className="fg"><label>ANNLZ FACTOR</label><input placeholder="252" value={leg.annualization_factor} onChange={e=>set('annualization_factor',e.target.value)}/></div>
    </div>
    <div className="row2">
      <div className="fg"><label>VARIANCE CAP</label><input placeholder="4× strike" value={leg.cap_variance} onChange={e=>set('cap_variance',e.target.value)}/></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
  </>)
}

function DividendForm({leg,set}) {
  return (<><CommonLegFields leg={leg} set={set}/>
    <div className="sec-lbl">DIVIDEND PARAMETERS</div>
    <div className="row3">
      <div className="fg"><label>REFERENCE</label><input placeholder="SPX" value={leg.reference} onChange={e=>set('reference',e.target.value)}/></div>
      <div className="fg"><label>MULTIPLIER</label><input placeholder="1.0" value={leg.dividend_multiplier} onChange={e=>set('dividend_multiplier',e.target.value)}/></div>
      <div className="fg"><label>INCLUDE SPECIALS</label><select value={leg.include_specials} onChange={e=>set('include_specials',e.target.value)}><option value="true">YES</option><option value="false">NO</option></select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
  </>)
}

function CommodityFloatForm({leg,set}) {
  return (<><CommonLegFields leg={leg} set={set}/>
    <div className="sec-lbl">COMMODITY PARAMETERS</div>
    <div className="row2">
      <div className="fg"><label>COMMODITY INDEX</label><select value={leg.commodity_index} onChange={e=>set('commodity_index',e.target.value)}>{COMMODITY_INDICES.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>UNIT</label><select value={leg.unit} onChange={e=>set('unit',e.target.value)}>{['BBL','MMBTU','MT','OZ','BU','LB'].map(u=><option key={u}>{u}</option>)}</select></div>
    </div>
    <div className="row3">
      <div className="fg"><label>FIXING TYPE</label><select value={leg.fixing_type} onChange={e=>set('fixing_type',e.target.value)}><option>SPOT</option><option>AVERAGE_DAILY</option><option>AVERAGE_MONTHLY</option></select></div>
      <div className="fg"><label>FIXING SOURCE</label><select value={leg.fixing_source} onChange={e=>set('fixing_source',e.target.value)}><option>PLATTS</option><option>ARGUS</option><option>ICE</option><option>CME</option></select></div>
      <div className="fg"><label>AVERAGING</label><select value={leg.averaging_type} onChange={e=>set('averaging_type',e.target.value)}><option>ARITHMETIC</option><option>GEOMETRIC</option></select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>QUANTITY</label><input placeholder="10,000" value={leg.quantity} onChange={e=>set('quantity',e.target.value)}/></div>
      <div className="fg"><label>FREQUENCY</label><select value={leg.frequency||'MONTHLY'} onChange={e=>set('frequency',e.target.value)}>{FREQS.map(f=><option key={f}>{f}</option>)}</select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
  </>)
}

function EmissionsForm({leg,set}) {
  return (<><CommonLegFields leg={leg} set={set}/>
    <div className="sec-lbl">EMISSIONS PARAMETERS</div>
    <div className="row2">
      <div className="fg"><label>EMISSIONS INDEX</label><select value={leg.emissions_index} onChange={e=>set('emissions_index',e.target.value)}>{EMISSIONS_INDICES.map(i=><option key={i}>{i}</option>)}</select></div>
      <div className="fg"><label>VINTAGE YEAR</label><input placeholder="2024" value={leg.vintage_year} onChange={e=>set('vintage_year',e.target.value)}/></div>
    </div>
    <div className="row3">
      <div className="fg"><label>QUANTITY (allowances)</label><input placeholder="100,000" value={leg.quantity} onChange={e=>set('quantity',e.target.value)}/></div>
      <div className="fg"><label>FIXING TYPE</label><select value={leg.fixing_type} onChange={e=>set('fixing_type',e.target.value)}><option>SPOT</option><option>AVERAGE_DAILY</option><option>AVERAGE_MONTHLY</option></select></div>
      <div className="fg"><label>FIXING SOURCE</label><select value={leg.fixing_source} onChange={e=>set('fixing_source',e.target.value)}><option>ICE</option><option>EEX</option><option>CME</option><option>ARGUS</option></select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
  </>)
}

function RpaFeeForm({leg,set}) {
  return (<><CommonLegFields leg={leg} set={set}/>
    <div className="sec-lbl">PARTICIPATION TERMS</div>
    <div className="row3">
      <div className="fg"><label>PARTICIPATION %</label><input placeholder="100" value={leg.participation_pct} onChange={e=>set('participation_pct',e.target.value)}/></div>
      <div className="fg"><label>FEE (bps)</label><input placeholder="85" value={leg.fee_bps} onChange={e=>set('fee_bps',e.target.value)}/></div>
      <div className="fg"><label>FREQUENCY</label><select value={leg.frequency} onChange={e=>set('frequency',e.target.value)}>{FREQS.map(f=><option key={f}>{f}</option>)}</select></div>
    </div>
    <div className="row3">
      <div className="fg"><label>DAY COUNT</label><select value={leg.day_count} onChange={e=>set('day_count',e.target.value)}>{DAY_COUNTS.map(d=><option key={d}>{d}</option>)}</select></div>
      <div className="fg"><label>DOCUMENTATION</label><select value={leg.documentation} onChange={e=>set('documentation',e.target.value)}><option>LMA</option><option>BAFT</option><option>APLMA</option><option>BESPOKE</option></select></div>
      <div className="fg"><label>BDC</label><select value={leg.bdc} onChange={e=>set('bdc',e.target.value)}>{BDCS.map(b=><option key={b}>{b}</option>)}</select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
  </>)
}

function RpaContingentForm({leg,set}) {
  return (<>
    <div className="sec-lbl">UNDERLYING FACILITY</div>
    <div className="row2">
      <div className="fg"><label>OBLIGOR / BORROWER</label><input placeholder="ACME CORP" value={leg.underlying_obligor} onChange={e=>set('underlying_obligor',e.target.value)}/></div>
      <div className="fg"><label>FACILITY NAME / REF</label><input placeholder="TERM LOAN B 2028" value={leg.underlying_facility} onChange={e=>set('underlying_facility',e.target.value)}/></div>
    </div>
    <div className="row3">
      <div className="fg"><label>FACILITY TYPE</label>
        <select value={leg.underlying_facility_type} onChange={e=>set('underlying_facility_type',e.target.value)}>
          {['LOAN','REVOLVING_CREDIT','TRADE_FINANCE','LETTER_OF_CREDIT','DERIVATIVE_EXPOSURE','BOND','PROJECT_FINANCE','STRUCTURED_FINANCE','SUKUK','GUARANTEE','STANDBY_LC','RECEIVABLES','MORTGAGE_PORTFOLIO'].map(t=><option key={t}>{t}</option>)}
        </select>
      </div>
      <div className="fg"><label>FUNDED / UNFUNDED</label><select value={leg.funded} onChange={e=>set('funded',e.target.value)}><option>UNFUNDED</option><option>FUNDED</option></select></div>
      <div className="fg"><label>PARTICIPATION %</label><input placeholder="100" value={leg.participation_pct} onChange={e=>set('participation_pct',e.target.value)}/></div>
    </div>
    <div className="row2">
      <div className="fg"><label>RECOVERY RATE</label><input placeholder="0.40" value={leg.recovery_rate} onChange={e=>set('recovery_rate',e.target.value)}/></div>
      <div className="fg"><label>DOCUMENTATION</label><select value={leg.documentation} onChange={e=>set('documentation',e.target.value)}><option>LMA</option><option>BAFT</option><option>APLMA</option><option>BESPOKE</option></select></div>
    </div>
    {leg.underlying_facility_type==='DERIVATIVE_EXPOSURE'&&(
      <div className="fg"><label>UNDERLYING TRADE REF (from Blotter)</label>
        <input placeholder="TRD-12345678" value={leg.underlying_trade_id||''} onChange={e=>set('underlying_trade_id',e.target.value)}/>
      </div>
    )}
    <div style={{fontSize:'0.62rem',color:'var(--text-dim)',padding:'0.5rem 0',lineHeight:1.6}}>
      {leg.funded==='FUNDED'?'● FUNDED: Participant pays participated amount upfront.':'● UNFUNDED: No upfront payment. Participant pays loss share only on default event.'}
    </div>
  </>)
}

function LegForm({leg,set}) {
  switch(leg.leg_type) {
    case 'FIXED':          return <FixedForm leg={leg} set={set}/>
    case 'FLOAT':          return <FloatForm leg={leg} set={set}/>
    case 'ZERO_COUPON':    return <ZcForm leg={leg} set={set}/>
    case 'INFLATION':      return <InflationForm leg={leg} set={set}/>
    case 'CMS':            return <CmsForm leg={leg} set={set}/>
    case 'CDS_FEE':        return <CdsFeeForm leg={leg} set={set}/>
    case 'CDS_CONTINGENT': return <CdsContingentForm leg={leg} set={set}/>
    case 'TOTAL_RETURN':   return <TotalReturnForm leg={leg} set={set}/>
    case 'EQUITY_RETURN':  return <EquityReturnForm leg={leg} set={set}/>
    case 'EQUITY_FWD':     return <EquityForwardForm leg={leg} set={set}/>
    case 'VARIANCE':       return <VarianceForm leg={leg} set={set}/>
    case 'DIVIDEND':       return <DividendForm leg={leg} set={set}/>
    case 'COMMODITY_FLOAT':return <CommodityFloatForm leg={leg} set={set}/>
    case 'EMISSIONS_FLOAT':return <EmissionsForm leg={leg} set={set}/>
    case 'RPA_FEE':        return <RpaFeeForm leg={leg} set={set}/>
    case 'RPA_CONTINGENT': return <RpaContingentForm leg={leg} set={set}/>
    default:               return <FloatForm leg={leg} set={set}/>
  }
}

function LegCard({leg,legIdx,legs,setLegs}) {
  const [open,setOpen]=useState(true)
  const set=(k,v)=>setLegs(legs.map((l,i)=>i===legIdx?{...l,[k]:v}:l))
  const dc=leg.direction==='PAY'?'var(--red)':'var(--accent)'
  return (
    <div className="leg-card">
      <div className="leg-card-hdr" onClick={()=>setOpen(!open)}>
        <span className="leg-dir-badge" style={{color:dc,borderColor:dc+'60'}}>{leg.direction}</span>
        <span className="leg-type-label">{leg.label}</span>
        <span className="leg-ccy">{leg.currency}</span>
        <span className="leg-notional">{leg.notional?Number(String(leg.notional).replace(/,/g,'')).toLocaleString():'—'}</span>
        <span className={\`leg-chevron \${open?'leg-chevron-open':''}\`}>▾</span>
      </div>
      {open&&<div className="leg-body"><LegForm leg={leg} set={set}/></div>}
    </div>
  )
}

export default function NewTradeWorkspace({tab}) {
  const today=new Date().toISOString().substring(0,10)
  const {addTrade}=useTradesStore()
  const {closeTab,promoteTrade,setDirty}=useTabStore()
  const [ac,setAc]=useState('RATES')
  const [instrument,setInstrument]=useState('IR_SWAP')
  const [legs,setLegs]=useState(TEMPLATES.IR_SWAP())
  const [tradeRef,setTradeRef]=useState(\`TRD-\${Date.now().toString().slice(-8)}\`)
  const [store,setStore]=useState('WORKING')
  const [notionalCcy,setNotionalCcy]=useState('USD')
  const [tradeDate,setTradeDate]=useState(today)
  const [effectiveDate,setEffDate]=useState(today)
  const [maturityDate,setMatDate]=useState('')
  const [counterpartyId,setCpId]=useState('')
  const [ownEntityId,setOeId]=useState('')
  const [desk,setDesk]=useState('')
  const [book,setBook]=useState('')
  const [notionalExchange,setNotionalExchange]=useState(false)
  const [cps,setCps]=useState([])
  const [les,setLes]=useState([])
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')

  useEffect(()=>{
    supabase.from('counterparties').select('*').then(({data})=>setCps(data||[]))
    supabase.from('legal_entities').select('*').then(({data})=>setLes(data||[]))
  },[])

  const changeAc=(a)=>{setAc(a);const it=INSTRUMENTS[a][0];setInstrument(it);setLegs((TEMPLATES[it]||TEMPLATES.IR_SWAP)())}
  const changeIT=(it)=>{setInstrument(it);setLegs((TEMPLATES[it]||TEMPLATES.IR_SWAP)());setDirty(tab.id,true)}
  const cfs=genCFs(legs,effectiveDate,maturityDate)

  const submit=async()=>{
    if(!tradeRef) return setErr('Trade ref required')
    if(!maturityDate) return setErr('Maturity date required')
    setErr('');setBusy(true)
    const firstLeg=legs[0]
    const notional=firstLeg?parseFloat(String(firstLeg.notional||'').replace(/,/g,''))||null:null
    const terms={structure:instrument,legs:legs.map((l,i)=>({...l,leg_id:\`leg_\${i}\`})),cashflow_overrides:{},instrument_modifier:null,notional_exchange:notionalExchange}
    const payload={trade_ref:tradeRef,status:'PENDING',store,asset_class:ac,instrument_type:instrument,notional,notional_ccy:notionalCcy,trade_date:tradeDate,effective_date:effectiveDate,maturity_date:maturityDate,terms}
    if(desk) payload.desk=desk
    if(book) payload.book=book
    if(counterpartyId) payload.counterparty_id=counterpartyId
    if(ownEntityId) payload.own_legal_entity_id=ownEntityId
    const res=await addTrade(payload)
    setBusy(false)
    if(res?.error) return setErr(res.error.message)
    promoteTrade(tab.id,res.data)
  }

  const ownLEs=les.filter(e=>e.is_own_entity&&e.is_active)

  return (
    <div className="ntw">
      <div className="ntw-header">
        <span className="ntw-title">NEW TRADE</span>
        <div className="ntw-instrument-row">
          <div style={{display:'flex',gap:'0.3rem'}}>
            {ASSET_CLASSES.map(a=>(
              <button key={a} className={\`chip-s \${ac===a?'chip-s-on':''}\`}
                style={ac===a?{borderColor:AC_COLOR[a],color:AC_COLOR[a]}:{}}
                onClick={()=>changeAc(a)}>{a}</button>
            ))}
          </div>
          <div className="fg" style={{margin:0,minWidth:220}}>
            <select style={{margin:0}} value={instrument} onChange={e=>changeIT(e.target.value)}>
              {(INSTRUMENTS[ac]||[]).map(it=><option key={it}>{it}</option>)}
            </select>
          </div>
          {instrument==='XCCY_SWAP'&&(
            <label style={{fontSize:'0.62rem',color:'var(--text-dim)',display:'flex',gap:'0.3rem',alignItems:'center'}}>
              <input type="checkbox" checked={notionalExchange} onChange={e=>setNotionalExchange(e.target.checked)}/>
              NOTIONAL EXCHANGE
            </label>
          )}
        </div>
      </div>

      <div className="ntw-body">
        <div className="ntw-left">
          <div className="ntw-section-hdr">TRADE HEADER</div>
          <div style={{padding:'0.75rem 1.25rem',borderBottom:'1px solid var(--border)',background:'var(--panel)',flexShrink:0}}>
            <div className="row3">
              <div className="fg"><label>TRADE REF *</label><input value={tradeRef} onChange={e=>setTradeRef(e.target.value)}/></div>
              <div className="fg"><label>STORE</label><select value={store} onChange={e=>setStore(e.target.value)}><option>WORKING</option><option>PRODUCTION</option></select></div>
              <div className="fg"><label>NOTIONAL CCY</label><select value={notionalCcy} onChange={e=>setNotionalCcy(e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
            </div>
            <div className="row3" style={{marginTop:'0.5rem'}}>
              <div className="fg"><label>TRADE DATE</label><input type="date" value={tradeDate} onChange={e=>setTradeDate(e.target.value)}/></div>
              <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={effectiveDate} onChange={e=>setEffDate(e.target.value)}/></div>
              <div className="fg"><label>MATURITY DATE *</label><input type="date" value={maturityDate} onChange={e=>setMatDate(e.target.value)}/></div>
            </div>
            <div className="row2" style={{marginTop:'0.5rem'}}>
              <div className="fg"><label>OWN ENTITY</label>
                <select value={ownEntityId} onChange={e=>setOeId(e.target.value)}>
                  <option value="">— select —</option>
                  {ownLEs.map(e=><option key={e.id} value={e.id}>{e.short_name||e.name}</option>)}
                </select>
              </div>
              <div className="fg"><label>COUNTERPARTY</label>
                <select value={counterpartyId} onChange={e=>setCpId(e.target.value)}>
                  <option value="">— select —</option>
                  {cps.filter(c=>c.is_active).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="row2" style={{marginTop:'0.5rem'}}>
              <div className="fg"><label>DESK</label><input placeholder="RATES TRADING" value={desk} onChange={e=>setDesk(e.target.value)}/></div>
              <div className="fg"><label>BOOK</label><input placeholder="G10 RATES" value={book} onChange={e=>setBook(e.target.value)}/></div>
            </div>
          </div>
          <div className="ntw-section-hdr">LEGS — {legs.length} LEG{legs.length!==1?'S':''}</div>
          <div className="ntw-scroll">
            {legs.map((leg,i)=><LegCard key={i} leg={leg} legIdx={i} legs={legs} setLegs={setLegs}/>)}
            <button className="btn-add-leg" onClick={()=>setLegs([...legs,{...LD.FLOAT('PAY'),label:'NEW LEG'}])}>+ ADD LEG</button>
            {err&&<div className="form-err">{err}</div>}
          </div>
          <div className="ntw-footer">
            <button className="btn-cancel" onClick={()=>closeTab(tab.id)}>CANCEL</button>
            <button className="btn-book-trade" onClick={submit} disabled={busy}>{busy?'BOOKING...':'BOOK TRADE'}</button>
          </div>
        </div>

        <div className="ntw-right">
          <div className="ntw-section-hdr">CASHFLOW PREVIEW — {cfs.length} flows{cfs.length>0?' (amounts: Sprint 3 pricing engine)':''}</div>
          <div className="cf-preview">
            {cfs.length===0
              ? <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.68rem',letterSpacing:'0.1em'}}>SET EFFECTIVE AND MATURITY DATES TO PREVIEW CASHFLOWS</div>
              : <table className="cf-table">
                  <thead><tr><th>DATE</th><th>LEG</th><th>DIR</th><th>TYPE</th><th>CCY</th><th>AMOUNT</th></tr></thead>
                  <tbody>
                    {cfs.map((cf,i)=>(
                      <tr key={i}>
                        <td>{cf.date}</td>
                        <td style={{color:'var(--text-dim)',fontSize:'0.62rem'}}>{cf.label}</td>
                        <td><span style={{color:cf.dir==='PAY'?'var(--red)':'var(--accent)',fontWeight:700,fontSize:'0.62rem'}}>{cf.dir}</span></td>
                        <td style={{color:'var(--text-dim)',fontSize:'0.62rem'}}>{cf.type}</td>
                        <td style={{color:'var(--text-dim)'}}>{cf.ccy}</td>
                        <td className="cf-stub">SPRINT 3</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </div>
        </div>
      </div>
    </div>
  )
}
`);

// ── TradeWorkspace.css ────────────────────────────────────────────────────────
write('components/blotter/TradeWorkspace.css', `.tw { display:flex; flex-direction:column; height:100%; overflow:hidden; }
.tw-strip { display:flex; align-items:center; gap:1rem; padding:0.65rem 1.5rem; background:var(--panel); border-bottom:1px solid var(--border); flex-shrink:0; }
.tw-ref { font-size:0.9rem; font-weight:700; letter-spacing:0.08em; color:var(--text); }
.tw-badge { font-size:0.6rem; font-weight:700; letter-spacing:0.1em; padding:0.15rem 0.45rem; border-radius:2px; border:1px solid; }
.tw-strip-actions { margin-left:auto; display:flex; gap:0.5rem; }
.tw-act { border:1px solid; background:transparent; font-family:var(--mono); font-size:0.62rem; font-weight:700; letter-spacing:0.1em; padding:0.3rem 0.65rem; border-radius:2px; cursor:pointer; transition:all 0.15s; }
.tw-act:disabled { opacity:0.4; cursor:not-allowed; }
.tw-act-live { border-color:var(--accent); color:var(--accent); }
.tw-act-live:hover:not(:disabled) { background:color-mix(in srgb,var(--accent) 12%,transparent); }
.tw-act-cancel { border-color:var(--red); color:var(--red); }
.tw-act-cancel:hover:not(:disabled) { background:color-mix(in srgb,var(--red) 12%,transparent); }
.tw-act-mature { border-color:var(--text-dim); color:var(--text-dim); }
.tw-act-mature:hover:not(:disabled) { border-color:var(--text); color:var(--text); }
.tw-tabs { display:flex; background:var(--bg-deep); border-bottom:1px solid var(--border); flex-shrink:0; }
.tw-tab { padding:0.5rem 1.25rem; font-family:var(--mono); font-size:0.65rem; font-weight:600; letter-spacing:0.1em; color:var(--text-dim); cursor:pointer; border-bottom:2px solid transparent; transition:all 0.12s; background:none; border-top:none; border-left:none; border-right:none; }
.tw-tab:hover { color:var(--text); }
.tw-tab-active { color:var(--accent); border-bottom-color:var(--accent); }
.tw-content { flex:1; overflow:auto; }
.ov-grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0; border-bottom:1px solid var(--border); }
.ov-block { padding:1rem 1.25rem; border-right:1px solid var(--border); border-bottom:1px solid var(--border); }
.ov-block:nth-child(3n) { border-right:none; }
.ov-label { font-size:0.58rem; font-weight:600; letter-spacing:0.1em; color:var(--text-dim); margin-bottom:0.2rem; }
.ov-val-sm { font-size:0.7rem; font-weight:600; color:var(--text); }
.legs-view { padding:1.25rem; display:flex; flex-direction:column; gap:0.75rem; }
.leg-summary-card { border:1px solid var(--border); border-radius:3px; overflow:hidden; background:var(--panel); }
.leg-summary-hdr { display:flex; align-items:center; gap:0.75rem; padding:0.6rem 1rem; background:var(--panel-2); border-bottom:1px solid var(--border); }
.leg-summary-body { padding:0.75rem 1rem; }
.leg-fields-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:0.5rem 1rem; }
.lf { display:flex; flex-direction:column; gap:0.1rem; }
.ll { font-size:0.58rem; color:var(--text-dim); letter-spacing:0.08em; }
.lv { font-size:0.7rem; font-weight:600; color:var(--text); word-break:break-all; }
.cf-tab-bar { display:flex; gap:0.35rem; padding:0.6rem 1.25rem; border-bottom:1px solid var(--border); background:var(--panel); }
.cf-legend { display:flex; gap:1rem; padding:0.5rem 1.25rem; border-bottom:1px solid var(--border); font-size:0.62rem; align-items:center; }
.cf-tbl { width:100%; border-collapse:collapse; font-size:0.7rem; font-family:var(--mono); }
.cf-tbl th { padding:0.4rem 1rem; text-align:left; font-size:0.6rem; font-weight:700; letter-spacing:0.1em; color:var(--text-dim); border-bottom:1px solid var(--border); position:sticky; top:0; background:var(--panel-2); z-index:1; }
.cf-tbl td { padding:0.4rem 1rem; border-bottom:1px solid color-mix(in srgb,var(--border) 40%,transparent); }
.cf-row-overridden { background:color-mix(in srgb,var(--amber) 4%,transparent); }
.cf-override-badge { font-size:0.55rem; font-weight:700; letter-spacing:0.08em; color:var(--amber); margin-left:0.35rem; }
.cf-edit-btn { background:none; border:none; color:var(--text-dim); cursor:pointer; font-size:0.65rem; padding:0 0.25rem; opacity:0; transition:opacity 0.1s; }
.cf-tbl tr:hover .cf-edit-btn { opacity:1; }
.cf-edit-btn:hover { color:var(--accent); }
.stub-panel { padding:2.5rem; text-align:center; }
.stub-title { font-size:0.75rem; font-weight:700; letter-spacing:0.15em; color:var(--text-dim); margin-bottom:0.5rem; }
.stub-badge { display:inline-block; padding:0.25rem 0.75rem; border:1px solid var(--text-dim); color:var(--text-dim); font-size:0.62rem; font-weight:700; letter-spacing:0.12em; border-radius:2px; margin-bottom:1.5rem; }
.stub-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:1rem; max-width:600px; margin:0 auto; text-align:left; }
.stub-block { border:1px dashed var(--border); border-radius:3px; padding:0.85rem 1rem; }
.stub-block-label { font-size:0.6rem; font-weight:700; letter-spacing:0.12em; color:var(--text-dim); margin-bottom:0.4rem; }
.stub-block-val { font-size:1.1rem; font-weight:700; color:var(--text-dim); font-family:var(--mono); }
.stub-block-sub { font-size:0.58rem; color:var(--text-dim); opacity:0.6; margin-top:0.15rem; }
`);

// ── TradeWorkspace.jsx ────────────────────────────────────────────────────────
write('components/blotter/TradeWorkspace.jsx', `import { useState } from 'react'
import { useTradesStore } from '../../store/useTradesStore'
import { useTabStore } from '../../store/useTabStore'
import './TradeWorkspace.css'

const AC_COLOR = { RATES:'var(--accent)', FX:'var(--blue)', CREDIT:'var(--amber)', EQUITY:'var(--purple)', COMMODITY:'var(--red)' }
const ST_COLOR = { PENDING:'var(--amber)', LIVE:'var(--accent)', MATURED:'#4a5568', CANCELLED:'var(--red)', TERMINATED:'var(--red)' }
const SR_COLOR = { WORKING:'var(--accent)', PRODUCTION:'var(--blue)', HISTORY:'#4a5568' }

function fmtN(n) {
  if (!n) return '—'
  if (n>=1e9) return \`\${(n/1e9).toFixed(2)}B\`
  if (n>=1e6) return \`\${(n/1e6).toFixed(2)}M\`
  if (n>=1e3) return \`\${(n/1e3).toFixed(2)}K\`
  return n.toLocaleString()
}
function fmtD(d) { return d?d.substring(0,10):'—' }
function tenor(t) {
  if (!t.effective_date||!t.maturity_date) return '—'
  const y=(new Date(t.maturity_date)-new Date(t.effective_date))/(365.25*864e5)
  return y>=1?\`\${y.toFixed(1)}Y\`:\`\${Math.round(y*12)}M\`
}

function genCFs(legs,eff,mat,overrides={}) {
  if (!eff||!mat) return []
  const FM={MONTHLY:1,QUARTERLY:3,'SEMI-ANNUAL':6,ANNUAL:12,SINGLE:null}
  const all=[]
  legs.forEach((leg,li)=>{
    const legEff=leg.effective_date||eff, legMat=leg.maturity_date||mat
    const m=FM[leg.frequency]
    if (!m) { all.push({id:\`\${li}-0\`,leg:li,label:leg.label,dir:leg.direction,date:legMat,type:'SINGLE',ccy:leg.currency,overridden:false}); return }
    let d=new Date(legEff); d.setMonth(d.getMonth()+m)
    const matD=new Date(legMat); let idx=0
    while(d<=matD) {
      const key=\`\${li}-\${idx}\`, ov=overrides[key]
      all.push({id:key,leg:li,label:leg.label,dir:leg.direction,date:d.toISOString().substring(0,10),type:leg.leg_type,amount:ov?.amount??null,ccy:ov?.currency||leg.currency,overridden:!!ov,idx})
      d=new Date(d); d.setMonth(d.getMonth()+m); idx++
    }
  })
  return all.sort((a,b)=>a.date<b.date?-1:1)
}

function OverviewPanel({trade:t}) {
  const ac=t.asset_class, acColor=AC_COLOR[ac]||'var(--text)'
  const terms=t.terms||{}, legs=terms.legs||[]
  const fields=[
    ['TRADE REF',t.trade_ref],['ASSET CLASS',t.asset_class],['INSTRUMENT',t.instrument_type],
    ['STATUS',t.status],['STORE',t.store],['COUNTERPARTY',t.counterparty?.name||'—'],
    ['OWN ENTITY',t.own_entity?.short_name||'—'],['NOTIONAL',fmtN(t.notional)],
    ['CURRENCY',t.notional_ccy],['TENOR',tenor(t)],
    ['TRADE DATE',fmtD(t.trade_date)],['EFFECTIVE DATE',fmtD(t.effective_date)],
    ['MATURITY DATE',fmtD(t.maturity_date)],['DESK',t.desk||'—'],['BOOK',t.book||'—'],['LEGS',legs.length||'—'],
  ]
  return (
    <div>
      <div className="ov-grid">
        {fields.map(([l,v])=>(
          <div className="ov-block" key={l}>
            <div className="ov-label">{l}</div>
            <div className="ov-val-sm" style={l==='ASSET CLASS'?{color:acColor}:l==='STATUS'?{color:ST_COLOR[v]||'var(--text)'}:{}}>{v}</div>
          </div>
        ))}
      </div>
      {terms.structure&&(
        <div style={{padding:'1rem 1.25rem',borderBottom:'1px solid var(--border)'}}>
          <div style={{fontSize:'0.6rem',fontWeight:700,letterSpacing:'0.14em',color:'var(--text-dim)',marginBottom:'0.5rem'}}>STRUCTURE</div>
          <div style={{display:'flex',gap:'0.5rem',flexWrap:'wrap'}}>
            <span style={{fontSize:'0.65rem',color:'var(--text)',fontWeight:600}}>{terms.structure}</span>
            {terms.notional_exchange&&<span style={{fontSize:'0.6rem',color:'var(--blue)',border:'1px solid var(--blue)',padding:'0.1rem 0.4rem',borderRadius:2}}>NOTIONAL EXCHANGE</span>}
            {terms.instrument_modifier&&<span style={{fontSize:'0.6rem',color:'var(--amber)',border:'1px solid var(--amber)',padding:'0.1rem 0.4rem',borderRadius:2}}>{terms.instrument_modifier}</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function LegsPanel({trade:t}) {
  const legs=t.terms?.legs||[]
  if (!legs.length) return <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.7rem',letterSpacing:'0.1em'}}>NO LEG DATA</div>
  const SKIP=['leg_id','label','leg_type','direction','currency','notional_type','notional_schedule','rate_schedule','spread_schedule']
  const fmtKey=k=>k.replace(/_/g,' ').toUpperCase()
  const fmtVal=v=>{ if(v===null||v===undefined||v==='') return '—'; if(typeof v==='boolean') return v?'YES':'NO'; if(Array.isArray(v)) return v.length?\`\${v.length} entries\`:'—'; return String(v) }
  return (
    <div className="legs-view">
      {legs.map((leg,i)=>{
        const dc=leg.direction==='PAY'?'var(--red)':'var(--accent)'
        const fields=Object.entries(leg).filter(([k])=>!SKIP.includes(k))
        return (
          <div className="leg-summary-card" key={i}>
            <div className="leg-summary-hdr">
              <span style={{fontSize:'0.6rem',fontWeight:700,letterSpacing:'0.1em',padding:'0.12rem 0.4rem',border:\`1px solid \${dc}60\`,borderRadius:2,color:dc}}>{leg.direction}</span>
              <span style={{fontSize:'0.72rem',fontWeight:700,letterSpacing:'0.06em',color:'var(--text)'}}>{leg.label}</span>
              <span style={{fontSize:'0.65rem',color:'var(--text-dim)',marginLeft:'auto'}}>{leg.leg_type}</span>
              <span style={{fontSize:'0.65rem',color:'var(--text-dim)'}}>{leg.currency}</span>
            </div>
            <div className="leg-summary-body">
              <div className="leg-fields-grid">
                {fields.map(([k,v])=>(
                  <div className="lf" key={k}><span className="ll">{fmtKey(k)}</span><span className="lv">{fmtVal(v)}</span></div>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CashflowsPanel({trade:t,onOverride}) {
  const legs=t.terms?.legs||[], overrides=t.terms?.cashflow_overrides||{}
  const [filterLeg,setFilterLeg]=useState('ALL')
  const [editId,setEditId]=useState(null)
  const [editVal,setEditVal]=useState('')
  const cfs=genCFs(legs,t.effective_date,t.maturity_date,overrides)
  const displayed=filterLeg==='ALL'?cfs:cfs.filter(c=>String(c.leg)===String(filterLeg))
  const overrideCount=Object.keys(overrides).length

  const saveEdit=(cf)=>{
    const newOv={...overrides}
    if(editVal==='') { delete newOv[cf.id] } else { newOv[cf.id]={amount:parseFloat(editVal),currency:cf.ccy,modified_by:'user',modified_at:new Date().toISOString()} }
    const newMod=Object.keys(newOv).length>0?(t.terms?.structure?t.terms.structure+' [MODIFIED]':'CUSTOM'):null
    onOverride(newOv,newMod); setEditId(null)
  }

  return (
    <div style={{height:'100%',display:'flex',flexDirection:'column'}}>
      <div className="cf-tab-bar">
        {['ALL',...legs.map((_,i)=>String(i))].map(f=>(
          <button key={f} className={\`chip-s \${filterLeg===f?'chip-s-on':''}\`} onClick={()=>setFilterLeg(f)}>
            {f==='ALL'?'ALL LEGS':\`LEG \${parseInt(f)+1}: \${legs[parseInt(f)]?.label||f}\`}
          </button>
        ))}
        {overrideCount>0&&<span style={{marginLeft:'auto',fontSize:'0.62rem',color:'var(--amber)',fontWeight:700}}>{overrideCount} OVERRIDE{overrideCount!==1?'S':''}</span>}
      </div>
      <div className="cf-legend">
        <span style={{color:'var(--red)',fontWeight:700,fontSize:'0.65rem'}}>PAY</span>
        <span style={{color:'var(--accent)',fontWeight:700,fontSize:'0.65rem'}}>RECEIVE</span>
        <span style={{fontSize:'0.62rem',color:'var(--text-dim)'}}>● OVERRIDDEN — click amount to edit</span>
        <span style={{fontSize:'0.62rem',color:'var(--text-dim)',marginLeft:'auto'}}>{displayed.length} cashflows</span>
      </div>
      <div style={{flex:1,overflow:'auto'}}>
        {cfs.length===0
          ? <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.68rem',letterSpacing:'0.1em'}}>NO CASHFLOWS — ADD LEGS WITH DATES</div>
          : <table className="cf-tbl">
              <thead><tr><th>DATE</th><th>LEG</th><th>DIR</th><th>TYPE</th><th>CCY</th><th>AMOUNT</th><th/></tr></thead>
              <tbody>
                {displayed.map(cf=>(
                  <tr key={cf.id} className={cf.overridden?'cf-row-overridden':''}>
                    <td>{cf.date}</td>
                    <td style={{color:'var(--text-dim)',fontSize:'0.62rem'}}>{cf.label}</td>
                    <td><span style={{color:cf.dir==='PAY'?'var(--red)':'var(--accent)',fontWeight:700,fontSize:'0.62rem'}}>{cf.dir}</span></td>
                    <td style={{color:'var(--text-dim)',fontSize:'0.62rem'}}>{cf.type}</td>
                    <td style={{color:'var(--text-dim)'}}>{cf.ccy}</td>
                    <td style={{textAlign:'right',cursor:'pointer'}} onClick={()=>{setEditId(cf.id);setEditVal(cf.amount??'')}}>
                      {editId===cf.id
                        ? <input autoFocus style={{background:'var(--bg)',border:'1px solid var(--accent)',color:'var(--text)',fontFamily:'var(--mono)',fontSize:'0.7rem',padding:'0.15rem 0.3rem',width:120,borderRadius:2,textAlign:'right'}}
                            value={editVal} onChange={e=>setEditVal(e.target.value)}
                            onBlur={()=>saveEdit(cf)} onKeyDown={e=>{if(e.key==='Enter')saveEdit(cf);if(e.key==='Escape')setEditId(null)}}/>
                        : <span style={{color:cf.overridden?'var(--amber)':'var(--text-dim)',fontSize:'0.68rem',fontWeight:cf.overridden?700:400}}>
                            {cf.amount!==null?cf.amount.toLocaleString():'SPRINT 3'}
                            {cf.overridden&&<span className="cf-override-badge">OVERRIDE</span>}
                          </span>
                      }
                    </td>
                    <td><button className="cf-edit-btn" onClick={()=>{setEditId(cf.id);setEditVal(cf.amount??'')}}>✎</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
        }
      </div>
    </div>
  )
}

function StubPanel({title,sprint,desc,blocks}) {
  return (
    <div className="stub-panel">
      <div className="stub-title">{title}</div>
      <div className="stub-badge">{sprint}</div>
      <p style={{fontSize:'0.65rem',color:'var(--text-dim)',letterSpacing:'0.04em',marginBottom:'1.5rem'}}>{desc}</p>
      <div className="stub-grid">
        {blocks.map(b=>(
          <div className="stub-block" key={b.label}>
            <div className="stub-block-label">{b.label}</div>
            <div className="stub-block-val">—</div>
            <div className="stub-block-sub">{b.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function TradeWorkspace({tab}) {
  const {updateTradeStatus,trades}=useTradesStore()
  const {setPanel,refreshTrade}=useTabStore()
  const [busy,setBusy]=useState(false)
  const trade=trades.find(t=>t.id===tab.tradeId)||tab.trade
  const panel=tab.panel||'overview'
  const acColor=AC_COLOR[trade?.asset_class]||'var(--text)'
  const stColor=ST_COLOR[trade?.status]||'var(--text)'
  const srColor=SR_COLOR[trade?.store]||'var(--text)'

  const act=async(status)=>{ setBusy(true); await updateTradeStatus(trade.id,status); setBusy(false) }

  const handleOverride=async(newOv,newMod)=>{
    const newTerms={...trade.terms,cashflow_overrides:newOv,instrument_modifier:newMod}
    const {supabase:sb}=await import('../../lib/supabase')
    await sb.from('trades').update({terms:newTerms}).eq('id',trade.id)
    refreshTrade(trade.id,{...trade,terms:newTerms})
  }

  if (!trade) return <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.7rem'}}>TRADE NOT FOUND</div>

  return (
    <div className="tw">
      <div className="tw-strip">
        <span className="tw-ref">{trade.trade_ref}</span>
        <span className="tw-badge" style={{color:acColor,borderColor:acColor+'50'}}>{trade.asset_class}</span>
        <span className="tw-badge" style={{color:'var(--text-dim)',borderColor:'var(--border)'}}>{trade.instrument_type}</span>
        <span className="tw-badge" style={{color:stColor,borderColor:stColor+'50'}}>{trade.status}</span>
        <span className="tw-badge" style={{color:srColor,borderColor:srColor+'50'}}>{trade.store}</span>
        {trade.counterparty&&<span style={{fontSize:'0.65rem',color:'var(--text-dim)'}}>{trade.counterparty.name}</span>}
        <div className="tw-strip-actions">
          {trade.status==='PENDING'&&<button className="tw-act tw-act-live" onClick={()=>act('LIVE')} disabled={busy}>ACTIVATE</button>}
          {trade.status==='LIVE'&&<button className="tw-act tw-act-mature" onClick={()=>act('MATURED')} disabled={busy}>MATURE</button>}
          {['PENDING','LIVE'].includes(trade.status)&&<button className="tw-act tw-act-cancel" onClick={()=>act('CANCELLED')} disabled={busy}>CANCEL</button>}
        </div>
      </div>
      <div className="tw-tabs">
        {['OVERVIEW','LEGS','CASHFLOWS','PRICING','XVA'].map(p=>(
          <button key={p} className={\`tw-tab \${panel===p.toLowerCase()?'tw-tab-active':''}\`} onClick={()=>setPanel(tab.id,p.toLowerCase())}>{p}</button>
        ))}
      </div>
      <div className="tw-content">
        {panel==='overview'  && <OverviewPanel trade={trade}/>}
        {panel==='legs'      && <LegsPanel trade={trade}/>}
        {panel==='cashflows' && <CashflowsPanel trade={trade} onOverride={handleOverride}/>}
        {panel==='pricing'   && <StubPanel title="FULL REVALUATION ENGINE" sprint="SPRINT 3"
            desc={\`Curve bootstrap → cashflow discounting → full Greeks. Supports: \${trade.asset_class} — \${trade.instrument_type}\`}
            blocks={[{label:'NPV (CLEAN)',sub:'USD'},{label:'NPV (DIRTY)',sub:'USD'},{label:'ACCRUED INT.',sub:'USD'},{label:'PV01',sub:'USD/bp'},{label:'DV01',sub:'USD/bp'},{label:'GAMMA',sub:'USD/bp²'},{label:'VEGA',sub:'USD/%'},{label:'THETA',sub:'USD/day'},{label:'CARRY',sub:'USD/year'}]}/>}
        {panel==='xva'       && <StubPanel title="XVA COST STACK" sprint="SPRINT 3"
            desc={\`Counterparty: \${trade.counterparty?.name||'—'} · CSA: \${trade.counterparty?.csa_type||'—'}\`}
            blocks={[{label:'CVA',sub:'Credit Valuation Adj.'},{label:'DVA',sub:'Debit Valuation Adj.'},{label:'FVA',sub:'Funding Valuation Adj.'},{label:'MVA',sub:'Margin Valuation Adj.'},{label:'KVA',sub:'Capital Valuation Adj.'},{label:'TOTAL XVA',sub:'All-in cost'}]}/>}
      </div>
    </div>
  )
}
`);

console.log('\n✅  Script 2 complete — NewTradeWorkspace (26 instruments, all patches baked in) + TradeWorkspace');
console.log('\n════════════════════════════════════════════════════════════════');
console.log('ALL DONE. You ran 2 scripts total.');
console.log('  rijeka_script1.js — infrastructure (tab system, shell, book, app, nav)');
console.log('  rijeka_script2.js — blotter workspaces (new trade + trade view)');
console.log('');
console.log('26 instruments across 5 asset classes:');
console.log('  RATES (10): IR_SWAP, OIS_SWAP, BASIS_SWAP, XCCY_SWAP, FRA,');
console.log('              ZERO_COUPON_SWAP, STEP_UP_SWAP, INFLATION_SWAP,');
console.log('              CMS_SWAP, CMS_SPREAD_SWAP');
console.log('  FX    ( 3): FX_FORWARD, FX_SWAP, NDF');
console.log('  CREDIT( 5): CDS, CDS_INDEX, TOTAL_RETURN_SWAP, ASSET_SWAP,');
console.log('              RISK_PARTICIPATION');
console.log('  EQUITY( 4): EQUITY_SWAP, VARIANCE_SWAP, DIVIDEND_SWAP, EQUITY_FORWARD');
console.log('  CMDTY ( 4): COMMODITY_SWAP, COMMODITY_BASIS, ASIAN_COMMODITY, EMISSIONS');
console.log('════════════════════════════════════════════════════════════════');

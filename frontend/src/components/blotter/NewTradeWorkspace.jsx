import { useState, useEffect } from 'react'
import { useTradesStore } from '../../store/useTradesStore'
import { useTabStore } from '../../store/useTabStore'
import { supabase } from '../../lib/supabase'
import './NewTradeWorkspace.css'
import useTradeLegsStore from '../../store/useTradeLegsStore'
import useTradeEventsStore from '../../store/useTradeEventsStore'
import usePricerStore from '../../store/usePricerStore'

// ── UUID v4 generator (crypto API — no external dependency) ───────────────────
function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

// ── Tenor parser — '5Y', '18M', '6M', '2Y6M', '90D' → maturity date ──────────
function parseTenor(tenor, fromDate) {
  if (!tenor || !fromDate) return ''
  const d = new Date(fromDate)
  if (isNaN(d.getTime())) return ''

  // Normalise: uppercase, trim
  const t = tenor.trim().toUpperCase()

  // Handle combined e.g. 2Y6M
  const combined = t.match(/^(\d+)Y(\d+)M$/)
  if (combined) {
    d.setFullYear(d.getFullYear() + parseInt(combined[1]))
    d.setMonth(d.getMonth() + parseInt(combined[2]))
    return d.toISOString().substring(0, 10)
  }

  // Single unit
  const match = t.match(/^(\d+(?:\.\d+)?)(Y|M|W|D)$/)
  if (!match) return ''
  const n = parseFloat(match[1]), unit = match[2]

  if (unit === 'Y') { d.setFullYear(d.getFullYear() + Math.floor(n)); if (n % 1) d.setMonth(d.getMonth() + Math.round((n % 1) * 12)) }
  if (unit === 'M') d.setMonth(d.getMonth() + Math.round(n))
  if (unit === 'W') d.setDate(d.getDate() + Math.round(n * 7))
  if (unit === 'D') d.setDate(d.getDate() + Math.round(n))

  return d.toISOString().substring(0, 10)
}

// ── Leg ref generator — human readable + UUID ─────────────────────────────────
function makeLegRef(tradeRef, legIdx) {
  return `${tradeRef}-L${legIdx + 1}`
}

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
  FIXED: (dir='PAY',ccy='USD',notional='10,000,000') => ({
    leg_type:'FIXED',label:'FIXED LEG',direction:dir,currency:ccy,notional,
    notional_type:'BULLET',notional_schedule:[],
    day_count:'ACT/360',frequency:'SEMI-ANNUAL',bdc:'MODIFIED_FOLLOWING',
    calendar:'USD',stub_type:'SHORT_FIRST',roll_convention:'NONE',
    rate_type:'FLAT',fixed_rate:'',rate_schedule:[],
    payment_lag:'0',effective_date:'',maturity_date:'',
    first_period_start:'',last_period_end:'',
  }),
  FLOAT: (dir='RECEIVE',ccy='USD',idx='USD_SOFR',notional='10,000,000') => ({
    leg_type:'FLOAT',label:'FLOAT LEG',direction:dir,currency:ccy,notional,
    notional_type:'BULLET',notional_schedule:[],
    day_count:'ACT/360',frequency:'QUARTERLY',bdc:'MODIFIED_FOLLOWING',
    calendar:'USD',stub_type:'SHORT_FIRST',
    index:idx,leverage:'1.0',spread_type:'FLAT',spread:'0',spread_schedule:[],
    compounding:'NONE',cap:'',floor:'',fixing_lag:'2',lookback:'0',payment_lag:'0',
    effective_date:'',maturity_date:'',
  }),
  ZERO_COUPON: (dir='PAY',ccy='USD') => ({
    leg_type:'ZERO_COUPON',label:'ZC FIXED LEG',direction:dir,currency:ccy,notional:'10,000,000',
    day_count:'ACT/365',bdc:'MODIFIED_FOLLOWING',calendar:'USD',
    zc_rate:'',zc_compounding:'ANNUAL',effective_date:'',maturity_date:'',
  }),
  INFLATION: (dir='PAY',type='ZERO_COUPON') => ({
    leg_type:'INFLATION',label:'INFLATION LEG',direction:dir,currency:'USD',notional:'10,000,000',
    notional_type:'BULLET',notional_schedule:[],
    inflation_type:type,index:'USD_CPI_U',base_index:'',interpolation:'LINEAR',
    lag_months:'3',floor:'0',cap:'',
    day_count:'ACT/365',frequency:'ANNUAL',bdc:'MODIFIED_FOLLOWING',
    calendar:'USD',stub_type:'SHORT_FIRST',effective_date:'',maturity_date:'',
  }),
  CMS: (dir='RECEIVE',tenor='10Y') => ({
    leg_type:'CMS',label:`CMS ${tenor} LEG`,direction:dir,currency:'USD',notional:'10,000,000',
    notional_type:'BULLET',notional_schedule:[],
    cms_tenor:tenor,spread:'0',leverage:'1.0',cap:'',floor:'',fixing_lag:'2',
    day_count:'ACT/360',frequency:'SEMI-ANNUAL',bdc:'MODIFIED_FOLLOWING',
    calendar:'USD',stub_type:'SHORT_FIRST',effective_date:'',maturity_date:'',
  }),
  CDS_FEE: (dir='PAY') => ({
    leg_type:'CDS_FEE',label:'PROTECTION FEE',direction:dir,currency:'USD',notional:'10,000,000',
    spread_bps:'',frequency:'QUARTERLY',day_count:'ACT/360',bdc:'MODIFIED_FOLLOWING',
    effective_date:'',maturity_date:'',
  }),
  CDS_CONTINGENT: (dir='RECEIVE') => ({
    leg_type:'CDS_CONTINGENT',label:'CONTINGENT LEG',direction:dir,currency:'USD',notional:'10,000,000',
    recovery_rate:'0.40',seniority:'SENIOR_UNSECURED',settlement_type:'PHYSICAL',
    reference_entity:'',reference_isin:'',
  }),
  TOTAL_RETURN: (dir='PAY') => ({
    leg_type:'TOTAL_RETURN',label:'TOTAL RETURN LEG',direction:dir,currency:'USD',notional:'10,000,000',
    reference_asset:'',reference_asset_type:'BOND',reference_isin:'',
    return_type:'TOTAL_RETURN',dividend_treatment:'PASS_THROUGH',
    credit_event_settlement:'PHYSICAL',recovery_rate:'0.40',
    effective_date:'',maturity_date:'',
  }),
  EQUITY_RETURN: (dir='PAY') => ({
    leg_type:'EQUITY_RETURN',label:'EQUITY RETURN LEG',direction:dir,currency:'USD',notional:'10,000,000',
    reference:'',reference_type:'INDEX',return_type:'TOTAL_RETURN',
    initial_price:'',price_fixing_date:'',dividend_treatment:'PASS_THROUGH',
    effective_date:'',maturity_date:'',
  }),
  EQUITY_FWD: (dir='PAY') => ({
    leg_type:'EQUITY_FWD',label:'EQUITY FORWARD LEG',direction:dir,currency:'USD',notional:'10,000,000',
    reference:'',reference_type:'SINGLE_NAME',quantity:'',initial_price:'',forward_price:'',
    price_fixing_date:'',settlement_type:'CASH',dividend_treatment:'EXCLUDED',
    effective_date:'',maturity_date:'',
  }),
  COMMODITY_FLOAT: (dir='RECEIVE',idx='WTI_CRUDE') => ({
    leg_type:'COMMODITY_FLOAT',label:'COMMODITY FLOAT LEG',direction:dir,currency:'USD',notional:'10,000,000',
    commodity_index:idx,fixing_type:'AVERAGE_MONTHLY',fixing_source:'PLATTS',
    unit:'BBL',quantity:'',averaging_type:'ARITHMETIC',
    effective_date:'',maturity_date:'',
  }),
  EMISSIONS: (dir='RECEIVE',idx='EUA') => ({
    leg_type:'EMISSIONS_FLOAT',label:'EMISSIONS FLOAT LEG',direction:dir,currency:'EUR',notional:'10,000,000',
    emissions_index:idx,vintage_year:'',quantity:'',unit:'EUA',
    fixing_type:'AVERAGE_MONTHLY',fixing_source:'ICE',
    day_count:'ACT/360',frequency:'ANNUAL',bdc:'MODIFIED_FOLLOWING',calendar:'EUR',
    effective_date:'',maturity_date:'',
  }),
  VARIANCE: (dir='PAY') => ({
    leg_type:'VARIANCE',label:'VARIANCE LEG',direction:dir,currency:'USD',notional:'10,000,000',
    reference:'',variance_strike:'',vega_notional:'',
    observation_frequency:'DAILY',annualization_factor:'252',cap_variance:'',
    effective_date:'',maturity_date:'',
  }),
  DIVIDEND: (dir='PAY') => ({
    leg_type:'DIVIDEND',label:'DIVIDEND LEG',direction:dir,currency:'USD',notional:'10,000,000',
    reference:'',dividend_multiplier:'1.0',include_specials:'true',
    effective_date:'',maturity_date:'',
  }),
  RPA_FEE: (dir='RECEIVE') => ({
    leg_type:'RPA_FEE',label:'PARTICIPATION FEE',direction:dir,currency:'USD',notional:'10,000,000',
    participation_pct:'100',fee_bps:'',frequency:'QUARTERLY',
    day_count:'ACT/360',bdc:'MODIFIED_FOLLOWING',documentation:'LMA',
    effective_date:'',maturity_date:'',
  }),
  RPA_CONTINGENT: (dir='PAY') => ({
    leg_type:'RPA_CONTINGENT',label:'CONTINGENT LOSS LEG',direction:dir,currency:'USD',notional:'10,000,000',
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
  XCCY_SWAP:         () => [{
    ...LD.FLOAT('PAY','EUR','EUR_EURIBOR_3M'),
    label:'EUR FLOAT (PAY)',
    xccy_mtm_type: 'NON_MTM',
    xccy_fx_pair: 'EURUSD',
    xccy_initial_fx_rate: '',
    xccy_notional_exchange: 'BOTH',
    xccy_mtm_reset_frequency: 'QUARTERLY',
    xccy_mtm_reset_leg: 'USD',
    xccy_mtm_fx_source: 'WM_REUTERS',
    xccy_is_mtm_leg: false,
  }, {
    ...LD.FLOAT('RECEIVE','USD','USD_SOFR'),
    label:'USD FLOAT (RECEIVE)',
    xccy_mtm_type: 'NON_MTM',
    xccy_fx_pair: 'EURUSD',
    xccy_initial_fx_rate: '',
    xccy_notional_exchange: 'BOTH',
    xccy_mtm_reset_frequency: 'QUARTERLY',
    xccy_mtm_reset_leg: 'USD',
    xccy_mtm_fx_source: 'WM_REUTERS',
    xccy_is_mtm_leg: true,     // USD leg resets in MTM
  }],
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
          <button key={nt} className={`nt-btn ${leg.notional_type===nt?'nt-btn-on':''}`} onClick={()=>set('notional_type',nt)}>{nt}</button>
        ))}
      </div>
    </div>
    {leg.notional_type==='BULLET'&&<div className="fg"><label>NOTIONAL</label>
      <input placeholder="10,000,000"
        value={leg.notional}
        onChange={e=>set('notional',e.target.value)}
        onBlur={e=>{
          const raw = parseFloat(e.target.value.replace(/,/g,''))
          if (!isNaN(raw)) set('notional', raw.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))
        }}
      />
    </div>}
    {['LINEAR_AMORT','MORTGAGE'].includes(leg.notional_type)&&<div className="row2">
      <div className="fg"><label>INITIAL NOTIONAL</label>
        <input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}
          onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
      </div>
      <div className="fg"><label>FINAL NOTIONAL</label>
        <input placeholder="0" value={leg.final_notional||''} onChange={e=>set('final_notional',e.target.value)}
          onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('final_notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
      </div>
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
    <div className="leg-tabs">{['terms','schedule','rates'].map(t=><button key={t} className={`leg-tab ${tab===t?'leg-tab-active':''}`} onClick={()=>setTab(t)}>{t.toUpperCase()}</button>)}</div>
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

function FloatForm({leg,set,legs,legIdx}) {
  const [tab,setTab]=useState('terms')
  return (<>
    <div className="leg-tabs">{['terms','schedule','spread'].map(t=><button key={t} className={`leg-tab ${tab===t?'leg-tab-active':''}`} onClick={()=>setTab(t)}>{t.toUpperCase()}</button>)}</div>
    {tab==='terms'&&<><XccyFields leg={leg} set={set} legs={legs} legIdx={legIdx}/><CommonLegFields leg={leg} set={set}/>
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


function XccyFields({leg, set, legs, legIdx}) {
  const isFirstLeg = legIdx === 0
  if (!('xccy_mtm_type' in leg)) return null

  const isMtm = leg.xccy_mtm_type === 'MTM'

  // Sync MTM settings across both legs
  const syncAll = (k, v) => {
    // This is called via set() which only updates this leg.
    // We update shared fields on both legs via the parent.
    set(k, v)
  }

  return (
    <>
      <div className="sec-lbl" style={{color:'var(--blue)'}}>CROSS-CURRENCY SETTINGS</div>

      {isFirstLeg && <>
        <div className="row2">
          <div className="fg">
            <label>MTM TYPE</label>
            <select value={leg.xccy_mtm_type} onChange={e => {
              const val = e.target.value
              set('xccy_mtm_type', val)
            }}>
              <option value="NON_MTM">NON-MTM (Corporate / Liability Hedge)</option>
              <option value="MTM">MTM — Mark-to-Market (Interbank Standard)</option>
            </select>
          </div>
          <div className="fg">
            <label>FX PAIR</label>
            <select value={leg.xccy_fx_pair} onChange={e => set('xccy_fx_pair', e.target.value)}>
              {['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD','NOKUSD','SEKUSD',
                'EURGBP','EURJPY','EURCHF','EURCAD','GBPJPY','USDSGD','USDHKD'].map(p =>
                <option key={p}>{p}</option>)}
            </select>
          </div>
        </div>

        <div className="row2">
          <div className="fg">
            <label>INITIAL FX RATE ({leg.xccy_fx_pair})</label>
            <input
              placeholder={leg.xccy_fx_pair==='EURUSD'?'1.0850':leg.xccy_fx_pair==='USDJPY'?'149.50':'0.0000'}
              value={leg.xccy_initial_fx_rate}
              onChange={e => set('xccy_initial_fx_rate', e.target.value)}
            />
          </div>
          <div className="fg">
            <label>NOTIONAL EXCHANGE</label>
            <select value={leg.xccy_notional_exchange} onChange={e => set('xccy_notional_exchange', e.target.value)}>
              <option value="NONE">NONE</option>
              <option value="INITIAL_ONLY">INITIAL ONLY</option>
              <option value="FINAL_ONLY">FINAL ONLY</option>
              <option value="BOTH">BOTH (Initial + Final)</option>
              {isMtm && <option value="PERIODIC">PERIODIC (MTM Resets)</option>}
            </select>
          </div>
        </div>

        {isMtm && <>
          <div style={{
            fontSize:'0.62rem', color:'var(--blue)', padding:'0.4rem 0.6rem',
            background:'color-mix(in srgb, var(--blue) 8%, transparent)',
            border:'1px solid color-mix(in srgb, var(--blue) 30%, transparent)',
            borderRadius:2, lineHeight:1.6, marginTop:'0.25rem'
          }}>
            ● MTM: USD leg notional resets each period to reflect current FX rate.
            Eliminates FX-driven counterparty credit risk on notional.
            Standard for interbank XCCY trades.
          </div>
          <div className="row3">
            <div className="fg">
              <label>MTM RESET LEG</label>
              <select value={leg.xccy_mtm_reset_leg} onChange={e => set('xccy_mtm_reset_leg', e.target.value)}>
                <option>USD</option><option>EUR</option><option>GBP</option>
                <option>JPY</option><option>CHF</option><option>CAD</option>
              </select>
            </div>
            <div className="fg">
              <label>RESET FREQUENCY</label>
              <select value={leg.xccy_mtm_reset_frequency} onChange={e => set('xccy_mtm_reset_frequency', e.target.value)}>
                <option>MONTHLY</option><option>QUARTERLY</option>
                <option>SEMI-ANNUAL</option><option>ANNUAL</option>
              </select>
            </div>
            <div className="fg">
              <label>FX FIXING SOURCE</label>
              <select value={leg.xccy_mtm_fx_source} onChange={e => set('xccy_mtm_fx_source', e.target.value)}>
                <option value="WM_REUTERS">WM/Reuters 4pm Fix</option>
                <option value="ECB_FIXING">ECB Daily Fixing</option>
                <option value="BBG_BFIX">Bloomberg BFIX</option>
                <option value="FED_H10">Fed H.10 (USD pairs)</option>
              </select>
            </div>
          </div>
        </>}

        {!isMtm && (
          <div style={{
            fontSize:'0.62rem', color:'var(--text-dim)', padding:'0.4rem 0.6rem',
            background:'color-mix(in srgb, var(--border) 30%, transparent)',
            border:'1px solid var(--border)', borderRadius:2, lineHeight:1.6, marginTop:'0.25rem'
          }}>
            ● NON-MTM: Notional fixed at inception. FX rate locked at initial rate.
            Simpler operationally — preferred for corporate / liability hedging.
          </div>
        )}
      </>}

      {!isFirstLeg && leg.xccy_is_mtm_leg && isMtm && (
        <div style={{
          fontSize:'0.62rem', color:'var(--amber)', padding:'0.4rem 0.6rem',
          background:'color-mix(in srgb, var(--amber) 8%, transparent)',
          border:'1px solid color-mix(in srgb, var(--amber) 30%, transparent)',
          borderRadius:2, lineHeight:1.6
        }}>
          ● MTM LEG: This leg's notional resets each {leg.xccy_mtm_reset_frequency||'QUARTERLY'} period
          based on {leg.xccy_mtm_fx_source?.replace(/_/g,' ')||'WM/Reuters'} {leg.xccy_fx_pair} fixing.
          Reset cashflows generated by Sprint 3 pricing engine.
        </div>
      )}
    </>
  )
}

function LegForm({leg,set,legs,legIdx}) {
  switch(leg.leg_type) {
    case 'FIXED':          return <FixedForm leg={leg} set={set}/>
    case 'FLOAT':          return <FloatForm leg={leg} set={set} legs={legs} legIdx={legIdx}/>
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
  const remove=()=>setLegs(legs.filter((_,i)=>i!==legIdx))
  const dc=leg.direction==='PAY'?'var(--red)':'var(--accent)'
  return (
    <div className="leg-card">
      <div className="leg-card-hdr" onClick={()=>setOpen(!open)}>
        <span className="leg-dir-badge" style={{color:dc,borderColor:dc+'60'}}>{leg.direction}</span>
        <span className="leg-type-label">{leg.label}</span>
        <span className="leg-ccy">{leg.currency}</span>
        <span className="leg-notional">{leg.notional?Number(String(leg.notional).replace(/,/g,'')).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0})+' '+leg.currency:'—'}</span>
        <span className={`leg-chevron ${open?'leg-chevron-open':''}`}>▾</span>
        {legs.length > 1 && (
          <button
            onClick={e=>{e.stopPropagation();remove()}}
            title="Remove leg"
            style={{
              background:'none', border:'none', color:'var(--text-dim)',
              cursor:'pointer', fontSize:'0.7rem', padding:'0 0.25rem',
              marginLeft:'0.25rem', lineHeight:1, transition:'color 0.12s',
            }}
            onMouseEnter={e=>e.target.style.color='var(--red)'}
            onMouseLeave={e=>e.target.style.color='var(--text-dim)'}
          >✕</button>
        )}
      </div>
      {open&&<div className="leg-body"><LegForm leg={leg} set={set} legs={legs} legIdx={legIdx}/></div>}
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
  const [tradeRef,setTradeRef]=useState(`TRD-${Date.now().toString().slice(-8)}`)
  const [store,setStore]=useState('WORKING')
  const [notionalCcy,setNotionalCcy]=useState('USD')
  const [tradeDate,setTradeDate]=useState(today)
  const [effectiveDate,setEffDate]=useState(today)
  const [maturityDate,setMatDate]=useState(()=>parseTenor('5Y', new Date().toISOString().substring(0,10)))
  const [counterpartyId,setCpId]=useState('')
  const [ownEntityId,setOeId]=useState('')
  const [desk,setDesk]=useState('')
  const [deskId,setDeskId]=useState('')
  const [book,setBook]=useState('')
  const [bookId,setBookId]=useState('')
  const [notionalExchange,setNotionalExchange]=useState(false)
  const [tenor,setTenor]=useState('5Y')
  const [cps,setCps]=useState([])
  const [les,setLes]=useState([])
  const [desks,setDesks]=useState([])
  const [books,setBooks]=useState([])
  const [filteredBooks,setFilteredBooks]=useState([])
  const [busy,setBusy]=useState(false)
  const [err,setErr]=useState('')

  useEffect(()=>{
    supabase.from('counterparties').select('*').then(({data})=>setCps(data||[]))
    supabase.from('legal_entities').select('*').then(({data})=>setLes(data||[]))
    supabase.from('org_nodes')
      .select('*')
      .eq('is_active', true)
      .order('sort_order')
      .then(({data}) => {
        const nodes = data || []
        setDesks(nodes.filter(n => n.node_type === 'desk'))
        setBooks(nodes.filter(n => n.node_type === 'book'))
        setFilteredBooks(nodes.filter(n => n.node_type === 'book'))
      })
  },[])

  const changeAc=(a)=>{setAc(a);const it=INSTRUMENTS[a][0];setInstrument(it);setLegs((TEMPLATES[it]||TEMPLATES.IR_SWAP)())}
  const changeIT=(it)=>{setInstrument(it);setLegs((TEMPLATES[it]||TEMPLATES.IR_SWAP)());setDirty(tab.id,true)}
  const cfs=genCFs(legs,effectiveDate,maturityDate)

  const submit=async()=>{
    if(!tradeRef) return setErr('Trade ref required')
    if(!maturityDate) return setErr('Maturity date required')
    setErr('');setBusy(true)
    const firstLeg=legs[0]
    const notional=firstLeg?parseFloat(String(firstLeg.notional||'').replace(/,/g,'').replace(/s/g,''))||null:null
    const terms={
      structure: instrument,
      legs: legs.map((l, i) => ({
        ...l,
        leg_id:  uuidv4(),                        // UUID — independently addressable
        leg_ref: makeLegRef(tradeRef, i),          // human readable: TRD-12345678-L1
        leg_seq: i,                                // ordinal position
        leg_hash: null,                            // Sprint 5: filled by confirmation engine
        booked_at: new Date().toISOString(),
      })),
      cashflow_overrides: {},
      cashflow_hashes: {},                         // Sprint 5: cashflow-level hashes
      instrument_modifier: null,
      notional_exchange: notionalExchange,
      trade_hash: null,                            // Sprint 5: filled by confirmation engine
    }
    const payload={trade_ref:tradeRef,status:'PENDING',store,asset_class:ac,instrument_type:instrument,notional,notional_ccy:notionalCcy,trade_date:tradeDate,effective_date:effectiveDate,maturity_date:maturityDate,terms}
    if(desk) payload.desk=desk
    if(book) payload.book=book
    if(counterpartyId) payload.counterparty_id=counterpartyId
    if(ownEntityId) payload.own_legal_entity_id=ownEntityId
    const res=await addTrade(payload)
    if(res?.error) { setBusy(false); return setErr(res.error.message) }

    const bookedTrade = res.data
    const tradeId = bookedTrade.id
    const bookedAt = new Date().toISOString()

    // ── Book legs into trade_legs table ──────────────────────
    const { bookAllLegs } = useTradeLegsStore.getState()
    const legPayloads = terms.legs.map((l, i) => ({
      id:                 l.leg_id,
      trade_id:           tradeId,
      leg_ref:            l.leg_ref,
      leg_seq:            i,
      leg_type:           l.leg_type || 'FIXED',
      direction:          l.direction || 'PAY',
      currency:           l.currency || notionalCcy,
      notional:           parseFloat(String(l.notional || notional || 0).replace(/,/g, '')) || null,
      notional_type:      l.notional_type || 'BULLET',
      effective_date:     l.effective_date || effectiveDate || null,
      maturity_date:      l.maturity_date || maturityDate || null,
      day_count:          l.day_count || null,
      payment_frequency:  l.frequency || l.payment_frequency || null,
      reset_frequency:    l.reset_frequency || null,
      bdc:                l.bdc || null,
      stub_type:          l.stub_type || null,
      payment_calendar:   l.payment_calendar || null,
      payment_lag:        l.payment_lag || 0,
      fixed_rate:         l.fixed_rate != null ? parseFloat(String(l.fixed_rate).replace(/,/g, '')) : null,
      fixed_rate_type:    l.fixed_rate_type || 'FLAT',
      spread:             l.spread != null ? parseFloat(String(l.spread).replace(/,/g, '')) : null,
      spread_type:        l.spread_type || 'FLAT',
      forecast_curve_id:  l.forecast_curve_id || null,
      discount_curve_id:  l.discount_curve_id || null,
      cap_rate:           l.cap_rate || null,
      floor_rate:         l.floor_rate || null,
      leverage:           l.leverage || 1.0,
      ois_compounding:    l.ois_compounding || null,
      terms:              l,
      leg_hash:           null,
      booked_at:          bookedAt,
    }))
    await bookAllLegs(legPayloads)

    // ── Append BOOKED event ───────────────────────────────────
    const { appendEvent } = useTradeEventsStore.getState()
    await appendEvent({
      trade_id:       tradeId,
      event_type:     'BOOKED',
      event_date:     tradeDate || new Date().toISOString().slice(0, 10),
      effective_date: effectiveDate || tradeDate || new Date().toISOString().slice(0, 10),
      payload: {
        instrument:   instrument,
        asset_class:  ac,
        notional:     notional,
        currency:     notionalCcy,
        leg_count:    terms.legs.length,
      },
      pre_state:  {},
      post_state: { status: 'PENDING', store },
    })

    // ── Generate cashflow schedule ────────────────────────────
    // Use a flat 5% default curve — user can reprice from PRICING tab
    const { generateCashflows } = usePricerStore.getState()
    const discCurveId = legs[0]?.discount_curve_id || 'default'
    const foreCurveId = legs[0]?.forecast_curve_id || discCurveId
    const curveIds = [...new Set([discCurveId, foreCurveId, 'default'])]
    const curveInputs = curveIds.map(id => ({ curve_id: id, flat_rate: 0.05 }))
    // Fire-and-forget — cashflows generate in background, no spinner needed
    generateCashflows(tradeId, curveInputs).catch(e =>
      console.warn('[booking] generateCashflows failed (non-critical):', e)
    )

    setBusy(false)
    promoteTrade(tab.id, bookedTrade)
  }

  const ownLEs=les.filter(e=>e.is_own_entity&&e.is_active)

  return (
    <div className="ntw">
      <div className="ntw-header">
        <span className="ntw-title">NEW TRADE</span>
        <div className="ntw-instrument-row">
          <div style={{display:'flex',gap:'0.3rem'}}>
            {ASSET_CLASSES.map(a=>(
              <button key={a} className={`chip-s ${ac===a?'chip-s-on':''}`}
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
              <div className="fg"><label>EFFECTIVE DATE</label>
                <input type="date" value={effectiveDate} onChange={e=>{
                  setEffDate(e.target.value)
                  if (tenor) {
                    const mat = parseTenor(tenor, e.target.value)
                    if (mat) setMatDate(mat)
                  }
                }}/>
              </div>
              <div className="fg">
                <label>TENOR</label>
                <input
                  placeholder="5Y, 10Y, 6M, 18M, 2Y6M, 90D"
                  value={tenor}
                  onChange={e => {
                    setTenor(e.target.value)
                    const mat = parseTenor(e.target.value, effectiveDate)
                    if (mat) setMatDate(mat)
                  }}
                  style={{fontWeight:600, letterSpacing:'0.06em'}}
                />
              </div>
              <div className="fg">
                <label>MATURITY DATE *</label>
                <input
                  type="date"
                  value={maturityDate}
                  onChange={e => {
                    setMatDate(e.target.value)
                    setTenor('') // clear tenor when date is manually set
                  }}
                />
              </div>
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
              <div className="fg">
                <label>DESK</label>
                <select value={deskId} onChange={e=>{
                  const id = e.target.value
                  const d = desks.find(x=>x.id===id)
                  setDeskId(id)
                  setDesk(d?.name||'')
                  // filter books to this desk's children
                  const fb = books.filter(b=>b.parent_id===id)
                  setFilteredBooks(fb)
                  setBookId('')
                  setBook('')
                }}>
                  <option value="">— select desk —</option>
                  {desks.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="fg">
                <label>BOOK</label>
                <select value={bookId} onChange={e=>{
                  const id = e.target.value
                  const b = filteredBooks.find(x=>x.id===id)
                  setBookId(id)
                  setBook(b?.name||'')
                }} disabled={!deskId}>
                  <option value="">{deskId?'— select book —':'— select desk first —'}</option>
                  {filteredBooks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
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

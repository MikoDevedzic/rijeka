import { useState, useEffect, useCallback } from 'react'
import IrSwapStructureSelector from './IrSwapStructures';
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

// Optgroup buckets for dropdown — RATES only for now
const INSTRUMENT_GROUPS = {
  RATES: [
    {
      group: 'IR SWAP',
      items: ['IR_SWAP','CAPPED_SWAP','FLOORED_SWAP','COLLARED_SWAP','CALLABLE_SWAP','CANCELLABLE_SWAP'],
      hint:  'Variants (OIS/BASIS/XCCY etc) via STRUCTURE selector on IR SWAP',
    },
    {
      group: 'IR OPTIONS',
      items: ['IR_SWAPTION','BERMUDAN_SWAPTION','INTEREST_RATE_CAP','INTEREST_RATE_FLOOR','INTEREST_RATE_COLLAR'],
      hint:  'Standalone options with upfront, installment, deferred or contingent premium',
    },
    {
      group: 'OTHER RATES',
      items: ['FRA'],
      hint:  '',
    },
  ],
}

// IR OPTIONS quick-switch set (mirrors INSTRUMENT_GROUPS.RATES[1].items)
const IR_OPTIONS_ITEMS = [
  { value: 'IR_SWAPTION',          label: 'IR SWAPTION',  desc: 'European / American exercise' },
  { value: 'BERMUDAN_SWAPTION',    label: 'BERMUDAN',     desc: 'Bermudan exercise schedule'   },
  { value: 'INTEREST_RATE_CAP',    label: 'CAP',          desc: 'Rate ceiling — pays if above strike' },
  { value: 'INTEREST_RATE_FLOOR',  label: 'FLOOR',        desc: 'Rate floor — pays if below strike'   },
  { value: 'INTEREST_RATE_COLLAR', label: 'COLLAR',       desc: 'Cap + floor combined'         },
]
const IR_OPTIONS_SET = new Set(IR_OPTIONS_ITEMS.map(x => x.value))

// Display labels for instrument types (underscores → spaces, aliases)
const INSTR_LABEL = {
  IR_SWAP:              'IR SWAP',
  CAPPED_SWAP:          'CAPPED SWAP',
  FLOORED_SWAP:         'FLOORED SWAP',
  COLLARED_SWAP:        'COLLARED SWAP',
  CALLABLE_SWAP:        'CALLABLE SWAP',
  CANCELLABLE_SWAP:     'CANCELLABLE SWAP',
  IR_SWAPTION:          'IR SWAPTION',
  BERMUDAN_SWAPTION:    'BERMUDAN SWAPTION',
  INTEREST_RATE_CAP:    'INTEREST RATE CAP',
  INTEREST_RATE_FLOOR:  'INTEREST RATE FLOOR',
  INTEREST_RATE_COLLAR: 'INTEREST RATE COLLAR',
  FRA:                  'FRA',
  FX_FORWARD:           'FX FORWARD',
  FX_SWAP:              'FX SWAP',
  NDF:                  'NDF',
  FX_OPTION:            'FX OPTION',
  FX_DIGITAL_OPTION:    'FX DIGITAL OPTION',
  EXTENDABLE_FORWARD:   'EXTENDABLE FORWARD',
  CDS:                  'CDS',
  CDS_INDEX:            'CDS INDEX',
  TOTAL_RETURN_SWAP:    'TOTAL RETURN SWAP',
  ASSET_SWAP:           'ASSET SWAP',
  RISK_PARTICIPATION:   'RISK PARTICIPATION',
  CDS_OPTION:           'CDS OPTION',
  EQUITY_SWAP:          'EQUITY SWAP',
  VARIANCE_SWAP:        'VARIANCE SWAP',
  DIVIDEND_SWAP:        'DIVIDEND SWAP',
  EQUITY_FORWARD:       'EQUITY FORWARD',
  EQUITY_OPTION:        'EQUITY OPTION',
  COMMODITY_SWAP:       'COMMODITY SWAP',
  COMMODITY_BASIS_SWAP: 'COMMODITY BASIS SWAP',
  ASIAN_COMMODITY_SWAP: 'ASIAN COMMODITY SWAP',
  EMISSIONS_SWAP:       'EMISSIONS SWAP',
  COMMODITY_OPTION:     'COMMODITY OPTION',
  COMMODITY_ASIAN_OPTION:'COMMODITY ASIAN OPTION',
}

const INSTRUMENTS = {
  RATES: [
    // IR SWAP family (variants via STRUCTURE selector)
    'IR_SWAP',
    // Embedded-optionality swaps
    'CAPPED_SWAP','FLOORED_SWAP','COLLARED_SWAP',
    'CALLABLE_SWAP','CANCELLABLE_SWAP',
    // IR Options (standalone, upfront/installment premium)
    'IR_SWAPTION','BERMUDAN_SWAPTION',
    'INTEREST_RATE_CAP','INTEREST_RATE_FLOOR','INTEREST_RATE_COLLAR',
    // Other
    'FRA',
  ],
  FX:        ['FX_FORWARD','FX_SWAP','NDF','FX_OPTION','FX_DIGITAL_OPTION','EXTENDABLE_FORWARD'],
  CREDIT:    ['CDS','CDS_INDEX','TOTAL_RETURN_SWAP','ASSET_SWAP','RISK_PARTICIPATION','CDS_OPTION'],
  EQUITY:    ['EQUITY_SWAP','VARIANCE_SWAP','DIVIDEND_SWAP','EQUITY_FORWARD','EQUITY_OPTION'],
  COMMODITY: ['COMMODITY_SWAP','COMMODITY_BASIS_SWAP','ASIAN_COMMODITY_SWAP','EMISSIONS_SWAP','COMMODITY_OPTION','COMMODITY_ASIAN_OPTION'],
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
  // ── Options (Sprint 3E) ──────────────────────────────────────
  IR_SWAPTION: (dir='BUY') => ({
    leg_type:'IR_SWAPTION',label:'IR SWAPTION',direction:dir,currency:'USD',notional:'10,000,000',
    option_type:'PAYER',          // PAYER | RECEIVER
    exercise_style:'EUROPEAN',   // EUROPEAN | AMERICAN | BERMUDAN
    expiry_date:'',
    settlement_type:'PHYSICAL',  // PHYSICAL | CASH
    premium_type:'UPFRONT',premium:'',premium_currency:'USD',premium_date:'',premium_frequency:'',premium_last_date:'',
    underlying_fixed_rate:'',underlying_frequency:'SEMI-ANNUAL',
    underlying_day_count:'ACT/360',underlying_tenor:'5Y',underlying_index:'USD_SOFR',
    effective_date:'',maturity_date:'',
  }),
  CAP_FLOOR: (dir='BUY', type='CAP') => ({
    leg_type:'CAP_FLOOR',label:type,direction:dir,currency:'USD',notional:'10,000,000',
    cap_floor_type:type,          // CAP | FLOOR | COLLAR
    strike:'',floor_strike:'',
    index:'USD_SOFR',day_count:'ACT/360',frequency:'QUARTERLY',
    premium_type:'UPFRONT',premium:'',premium_currency:'USD',premium_date:'',premium_frequency:'',premium_last_date:'',
    effective_date:'',maturity_date:'',
  }),
  FX_OPTION: (dir='BUY') => ({
    leg_type:'FX_OPTION',label:'FX OPTION',direction:dir,currency:'USD',notional:'10,000,000',
    option_type:'CALL',           // CALL | PUT
    exercise_style:'EUROPEAN',
    fx_pair:'EURUSD',strike:'',
    expiry_date:'',delivery_date:'',
    settlement_type:'CASH',
    barrier_type:'NONE',barrier_level:'',
    digital_payout:'',
    premium_type:'UPFRONT',premium:'',premium_currency:'USD',premium_date:'',premium_frequency:'',premium_last_date:'',
  }),
  EQUITY_OPTION: (dir='BUY') => ({
    leg_type:'EQUITY_OPTION',label:'EQUITY OPTION',direction:dir,currency:'USD',notional:'10,000,000',
    option_type:'CALL',
    exercise_style:'EUROPEAN',
    reference:'',reference_type:'SINGLE_NAME',
    quantity:'',strike:'',initial_price:'',
    expiry_date:'',settlement_type:'CASH',
    premium_type:'UPFRONT',premium:'',premium_currency:'USD',premium_date:'',premium_frequency:'',premium_last_date:'',
  }),
  COMMODITY_OPTION: (dir='BUY', idx='WTI_CRUDE') => ({
    leg_type:'COMMODITY_OPTION',label:'COMMODITY OPTION',direction:dir,currency:'USD',notional:'10,000,000',
    option_type:'CALL',
    exercise_style:'EUROPEAN',
    commodity_index:idx,unit:'BBL',
    strike:'',quantity:'',
    expiry_date:'',settlement_type:'CASH',
    premium_type:'UPFRONT',premium:'',premium_currency:'USD',premium_date:'',premium_frequency:'',premium_last_date:'',
  }),
  CDS_OPTION: (dir='BUY') => ({
    leg_type:'CDS_OPTION',label:'CDS OPTION',direction:dir,currency:'USD',notional:'10,000,000',
    option_type:'PAYER',
    exercise_style:'EUROPEAN',
    expiry_date:'',strike_spread:'',
    reference_entity:'',reference_isin:'',
    recovery_rate:'0.40',seniority:'SENIOR_UNSECURED',
    knockout:true,
    premium_type:'UPFRONT',premium:'',premium_currency:'USD',premium_date:'',premium_frequency:'',premium_last_date:'',
  }),

  // ── Sprint 3F extended options ────────────────────────────

  BERMUDAN_SWAPTION: (dir='BUY') => ({
    leg_type:'BERMUDAN_SWAPTION',label:'BERMUDAN SWAPTION',direction:dir,currency:'USD',notional:'10,000,000',
    option_type:'PAYER',           // PAYER | RECEIVER
    exercise_dates:[],             // [{date, can_exercise}] — the Bermudan schedule
    first_exercise_date:'',
    last_exercise_date:'',
    exercise_frequency:'SEMI-ANNUAL', // how often exercise dates fall
    notice_days:'2',               // business days notice required to exercise
    settlement_type:'PHYSICAL',
    underlying_fixed_rate:'',underlying_frequency:'SEMI-ANNUAL',
    underlying_day_count:'ACT/360',underlying_tenor:'5Y',underlying_index:'USD_SOFR',
    effective_date:'',maturity_date:'',
    premium_type:'UPFRONT',premium:'',premium_currency:'USD',premium_date:'',premium_frequency:'',premium_last_date:'',
  }),

  // Callable/Cancellable swap: vanilla swap + embedded right to cancel
  // The optional swaption leg is what gives the right to cancel.
  // Booked as: regular IR_SWAP legs + one CALLABLE_SWAP_OPTION leg
  CALLABLE_SWAP_OPTION: (dir='BUY', callable_party='FIXED_PAYER') => ({
    leg_type:'CALLABLE_SWAP_OPTION',label:'CALLABLE/CANCELLABLE OPTION',direction:dir,
    currency:'USD',notional:'10,000,000',
    callable_party,             // FIXED_PAYER | FIXED_RECEIVER | EITHER
    exercise_style:'BERMUDAN',  // EUROPEAN (one call date) | BERMUDAN (schedule)
    first_call_date:'',
    call_frequency:'ANNUAL',    // after first call date, how often callable
    notice_days:'5',
    settlement_type:'PHYSICAL',
    // No premium — callable feature priced into swap rate
    effective_date:'',maturity_date:'',
  }),

  // Float leg with embedded cap/floor/collar — used in CAPPED/FLOORED/COLLARED SWAP
  CAPPED_FLOORED_FLOAT: (dir='RECEIVE', embedded='CAP') => ({
    leg_type:'CAPPED_FLOORED_FLOAT',label:embedded+' FLOAT LEG',direction:dir,
    currency:'USD',notional:'10,000,000',
    notional_type:'BULLET',notional_schedule:[],
    day_count:'ACT/360',frequency:'QUARTERLY',bdc:'MODIFIED_FOLLOWING',
    calendar:'USD',stub_type:'SHORT_FIRST',
    index:'USD_SOFR',leverage:'1.0',spread_type:'FLAT',spread:'0',spread_schedule:[],
    compounding:'NONE',
    embedded_optionality:embedded,    // CAP | FLOOR | COLLAR
    cap_strike:'',                    // for CAP and COLLAR
    floor_strike:'',                  // for FLOOR and COLLAR
    cap_floor_premium_included:true,  // usually yes — premium rolled into swap rate
    payment_lag:'0',
    effective_date:'',maturity_date:'',
  }),

  EXTENDABLE_FORWARD: (dir='BUY') => ({
    leg_type:'EXTENDABLE_FORWARD',label:'EXTENDABLE FORWARD',direction:dir,
    currency:'USD',notional:'10,000,000',
    fx_pair:'EURUSD',
    original_maturity:'',
    original_strike:'',
    extension_right:'BUYER',         // BUYER | SELLER | EITHER
    extension_period:'3M',           // how far it can be extended
    extended_maturity:'',            // auto-calculated or manual
    extended_strike:'',              // may differ from original
    extension_premium:'',           // premium paid to extend
    settlement_type:'PHYSICAL',
    effective_date:'',maturity_date:'',
  }),

  // Enhanced commodity option with full averaging control
  COMMODITY_ASIAN_OPTION: (dir='BUY', idx='WTI_CRUDE') => ({
    leg_type:'COMMODITY_ASIAN_OPTION',label:'COMMODITY ASIAN OPTION',direction:dir,
    currency:'USD',notional:'10,000,000',
    option_type:'CALL',
    exercise_style:'ASIAN',           // averaging-based payoff
    commodity_index:idx,unit:'BBL',
    strike:'',quantity:'',

    // Averaging window — this is the key distinction vs vanilla
    averaging_type:'FULL_PERIOD',     // FULL_PERIOD | PARTIAL_PERIOD | BULLET | CUSTOM
    observation_start:'',             // for PARTIAL_PERIOD: when obs window opens
    observation_end:'',               // for PARTIAL_PERIOD: when obs window closes
    // For CUSTOM: user builds schedule below
    observation_schedule:[],          // [{date, weight}] — custom observation dates + weights
    averaging_method:'ARITHMETIC',    // ARITHMETIC | GEOMETRIC | HARMONIC
    averaging_frequency:'DAILY',      // DAILY | WEEKLY | MONTHLY

    // Settlement
    settlement_type:'CASH',
    settlement_currency:'USD',
    // Bullet settlement: single payment at maturity
    // vs staged: settlement at each averaging period end
    settlement_style:'BULLET',        // BULLET | STAGED

    expiry_date:'',maturity_date:'',
    premium_type:'UPFRONT',premium:'',premium_currency:'USD',premium_date:'',premium_frequency:'',premium_last_date:'',
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
  // ── Options (Sprint 3E) ──────────────────────────────────────
  IR_SWAPTION:           () => [LD.IR_SWAPTION('BUY')],
  BERMUDAN_SWAPTION:     () => [LD.BERMUDAN_SWAPTION('BUY')],
  // Callable/Cancellable = IR_SWAP legs + embedded option leg
  CALLABLE_SWAP:         () => [LD.FIXED('PAY'), LD.FLOAT('RECEIVE'), LD.CALLABLE_SWAP_OPTION('BUY','FIXED_PAYER')],
  CANCELLABLE_SWAP:      () => [LD.FIXED('PAY'), LD.FLOAT('RECEIVE'), {...LD.CALLABLE_SWAP_OPTION('BUY','FIXED_PAYER'), label:'CANCELLABLE OPTION'}],
  // Capped/Floored/Collared swap = fixed leg + optionality-embedded float leg
  CAPPED_SWAP:           () => [LD.FIXED('PAY'), LD.CAPPED_FLOORED_FLOAT('RECEIVE','CAP')],
  FLOORED_SWAP:          () => [LD.FIXED('PAY'), LD.CAPPED_FLOORED_FLOAT('RECEIVE','FLOOR')],
  COLLARED_SWAP:         () => [LD.FIXED('PAY'), LD.CAPPED_FLOORED_FLOAT('RECEIVE','COLLAR')],
  EXTENDABLE_FORWARD:    () => [LD.EXTENDABLE_FORWARD('BUY')],
  COMMODITY_ASIAN_OPTION:() => [LD.COMMODITY_ASIAN_OPTION('BUY','WTI_CRUDE')],
  INTEREST_RATE_CAP:     () => [LD.CAP_FLOOR('BUY','CAP')],
  INTEREST_RATE_FLOOR:   () => [LD.CAP_FLOOR('BUY','FLOOR')],
  INTEREST_RATE_COLLAR:  () => [{...LD.CAP_FLOOR('BUY','COLLAR'),cap_floor_type:'COLLAR',label:'COLLAR'}],
  FX_OPTION:             () => [LD.FX_OPTION('BUY')],
  FX_DIGITAL_OPTION:     () => [{...LD.FX_OPTION('BUY'),label:'FX DIGITAL OPTION',barrier_type:'DIGITAL'}],
  CDS_OPTION:            () => [LD.CDS_OPTION('BUY')],
  EQUITY_OPTION:         () => [LD.EQUITY_OPTION('BUY')],
  COMMODITY_OPTION:      () => [LD.COMMODITY_OPTION('BUY','WTI_CRUDE')],
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
      <div className="row2">
        <div className="fg"><label>COMPOUNDING</label><select value={leg.compounding} onChange={e=>set('compounding',e.target.value)}>{COMPOUNDINGS.map(c=><option key={c}>{c}</option>)}</select></div>
        <div className="fg"><label>FIX LAG (d)</label><input placeholder="2" value={leg.fixing_lag} onChange={e=>set('fixing_lag',e.target.value)}/></div>
      </div>
      <div className="sec-lbl" style={{marginTop:'0.6rem'}}>EMBEDDED OPTIONALITY</div>
      <div style={{fontSize:'0.6rem',color:'var(--text-dim)',marginBottom:'0.4rem',lineHeight:1.6}}>
        Add a cap, floor, or collar to this float leg. Premium is typically rolled into the fixed rate — use CAP / FLOOR / COLLAR as standalone instruments if booking with upfront premium.
      </div>
      <div className="row2">
        <div className="fg"><label>OPTIONALITY TYPE</label>
          <select
            value={leg.embedded_optionality || 'NONE'}
            onChange={e => {
              const v = e.target.value
              set('embedded_optionality', v)
              // Auto-update leg label to reflect embedded structure
              const base = leg.label.replace(/ [CAP]| [FLOOR]| [COLLAR]/g, '')
              if (v !== 'NONE') set('label', base + ' [' + v + ']')
              else set('label', base)
            }}
          >
            <option value="NONE">NONE (vanilla float)</option>
            <option value="CAP">CAP (rate ceiling)</option>
            <option value="FLOOR">FLOOR (rate floor)</option>
            <option value="COLLAR">COLLAR (cap + floor)</option>
          </select>
        </div>
        <div className="fg"><label>PREMIUM TREATMENT</label>
          <select value={leg.cap_floor_premium_included !== false ? 'true' : 'false'} onChange={e=>set('cap_floor_premium_included', e.target.value === 'true')} disabled={!leg.embedded_optionality || leg.embedded_optionality === 'NONE'}>
            <option value="true">ROLLED INTO FIXED RATE</option>
            <option value="false">SEPARATE PREMIUM LEG</option>
          </select>
        </div>
      </div>
      {leg.embedded_optionality && leg.embedded_optionality !== 'NONE' && (
        <div className="row2">
          {(leg.embedded_optionality === 'CAP' || leg.embedded_optionality === 'COLLAR') && (
            <div className="fg"><label>CAP STRIKE</label><input placeholder="0.0600" value={leg.cap || ''} onChange={e=>set('cap', e.target.value)}/></div>
          )}
          {(leg.embedded_optionality === 'FLOOR' || leg.embedded_optionality === 'COLLAR') && (
            <div className="fg"><label>FLOOR STRIKE</label><input placeholder="0.0200" value={leg.floor || ''} onChange={e=>set('floor', e.target.value)}/></div>
          )}
        </div>
      )}
      {(!leg.embedded_optionality || leg.embedded_optionality === 'NONE') && (
        <div className="row2">
          <div className="fg"><label>CAP (legacy)</label><input placeholder="none" value={leg.cap || ''} onChange={e=>set('cap',e.target.value)}/></div>
          <div className="fg"><label>FLOOR (legacy)</label><input placeholder="none" value={leg.floor || ''} onChange={e=>set('floor',e.target.value)}/></div>
        </div>
      )}</>}
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
          Reset cashflows generated at booking by the pricing engine.
        </div>
      )}
    </>
  )
}

// ── Option form components (Sprint 3E) ───────────────────────

function OptionPremiumFields({leg,set}) {
  return (
    <div className="sec-lbl-group">
      <PremiumSection leg={leg} set={set}/>
    </div>
  )
}

// ── Sprint 4B: PremiumSection ────────────────────────────────────────────────
// Handles UPFRONT | INSTALLMENT | DEFERRED | CONTINGENT premium structures.
// Used by all IR/FX/Equity/Commodity/CDS option forms.
function PremiumSection({leg,set}) {
  const type = leg.premium_type || 'UPFRONT'
  return (<>
    <div className="sec-lbl">PREMIUM</div>
    <div className="row2">
      <div className="fg"><label>PREMIUM TYPE</label>
        <select value={type} onChange={e=>set('premium_type',e.target.value)}>
          <option value="UPFRONT">UPFRONT — single date</option>
          <option value="INSTALLMENT">INSTALLMENT — periodic payments</option>
          <option value="DEFERRED">DEFERRED — paid at expiry</option>
          <option value="CONTINGENT">CONTINGENT — only if ITM</option>
        </select>
      </div>
      <div className="fg"><label>PREMIUM CCY</label>
        <select value={leg.premium_currency||'USD'} onChange={e=>set('premium_currency',e.target.value)}>
          {CCYS.map(c=><option key={c}>{c}</option>)}
        </select>
      </div>
    </div>

    {type==='UPFRONT'&&(
      <div className="row2">
        <div className="fg"><label>PREMIUM AMOUNT</label>
          <input placeholder="0" value={leg.premium||''} onChange={e=>set('premium',e.target.value)}/>
        </div>
        <div className="fg"><label>PREMIUM DATE</label>
          <input type="date" value={leg.premium_date||''} onChange={e=>set('premium_date',e.target.value)}/>
        </div>
      </div>
    )}

    {type==='INSTALLMENT'&&(<>
      <div className="row2">
        <div className="fg"><label>AMOUNT PER INSTALLMENT</label>
          <input placeholder="0" value={leg.premium||''} onChange={e=>set('premium',e.target.value)}/>
        </div>
        <div className="fg"><label>FREQUENCY</label>
          <select value={leg.premium_frequency||'MONTHLY'} onChange={e=>set('premium_frequency',e.target.value)}>
            {FREQS.map(f=><option key={f}>{f}</option>)}
          </select>
        </div>
      </div>
      <div className="row2">
        <div className="fg"><label>FIRST PAYMENT</label>
          <input type="date" value={leg.premium_date||''} onChange={e=>set('premium_date',e.target.value)}/>
        </div>
        <div className="fg"><label>LAST PAYMENT</label>
          <input type="date" value={leg.premium_last_date||''} onChange={e=>set('premium_last_date',e.target.value)}/>
        </div>
      </div>
      <div style={{fontSize:'0.6rem',color:'var(--text-dim)',marginBottom:'0.5rem',lineHeight:1.6}}>
        Installment option: if buyer misses a payment, option lapses and all prior premiums are forfeited.
        Total PV of installments = equivalent upfront premium.
      </div>
    </>)}

    {type==='DEFERRED'&&(
      <div className="row2">
        <div className="fg"><label>PREMIUM AMOUNT</label>
          <input placeholder="0" value={leg.premium||''} onChange={e=>set('premium',e.target.value)}/>
        </div>
        <div className="fg" style={{display:'flex',alignItems:'flex-end',paddingBottom:'0.4rem'}}>
          <span style={{fontSize:'0.6rem',color:'var(--text-dim)',lineHeight:1.5}}>
            Paid at expiry regardless of whether the option is exercised.
          </span>
        </div>
      </div>
    )}

    {type==='CONTINGENT'&&(
      <div className="row2">
        <div className="fg"><label>PREMIUM AMOUNT</label>
          <input placeholder="0" value={leg.premium||''} onChange={e=>set('premium',e.target.value)}/>
        </div>
        <div className="fg" style={{display:'flex',alignItems:'flex-end',paddingBottom:'0.4rem'}}>
          <span style={{fontSize:'0.6rem',color:'var(--text-dim)',lineHeight:1.5}}>
            Only paid if option expires in-the-money. Higher amount than equivalent upfront.
          </span>
        </div>
      </div>
    )}
  </>)
}

function IrSwaptionForm({leg,set}) {
  return (<>
    <div className="sec-lbl">SWAPTION TERMS</div>
    <div className="row2">
      <div className="fg"><label>CURRENCY</label><select value={leg.currency} onChange={e=>set('currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>DIRECTION</label><select value={leg.direction} onChange={e=>set('direction',e.target.value)}><option>BUY</option><option>SELL</option></select></div>
    </div>
    <div className="fg"><label>NOTIONAL</label>
      <input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}
        onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
    </div>
    <div className="row3">
      <div className="fg"><label>OPTION TYPE</label><select value={leg.option_type} onChange={e=>set('option_type',e.target.value)}><option>PAYER</option><option>RECEIVER</option></select></div>
      <div className="fg"><label>EXERCISE STYLE</label><select value={leg.exercise_style} onChange={e=>set('exercise_style',e.target.value)}><option>EUROPEAN</option><option>AMERICAN</option><option>BERMUDAN</option></select></div>
      <div className="fg"><label>SETTLEMENT</label><select value={leg.settlement_type} onChange={e=>set('settlement_type',e.target.value)}><option>PHYSICAL</option><option>CASH</option></select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EXPIRY DATE</label><input type="date" value={leg.expiry_date||''} onChange={e=>set('expiry_date',e.target.value)}/></div>
      <div className="fg"><label>EFFECTIVE DATE (swap)</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
    </div>
    <div className="sec-lbl">UNDERLYING SWAP</div>
    <div className="row3">
      <div className="fg"><label>UNDERLYING TENOR</label><input placeholder="5Y" value={leg.underlying_tenor||''} onChange={e=>set('underlying_tenor',e.target.value)}/></div>
      <div className="fg"><label>STRIKE (fixed rate)</label><input placeholder="0.0450" value={leg.underlying_fixed_rate||''} onChange={e=>set('underlying_fixed_rate',e.target.value)}/></div>
      <div className="fg"><label>FLOAT INDEX</label><select value={leg.underlying_index||'USD_SOFR'} onChange={e=>set('underlying_index',e.target.value)}>{INDICES.map(i=><option key={i}>{i}</option>)}</select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>FREQUENCY</label><select value={leg.underlying_frequency||'SEMI-ANNUAL'} onChange={e=>set('underlying_frequency',e.target.value)}>{FREQS.map(f=><option key={f}>{f}</option>)}</select></div>
      <div className="fg"><label>DAY COUNT</label><select value={leg.underlying_day_count||'ACT/360'} onChange={e=>set('underlying_day_count',e.target.value)}>{DAY_COUNTS.map(d=><option key={d}>{d}</option>)}</select></div>
    </div>
    <div className="fg"><label>MATURITY DATE (swap)</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    <OptionPremiumFields leg={leg} set={set}/>
  </>)
}

function CapFloorForm({leg,set}) {
  const isCollar = leg.cap_floor_type === 'COLLAR'
  return (<>
    <div className="sec-lbl">CAP / FLOOR / COLLAR</div>
    <div className="row2">
      <div className="fg"><label>CURRENCY</label><select value={leg.currency} onChange={e=>set('currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>DIRECTION</label><select value={leg.direction} onChange={e=>set('direction',e.target.value)}><option>BUY</option><option>SELL</option></select></div>
    </div>
    <div className="fg"><label>NOTIONAL</label>
      <input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}
        onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
    </div>
    <div className="row3">
      <div className="fg"><label>TYPE</label><select value={leg.cap_floor_type} onChange={e=>set('cap_floor_type',e.target.value)}><option>CAP</option><option>FLOOR</option><option>COLLAR</option></select></div>
      <div className="fg"><label>{isCollar?'CAP STRIKE':'STRIKE'}</label><input placeholder="0.0550" value={leg.strike||''} onChange={e=>set('strike',e.target.value)}/></div>
      {isCollar&&<div className="fg"><label>FLOOR STRIKE</label><input placeholder="0.0300" value={leg.floor_strike||''} onChange={e=>set('floor_strike',e.target.value)}/></div>}
    </div>
    <div className="row3">
      <div className="fg"><label>FLOAT INDEX</label><select value={leg.index||'USD_SOFR'} onChange={e=>set('index',e.target.value)}>{INDICES.map(i=><option key={i}>{i}</option>)}</select></div>
      <div className="fg"><label>FREQUENCY</label><select value={leg.frequency||'QUARTERLY'} onChange={e=>set('frequency',e.target.value)}>{FREQS.map(f=><option key={f}>{f}</option>)}</select></div>
      <div className="fg"><label>DAY COUNT</label><select value={leg.day_count||'ACT/360'} onChange={e=>set('day_count',e.target.value)}>{DAY_COUNTS.map(d=><option key={d}>{d}</option>)}</select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
    <OptionPremiumFields leg={leg} set={set}/>
  </>)
}

function FxOptionForm({leg,set}) {
  const isDigital = leg.barrier_type === 'DIGITAL'
  const hasBarrier = leg.barrier_type && leg.barrier_type !== 'NONE' && !isDigital
  return (<>
    <div className="sec-lbl">FX OPTION TERMS</div>
    <div className="row2">
      <div className="fg"><label>CURRENCY (premium)</label><select value={leg.currency} onChange={e=>set('currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>DIRECTION</label><select value={leg.direction} onChange={e=>set('direction',e.target.value)}><option>BUY</option><option>SELL</option></select></div>
    </div>
    <div className="fg"><label>NOTIONAL</label>
      <input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}
        onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
    </div>
    <div className="row3">
      <div className="fg"><label>OPTION TYPE</label><select value={leg.option_type} onChange={e=>set('option_type',e.target.value)}><option>CALL</option><option>PUT</option></select></div>
      <div className="fg"><label>EXERCISE STYLE</label><select value={leg.exercise_style} onChange={e=>set('exercise_style',e.target.value)}><option>EUROPEAN</option><option>AMERICAN</option></select></div>
      <div className="fg"><label>SETTLEMENT</label><select value={leg.settlement_type} onChange={e=>set('settlement_type',e.target.value)}><option>CASH</option><option>PHYSICAL</option></select></div>
    </div>
    <div className="row3">
      <div className="fg"><label>FX PAIR</label><input placeholder="EURUSD" value={leg.fx_pair||''} onChange={e=>set('fx_pair',e.target.value)}/></div>
      <div className="fg"><label>STRIKE</label><input placeholder="1.0850" value={leg.strike||''} onChange={e=>set('strike',e.target.value)}/></div>
      <div className="fg"><label>BARRIER TYPE</label>
        <select value={leg.barrier_type||'NONE'} onChange={e=>set('barrier_type',e.target.value)}>
          {['NONE','UP_AND_IN','UP_AND_OUT','DOWN_AND_IN','DOWN_AND_OUT','DIGITAL'].map(b=><option key={b}>{b}</option>)}
        </select>
      </div>
    </div>
    {hasBarrier&&<div className="fg"><label>BARRIER LEVEL</label><input placeholder="1.1200" value={leg.barrier_level||''} onChange={e=>set('barrier_level',e.target.value)}/></div>}
    {isDigital&&<div className="fg"><label>DIGITAL PAYOUT</label><input placeholder="1,000,000" value={leg.digital_payout||''} onChange={e=>set('digital_payout',e.target.value)}/></div>}
    <div className="row2">
      <div className="fg"><label>EXPIRY DATE</label><input type="date" value={leg.expiry_date||''} onChange={e=>set('expiry_date',e.target.value)}/></div>
      <div className="fg"><label>DELIVERY DATE</label><input type="date" value={leg.delivery_date||''} onChange={e=>set('delivery_date',e.target.value)}/></div>
    </div>
    <OptionPremiumFields leg={leg} set={set}/>
  </>)
}

function EquityOptionForm({leg,set}) {
  return (<>
    <div className="sec-lbl">EQUITY OPTION TERMS</div>
    <div className="row2">
      <div className="fg"><label>CURRENCY</label><select value={leg.currency} onChange={e=>set('currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>DIRECTION</label><select value={leg.direction} onChange={e=>set('direction',e.target.value)}><option>BUY</option><option>SELL</option></select></div>
    </div>
    <div className="fg"><label>NOTIONAL</label>
      <input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}
        onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
    </div>
    <div className="row2">
      <div className="fg"><label>OPTION TYPE</label><select value={leg.option_type} onChange={e=>set('option_type',e.target.value)}><option>CALL</option><option>PUT</option></select></div>
      <div className="fg"><label>EXERCISE STYLE</label><select value={leg.exercise_style} onChange={e=>set('exercise_style',e.target.value)}><option>EUROPEAN</option><option>AMERICAN</option></select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>REFERENCE</label><input placeholder="AAPL / SPX" value={leg.reference||''} onChange={e=>set('reference',e.target.value)}/></div>
      <div className="fg"><label>TYPE</label><select value={leg.reference_type} onChange={e=>set('reference_type',e.target.value)}><option>SINGLE_NAME</option><option>INDEX</option><option>BASKET</option></select></div>
    </div>
    <div className="row3">
      <div className="fg"><label>QUANTITY</label><input placeholder="10,000" value={leg.quantity||''} onChange={e=>set('quantity',e.target.value)}/></div>
      <div className="fg"><label>STRIKE</label><input placeholder="185.00" value={leg.strike||''} onChange={e=>set('strike',e.target.value)}/></div>
      <div className="fg"><label>INITIAL PRICE</label><input placeholder="180.00" value={leg.initial_price||''} onChange={e=>set('initial_price',e.target.value)}/></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EXPIRY DATE</label><input type="date" value={leg.expiry_date||''} onChange={e=>set('expiry_date',e.target.value)}/></div>
      <div className="fg"><label>SETTLEMENT</label><select value={leg.settlement_type} onChange={e=>set('settlement_type',e.target.value)}><option>CASH</option><option>PHYSICAL</option></select></div>
    </div>
    <OptionPremiumFields leg={leg} set={set}/>
  </>)
}

function CommodityOptionForm({leg,set}) {
  return (<>
    <div className="sec-lbl">COMMODITY OPTION TERMS</div>
    <div className="row2">
      <div className="fg"><label>CURRENCY</label><select value={leg.currency} onChange={e=>set('currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>DIRECTION</label><select value={leg.direction} onChange={e=>set('direction',e.target.value)}><option>BUY</option><option>SELL</option></select></div>
    </div>
    <div className="fg"><label>NOTIONAL</label>
      <input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}
        onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
    </div>
    <div className="row2">
      <div className="fg"><label>OPTION TYPE</label><select value={leg.option_type} onChange={e=>set('option_type',e.target.value)}><option>CALL</option><option>PUT</option></select></div>
      <div className="fg"><label>EXERCISE STYLE</label><select value={leg.exercise_style} onChange={e=>set('exercise_style',e.target.value)}><option>EUROPEAN</option><option>AMERICAN</option><option>ASIAN</option></select></div>
    </div>
    <div className="row3">
      <div className="fg"><label>COMMODITY INDEX</label><select value={leg.commodity_index||'WTI_CRUDE'} onChange={e=>set('commodity_index',e.target.value)}>{COMMODITY_INDICES.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>UNIT</label><select value={leg.unit||'BBL'} onChange={e=>set('unit',e.target.value)}>{['BBL','MMBTU','MT','OZ','BU','LB'].map(u=><option key={u}>{u}</option>)}</select></div>
      <div className="fg"><label>SETTLEMENT</label><select value={leg.settlement_type} onChange={e=>set('settlement_type',e.target.value)}><option>CASH</option><option>PHYSICAL</option></select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>STRIKE</label><input placeholder="75.00" value={leg.strike||''} onChange={e=>set('strike',e.target.value)}/></div>
      <div className="fg"><label>QUANTITY</label><input placeholder="10,000" value={leg.quantity||''} onChange={e=>set('quantity',e.target.value)}/></div>
    </div>
    <div className="fg"><label>EXPIRY DATE</label><input type="date" value={leg.expiry_date||''} onChange={e=>set('expiry_date',e.target.value)}/></div>
    <OptionPremiumFields leg={leg} set={set}/>
  </>)
}

function CdsOptionForm({leg,set}) {
  return (<>
    <div className="sec-lbl">CDS OPTION TERMS</div>
    <div className="row2">
      <div className="fg"><label>CURRENCY</label><select value={leg.currency} onChange={e=>set('currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>DIRECTION</label><select value={leg.direction} onChange={e=>set('direction',e.target.value)}><option>BUY</option><option>SELL</option></select></div>
    </div>
    <div className="fg"><label>NOTIONAL</label>
      <input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}
        onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
    </div>
    <div className="row2">
      <div className="fg"><label>OPTION TYPE</label><select value={leg.option_type} onChange={e=>set('option_type',e.target.value)}><option>PAYER</option><option>RECEIVER</option></select></div>
      <div className="fg"><label>EXERCISE STYLE</label><select value={leg.exercise_style} onChange={e=>set('exercise_style',e.target.value)}><option>EUROPEAN</option><option>AMERICAN</option></select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>REFERENCE ENTITY</label><input placeholder="APPLE INC" value={leg.reference_entity||''} onChange={e=>set('reference_entity',e.target.value)}/></div>
      <div className="fg"><label>REFERENCE ISIN</label><input placeholder="US0378331005" value={leg.reference_isin||''} onChange={e=>set('reference_isin',e.target.value)}/></div>
    </div>
    <div className="row3">
      <div className="fg"><label>STRIKE SPREAD (bps)</label><input placeholder="120" value={leg.strike_spread||''} onChange={e=>set('strike_spread',e.target.value)}/></div>
      <div className="fg"><label>RECOVERY RATE</label><input placeholder="0.40" value={leg.recovery_rate||''} onChange={e=>set('recovery_rate',e.target.value)}/></div>
      <div className="fg"><label>SENIORITY</label><select value={leg.seniority||'SENIOR_UNSECURED'} onChange={e=>set('seniority',e.target.value)}>{SENIORITY.map(s=><option key={s}>{s}</option>)}</select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EXPIRY DATE</label><input type="date" value={leg.expiry_date||''} onChange={e=>set('expiry_date',e.target.value)}/></div>
      <div className="fg"><label>KNOCKOUT ON CREDIT EVENT</label><select value={String(leg.knockout||true)} onChange={e=>set('knockout',e.target.value==='true')}><option value="true">YES (standard)</option><option value="false">NO</option></select></div>
    </div>
    <div style={{fontSize:'0.62rem',color:'var(--text-dim)',lineHeight:1.6,padding:'0.3rem 0'}}>
      PAYER = buy protection (profit if spreads widen). RECEIVER = sell protection.
      Knockout: option expires worthless if credit event occurs before option expiry.
    </div>
    <OptionPremiumFields leg={leg} set={set}/>
  </>)
}

// ── Sprint 3F form components ────────────────────────────────

function ExerciseDateSched({leg,set}) {
  const rows = leg.exercise_dates || []
  return (
    <div>
      <div className="sec-lbl" style={{marginTop:'0.5rem'}}>EXERCISE DATE SCHEDULE</div>
      <div style={{fontSize:'0.6rem',color:'var(--text-dim)',marginBottom:'0.4rem',lineHeight:1.6}}>
        Add each Bermudan exercise date. Dates between first and last exercise at the selected frequency are auto-generated on pricing.
      </div>
      {rows.length > 0 && (
        <table className="sched-table">
          <thead><tr><th>EXERCISE DATE</th><th>NOTICE BY</th><th/></tr></thead>
          <tbody>
            {rows.map((r,i) => (
              <tr key={i}>
                <td><input type="date" value={r.date||''} onChange={e=>set('exercise_dates',rows.map((x,j)=>j===i?{...x,date:e.target.value}:x))}/></td>
                <td><input type="date" value={r.notice_by||''} onChange={e=>set('exercise_dates',rows.map((x,j)=>j===i?{...x,notice_by:e.target.value}:x))}/></td>
                <td><button className="btn-row-del" onClick={()=>set('exercise_dates',rows.filter((_,j)=>j!==i))}>&#10005;</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="btn-row-add" onClick={()=>set('exercise_dates',[...rows,{date:'',notice_by:''}])}>+ ADD EXERCISE DATE</button>
    </div>
  )
}

function ObservationSched({leg,set}) {
  const rows = leg.observation_schedule || []
  return (
    <div>
      <div className="sec-lbl" style={{marginTop:'0.5rem'}}>CUSTOM OBSERVATION SCHEDULE</div>
      <div style={{fontSize:'0.6rem',color:'var(--text-dim)',marginBottom:'0.4rem',lineHeight:1.6}}>
        Define custom observation dates and weights. Weights must sum to 1.0.
        Used for partial-period or non-standard averaging windows.
      </div>
      {rows.length > 0 && (
        <table className="sched-table">
          <thead><tr><th>OBSERVATION DATE</th><th>WEIGHT</th><th/></tr></thead>
          <tbody>
            {rows.map((r,i) => (
              <tr key={i}>
                <td><input type="date" value={r.date||''} onChange={e=>set('observation_schedule',rows.map((x,j)=>j===i?{...x,date:e.target.value}:x))}/></td>
                <td><input placeholder="1.0" value={r.weight||''} onChange={e=>set('observation_schedule',rows.map((x,j)=>j===i?{...x,weight:e.target.value}:x))}/></td>
                <td><button className="btn-row-del" onClick={()=>set('observation_schedule',rows.filter((_,j)=>j!==i))}>&#10005;</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="btn-row-add" onClick={()=>set('observation_schedule',[...rows,{date:'',weight:''}])}>+ ADD OBSERVATION DATE</button>
    </div>
  )
}

function BermudanSwaptionForm({leg,set}) {
  return (<>
    <div className="sec-lbl">BERMUDAN SWAPTION</div>
    <div className="row2">
      <div className="fg"><label>CURRENCY</label><select value={leg.currency} onChange={e=>set('currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>DIRECTION</label><select value={leg.direction} onChange={e=>set('direction',e.target.value)}><option>BUY</option><option>SELL</option></select></div>
    </div>
    <div className="fg"><label>NOTIONAL</label>
      <input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}
        onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
    </div>
    <div className="row2">
      <div className="fg"><label>OPTION TYPE</label><select value={leg.option_type} onChange={e=>set('option_type',e.target.value)}><option>PAYER</option><option>RECEIVER</option></select></div>
      <div className="fg"><label>SETTLEMENT</label><select value={leg.settlement_type} onChange={e=>set('settlement_type',e.target.value)}><option>PHYSICAL</option><option>CASH</option></select></div>
    </div>
    <div className="sec-lbl" style={{marginTop:'0.75rem'}}>EXERCISE SCHEDULE</div>
    <div className="row3">
      <div className="fg"><label>FIRST EXERCISE DATE</label><input type="date" value={leg.first_exercise_date||''} onChange={e=>set('first_exercise_date',e.target.value)}/></div>
      <div className="fg"><label>LAST EXERCISE DATE</label><input type="date" value={leg.last_exercise_date||''} onChange={e=>set('last_exercise_date',e.target.value)}/></div>
      <div className="fg"><label>EXERCISE FREQUENCY</label>
        <select value={leg.exercise_frequency||'SEMI-ANNUAL'} onChange={e=>set('exercise_frequency',e.target.value)}>
          {['MONTHLY','QUARTERLY','SEMI-ANNUAL','ANNUAL'].map(f=><option key={f}>{f}</option>)}
        </select>
      </div>
    </div>
    <div className="fg"><label>NOTICE DAYS (business days)</label><input placeholder="2" value={leg.notice_days||''} onChange={e=>set('notice_days',e.target.value)}/></div>
    <ExerciseDateSched leg={leg} set={set}/>
    <div className="sec-lbl">UNDERLYING SWAP</div>
    <div className="row3">
      <div className="fg"><label>UNDERLYING TENOR</label><input placeholder="5Y" value={leg.underlying_tenor||''} onChange={e=>set('underlying_tenor',e.target.value)}/></div>
      <div className="fg"><label>STRIKE (fixed rate)</label><input placeholder="0.0450" value={leg.underlying_fixed_rate||''} onChange={e=>set('underlying_fixed_rate',e.target.value)}/></div>
      <div className="fg"><label>FLOAT INDEX</label><select value={leg.underlying_index||'USD_SOFR'} onChange={e=>set('underlying_index',e.target.value)}>{INDICES.map(i=><option key={i}>{i}</option>)}</select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>FREQUENCY</label><select value={leg.underlying_frequency||'SEMI-ANNUAL'} onChange={e=>set('underlying_frequency',e.target.value)}>{FREQS.map(f=><option key={f}>{f}</option>)}</select></div>
      <div className="fg"><label>DAY COUNT</label><select value={leg.underlying_day_count||'ACT/360'} onChange={e=>set('underlying_day_count',e.target.value)}>{DAY_COUNTS.map(d=><option key={d}>{d}</option>)}</select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
    <OptionPremiumFields leg={leg} set={set}/>
  </>)
}

function CallableSwapOptionForm({leg,set}) {
  return (<>
    <div className="sec-lbl">CALLABLE / CANCELLABLE OPTION LEG</div>
    <div style={{fontSize:'0.62rem',color:'var(--text-dim)',lineHeight:1.6,padding:'0.3rem 0',marginBottom:'0.5rem'}}>
      This leg represents the embedded right to terminate the swap.
      The swap itself is defined by the FIXED and FLOAT legs above.
      Callable = fixed-rate payer right. Cancellable = fixed-rate receiver right.
      No separate premium — optionality is priced into the swap rate.
    </div>
    <div className="row2">
      <div className="fg"><label>CALLABLE PARTY</label>
        <select value={leg.callable_party||'FIXED_PAYER'} onChange={e=>set('callable_party',e.target.value)}>
          <option value="FIXED_PAYER">FIXED PAYER (callable)</option>
          <option value="FIXED_RECEIVER">FIXED RECEIVER (cancellable)</option>
          <option value="EITHER">EITHER PARTY</option>
        </select>
      </div>
      <div className="fg"><label>EXERCISE STYLE</label>
        <select value={leg.exercise_style||'BERMUDAN'} onChange={e=>set('exercise_style',e.target.value)}>
          <option>EUROPEAN</option>
          <option>BERMUDAN</option>
        </select>
      </div>
    </div>
    <div className="row3">
      <div className="fg"><label>FIRST CALL DATE</label><input type="date" value={leg.first_call_date||''} onChange={e=>set('first_call_date',e.target.value)}/></div>
      <div className="fg"><label>CALL FREQUENCY</label>
        <select value={leg.call_frequency||'ANNUAL'} onChange={e=>set('call_frequency',e.target.value)}>
          {['MONTHLY','QUARTERLY','SEMI-ANNUAL','ANNUAL'].map(f=><option key={f}>{f}</option>)}
        </select>
      </div>
      <div className="fg"><label>NOTICE DAYS</label><input placeholder="5" value={leg.notice_days||''} onChange={e=>set('notice_days',e.target.value)}/></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
  </>)
}

function CappedFloredFloatForm({leg,set}) {
  const embedded = leg.embedded_optionality || 'CAP'
  const showCap = embedded === 'CAP' || embedded === 'COLLAR'
  const showFloor = embedded === 'FLOOR' || embedded === 'COLLAR'
  return (<>
    <div className="sec-lbl">FLOAT LEG WITH EMBEDDED OPTIONALITY</div>
    <div style={{fontSize:'0.62rem',color:'var(--text-dim)',lineHeight:1.6,padding:'0.3rem 0',marginBottom:'0.5rem'}}>
      Standard float leg with embedded cap/floor/collar. The optionality premium is
      typically included in the fixed rate of the swap, not charged separately.
    </div>
    <div className="row2">
      <div className="fg"><label>CURRENCY</label><select value={leg.currency} onChange={e=>set('currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>DIRECTION</label><select value={leg.direction} onChange={e=>set('direction',e.target.value)}><option>PAY</option><option>RECEIVE</option></select></div>
    </div>
    <div className="fg"><label>NOTIONAL</label>
      <input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}
        onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
    </div>
    <div className="row3">
      <div className="fg"><label>FLOAT INDEX</label><select value={leg.index||'USD_SOFR'} onChange={e=>set('index',e.target.value)}>{INDICES.map(i=><option key={i}>{i}</option>)}</select></div>
      <div className="fg"><label>SPREAD (bps)</label><input placeholder="0" value={leg.spread||''} onChange={e=>set('spread',e.target.value)}/></div>
      <div className="fg"><label>LEVERAGE</label><input placeholder="1.0" value={leg.leverage||''} onChange={e=>set('leverage',e.target.value)}/></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EMBEDDED OPTIONALITY</label>
        <select value={embedded} onChange={e=>set('embedded_optionality',e.target.value)}>
          <option>CAP</option><option>FLOOR</option><option>COLLAR</option>
        </select>
      </div>
      <div className="fg"><label>PREMIUM INCLUDED IN RATE?</label>
        <select value={String(leg.cap_floor_premium_included!==false)} onChange={e=>set('cap_floor_premium_included',e.target.value==='true')}>
          <option value="true">YES (rolled into swap rate)</option>
          <option value="false">NO (separate premium)</option>
        </select>
      </div>
    </div>
    <div className="row2">
      {showCap&&<div className="fg"><label>CAP STRIKE</label><input placeholder="0.0600" value={leg.cap_strike||''} onChange={e=>set('cap_strike',e.target.value)}/></div>}
      {showFloor&&<div className="fg"><label>FLOOR STRIKE</label><input placeholder="0.0200" value={leg.floor_strike||''} onChange={e=>set('floor_strike',e.target.value)}/></div>}
    </div>
    <div className="row3">
      <div className="fg"><label>FREQUENCY</label><select value={leg.frequency||'QUARTERLY'} onChange={e=>set('frequency',e.target.value)}>{FREQS.map(f=><option key={f}>{f}</option>)}</select></div>
      <div className="fg"><label>DAY COUNT</label><select value={leg.day_count||'ACT/360'} onChange={e=>set('day_count',e.target.value)}>{DAY_COUNTS.map(d=><option key={d}>{d}</option>)}</select></div>
      <div className="fg"><label>BDC</label><select value={leg.bdc||'MODIFIED_FOLLOWING'} onChange={e=>set('bdc',e.target.value)}>{BDCS.map(b=><option key={b}>{b}</option>)}</select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EFFECTIVE DATE</label><input type="date" value={leg.effective_date||''} onChange={e=>set('effective_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
  </>)
}

function ExtendableForwardForm({leg,set}) {
  return (<>
    <div className="sec-lbl">EXTENDABLE FORWARD</div>
    <div style={{fontSize:'0.62rem',color:'var(--text-dim)',lineHeight:1.6,padding:'0.3rem 0',marginBottom:'0.5rem'}}>
      FX forward where one counterparty holds the right to extend maturity.
      Commonly used when the client wants protection against settlement timing uncertainty.
    </div>
    <div className="row2">
      <div className="fg"><label>CURRENCY (notional)</label><select value={leg.currency} onChange={e=>set('currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>DIRECTION</label><select value={leg.direction} onChange={e=>set('direction',e.target.value)}><option>BUY</option><option>SELL</option></select></div>
    </div>
    <div className="fg"><label>NOTIONAL</label>
      <input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}
        onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
    </div>
    <div className="row2">
      <div className="fg"><label>FX PAIR</label><input placeholder="EURUSD" value={leg.fx_pair||''} onChange={e=>set('fx_pair',e.target.value)}/></div>
      <div className="fg"><label>EXTENSION RIGHT</label>
        <select value={leg.extension_right||'BUYER'} onChange={e=>set('extension_right',e.target.value)}>
          <option>BUYER</option><option>SELLER</option><option>EITHER</option>
        </select>
      </div>
    </div>
    <div className="row2">
      <div className="fg"><label>ORIGINAL STRIKE</label><input placeholder="1.0850" value={leg.original_strike||''} onChange={e=>set('original_strike',e.target.value)}/></div>
      <div className="fg"><label>EXTENDED STRIKE</label><input placeholder="1.0900 (if different)" value={leg.extended_strike||''} onChange={e=>set('extended_strike',e.target.value)}/></div>
    </div>
    <div className="row3">
      <div className="fg"><label>ORIGINAL MATURITY</label><input type="date" value={leg.original_maturity||''} onChange={e=>set('original_maturity',e.target.value)}/></div>
      <div className="fg"><label>EXTENSION PERIOD</label><input placeholder="3M" value={leg.extension_period||''} onChange={e=>set('extension_period',e.target.value)}/></div>
      <div className="fg"><label>EXTENDED MATURITY</label><input type="date" value={leg.extended_maturity||''} onChange={e=>set('extended_maturity',e.target.value)}/></div>
    </div>
    <div className="row2">
      <div className="fg"><label>EXTENSION PREMIUM</label><input placeholder="0" value={leg.extension_premium||''} onChange={e=>set('extension_premium',e.target.value)}/></div>
      <div className="fg"><label>SETTLEMENT</label><select value={leg.settlement_type||'PHYSICAL'} onChange={e=>set('settlement_type',e.target.value)}><option>PHYSICAL</option><option>CASH</option></select></div>
    </div>
  </>)
}

function CommodityAsianOptionForm({leg,set}) {
  const avgType = leg.averaging_type || 'FULL_PERIOD'
  const isCustom = avgType === 'CUSTOM'
  const isPartial = avgType === 'PARTIAL_PERIOD'
  return (<>
    <div className="sec-lbl">COMMODITY ASIAN OPTION</div>
    <div className="row2">
      <div className="fg"><label>CURRENCY</label><select value={leg.currency} onChange={e=>set('currency',e.target.value)}>{CCYS.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="fg"><label>DIRECTION</label><select value={leg.direction} onChange={e=>set('direction',e.target.value)}><option>BUY</option><option>SELL</option></select></div>
    </div>
    <div className="fg"><label>NOTIONAL</label>
      <input placeholder="10,000,000" value={leg.notional} onChange={e=>set('notional',e.target.value)}
        onBlur={e=>{const r=parseFloat(e.target.value.replace(/,/g,''));if(!isNaN(r))set('notional',r.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:0}))}}/>
    </div>
    <div className="row2">
      <div className="fg"><label>OPTION TYPE</label><select value={leg.option_type||'CALL'} onChange={e=>set('option_type',e.target.value)}><option>CALL</option><option>PUT</option></select></div>
      <div className="fg"><label>COMMODITY</label><select value={leg.commodity_index||'WTI_CRUDE'} onChange={e=>set('commodity_index',e.target.value)}>{COMMODITY_INDICES.map(c=><option key={c}>{c}</option>)}</select></div>
    </div>
    <div className="row2">
      <div className="fg"><label>STRIKE</label><input placeholder="75.00" value={leg.strike||''} onChange={e=>set('strike',e.target.value)}/></div>
      <div className="fg"><label>QUANTITY</label><input placeholder="10,000" value={leg.quantity||''} onChange={e=>set('quantity',e.target.value)}/></div>
    </div>
    <div className="fg"><label>UNIT</label>
      <select value={leg.unit||'BBL'} onChange={e=>set('unit',e.target.value)}>
        {['BBL','MMBTU','MT','OZ','BU','LB'].map(u=><option key={u}>{u}</option>)}
      </select>
    </div>

    <div className="sec-lbl" style={{marginTop:'0.75rem'}}>AVERAGING WINDOW</div>
    <div style={{fontSize:'0.62rem',color:'var(--text-dim)',lineHeight:1.6,marginBottom:'0.4rem'}}>
      FULL PERIOD: average all fixings from effective to expiry.
      PARTIAL: custom observation window within the period (common in energy).
      BULLET: single observation at expiry (vanilla).
      CUSTOM: define exact dates and weights below.
    </div>
    <div className="row2">
      <div className="fg"><label>AVERAGING TYPE</label>
        <select value={avgType} onChange={e=>set('averaging_type',e.target.value)}>
          <option value="FULL_PERIOD">FULL PERIOD</option>
          <option value="PARTIAL_PERIOD">PARTIAL PERIOD</option>
          <option value="BULLET">BULLET (single obs)</option>
          <option value="CUSTOM">CUSTOM SCHEDULE</option>
        </select>
      </div>
      <div className="fg"><label>AVERAGING METHOD</label>
        <select value={leg.averaging_method||'ARITHMETIC'} onChange={e=>set('averaging_method',e.target.value)}>
          <option>ARITHMETIC</option><option>GEOMETRIC</option><option>HARMONIC</option>
        </select>
      </div>
    </div>
    {isPartial&&(
      <div className="row2">
        <div className="fg"><label>OBS WINDOW START</label><input type="date" value={leg.observation_start||''} onChange={e=>set('observation_start',e.target.value)}/></div>
        <div className="fg"><label>OBS WINDOW END</label><input type="date" value={leg.observation_end||''} onChange={e=>set('observation_end',e.target.value)}/></div>
      </div>
    )}
    {!isCustom&&!isPartial&&(
      <div className="fg"><label>OBSERVATION FREQUENCY</label>
        <select value={leg.averaging_frequency||'DAILY'} onChange={e=>set('averaging_frequency',e.target.value)}>
          <option>DAILY</option><option>WEEKLY</option><option>MONTHLY</option>
        </select>
      </div>
    )}
    {isCustom&&<ObservationSched leg={leg} set={set}/>}

    <div className="sec-lbl" style={{marginTop:'0.75rem'}}>SETTLEMENT</div>
    <div className="row2">
      <div className="fg"><label>SETTLEMENT TYPE</label>
        <select value={leg.settlement_type||'CASH'} onChange={e=>set('settlement_type',e.target.value)}>
          <option>CASH</option><option>PHYSICAL</option>
        </select>
      </div>
      <div className="fg"><label>SETTLEMENT STYLE</label>
        <select value={leg.settlement_style||'BULLET'} onChange={e=>set('settlement_style',e.target.value)}>
          <option value="BULLET">BULLET (at maturity)</option>
          <option value="STAGED">STAGED (each period)</option>
        </select>
      </div>
    </div>

    <div className="row2">
      <div className="fg"><label>EXPIRY DATE</label><input type="date" value={leg.expiry_date||''} onChange={e=>set('expiry_date',e.target.value)}/></div>
      <div className="fg"><label>MATURITY DATE</label><input type="date" value={leg.maturity_date||''} onChange={e=>set('maturity_date',e.target.value)}/></div>
    </div>
    <OptionPremiumFields leg={leg} set={set}/>
  </>)
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
    case 'IR_SWAPTION':      return <IrSwaptionForm leg={leg} set={set}/>
    case 'CAP_FLOOR':          return <CapFloorForm leg={leg} set={set}/>
    case 'FX_OPTION':          return <FxOptionForm leg={leg} set={set}/>
    case 'EQUITY_OPTION':      return <EquityOptionForm leg={leg} set={set}/>
    case 'COMMODITY_OPTION':   return <CommodityOptionForm leg={leg} set={set}/>
    case 'CDS_OPTION':           return <CdsOptionForm leg={leg} set={set}/>
    case 'BERMUDAN_SWAPTION':    return <BermudanSwaptionForm leg={leg} set={set}/>
    case 'CALLABLE_SWAP_OPTION': return <CallableSwapOptionForm leg={leg} set={set}/>
    case 'CAPPED_FLOORED_FLOAT': return <CappedFloredFloatForm leg={leg} set={set}/>
    case 'EXTENDABLE_FORWARD':   return <ExtendableForwardForm leg={leg} set={set}/>
    case 'COMMODITY_ASIAN_OPTION': return <CommodityAsianOptionForm leg={leg} set={set}/>
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

// ── Sprint 4A: structure → template mapping ─────────────────────────────────
// instrument_type stays IR_SWAP for all 10 variants.
// terms.structure and trades.structure store the variant name.
const STRUCTURE_TO_TEMPLATE = {
  VANILLA:       () => TEMPLATES.IR_SWAP(),
  OIS:           () => TEMPLATES.OIS_SWAP      ? TEMPLATES.OIS_SWAP()      : TEMPLATES.IR_SWAP(),
  BASIS:         () => TEMPLATES.BASIS_SWAP    ? TEMPLATES.BASIS_SWAP()    : TEMPLATES.IR_SWAP(),
  XCCY:          () => TEMPLATES.XCCY_SWAP     ? TEMPLATES.XCCY_SWAP()     : TEMPLATES.IR_SWAP(),
  ZERO_COUPON:   () => TEMPLATES.ZERO_COUPON_SWAP  ? TEMPLATES.ZERO_COUPON_SWAP()  : TEMPLATES.IR_SWAP(),
  STEP_UP:       () => TEMPLATES.STEP_UP_SWAP  ? TEMPLATES.STEP_UP_SWAP()  : TEMPLATES.IR_SWAP(),
  INFLATION_ZC:  () => TEMPLATES.INFLATION_SWAP? TEMPLATES.INFLATION_SWAP(): TEMPLATES.IR_SWAP(),
  INFLATION_YOY: () => TEMPLATES.INFLATION_SWAP? TEMPLATES.INFLATION_SWAP(): TEMPLATES.IR_SWAP(),
  CMS:           () => TEMPLATES.CMS_SWAP      ? TEMPLATES.CMS_SWAP()      : TEMPLATES.IR_SWAP(),
  CMS_SPREAD:    () => TEMPLATES.CMS_SPREAD_SWAP? TEMPLATES.CMS_SPREAD_SWAP(): TEMPLATES.IR_SWAP(),
}

export default function NewTradeWorkspace({tab}) {
  const today=new Date().toISOString().substring(0,10)
  const {addTrade}=useTradesStore()
  const {closeTab,promoteTrade,setDirty}=useTabStore()
  const [ac,setAc]=useState('RATES')
  const [instrument,setInstrument]=useState('IR_SWAP')
  const [selectedStructure,setSelectedStructure]=useState('VANILLA')
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

  const changeAc=(a)=>{
    setAc(a)
    const grp = INSTRUMENT_GROUPS[a]
    const it  = grp ? grp[0].items[0] : INSTRUMENTS[a][0]
    setInstrument(it)
    if(it!=='IR_SWAP') setSelectedStructure('VANILLA')
    setLegs((TEMPLATES[it]||TEMPLATES.IR_SWAP)())
  }
  const changeIT=(it)=>{setInstrument(it);if(it!=='IR_SWAP')setSelectedStructure('VANILLA');setLegs((TEMPLATES[it]||TEMPLATES.IR_SWAP)());setDirty(tab.id,true)}

  // Sprint 4E: indicative pricer state
  const [indRate, setIndRate] = useState('5.25')
  const [indResult, setIndResult] = useState(null)
  const [indBusy, setIndBusy] = useState(false)

  const runIndicative = useCallback(() => {
    setIndBusy(true)
    const r = parseFloat(indRate) / 100
    if (isNaN(r) || r <= 0 || !effectiveDate || !maturityDate) {
      setIndResult(null); setIndBusy(false); return
    }
    const today = new Date(effectiveDate)
    const FM = {MONTHLY:1,QUARTERLY:3,'SEMI-ANNUAL':6,ANNUAL:12}
    let totalNPV = 0
    const legPVs = []
    legs.forEach((leg, li) => {
      const N = parseFloat(String(leg.notional||'').replace(/,/g,'')) || 0
      const m = FM[leg.frequency]
      if (!m || !N) { legPVs.push({label:leg.label||('L'+(li+1)), direction:leg.direction, pv:0}); return }
      const sign = leg.direction === 'PAY' ? -1 : 1
      let legPV = 0
      let d = new Date(effectiveDate); d.setMonth(d.getMonth() + m)
      const matD = new Date(maturityDate)
      while (d <= matD) {
        const t = Math.max((d - today) / (365.25 * 86400000), 0)
        const df = Math.exp(-r * t)
        const dcf = m / 12
        const rate = leg.leg_type === 'FIXED' ? (parseFloat(leg.fixed_rate) || 0) : r
        legPV += N * rate * dcf * df
        d = new Date(d); d.setMonth(d.getMonth() + m)
      }
      legPV *= sign
      totalNPV += legPV
      legPVs.push({label: leg.label || ('L' + (li+1)), direction: leg.direction, pv: legPV})
    })
    // PV01: bump 1bp
    let npv1bp = 0
    const r1 = r + 0.0001
    legs.forEach((leg) => {
      const N = parseFloat(String(leg.notional||'').replace(/,/g,'')) || 0
      const m = FM[leg.frequency]
      if (!m || !N) return
      const sign = leg.direction === 'PAY' ? -1 : 1
      let legPV = 0
      let d = new Date(effectiveDate); d.setMonth(d.getMonth() + m)
      const matD = new Date(maturityDate)
      while (d <= matD) {
        const t = Math.max((d - today) / (365.25 * 86400000), 0)
        const df = Math.exp(-r1 * t)
        const dcf = m / 12
        const rate = leg.leg_type === 'FIXED' ? (parseFloat(leg.fixed_rate) || 0) : r1
        legPV += N * rate * dcf * df
        d = new Date(d); d.setMonth(d.getMonth() + m)
      }
      npv1bp += sign * legPV
    })
    const pv01 = npv1bp - totalNPV
    setIndResult({npv: totalNPV, pv01, legs: legPVs})
    setIndBusy(false)
  }, [legs, effectiveDate, maturityDate, indRate])

  const cfs=genCFs(legs,effectiveDate,maturityDate)

  const submit=async()=>{
    if(!tradeRef) return setErr('Trade ref required')
    if(!maturityDate) return setErr('Maturity date required')
    setErr('');setBusy(true)
    const firstLeg=legs[0]
    const notional=firstLeg?parseFloat(String(firstLeg.notional||'').replace(/,/g,'').replace(/s/g,''))||null:null
    const terms={
      structure: instrument==='IR_SWAP' ? selectedStructure : null,
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
    const payload={trade_ref:tradeRef,status:'PENDING',store,asset_class:ac,instrument_type:instrument,structure:instrument==='IR_SWAP'?selectedStructure:null,notional,notional_ccy:notionalCcy,trade_date:tradeDate,effective_date:effectiveDate,maturity_date:maturityDate,terms}
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
              {INSTRUMENT_GROUPS[ac]
                ? INSTRUMENT_GROUPS[ac].map(g=>(
                    <optgroup key={g.group} label={`── ${g.group} ──`}>
                      {g.items.map(it=><option key={it} value={it}>{INSTR_LABEL[it]||it.replace(/_/g,' ')}</option>)}
                    </optgroup>
                  ))
                : (INSTRUMENTS[ac]||[]).map(it=><option key={it} value={it}>{INSTR_LABEL[it]||it.replace(/_/g,' ')}</option>)
              }
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
            {/* Sprint 4A: STRUCTURE selector — IR_SWAP only */}
        {instrument === 'IR_SWAP' && (
          <IrSwapStructureSelector
            value={selectedStructure}
            onChange={(newStructure) => {
              setSelectedStructure(newStructure);
              const tplLegs = (STRUCTURE_TO_TEMPLATE[newStructure] || STRUCTURE_TO_TEMPLATE.VANILLA)();
              // Inherit current dates, ccy, notional into new legs
              setLegs(tplLegs.map(l => ({
                ...l,
                currency: l.currency || notionalCcy || 'USD',
                effective_date: effectiveDate || '',
                maturity_date: maturityDate || '',
              })));
              setDirty(tab.id, true);
            }}
          />
        )}
        {/* Sprint 4C: IR OPTIONS quick-switch grid */}
        {IR_OPTIONS_SET.has(instrument) && (
          <div className="structure-selector" style={{marginBottom:'14px'}}>
            <label className="structure-selector__label">IR OPTIONS</label>
            <div className="structure-selector__grid" style={{gridTemplateColumns:'repeat(5,1fr)'}}>
              {IR_OPTIONS_ITEMS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`structure-btn${instrument === opt.value ? ' structure-btn--active' : ''}`}
                  onClick={() => changeIT(opt.value)}
                  title={opt.desc}
                >
                  <span className="structure-btn__label">{opt.label}</span>
                  <span className="structure-btn__desc">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}
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

          {/* ── Indicative Pricer ── */}
          <div className="ntw-section-hdr">INDICATIVE PRICER</div>
          <div className="ntw-pricer-zone">
            <div className="ntw-curve-row">
              <span className="ntw-curve-id">FLAT RATE</span>
              <input
                className="ntw-curve-input"
                type="text"
                inputMode="decimal"
                value={indRate}
                onChange={e => setIndRate(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && runIndicative()}
              />
              <span className="ntw-curve-unit">%</span>
              <button className="ntw-run-btn" onClick={runIndicative} disabled={indBusy}>
                {indBusy ? '...' : '▶ RUN'}
              </button>
            </div>

            {!indResult && (
              <div className="ntw-pricer-empty">Enter rate and click RUN to see indicative NPV</div>
            )}

            {indResult && (() => {
              const npv = indResult.npv
              const pv01 = indResult.pv01
              const npvColor = npv >= 0 ? 'var(--accent)' : 'var(--red)'
              const fmtAmt = v => (v >= 0 ? '+' : '-') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US')
              return (
                <>
                  <div className="ntw-metrics">
                    <div className="ntw-metric">
                      <div className="ntw-metric-label">NPV</div>
                      <div className="ntw-metric-value" style={{color:npvColor}}>{fmtAmt(npv)}</div>
                      <div className="ntw-metric-sub">indicative</div>
                    </div>
                    <div className="ntw-metric">
                      <div className="ntw-metric-label">PV01</div>
                      <div className="ntw-metric-value" style={{color:'var(--blue)'}}>{fmtAmt(pv01)}</div>
                      <div className="ntw-metric-sub">+1bp parallel</div>
                    </div>
                  </div>
                  <div className="ntw-leg-pvs">
                    {indResult.legs.map((lp, li) => (
                      <div key={li} className="ntw-leg-pv-row">
                        <span className="ntw-leg-pv-ref">{lp.label}</span>
                        <span style={{color: lp.pv >= 0 ? 'var(--accent)' : 'var(--red)', fontWeight:700}}>{fmtAmt(lp.pv)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )
            })()}
          </div>

          {/* ── Cashflow Preview ── */}
          <div className="ntw-section-hdr">
            CASHFLOW PREVIEW{cfs.length > 0 ? ` — ${cfs.length} flows` : ''}
          </div>
          <div className="cf-preview">
            {cfs.length === 0
              ? <div style={{padding:'3rem',textAlign:'center',color:'var(--text-dim)',fontSize:'0.68rem',letterSpacing:'0.1em'}}>SET EFFECTIVE AND MATURITY DATES TO PREVIEW</div>
              : <table className="cf-table">
                  <thead><tr><th>DATE</th><th>LEG</th><th>DIR</th><th>TYPE</th><th>CCY</th><th style={{textAlign:'right'}}>EST. AMOUNT</th></tr></thead>
                  <tbody>
                    {cfs.map((cf, i) => (
                      <tr key={i}>
                        <td>{cf.date}</td>
                        <td style={{color:'var(--text-dim)',fontSize:'0.62rem'}}>{cf.label}</td>
                        <td><span style={{color:cf.dir==='PAY'?'var(--red)':'var(--accent)',fontWeight:700,fontSize:'0.62rem'}}>{cf.dir}</span></td>
                        <td style={{color:'var(--text-dim)',fontSize:'0.62rem'}}>{cf.type}</td>
                        <td style={{color:'var(--text-dim)'}}>{cf.ccy}</td>
                        <td style={{textAlign:'right',fontFamily:'var(--mono)',fontSize:'0.68rem',color:cf.dir==='PAY'?'var(--red)':'var(--accent)',opacity:0.75}}>
                          {cf.amount
                            ? (cf.dir==='PAY'?'-':'+')+Math.round(cf.amount).toLocaleString('en-US')
                            : <span style={{color:'var(--text-dim)'}}>—</span>}
                          <span style={{fontSize:'0.55rem',color:'var(--text-dim)',marginLeft:3}}>est</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </div>
          <div className="ntw-cf-footer">Amounts are indicative. Confirmed at booking via pricing engine.</div>
        </div>
      </div>
    </div>
  )
}


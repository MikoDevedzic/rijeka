// trade-window/xva-shared.js
// ────────────────────────────────────────────────────────────────────────────────────
// The pure parts of the XVA tab that rates (blotter/XVATab.jsx) and the FX / digital-asset
// panel (FxXvaPanel.jsx) share: the VA definitions and tooltips, the styles, the money
// format, the spread-curve payload, the VA strip rows (bp on rate for rates, bp of notional
// for FX), the on-chain comparison rows and the FX CSA body. No React but for one hook, the
// tab's view (useXvaView: simple or advanced); the components that render these live in
// xva-shared.jsx. Tested in xva-shared.test.js.
// ────────────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { useModulesStore } from '../../store/useModulesStore'
import { T } from '../../theme'

export const TENORS_6 = ['1Y', '2Y', '3Y', '5Y', '7Y', '10Y']
export const TENOR_YEARS = { '1Y': 1, '2Y': 2, '3Y': 3, '5Y': 5, '7Y': 7, '10Y': 10 }

// The desk's default term structures, the same on every product.
export const SPREAD_DEFAULTS = {
  cp:  { '1Y': '72', '2Y': '78', '3Y': '83', '5Y': '91', '7Y': '97', '10Y': '105' },
  own: { '1Y': '38', '2Y': '41', '3Y': '44', '5Y': '48', '7Y': '51', '10Y': '55' },
  ftp: { '1Y': '42', '2Y': '46', '3Y': '50', '5Y': '55', '7Y': '58', '10Y': '62' },
}

export const VA_DEFS = {
  npv:    { label:'NPV',    color:T.textHi, desc:'Present value at mid-market. Positive = asset to you. This is the base price before any XVA adjustments.', curve:'none' },
  cva:    { label:'CVA',    color:T.down, desc:'Credit Valuation Adjustment = -LGD x Sum[ EE(t) x (PD_cp(t) - PD_cp(t-dt)) x DF(t) ]. Cost of counterparty default risk over the EE profile. Always negative.', curve:'EE' },
  dva:    { label:'DVA',    color:T.blue, desc:'Debt Valuation Adjustment = +LGD x Sum[ |ENE(t)| x (PD_own(t) - PD_own(t-dt)) x DF(t) ]. Benefit from your own default risk. Always positive. Excluded from regulatory capital.', curve:'ENE' },
  fva:    { label:'FVA',    color:T.down, desc:'Funding Valuation Adjustment = -(FTP/10000) x Sum[ EE(t) x dt x DF(t) ]. Cost of funding positive exposure when no CSA. Always negative.', curve:'EE' },
  fba:    { label:'FBA',    color:T.blue, desc:'Funding Benefit Adjustment = +(FTP x ratio/10000) x Sum[ |ENE(t)| x dt x DF(t) ]. Benefit when counterparty funds your negative MTM. FBA/FTP ratio typically 0.5-0.7.', curve:'ENE' },
  kva:    { label:'KVA',    color:T.down, desc:'Capital Valuation Adjustment = -(Hurdle/100) x Sum[ Capital(t) x dt x DF(t) ]. Capital(t) = SA-CCR EAD x 8% RWA. Often the largest VA for vanilla IRS.', curve:'EE' },
  mva:    { label:'MVA',    color:T.amber, desc:'Margin Valuation Adjustment = -Sum[ IM(t) x max(FTP(t) - pickup, 0) x dt x DF(t) ]. Cost of funding initial margin, less what the asset it is posted in earns over OIS. IM is derived from the ISDA SIMM IR delta risk weight applied to the trade IR01, and amortises with residual maturity.', curve:'none' },
  colva:  { label:'ColVA',  color:T.amber, desc:'Collateral Valuation Adjustment = Sum[ (VM posted(t) x s_post + VM held(t) x s_recv) x dt x DF(t) ]: the carry of the variation margin against cash at OIS. s = what the asset the margin is held in earns over OIS (a Treasury bill at OIS: 0; a stablecoin earning nothing: minus OIS). Cash on both sides: zero. Positive = benefit.', curve:'none' },
  all_in: { label:'ALL-IN', color:T.textHi, desc:'NPV + CVA + DVA + FVA + FBA + KVA + MVA + ColVA. Full economic cost of the trade. Client pays ALL-IN rate; desk runs NPV.', curve:'none' },
}
export const VA_INFO = VA_DEFS
export const VA_KEYS = Object.keys(VA_DEFS)

export const TIPS = {
  a: { title: 'Mean reversion  a',
    body: 'Speed at which rates snap back toward the long-run level.\nHW1F SDE: dr = (theta - a x r) dt + sigma x dW\n\nLow a (0.01-0.02): rates drift slowly, wide exposure profiles, larger CVA/FVA.\nHigh a (0.10+): rates revert fast, narrow long-dated exposure.\n\nCALIBRATION: L-BFGS-B minimises RMSE between hw1f_vol(a, sigma, T_e, 5Y) and market ATM vol across the 5Y-tenor column. a controls the slope of the vol term structure.' },
  sigma: { title: 'Vol sigma (bp normal)',
    body: 'Instantaneous short-rate vol in bp/year. Sets the level of all exposure profiles.\n\nFORMULA: sigma_n = sigma x w x sqrt(V(T_e) / T_e)\nwhere w = Sum[ alpha_i x P(0,T_i) x B*(T_e,T_i) ] / A(0)\nV(T_e) = (1 - exp(-2aT_e)) / (2a)\n\nWith a=0.01 and 5Y vols ~85bp, calibrated sigma ~32bp. Lower than quoted vol because the swap rate averages future short rates.\n\nHigher sigma -> wider EE/ENE -> higher CVA, DVA, FVA, FBA, KVA.' },
  theta: { title: 'Long-run rate theta',
    body: 'Drift anchor. Each Monte Carlo step:\nr(t+dt) = r(t) x exp(-a x dt) + theta x (1 - exp(-a x dt)) + sigma x sqrt((1-exp(-2a x dt))/(2a)) x Z\n\nTaken from the 5Y SOFR OIS swap rate on your bootstrapped curve. A full Hull-White calibration uses time-dependent theta(t) to exactly reprice today\'s yield curve. Flat approximation is adequate for XVA.' },
  paths: { title: 'Monte Carlo paths',
    body: 'Number of simulated short-rate scenarios, monthly time steps.\n\nEE(t) = (1/N) x Sum[ max(NPV_i(t), 0) ] - converges at ~500 paths\nENE(t) = (1/N) x Sum[ min(NPV_i(t), 0) ] - converges at ~500 paths\nPFE 95th percentile - needs ~2,000 for stable tail\nXVA integrals - converge at ~1,000 paths\n\nSIMULATE uses seed 42, so it repeats exactly; RE-ROLL draws a fresh seed and the numbers move within the Monte Carlo error.' },
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
  imUsd: { title: 'Initial margin (USD)',
    body: 'Initial margin, each way, in the ticket\'s currency (the quote currency of a pair). Type the amount (250000, 250k or 0.25m): it is held for the life of the trade and MVA is its funding cost, −Σ IM × max(FTP − pickup, 0) × dt × DF.\n\nBlank = the engine\'s own estimate from the simulated paths: at each date the 99th percentile rise (what we call) and fall (what we post) of the value over the margin period, about its mean. It is at today\'s volatility, not a stressed one, so it can read lower than a regulatory figure.\n\nRijeka does not compute ISDA SIMM. SIMM is ISDA\'s licensed methodology: a firm with a licence enters its own SIMM figure here.' },
  settlement: { title: 'Settlement / CSA',
    body: 'How the trade is margined. Every VA is computed on the RESIDUAL exposure after collateral:\n\nE+(t) = max(V(t) − VM(t) − IM_recv, 0)\n\nUNCOLLATERALISED — no variation margin. Full MtM at risk. IM may still be posted (legacy MVA).\n\nBILATERAL — daily VM under a CSA, thresholds and MTA apply, 10 business-day margin period of risk (BCBS-IOSCO floor for non-cleared). Initial margin exchanged.\n\nON-CHAIN — atomic settlement: continuous VM, zero threshold and MTA, 5bd MPoR (the cleared floor). Half the margin period: the initial margin estimate, and MVA with it, fall by about sqrt(5/10) = 0.707; SA-CCR margined maturity factor 1.5·sqrt(MPoR/250) cuts KVA by the same factor.\n\nWhat the margin is held in is the COLLATERAL block below: it sets the carry in ColVA and the pickup in MVA.' },
  collateral: { title: 'Collateral: what the margin is held in',
    body: 'The instrument the variation margin is posted in and received in, from the firm\'s list (Configurations → Collateral Instruments). The counterparty\'s own schedule is the default when a counterparty is selected.\n\nEach instrument carries a yield source; what the engine uses is its carry over the OIS the discounting assumes: a Treasury bill at OIS is 0 bp, a tokenised fund share at OIS less its expense ratio is about −10 bp, a stablecoin that pays its holder nothing is minus the OIS rate. The posted side\'s carry is the IM pickup in MVA too.\n\nColVA = Σ (VM posted × s_post + VM held × s_recv) × dt × DF. Cash on both sides is zero, so a cash ticket reads exactly as before.' },
  mpor: { title: 'Margin period of risk (bd)',
    body: 'Business days between the last collateral call that would be honoured and close-out. VM held at t is what was called against V(t − MPoR); the exposure over that window is the residual.\n\nV(t − MPoR) sits between monthly grid points and is sampled from the Brownian bridge, which preserves the variance of the margin-period move.\n\nSIMM IM scales with sqrt(MPoR / 10). Bilateral floor 10bd; cleared / on-chain floor 5bd.' },
  threshold: { title: 'Threshold ($)',
    body: 'Exposure below which the counterparty posts no collateral. Uncollateralised up to this amount — adds straight back to EE and CVA. Zero under standard on-chain terms.' },
  mtaTip: { title: 'Minimum transfer amount ($)',
    body: 'Collateral calls smaller than this are not made. Modelled as: no VM held while |call| < MTA. Also enters SA-CCR replacement cost as TH + MTA − NICA.' },
  imYield: { title: 'IM yield pickup override (bp)',
    body: 'Yield earned on posted initial margin over OIS, netted against its funding cost: MVA = −Σ IM(t) × max(FTP − pickup, 0) × dt × DF(t).\n\nBlank: the pickup is the carry of the instrument chosen in the COLLATERAL block (the posted side). Type a number to override it for a what-if.' },
  compare: { title: 'Compare on-chain',
    body: 'Runs a second simulation on the SAME paths under the ON-CHAIN preset (continuous VM, zero threshold and MTA, 5bd MPoR) with the same collateral, and shows each VA side by side with the current settlement, with the saving in money and in bp of notional (upfront, and running over the trade\'s annuity). Same seed, so the difference is purely the terms. On by default; the row disappears when the ticket itself is on chain.' },
  capModel: { title: 'Capital model',
    body: 'Regulatory CCR capital framework for KVA.\n\nSA-CCR (current standard): EAD = 1.4 x (RC + AddOn). RC = max(NPV,0). AddOn = Notional x SF x MF. SF(IRS)=0.5%. MF=sqrt(min(M,1)).\n\nCEM (legacy): EAD = max(NPV,0) + Notional x addon%. Addon: 0.5% (1-5Y IRS). Simpler, less risk-sensitive.\n\nIMM: full MC EPE with supervisory approval — on the roadmap.' },
  // FX and digital assets: the forward / option model block
  fxVol: { title: 'Vol % (override)',
    body: 'Annualised lognormal vol of the spot paths behind the exposure profile.\n\nBlank = the pair\'s own vol surface: ATM at the forward\'s tenor for a forward, the option\'s expiry and strike for an option. A pair without a surface falls back to the demo default and the badge says so.\n\nType a number to hold one vol along the whole path (a desk override); the badge then reads DESK VOL.' },
  fxVolMode: { title: 'Vol mode',
    body: 'SURFACE · TERM + SMILE — the paths step with the surface\'s ATM term structure; an option is valued at each date at the forward vol for its remaining life and the smile at its path\'s moneyness (sticky-delta).\n\nFLAT VOL — one vol, today\'s at the strike and expiry, held along the whole path (the Excel replication\'s case).' },
  fxSurface: { title: 'Surface proof',
    body: 'Where the vol came from on the last run: the surface (or the demo default or a desk input), the mode, the vol used and, in SURFACE mode on a forward, the step vols the paths were drawn with.' },
  fxPaths: { title: 'Monte Carlo paths',
    body: 'Number of simulated spot scenarios, monthly time steps to settlement.\n\nEE(t) = (1/N) x Sum[ max(V_i(t), 0) ], ENE(t) likewise on the negative side; PFE 95th percentile needs ~2,000 paths for a stable tail.\n\nSIMULATE uses seed 42, so it repeats exactly; RE-ROLL draws a fresh seed and the numbers move within the Monte Carlo error.' },
}

// ── styles every XVA tab uses ────────────────────────────────────────────────────
export const INP = { background:'var(--bg)', border:'1px solid var(--border)', borderRadius:'var(--r-1)',
  color:'var(--text-hi)', fontFamily:'var(--mono)', fontSize:'0.8125rem',
  padding:'4px 7px', outline:'none', width:'100%' }
// a label that explains itself on hover: a dotted rule under it, in the text colour (brass is not a label colour)
export const LBL = { fontSize:'0.78rem', color:'var(--text-dim)', letterSpacing:'0.02em',
  fontFamily:'var(--sans)', marginBottom:'2px',
  borderBottom:'1px dotted var(--border-glow)', cursor:'help', paddingBottom:'1px' }
export const SEC_HDR = { fontSize: '11.5px', fontWeight:600, letterSpacing:'0.1em', color:'var(--text-hi)',
  fontFamily:'var(--sans)', lineHeight:1.2,
  marginTop:'18px', marginBottom:'10px' }
export const LEFT_COL = { width:'320px', minWidth:'320px', borderRight:'1px solid var(--border)',
  overflowY:'auto', padding:'12px', display:'flex', flexDirection:'column' }

// The XVA panels' layout: nothing scrolls inside the tab. The left column holds what is chosen before a run
// (the model, the paths, the settlement) and is as tall as that; the chart and the results are on the right,
// and under the results, in the whole view, the credit curves and the assumptions the run was made on. The
// window is the only thing that scrolls, and only when the screen is shorter than the tab.
export const XVA_ROW = { position:'relative', display:'flex', alignItems:'stretch', overflow:'hidden', background:'var(--bg)' }
export const XVA_LEFT = { ...LEFT_COL, overflowY:'visible', flex:'0 0 auto' }
export const XVA_RIGHT = { flex:1, minWidth:0, display:'flex', flexDirection:'column', overflow:'hidden' }
export const XVA_BAND = { display:'grid', gridTemplateColumns:'minmax(0, 1.25fr) minmax(0, 1fr)', columnGap:'32px', padding:'0 16px 14px', borderTop:'1px solid var(--border)', background:'var(--bg)' }
// The size every money figure in the table is set at: the largest at which the longest of them fits its column
// (xva-shared.jsx; a cell is about 76px at the window's own width; DM Mono advances 0.6em). Both rows are sized from the same
// figures, so the run and the on-chain row are always alike.
export const moneySize = (texts) => { const n = Math.max(0, ...texts.map(t => String(t ?? '').length)); return n <= 9 ? 13.5 : n <= 10 ? 12.5 : n <= 11 ? 11.5 : 11 }

export const XVA_CHART_HEIGHT = 'clamp(220px, 27vh, 440px)'

export const SETTLEMENT_PRESETS = [
  ['UNCOLLATERALISED', 'NO CSA', 'var(--text-hi)'],
  ['BILATERAL', 'BILATERAL', 'var(--text-hi)'],
  ['ON_CHAIN', 'ON-CHAIN', 'var(--accent)'],            // on chain is the sealed thing: the one brass choice
]
export const SETTLEMENT_DESC = {
  UNCOLLATERALISED: 'No variation margin — full MtM at risk.',
  BILATERAL: 'Daily VM under CSA · 10bd MPoR floor · initial margin exchanged.',
  ON_CHAIN: 'Atomic settlement · continuous VM · zero TH/MTA · 5bd MPoR · initial margin over half the period.',
}

// One note for every ticket: where the margin comes from, and that it is not SIMM.
export const IM_NOTE = 'MVA = −Σ IM(t) × FTP(t) × dt × DF(t). IM is the amount typed (held for the life), else the engine\'s estimate: the 99th percentile move of the value over the margin period. Rijeka does not compute ISDA SIMM, which is licensed: a firm with a licence enters its own figure.'
export const RATES_MVA_NOTE = IM_NOTE
export const FX_MVA_NOTE = IM_NOTE

// ── helpers ──────────────────────────────────────────────────────────────────────
const SYM = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }

// Signed, rounded, with the currency's symbol, exactly as the rates tab's fmtDollar:
// +$1,234 · -$1,234 · +$0 · — for nothing. Other currencies prefix their code.
export function fmtMoney(v, ccy = 'USD') {
  if (v == null || isNaN(v)) return '—'
  const n = Math.round(v)                      // the sign is the rounded figure's: -0.4 is +$0, never -$0
  return (n < 0 ? '-' : '+') + (SYM[ccy] ?? (ccy + ' ')) + Math.abs(n).toLocaleString('en-US')
}
export function fmtDollar(v) { return fmtMoney(v, 'USD') }

// Where the floating tooltip goes: to the right of the hovered label.
export function tipAt(e) {
  const r = e.currentTarget.getBoundingClientRect()
  return { x: r.right + 10, y: r.top }
}

export function numOrNull(v) {
  if (v == null || v === '') return null
  const n = parseFloat(String(v).replace(/,/g, ''))
  return isNaN(n) ? null : n
}

// The tenor grid's values as the engine's curve: [{t, spread_bp}] on 1Y…10Y; a blank cell is 0.
export function toCurve(obj) {
  return Object.entries(TENOR_YEARS).map(([k, t]) => ({ t, spread_bp: parseFloat(obj?.[k]) || 0 }))
}

// One number for a curve: the 5Y pillar, else the first filled cell, else 0.
export function flatSpread(obj) {
  const five = parseFloat(obj?.['5Y'])
  if (isFinite(five)) return five
  for (const k of TENORS_6) { const v = parseFloat(obj?.[k]); if (isFinite(v)) return v }
  return 0
}

// The spread grid's initial state: the desk defaults, one copy per tab.
export function defaultSpreads() {
  return { cp: { ...SPREAD_DEFAULTS.cp }, own: { ...SPREAD_DEFAULTS.own }, ftp: { ...SPREAD_DEFAULTS.ftp } }
}

// The request fields the spread grid produces, the same on every route: the three
// term structures and their flat values (the engine reads the curve first).
export function spreadCurvePayload(cp, own, ftp) {
  return {
    cp_cds_curve:  toCurve(cp),
    own_cds_curve: toCurve(own),
    ftp_curve:     toCurve(ftp),
    cp_cds_bp:  flatSpread(cp),
    own_cds_bp: flatSpread(own),
    ftp_bp:     flatSpread(ftp),
  }
}

// The initial margin the desk typed, in the ticket's currency, or null: "250000", "250,000", "250k", "0.25m". A
// comma is a thousands separator only (groups of three): "1,5m" is not an amount, so a decimal comma is never
// read as ten times the figure. Blank is null too: imUsdProblem tells a blank from an entry that could not be read.
export function imUsdValue(s) {
  const t = String(s ?? '').trim()
  const m = t.match(/^(\d{1,3}(?:,\d{3})+|\d+)?(\.\d+)?\s*([kKmM]?)$/)
  if (!m || (m[1] == null && m[2] == null)) return null
  const v = parseFloat((m[1] || '0').replace(/,/g, '') + (m[2] || '')) * (m[3] === '' ? 1 : /k/i.test(m[3]) ? 1e3 : 1e6)
  return Number.isFinite(v) ? v : null
}
// What is wrong with the margin box, or null: something typed that is not an amount. A run does not start on it
// (the engine's estimate under a box that still shows the entry would pass for the entry).
export function imUsdProblem(s) {
  const t = String(s ?? '').trim()
  return t !== '' && imUsdValue(t) == null ? 'Initial margin: type an amount such as 250000, 250,000, 250k or 0.25m, or leave it blank for the engine\'s estimate' : null
}

// The Basel group a digital asset's capital add-on is run under ('' = the engine's default for the asset).
export const CRYPTO_GROUPS = Object.freeze([
  ['', 'default for the asset'], ['2a', 'Group 2a · SA-CCR, 32 %'], ['2b', 'Group 2b · 50 % of notional'],
])

// "+0.3bp", "-0.4bp", and a figure that rounds to zero as "0.0bp": never "+-0.0bp"
const signed = (bp) => { const n = parseFloat(bp); return (n > 0 ? '+' : '') + (n === 0 ? String(bp).replace('-', '') : bp) + 'bp' }

// The eight VA cells. basis.kind:
//   'rate'     — the rates tab: bp = VA / IR01 (dv01), NPV shows the par rate, ALL-IN the all-in rate
//   'notional' — FX and digital assets: bp = VA / (quote-currency notional × 1bp) on every cell,
//                ALL-IN's line being the all-in in bp of notional
// Each row: key, label, color, curve, desc, value (number|null) and sub (the second line) or null.
export function buildVaRows(xva, basis = { kind: 'rate' }) {
  return VA_KEYS.map(key => {
    const def = VA_DEFS[key]
    const val = xva?.[key] ?? null
    let sub = null
    if (basis.kind === 'rate') {
      const known = isFinite(basis.parRate)
      if (key === 'npv') {
        sub = { text: known ? basis.parRate.toFixed(3) + '%' : '—', caption: 'par rate',
          color: 'var(--text-dim)', captionColor: 'var(--text-mute)', weight: 600 }
      } else if (key === 'all_in') {
        sub = { text: known ? basis.allInRate.toFixed(3) + '%' : '—', caption: 'all-in rate',
          color: 'var(--text-hi)', captionColor: 'var(--text-mute)', weight: 500 }
      } else if (val != null && basis.dv01 > 0) {
        sub = { text: signed((val / basis.dv01).toFixed(1)), caption: 'bp on rate',
          color: def.color + 'AA', captionColor: 'var(--text-mute)', weight: 600 }
      }
    } else if (basis.kind === 'notional') {
      const n = Number(basis.notional)
      if (val != null && n > 0) {
        const bp = (val / (n * 1e-4)).toFixed(1)
        sub = key === 'all_in'
          ? { text: signed(bp), caption: 'all-in bp of notional', color: 'var(--text-hi)', captionColor: 'var(--text-mute)', weight: 500 }
          : { text: signed(bp), caption: 'bp of notional',
              color: key === 'npv' ? 'var(--text-dim)' : def.color + 'AA', captionColor: 'var(--text-mute)', weight: 600 }
      }
    }
    return { key, label: def.label, color: def.color, curve: def.curve, desc: def.desc, value: val, sub }
  })
}

// The ON-CHAIN comparison row: each VA under the on-chain preset against the current run.
export function onChainCompareRows(xva, cmpXva) {
  if (!xva || !cmpXva) return []
  return VA_KEYS.map(key => {
    const cur = xva[key], oc = cmpXva[key]
    const delta = (cur != null && oc != null) ? oc - cur : null
    const pct = (delta != null && key !== 'npv' && Math.abs(cur) > 1) ? (delta / Math.abs(cur)) * 100 : null
    const better = key === 'all_in' ? (delta > 0) : (delta != null && Math.abs(oc) < Math.abs(cur))
    return { key, cur, oc, delta, pct, better }
  })
}

// The ticket's collateral choice as the routes take it: {posted: {code: w}, received: {code: w}}; null when both sides
// are blank (cash in the CSA currency, zero carry). A single code becomes weight 1; a schedule's composition passes through.
export function collateralBody(sel) {
  if (!sel) return null
  const side = (v) => {
    if (!v) return null
    if (typeof v === 'string') return v ? { [v]: 1 } : null
    const entries = Object.entries(v).filter(([, w]) => Number(w) > 0)
    return entries.length ? Object.fromEntries(entries.map(([k, w]) => [k, Number(w)])) : null
  }
  const posted = side(sel.posted), received = side(sel.received)
  if (!posted && !received) return null
  return { posted: posted || {}, received: received || {}, ...(sel.rail ? { rail: sel.rail } : {}) }
}

// The label of one side of the collateral choice: the code, or "UST_BILL 60 · USDC 40" for a schedule's composition.
export function collateralLabel(v) {
  if (!v) return 'CASH'
  if (typeof v === 'string') return v
  const e = Object.entries(v).filter(([, w]) => Number(w) > 0).sort((a, b) => b[1] - a[1])
  if (!e.length) return 'CASH'
  if (e.length === 1) return e[0][0]
  const tot = e.reduce((s_, [, w]) => s_ + Number(w), 0)
  return e.map(([k, w]) => `${k} ${Math.round(100 * Number(w) / tot)}`).join(' · ')
}

// The saving on chain: the all-in difference between the on-chain run and the current one, in money and in bp of
// notional, upfront and running (upfront over the grid's annuity Σ DF·dt, which the routes return with the XVA block).
export function onChainSaving(xva, cmpXva, notional) {
  if (!xva || !cmpXva || xva.all_in == null || cmpXva.all_in == null) return null
  const money = cmpXva.all_in - xva.all_in
  const n = Number(notional)
  const bpUpfront = Number.isFinite(n) && n > 0 ? money / (n * 1e-4) : null
  const ann = Number(cmpXva.annuity ?? xva.annuity)
  const bpRunning = bpUpfront != null && Number.isFinite(ann) && ann > 0 ? bpUpfront / ann : null
  return { money, bpUpfront, bpRunning, annuity: Number.isFinite(ann) ? ann : null }
}

// The FX routes' csa body for a preset: the shape the panel has always sent.
export function fxCsaBody(settlement, imExchanged) {
  if (settlement === 'BILATERAL') return { preset: 'BILATERAL', threshold_cp: 500000, mta: 100000, mpor_days: 10, im_exchanged: !!imExchanged }
  if (settlement === 'ON_CHAIN') return { preset: 'ON_CHAIN', im_exchanged: !!imExchanged }
  return imExchanged ? { preset: 'UNCOLLATERALISED', im_exchanged: true } : null
}

// The quote-currency notional an FX VA is quoted against in bp: the ticket's own figure,
// else base notional at the contract rate (strike / forward), else at spot.
export function quoteNotional(quote) {
  if (!quote) return null
  const qn = Number(quote.quote_notional)
  if (isFinite(qn) && qn > 0) return qn
  const base = Number(quote.base_notional)
  const rate = [quote.forward_rate, quote.strike, quote.forward, quote.spot].map(Number).find(x => isFinite(x) && x > 0)
  return isFinite(base) && base > 0 && rate ? base * rate : null
}

// The model badge from the last FX response, in the place of the rates tab's
// "CALIBRATED …" line: kind 'ok' (the pair's surface), 'info' (a desk override),
// 'warn' (the demo default, no surface) or null before the first run.
export function volBadge(params, pair) {
  if (!params) return null
  const src = String(params.vol_source || '')
  const mode = String(params.vol_mode || '')
  const vol = params.vol_pct != null ? Number(params.vol_pct).toFixed(2) + ' %' : null
  const modeWord = /smile/i.test(mode) ? 'term + smile' : /term structure/i.test(mode) ? 'term structure' : 'flat'
  if (/demo default/i.test(src)) return { kind: 'warn', text: `DEMO DEFAULT ${vol} · no surface` }
  if (/desk input/i.test(src)) return { kind: 'info', text: `DESK VOL ${vol} · override · flat` }
  const name = (src.match(/[A-Z0-9]+_VOL/) || [])[0] || (pair ? pair + '_VOL' : 'surface')
  const steps = Array.isArray(params.step_vols_pct) ? params.step_vols_pct.length : 0
  return { kind: 'ok', text: `✔ ${name} · ${vol}${steps ? ` · ${steps} step vols` : ''} · ${modeWord}` }
}

// ── the simple view ──────────────────────────────────────────────────────────────
// The tab has two views. 'advanced' is the whole tab. 'simple' shows the settlement block, SIMULATE and one line
// on what the run assumes; it hides inputs and changes none of them, so the request is the same in both.
export const XVA_VIEW_KEY = 'rijeka.xva.view'
const XVA_VIEWS = ['simple', 'advanced']

// A launch workspace (a new sign-up; the store's `launch`, whatever its preset is called now) opens the tab in the
// simple view; every other firm in the whole one.
export function defaultXvaView(launch) {
  return launch === true ? 'simple' : 'advanced'
}

// The user's own choice from an earlier visit, or null when there is none (or no storage to read).
export function storedXvaView() {
  try {
    const v = localStorage.getItem(XVA_VIEW_KEY)
    return XVA_VIEWS.includes(v) ? v : null
  } catch { return null }
}

// [view, setView] for both tabs: the user's own choice when they have made one, else the firm's default.
export function useXvaView() {
  const launch = useModulesStore(s => s.launch)
  const [choice, setChoice] = useState(storedXvaView)
  const setView = (v) => {
    if (!XVA_VIEWS.includes(v)) return
    setChoice(v)
    try { localStorage.setItem(XVA_VIEW_KEY, v) } catch { /* no storage: the choice lasts while the tab is open */ }
  }
  return [choice || defaultXvaView(launch), setView]
}

// What the inputs the simple view hides start at, the same on both tabs: each tab's state is initialised from this,
// and the line's "default" is measured against it.
export const HIDDEN_INPUT_DEFAULTS = Object.freeze({ wwr: 1.0, lgd: '40', fbaRatio: '55', hurdle: '12', imUsd: '', capModel: 'sa_ccr' })

// Wrong-way risk on a currency or digital-asset ticket: the multiple a party's default intensity takes when the
// asset halves against its forward (the request's cp_hazard_if_halves / own_hazard_if_halves). 1 is independence.
export const CREDIT_LINKS = Object.freeze([
  ['1', 'independent'], ['1.5', '× 1.5 when it halves'], ['2', '× 2 when it halves'], ['3', '× 3 when it halves'], ['5', '× 5 when it halves'],
  ['0.5', '× 0.5 when it halves (worsens as it rises)'],
])
// What a link did, for the lines under the results: the counterparty's to CVA (`cp`), our own to DVA (`own`), each
// null when that party was not linked; null altogether when the run had no link.
export function wrongWayLine(res) {
  const w = res?.wwr
  if (!w) return null
  const cva = Number(res?.xva?.cva), dva = Number(res?.xva?.dva)
  const cp = Number(w.cp_hazard_if_halves) !== 1 && Number.isFinite(cva)
    ? { cva, independent: Number(w.cva_independent), k: Number(w.cp_hazard_if_halves), wrong: cva < Number(w.cva_independent), change: cva - Number(w.cva_independent) } : null
  const own = w.own_hazard_if_halves != null && Number(w.own_hazard_if_halves) !== 1 && Number.isFinite(dva)
    ? { dva, independent: Number(w.dva_independent), k: Number(w.own_hazard_if_halves), change: dva - Number(w.dva_independent) } : null
  return cp || own ? { cp, own } : null
}

// The spread grid still produces the desk's default curves (a blank cell is 0, as in toCurve).
export function spreadsAreDefault(spreads) {
  const n = (v) => parseFloat(v) || 0
  return Object.keys(SPREAD_DEFAULTS).every(g => TENORS_6.every(t => n(spreads?.[g]?.[t]) === n(SPREAD_DEFAULTS[g][t])))
}

// WWR, LGD, the FBA ratio, the hurdle, the initial margin, the capital model and group are all as the tab opened.
export function assumptionsAreDefault({ wwr, lgd, fbaRatio, hurdle, imUsd, capModel, cpLink, ownLink, cryptoGroup } = {}) {
  const D = HIDDEN_INPUT_DEFAULTS
  return Number(wwr) === D.wwr && Number(cpLink ?? 1) === 1 && Number(ownLink ?? 1) === 1 && parseFloat(lgd) === parseFloat(D.lgd) && parseFloat(fbaRatio) === parseFloat(D.fbaRatio)
    && parseFloat(hurdle) === parseFloat(D.hurdle) && imUsdValue(imUsd) == null && capModel === D.capModel && !cryptoGroup
}

// A model parameter box holds a number the request will carry (a blank or a non-number is sent as nothing).
const typedNumber = (v) => !!v && Number.isFinite(parseFloat(v))

// Where the rates model's parameters come from, as the server reads the request: both a and σ typed are used as
// typed; with one or none typed it takes the stored calibration (a lone value is not used), and with no stored
// calibration it has nothing to run on: null, and the line says so (NO_CALIBRATION_LINE).
export function ratesModelWords({ aOverride, sigOverride, hasCalibration = true } = {}) {
  const a = typedNumber(aOverride), sig = typedNumber(sigOverride)
  if (a && sig) return 'your own model parameters'
  if (!hasCalibration) return null
  return (a || sig) ? 'the stored model calibration, since only one model parameter is typed' : 'the stored model calibration'
}
export const NO_CALIBRATION_LINE = 'No stored model calibration: calibrate under Configurations, or show the model inputs and type both parameters'

// Where the FX and digital-asset vol comes from: typed on the tab; else, when the last run found no surface for the
// pair (the badge's own test, on the run's params), the desk default; else the pair's surface in the chosen mode.
export function fxModelWords({ volPct, volMode, params = null } = {}) {
  const v = numOrNull(volPct)
  if (v != null) return `your own vol of ${v}%`
  if (volBadge(params)?.kind === 'warn') return 'the desk default vol (no surface saved for this pair)'
  return volMode === 'FLAT' ? "one flat vol from the pair's surface" : "the pair's vol surface"
}

// The simple view's line on what a run assumes, from the current values of the inputs it hides:
// "2,000 paths on the stored model calibration and default credit and funding spreads". With no model to run on
// (rates without a stored calibration) it is the line that says so.
export function runAssumesLine({ paths, model, spreads, assumptions }) {
  if (!model) return NO_CALIBRATION_LINE
  const parts = [model, `${spreadsAreDefault(spreads) ? 'default' : 'your own'} credit and funding spreads`]
  if (assumptions && !assumptionsAreDefault(assumptions)) parts.push('your own assumptions')
  const last = parts.pop()
  return `${Number(paths).toLocaleString('en-US')} paths on ${parts.join(', ')} and ${last}`
}

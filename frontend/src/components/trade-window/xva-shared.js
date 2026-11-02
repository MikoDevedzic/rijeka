// trade-window/xva-shared.js
// ────────────────────────────────────────────────────────────────────────────────────
// The pure parts of the XVA tab that rates (blotter/XVATab.jsx) and the FX / digital-asset
// panel (FxXvaPanel.jsx) share: the VA definitions and tooltips, the styles, the money
// format, the spread-curve payload, the VA strip rows (bp on rate for rates, bp of notional
// for FX), the on-chain comparison rows and the FX CSA body. No React; the components that
// render these live in xva-shared.jsx. Tested in xva-shared.test.js.
// ────────────────────────────────────────────────────────────────────────────────────

export const TENORS_6 = ['1Y', '2Y', '3Y', '5Y', '7Y', '10Y']
export const TENOR_YEARS = { '1Y': 1, '2Y': 2, '3Y': 3, '5Y': 5, '7Y': 7, '10Y': 10 }

// The desk's default term structures, the same on every product.
export const SPREAD_DEFAULTS = {
  cp:  { '1Y': '72', '2Y': '78', '3Y': '83', '5Y': '91', '7Y': '97', '10Y': '105' },
  own: { '1Y': '38', '2Y': '41', '3Y': '44', '5Y': '48', '7Y': '51', '10Y': '55' },
  ftp: { '1Y': '42', '2Y': '46', '3Y': '50', '5Y': '55', '7Y': '58', '10Y': '62' },
}

export const VA_DEFS = {
  npv:    { label:'NPV',    color:'#F4F7FA', desc:'Present value at mid-market. Positive = asset to you. This is the base price before any XVA adjustments.', curve:'none' },
  cva:    { label:'CVA',    color:'#e05040', desc:'Credit Valuation Adjustment = -LGD x Sum[ EE(t) x (PD_cp(t) - PD_cp(t-dt)) x DF(t) ]. Cost of counterparty default risk over the EE profile. Always negative.', curve:'EE' },
  dva:    { label:'DVA',    color:'#4a9ad4', desc:'Debt Valuation Adjustment = +LGD x Sum[ |ENE(t)| x (PD_own(t) - PD_own(t-dt)) x DF(t) ]. Benefit from your own default risk. Always positive. Excluded from regulatory capital.', curve:'ENE' },
  fva:    { label:'FVA',    color:'#e05040', desc:'Funding Valuation Adjustment = -(FTP/10000) x Sum[ EE(t) x dt x DF(t) ]. Cost of funding positive exposure when no CSA. Always negative.', curve:'EE' },
  fba:    { label:'FBA',    color:'#4a9ad4', desc:'Funding Benefit Adjustment = +(FTP x ratio/10000) x Sum[ |ENE(t)| x dt x DF(t) ]. Benefit when counterparty funds your negative MTM. FBA/FTP ratio typically 0.5-0.7.', curve:'ENE' },
  kva:    { label:'KVA',    color:'#e05040', desc:'Capital Valuation Adjustment = -(Hurdle/100) x Sum[ Capital(t) x dt x DF(t) ]. Capital(t) = SA-CCR EAD x 8% RWA. Often the largest VA for vanilla IRS.', curve:'EE' },
  mva:    { label:'MVA',    color:'#f0a020', desc:'Margin Valuation Adjustment = -Sum[ IM(t) x FTP(t) x dt x DF(t) ]. Cost of funding SIMM initial margin. IM is derived from the ISDA SIMM IR delta risk weight applied to the trade IR01, and amortises with residual maturity.', curve:'none' },
  all_in: { label:'ALL-IN', color:'#0dd4a8', desc:'NPV + CVA + DVA + FVA + FBA + KVA + MVA. Full economic cost of the trade. Client pays ALL-IN rate; desk runs NPV.', curve:'none' },
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
  simmIm: { title: 'SIMM IM ($M)',
    body: 'ISDA SIMM initial margin for the inter-dealer hedge in $M. Linear MVA proxy:\n\nMVA~ = -(IM x $1M) x (FTP/10000) x T/2\n\nAssumes flat IM for T/2 years on average.\n\nOn the roadmap: IM(path, t) computed on each Monte Carlo path using ISDA SIMM delta sensitivities. MVA = -(FTP/10000) x Sum[ IM(t) x dt x DF(t) ].' },
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
  fxSimmIm: { title: 'SIMM IM ($M)',
    body: 'Initial margin for the hedge in $M, funding cost into MVA.\n\nBlank = a SIMM-style FX risk weight applied to the ticket\'s spot delta (RW × spot01), amortising to settlement. Type a number to pin it.' },
}

// ── styles every XVA tab uses ────────────────────────────────────────────────────
export const INP = { background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'2px',
  color:'var(--text-hi)', fontFamily:'var(--mono)', fontSize:'0.8125rem',
  padding:'3px 6px', outline:'none', width:'100%' }
export const LBL = { fontSize:'0.75rem', color:'var(--accent)', letterSpacing:'0.07em',
  fontFamily:'var(--sans)', marginBottom:'2px',
  borderBottom:'1px dashed rgba(13,212,168,0.4)', cursor:'help', paddingBottom:'1px' }
export const SEC_HDR = { fontSize: '12px', fontWeight:700, letterSpacing:'0.18em', color:'var(--text)',
  fontFamily:'var(--sans)', paddingLeft:'10px', borderLeft:'3px solid var(--accent)', lineHeight:1.2,
  marginTop:'14px', marginBottom:'8px' }
export const LEFT_COL = { width:'320px', minWidth:'320px', borderRight:'1px solid var(--border)',
  overflowY:'auto', padding:'12px', display:'flex', flexDirection:'column' }

export const SETTLEMENT_PRESETS = [
  ['UNCOLLATERALISED', 'NO CSA', 'var(--red)'],
  ['BILATERAL', 'BILATERAL', 'var(--blue)'],
  ['ON_CHAIN', 'ON-CHAIN', 'var(--accent)'],
]
export const SETTLEMENT_DESC = {
  UNCOLLATERALISED: 'No variation margin — full MtM at risk.',
  BILATERAL: 'Daily VM under CSA · 10bd MPoR floor · SIMM IM exchanged.',
  ON_CHAIN: 'Atomic settlement · continuous VM · zero TH/MTA · 5bd MPoR · SIMM IM × 0.707.',
}

export const RATES_MVA_NOTE = 'MVA = −Σ IM(t) × FTP(t) × dt × DF(t) · IM from ISDA SIMM IR delta (RW × IR01), amortising to maturity'
export const FX_MVA_NOTE = 'MVA = −Σ IM(t) × FTP(t) × dt × DF(t) · IM from a SIMM-style FX weight on the spot delta (RW × spot01), amortising to settlement'

// ── helpers ──────────────────────────────────────────────────────────────────────
const SYM = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }

// Signed, rounded, with the currency's symbol, exactly as the rates tab's fmtDollar:
// +$1,234 · -$1,234 · +$0 · — for nothing. Other currencies prefix their code.
export function fmtMoney(v, ccy = 'USD') {
  if (v == null || isNaN(v)) return '—'
  const sign = v >= 0 ? '+' : '-'
  return sign + (SYM[ccy] ?? (ccy + ' ')) + Math.abs(Math.round(v)).toLocaleString('en-US')
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

// Blank = let the server derive IM (SIMM RW × sensitivity); a number pins it, in $M.
export function simmImValue(s) {
  return (s === '' || s == null || isNaN(parseFloat(s))) ? null : parseFloat(s)
}

const signed = (bp) => (parseFloat(bp) >= 0 ? '+' : '') + bp + 'bp'

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
          color: 'var(--accent)', captionColor: 'var(--accent)', weight: 700 }
      } else if (val != null && basis.dv01 > 0) {
        sub = { text: signed((val / basis.dv01).toFixed(1)), caption: 'bp on rate',
          color: def.color + 'AA', captionColor: 'var(--text-mute)', weight: 600 }
      }
    } else if (basis.kind === 'notional') {
      const n = Number(basis.notional)
      if (val != null && n > 0) {
        const bp = (val / (n * 1e-4)).toFixed(1)
        sub = key === 'all_in'
          ? { text: signed(bp), caption: 'all-in bp of notional', color: 'var(--accent)', captionColor: 'var(--accent)', weight: 700 }
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

// trade-window/xva-shared.test.js
// The pure helpers the rates and FX / digital-asset XVA tabs share (xva-shared.js): the money
// format, the spread-curve payload from the tenor grid, the VA strip rows (bp on rate for rates,
// bp of notional for FX), the on-chain comparison rows, the FX CSA body, the quote-currency
// notional and the vol badge. Run: npm test.
import { describe, it, expect, vi } from 'vitest'

// As the other trade-window tests: the panels import the session helper, whose supabase
// client needs env vars at import time; the helpers under test never call it.
vi.mock('../../lib/session', () => ({ getSessionMaybe: async () => null, getSessionSafe: async () => null }))

import {
  VA_KEYS, SPREAD_DEFAULTS, defaultSpreads, fmtMoney, fmtDollar, toCurve, flatSpread, spreadCurvePayload, simmImValue, numOrNull,
  buildVaRows, onChainCompareRows, fxCsaBody, quoteNotional, volBadge, collateralBody, collateralLabel, onChainSaving,
  XVA_VIEW_KEY, defaultXvaView, storedXvaView, HIDDEN_INPUT_DEFAULTS, spreadsAreDefault, assumptionsAreDefault,
  ratesModelWords, fxModelWords, runAssumesLine, NO_CALIBRATION_LINE,
} from './xva-shared'

const xva = { npv: 12500.4, cva: -3200.6, dva: 900.2, fva: -1100, fba: 300, kva: -2400, mva: -800, all_in: 6199 }

describe('fmtMoney', () => {
  it('is the rates tab\'s fmtDollar for USD: signed, rounded, thousands', () => {
    expect(fmtDollar(1234.6)).toBe('+$1,235')
    expect(fmtDollar(-1234.4)).toBe('-$1,234')
    expect(fmtDollar(0)).toBe('+$0')
    expect(fmtDollar(-0.4)).toBe('+$0')          // a figure that rounds to nothing has no minus sign
    expect(fmtDollar(-0.5)).toBe('+$0')
    expect(fmtDollar(-0.6)).toBe('-$1')
    expect(fmtDollar(null)).toBe('—')
  })
  it('switches the symbol with the quote currency and prefixes an unknown code', () => {
    expect(fmtMoney(-89, 'EUR')).toBe('-€89')
    expect(fmtMoney(12345.6, 'CHF')).toBe('+CHF 12,346')
    expect(fmtMoney(NaN, 'JPY')).toBe('—')
  })
})

describe('spread curves', () => {
  it('turns the tenor grid into [{t, spread_bp}] on 1Y…10Y, blanks as 0', () => {
    expect(toCurve(SPREAD_DEFAULTS.cp)).toEqual([
      { t: 1, spread_bp: 72 }, { t: 2, spread_bp: 78 }, { t: 3, spread_bp: 83 }, { t: 5, spread_bp: 91 }, { t: 7, spread_bp: 97 }, { t: 10, spread_bp: 105 },
    ])
    expect(toCurve({ '1Y': '10', '5Y': '' })[3]).toEqual({ t: 5, spread_bp: 0 })
  })
  it('the flat value is the 5Y pillar, else the first filled cell', () => {
    expect(flatSpread(SPREAD_DEFAULTS.ftp)).toBe(55)
    expect(flatSpread({ '1Y': '20', '2Y': '30' })).toBe(20)
    expect(flatSpread({})).toBe(0)
  })
  it('the payload carries the three curves and their flats, the same on every route', () => {
    const d = defaultSpreads()
    expect(d).toEqual({ cp: SPREAD_DEFAULTS.cp, own: SPREAD_DEFAULTS.own, ftp: SPREAD_DEFAULTS.ftp })
    expect(d.cp).not.toBe(SPREAD_DEFAULTS.cp)            // a copy per tab
    const p = spreadCurvePayload(d.cp, d.own, d.ftp)
    expect(Object.keys(p).sort()).toEqual(['cp_cds_bp', 'cp_cds_curve', 'ftp_bp', 'ftp_curve', 'own_cds_bp', 'own_cds_curve'])
    expect(p.own_cds_curve.map(x => x.spread_bp)).toEqual([38, 41, 44, 48, 51, 55])
    expect(p.cp_cds_bp).toBe(91); expect(p.own_cds_bp).toBe(48); expect(p.ftp_bp).toBe(55)
  })
  it('SIMM IM: blank or junk is null (derive server-side), a number pins it', () => {
    expect(simmImValue('')).toBeNull(); expect(simmImValue('x')).toBeNull(); expect(simmImValue('0.85')).toBe(0.85)
    expect(numOrNull('1,250.5')).toBe(1250.5); expect(numOrNull('')).toBeNull()
  })
})

describe('buildVaRows', () => {
  it('has the nine cells in the strip\'s order', () => {
    expect(buildVaRows(null).map(r => r.key)).toEqual(VA_KEYS)
    expect(VA_KEYS).toEqual(['npv', 'cva', 'dva', 'fva', 'fba', 'kva', 'mva', 'colva', 'all_in'])
  })
  it('rates: bp on rate = VA / IR01, NPV shows the par rate, ALL-IN the all-in rate', () => {
    const rows = buildVaRows(xva, { kind: 'rate', dv01: 5000, parRate: 3.665, allInRate: 3.5389 })
    const by = Object.fromEntries(rows.map(r => [r.key, r]))
    expect(by.cva.sub).toMatchObject({ text: '-0.6bp', caption: 'bp on rate', weight: 600 })
    expect(by.dva.sub.text).toBe('+0.2bp')
    expect(by.npv.sub).toMatchObject({ text: '3.665%', caption: 'par rate' })
    expect(by.all_in.sub).toMatchObject({ text: '3.539%', caption: 'all-in rate', color: 'var(--text-hi)', weight: 500 })
    expect(by.cva.value).toBe(-3200.6)
  })
  it('rates before a run: no bp lines, the rate lines show a dash when the par rate is unknown', () => {
    const rows = buildVaRows(null, { kind: 'rate', dv01: 0, parRate: NaN, allInRate: NaN })
    const by = Object.fromEntries(rows.map(r => [r.key, r]))
    expect(by.cva.sub).toBeNull(); expect(by.cva.value).toBeNull()
    expect(by.npv.sub.text).toBe('—'); expect(by.all_in.sub.text).toBe('—')
  })
  it('FX: bp of notional = VA / (quote notional × 1bp) on every cell, ALL-IN as the all-in in bp', () => {
    const rows = buildVaRows(xva, { kind: 'notional', notional: 10_000_000 })
    const by = Object.fromEntries(rows.map(r => [r.key, r]))
    expect(by.cva.sub).toMatchObject({ text: '-3.2bp', caption: 'bp of notional' })
    expect(by.npv.sub).toMatchObject({ text: '+12.5bp', caption: 'bp of notional', color: 'var(--text-dim)' })
    expect(by.all_in.sub).toMatchObject({ text: '+6.2bp', caption: 'all-in bp of notional', color: 'var(--text-hi)', weight: 500 })
    expect(buildVaRows(xva, { kind: 'notional', notional: null }).every(r => r.sub === null)).toBe(true)
  })
})

describe('onChainCompareRows', () => {
  it('each VA on-chain against the current run, with the delta, the % and whether it is better', () => {
    const cmp = { ...xva, cva: -2000, dva: 900.2, all_in: 7399.6 }
    const rows = onChainCompareRows(xva, cmp)
    const by = Object.fromEntries(rows.map(r => [r.key, r]))
    expect(by.cva.delta).toBeCloseTo(1200.6); expect(by.cva.pct).toBeCloseTo(37.5, 0); expect(by.cva.better).toBe(true)
    expect(by.npv.pct).toBeNull()
    expect(by.all_in.better).toBe(true); expect(by.all_in.delta).toBeCloseTo(1200.6)
    expect(onChainCompareRows(xva, null)).toEqual([])
  })
})

describe('fxCsaBody', () => {
  it('is the shape the FX routes have always received', () => {
    expect(fxCsaBody('UNCOLLATERALISED', false)).toBeNull()
    expect(fxCsaBody('UNCOLLATERALISED', true)).toEqual({ preset: 'UNCOLLATERALISED', im_exchanged: true })
    expect(fxCsaBody('BILATERAL', true)).toEqual({ preset: 'BILATERAL', threshold_cp: 500000, mta: 100000, mpor_days: 10, im_exchanged: true })
    expect(fxCsaBody('ON_CHAIN', false)).toEqual({ preset: 'ON_CHAIN', im_exchanged: false })
  })
})

describe('quoteNotional', () => {
  it('the ticket\'s quote notional, else base × contract rate, else nothing', () => {
    expect(quoteNotional({ quote_notional: 10_850_000 })).toBe(10_850_000)
    expect(quoteNotional({ base_notional: 10_000_000, forward_rate: 1.085 })).toBeCloseTo(10_850_000)
    expect(quoteNotional({ base_notional: 2, strike: 65000 })).toBe(130000)
    expect(quoteNotional({ base_notional: 1 })).toBeNull()
    expect(quoteNotional(null)).toBeNull()
  })
})

describe('volBadge', () => {
  it('reads the surface, the desk override or the demo default from the last response', () => {
    expect(volBadge(null)).toBeNull()
    expect(volBadge({ vol_pct: 7.52, vol_source: 'EURUSD_VOL surface, ATM at 0.50y (pillar; 2026-11-02)',
      vol_mode: 'ATM term structure of the surface (step vols)', step_vols_pct: [7.4, 7.5, 7.6, 7.7, 7.8, 7.9] }))
      .toEqual({ kind: 'ok', text: '✔ EURUSD_VOL · 7.52 % · 6 step vols · term structure' })
    expect(volBadge({ vol_pct: 11.1, vol_source: "USDJPY_VOL surface at the option's expiry and strike",
      vol_mode: 'ATM term structure for the paths, the smile at each path\'s moneyness (sticky-delta)' }))
      .toEqual({ kind: 'ok', text: '✔ USDJPY_VOL · 11.10 % · term + smile' })
    expect(volBadge({ vol_pct: 7.5, vol_source: 'demo default (no surface for this pair)', vol_mode: 'flat' }, 'GBPNOK'))
      .toEqual({ kind: 'warn', text: 'DEMO DEFAULT 7.50 % · no surface' })
    expect(volBadge({ vol_pct: 9, vol_source: 'desk input', vol_mode: 'flat' }).kind).toBe('info')
  })
})

describe('collateral on the ticket', () => {
  it('a code becomes weight 1, a composition passes through, blanks mean cash', () => {
    expect(collateralBody(null)).toBeNull()
    expect(collateralBody({ posted: '', received: '' })).toBeNull()
    expect(collateralBody({ posted: 'USDC', received: null })).toEqual({ posted: { USDC: 1 }, received: {} })
    expect(collateralBody({ posted: { UST_BILL: 0.6, USDC: 0.4 }, received: { USD_CASH: 1 }, rail: 'on_chain', source: 'SCHEDULE' }))
      .toEqual({ posted: { UST_BILL: 0.6, USDC: 0.4 }, received: { USD_CASH: 1 }, rail: 'on_chain' })
    expect(collateralLabel(null)).toBe('CASH')
    expect(collateralLabel('USDC')).toBe('USDC')
    expect(collateralLabel({ UST_BILL: 0.6, USDC: 0.4 })).toBe('UST_BILL 60 · USDC 40')
  })
  it('the saving on chain: the all-in difference, in bp of notional upfront and running over the annuity', () => {
    const cur = { all_in: 6199, annuity: 4.5 }, oc = { all_in: 8199, annuity: 4.5 }
    const s = onChainSaving(cur, oc, 10_000_000)
    expect(s.money).toBe(2000)
    expect(s.bpUpfront).toBeCloseTo(2.0, 9)
    expect(s.bpRunning).toBeCloseTo(2.0 / 4.5, 9)
    expect(onChainSaving(cur, oc, null).bpUpfront).toBeNull()
    expect(onChainSaving(cur, null, 1)).toBeNull()
  })
})

describe('bp lines', () => {
  it('a figure that rounds to zero is unsigned, whichever side of zero it came from', () => {
    const rows = buildVaRows({ npv: 0, cva: -2, dva: 1, fva: 0, fba: 0, kva: -373, mva: -2986, colva: 0, all_in: -3360 }, { kind: 'rate', dv01: 4668, parRate: 3.48, allInRate: 3.47 })
    const sub = Object.fromEntries(rows.filter(r => r.sub).map(r => [r.key, r.sub.text]))
    expect(sub.cva).toBe('0.0bp')            // −2 / 4668 rounds to −0.0: no sign, never "+-0.0bp"
    expect(sub.dva).toBe('0.0bp')
    expect(sub.kva).toBe('-0.1bp')
    expect(sub.mva).toBe('-0.6bp')
    for (const t of Object.values(sub)) expect(t).not.toMatch(/\+-|\+−|--/)
  })
})

describe('the simple view', () => {
  it('is the default for a launch workspace (the store\'s launch flag) and for no other, whatever the preset is called', () => {
    expect(defaultXvaView(true)).toBe('simple')
    for (const v of [false, null, undefined, '', 'LAUNCH', 'CUSTOM', 1]) expect(defaultXvaView(v)).toBe('advanced')
  })
  it('reads the user\'s own choice from storage, and nothing it does not know or cannot read', () => {
    const stub = (get) => vi.stubGlobal('localStorage', { getItem: get })
    try {
      stub(k => (k === XVA_VIEW_KEY ? 'simple' : null)); expect(storedXvaView()).toBe('simple')
      stub(() => 'advanced'); expect(storedXvaView()).toBe('advanced')
      stub(() => 'expert'); expect(storedXvaView()).toBeNull()
      stub(() => null); expect(storedXvaView()).toBeNull()
      stub(() => { throw new Error('blocked') }); expect(storedXvaView()).toBeNull()
    } finally { vi.unstubAllGlobals() }
    expect(XVA_VIEW_KEY).toBe('rijeka.xva.view')
  })
  it('knows the desk default spreads from an edited grid, a blank cell being 0', () => {
    expect(spreadsAreDefault(defaultSpreads())).toBe(true)
    const s = defaultSpreads(); s.own['3Y'] = '44.0'
    expect(spreadsAreDefault(s)).toBe(true)
    s.cp['5Y'] = '120'; expect(spreadsAreDefault(s)).toBe(false)
    const blank = defaultSpreads(); blank.ftp['10Y'] = ''
    expect(spreadsAreDefault(blank)).toBe(false)
    expect(spreadsAreDefault(null)).toBe(false)
  })
  it('knows the hidden assumptions as the tab opened from a changed one', () => {
    // the values both tabs open with (their state is initialised from this), pinned: a change here changes what a run sends
    expect(HIDDEN_INPUT_DEFAULTS).toEqual({ wwr: 1.0, lgd: '40', fbaRatio: '55', hurdle: '12', simmIm: '', capModel: 'sa_ccr' })
    expect(Object.isFrozen(HIDDEN_INPUT_DEFAULTS)).toBe(true)
    expect(assumptionsAreDefault(HIDDEN_INPUT_DEFAULTS)).toBe(true)
    expect(assumptionsAreDefault({ ...HIDDEN_INPUT_DEFAULTS, lgd: '40.0' })).toBe(true)
    for (const changed of [{ wwr: 1.5 }, { lgd: '60' }, { fbaRatio: '70' }, { hurdle: '' }, { simmIm: '0.85' }, { capModel: 'cem' }]) {
      expect(assumptionsAreDefault({ ...HIDDEN_INPUT_DEFAULTS, ...changed })).toBe(false)
    }
  })
  it('names where the model comes from', () => {
    expect(ratesModelWords({ aOverride: '', sigOverride: '', hasCalibration: true })).toBe('the stored model calibration')
    expect(ratesModelWords({ aOverride: '0.03', sigOverride: '85', hasCalibration: true })).toBe('your own model parameters')
    expect(fxModelWords({ volPct: '', volMode: 'SURFACE' })).toBe("the pair's vol surface")
    expect(fxModelWords({ volPct: '', volMode: 'FLAT' })).toBe("one flat vol from the pair's surface")
    expect(fxModelWords({ volPct: '12.5', volMode: 'SURFACE' })).toBe('your own vol of 12.5%')
  })
  it('rates with no stored calibration: says there is none, unless both parameters are typed', () => {
    expect(ratesModelWords({ aOverride: '', sigOverride: '', hasCalibration: false })).toBeNull()
    expect(ratesModelWords({ aOverride: '0.03', sigOverride: '', hasCalibration: false })).toBeNull()
    expect(ratesModelWords({ aOverride: '0.03', sigOverride: '85', hasCalibration: false })).toBe('your own model parameters')
    const line = runAssumesLine({ paths: 2000, model: null, spreads: defaultSpreads(), assumptions: HIDDEN_INPUT_DEFAULTS })
    expect(line).toBe(NO_CALIBRATION_LINE)
    expect(line).toBe('No stored model calibration: calibrate under Configurations, or show the model inputs and type both parameters')
    expect(line).not.toMatch(/the stored model calibration|SIMULATE|—/)
  })
  it('rates with only one of a and σ typed: the stored calibration is what runs, as the server discards a lone value', () => {
    const one = 'the stored model calibration, since only one model parameter is typed'
    expect(ratesModelWords({ aOverride: '0.03', sigOverride: '', hasCalibration: true })).toBe(one)
    expect(ratesModelWords({ aOverride: '', sigOverride: '85', hasCalibration: true })).toBe(one)
    // a box holding something that is not a number is sent as nothing
    expect(ratesModelWords({ aOverride: '0.03', sigOverride: 'abc', hasCalibration: true })).toBe(one)
    expect(ratesModelWords({ aOverride: '—', sigOverride: '', hasCalibration: true })).toBe('the stored model calibration')
  })
  it('FX pair with no saved surface: the desk default vol, from the last run\'s params as the badge reads them', () => {
    const none = { vol_pct: 10, vol_source: 'demo default (no surface for this pair)', vol_mode: 'flat' }
    expect(volBadge(none, 'USDTRY').kind).toBe('warn')
    expect(fxModelWords({ volPct: '', volMode: 'SURFACE', params: none })).toBe('the desk default vol (no surface saved for this pair)')
    expect(fxModelWords({ volPct: '', volMode: 'FLAT', params: none })).toBe('the desk default vol (no surface saved for this pair)')
    // a typed vol wins; a pair with a surface, or no run yet, reads as before
    expect(fxModelWords({ volPct: '14', volMode: 'SURFACE', params: none })).toBe('your own vol of 14%')
    expect(fxModelWords({ volPct: '', volMode: 'SURFACE', params: { vol_pct: 7.4, vol_source: 'EURUSD_VOL surface', vol_mode: 'term structure' } })).toBe("the pair's vol surface")
    expect(fxModelWords({ volPct: '', volMode: 'SURFACE', params: null })).toBe("the pair's vol surface")
    expect(runAssumesLine({ paths: 2000, model: fxModelWords({ volPct: '', volMode: 'SURFACE', params: none }), spreads: defaultSpreads(), assumptions: HIDDEN_INPUT_DEFAULTS }))
      .toBe('2,000 paths on the desk default vol (no surface saved for this pair) and default credit and funding spreads')
  })
  it('says what a run assumes from the current values', () => {
    const base = { paths: 2000, model: 'the stored model calibration', spreads: defaultSpreads(), assumptions: HIDDEN_INPUT_DEFAULTS }
    expect(runAssumesLine(base)).toBe('2,000 paths on the stored model calibration and default credit and funding spreads')
    const own = defaultSpreads(); own.cp['5Y'] = '150'
    expect(runAssumesLine({ ...base, paths: 500, spreads: own })).toBe('500 paths on the stored model calibration and your own credit and funding spreads')
    expect(runAssumesLine({ ...base, paths: 5000, model: "the pair's vol surface", assumptions: { ...HIDDEN_INPUT_DEFAULTS, wwr: 1.3 } }))
      .toBe("5,000 paths on the pair's vol surface, default credit and funding spreads and your own assumptions")
    expect(runAssumesLine(base)).not.toMatch(/SIMULATE|—/)
  })
})

describe('the size the results table sets its money at', () => {
  it('steps down so the longest figure fits its column, and never below 11px', async () => {
    const { moneySize } = await import('./xva-shared')
    expect(moneySize(['+$260', '-$78', '$0'])).toBe(13.5)
    expect(moneySize(['-$123,456'])).toBe(13.5)
    expect(moneySize(['-$1,234,567'])).toBe(11.5)          // eleven characters: about 76px at 11.5px
    expect(moneySize(['+$260', '+€12,345,678'])).toBe(11)  // one long figure sizes every figure in the table
    expect(moneySize([])).toBe(13.5)
    expect(moneySize([null, undefined])).toBe(13.5)
  })
})

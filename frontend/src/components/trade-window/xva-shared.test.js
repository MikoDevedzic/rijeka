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
} from './xva-shared'

const xva = { npv: 12500.4, cva: -3200.6, dva: 900.2, fva: -1100, fba: 300, kva: -2400, mva: -800, all_in: 6199 }

describe('fmtMoney', () => {
  it('is the rates tab\'s fmtDollar for USD: signed, rounded, thousands', () => {
    expect(fmtDollar(1234.6)).toBe('+$1,235')
    expect(fmtDollar(-1234.4)).toBe('-$1,234')
    expect(fmtDollar(0)).toBe('+$0')
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
    expect(by.all_in.sub).toMatchObject({ text: '3.539%', caption: 'all-in rate', color: 'var(--accent)', weight: 700 })
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
    expect(by.all_in.sub).toMatchObject({ text: '+6.2bp', caption: 'all-in bp of notional', color: 'var(--accent)', weight: 700 })
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

// trade-window/product-terms.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Product-specific TERMS bodies. Each component renders the unique field set
// for its product (coupon + leg details for swaps, strike + vol for options,
// cap rate + index for caps, etc).
//
// Contract: each Component receives { state, update } and renders input rows.
// State shape is product-specific — the parent TradeWindow holds it in
// productState and passes it to the Component via props.
//
// These stubs are intentionally minimal. They show the pattern. Migration
// fills them in by lifting the existing per-product JSX out of the legacy
// TradeBookingWindow.jsx, one product at a time.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

// Constants mirror legacy TradeBookingWindow.jsx. Intentionally duplicated
// from rates.js during Sprint 10 migration; future cleanup patch will
// consolidate these into a shared constants file.
const CCY_CURVE = {
  USD: 'USD_SOFR', EUR: 'EUR_ESTR', GBP: 'GBP_SONIA',
  JPY: 'JPY_TONA', CHF: 'CHF_SARON', AUD: 'AUD_AONIA',
  CAD: 'CAD_CORRA',
}

const CCY_INDICES = {
  USD: ['SOFR','TERM SOFR 1M','TERM SOFR 3M','TERM SOFR 6M','EFFR'],
  EUR: ['\u20acSTR','EURIBOR 1M','EURIBOR 3M','EURIBOR 6M'],
  GBP: ['SONIA','TERM SONIA 3M','TERM SONIA 6M'],
  JPY: ['TONAR','TIBOR 3M','TIBOR 6M'],
  CHF: ['SARON','TERM SARON 3M'],
  AUD: ['AONIA','BBSW 3M','BBSW 6M'],
  CAD: ['CORRA'],
}

const CCY_CAL = {
  USD: 'NEW_YORK', EUR: 'TARGET', GBP: 'LONDON', JPY: 'TOKYO',
  CHF: 'ZURICH', AUD: 'SYDNEY', CAD: 'TORONTO',
}

const CCY_FLOAT_DC = {
  USD: 'ACT/360', EUR: 'ACT/360', GBP: 'ACT/365F', JPY: 'ACT/365F',
  CHF: 'ACT/360', AUD: 'ACT/365F', CAD: 'ACT/365F',
}

const INDEX_DEFAULTS = {
  'SOFR':          ['DAILY',      'ANNUAL',      'ACT/360'],
  'TERM SOFR 1M':  ['MONTHLY',    'QUARTERLY',   'ACT/360'],
  'TERM SOFR 3M':  ['QUARTERLY',  'QUARTERLY',   'ACT/360'],
  'TERM SOFR 6M':  ['SEMI_ANNUAL','SEMI_ANNUAL', 'ACT/360'],
  'EFFR':          ['DAILY',      'ANNUAL',      'ACT/360'],
  '\u20acSTR':     ['DAILY',      'ANNUAL',      'ACT/360'],
  'EURIBOR 1M':    ['MONTHLY',    'QUARTERLY',   'ACT/360'],
  'EURIBOR 3M':    ['QUARTERLY',  'SEMI_ANNUAL', 'ACT/360'],
  'EURIBOR 6M':    ['SEMI_ANNUAL','ANNUAL',      'ACT/360'],
  'SONIA':         ['DAILY',      'ANNUAL',      'ACT/365F'],
  'TERM SONIA 3M': ['QUARTERLY',  'SEMI_ANNUAL', 'ACT/365F'],
  'TERM SONIA 6M': ['SEMI_ANNUAL','ANNUAL',      'ACT/365F'],
  'TONAR':         ['DAILY',      'ANNUAL',      'ACT/365F'],
  'TIBOR 3M':      ['QUARTERLY',  'SEMI_ANNUAL', 'ACT/365F'],
  'TIBOR 6M':      ['SEMI_ANNUAL','ANNUAL',      'ACT/365F'],
  'SARON':         ['DAILY',      'ANNUAL',      'ACT/360'],
  'TERM SARON 3M': ['QUARTERLY',  'QUARTERLY',   'ACT/360'],
  'AONIA':         ['DAILY',      'ANNUAL',      'ACT/365F'],
  'BBSW 3M':       ['QUARTERLY',  'QUARTERLY',   'ACT/365F'],
  'BBSW 6M':       ['SEMI_ANNUAL','SEMI_ANNUAL', 'ACT/365F'],
  'CORRA':         ['DAILY',      'ANNUAL',      'ACT/365F'],
}

const INDEX_PAY_LAG = {
  'SOFR':2,'EFFR':2,'\u20acSTR':2,'SONIA':0,'TONAR':2,'SARON':2,'AONIA':0,'CORRA':2,
  'TERM SOFR 1M':0,'TERM SOFR 3M':0,'TERM SOFR 6M':0,
  'EURIBOR 1M':0,'EURIBOR 3M':0,'EURIBOR 6M':0,
  'TERM SONIA 3M':0,'TERM SONIA 6M':0,'TIBOR 3M':0,'TIBOR 6M':0,
  'TERM SARON 3M':0,'BBSW 3M':0,'BBSW 6M':0,
}

const PAY_FREQS      = ['MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL','ZERO_COUPON']
const RESET_FREQS    = ['DAILY','WEEKLY','MONTHLY','QUARTERLY','SEMI_ANNUAL','ANNUAL']
const DAY_COUNTS     = ['ACT/360','ACT/365F','30/360','ACT/ACT ISDA']
const BDCS           = ['MOD_FOLLOWING','FOLLOWING','PRECEDING','UNADJUSTED']
const CALENDARS      = ['NEW_YORK','LONDON','TARGET','TOKYO','ZURICH','SYDNEY','TORONTO']

async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function Row({ cols = 6, children }) {
  return (
    <div className="tbw-grid" style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 10,
      marginBottom: 12,
    }}>{children}</div>
  )
}

function Field({ label, children }) {
  return <div><div className="tbw-lbl">{label}</div>{children}</div>
}

function LegHeader({ label, dirLabel, dirColor }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0 8px',
    }}>
      <span className="tbw-lbl">{label}</span>
      <span className="tbw-helper-badge"
            style={{ borderColor: dirColor, color: dirColor }}>
        {dirLabel}
      </span>
    </div>
  )
}

// ── IR_SWAP body ───────────────────────────────────────────────────────────

export function SwapTermsBody({ state, update }) {
  const {
    ccy = 'USD', tenor = '5Y', tradeDate, effDate, matDate, valDate,
    direction = 'PAY', structure = 'VANILLA',
  } = state
  const isBasis = structure === 'BASIS'

  // ── Convention defaults (read from state, fall back to legacy defaults) ──
  const fixedPayFreq   = state.fixedPayFreq   ?? 'ANNUAL'
  const fixedDc        = state.fixedDc        ?? 'ACT/360'
  const fixedBdc       = state.fixedBdc       ?? 'MOD_FOLLOWING'
  const fixedCal       = state.fixedCal       ?? (CCY_CAL[ccy] || 'NEW_YORK')
  const index          = state.index          ?? (CCY_INDICES[ccy]?.[0] || 'SOFR')
  const floatResetFreq = state.floatResetFreq ?? 'DAILY'
  const floatPayFreq   = state.floatPayFreq   ?? 'ANNUAL'
  const floatDc        = state.floatDc        ?? (CCY_FLOAT_DC[ccy] || 'ACT/360')
  const floatBdc       = state.floatBdc       ?? 'MOD_FOLLOWING'
  const floatCal       = state.floatCal       ?? (CCY_CAL[ccy] || 'NEW_YORK')
  const spread         = state.spread         ?? '0'
  const leverage       = state.leverage       ?? '1.0'
  const coupon         = state.coupon         ?? ''
  const index2          = state.index2          ?? 'EFFR'
  const floatResetFreq2 = state.floatResetFreq2 ?? 'DAILY'
  const floatPayFreq2   = state.floatPayFreq2   ?? 'ANNUAL'
  const floatDc2        = state.floatDc2        ?? 'ACT/360'

  // ── Effect: CCY change cascade (skip first render) ───────────────────────
  const firstCcyRender = useRef(true)
  useEffect(() => {
    if (firstCcyRender.current) { firstCcyRender.current = false; return }
    const newIdx = (CCY_INDICES[ccy] || ['SOFR'])[0]
    const def = INDEX_DEFAULTS[newIdx] || ['DAILY','ANNUAL','ACT/360']
    update({
      index: newIdx,
      floatResetFreq: def[0], floatPayFreq: def[1], floatDc: def[2],
      fixedCal: CCY_CAL[ccy] || 'NEW_YORK',
      floatCal: CCY_CAL[ccy] || 'NEW_YORK',
      fixedDc:  'ACT/360',
      rateUserEdited: false,
    })
  }, [ccy])

  // ── Effect: schedule-dates auto-fetch ────────────────────────────────────
  useEffect(() => {
    if (!tradeDate || !tenor || !ccy) return
    let cancelled = false
    ;(async () => {
      try {
        const session = await getSession()
        if (!session || cancelled) return
        const res = await fetch(API + '/api/schedules/preview', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + session.access_token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ trade_date: tradeDate, tenor, currency: ccy }),
        })
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled) return
        update({ effDate: data.effective_date, matDate: data.maturity_date })
      } catch (_) { /* silent */ }
    })()
    return () => { cancelled = true }
  }, [tenor, ccy, tradeDate])

  // ── Effect: par-rate auto-fetch ──────────────────────────────────────────
  useEffect(() => {
    if (!effDate || !matDate || !ccy) return
    if (state.rateUserEdited) return
    let cancelled = false
    ;(async () => {
      try {
        const session = await getSession()
        if (!session || cancelled) return
        const payLag = INDEX_PAY_LAG[index] != null ? INDEX_PAY_LAG[index] : 2
        const payload = {
          curve_id: CCY_CURVE[ccy] || 'USD_SOFR',
          valuation_date: valDate,
          effective_date: effDate,
          maturity_date: matDate,
          currency: ccy,
          notional: Number(state.notional) || 10000000,
          direction,
          fixed_pay_freq: fixedPayFreq,
          fixed_day_count: fixedDc,
          fixed_bdc: fixedBdc,
          fixed_payment_lag: payLag,
          float_index: index,
          float_reset_freq: floatResetFreq,
          float_pay_freq: floatPayFreq,
          float_day_count: floatDc,
          float_bdc: floatBdc,
          float_payment_lag: payLag,
          spread: (parseFloat(spread) || 0) / 10000,
          leverage: parseFloat(leverage) || 1.0,
        }
        const res = await fetch(API + '/api/price/par-rate', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + session.access_token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        })
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled || state.rateUserEdited) return
        if (typeof data.par_rate === 'number') {
          update({ coupon: data.par_rate.toFixed(8) })
        }
      } catch (_) { /* silent */ }
    })()
    return () => { cancelled = true }
  }, [effDate, matDate, ccy, structure, direction])

  // ── Handlers ─────────────────────────────────────────────────────────────
  const onCouponChange = (val) => update({ coupon: val, rateUserEdited: true })
  const onParClick     = () => update({ coupon: '', rateUserEdited: false })
  const onIndexChange  = (v) => {
    const def = INDEX_DEFAULTS[v] || ['DAILY','ANNUAL','ACT/360']
    update({
      index: v,
      floatResetFreq: def[0], floatPayFreq: def[1], floatDc: def[2],
      rateUserEdited: false,
    })
  }

  // Direction labels for the inner leg badges (structure-aware)
  const fixedDirLabel = direction === 'PAY' ? '\u2192 PAY FIXED' : '\u2190 RECEIVE FIXED'
  const fixedDirColor = direction === 'PAY' ? '#FF6B6B' : '#00D4A8'
  const floatDirLabel = direction === 'PAY' ? '\u2190 RECEIVE FLOAT' : '\u2192 PAY FLOAT'
  const floatDirColor = direction === 'PAY' ? '#00D4A8' : '#FF6B6B'

  const selStyle = { width: '100%' }

  return (
    <>
      {!isBasis && (
        <>
          <LegHeader label="FIXED LEG" dirLabel={fixedDirLabel} dirColor={fixedDirColor} />
          <Row cols={7}>
            <Field label="COUPON (%)">
              <input className="tbw-mono tbw-amber" value={coupon} placeholder="auto"
                     onChange={e => onCouponChange(e.target.value)} />
            </Field>
            <Field label={'\u00A0'}>
              <button type="button" className="tbw-chip is-on" onClick={onParClick}>{'\u25CF'} PAR</button>
            </Field>
            <Field label="PAY FREQ">
              <select style={selStyle} value={fixedPayFreq}
                      onChange={e => update({ fixedPayFreq: e.target.value })}>
                {PAY_FREQS.map(f => <option key={f}>{f}</option>)}
              </select>
            </Field>
            <Field label="DAY COUNT">
              <select style={selStyle} value={fixedDc}
                      onChange={e => update({ fixedDc: e.target.value })}>
                {DAY_COUNTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="BDC">
              <select style={selStyle} value={fixedBdc}
                      onChange={e => update({ fixedBdc: e.target.value })}>
                {BDCS.map(b => <option key={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="CALENDAR">
              <select style={selStyle} value={fixedCal}
                      onChange={e => update({ fixedCal: e.target.value })}>
                {CALENDARS.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </Row>
        </>
      )}

      <LegHeader
        label={isBasis ? 'FLOAT LEG 1' : 'FLOATING LEG'}
        dirLabel={isBasis ? fixedDirLabel : floatDirLabel}
        dirColor={isBasis ? fixedDirColor : floatDirColor}
      />
      <Row cols={8}>
        <Field label="INDEX">
          <select style={selStyle} value={index}
                  onChange={e => onIndexChange(e.target.value)}>
            {(CCY_INDICES[ccy] || ['SOFR']).map(i => <option key={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="SPREAD (bp)">
          <input className="tbw-mono" value={spread}
                 onChange={e => update({ spread: e.target.value })} />
        </Field>
        <Field label="LEVERAGE">
          <input className="tbw-mono" value={leverage}
                 onChange={e => update({ leverage: e.target.value })} />
        </Field>
        <Field label="RESET FREQ">
          <select style={selStyle} value={floatResetFreq}
                  onChange={e => update({ floatResetFreq: e.target.value })}>
            {RESET_FREQS.map(f => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="PAY FREQ">
          <select style={selStyle} value={floatPayFreq}
                  onChange={e => update({ floatPayFreq: e.target.value })}>
            {PAY_FREQS.map(f => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="DAY COUNT">
          <select style={selStyle} value={floatDc}
                  onChange={e => update({ floatDc: e.target.value })}>
            {DAY_COUNTS.map(d => <option key={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="BDC">
          <select style={selStyle} value={floatBdc}
                  onChange={e => update({ floatBdc: e.target.value })}>
            {BDCS.map(b => <option key={b}>{b}</option>)}
          </select>
        </Field>
        <Field label="CALENDAR">
          <select style={selStyle} value={floatCal}
                  onChange={e => update({ floatCal: e.target.value })}>
            {CALENDARS.map(c => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </Row>

      {isBasis && (
        <>
          <LegHeader label="FLOAT LEG 2" dirLabel={floatDirLabel} dirColor={floatDirColor} />
          <Row cols={8}>
            <Field label="INDEX">
              <select style={selStyle} value={index2}
                      onChange={e => update({ index2: e.target.value })}>
                {(CCY_INDICES[ccy] || ['EFFR']).map(i => <option key={i}>{i}</option>)}
              </select>
            </Field>
            <Field label="BASIS SPREAD (bp)">
              <input className="tbw-mono" value={spread}
                     onChange={e => update({ spread: e.target.value })} />
            </Field>
            <Field label="LEVERAGE">
              <input className="tbw-mono" value="1.0" readOnly />
            </Field>
            <Field label="RESET FREQ">
              <select style={selStyle} value={floatResetFreq2}
                      onChange={e => update({ floatResetFreq2: e.target.value })}>
                {RESET_FREQS.map(f => <option key={f}>{f}</option>)}
              </select>
            </Field>
            <Field label="PAY FREQ">
              <select style={selStyle} value={floatPayFreq2}
                      onChange={e => update({ floatPayFreq2: e.target.value })}>
                {PAY_FREQS.map(f => <option key={f}>{f}</option>)}
              </select>
            </Field>
            <Field label="DAY COUNT">
              <select style={selStyle} value={floatDc2}
                      onChange={e => update({ floatDc2: e.target.value })}>
                {DAY_COUNTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="BDC">
              <select style={selStyle} value={floatBdc}
                      onChange={e => update({ floatBdc: e.target.value })}>
                {BDCS.map(b => <option key={b}>{b}</option>)}
              </select>
            </Field>
            <Field label="CALENDAR">
              <select style={selStyle} value={floatCal}
                      onChange={e => update({ floatCal: e.target.value })}>
                {CALENDARS.map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </Row>
        </>
      )}
    </>
  )
}

// ── IR_SWAPTION body ───────────────────────────────────────────────────────

export function SwaptionTermsBody({ state, update }) {
  return (
    <>
      <Row cols={4}>
        <Field label="OPTION EXPIRY">
          <select value={state.expiry ?? '1Y'} onChange={e => update({ expiry: e.target.value })}>
            {['1M','3M','6M','1Y','2Y','3Y','5Y'].map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="NORMAL VOL (bp)">
          <input className="tbw-mono tbw-blue" value={state.volBp ?? '86.5'}
                 onChange={e => update({ volBp: e.target.value })} />
        </Field>
        <Field label="STRIKE (%) blank=ATM">
          <input className="tbw-mono tbw-blue" value={state.strike ?? '3.6390'}
                 onChange={e => update({ strike: e.target.value })} />
        </Field>
        <Field label="HW1F CROSS-CHECK">
          <div className="tbw-mono" style={{ padding: '7px 0', fontSize: 11 }}>
            <span className="tbw-mut">Model:</span> <span className="tbw-blue">83.0bp</span>
            <span className="tbw-mut"> Mkt:</span> <span className="tbw-blue">86.5bp</span>
            <span className="tbw-negative"> △ −3.46bp ⚠</span>
          </div>
        </Field>
      </Row>
      {/* Legs inherited from SwapTermsBody — swaption has same underlying swap legs */}
      <SwapTermsBody state={{ ...state, structure: 'VANILLA' }} update={update} />
    </>
  )
}

// ── RATES_CAP body ──────────────────────────────────────────────────────────

export function CapTermsBody({ state, update }) {
  const ccy         = state.ccy         || 'USD'
  const capRate     = state.capRate     ?? '4.5'
  const index       = state.index       ?? (CCY_INDICES[ccy]?.[0] || 'SOFR')
  const resetFreq   = state.capResetFreq ?? 'DAILY'
  const payFreq     = state.capPayFreq   ?? 'QUARTERLY'
  const dayCount    = state.capDayCount  ?? 'ACT/360'
  const volOverride = state.volOverride  ?? ''
  return (
    <>
      <Row cols={6}>
        <Field label="CAP RATE (%)">
          <input className="tbw-mono tbw-negative" value={capRate}
                 onChange={e => update({ capRate: e.target.value })} />
        </Field>
        <Field label="INDEX">
          <select value={index} onChange={e => update({ index: e.target.value })}>
            {(CCY_INDICES[ccy] || ['SOFR']).map(i => <option key={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="RESET FREQ">
          <select value={resetFreq}
                  onChange={e => update({ capResetFreq: e.target.value })}>
            {RESET_FREQS.map(f => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="PAY FREQ">
          <select value={payFreq}
                  onChange={e => update({ capPayFreq: e.target.value })}>
            {PAY_FREQS.filter(f => f !== 'ZERO_COUPON').map(f => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="DAY COUNT">
          <select value={dayCount}
                  onChange={e => update({ capDayCount: e.target.value })}>
            {DAY_COUNTS.map(d => <option key={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="NORMAL VOL (bp)">
          <input className="tbw-mono tbw-blue" placeholder="\u2014 price to load"
                 value={volOverride}
                 onChange={e => update({ volOverride: e.target.value })} />
        </Field>
      </Row>
    </>
  )
}

// ── RATES_FLOOR body ───────────────────────────────────────────────────────

export function FloorTermsBody({ state, update }) {
  const ccy         = state.ccy         || 'USD'
  const floorRate   = state.floorRate   ?? '3.0'
  const index       = state.index       ?? (CCY_INDICES[ccy]?.[0] || 'SOFR')
  const resetFreq   = state.capResetFreq ?? 'DAILY'
  const payFreq     = state.capPayFreq   ?? 'QUARTERLY'
  const dayCount    = state.capDayCount  ?? 'ACT/360'
  const volOverride = state.volOverride  ?? ''
  return (
    <>
      <Row cols={6}>
        <Field label="FLOOR RATE (%)">
          <input className="tbw-mono tbw-positive" value={floorRate}
                 onChange={e => update({ floorRate: e.target.value })} />
        </Field>
        <Field label="INDEX">
          <select value={index} onChange={e => update({ index: e.target.value })}>
            {(CCY_INDICES[ccy] || ['SOFR']).map(i => <option key={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="RESET FREQ">
          <select value={resetFreq}
                  onChange={e => update({ capResetFreq: e.target.value })}>
            {RESET_FREQS.map(f => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="PAY FREQ">
          <select value={payFreq}
                  onChange={e => update({ capPayFreq: e.target.value })}>
            {PAY_FREQS.filter(f => f !== 'ZERO_COUPON').map(f => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="DAY COUNT">
          <select value={dayCount}
                  onChange={e => update({ capDayCount: e.target.value })}>
            {DAY_COUNTS.map(d => <option key={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="NORMAL VOL (bp)">
          <input className="tbw-mono tbw-blue" placeholder="\u2014 price to load"
                 value={volOverride}
                 onChange={e => update({ volOverride: e.target.value })} />
        </Field>
      </Row>
    </>
  )
}

// ── RATES_COLLAR body ──────────────────────────────────────────────────────

export function CollarTermsBody({ state, update }) {
  const ccy         = state.ccy         || 'USD'
  const capRate     = state.capRate     ?? '4.5'
  const floorRate   = state.floorRate   ?? '3.0'
  const index       = state.index       ?? (CCY_INDICES[ccy]?.[0] || 'SOFR')
  const resetFreq   = state.capResetFreq ?? 'DAILY'
  const payFreq     = state.capPayFreq   ?? 'QUARTERLY'
  const dayCount    = state.capDayCount  ?? 'ACT/360'
  return (
    <>
      <Row cols={6}>
        <Field label="CAP RATE (%)">
          <input className="tbw-mono tbw-negative" value={capRate}
                 onChange={e => update({ capRate: e.target.value })} />
        </Field>
        <Field label="FLOOR RATE (%)">
          <input className="tbw-mono tbw-positive" value={floorRate}
                 onChange={e => update({ floorRate: e.target.value })} />
        </Field>
        <Field label="INDEX">
          <select value={index} onChange={e => update({ index: e.target.value })}>
            {(CCY_INDICES[ccy] || ['SOFR']).map(i => <option key={i}>{i}</option>)}
          </select>
        </Field>
        <Field label="RESET FREQ">
          <select value={resetFreq}
                  onChange={e => update({ capResetFreq: e.target.value })}>
            {RESET_FREQS.map(f => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="PAY FREQ">
          <select value={payFreq}
                  onChange={e => update({ capPayFreq: e.target.value })}>
            {PAY_FREQS.filter(f => f !== 'ZERO_COUPON').map(f => <option key={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="DAY COUNT">
          <select value={dayCount}
                  onChange={e => update({ capDayCount: e.target.value })}>
            {DAY_COUNTS.map(d => <option key={d}>{d}</option>)}
          </select>
        </Field>
      </Row>
    </>
  )
}

// ── FX stubs for future reference (Sprint 11+) ─────────────────────────────

export function FxForwardTermsBody({ state, update }) {
  return (
    <Row cols={6}>
      <Field label="BASE CCY"><select><option>USD</option><option>EUR</option></select></Field>
      <Field label="QUOTE CCY"><select><option>EUR</option><option>GBP</option></select></Field>
      <Field label="SPOT RATE"><input className="tbw-mono" defaultValue="1.0823" /></Field>
      <Field label="FWD POINTS"><input className="tbw-mono" defaultValue="+12.4" /></Field>
      <Field label="VALUE DATE"><input type="date" /></Field>
      <Field label="SETTLEMENT"><select><option>PHYSICAL</option><option>NDF</option></select></Field>
    </Row>
  )
}

export function FxOptionTermsBody({ state, update }) {
  // Placeholder — expand in Sprint 11+ when FX options come online
  return <div className="tbw-mut">FX Option terms — Sprint 11+</div>
}

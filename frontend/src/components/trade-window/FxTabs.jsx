// trade-window/FxTabs.jsx
import { DELTA_LABEL } from './fx-shape'
// ────────────────────────────────────────────────────────────────────────────────────
// DETAILS, CASHFLOWS and CURVE SCENARIO for an FX or crypto forward. A forward
// has one settlement and no schedule, so these are purpose-built views over
// the priced quote rather than the swap panels:
//   FxDetailsPanel   — the term sheet as it will be booked, and the market it was priced on
//   FxCashflowsPanel — the settlement flows (deliverable: two legs; NDF: one net cash amount)
//   FxScenarioPanel  — the forward curve on a chart that drags, the fixings beside it, and spot and
//                      rate shocks repriced with the same closed form the engine uses
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSessionSafe } from '../../lib/session'
import { apiFetch } from '../../lib/api'
import FxScenarioChart from './FxScenarioChart'
import {
  FIXING_DAYS, SPOT_BOUND_PCT, applyTenorDrag, carryFactor, carryPoints, curveNodes, daysBetween, fixingSeries, interpPoints,
  latestFixing, reprice, rippleWeights, settlementAmount, shockedCurve, spotLagDays, spotPctFromDrag, tenorBounds,
} from './fx-scenario'
const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

const fmt = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })
const rateDp = (q) => q?.base_currency && ['BTC', 'ETH', 'SOL'].includes(q.base_currency) ? 2 : q?.pair === 'USDJPY' ? 3 : 5
const secHdr = { fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--text)', fontFamily: 'var(--sans)', paddingLeft: 10, borderLeft: '3px solid var(--accent)', lineHeight: 1.2, margin: '14px 0 10px' }
const lbl = { fontSize: '0.8rem', letterSpacing: '0.12em', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }
const th = { ...lbl, padding: '6px 8px 6px 0', textAlign: 'right', borderBottom: '1px solid var(--border-hi)' }
const td = { fontSize: '0.8125rem', fontFamily: 'var(--mono)', color: 'var(--text)', padding: '6px 8px 6px 0', textAlign: 'right', borderBottom: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' }
const tdL = { ...td, textAlign: 'left', fontFamily: 'var(--sans)' }
const wrap = { padding: '0 16px 16px', fontFamily: 'var(--sans)' }

const Empty = ({ what }) => (
  <div className="empty-state" style={{ padding: '40px 24px' }}>
    <div className="empty-icon">◇</div>
    <div className="empty-title">Price the ticket first</div>
    <div className="empty-sub">{what} come from the priced quote: press PRICE on the TRADE tab and come back.</div>
  </div>
)

function Grid({ items, cols = 3 }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
      {items.map(([k, v, s, testId, raw]) => (
        <div key={k} style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '7px 9px', background: 'var(--bg-deep)' }}>
          <div style={{ ...lbl, fontSize: '0.76rem', marginBottom: 2 }}>{k}</div>
          <div data-testid={testId} data-value={raw} style={{ fontFamily: 'var(--mono)', fontSize: '0.9375rem', color: 'var(--text-hi)' }}>{v ?? '—'}</div>
          {s && <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{s}</div>}
        </div>
      ))}
    </div>
  )
}

// ── DETAILS ────────────────────────────────────────────────────────────────────
export function FxDetailsPanel({ quote, terms, crypto }) {
  if (!quote) return <Empty what="The terms" />
  const t = terms || {}
  const ndf = quote.shape === 'NDF' || t.settlement_type === 'NON_DELIVERABLE'
  const dp = rateDp(quote)
  if (quote.shape === 'OPTION') {
    const cash = (t.settlement_type || quote.settlement_type) === 'NON_DELIVERABLE'
    return (
      <div className="tbw-no-drag" style={wrap}>
        <div style={secHdr}>TERM SHEET · AS IT WILL BE BOOKED</div>
        <Grid items={[
          ['INSTRUMENT', crypto ? 'DIGITAL-ASSET OPTION (NDO)' : cash ? 'FX NON-DELIVERABLE OPTION' : 'FX OPTION', `${quote.pair} · canonical record v2 · ${crypto ? 'ISDA Digital Asset Derivatives Definitions' : 'ISDA FX and Currency Option Definitions'}`],
          ['OPTION', quote.style === 'TOUCH' ? (quote.touch_type || '').replace(/_/g, ' ') : quote.style === 'DIGITAL' ? `${quote.base_currency} ${quote.option_type} DIGITAL` : `${quote.base_currency} ${quote.option_type}${quote.style && quote.style !== 'EUROPEAN' ? ' · ' + quote.style.replace('_', ' ') : ''}`,
            quote.style === 'TOUCH' ? `pays ${fmt(quote.payout, 0)} ${quote.payout_currency === 'BASE' ? quote.base_currency : quote.quote_currency} ${quote.pay_at_hit ? 'at the hit' : 'at expiry'}` : quote.style === 'DIGITAL' ? `pays ${fmt(quote.payout, 0)} ${quote.payout_currency === 'BASE' ? quote.base_currency : quote.quote_currency} if ${quote.option_type === 'CALL' ? 'above' : 'below'} the strike` : `the right to ${quote.option_type === 'CALL' ? 'buy' : 'sell'} ${quote.base_currency} against ${quote.quote_currency}${quote.style === 'AMERICAN' ? ', any day to expiry' : ''}`],
          ...(quote.style === 'BARRIER' ? [['BARRIER', `${(quote.barrier_type || '').replace('_', '-AND-')} at ${fmt(quote.barrier, dp)}`, `continuous monitoring${quote.rebate ? ` · rebate ${quote.rebate} ${quote.quote_currency} per ${quote.base_currency}` : ''}`]] : []),
          ...(quote.style === 'DOUBLE_BARRIER' || (quote.style === 'TOUCH' && (quote.touch_type || '').startsWith('DOUBLE')) ? [['BARRIERS', `${fmt(quote.lower, dp)} – ${fmt(quote.upper, dp)}`, `${(quote.barrier_type || quote.touch_type || '').replace(/_/g, ' ')} · continuous monitoring`]] : []),
          ...(quote.style === 'TOUCH' && !(quote.touch_type || '').startsWith('DOUBLE') ? [['BARRIER', fmt(quote.barrier, dp), 'continuous monitoring']] : []),
          ['SIDE', `${quote.direction} the option`, quote.direction === 'BUY' ? 'we pay the premium and hold the right' : 'we receive the premium and are exercised against'],
          ['NOTIONAL', `${fmt(quote.base_notional, 0)} ${quote.base_currency}`, `${fmt(quote.quote_notional)} ${quote.quote_currency} at the strike`],
          ...(quote.style !== 'TOUCH' ? [['STRIKE', fmt(quote.strike, dp), quote.strike === quote.forward ? 'at the forward' : `forward ${fmt(quote.forward, dp)}`]] : []),
          ['EXPIRY', quote.expiry_date, `${t.expiration_time || t.expiry_time || (crypto ? '08:00 UTC' : '10:00 New York')} · ${quote.style === 'AMERICAN' ? 'American' : 'European'} · T = ${fmt(quote.t_expiry, 4)}y`],
          ['SETTLEMENT DATE', quote.settlement_date, cash ? `cash in ${quote.quote_currency}${crypto ? ' against the settlement price' : ''}` : 'delivery of both currencies'],
          ['PREMIUM', `${fmt(Math.abs(quote.npv))} ${quote.quote_currency}`, `${quote.direction === 'BUY' ? 'paid' : 'received'} on ${quote.valuation_date} · ${fmt(Math.abs(quote.npv) / quote.base_notional / quote.spot * 100, 3)}% of ${quote.base_currency} notional`],
          [cash ? (crypto ? 'SETTLEMENT PRICE SOURCE' : 'FIXING SOURCE') : 'FIXING', cash ? (t.settlement_price_source || t.fixing_source || '—') : 'none (deliverable)', cash ? `on ${quote.expiry_date}` : ''],
          ['CALCULATION AGENT', t.calculation_agent || 'none named', 'automatic exercise'],
        ]} />
        <div style={secHdr}>MARKET IT WAS PRICED ON</div>
        <Grid items={[
          ['SPOT', fmt(quote.spot, dp), quote.spot_source || ''],
          ['FORWARD TO SETTLEMENT', fmt(quote.forward, dp), quote.forward_mode === 'MARKET' && quote.market_points != null ? 'quoted points' : 'implied from yields'],
          ['VOL', `${fmt(quote.vol_pct, 3)}%`, `${quote.vol_tier} · ${quote.vol_source}${quote.vol_marks ? ' · ' + quote.vol_marks : ''}`],
          ...(quote.forward_delta != null ? [['FORWARD DELTA', `${fmt(quote.forward_delta * 100, 1)}%`, `d1 ${fmt(quote.d1, 4)} · d2 ${fmt(quote.d2, 4)}`]] : [['DELTA', `${fmt(quote.delta_base_units, 0)} ${quote.base_currency}`, 'by repricing, ±1% spot']]),
          [`${quote.quote_currency} CURVE`, quote.quote_curve || '—', `DF ${fmt(quote.df_quote, 6)} to settlement${quote.quote_curve_snapshot ? ' · ' + quote.quote_curve_snapshot : ''}`],
          ['MODEL', quote.method || (crypto ? 'Black-76 on the carry forward' : 'Garman–Kohlhagen'), quote.style && quote.style !== 'EUROPEAN' ? 'same lognormal dynamics; σ from the ATM/RR/BF surface at the strike, held flat for the barrier' : crypto ? 'the FX option engine with the funding rate as the base rate; σ from the ATM/RR/BF surface' : 'Black–Scholes with the base currency as the dividend-paying asset; σ from the ATM/RR/BF surface'],
        ]} />
        <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 10 }}>Terms are edited on the TRADE tab; this is the record the counterparty will sign.</div>
      </div>
    )
  }
  return (
    <div className="tbw-no-drag" style={wrap}>
      <div style={secHdr}>TERM SHEET · AS IT WILL BE BOOKED</div>
      <Grid items={[
        ['INSTRUMENT', crypto ? 'CRYPTO FORWARD' : ndf ? 'FX NDF' : quote.shape === 'SPOT' ? 'FX SPOT' : 'FX FORWARD', `${quote.pair} · canonical record v2`],
        ['DIRECTION', `${quote.direction} ${quote.base_currency}`, `${quote.direction === 'BUY' ? 'receive' : 'deliver'} ${quote.base_currency}, ${quote.direction === 'BUY' ? 'pay' : 'receive'} ${quote.quote_currency}`],
        ['NOTIONAL', `${fmt(quote.base_notional, crypto ? 4 : 0)} ${quote.base_currency}`, `${fmt(quote.quote_notional)} ${quote.quote_currency} at the strike`],
        [crypto ? 'FORWARD PRICE (K)' : 'FORWARD RATE (K)', fmt(quote.forward_rate, dp), quote.forward_rate === quote.forward ? 'struck at the fair forward' : `fair ${fmt(quote.forward, dp)}`],
        ['TRADE DATE', quote.valuation_date, ''],
        [crypto || ndf ? 'SETTLEMENT DATE' : 'VALUE DATE', quote.settlement_date, `T = ${fmt(quote.t, 4)}y · ACT/365`],
        ['SETTLEMENT', crypto || ndf ? `CASH · ${quote.quote_currency}` : 'PHYSICAL · both currencies', crypto || ndf ? `net of (fixing − K) × ${fmt(quote.base_notional, crypto ? 4 : 0)} ${quote.base_currency}` : 'full exchange of principals'],
        [crypto || ndf ? 'FIXING SOURCE' : 'FIXING', crypto || ndf ? (t.settlement_price_source || t.fixing_source || '—') : 'none (deliverable)', crypto || ndf ? `on ${t.fixing_date || t.valuation_date || quote.settlement_date}${t.valuation_time ? ' · ' + t.valuation_time : ''}` : ''],
        ['CALCULATION AGENT', t.calculation_agent || 'none named', crypto ? (t.disruption_fallback || '') : ''],
      ]} />
      <div style={secHdr}>MARKET IT WAS PRICED ON</div>
      <Grid items={[
        ['SPOT', fmt(quote.spot, dp), `${quote.spot_source || ''}`],
        ['FAIR FORWARD', fmt(quote.forward, dp), `${fmt(quote.forward_points, crypto ? 2 : 1)} ${crypto ? quote.quote_currency : 'pts'} · ${quote.forward_mode === 'MARKET' && quote.market_points != null ? 'quoted points' : crypto ? 'implied from funding' : 'implied from yields'}`],
        ['PARITY FORWARD', fmt(quote.implied_forward, dp), quote.basis_points != null ? `basis ${fmt(quote.basis_points, crypto ? 2 : 1)} vs quoted` : 'no quoted points'],
        [`${quote.quote_currency} CURVE`, quote.quote_curve || '—', `DF ${fmt(quote.df_quote, 6)} · zero ${fmt(quote.quote_rate * 100, 3)}%${quote.quote_curve_snapshot ? ' · ' + quote.quote_curve_snapshot : ''}`],
        [crypto ? `${quote.base_currency} FUNDING` : `${quote.base_currency} CURVE`, quote.base_discounting || '—', `DF ${fmt(quote.df_base, 6)} · ${crypto ? 'rate' : 'zero'} ${fmt(quote.base_rate * 100, 3)}%`],
        ['MODEL', crypto ? 'F = S·e^(−r_fund·T)/DF_quote' : 'F = S·DF_base/DF_quote', 'NPV = ±N·(F − K)·DF_quote'],
      ]} />
      <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 10 }}>Terms are edited on the TRADE tab; this is the record the counterparty will sign.</div>
    </div>
  )
}

// ── CASHFLOWS ──────────────────────────────────────────────────────────────────
export function FxCashflowsPanel({ quote, crypto }) {
  if (!quote) return <Empty what="The settlement flows" />
  const ndf = crypto || quote.shape === 'NDF'
  const sign = quote.direction === 'BUY' ? 1 : -1
  const dp = rateDp(quote)
  if (quote.shape === 'OPTION') {
    const call = quote.option_type === 'CALL'
    const payoutStyle = quote.style === 'DIGITAL' || quote.style === 'TOUCH'
    const intrinsic = payoutStyle ? sign * (quote.style === 'DIGITAL' ? ((call ? quote.forward > quote.strike : quote.forward < quote.strike) ? quote.payout * (quote.payout_currency === 'BASE' ? quote.forward : 1) : 0) : 0)
                                  : sign * quote.base_notional * Math.max(call ? quote.forward - quote.strike : quote.strike - quote.forward, 0)
    const premium = -sign * Math.abs(quote.npv)
    return (
      <div className="tbw-no-drag" style={wrap}>
        <div style={secHdr}>FLOWS · PREMIUM {quote.valuation_date} · SETTLEMENT {quote.settlement_date}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ ...th, textAlign: 'left' }}>FLOW</th><th style={th}>DATE</th><th style={th}>AMOUNT</th><th style={th}>DF</th><th style={th}>PV {quote.quote_currency}</th></tr></thead>
          <tbody>
            <tr><td style={tdL}>PREMIUM<div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{sign > 0 ? 'paid' : 'received'} on the trade date; not part of the value after it is paid</div></td>
              <td style={td}>{quote.valuation_date}</td><td style={{ ...td, color: premium >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(premium)} {quote.quote_currency}</td><td style={td}>1.000000</td><td style={td}>{fmt(premium)}</td></tr>
            <tr><td style={tdL}>{payoutStyle ? 'PAYOUT' : 'PAYOFF AT EXPIRY'}<div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{quote.style === 'TOUCH' ? `${fmt(quote.payout, 0)} ${quote.payout_currency === 'BASE' ? quote.base_currency : quote.quote_currency} ${quote.pay_at_hit ? 'when the barrier is hit' : 'at expiry if ' + ((quote.touch_type || '').includes('NO') ? 'never touched' : 'touched')}; at today's forward the barrier is not reached` : quote.style === 'DIGITAL' ? `${fmt(quote.payout, 0)} ${quote.payout_currency === 'BASE' ? quote.base_currency : quote.quote_currency} if the fixing is ${call ? 'above' : 'below'} ${fmt(quote.strike, dp)}; shown at today's forward` : `max(${call ? 'S − K' : 'K − S'}, 0) × N, at today's forward; the fixing on ${quote.expiry_date} decides${quote.style === 'BARRIER' || quote.style === 'DOUBLE_BARRIER' ? ' and the barrier must not have knocked it out' : ''}`}</div></td>
              <td style={td}>{quote.settlement_date}</td><td style={{ ...td, color: intrinsic >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(intrinsic)} {quote.quote_currency}</td><td style={td}>{fmt(quote.df_quote, 6)}</td><td style={td}>{fmt(intrinsic * quote.df_quote)}</td></tr>
            <tr><td style={{ ...tdL, fontWeight: 700, borderBottom: 'none' }}>OPTION VALUE</td><td style={{ ...td, borderBottom: 'none' }} colSpan={3}>{quote.time_value != null ? `intrinsic ${fmt(intrinsic * quote.df_quote)} + time value ${fmt(sign * quote.time_value)}` : `${quote.method || ''}`}</td>
              <td style={{ ...td, fontWeight: 700, borderBottom: 'none', color: quote.npv >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(quote.npv)}</td></tr>
          </tbody>
        </table>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 10, lineHeight: 1.5 }}>
          {quote.settlement_type === 'NON_DELIVERABLE' ? `Cash-settled in ${quote.quote_currency} against the fixing.` : `Deliverable: on exercise ${fmt(quote.base_notional, 0)} ${quote.base_currency} against ${fmt(quote.quote_notional)} ${quote.quote_currency} on the settlement date.`}
          {' '}The option's value is the discounted expected payoff under the forward's lognormal distribution at {fmt(quote.vol_pct, 2)}% vol, which is the engine's Garman–Kohlhagen figure.
        </div>
      </div>
    )
  }
  const rows = ndf ? [
    { leg: `NET CASH SETTLEMENT · ${quote.quote_currency}`, ccy: quote.quote_currency, date: quote.settlement_date,
      amount: sign * quote.base_notional * (quote.forward - quote.forward_rate), df: quote.df_quote,
      note: `(F − K) × N at today's forward; the fixing on ${quote.settlement_date} decides the actual amount` },
  ] : [
    { leg: `${sign > 0 ? 'RECEIVE' : 'PAY'} ${quote.base_currency}`, ccy: quote.base_currency, date: quote.settlement_date, amount: sign * quote.base_notional, df: quote.df_quote, inQuote: sign * quote.base_notional * quote.forward, note: `${quote.base_currency} principal, valued at the fair forward` },
    { leg: `${sign > 0 ? 'PAY' : 'RECEIVE'} ${quote.quote_currency}`, ccy: quote.quote_currency, date: quote.settlement_date, amount: -sign * quote.quote_notional, df: quote.df_quote, inQuote: -sign * quote.quote_notional, note: `${quote.base_currency} notional × K` },
  ]
  const pv = rows.reduce((s, r) => s + (r.inQuote ?? r.amount) * r.df, 0)
  return (
    <div className="tbw-no-drag" style={wrap}>
      <div style={secHdr}>SETTLEMENT · {quote.settlement_date}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={{ ...th, textAlign: 'left' }}>LEG</th><th style={th}>DATE</th><th style={th}>AMOUNT</th>
          {!ndf && <th style={th}>IN {quote.quote_currency} AT F</th>}<th style={th}>DF</th><th style={th}>PV {quote.quote_currency}</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.leg}>
              <td style={tdL}>{r.leg}<div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{r.note}</div></td>
              <td style={td}>{r.date}</td>
              <td style={{ ...td, color: r.amount >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(r.amount, crypto && r.ccy !== 'USD' ? 4 : 0)} {r.ccy}</td>
              {!ndf && <td style={td}>{fmt(r.inQuote)}</td>}
              <td style={td}>{fmt(r.df, 6)}</td>
              <td style={{ ...td, color: (r.inQuote ?? r.amount) * r.df >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt((r.inQuote ?? r.amount) * r.df)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...tdL, fontWeight: 700, borderBottom: 'none' }}>NPV</td><td style={{ ...td, borderBottom: 'none' }} colSpan={ndf ? 3 : 4}></td>
            <td style={{ ...td, fontWeight: 700, borderBottom: 'none', color: pv >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(pv)}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 10, lineHeight: 1.5 }}>
        {ndf ? `Cash-settled: one payment in ${quote.quote_currency} on the settlement date, sized by the fixing against K ${fmt(quote.forward_rate, dp)}. Today's estimate uses the fair forward ${fmt(quote.forward, dp)}.`
             : `Deliverable: both principals exchange on the value date. Both legs are expressed in ${quote.quote_currency} at today's fair forward ${fmt(quote.forward, dp)} and discounted on the ${quote.quote_currency} curve, which is the engine's ±N·(F − K)·DF.`}
        {' '}Matches the engine's NPV of {fmt(quote.npv)} {quote.quote_currency} within rounding.
      </div>
    </div>
  )
}

// ── CURVE SCENARIO ─────────────────────────────────────────────────────────────
// The engine's closed form, repriced here (fx-scenario.js): NPV = ±N·(F' − K)·DF_q', with
// DF' = DF·exp(−Δr·T) for a parallel shift on that curve, and F' the forward read off the
// curve on the chart: spot plus the points interpolated to the settlement date, after the
// spot shock, the rate shocks and whatever was dragged. Exact for a forward, so no round
// trip is needed and the chart, the tiles and the ladders move together.
function Slider({ label, v, set, min, max, step, unit }) {
  const shown = Number(v.toFixed(2))            // a dragged curve leaves the spot shock between the slider's steps
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 90px', gap: 10, alignItems: 'center', marginBottom: 8 }}>
      <span style={lbl}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={e => set(Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} />
      <span style={{ fontFamily: 'var(--mono)', fontSize: '0.875rem', color: v === 0 ? 'var(--text-dim)' : v > 0 ? 'var(--red)' : 'var(--blue)', textAlign: 'right' }}>{v > 0 ? '+' : ''}{shown}{unit}</span>
    </div>
  )
}

function StyleLadder({ crypto,  quote }) {
  // every style repriced by the engine itself on a grid of spot and vol shocks (POST /api/currency/option/ladder)
  const [lad, setLad] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let dead = false
    setLad(null); setErr(null)
    ;(async () => {
      try {
        const session = await getSessionSafe()
        const body = { pair: quote.pair, option_type: quote.option_type, base_notional: quote.base_notional, expiry_date: quote.expiry_date, settlement_date: quote.settlement_date,
                       strike: quote.strike, direction: quote.direction, valuation_date: quote.valuation_date, spot: quote.spot, settlement_type: quote.settlement_type,
                       style: quote.style, payout: quote.payout, payout_currency: quote.payout_currency, barrier_type: quote.barrier_type, barrier: quote.barrier,
                       lower: quote.lower, upper: quote.upper, rebate: quote.rebate || 0, touch_type: quote.touch_type, pay_at_hit: !!quote.pay_at_hit }
        const r = await fetch(`${API}/api/currency/option/ladder`, { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const j = await r.json()
        if (!r.ok) throw new Error(j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : `ladder ${r.status}`)
        if (!dead) setLad(j)
      } catch (e) { if (!dead) setErr(e.message) }
    })()
    return () => { dead = true }
  }, [quote])
  const dp = rateDp(quote)
  if (err) return <div style={{ color: 'var(--red)', padding: '16px 0' }}>{err}</div>
  if (!lad) return <div style={{ color: 'var(--text-dim)', padding: '16px 0' }}>Repricing the {(quote.style || '').replace('_', ' ').toLowerCase()} on the shock grid…</div>
  const vols = lad.vol_shocks_pts
  return (
    <div>
      <div style={secHdr}>NPV {quote.quote_currency} · SPOT SHOCK × VOL SHOCK (points)</div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>SPOT</th><th style={th}>LEVEL</th>{vols.map(v => <th key={v} style={th}>{v > 0 ? '+' : ''}{v} pt</th>)}</tr></thead>
        <tbody>{lad.rows.map(r => (
          <tr key={r.spot_pct} style={{ background: r.spot_pct === 0 ? 'var(--accent-glow)' : 'transparent' }}>
            <td style={td}>{r.spot_pct > 0 ? '+' : ''}{r.spot_pct}%</td><td style={td}>{fmt(r.spot, dp)}</td>
            {vols.map(v => { const x = r.npv[String(v)]; return <td key={v} style={{ ...td, color: x == null ? 'var(--text-mute)' : x >= 0 ? 'var(--green)' : 'var(--red)' }}>{x == null ? '—' : fmt(x)}</td> })}
          </tr>))}</tbody>
      </table>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 10 }}>Base NPV {fmt(lad.base_npv)} at vol {fmt(lad.base_vol_pct, 2)}% · {DELTA_LABEL(crypto)} {fmt(lad.spot01)} · vega {fmt(lad.vega)} per point. A barrier or touch option's value is not smooth near its barrier; read the whole row, not a slope.</div>
    </div>
  )
}

// Which source the trade settles on, and the latest stored fixing of exactly that source.
function FixingSource({ source, time, date, last, cash, dp }) {
  const line = { fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.5, marginTop: 8 }
  if (!source) return <div style={line}>{cash ? 'No settlement price source is named on this ticket.' : 'Deliverable: both currencies are exchanged and no fixing is taken. The amount is what that exchange is worth at the rate entered.'}</div>
  return (
    <div style={line} data-testid="fx-scenario-source">
      Settles on {source}{time ? `, ${time}` : ''}{date ? `, on ${date}` : ''}.{' '}
      {last ? <span>Latest stored fixing: {last.source}, {last.date}, <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{fmt(last.value, dp)}</span>.</span>
            : <span>No fixing stored for this source yet</span>}
    </div>
  )
}

export function FxScenarioPanel({ quote, crypto, terms }) {
  const [spot, setSpot] = useState(0)
  const [qbp, setQbp] = useState(0)
  const [bbp, setBbp] = useState(0)
  const [vpt, setVpt] = useState(0)
  const [drags, setDrags] = useState({ pair: null, by: {} })           // tenor → points it has been dragged, for one pair
  const [typed, setTyped] = useState({ pair: null, text: null })       // the scenario fixing as typed; null: it follows the shocked forward
  const [market, setMarket] = useState(null)             // { pair, row }: the pair's spot, points and pip
  const [stored, setStored] = useState(null)             // { pair, rows }: the pair's recent fixings
  const origin = useRef(null)                            // the shocks as they stood when a drag began
  const pair = quote?.pair
  const dp = rateDp(quote)
  const option = quote?.shape === 'OPTION'
  const european = !option || !quote.style || quote.style === 'EUROPEAN'

  // a dragged curve and a typed fixing belong to the pair they were made on: another pair starts clean
  const moves = drags.pair === pair ? drags.by : {}
  const fixingText = typed.pair === pair ? typed.text : null
  const setMoves = (by) => setDrags({ pair, by })
  const setFixingText = (text) => setTyped({ pair, text })
  // the curve the ticket priced on: read again with every priced quote, so the chart's base is the quote's
  useEffect(() => {
    if (!pair) return
    let dead = false
    apiFetch('/api/currency/pairs').then(r => (r.ok ? r.json() : null))
      .then(j => { const row = j?.pairs?.find(p => p.pair === pair); if (!dead && row) setMarket({ pair, row }) })
      .catch(() => {})                                   // no curve from the API: the chart draws the quote's own carry
    return () => { dead = true }
  }, [pair, quote])
  // the fixings; when the request fails the chart is drawn without its left side
  useEffect(() => {
    if (!pair) return
    let dead = false
    apiFetch(`/api/currency/fixings/${encodeURIComponent(pair)}?days=${FIXING_DAYS}`).then(r => (r.ok ? r.json() : null))
      .then(j => { if (!dead) setStored({ pair, rows: Array.isArray(j?.fixings) ? j.fixings : [] }) })
      .catch(() => { if (!dead) setStored({ pair, rows: [] }) })
    return () => { dead = true }
  }, [pair])

  // the base curve: the quoted points the ticket priced on, or, without them, its own carry from spot to the forward
  const model = useMemo(() => {
    if (!quote) return null
    const row = market?.pair === pair ? market.row : null
    const pip = row?.pip > 0 ? row.pip : crypto ? 1 : /JPY$/.test(pair || '') ? 0.01 : 1e-4
    const settleX = daysBetween(quote.valuation_date, quote.settlement_date) ?? Math.round((option ? quote.t_settle : quote.t) * 365)
    const quoted = quote.forward_mode === 'MARKET' && quote.market_points != null && !!row?.forward_points && Object.keys(row.forward_points).length > 0
    const lag = spotLagDays({ points: quoted ? row.forward_points : null, settleDays: settleX, marketPoints: quote.market_points, crypto })
    const days = Math.max(settleX - lag, 0)              // points are quoted from the spot date
    const nodes = curveNodes(quoted ? row.forward_points : carryPoints({ spot: quote.spot, forward: quote.forward, days, pip }), lag)
    return { pip, settleX, quoted, days, nodes, label: quoted ? row.forward_curve?.label : null }
  }, [quote, crypto, market, pair, option])

  if (!quote) return <Empty what="Scenarios" />
  const { pip, settleX, nodes, days } = model
  const rq = european ? qbp : 0, rb = european ? bbp : 0                     // the rate sliders exist for the closed form only
  const moved = nodes.map(n => moves[n.tenor] || 0)
  const dPoints = interpPoints(Object.fromEntries(nodes.map((n, i) => [n.tenor, moved[i]])), days)
  const at = (o = {}) => reprice(quote, { spotPct: spot, quoteBp: rq, baseBp: rb, volPts: vpt, dPoints, pip, ...o })
  const base = reprice(quote)
  const now = at()
  const curve = shockedCurve({ spot: quote.spot, pip, nodes, moves: moved, spotPct: spot, quoteBp: rq, baseBp: rb })
  const tenorsMoved = moved.some(m => m !== 0)
  const anyMove = spot !== 0 || rq !== 0 || rb !== 0 || tenorsMoved
  const d = (x) => x - base.npv
  const reset = () => { setSpot(0); setQbp(0); setBbp(0); setVpt(0); setMoves({}); setFixingText(null) }

  // the chart reports a drag as a distance in price from where it began; the shocks are worked out here
  const onDragStart = () => { origin.current = { moves: moved.slice(), spot } }
  const onDrag = ({ index, whole, dPrice }) => {
    const o = origin.current
    if (!o) return
    const k = index - 1                                                      // the chart's first point is spot
    if (whole || k < 0) {
      const ref = k < 0 ? quote.spot : (quote.spot + (nodes[k].points + o.moves[k]) * pip) * carryFactor(rq, rb, nodes[k].x)
      setSpot(spotPctFromDrag({ originPct: o.spot, dPrice, ref }))
    } else {
      const perPoint = pip * (1 + o.spot / 100) * carryFactor(rq, rb, nodes[k].x)     // so the point stays under the cursor
      const next = applyTenorDrag({ origin: o.moves, weights: rippleWeights(nodes, k), move: dPrice / perPoint, bounds: tenorBounds(nodes, { spot: quote.spot, pip }) })
      setMoves(Object.fromEntries(nodes.map((n, i) => [n.tenor, next[i]])))
    }
  }

  // the fixing the trade would settle on, and what it pays
  const cash = crypto || quote.shape === 'NDF' || (option && (terms?.settlement_type || quote.settlement_type) === 'NON_DELIVERABLE')
  const source = terms?.settlement_price_source || terms?.fixing_source || null
  const fixTime = option ? (terms?.expiration_time || terms?.expiry_time || terms?.valuation_time) : terms?.valuation_time
  const fixDate = option ? quote.expiry_date : (terms?.fixing_date || terms?.valuation_date || quote.settlement_date)
  const rows = stored?.pair === pair ? stored.rows : []
  const last = latestFixing(rows, source)
  const strike = option ? quote.strike : quote.forward_rate
  const fixingShown = fixingText ?? (Number.isFinite(now.forward) ? now.forward.toFixed(dp) : '')
  const fixing = parseFloat(String(fixingShown).replace(/,/g, ''))
  const amount = settlementAmount({ shape: option ? 'OPTION' : 'FORWARD', optionType: quote.option_type, direction: quote.direction, notional: quote.base_notional, strike, fixing })
  const sgn = quote.direction === 'BUY' ? '+' : '−'
  const formula = option ? `${sgn}N × max(${quote.option_type === 'CALL' ? 'fixing − K' : 'K − fixing'}, 0)` : `${sgn}N × (fixing − K)`
  const nDp = crypto ? 4 : 0

  const chart = (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={secHdr}>FORWARD CURVE · {pair}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
          {model.quoted ? `Spot plus the quoted points${model.label ? ` (${model.label})` : ''}` : 'No quoted points on this ticket: the curve is its own carry from spot to the forward'}
        </div>
      </div>
      <FxScenarioChart today={quote.valuation_date} curve={curve} fixings={fixingSeries(rows, source)} tradeSource={source} strike={strike}
        settle={{ x: settleX, date: quote.settlement_date }} expiry={option ? { x: daysBetween(quote.valuation_date, quote.expiry_date), date: quote.expiry_date } : null}
        forward={now.forward} dp={dp} moved={anyMove} onDragStart={onDragStart} onDrag={onDrag} onDragEnd={() => { origin.current = null }} />
    </div>
  )
  const forwardTile = ['FORWARD', fmt(now.forward, dp), `base ${fmt(base.forward, dp)}`, 'fx-scenario-forward', now.forward]
  const resetButton = <button onClick={reset} className="btn" data-testid="fx-scenario-reset" style={{ marginTop: 4 }}>RESET</button>
  const banner = { background: 'rgba(240,160,32,0.06)', borderBottom: '1px solid rgba(240,160,32,0.15)', padding: '5px 12px', margin: '0 -16px', fontSize: '0.8125rem', color: 'var(--amber)' }

  if (!european) {
    return (
      <div className="tbw-no-drag" style={wrap}>
        <div style={banner}>⚠ Scenario: the engine repriced on every cell of the ladder ({quote.method}); for analysis only, nothing is saved.</div>
        {chart}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)', gap: 20, alignItems: 'start', marginTop: 12 }}>
          <div>
            <Grid cols={1} items={[forwardTile]} />
            {resetButton}
          </div>
          <div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
              The chart moves the forward to settlement in closed form. The ladder below is the API's: the engine reprices this {(quote.style || '').replace(/_/g, ' ').toLowerCase()} option on its own grid of spot and vol shocks, so it does not follow the dragged curve.
            </div>
            <FixingSource source={source} time={fixTime} date={fixDate} last={last} cash={cash} dp={dp} />
          </div>
        </div>
        <StyleLadder crypto={crypto} quote={quote} />
      </div>
    )
  }

  const spotLadder = [-10, -5, -2, -1, 0, 1, 2, 5, 10]
  const rateLadder = [-100, -50, -25, 0, 25, 50, 100]
  const firstOrder = spot * (quote.spot01 ?? 0) + qbp * (quote.ir01_disc ?? 0) + bbp * (quote.ir01_base ?? 0) + vpt * (quote.vega ?? 0)
  return (
    <div className="tbw-no-drag" style={wrap}>
      <div style={banner}>
        ⚠ Scenario — repriced with the engine's closed form; for analysis only, nothing is saved.
      </div>
      {chart}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 360px) minmax(0, 1fr)', gap: 20 }}>
        <div>
          <div style={secHdr}>SHOCKS</div>
          <Slider label="SPOT" v={spot} set={setSpot} min={-SPOT_BOUND_PCT} max={SPOT_BOUND_PCT} step={0.5} unit="%" />
          <Slider label={`${quote.quote_currency} CURVE`} v={qbp} set={setQbp} min={-200} max={200} step={5} unit="bp" />
          <Slider label={crypto ? `${quote.base_currency} FUNDING` : `${quote.base_currency} CURVE`} v={bbp} set={setBbp} min={-200} max={200} step={5} unit="bp" />
          {option && <Slider label="VOL" v={vpt} set={setVpt} min={-5} max={5} step={0.25} unit="pt" />}
          {resetButton}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 20, alignContent: 'start' }}>
          <div>
            <div style={secHdr}>SHOCKED</div>
            <Grid cols={2} items={[
              forwardTile,
              [`NPV ${quote.quote_currency}`, fmt(now.npv), `base ${fmt(base.npv)}`],
              ['ΔNPV', (d(now.npv) >= 0 ? '+' : '') + fmt(d(now.npv)), 'vs base'],
              ['FIRST ORDER', (firstOrder >= 0 ? '+' : '') + fmt(firstOrder), `${DELTA_LABEL(crypto)}·Δspot + ${crypto ? 'IR01·Δbp + FUND01·Δbp' : 'IR01s·Δbp'}${option ? ' + vega·Δvol' : ''}${tenorsMoved ? ' · without the dragged tenors' : ''}`],
            ]} />
          </div>
          <div>
            <div style={secHdr}>FIXING AT EXPIRY</div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '8px 10px', background: 'var(--bg-deep)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ ...lbl, fontSize: '0.76rem' }}>SCENARIO FIXING</span>
                <input data-testid="fx-scenario-fixing" type="text" inputMode="decimal" aria-label="Scenario fixing" value={fixingShown}
                  onChange={e => setFixingText(e.target.value)} style={{ width: 130, fontFamily: 'var(--mono)', textAlign: 'right' }} />
                {fixingText != null && <button className="btn" onClick={() => setFixingText(null)} title="Follow the shocked forward at settlement again">USE THE FORWARD</button>}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ ...lbl, fontSize: '0.76rem' }}>SETTLEMENT AMOUNT</span>
                <span data-testid="fx-scenario-settlement" data-value={amount ?? ''} style={{ fontFamily: 'var(--mono)', fontSize: '0.9375rem', color: amount == null ? 'var(--text-dim)' : amount >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {amount == null ? '—' : `${amount > 0 ? '+' : ''}${fmt(amount, 2)} ${quote.quote_currency}`}
                </span>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: 4 }}>
                {formula}, with N {fmt(quote.base_notional, nDp)} {quote.base_currency} and K {fmt(strike, dp)}, in {quote.quote_currency}
              </div>
            </div>
            <FixingSource source={source} time={fixTime} date={fixDate} last={last} cash={cash} dp={dp} />
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: '0 20px' }}>
        <div>
          <div style={secHdr}>SPOT LADDER · {quote.quote_currency}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>SPOT</th><th style={th}>LEVEL</th><th style={th}>FORWARD</th><th style={th}>NPV</th><th style={th}>ΔNPV</th></tr></thead>
            <tbody>{spotLadder.map(s => { const r = at({ spotPct: s }); return (
              <tr key={s} style={{ background: s === 0 ? 'var(--accent-glow)' : 'transparent' }}>
                <td style={td}>{s > 0 ? '+' : ''}{s}%</td><td style={td}>{fmt(quote.spot * (1 + s / 100), dp)}</td><td style={td}>{fmt(r.forward, dp)}</td>
                <td style={{ ...td, color: r.npv >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(r.npv)}</td>
                <td style={{ ...td, color: d(r.npv) >= 0 ? 'var(--green)' : 'var(--red)' }}>{d(r.npv) >= 0 ? '+' : ''}{fmt(d(r.npv))}</td>
              </tr>) })}</tbody>
          </table>
        </div>
        <div>
          <div style={secHdr}>RATE LADDER · PARALLEL, BOTH CURVES</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>SHIFT</th><th style={th}>FORWARD</th><th style={th}>NPV</th><th style={th}>ΔNPV</th><th style={th}>{quote.quote_currency} ONLY</th><th style={th}>{crypto ? 'FUNDING' : quote.base_currency} ONLY</th></tr></thead>
            <tbody>{rateLadder.map(b => { const r = at({ quoteBp: b, baseBp: b }); const q = at({ quoteBp: b, baseBp: 0 }); const bb = at({ quoteBp: 0, baseBp: b }); return (
              <tr key={b} style={{ background: b === 0 ? 'var(--accent-glow)' : 'transparent' }}>
                <td style={td}>{b > 0 ? '+' : ''}{b}bp</td><td style={td}>{fmt(r.forward, dp)}</td>
                <td style={{ ...td, color: r.npv >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(r.npv)}</td>
                <td style={{ ...td, color: d(r.npv) >= 0 ? 'var(--green)' : 'var(--red)' }}>{d(r.npv) >= 0 ? '+' : ''}{fmt(d(r.npv))}</td>
                <td style={td}>{d(q.npv) >= 0 ? '+' : ''}{fmt(d(q.npv))}</td><td style={td}>{d(bb.npv) >= 0 ? '+' : ''}{fmt(d(bb.npv))}</td>
              </tr>) })}</tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 10 }}>{option ? `An option is convex in spot: ΔNPV runs ahead of ${DELTA_LABEL(crypto)} × the shock on the way up and behind it on the way down, which is the gamma; the vol slider moves the smile level, not its shape.` : `A forward is linear in spot, so ΔNPV equals ${DELTA_LABEL(crypto)} × the shock exactly; the rate ladder shows the two curve legs offsetting at a fair strike.`}{tenorsMoved ? ' Both ladders are read off the dragged curve.' : ''}</div>
    </div>
  )
}

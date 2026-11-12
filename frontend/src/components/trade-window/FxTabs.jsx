// trade-window/FxTabs.jsx
import { DELTA_LABEL } from './fx-shape'
// ────────────────────────────────────────────────────────────────────────────────────
// DETAILS, CASHFLOWS and CURVE SCENARIO for an FX or crypto forward. A forward
// has one settlement and no schedule, so these are purpose-built views over
// the priced quote rather than the swap panels:
//   FxDetailsPanel   — the term sheet as it will be booked, and the market it was priced on
//   FxCashflowsPanel — the settlement flows (deliverable: two legs; NDF: one net cash amount)
//   FxScenarioPanel  — the forward curve on a chart that drags, the fixings beside it, and spot and
//                      rate shocks repriced with the same closed form the engine uses; for an option,
//                      the pair's vol surface under it (FxVolChart.jsx), moved by the VOL slider
// A booked trade whose fixing date has been reached (state FIXED or SETTLED) has no quote to
// reprice: each panel then states the settled facts as the API sent them.
//
// The ticket prices itself after every change of its terms. Between a change and the price
// that answers it the tabs still hold the last quote (`stale`): each then dims its figures
// and says they are for the terms before the change. The scenario tab asks the API for
// what follows the quote (the pairs answer, the fixings, the style ladder) only while it
// is the tab showing (`active`) and the quote is not stale, once per quote (fx-requests.js).
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { getSessionSafe } from '../../lib/session'
import { Note } from '../common/Note'
import { exportCashflows, exportPackageCashflows } from './fx-export'
import { closedForm, legShocks, legWords, packageFlows, packageGap, repricePackage } from './fx-package'
import { apiFetch } from '../../lib/api'
import FxScenarioChart from './FxScenarioChart'
import FxVolSurface from './FxVolChart'
import FxRateCurve from './FxRateCurve'
import { RISK_FACTORS } from '../../lib/risk-factors'
import { XVA_ROW, XVA_LEFT, XVA_RIGHT } from './xva-shared'
import { ladderKey, ladderShown, ladderWanted, marketKey } from './fx-requests'
import { NOT_A_NUMBER, crybasis01, formatRead, parseNumber } from './fx-ticket'
import {
  FIXING_DAYS, FX_SPOT_LAG_DAYS, RATE_SHOCK_BOUND, SPOT_BOUND_PCT, applyTenorDrag, carryFactor, carryPoints, chartLevels, curveNodes, daysBetween,
  fixingSeries, fixingTime, interpPoints, latestFixing, modelWords, reprice, rippleWeights, settledFacts, settledState, settlementAmount, shockedCurve,
  pillarsShown, shockAtTime, tenorLabel,
  signedChange, spotLagDays, spotPctFromDrag, strikeAsBooked, styleTerms, tenorBounds, tenorMap,
} from './fx-scenario'
const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
// The window's footer is sticky at its bottom (styles.css .tbw-footer: 10px padding above and below a 12px label,
// 2px, and a 13px figure, over a 1px border: about 53px). Each tab ends with that much room so its last row is
// never under the footer.
const FOOTER_H = 56

// A figure that rounds to nothing at the precision it is shown at is nothing: no minus sign in front of the
// zero and no colour. An at-the-money trade is worth 0, not a red -0.
const shown = (n, d = 0) => { const r = Number(n); return Math.abs(r) < 0.5 * 10 ** -d ? 0 : r }
// en-US whatever the browser's language, like the fields and the footer: one tab never mixes 12.345 and 12,345
const fmt = (n, d = 0) => n == null || isNaN(n) ? '—' : shown(n, d).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d })
const tone = (n, d = 0) => { if (n == null || isNaN(n)) return 'var(--text-dim)'; const r = shown(n, d); return r > 0 ? 'var(--green)' : r < 0 ? 'var(--red)' : 'var(--text)' }
const rateDp = (q) => q?.base_currency && ['BTC', 'ETH', 'SOL'].includes(q.base_currency) ? 2 : q?.pair === 'USDJPY' ? 3 : 5
const secHdr = { fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--text-hi)', fontFamily: 'var(--sans)', lineHeight: 1.2, margin: '16px 0 10px' }
// DETAILS: the record and the market it was priced on, side by side like the two legs of a swap's schedule
const twoCol = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: '0 18px', alignItems: 'start' }
const lbl = { fontSize: 11, letterSpacing: '0.08em', color: 'var(--text-mute)', fontFamily: 'var(--sans)', fontWeight: 500 }
const th = { ...lbl, padding: '6px 8px 6px 0', textAlign: 'right', borderBottom: '1px solid var(--border-hi)' }
const td = { fontSize: 12.5, fontFamily: 'var(--mono)', color: 'var(--text)', padding: '6px 8px 6px 0', textAlign: 'right', borderBottom: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' }
const tdL = { ...td, textAlign: 'left', fontFamily: 'var(--sans)' }
const wrap = { padding: `0 16px ${FOOTER_H}px`, fontFamily: 'var(--sans)' }
// A value is set as the TRADE tab sets it: a number, a date or a formula in mono, words in the interface face.
const isFigure = (label, v) => label === 'MODEL' || (typeof v === 'string' && /\d/.test(v)) || typeof v === 'number'
// The small button at the right of a section's heading (EXPORT XLSX)
const toolBtn = { marginLeft: 'auto', padding: '4px 10px', border: '1px solid var(--border-hi)', borderRadius: 'var(--r-2)', background: 'transparent', color: 'var(--text-dim)', fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', cursor: 'pointer' }
const hdrRow = { ...secHdr, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2 }

const Empty = ({ what }) => (
  <div className="empty-state" style={{ padding: '40px 24px' }}>
    <div className="empty-icon">◇</div>
    <div className="empty-title">Price the ticket first</div>
    <div className="empty-sub">{what} come from the priced quote: press PRICE on the TRADE tab and come back.</div>
  </div>
)

// One tab's figures while the ticket reprices: dimmed, under a line that says what they are. The wrapper is
// always there, so the panel inside keeps its state when the flag turns; the line is in the showing tab only.
function StaleFrame({ stale, active, children }) {
  return (<>
    {stale && active && (
      <div data-testid="fx-tab-stale" style={{ padding: '8px 16px 0', fontSize: '0.8125rem', color: 'var(--text-mute)', fontFamily: 'var(--sans)' }}>
        repricing: these figures are for the terms before your last change
      </div>
    )}
    <div data-stale={stale ? 'true' : 'false'} style={{ opacity: stale ? 0.5 : 1, transition: 'opacity 120ms' }}>{children}</div>
  </>)
}

// A panel of rows: what it is, its value, and the note that says where the value is from. One row per fact, so a
// term sheet reads down the page like a schedule, not across a wall of tiles. (`cols` and `min` are accepted and
// unused: every caller gets the same panel.)
function Grid({ items }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-3)', overflow: 'hidden', background: 'var(--bg)' }}>
      {items.map(([k, v, s, testId, raw], i) => (
        <div key={k} style={{ display: 'grid', gridTemplateColumns: 'minmax(118px, 0.42fr) minmax(0, 1fr)', columnGap: 14, padding: '7px 12px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
          <div style={{ ...lbl, paddingTop: 2 }}>{k}</div>
          <div style={{ minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
            <div data-testid={testId} data-value={raw} style={{ fontFamily: isFigure(k, v) ? 'var(--mono)' : 'var(--sans)', fontSize: 12.5, color: 'var(--text-hi)', overflowWrap: 'anywhere', minWidth: 0 }}>{v ?? '—'}</div>
            <Note>{s}</Note>
          </div>
        </div>
      ))}
    </div>
  )
}

// The summary above a tab's tables: a label over a figure, as on the swap's CASHFLOWS tab.
function Tile({ label, value, color, sub: note, testId, raw }) {
  return (
    <div style={{ position: 'relative', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-3)', padding: '9px 12px', minWidth: 0 }}>
      <div style={{ ...lbl, marginBottom: 4, paddingRight: note ? 18 : 0 }}>{label}</div>
      <div data-testid={testId} data-value={raw} style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: color || 'var(--text-hi)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
      <Note corner>{note}</Note>
    </div>
  )
}
const tiles = { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, margin: '4px 0 6px' }
// PAY or RECEIVE beside a leg's name, tinted by the sign of what it does to us
function Dir({ pay }) {
  const c = pay ? 'var(--down)' : 'var(--up)'
  return <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', whiteSpace: 'nowrap', padding: '1px 7px', borderRadius: 'var(--r-1)', border: `1px solid ${c}`, color: c, background: pay ? 'rgb(var(--down-rgb) / 0.10)' : 'rgb(var(--up-rgb) / 0.10)' }}>{pay ? '→ PAY' : '← RECEIVE'}</span>
}

// ── A FIXED OR SETTLED TRADE ───────────────────────────────────────────────────
// A booked digital-asset trade whose fixing date has been reached comes back from the API with a state
// (FIXED: not yet settled; SETTLED), the fixing it settled on, the settlement amount, and nulls where a live
// quote has its pricing fields. The three tabs then state those facts as the API sent them. Nothing below is
// computed here: no forward, no payoff, no discounting.
const dot = (...parts) => parts.filter(p => p != null && p !== '').join(' · ')
const signed = (n, d = 2) => (n == null ? '—' : `${shown(n, d) > 0 ? '+' : ''}${fmt(n, d)}`)
const ORIGIN = { FEED: 'from the feed', MANUAL: 'entered by the desk' }

// Why the figures are provisional, in plain words. When the amount hangs on a knock state nobody recorded, the
// API sends the amount for each case and both are stated.
function ProvisionalNotes({ facts, ccy, ids }) {
  const { reasons, amount, ifTouched } = facts
  if (!reasons.length) return null
  return (
    <div data-provisional="true" style={{ marginTop: 10, padding: '6px 10px', border: '1px solid rgba(233,151,90,0.3)', borderRadius: 4, background: 'rgba(233,151,90,0.06)', color: 'var(--amber)', fontSize: '0.8125rem', lineHeight: 1.5 }}>
      {reasons.map((r, i) => (
        <div key={i}>
          {r.kind === 'NO_FIXING' ? `No fixing is stored for ${r.source || 'the named source'}${r.date ? ` on ${r.date}` : ''}: this is an estimate on the stored spot`
            : r.kind === 'BARRIER' ? (
              ifTouched != null && amount != null
                ? <>Knock state not recorded: {signed(amount)} {ccy} if the barrier was never touched, <span data-testid={ids ? 'fx-settled-if-touched' : undefined} data-value={ifTouched}>{signed(ifTouched)}</span> {ccy} if it was. The figures here take it as never touched.</>
                : 'The barrier\'s knock state is not recorded: this assumes it was never touched')
            : r.text ? `Provisional: ${r.text}` : 'These figures are provisional'}
        </div>
      ))}
    </div>
  )
}

// The fixing used, the settlement amount as valued by the engine, the two dates, and the trade they belong to.
function SettledFacts({ quote, terms, sources, crypto, ids }) {
  const f = settledFacts(quote, terms, sources)
  const dp = rateDp(quote)
  const strike = strikeAsBooked(quote, terms, dp)      // K as booked: the record's own, else the quote's at the pair's decimals
  const option = quote.shape === 'OPTION'
  const ccy = quote.quote_currency || ''
  return (
    <div>
      <Grid min={200} items={[
        ['FIXING USED', f.fx ? fmt(f.fixing, dp) : '—',
          <>{f.fx ? dot(f.fx.source, f.fx.date, f.time, ORIGIN[f.fx.origin]) : `none stored for ${f.source || 'the named source'}${f.fixDate ? ` on ${f.fixDate}` : ''}`}
            {f.disputed && <div data-testid={ids ? 'fx-settled-disputed' : undefined} style={{ color: 'var(--amber)' }}>disputed: a later read of the venue differs</div>}</>,
          ids ? 'fx-settled-fixing' : undefined, f.fx ? f.fixing : undefined],
        ...(!f.fx && f.price != null ? [['PRICE USED', fmt(f.price, dp), 'the stored spot of the fixing date, not a fixing']] : []),
        ['SETTLEMENT AMOUNT', f.amount == null ? '—' : `${signed(f.amount)} ${ccy}`, f.amountNote, ids ? 'fx-settled-amount' : undefined, f.amount ?? undefined],
        ['FIXING DATE', f.fixDate || '—', f.time || ''],
        ['SETTLEMENT DATE', f.settlementDate || '—', f.state === 'SETTLED' ? 'settled' : 'fixed, not yet settled'],
        ['TRADE', `${dot(quote.direction, option ? quote.option_type : null).replace(' · ', ' ') || '—'} ${fmt(f.notional, crypto ? 4 : 0)} ${quote.base_currency || ''}`,
          strike != null ? `K ${fmt(strike, dp)}` : quote.style === 'TOUCH' ? 'a touch has no strike' : 'strike not reported'],
      ]} />
      <ProvisionalNotes facts={f} ccy={ccy} ids={ids} />
    </div>
  )
}

// The CURVE SCENARIO tab of a fixed or settled trade: the fixings and the strike on the chart, and the facts.
function SettledView({ quote, terms, crypto, rows, sources, ready }) {
  const f = settledFacts(quote, terms, sources)
  const at = (d) => daysBetween(quote.valuation_date, d)       // where a date sits on the chart's time axis
  return (
    <div className="tbw-no-drag" style={wrap} data-testid="fx-settled-view" data-state={f.state}>
      <div style={{ padding: '8px 0 0', fontSize: '0.8125rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {quote.knock?.knocked && f.state === 'FIXED' && f.model
          ? <span data-testid="fx-settled-knock">The desk recorded this option's barrier as touched ({f.model}). There is no forward left to shock.</span>
          : <>{f.state === 'SETTLED' ? 'This trade has settled' : 'This trade has fixed and is not yet settled'}: there is no forward left to shock.</>}
      </div>
      <div style={secHdr}>FIXINGS · {quote.pair}</div>
      <FxScenarioChart today={quote.valuation_date} curve={null} fixings={fixingSeries(rows, f.source)} tradeSource={f.source} strike={strikeAsBooked(quote, terms, rateDp(quote))} levels={chartLevels(quote)}
        settle={{ x: at(quote.settlement_date), date: quote.settlement_date }}
        settled={{ x: at(f.fixDate), date: f.fixDate, value: f.priceUsed, estimate: !f.priceIsFixing }} dp={rateDp(quote)} ready={ready} />
      <div style={secHdr}>{f.state === 'SETTLED' ? 'SETTLED' : 'FIXED, NOT YET SETTLED'}</div>
      <SettledFacts quote={quote} terms={terms} sources={sources} crypto={crypto} ids />
    </div>
  )
}

// ── DETAILS ────────────────────────────────────────────────────────────────────
export function FxDetailsPanel({ stale = false, active = true, ...rest }) {
  return <StaleFrame stale={stale && !!rest.quote} active={active}><DetailsBody {...rest} /></StaleFrame>
}

function DetailsBody({ quote, terms, crypto, booked = false }) {
  if (!quote) return <Empty what="The terms" />
  const t = terms || {}
  const ndf = quote.shape === 'NDF' || t.settlement_type === 'NON_DELIVERABLE'
  const dp = rateDp(quote)
  const done = settledState(quote)                 // FIXED or SETTLED: the body has the settled facts and no pricing fields
  // AS BOOKED once there is a trade behind these terms: settled, opened from the blotter, or just booked from this quote
  const sheet = (done || booked) ? 'TERM SHEET · AS BOOKED' : 'TERM SHEET · AS IT WILL BE BOOKED'
  // a digital asset's spot settles today, so its discount factors already run from where the forward is carried from
  const fromToday = crypto ? '' : ' from today'
  const settledBlock = done && (<>
    <div style={secHdr}>{done === 'SETTLED' ? 'SETTLEMENT' : 'FIXING · NOT YET SETTLED'}</div>
    <SettledFacts quote={quote} terms={t} crypto={crypto} />
  </>)
  // a notional at the strike the body does not carry is left out, not printed around a dash
  const atStrike = quote.quote_notional == null ? '' : `${fmt(quote.quote_notional)} ${quote.quote_currency} at the strike`
  if (quote.shape === 'OPTION') {
    const cash = (t.settlement_type || quote.settlement_type) === 'NON_DELIVERABLE'
    const st = styleTerms(quote)                   // each null when the body does not carry it: the row or the words are left out
    const pays = st.payout ? `pays ${fmt(st.payout.amount, 0)} ${st.payout.currency || ''}`.trim() : null
    return (
      <div className="tbw-no-drag" style={wrap}>
        <div style={twoCol}><div>
        <div style={hdrRow}><span>{sheet}</span><Note inline>Terms are edited on the TRADE tab; this is the record the counterparty will sign.</Note></div>
        <Grid items={[
          ['INSTRUMENT', crypto ? 'DIGITAL-ASSET OPTION (NDO)' : cash ? 'FX NON-DELIVERABLE OPTION' : 'FX OPTION', `${quote.pair} · canonical record v2 · ${crypto ? 'ISDA Digital Asset Derivatives Definitions' : 'ISDA FX and Currency Option Definitions'}`],
          ['OPTION', quote.style === 'TOUCH' ? ((quote.touch_type || '').replace(/_/g, ' ') || 'TOUCH') : quote.style === 'DIGITAL' ? `${quote.base_currency} ${quote.option_type} DIGITAL` : `${quote.base_currency} ${quote.option_type}${quote.style && quote.style !== 'EUROPEAN' ? ' · ' + quote.style.replace('_', ' ') : ''}`,
            quote.style === 'TOUCH' ? [pays || (st.when ? 'pays' : null), st.when].filter(Boolean).join(' ')
              : quote.style === 'DIGITAL' ? (pays ? `${pays} if ${quote.option_type === 'CALL' ? 'above' : 'below'} the strike` : '')
              : `the right to ${quote.option_type === 'CALL' ? 'buy' : 'sell'} ${quote.base_currency} against ${quote.quote_currency}${quote.style === 'AMERICAN' ? ', any day to expiry' : ''}`],
          ...(quote.style === 'BARRIER' && st.barrier != null ? [['BARRIER', `${quote.barrier_type ? quote.barrier_type.replace('_', '-AND-') + ' ' : ''}at ${fmt(st.barrier, dp)}`, `continuous monitoring${quote.rebate ? ` · rebate ${quote.rebate} ${quote.quote_currency} per ${quote.base_currency}` : ''}`]] : []),
          ...(st.range ? [['BARRIERS', `${fmt(st.range.lower, dp)} – ${fmt(st.range.upper, dp)}`, dot((quote.barrier_type || quote.touch_type || '').replace(/_/g, ' '), 'continuous monitoring')]] : []),
          ...(quote.style === 'TOUCH' && st.barrier != null ? [['BARRIER', fmt(st.barrier, dp), 'continuous monitoring']] : []),
          ['SIDE', `${quote.direction} the option`, quote.direction === 'BUY' ? 'we pay the premium and hold the right' : 'we receive the premium and are exercised against'],
          ['NOTIONAL', `${fmt(quote.base_notional, 0)} ${quote.base_currency}`, atStrike],
          ...(quote.style !== 'TOUCH' ? [['STRIKE', fmt(quote.strike, dp), done ? '' : quote.strike === quote.forward ? 'at the forward' : `forward ${fmt(quote.forward, dp)}`]] : []),
          ['EXPIRY', quote.expiry_date, `${t.expiration_time || t.expiry_time || (crypto ? '08:00 UTC' : '10:00 New York')} · ${quote.style === 'AMERICAN' ? 'American' : 'European'} · ${done ? 'expired' : `T = ${fmt(quote.t_expiry, 4)}y`}`],
          ['SETTLEMENT DATE', quote.settlement_date, cash ? `cash in ${quote.quote_currency}${crypto ? ' against the settlement price' : ''}` : 'delivery of both currencies'],
          // the premium is today's value of a ticket being priced; a fixed or settled trade's body does not carry what was paid
          ...(done ? [] : [['PREMIUM', `${fmt(Math.abs(quote.npv))} ${quote.quote_currency}`, `${quote.direction === 'BUY' ? 'paid' : 'received'} on ${quote.valuation_date} · ${fmt(Math.abs(quote.npv) / quote.base_notional / quote.spot * 100, 3)}% of ${quote.base_currency} notional`]]),
          [cash ? (crypto ? 'SETTLEMENT PRICE SOURCE' : 'FIXING SOURCE') : 'FIXING', cash ? (t.settlement_price_source || t.fixing_source || quote.fixing_source || '—') : 'none (deliverable)', cash ? `on ${quote.expiry_date}` : ''],
          ['CALCULATION AGENT', t.calculation_agent || 'none named', 'automatic exercise'],
        ]} />
        </div><div>
        {settledBlock || (<>
        <div style={secHdr}>MARKET IT WAS PRICED ON</div>
        <Grid items={[
          ['SPOT', fmt(quote.spot, dp), quote.spot_source || ''],
          ['FORWARD TO SETTLEMENT', fmt(quote.forward, dp), quote.forward_mode === 'MARKET' && quote.market_points != null ? 'quoted points' : 'implied from yields'],
          ['VOL', quote.vol_pct == null ? '—' : `${fmt(quote.vol_pct, 3)}%`, dot(quote.vol_tier, quote.vol_source, quote.vol_marks) || 'no vol on this quote'],
          ...(quote.forward_delta != null ? [['FORWARD DELTA', `${fmt(quote.forward_delta * 100, 1)}%`, `d1 ${fmt(quote.d1, 4)} · d2 ${fmt(quote.d2, 4)}`]] : [['DELTA', `${fmt(quote.delta_base_units, Math.abs(quote.delta_base_units) < 100 ? 2 : 0)} ${quote.base_currency}`, 'by repricing, ±1% spot']]),
          [`${quote.quote_currency} CURVE`, quote.quote_curve || '—', `DF ${fmt(quote.df_quote, 6)} to settlement${quote.quote_curve_snapshot ? ' · ' + quote.quote_curve_snapshot : ''}`],
          // the engine's own method words; "on the forward to settlement" only when they do not already name a forward
          ['MODEL', modelWords(quote.method, crypto ? 'Black-76' : 'Garman–Kohlhagen'), quote.style && quote.style !== 'EUROPEAN' ? 'same lognormal dynamics; σ from the ATM/RR/BF surface at the strike, held flat for the barrier' : crypto ? 'the FX option engine with the carry rate as the base rate; σ from the ATM/RR/BF surface' : 'Black–Scholes with the base currency as the dividend-paying asset; σ from the ATM/RR/BF surface'],
        ]} />
        </>)}
        </div></div>
      </div>
    )
  }
  return (
    <div className="tbw-no-drag" style={wrap}>
      <div style={twoCol}><div>
      <div style={hdrRow}><span>{sheet}</span><Note inline>Terms are edited on the TRADE tab; this is the record the counterparty will sign.</Note></div>
      <Grid items={[
        ['INSTRUMENT', crypto ? 'CRYPTO FORWARD' : ndf ? 'FX NDF' : quote.shape === 'SPOT' ? 'FX SPOT' : 'FX FORWARD', `${quote.pair} · canonical record v2`],
        ['DIRECTION', `${quote.direction} ${quote.base_currency}`, `${quote.direction === 'BUY' ? 'receive' : 'deliver'} ${quote.base_currency}, ${quote.direction === 'BUY' ? 'pay' : 'receive'} ${quote.quote_currency}`],
        ['NOTIONAL', `${fmt(quote.base_notional, crypto ? 4 : 0)} ${quote.base_currency}`, atStrike],
        [crypto ? 'FORWARD PRICE (K)' : 'FORWARD RATE (K)', fmt(quote.forward_rate, dp), done ? '' : quote.forward_rate === quote.forward ? 'struck at the fair forward' : `fair ${fmt(quote.forward, dp)}`],
        [done ? 'VALUED ON' : 'TRADE DATE', quote.valuation_date, ''],
        [crypto || ndf ? 'SETTLEMENT DATE' : 'VALUE DATE', quote.settlement_date, done ? (done === 'SETTLED' ? 'settled' : 'fixed, not yet settled') : `T = ${fmt(quote.t, 4)}y · ACT/365`],
        ['SETTLEMENT', crypto || ndf ? `CASH · ${quote.quote_currency}` : 'PHYSICAL · both currencies', crypto || ndf ? `net of (fixing − K) × ${fmt(quote.base_notional, crypto ? 4 : 0)} ${quote.base_currency}` : 'full exchange of principals'],
        [crypto || ndf ? 'FIXING SOURCE' : 'FIXING', crypto || ndf ? (t.settlement_price_source || t.fixing_source || quote.fixing_source || '—') : 'none (deliverable)', crypto || ndf ? `on ${t.fixing_date || t.valuation_date || quote.settlement_date}${t.valuation_time ? ' · ' + t.valuation_time : ''}` : ''],
        ['CALCULATION AGENT', t.calculation_agent || 'none named', crypto ? (t.disruption_fallback || '') : ''],
      ]} />
      </div><div>
      {settledBlock || (<>
      <div style={secHdr}>MARKET IT WAS PRICED ON</div>
      <Grid items={[
        ['SPOT', fmt(quote.spot, dp), `${quote.spot_source || ''}`],
        ['FAIR FORWARD', fmt(quote.forward, dp), `${fmt(quote.forward_points, crypto ? 2 : 1)} ${crypto ? quote.quote_currency : 'pts'} · ${quote.forward_mode === 'MARKET' && quote.market_points != null ? 'quoted points' : crypto ? 'implied from the carry rate' : 'implied from yields'}`],
        ['PARITY FORWARD', fmt(quote.implied_forward, dp), quote.basis_points != null ? `basis ${fmt(quote.basis_points, crypto ? 2 : 1)} vs quoted` : 'no quoted points'],
        [`${quote.quote_currency} CURVE`, quote.quote_curve || '—', `DF ${fmt(quote.df_quote, 6)}${fromToday} · zero ${fmt(quote.quote_rate * 100, 3)}%${quote.quote_curve_snapshot ? ' · ' + quote.quote_curve_snapshot : ''}`],
        // "funding" is the desk's spread on the XVA tab; the rate that carries a digital asset to its forward is its carry rate
        [crypto ? `${quote.base_currency} CARRY RATE` : `${quote.base_currency} CURVE`, quote.base_discounting || '—', `DF ${fmt(quote.df_base, 6)}${fromToday} · ${crypto ? 'rate' : 'zero'} ${fmt(quote.base_rate * 100, 3)}%`],
        // an FX spot settles on its spot date and the forward carries from there. The two discount factors above run from
        // today and say so: spot times their ratio is not the forward shown (1.6 pips apart on a 3M EURUSD)
        ['MODEL', crypto ? 'F = S·e^(−r_carry·T)/DF_quote' : 'F = S·DF_base/DF_quote, both from the spot date', crypto ? 'NPV = ±N·(F − K)·DF_quote' : 'NPV = ±N·(F − K)·DF_quote, from today'],
      ]} />
      </>)}
      </div></div>
    </div>
  )
}

// ── CASHFLOWS ──────────────────────────────────────────────────────────────────
export function FxCashflowsPanel({ stale = false, active = true, ...rest }) {
  return <StaleFrame stale={stale && !!rest.quote} active={active}><CashflowsBody {...rest} /></StaleFrame>
}

// A ticket with further legs: the package first (every leg in a row, and the dates on which money moves), and each
// leg's own flows behind its chip, exactly as a single trade's. `pkg` is fx-package.js packageView.
function CashflowsBody({ quote, crypto, pkg = null }) {
  const [shown, setShown] = useState({ of: 0, leg: 0 })     // leg 0: the package; leg n: leg n, of a package of `of` legs
  if (!pkg) return <LegCashflows quote={quote} crypto={crypto} />
  const at = shown.of === pkg.n ? shown.leg : 0              // a leg added or removed: back to the package, not to whichever leg now has that number
  const setShow = (leg) => setShown({ of: pkg.n, leg })
  const chip = (n, text) => (
    <button className="rj-press" key={n} type="button" data-testid={n ? `fx-cf-show-leg-${n}` : 'fx-cf-show-package'} aria-pressed={at === n} onClick={() => setShow(n)}
      style={{ padding: '4px 10px', borderRadius: 'var(--r-2)', border: `1px solid ${at === n ? 'var(--border-glow)' : 'var(--border)'}`, background: at === n ? 'var(--panel-3)' : 'transparent',
        color: at === n ? 'var(--text-hi)' : 'var(--text-dim)', fontFamily: 'var(--sans)', fontSize: 11.5, fontWeight: 500, letterSpacing: '0.06em', cursor: 'pointer' }}>{text}</button>
  )
  const legQuote = at ? pkg.each[at - 1] : null
  return (
    <div>
      <div className="tbw-no-drag" data-testid="fx-cf-views" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '12px 16px 0' }}>
        {chip(0, `PACKAGE · ${pkg.n} LEGS`)}
        {Array.from({ length: pkg.n }, (_, i) => chip(i + 1, `LEG ${i + 1}`))}
      </div>
      {at === 0 ? <PackageCashflows pkg={pkg} crypto={crypto} onLeg={setShow} />
        : legQuote ? <LegCashflows quote={legQuote} crypto={crypto} />
        : <div className="tbw-no-drag" style={{ ...wrap, paddingTop: 18, color: 'var(--text-dim)', fontSize: 12.5 }} data-testid="fx-cf-leg-gap">
            Leg {at} {pkg.failed.includes(at) ? 'could not be priced: its flows are not shown. The DETAILS tab says why.' : 'is being priced.'}
          </div>}
    </div>
  )
}

function PackageCashflows({ pkg, crypto, onLeg }) {
  const gap = packageGap(pkg)
  const f = gap ? null : packageFlows(pkg.quotes, { crypto })
  if (!f) {
    return (
      <div className="tbw-no-drag" style={{ ...wrap, paddingTop: 18, color: 'var(--text-dim)', fontSize: 12.5 }} data-testid="fx-cf-package-gap">
        The package's flows are shown once every leg is priced{gap ? `: ${gap}` : ''}. Each leg that is priced has its own flows behind its button above.
      </div>
    )
  }
  const q0 = pkg.quotes[0]
  const qc = q0.quote_currency, base = q0.base_currency, dp = rateDp(q0)
  const nDp = crypto && base !== 'USD' ? 4 : 0
  const anyOption = f.premium != null
  const exchanged = f.legs.some(l => l.exchange)
  const top = { borderTop: '2px solid var(--border-hi)', borderBottom: 'none' }
  const legBtn = { background: 'transparent', border: 'none', padding: 0, color: 'var(--text-hi)', fontFamily: 'var(--sans)', fontSize: 12.5, fontWeight: 500, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--border-hi)', textUnderlineOffset: 3 }
  const firstDate = f.dates.find(d => d.amount != null)?.date, lastDate = [...f.dates].reverse().find(d => d.amount != null)?.date
  return (
    <div className="tbw-no-drag" style={wrap} data-testid="fx-cf-package">
      <div style={hdrRow}><span>PACKAGE · {pkg.n} LEGS · {firstDate === lastDate ? `SETTLEMENT ${firstDate}` : `SETTLEMENTS ${firstDate} TO ${lastDate}`}</span>
        <Note inline>
          Every leg is a trade of its own, priced by the engine; the package's figures are their sums, in {qc}. A forward is shown at what it would settle if the fixing were today's
          fair forward, (F − K) × N; an option at its payoff at today's forward, which, discounted, is its value less the time value. Nothing here is priced a second way.
        </Note>
        <button className="rj-btn" type="button" style={toolBtn} data-testid="fx-cf-export" title="Every leg, the dates on which money moves and the market each leg was priced on, as an Excel workbook"
          onClick={() => exportPackageCashflows({ quotes: pkg.quotes, flows: f, crypto, dp })}>EXPORT XLSX</button>
      </div>
      <div style={{ ...tiles, gridTemplateColumns: `repeat(${anyOption ? 4 : 3}, minmax(0, 1fr))` }}>
        <Tile label="PACKAGE NPV" value={`${signed(f.npv, 0)} ${qc}`} color={tone(f.npv)} testId="fx-cf-package-npv" raw={f.npv} sub={`the sum of ${pkg.n} legs`} />
        {anyOption && <Tile label={`NET PREMIUM · ${qc}`} value={signed(f.premium, 0)} color={tone(f.premium)} sub={f.premium < 0 ? 'paid on the trade date' : f.premium > 0 ? 'received on the trade date' : 'nothing changes hands'} testId="fx-cf-package-premium" raw={f.premium} />}
        <Tile label={`AT TODAY'S FORWARD · ${qc}`} value={signed(f.amount, 0)} color={tone(f.amount)} sub="what the legs would settle, summed" />
        <Tile label="MONEY MOVES ON" value={`${f.dates.length} ${f.dates.length === 1 ? 'DATE' : 'DATES'}`} sub={f.legs.every(l => l.cash) ? `net payments in ${qc}` : f.legs.some(l => l.cash) ? 'net payments and exchanges of principal' : 'principals exchange'} />
      </div>

      <div style={{ ...secHdr, marginTop: 4 }}>THE LEGS</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }} data-testid="fx-cf-package-legs">
          <thead><tr>
            <th style={{ ...th, textAlign: 'left' }}>LEG</th><th style={{ ...th, textAlign: 'left' }}>TRADE</th><th style={th}>SETTLES</th>
            {anyOption && <th style={th}>PREMIUM {qc}</th>}
            <th style={th}>AT TODAY'S FORWARD {qc}</th><th style={th}>DF</th><th style={th}>NPV {qc}</th>
          </tr></thead>
          <tbody>
            {f.legs.map(l => (
              <tr key={l.n} data-testid="fx-cf-package-leg" data-npv={l.npv}>
                <td style={tdL}><button type="button" style={legBtn} onClick={() => onLeg(l.n)} title={`Leg ${l.n}'s own flows`}>LEG {l.n}</button></td>
                <td style={{ ...tdL, whiteSpace: 'nowrap' }}>{legWords(l, { base, fmt, dp, nDp })}</td>
                <td style={td}>{l.date}</td>
                {anyOption && <td style={{ ...td, color: l.premium == null ? 'var(--text-mute)' : tone(l.premium) }}>{l.premium == null ? '—' : signed(l.premium, 0)}</td>}
                <td style={{ ...td, color: tone(l.amount) }}>{signed(l.amount, 0)}</td>
                <td style={td}>{fmt(l.df, 6)}</td>
                <td style={{ ...td, fontWeight: 500, color: tone(l.npv) }}>{signed(l.npv, 0)}</td>
              </tr>
            ))}
            <tr data-testid="fx-cf-package-total">
              <td colSpan={3} style={{ ...tdL, ...top, fontWeight: 600, color: 'var(--text-hi)' }}>PACKAGE · {qc}</td>
              {anyOption && <td style={{ ...td, ...top, color: tone(f.premium) }}>{signed(f.premium, 0)}</td>}
              <td style={{ ...td, ...top, color: tone(f.amount) }}>{signed(f.amount, 0)}</td>
              <td style={{ ...td, ...top }} />
              <td style={{ ...td, ...top, fontWeight: 600, color: tone(f.npv) }}>{signed(f.npv, 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={hdrRow}><span>BY DATE</span>
        <Note inline>
          The dates on which money moves, earliest first: the premiums on the trade date, then each settlement date with the legs that settle on it netted.
          {exchanged ? ` A deliverable leg exchanges both principals: the ${base} and ${qc} columns are those amounts, known today.` : ''}
          {' '}The settlement amounts are today's estimate, at the fair forward; the fixing on each date decides the actual amount.
        </Note>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }} data-testid="fx-cf-package-dates">
          <thead><tr>
            <th style={{ ...th, textAlign: 'left' }}>DATE</th><th style={{ ...th, textAlign: 'left' }}>LEGS</th>
            {anyOption && <th style={th}>PREMIUM {qc}</th>}
            {exchanged && <th style={th}>{base} EXCHANGED</th>}{exchanged && <th style={th}>{qc} EXCHANGED</th>}
            <th style={th}>AT TODAY'S FORWARD {qc}</th><th style={th}>PV {qc}</th>
          </tr></thead>
          <tbody>
            {f.dates.map(d => (
              <tr key={d.date} data-testid="fx-cf-package-date">
                <td style={{ ...tdL, fontFamily: 'var(--mono)' }}>{d.date}</td>
                <td style={tdL}>{d.legs.join(', ')}</td>
                {anyOption && <td style={{ ...td, color: d.premium == null ? 'var(--text-mute)' : tone(d.premium) }}>{d.premium == null ? '—' : signed(d.premium, 0)}</td>}
                {exchanged && <td style={{ ...td, color: d.base == null ? 'var(--text-mute)' : tone(d.base, nDp) }}>{d.base == null ? '—' : signed(d.base, nDp)}</td>}
                {exchanged && <td style={{ ...td, color: d.quote == null ? 'var(--text-mute)' : tone(d.quote) }}>{d.quote == null ? '—' : signed(d.quote, 0)}</td>}
                <td style={{ ...td, color: d.amount == null ? 'var(--text-mute)' : tone(d.amount) }}>{d.amount == null ? '—' : signed(d.amount, 0)}</td>
                <td style={{ ...td, color: d.pv == null ? 'var(--text-mute)' : tone(d.pv) }}>{d.pv == null ? '—' : signed(d.pv, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LegCashflows({ quote, crypto }) {
  if (!quote) return <Empty what="The settlement flows" />
  const done = settledState(quote)
  if (done) {
    // one flow, as the API settled it: the amount is its figure, not (F − K) × N worked out here
    const f = settledFacts(quote, null)
    return (
      <div className="tbw-no-drag" style={wrap}>
        <div style={secHdr}>SETTLEMENT · {quote.settlement_date || '—'}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ ...th, textAlign: 'left' }}>FLOW</th><th style={th}>DATE</th><th style={th}>{f.priceIsFixing ? 'FIXING' : 'PRICE USED'}</th><th style={th}>AMOUNT</th></tr></thead>
          <tbody>
            <tr>
              <td style={{ ...tdL, borderBottom: 'none' }}>NET CASH SETTLEMENT · {quote.quote_currency}
                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{f.fx ? `against ${dot(f.fx.source, f.fx.date, f.time)}` : `no fixing stored for ${f.source || 'the named source'}${f.fixDate ? ` on ${f.fixDate}` : ''}`}</div></td>
              <td style={{ ...td, borderBottom: 'none' }}>{f.settlementDate || '—'}</td>
              <td style={{ ...td, borderBottom: 'none' }}>{fmt(f.priceUsed, rateDp(quote))}</td>
              <td style={{ ...td, borderBottom: 'none', fontWeight: 700, color: tone(f.amount, 2) }}>{f.amount == null ? '—' : `${signed(f.amount)} ${quote.quote_currency}`}</td>
            </tr>
          </tbody>
        </table>
        <ProvisionalNotes facts={f} ccy={quote.quote_currency || ''} />
        <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 10, lineHeight: 1.5 }}>
          {f.model ? `${f.model}. ` : ''}{done === 'SETTLED' ? 'Settled: the amount fell due on the settlement date and the trade no longer carries a value.' : 'Fixed, not yet settled: the amount falls due on the settlement date.'}
          {f.amount == null ? ' The engine reported no settlement amount for this trade.' : ''} These figures are as valued by the engine; nothing is repriced here.
        </div>
      </div>
    )
  }
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
        <div style={hdrRow}><span>FLOWS · PREMIUM {quote.valuation_date} · SETTLEMENT {quote.settlement_date}</span>
          <Note inline>
            {quote.settlement_type === 'NON_DELIVERABLE' ? `Cash-settled in ${quote.quote_currency} against the fixing.` : `Deliverable: on exercise ${fmt(quote.base_notional, 0)} ${quote.base_currency} against ${fmt(quote.quote_notional)} ${quote.quote_currency} on the settlement date.`}
            {' '}The option's value is the discounted expected payoff under the forward's lognormal distribution at {fmt(quote.vol_pct, 2)}% vol, which is the engine's Garman–Kohlhagen figure.
          </Note>
          <button className="rj-btn" type="button" style={toolBtn} data-testid="fx-cf-export" title="The flows and the market they were priced on, as an Excel workbook"
            onClick={() => exportCashflows({ quote, crypto, dp, option: { premium, payoffName: payoutStyle ? 'PAYOUT AT TODAY\'S FORWARD' : 'PAYOFF AT TODAY\'S FORWARD', intrinsic, df: quote.df_quote } })}>EXPORT XLSX</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ ...th, textAlign: 'left' }}>FLOW</th><th style={th}>DATE</th><th style={th}>AMOUNT</th><th style={th}>DF</th><th style={th}>PV {quote.quote_currency}</th></tr></thead>
          <tbody>
            <tr><td style={tdL}>PREMIUM<Note inline>{sign > 0 ? 'paid' : 'received'} on the trade date; not part of the value after it is paid</Note></td>
              <td style={td}>{quote.valuation_date}</td><td style={{ ...td, color: tone(premium) }}>{fmt(premium)} {quote.quote_currency}</td><td style={td}>1.000000</td><td style={td}>{fmt(premium)}</td></tr>
            <tr><td style={tdL}>{payoutStyle ? 'PAYOUT' : 'PAYOFF AT EXPIRY'}<Note inline>{quote.style === 'TOUCH' ? `${fmt(quote.payout, 0)} ${quote.payout_currency === 'BASE' ? quote.base_currency : quote.quote_currency} ${quote.pay_at_hit ? 'when the barrier is hit' : 'at expiry if ' + ((quote.touch_type || '').includes('NO') ? 'never touched' : 'touched')}; at today's forward the barrier is not reached` : quote.style === 'DIGITAL' ? `${fmt(quote.payout, 0)} ${quote.payout_currency === 'BASE' ? quote.base_currency : quote.quote_currency} if the fixing is ${call ? 'above' : 'below'} ${fmt(quote.strike, dp)}; shown at today's forward` : `max(${call ? 'S − K' : 'K − S'}, 0) × N, at today's forward; the fixing on ${quote.expiry_date} decides${quote.style === 'BARRIER' || quote.style === 'DOUBLE_BARRIER' ? ' and the barrier must not have knocked it out' : ''}`}</Note></td>
              <td style={td}>{quote.settlement_date}</td><td style={{ ...td, color: tone(intrinsic) }}>{fmt(intrinsic)} {quote.quote_currency}</td><td style={td}>{fmt(quote.df_quote, 6)}</td><td style={td}>{fmt(intrinsic * quote.df_quote)}</td></tr>
            <tr><td style={{ ...tdL, fontWeight: 700, borderBottom: 'none' }}>OPTION VALUE</td><td style={{ ...td, borderBottom: 'none' }} colSpan={3}>{quote.time_value != null ? `intrinsic ${fmt(intrinsic * quote.df_quote)} + time value ${fmt(sign * quote.time_value)}` : `${quote.method || ''}`}</td>
              <td style={{ ...td, fontWeight: 700, borderBottom: 'none', color: tone(quote.npv) }}>{fmt(quote.npv)}</td></tr>
          </tbody>
        </table>
      </div>
    )
  }
  // A forward as two legs, the way a swap is shown: what is received and what is paid, each in the quote currency
  // and discounted on the quote curve, and the net of the two. The amounts are the ones this tab has always
  // shown: N·F against N·K (the quote notional of a deliverable forward), whose difference is (F − K)·N. A
  // cash-settled forward pays only that net, sized by the fixing; a deliverable one exchanges both principals.
  const base = quote.base_currency, qc = quote.quote_currency
  const N = quote.base_notional, F = quote.forward, K = quote.forward_rate, df = quote.df_quote
  const baseDp = crypto && base !== 'USD' ? 4 : 0
  const quoteNotional = ndf ? N * K : quote.quote_notional
  const legs = [
    { key: 'base', name: `${base} LEG`, pay: sign < 0, notional: `${fmt(N, baseDp)} ${base}`, priceLabel: ndf ? 'FIXING · AT F TODAY' : 'FAIR FORWARD (F)', price: F, amount: sign * N * F,
      note: ndf ? `${fmt(N, baseDp)} ${base} at the fixing on ${quote.settlement_date}; today's estimate is the fair forward` : `${fmt(N, baseDp)} ${base} ${sign > 0 ? 'received' : 'delivered'} on the value date, in ${qc} at the fair forward` },
    { key: 'quote', name: `${qc} LEG`, pay: sign > 0, notional: `${fmt(quoteNotional)} ${qc}`, priceLabel: crypto ? 'FORWARD PRICE (K)' : 'FORWARD RATE (K)', price: K, amount: -sign * quoteNotional,
      note: `${fmt(N, baseDp)} ${base} × K, fixed on the trade date` },
  ].map(l => ({ ...l, pv: l.amount * df }))
  const net = legs.reduce((a, l) => a + l.amount, 0)
  const pv = legs.reduce((a, l) => a + l.pv, 0)
  const head = ['SETTLEMENT DATE', 'NOTIONAL', null, `AMOUNT ${qc}`, 'DF', `PV ${qc}`]
  // one set of column widths for both legs and the net, so the amounts, the discount factors and the PVs line up down the tab
  const cols = <colgroup>{[16, 20, 22, 16, 12, 14].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
  const fixed = { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }
  return (
    <div className="tbw-no-drag" style={wrap}>
      <div style={hdrRow}><span>CASHFLOWS · SETTLEMENT {quote.settlement_date}</span>
        <Note inline>
          {ndf ? `Cash-settled: one payment in ${qc} on the settlement date, sized by the fixing against K ${fmt(K, dp)}. Today's estimate uses the fair forward ${fmt(F, dp)}.`
               : `Deliverable: both principals exchange on the value date. Both legs are expressed in ${qc} at today's fair forward ${fmt(F, dp)} and discounted on the ${qc} curve.`}
          {' '}Matches the engine's NPV of {fmt(quote.npv)} {qc} within rounding.
        </Note>
        <button className="rj-btn" type="button" style={toolBtn} data-testid="fx-cf-export" title="The legs, their net and the market they were priced on, as an Excel workbook"
          onClick={() => exportCashflows({ quote, crypto, ndf, dp, legs, net, pv })}>EXPORT XLSX</button>
      </div>
      <div style={tiles}>
        <Tile label="NET NPV" value={`${signed(quote.npv, 0)} ${qc}`} color={tone(quote.npv)} testId="fx-cf-npv" />
        <Tile label={`${legs[0].name} PV · ${qc}`} value={signed(legs[0].pv, 0)} color={tone(legs[0].pv)} sub={ndf ? 'at the fixing, not exchanged' : undefined} />
        <Tile label={`${legs[1].name} PV · ${qc}`} value={signed(legs[1].pv, 0)} color={tone(legs[1].pv)} sub={ndf ? 'against K, not exchanged' : undefined} />
        <Tile label={ndf ? 'SETTLES · CASH' : 'SETTLES · PHYSICAL'} value={quote.settlement_date} sub={ndf ? `one net payment in ${qc}` : 'both principals exchange'} />
      </div>
      {legs.map(l => (
        <div key={l.key} style={{ marginBottom: 12 }} data-testid={`fx-cf-leg-${l.key}`}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '2px 8px', padding: '8px 0 6px' }}>
            <span style={{ ...lbl, color: 'var(--text-dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{l.name}</span><Dir pay={l.pay} />
            <Note inline>{l.note}</Note>
          </div>
          <table style={fixed}>
            {cols}
            <thead><tr>{head.map((h, i) => <th key={i} style={{ ...th, textAlign: i === 0 ? 'left' : 'right' }}>{h ?? l.priceLabel}</th>)}</tr></thead>
            <tbody><tr>
              <td style={{ ...td, textAlign: 'left' }}>{quote.settlement_date}</td>
              <td style={td}>{l.notional}</td>
              <td style={td}>{fmt(l.price, dp)}</td>
              <td style={{ ...td, color: tone(l.amount) }}>{signed(l.amount, 0)}</td>
              <td style={td}>{fmt(df, 6)}</td>
              <td style={{ ...td, fontWeight: 500, color: tone(l.pv) }}>{signed(l.pv, 0)}</td>
            </tr></tbody>
          </table>
        </div>
      ))}
      <table style={fixed} data-testid="fx-cf-net">
        {cols}
        <tbody><tr>
          <td colSpan={3} style={{ ...tdL, fontWeight: 600, color: 'var(--text-hi)', borderTop: '2px solid var(--border-hi)', borderBottom: 'none' }}>{ndf ? `NET CASH SETTLEMENT · ${qc}` : `NET · ${qc}`}
            <Note inline>{ndf ? `(F − K) × N at today's forward; the fixing on ${quote.settlement_date} decides the actual amount` : 'the two legs at the fair forward'}</Note></td>
          <td style={{ ...td, borderTop: '2px solid var(--border-hi)', borderBottom: 'none', color: tone(net) }}>{signed(net, 0)}</td>
          <td style={{ ...td, borderTop: '2px solid var(--border-hi)', borderBottom: 'none' }}>{fmt(df, 6)}</td>
          <td style={{ ...td, borderTop: '2px solid var(--border-hi)', borderBottom: 'none', fontWeight: 600, color: tone(pv) }}>{signed(pv, 0)}</td>
        </tr></tbody>
      </table>
    </div>
  )
}

// ── CURVE SCENARIO ─────────────────────────────────────────────────────────────
// The engine's closed form, repriced here (fx-scenario.js): NPV = ±N·(F' − K)·DF_q', with
// DF' = DF·exp(−Δr·T) for a parallel shift on that curve, and F' the forward read off the
// curve on the chart: spot plus the points interpolated to the settlement date, after the
// spot shock, the rate shocks and whatever was dragged. An approximation, so no round trip
// is needed and the chart, the tiles and the ladders move together: with no shock it agrees
// with the engine to cents (an option's Φ here is a polynomial), a spot shock scales the
// quoted points with spot, and on quoted points the pricer would not move the forward with
// the rate sliders. The banner and the caption under the sliders say so.
function StyleLadder({ crypto, quote, active, stale }) {
  // every style repriced by the engine itself on a grid of spot and vol shocks (POST /api/currency/option/ladder):
  // 46 option prices on the server. Asked once per quote, only while this tab is showing and the quote is not
  // being repriced, and dropped in flight when the quote changes or the tab is left. The last ladder stays, dimmed,
  // until the next one is back.
  const [held, setHeld] = useState(null)             // { key, data }: the last ladder that came back, and the request it answers
  const [failed, setFailed] = useState(null)         // { key, message }: the last request that failed
  const key = ladderKey(quote)
  const wanted = ladderWanted({ active, stale, key, heldKey: held?.key, failedKey: failed?.key })
  useEffect(() => {
    if (!wanted) return
    const stop = new AbortController()
    ;(async () => {
      try {
        const session = await getSessionSafe()
        if (stop.signal.aborted) return
        const r = await fetch(`${API}/api/currency/option/ladder`, { method: 'POST', signal: stop.signal, headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json' }, body: key })
        const j = await r.json()
        if (!r.ok) throw new Error(j.detail ? (typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)) : `ladder ${r.status}`)
        if (!stop.signal.aborted) setHeld({ key, data: j })
      } catch (e) { if (!stop.signal.aborted) setFailed({ key, message: e.message }) }
    })()
    return () => stop.abort()
  }, [wanted, key])
  const dp = rateDp(quote)
  const { ladder: lad, error, updating } = ladderShown({ key, held, failed, stale })
  if (error) return <div style={{ color: 'var(--red)', padding: '16px 0' }}>{error}</div>
  if (!lad) return <div style={{ color: 'var(--text-dim)', padding: '16px 0' }}>Repricing the {(quote.style || '').replace('_', ' ').toLowerCase()} on the shock grid…</div>
  const vols = lad.vol_shocks_pts
  return (
    <div data-testid="fx-ladder" data-current={updating ? 'false' : 'true'}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div style={secHdr}>NPV {quote.quote_currency} · SPOT SHOCK × VOL SHOCK (points)</div>
        {updating && <div data-testid="fx-ladder-updating" style={{ fontSize: '0.72rem', color: 'var(--text-mute)' }}>updating…</div>}
      </div>
      {/* the whole tab is already dimmed while the quote is stale; the ladder dims itself only while its own request is out */}
      <div style={{ opacity: updating && !stale ? 0.5 : 1, transition: 'opacity 120ms' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={th}>SPOT</th><th style={th}>LEVEL</th>{vols.map(v => <th key={v} style={th}>{v > 0 ? '+' : ''}{v} pt</th>)}</tr></thead>
        <tbody>{lad.rows.map(r => (
          <tr key={r.spot_pct} style={{ background: r.spot_pct === 0 ? 'var(--accent-glow)' : 'transparent' }}>
            <td style={td}>{r.spot_pct > 0 ? '+' : ''}{r.spot_pct}%</td><td style={td}>{fmt(r.spot, dp)}</td>
            {vols.map(v => { const x = r.npv[String(v)]; return <td key={v} style={{ ...td, color: x == null ? 'var(--text-mute)' : tone(x) }}>{x == null ? '—' : fmt(x)}</td> })}
          </tr>))}</tbody>
      </table>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 10 }}>At the stored spot, not the dragged one: the engine's own repricing. Base NPV {fmt(lad.base_npv)} at vol {fmt(lad.base_vol_pct, 2)}% · {DELTA_LABEL(crypto)} · 1 % spot {fmt(lad.spot01)} · VEGA · 1 pt {fmt(lad.vega)}. A barrier or touch option's value is not smooth near its barrier; read the whole row, not a slope.</div>
      </div>
    </div>
  )
}

// Which source the trade fixes on, when it fixes and settles (ISO dates; an American option fixes when it is
// exercised, at the latest at expiry), and the latest stored fixing of exactly that source.
function FixingSource({ source, time, date, settles, american, last, cash, dp }) {
  const line = { fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.5, marginTop: 8 }
  const when = american
    ? <span data-testid="fx-scenario-dates">fixes at exercise or at expiry{settles ? `, settles ${settles} at the latest` : ''}</span>
    : (date || settles) && <span data-testid="fx-scenario-dates">{date ? `fixes on ${date}` : ''}{date && settles ? ', ' : ''}{settles ? `settles ${settles}` : ''}</span>
  if (!source) {
    if (!cash) return <div style={line}>Deliverable: both currencies are exchanged and no fixing is taken. The amount is what that exchange is worth at the rate entered.</div>
    return <div style={line}>No settlement price source is named on this ticket{when ? <>; it {when}</> : ''}.</div>
  }
  return (
    <div style={line} data-testid="fx-scenario-source">
      Fixing source {source}{time ? `, ${time}` : ''}{when ? <>, {when}</> : ''}.{' '}
      {last ? <span>Latest stored fixing: {last.source}, {last.date}, <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{fmt(last.value, dp)}</span>.</span>
            : <span>No fixing stored for this source yet</span>}
    </div>
  )
}

export function FxScenarioPanel({ stale = false, active = true, ...rest }) {
  const dim = stale && !!rest.quote
  return <StaleFrame stale={dim} active={active}><ScenarioBody {...rest} stale={dim} active={active} /></StaleFrame>
}

function ScenarioBody({ quote, crypto, terms, active, stale, pkg = null }) {
  const [spot, setSpot] = useState(0)
  const [qbp, setQbp] = useState(0)
  const [bbp, setBbp] = useState(0)
  const [vpt, setVpt] = useState(0)
  const [sel, setSel] = useState('spot')                               // the curve the left column and the chart are showing
  const [flatPts, setFlatPts] = useState({ pair: null, v: 0 })         // a currency pair's quoted points, all moved together, in pips, for one pair
  const [pill, setPill] = useState({ pair: null, quote: {}, base: {} }) // a rate curve's pillars shocked one by one: date → bp, for one pair
  const [drags, setDrags] = useState({ pair: null, by: {} })           // tenor → points it has been dragged, for one pair
  const [typed, setTyped] = useState({ pair: null, text: null })       // the scenario fixing as typed; null: it follows the shocked forward
  const [market, setMarket] = useState(null)             // { pair, row, tenorDays }: the pair's spot, points, pip, sources and the API's tenor map
  const [marketFor, setMarketFor] = useState(null)       // the stored market (marketKey) whose pairs request has come back, whatever it answered
  const [stored, setStored] = useState(null)             // { pair, rows }: the pair's recent fixings
  const origin = useRef(null)                            // the shocks as they stood when a drag began
  const pair = quote?.pair
  const dp = rateDp(quote)
  const option = quote?.shape === 'OPTION'
  const european = !option || !quote.style || quote.style === 'EUROPEAN'
  const done = settledState(quote)
  const marketId = marketKey(quote)

  // a dragged curve and a typed fixing belong to the pair they were made on: another pair starts clean
  const moves = drags.pair === pair ? drags.by : {}
  const fixingText = typed.pair === pair ? typed.text : null
  const setMoves = (by) => setDrags({ pair, by })
  const setFixingText = (text) => setTyped({ pair, text })
  const own = pill.pair === pair ? pill : { quote: {}, base: {} }
  const fpips = flatPts.pair === pair ? flatPts.v : 0
  const setFpips = (v) => setFlatPts({ pair, v })
  const setOwn = (which, date, bp) => setPill({ pair, quote: own.quote, base: own.base, [which]: { ...own[which], [date]: bp } })
  // The curve and the surface the ticket priced on. The pairs answer does not depend on the ticket's terms, so it is
  // read once for the stored market the quote names (its pair, and the reads of the points and the surface it priced
  // on), not for every quote, and only while this tab is showing and the quote is not being repriced.
  const wantsMarket = !!pair && active && !stale && marketFor !== marketId
  useEffect(() => {
    if (!wantsMarket) return
    let dead = false
    apiFetch('/api/currency/pairs').then(r => (r.ok ? r.json() : null))
      .then(j => { const row = j?.pairs?.find(p => p.pair === pair); if (!dead && row) setMarket({ pair, row, tenorDays: j.tenor_days }) })
      .catch(() => {})                                   // no curve from the API: the chart draws the quote's own carry
      .finally(() => { if (!dead) setMarketFor(marketId) })
    return () => { dead = true }
  }, [wantsMarket, pair, marketId])
  // the fixings, once per pair, when the tab is first shown on it; when the request fails the chart is drawn without its left side
  const wantsFixings = !!pair && active && stored?.pair !== pair
  useEffect(() => {
    if (!wantsFixings) return
    let dead = false
    apiFetch(`/api/currency/fixings/${encodeURIComponent(pair)}?days=${FIXING_DAYS}`).then(r => (r.ok ? r.json() : null))
      .then(j => { if (!dead) setStored({ pair, rows: Array.isArray(j?.fixings) ? j.fixings : [] }) })
      .catch(() => { if (!dead) setStored({ pair, rows: [] }) })
    return () => { dead = true }
  }, [wantsFixings, pair])

  // the base curve: the quoted points the ticket priced on, or, without them, its own carry from spot to the forward.
  // Null when the quote does not carry what a curve needs: nothing is drawn in its place.
  const model = useMemo(() => {
    if (!quote || done) return null
    const mine = market?.pair === pair ? market : null
    const row = mine?.row || null
    const tenorDays = tenorMap(mine?.tenorDays)          // the backend's own map; this module's copy for an older answer
    // the pair's pip; before the pairs answer arrives, the convention (it cancels out of a curve read from the quote's carry)
    const pip = row?.pip > 0 ? row.pip : crypto ? 1 : /JPY$/.test(pair || '') ? 0.01 : 1e-4
    const t = option ? quote.t_settle : quote.t
    const settleX = daysBetween(quote.valuation_date, quote.settlement_date) ?? (Number.isFinite(t) ? Math.round(t * 365) : null)
    if (settleX == null) return null
    const quoted = quote.forward_mode === 'MARKET' && quote.market_points != null && !quote.forward_beyond_quotes && !!row?.forward_points && Object.keys(row.forward_points).length > 0
    // points are quoted from the spot date: the lag the quote itself implies, else the market's convention
    const lag = spotLagDays({ points: quoted ? row.forward_points : null, settleDays: settleX, marketPoints: quote.market_points, crypto, tSpot: quote.t_spot, tenorDays }) ?? (crypto ? 0 : FX_SPOT_LAG_DAYS)
    const days = Math.max(settleX - lag, 0)
    const nodes = curveNodes(quoted ? row.forward_points : carryPoints({ spot: quote.spot, forward: quote.forward, days, pip, tenorDays }), lag, tenorDays)
    if (!nodes) return null
    return { pip, settleX, quoted, days, nodes, tenorDays, lag, label: quoted ? row.forward_curve?.label : null }
  }, [quote, done, crypto, market, pair, option])

  if (!quote) return <Empty what="Scenarios" />
  const rows = stored?.pair === pair ? stored.rows : []
  const sources = market?.pair === pair ? market.row?.fixing_sources : null
  const ready = stored?.pair === pair && marketFor === marketId               // both requests are back: the chart will not move again by itself
  if (done) return <SettledView quote={quote} terms={terms} crypto={crypto} rows={rows} sources={sources} ready={ready} />

  // the rate sliders exist for the closed form only; a digital asset's second slider is its forward basis, +1 bp a
  // year of which is −1 bp on the carry rate the form takes (CRYBASIS01 = −FUND01)
  const tSettle = option ? quote.t_settle : quote.t
  // A package: every leg under the one scenario, each at its own settlement date (fx-package.js). Its curves are
  // then shown as far as the LAST leg settles, with every pillar before it: a shock on one reaches each leg as the
  // engine's curve would carry it, and a pillar left out of the list would be read as not there.
  const pq = pkg?.quotes || null
  // the legs that have a price, whole package or not: how far the curves are shown does not jump (and a pillar's
  // shock does not drop out of the scenario) each time one leg is being repriced
  const legQs = pkg ? pkg.each.filter(Boolean) : null
  const legT = (q) => (q.shape === 'OPTION' ? q.t_settle : q.t)
  const tLong = legQs ? Math.max(tSettle, ...legQs.map(legT).filter(Number.isFinite)) : tSettle
  const qPill = pillarsShown(quote.curves?.quote?.pillars, tLong, pkg ? Infinity : 8), bPill = crypto ? [] : pillarsShown(quote.curves?.base?.pillars, tLong, pkg ? Infinity : 8)
  const qOwn = shockAtTime(qPill, own.quote, tSettle), bOwn = shockAtTime(bPill, own.base, tSettle)
  const rq = european ? qbp + qOwn : 0, rb = european ? (crypto ? -bbp : bbp + bOwn) : 0
  const nodes = model?.nodes || []
  const pip = model?.pip
  const flatPips = crypto ? 0 : fpips
  const moved = nodes.map(n => (moves[n.tenor] || 0) + flatPips)
  const dPoints = model ? interpPoints(Object.fromEntries(nodes.map((n, i) => [n.tenor, moved[i]])), model.days, model.tenorDays) : null
  const at = (o = {}) => (dPoints == null ? null : reprice(quote, { spotPct: spot, quoteBp: rq, baseBp: rb, volPts: vpt, dPoints, pip, ...o }))
  const base = model ? reprice(quote) : null
  const now = base ? at() : null
  const curve = model ? shockedCurve({ spot: quote.spot, pip, nodes, moves: moved, spotPct: spot, quoteBp: rq, baseBp: rb }) : null
  // the scenario as every leg reads it, and the package at the market and under it; null when a leg is not the closed form's
  const scen = model && pq ? { spotPct: spot, quoteBp: qbp, baseBp: bbp, volPts: vpt, pip, crypto, moved: Object.fromEntries(nodes.map((n, i) => [n.tenor, moved[i]])),
    tenorDays: model.tenorDays, lag: model.lag, quotePillars: qPill, quoteOwn: own.quote, basePillars: bPill, baseOwn: own.base } : null
  const pBase = scen ? repricePackage(pq, null) : null
  const pNow = scen ? repricePackage(pq, scen) : null
  const whole = !!(pBase && pNow)                        // the figures below are the package's
  const notClosed = pq ? pq.map((q, i) => (closedForm(q) ? null : i + 1)).filter(Boolean) : []
  const pkgWhy = !pkg || whole ? null
    : packageGap(pkg) || (notClosed.length ? `leg ${notClosed.join(', ')} is of a style the engine reprices itself, which the browser's closed form does not` : 'a leg does not carry what the closed form needs')
  if (!base || !now || !curve) {
    return (
      <div className="empty-state" style={{ padding: '40px 24px' }} data-testid="fx-scenario-unavailable">
        <div className="empty-icon">◇</div>
        <div className="empty-title">No scenario for this quote</div>
        <div className="empty-sub">It does not carry what the closed form needs (a forward, a discount factor and the time to settlement), and nothing is put in their place.</div>
      </div>
    )
  }
  const { settleX } = model
  const tenorsMoved = nodes.some(n => (moves[n.tenor] || 0) !== 0)
  const anyMove = spot !== 0 || rq !== 0 || rb !== 0 || tenorsMoved || flatPips !== 0
  const d = (x) => x - base.npv
  const settleOf = (q) => daysBetween(q.valuation_date, q.settlement_date) ?? Math.round(legT(q) * 365)
  const longX = legQs ? Math.max(settleX, ...legQs.map(settleOf).filter(Number.isFinite)) : settleX
  const reset = () => { setSpot(0); setQbp(0); setBbp(0); setVpt(0); setFpips(0); setMoves({}); setPill({ pair, quote: {}, base: {} }); setFixingText(null) }

  // the chart reports a drag as a distance in price from where it began; the shocks are worked out here
  // (not while the ticket reprices: the curve on screen is the one before the last change of terms)
  const onDragStart = () => { origin.current = stale ? null : { moves: nodes.map(n => moves[n.tenor] || 0), spot } }
  const onDrag = ({ index, whole, dPrice }) => {
    const o = origin.current
    if (!o || stale) return
    const k = index - 1                                                      // the chart's first point is spot
    if (whole || k < 0) {
      const ref = k < 0 ? quote.spot : (quote.spot + (nodes[k].points + o.moves[k] + flatPips) * pip) * carryFactor(rq, rb, nodes[k].days)
      const pct = spotPctFromDrag({ originPct: o.spot, dPrice, ref })
      if (pct != null) setSpot(pct)
    } else {
      const perPoint = pip * (1 + o.spot / 100) * carryFactor(rq, rb, nodes[k].days)     // so the point stays under the cursor
      const next = applyTenorDrag({ origin: o.moves, weights: rippleWeights(nodes, k), move: dPrice / perPoint, bounds: tenorBounds(nodes, { spot: quote.spot, pip }) })
      if (next) setMoves(Object.fromEntries(nodes.map((n, i) => [n.tenor, next[i]])))
    }
  }

  // the fixing the trade would settle on, and what it pays
  const cash = crypto || quote.shape === 'NDF' || (option && (terms?.settlement_type || quote.settlement_type) === 'NON_DELIVERABLE')
  const source = terms?.settlement_price_source || terms?.fixing_source || null
  const fixTime = fixingTime(sources, source) ?? terms?.valuation_time ?? null          // the source's own time, not the option's expiration time
  // an option fixes at expiry; a forward on the date its terms name, which may be before it settles
  const fixDate = option ? quote.expiry_date : (quote.fixing_date || terms?.fixing_date || terms?.valuation_date || quote.settlement_date)
  const fixesEarly = !option && cash && !!fixDate && fixDate !== quote.settlement_date
  const last = latestFixing(rows, source)
  const strike = strikeAsBooked(quote, terms, dp)            // K as the ticket books it: the terms' own, else the quote's at the pair's decimals
  const american = option && quote.style === 'AMERICAN'
  // the scenario fixing follows the shocked forward, grouped like every other number, until one is typed; a typed
  // one is read by the ticket's own rule (a comma only as an en-US thousands separator) and, unreadable, computes nothing
  const fixingShown = fixingText ?? formatRead(now.forward, dp)
  const fixingRead = parseNumber(fixingShown)
  const fixingBad = fixingRead.state === 'invalid'
  const fixing = fixingRead.state === 'ok' ? fixingRead.value : null
  const amount = settlementAmount({ shape: option ? 'OPTION' : 'FORWARD', optionType: quote.option_type, direction: quote.direction, notional: quote.base_notional, strike, fixing })
  const sgn = quote.direction === 'BUY' ? '+' : '−'
  const formula = option ? `${sgn}N × max(${quote.option_type === 'CALL' ? 'fixing − K' : 'K − fixing'}, 0)` : `${sgn}N × (fixing − K)`
  const nDp = crypto ? 4 : 0
  const quotedForward = quote.forward_mode === 'MARKET' && quote.market_points != null

  const chart = (
    <div data-testid="fx-scenario-curve" data-drag={stale ? 'off' : 'on'} style={stale ? { pointerEvents: 'none' } : undefined}>
      <FxScenarioChart today={quote.valuation_date} curve={curve} fixings={fixingSeries(rows, source)} tradeSource={source} strike={strike} levels={chartLevels(quote)}
        settle={{ x: settleX, date: quote.settlement_date }} expiry={option ? { x: daysBetween(quote.valuation_date, quote.expiry_date), date: quote.expiry_date } : null}
        legs={pkg ? pkg.each.map((q, i) => (i && q ? { n: i + 1, x: settleOf(q), forward: whole ? pNow.rows[i].forward : null } : null)).filter(Boolean) : null}
        fix={fixesEarly ? { x: daysBetween(quote.valuation_date, fixDate), date: fixDate } : null}
        forward={now.forward} dp={dp} moved={anyMove} ready={ready} height={220} onDragStart={onDragStart} onDrag={onDrag} onDragEnd={() => { origin.current = null }} />
    </div>
  )
  // an option's vol surface: the pair's stored surface as the pairs answer carries it, or nothing until that answer is back
  const pairRow = market?.pair === pair ? market.row : null
  // A package repriced whole whose first leg is a forward may still hold an option: its vol is then a curve of the
  // package, shocked like the others and shown at that option's expiry and strike (the first such leg).
  const optN = option ? 1 : whole ? pq.findIndex(q => q.shape === 'OPTION') + 1 : 0
  const optQ = optN ? (option ? quote : pq[optN - 1]) : null
  const volSurface = optQ && pairRow && 'vol_surface' in pairRow        // an answer without the field says nothing about a surface
    ? <FxVolSurface quote={optQ} surface={pairRow.vol_surface || null} pair={pair} vpt={european ? vpt : 0} dp={dp} ready={ready} headerStyle={secHdr} />
    : null

  // ── the curves the price was built on, each in its risk factor's colour, and what has been done to each ──
  const qc = quote.quote_currency, bc = quote.base_currency
  const rf = (k) => `var(${RISK_FACTORS[k].token})`
  const plus = (v, d = 0) => `${v > 0 ? '+' : ''}${Number(v.toFixed(d))}`
  const count = (shown, o) => shown.filter(x => Number(o?.[x.date])).length
  const said = (...parts) => parts.filter(Boolean).join(' · ') || '—'
  const points = (n) => (n ? `${n} ${n > 1 ? 'points' : 'point'}` : null)
  const nTen = nodes.filter(n => (moves[n.tenor] || 0) !== 0).length
  const curves = [
    { key: 'spot', name: crypto ? `${bc} SPOT` : `${pair} SPOT`, sub: quote.spot_source || 'the stored spot', color: rf(crypto ? 'cry' : 'fx'), says: said(spot ? `${plus(spot, 2)}%` : null) },
    { key: 'fwd', name: crypto ? `${bc} FORWARD BASIS` : `${pair} FORWARD POINTS`, color: rf('basis'),
      sub: model.quoted ? `the quoted points${model.label ? `, ${model.label}` : ''}` : 'the ticket\'s own carry from spot',
      says: said(crypto ? (european && bbp ? `${plus(bbp)} bp` : null) : (fpips ? `${plus(fpips)} pips` : null), points(nTen)) },
    european && { key: 'quote', name: quote.quote_curve || `${qc} CURVE`, sub: `${qc} discounting`, color: rf('ir'), says: said(qbp ? `${plus(qbp)} bp` : null, points(count(qPill, own.quote))) },
    european && !crypto && { key: 'base', name: quote.curves?.base?.id || `${bc} RATE`, sub: `${bc} discounting`, color: rf('ir'), says: said(bbp ? `${plus(bbp)} bp` : null, points(count(bPill, own.base))) },
    optQ && { key: 'vol', name: `${pair} VOL`, sub: optQ.vol_source || 'the pair\'s surface', color: rf('vol'), says: said(european && vpt ? `${plus(vpt, 2)} pt` : null) },
  ].filter(Boolean)
  const cur = curves.find(c => c.key === sel) || curves[0]
  const rateKey = cur.key === 'quote' || cur.key === 'base' ? cur.key : null
  const pills = rateKey === 'quote' ? qPill : rateKey === 'base' ? bPill : []
  const rateFlat = rateKey === 'quote' ? qbp : rateKey === 'base' ? bbp : 0

  // the flat shock of the selected curve
  const flat = {
    spot: { v: spot, set: setSpot, min: -SPOT_BOUND_PCT, max: SPOT_BOUND_PCT, step: 0.5, unit: '%', what: '% OF SPOT' },
    fwd: crypto ? (european ? { v: bbp, set: setBbp, min: -200, max: 200, step: 5, unit: 'bp', what: 'BP A YEAR · UP = FORWARD UP' } : null)
                : { v: fpips, set: setFpips, min: -200, max: 200, step: 1, unit: ' pips', what: 'PIPS ON EVERY TENOR' },
    quote: { v: qbp, set: setQbp, min: -200, max: 200, step: 5, unit: 'bp', what: 'BASIS POINTS' },
    base: { v: bbp, set: setBbp, min: -200, max: 200, step: 5, unit: 'bp', what: 'BASIS POINTS' },
    vol: european ? { v: vpt, set: setVpt, min: -5, max: 5, step: 0.25, unit: 'pt', what: 'VOL POINTS' } : null,
  }[cur.key]
  // a shock as typed: a sign, a number grouped the en-US way or not at all, a unit after it. Empty is no shock;
  // anything else ("abc", a decimal comma) is not read and the box goes back to what is applied
  const typedNumber = (text) => { const t = String(text).replace('−', '-').trim(); if (t === '') return 0; const m = /^([+-]?)\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d*)?|\.\d+)\s*(%|bp|pt|pips)?$/i.exec(t); if (!m) return null; const n = Number(m[2].replace(/,/g, '')); return Number.isFinite(n) ? (m[1] === '-' ? -n : n) : null }
  const clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

  // point by point: the forward curve's tenors (in points), or a rate curve's pillars (in basis points)
  const bounds = cur.key === 'fwd' ? tenorBounds(nodes, { spot: quote.spot, pip }) : null
  const lastTenor = (() => { const j = nodes.findIndex(n => n.x >= longX); return j < 0 ? nodes.length : Math.min(nodes.length, j + 2) })()
  const pointRows = cur.key === 'fwd'
    ? nodes.slice(0, lastTenor).map((n, i) => ({ id: n.tenor, name: n.tenor, market: fmt(curve[i + 1].base, dp), scen: fmt(curve[i + 1].shocked, dp), value: moves[n.tenor] || 0, d: crypto ? dp : 1,
        set: (v) => { const c = bounds ? clampTo(v, bounds[i].lo, bounds[i].hi) : v; setMoves({ ...moves, [n.tenor]: c }); return c } }))
    : rateKey
      ? pills.map(p => { const mine = Number(own[rateKey][p.date]) || 0; return { id: p.date, name: tenorLabel(p.t), market: p.zero_pct.toFixed(3), scen: (p.zero_pct + (rateFlat + mine) / 100).toFixed(3), value: mine, d: 0,
          set: (v) => { const c = clampTo(Math.round(v), -RATE_SHOCK_BOUND - rateFlat, RATE_SHOCK_BOUND - rateFlat); setOwn(rateKey, p.date, c); return c } } })
      : []
  const pointUnit = cur.key === 'fwd' ? (crypto ? `MOVE ${qc}` : 'MOVE PIPS') : 'SHOCK BP'
  const resetCurve = () => {
    if (cur.key === 'spot') setSpot(0)
    if (cur.key === 'fwd') { setMoves({}); if (crypto) setBbp(0); else setFpips(0) }
    if (cur.key === 'quote') { setQbp(0); setPill({ pair, quote: {}, base: own.base }) }
    if (cur.key === 'base') { setBbp(0); setPill({ pair, quote: own.quote, base: {} }) }
    if (cur.key === 'vol') setVpt(0)
  }

  // ── the result, factor by factor: each one's shock alone, what is left over when they act together, and the total ──
  const alone = european ? {
    spot: reprice(quote, { spotPct: spot, pip }),
    fwd: reprice(quote, { dPoints, baseBp: crypto ? rb : 0, pip }),
    quote: reprice(quote, { quoteBp: rq, pip }),
    ...(crypto ? {} : { base: reprice(quote, { baseBp: rb, pip }) }),
    ...(option ? { vol: reprice(quote, { volPts: vpt, pip }) } : {}),
  } : {}
  // a package: the same decomposition, each factor's shock alone over every leg
  const ONLY = { spot: ['spotPct'], fwd: crypto ? ['dPoints', 'baseBp'] : ['dPoints'], quote: ['quoteBp'], base: ['baseBp'], vol: ['volPts'] }
  const dOf = (k) => {
    if (!whole) return alone[k] ? alone[k].npv - base.npv : null
    const r = european && ONLY[k] ? repricePackage(pq, scen, { only: ONLY[k] }) : null
    return r ? r.npv - pBase.npv : null
  }
  const total = whole ? pNow.npv - pBase.npv : d(now.npv)
  const cross = european ? total - curves.reduce((a, c) => a + (dOf(c.key) ?? 0), 0) : null
  const shockSaid = {
    spot: spot ? `${plus(spot, 2)}%` : '—',
    fwd: crypto ? said(bbp ? `${plus(bbp)} bp` : null, dPoints ? `${signed(dPoints * pip, dp)} ${qc}` : null) : (dPoints ? `${plus(dPoints, 1)} pips` : '—'),
    quote: rq ? `${plus(rq, 1)} bp` : '—', base: rb ? `${plus(rb, 1)} bp` : '—', vol: vpt ? `${plus(vpt, 2)} pt` : '—',
  }
  // sensitivity × shock: what the ticket's own risk figures say the shock is worth (a dragged tenor has no figure of its own)
  const firstOf = (q, s) => ({
    spot: spot * (q.spot01 ?? 0), fwd: crypto ? bbp * (crybasis01(q) ?? 0) : null,
    quote: s.quoteBp * (q.ir01_disc ?? 0), base: s.baseBp * (q.ir01_base ?? 0), vol: vpt * (q.shape === 'OPTION' ? (q.vega ?? 0) : 0),
  })
  // a package: each leg's own figures times the shock that leg sees, summed (a dragged tenor still has no figure)
  const first = whole
    ? pq.map(q => firstOf(q, legShocks(q, scen))).reduce((a, b) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] == null ? null : a[k] + b[k]])))
    : firstOf(quote, { quoteBp: rq, baseBp: rb })
  const firstTotal = curves.reduce((a, c) => a + (first[c.key] ?? 0), 0)
  const cols = `150px repeat(${curves.length + 2}, minmax(0, 1fr))`
  const rRow = { display: 'grid', gridTemplateColumns: cols, alignItems: 'stretch', padding: '0 12px 0 16px', minWidth: 640 }
  const rName = { ...lbl, padding: '8px 8px 7px 0', whiteSpace: 'nowrap' }
  const rCell = { fontFamily: 'var(--mono)', fontVariantNumeric: 'tabular-nums', textAlign: 'right', padding: '7px 6px', whiteSpace: 'nowrap', fontSize: 13.5, fontWeight: 500 }
  const rSmall = { ...rCell, fontSize: 12, fontWeight: 400, color: 'var(--text-dim)', padding: '0 6px 7px' }
  const rTot = { background: 'var(--panel)', boxShadow: 'inset 1px 0 0 var(--border-hi)' }
  const money = (v, key, style = rCell) => <div key={key} style={{ ...style, ...(style === rCell ? { color: tone(v) } : null), ...(key === 'total' ? { ...rTot, ...(style === rCell ? { fontWeight: 600 } : null) } : null) }}>{v == null ? '—' : signedChange(v)}</div>
  const results = european && (
    <div data-testid="fx-scn-results" style={{ overflowX: 'auto', borderTop: '1px solid var(--border)', background: 'var(--bg)' }}>
      <div style={{ ...rRow, background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
        <div style={rName} />
        {curves.map(c => <div key={c.key} style={{ ...rCell, ...lbl, fontSize: 11 }}><span className="rf-mark" style={{ background: c.color }} />{c.key === 'spot' ? 'SPOT' : c.key === 'fwd' ? (crypto ? 'BASIS' : 'POINTS') : c.key === 'quote' ? `${qc} CURVE` : c.key === 'base' ? `${bc} RATE` : 'VOL'}</div>)}
        <div style={{ ...rCell, ...lbl, fontSize: 11 }}>CROSS<Note inline>What is left when the shocks act together: the total less each shock taken alone.</Note></div>
        <div style={{ ...rCell, ...lbl, fontSize: 11, fontWeight: 600, color: 'var(--text-hi)', ...rTot }}>TOTAL</div>
      </div>
      <div style={{ ...rRow, paddingTop: 7 }} data-testid="fx-scn-shock">
        <div style={{ ...rName, padding: '0 8px 7px 0' }}>{whole ? 'SHOCK AT LEG 1' : 'SHOCK AT SETTLEMENT'}</div>
        {curves.map(c => <div key={c.key} style={rSmall}>{shockSaid[c.key]}</div>)}
        <div style={rSmall}>—</div><div style={{ ...rSmall, ...rTot }}>—</div>
      </div>
      <div style={rRow} data-testid="fx-scn-change">
        <div style={rName}>{whole ? 'PACKAGE CHANGE' : 'CHANGE IN NPV'} · {qc}</div>
        {curves.map(c => money(dOf(c.key), c.key))}
        {money(cross, 'cross')}{money(total, 'total')}
      </div>
      <div style={rRow} data-testid="fx-scn-first">
        <div style={{ ...rName, padding: '0 8px 7px 0' }}>SENSITIVITY × SHOCK<Note inline>{DELTA_LABEL(crypto)} × the spot shock, IR01 × the rate shock{crypto ? ', CRYBASIS01 × the basis shock' : ''}{optQ ? ', VEGA × the vol shock' : ''}: the ticket's own risk figures. It is the change in value to first order, and it adds across factors{tenorsMoved || (!crypto && dPoints) ? '. A tenor moved in points has no figure of its own and is left out' : ''}.</Note></div>
        {curves.map(c => money(first[c.key], c.key, rSmall))}
        <div style={rSmall}>—</div>{money(firstTotal, 'total', rSmall)}
      </div>
    </div>
  )

  // ── one ladder: the selected curve moved flat, on top of the scenario ──
  const bpSteps = [-100, -50, -25, -10, 0, 10, 25, 50, 100]
  // a column of the ladder: `more` on top of the scenario. A package takes it on every leg; the forward shown is leg 1's.
  const step = (more) => {
    if (!whole) return at({ spotPct: spot + (more.spotPct || 0), quoteBp: rq + (more.quoteBp || 0), baseBp: rb + (more.baseBp || 0), volPts: vpt + (more.volPts || 0), dPoints: dPoints + (more.dPoints || 0) })
    const r = repricePackage(pq, scen, { extra: more })
    return r ? { forward: r.rows[0].forward, npv: r.npv } : null
  }
  const ladder = european && {
    spot: { xs: [-10, -5, -2, -1, 0, 1, 2, 5, 10], unit: '%', at: (x) => step({ spotPct: x }) },
    fwd: crypto ? { xs: bpSteps, unit: 'bp', at: (x) => step({ baseBp: -x }) } : { xs: [-100, -50, -20, -10, 0, 10, 20, 50, 100], unit: ' pips', at: (x) => step({ dPoints: x }) },
    quote: { xs: bpSteps, unit: 'bp', at: (x) => step({ quoteBp: x }) },
    base: { xs: bpSteps, unit: 'bp', at: (x) => step({ baseBp: x }) },
    vol: { xs: [-5, -2, -1, -0.5, 0, 0.5, 1, 2, 5], unit: 'pt', at: (x) => step({ volPts: x }) },
  }[cur.key]
  const scenNpv = whole ? pNow.npv : now.npv, marketNpv = whole ? pBase.npv : base.npv
  const none = { forward: null, npv: null }                                  // a ladder cell that cannot be priced shows a dash
  const lad = ladder ? ladder.xs.map(x => ({ x, r: ladder.at(x) || none })) : []
  const lRow = { display: 'grid', gridTemplateColumns: `150px repeat(${lad.length}, minmax(0, 1fr))`, padding: '0 12px 0 16px', minWidth: 760 }
  const lCell = { fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right', padding: '6px 6px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
  const mid = (x) => (x === 0 ? { background: 'var(--panel)' } : null)
  const ladderBlock = ladder && (
    <div data-testid="fx-scn-ladder" style={{ overflowX: 'auto', paddingBottom: 12, background: 'var(--bg)' }}>
      <div style={{ ...secHdr, margin: '12px 16px 8px' }}>LADDER · {cur.name}<Note inline>Each column is this curve moved flat by that much, on top of the scenario, with every other shock held. The middle column is the scenario itself.</Note></div>
      <div style={{ ...lRow, background: 'var(--panel)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ ...lbl, padding: '7px 0' }}>{cur.key === 'spot' ? 'SPOT' : 'SHIFT'}</div>
        {lad.map(({ x, r }) => x === 0
          ? <div key={x} data-testid="fx-scenario-base" data-forward={r.forward ?? ''} data-npv={r.npv ?? ''} style={{ ...lCell, ...lbl, fontSize: 11, color: 'var(--text-hi)', ...mid(x) }}>scenario</div>
          : <div key={x} style={{ ...lCell, ...lbl, fontSize: 11 }}>{plus(x, 2)}{ladder.unit}</div>)}
      </div>
      <div style={lRow}><div style={{ ...lbl, padding: '7px 0' }}>{whole ? 'FORWARD · LEG 1' : 'FORWARD'}</div>{lad.map(({ x, r }) => <div key={x} style={{ ...lCell, ...mid(x) }}>{fmt(r.forward, dp)}</div>)}</div>
      <div style={lRow}><div style={{ ...lbl, padding: '7px 0' }}>{whole ? 'PACKAGE NPV' : 'NPV'} · {qc}</div>{lad.map(({ x, r }) => <div key={x} style={{ ...lCell, color: tone(r.npv), ...mid(x) }}>{fmt(r.npv)}</div>)}</div>
      <div style={lRow}><div style={{ ...lbl, padding: '7px 0' }}>CHANGE</div>{lad.map(({ x, r }) => <div key={x} style={{ ...lCell, color: x === 0 ? 'var(--text-mute)' : tone(r.npv == null ? null : r.npv - scenNpv), ...mid(x) }}>{x === 0 || r.npv == null ? '—' : signedChange(r.npv - scenNpv)}</div>)}</div>
    </div>
  )

  // ── a package: every leg under the scenario, and their sum; or the reason the scenario is of leg 1 only ──
  const legRows = whole ? packageFlows(pq, { crypto })?.legs : null
  const pCell = { fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right', padding: '6px 8px 6px 0', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', borderBottom: '1px solid var(--border)' }
  const pHead = { ...lbl, textAlign: 'right', padding: '6px 8px 6px 0', borderBottom: '1px solid var(--border-hi)', whiteSpace: 'nowrap' }
  const pTop = { borderTop: '2px solid var(--border-hi)', borderBottom: 'none' }
  const packageBlock = pkg && (whole && legRows ? (
    <div data-testid="fx-scn-package" style={{ overflowX: 'auto', padding: '0 16px 12px', borderBottom: ladder ? '1px solid var(--border)' : 'none', background: 'var(--bg)' }}>
      <div style={{ ...secHdr, margin: '12px 0 8px' }}>THE PACKAGE UNDER THIS SCENARIO · {pkg.n} LEGS
        <Note inline>Every leg repriced under the same scenario, each at its own settlement date: the spot shock in full, the forward curve's move and each rate curve's shock read at that leg's date. The package is their sum.</Note></div>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead><tr>
          <th style={{ ...pHead, textAlign: 'left' }}>LEG</th><th style={{ ...pHead, textAlign: 'left' }}>TRADE</th><th style={pHead}>SETTLES</th>
          <th style={pHead}>FORWARD · SCENARIO</th><th style={pHead}>NPV AT THE MARKET</th><th style={pHead}>NPV · SCENARIO</th><th style={pHead}>CHANGE · {qc}</th>
        </tr></thead>
        <tbody>
          {legRows.map((l, i) => { const a = pBase.rows[i].npv, b = pNow.rows[i].npv; return (
            <tr key={l.n} data-testid="fx-scn-package-leg" data-change={b - a}>
              <td style={{ ...pCell, textAlign: 'left', fontFamily: 'var(--sans)' }}>LEG {l.n}</td>
              <td style={{ ...pCell, textAlign: 'left', fontFamily: 'var(--sans)' }}>{legWords(l, { base: bc, fmt, dp, nDp })}</td>
              <td style={pCell}>{l.date}</td>
              <td style={pCell}>{fmt(pNow.rows[i].forward, dp)}</td>
              <td style={{ ...pCell, color: tone(a) }}>{fmt(a)}</td>
              <td style={{ ...pCell, color: tone(b) }}>{fmt(b)}</td>
              <td style={{ ...pCell, color: tone(b - a) }}>{signedChange(b - a)}</td>
            </tr>) })}
          <tr data-testid="fx-scn-package-total" data-change={total} data-npv={pNow.npv}>
            <td colSpan={4} style={{ ...pCell, ...pTop, textAlign: 'left', fontFamily: 'var(--sans)', fontWeight: 600, color: 'var(--text-hi)' }}>PACKAGE · {qc}</td>
            <td style={{ ...pCell, ...pTop, color: tone(pBase.npv) }}>{fmt(pBase.npv)}</td>
            <td style={{ ...pCell, ...pTop, color: tone(pNow.npv) }}>{fmt(pNow.npv)}</td>
            <td style={{ ...pCell, ...pTop, fontWeight: 600, color: tone(total) }}>{signedChange(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  ) : (
    <div data-testid="fx-scn-package-off" style={{ padding: '10px 16px', borderBottom: ladder ? '1px solid var(--border)' : 'none', background: 'var(--bg)', fontSize: 12.5, color: 'var(--amber)' }}>
      This scenario is of leg 1 only, not the package of {pkg.n} legs: {pkgWhy}.
    </div>
  ))

  // ── the left column ──
  const curveBtn = (c) => (
    <button className="rj-press" key={c.key} type="button" data-testid={`fx-scn-curve-${c.key}`} aria-pressed={c.key === cur.key} onClick={() => setSel(c.key)}
      style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 8, alignItems: 'center', width: '100%', padding: '8px 10px', marginBottom: 6, textAlign: 'left', cursor: 'pointer',
        borderRadius: 'var(--r-2)', border: `1px solid ${c.key === cur.key ? 'var(--border-glow)' : 'var(--border)'}`, background: c.key === cur.key ? 'var(--panel-3)' : 'transparent',
        color: c.key === cur.key ? 'var(--text-hi)' : 'var(--text-dim)', fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 500, letterSpacing: '0.04em' }}>
      <span className="rf-mark" style={{ background: c.color, margin: 0 }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
        <span style={{ display: 'block', fontSize: 11, fontWeight: 400, letterSpacing: 0, color: 'var(--text-mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.sub}</span>
      </span>
      <span data-testid={`fx-scn-says-${c.key}`} style={{ fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 400, letterSpacing: 0, color: c.says === '—' ? 'var(--text-mute)' : 'var(--text-hi)', whiteSpace: 'nowrap' }}>{c.says}</span>
    </button>
  )
  const inputBox = { background: 'var(--bg)', color: 'var(--text-hi)', border: '1px solid var(--fld-bd)', borderRadius: 'var(--r-2)', padding: '5px 7px', fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right', width: '100%' }
  const setBox = { borderColor: 'var(--accent-dim)', boxShadow: 'inset 0 -2px 0 var(--accent)' }
  // the box shows what is applied: a value out of bounds comes back clamped, text that is not a number comes back as it was
  const commit = (e, apply, was, show) => { const v = typedNumber(e.target.value); e.target.value = show(v == null ? was : apply(v)) }
  const onEnter = (e) => { if (e.key === 'Enter') e.target.blur() }
  const left = (
    <div style={XVA_LEFT} data-testid="fx-scn-left">
      <div style={{ ...secHdr, marginTop: 4 }}>CURVES THAT PRICE THIS {pkg ? 'PACKAGE' : 'TRADE'}<Note inline>Every market input the price was built from, each in the colour of its risk factor. Select one to shock it flat, point by point, or by dragging on the chart.</Note></div>
      {curves.map(curveBtn)}
      {flat && (<>
        <div style={secHdr}>FLAT SHOCK · {flat.what}{cur.key === 'fwd' && quotedForward && european && <Note inline testId="fx-scenario-quoted-note">On quoted points the pricer holds the forward when a rate curve moves: the two curve shocks show the carry effect only, and a spot shock scales the points with spot.</Note>}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 84px', gap: 10, alignItems: 'center' }}>
          <input type="range" data-testid="fx-scn-flat" aria-label={`Flat shock, ${cur.name}`} min={flat.min} max={flat.max} step={flat.step} value={flat.v} disabled={stale}
            onChange={e => flat.set(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--text)' }} />
          <input key={`${cur.key}:${flat.v}`} type="text" inputMode="decimal" data-testid="fx-scn-flat-value" aria-label={`Flat shock value, ${cur.name}`} defaultValue={`${plus(flat.v, 2)}${flat.unit}`} disabled={stale}
            onBlur={e => commit(e, v => { const c = clampTo(v, flat.min, flat.max); flat.set(c); return c }, flat.v, v => `${plus(v, 2)}${flat.unit}`)} onKeyDown={onEnter} style={{ ...inputBox, ...(flat.v ? setBox : null) }} />
        </div>
      </>)}
      {pointRows.length > 0 && (<>
        <div style={secHdr}>POINT BY POINT<Note inline>{cur.key === 'fwd' ? 'Type a move on one tenor, or drag that tenor on the chart: a drag carries its neighbours with it, a typed move does not.' : 'Type a shock on one pillar, or drag it on the chart. A trade that settles on one date sees the curve at that date, and the shock there is read as the engine\'s curve reads it (linear in the log of the discount factor between pillars): +50 bp on one pillar is less than +50 bp at a date beside it.'} A typed point carries the brass rule.</Note></div>
        <table data-testid="fx-scn-points" style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
          <thead><tr>{['TENOR', 'MARKET', pointUnit, 'SCENARIO'].map((h, i) => <th key={h} style={{ ...lbl, textAlign: i ? 'right' : 'left', padding: '4px 4px 6px', borderBottom: '1px solid var(--border-hi)', whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
          <tbody>{pointRows.map(r => (
            <tr key={r.id}>
              <td style={{ fontSize: 12.5, color: 'var(--text-dim)', padding: '3px 4px', borderBottom: '1px solid var(--border)' }}>{r.name}</td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right', padding: '3px 4px', borderBottom: '1px solid var(--border)' }}>{r.market}</td>
              <td style={{ padding: '3px 4px', borderBottom: '1px solid var(--border)', width: 84 }}>
                <input key={`${r.id}:${r.value}`} type="text" inputMode="decimal" data-point={r.id} aria-label={`Shock at ${r.name}`} placeholder="—" defaultValue={r.value ? plus(r.value, r.d) : ''} disabled={stale}
                  onBlur={e => commit(e, r.set, r.value, v => (v ? plus(v, r.d) : ''))} onKeyDown={onEnter} style={{ ...inputBox, ...(r.value ? setBox : null) }} />
              </td>
              <td style={{ fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right', padding: '3px 4px', borderBottom: '1px solid var(--border)', color: 'var(--text-hi)' }}>{r.scen}</td>
            </tr>))}</tbody>
        </table>
      </>)}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" className="tbw-btn" style={{ flex: 1, padding: '7px 10px' }} data-testid="fx-scn-reset-curve" onClick={resetCurve}>RESET CURVE</button>
        <button type="button" className="tbw-btn" style={{ flex: 1, padding: '7px 10px' }} data-testid="fx-scenario-reset" onClick={reset}>RESET ALL</button>
      </div>
    </div>
  )

  // ── the right column: the selected curve, the result, the forward and the fixing, the ladder ──
  const chartTitle = cur.key === 'spot' || cur.key === 'fwd' ? `FORWARD CURVE · ${pair}` : rateKey ? `${cur.name} · ZERO RATE % A YEAR` : ''          // the surface block carries its own heading
  const chartSays = cur.key === 'spot' || cur.key === 'fwd'
    ? `${model.quoted ? `Spot plus the quoted points${model.label ? ` (${model.label})` : ''}.` : 'The curve is the ticket\'s own carry from spot to the forward.'} Drag a tenor up or down to move it; hold Shift, or drag the spot point at TODAY, to move the whole curve.`
    : rateKey ? `The curve's own pillars up to the ${pkg ? 'last leg\'s settlement' : 'settlement date'} and the two after it; those beyond cannot reach this ${pkg ? 'package' : 'trade'}. Drag a pillar up or down to shock it.`
    : `The pair's stored surface, read at ${option ? 'this' : `leg ${optN}'s`} expiry and strike as the engine reads it. The flat shock moves the level of the smile${whole && pq.filter(q => q.shape === 'OPTION').length > 1 ? ' on every option leg' : ''}, not its shape.`
  const selected = cur.key === 'spot' || cur.key === 'fwd' ? chart
    : rateKey ? (pills.length
        ? <FxRateCurve pillars={pills} own={own[rateKey]} flat={rateFlat} settleT={tSettle} color={cur.color} disabled={stale}
            shockAt={(p) => rateFlat + (Number(own[rateKey][p.date]) || 0)} onPoint={(date, bp) => setOwn(rateKey, date, bp)} />
        : <div data-testid="fx-scn-one-rate" style={{ padding: '36px 0', color: 'var(--text-dim)', fontSize: 12.5 }}>{rateKey === 'base' && quotedForward ? `On quoted points the ${bc} rate is the one the points imply, a single rate` : `This curve is one rate on this trade (${rateKey === 'base' ? (quote.base_discounting || 'a flat rate') : 'no pillars were sent'})`}: it has no points to move, so it takes the flat shock only.</div>)
    : (volSurface || <div style={{ padding: '36px 0', color: 'var(--text-dim)', fontSize: 12.5 }}>{ready ? `No vol surface is stored for ${pair}.` : `Reading the surface stored for ${pair}…`}</div>)
  const fixingCell = (
    <div style={{ position: 'relative', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 'var(--r-3)', padding: '9px 12px', minWidth: 0 }}>
      <div style={{ ...lbl, marginBottom: 4 }}>{option ? (american ? 'FIXING AT EXERCISE OR EXPIRY' : 'FIXING AT EXPIRY') : 'SCENARIO FIXING'}{pkg ? ' · LEG 1' : ''}
        <Note inline><span style={{ display: 'block' }}>{formula}, with N {fmt(quote.base_notional, nDp)} {bc} and K {fmt(strike, dp)}, in {qc}. The fixing follows the scenario's forward until one is typed.</span>
          <FixingSource source={source} time={fixTime} date={cash ? fixDate : null} settles={cash ? quote.settlement_date : null} american={american} last={last} cash={cash} dp={dp} /></Note>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input data-testid="fx-scenario-fixing" type="text" inputMode="decimal" aria-label="Scenario fixing" value={fixingShown} data-invalid={fixingBad ? 'true' : undefined}
          onChange={e => setFixingText(e.target.value)} style={{ ...inputBox, width: 112, ...(fixingText != null ? setBox : null), ...(fixingBad ? { color: 'var(--amber)', borderColor: 'var(--amber)', boxShadow: 'none' } : {}) }} />
        <span data-testid="fx-scenario-settlement" data-value={amount ?? ''} title="What the trade settles at that fixing" style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500, color: tone(amount, 2) }}>
          {amount == null ? '—' : `${signed(amount)} ${qc}`}
        </span>
      </div>
      {fixingText != null && <button type="button" className="tbw-btn" style={{ marginTop: 6, padding: '3px 8px', fontSize: 11 }} onClick={() => setFixingText(null)} title="Follow the scenario's forward at settlement again">USE THE FORWARD</button>}
      {fixingBad && <div data-testid="fx-scenario-fixing-invalid" style={{ fontSize: 11.5, color: 'var(--amber)', marginTop: 4 }}>the fixing is {NOT_A_NUMBER}</div>}
    </div>
  )
  return (
    <div className="tbw-no-drag" style={{ fontFamily: 'var(--sans)' }}>
      <div style={XVA_ROW}>
        {left}
        <div style={XVA_RIGHT}>
          <div style={{ padding: '10px 16px 6px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
              {chartTitle && <span style={{ ...secHdr, margin: 0 }}>{chartTitle}</span>}<Note inline>{chartSays}</Note>
              <span style={{ fontSize: 11, color: 'var(--amber)', border: '1px solid rgba(233,151,90,0.4)', borderRadius: 'var(--r-1)', padding: '1px 7px', letterSpacing: '0.06em' }}>APPROXIMATION</span>
              <Note inline testId="fx-scenario-banner">Scenario: an approximation in the browser, to cents with no shock; nothing is saved.{european ? '' : ` The ladder below is the engine's own, repriced on every cell (${quote.method || 'the style\'s own model'}), so it does not follow the dragged curve.`}</Note>
            </div>
            {selected}
          </div>
          {results}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr)) minmax(0, 1.5fr)', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--border)', borderBottom: ladder ? '1px solid var(--border)' : 'none', background: 'var(--bg)' }}>
            <Tile label={pkg ? 'FORWARD · LEG 1' : 'FORWARD · SCENARIO'} value={fmt(now.forward, dp)} testId="fx-scenario-forward" raw={now.forward} sub={`at the market ${fmt(base.forward, dp)}`} />
            <Tile label={`${whole ? 'PACKAGE NPV' : pkg ? 'LEG 1 NPV' : 'NPV'} · ${qc}`} value={fmt(scenNpv)} color={tone(scenNpv)} sub={`at the market ${fmt(marketNpv)}`} testId="fx-scenario-npv" raw={scenNpv} />
            <Tile label={`${whole ? 'PACKAGE CHANGE' : pkg ? 'LEG 1 CHANGE' : 'CHANGE'} · ${qc}`} value={signedChange(total)} color={tone(total)} testId="fx-scenario-change" raw={total} />
            {fixingCell}
          </div>
          {packageBlock}
          {ladderBlock}
          {!european && <div style={{ padding: '0 16px 12px', background: 'var(--bg)' }}><StyleLadder crypto={crypto} quote={quote} active={active} stale={stale} /></div>}
        </div>
      </div>
    </div>
  )
}

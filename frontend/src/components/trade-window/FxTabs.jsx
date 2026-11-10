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
import { apiFetch } from '../../lib/api'
import FxScenarioChart from './FxScenarioChart'
import FxVolSurface from './FxVolChart'
import { ladderKey, ladderShown, ladderWanted, marketKey } from './fx-requests'
import { NOT_A_NUMBER, crybasis01, formatRead, parseNumber } from './fx-ticket'
import {
  FIXING_DAYS, FX_SPOT_LAG_DAYS, SPOT_BOUND_PCT, applyTenorDrag, carryFactor, carryPoints, chartLevels, curveNodes, daysBetween,
  fixingSeries, fixingTime, interpPoints, latestFixing, modelWords, reprice, rippleWeights, settledFacts, settledState, settlementAmount, shockedCurve,
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
const secHdr = { fontSize: 12, fontWeight: 700, letterSpacing: '0.18em', color: 'var(--text)', fontFamily: 'var(--sans)', paddingLeft: 10, borderLeft: '3px solid var(--accent)', lineHeight: 1.2, margin: '14px 0 10px' }
const lbl = { fontSize: '0.8rem', letterSpacing: '0.12em', color: 'var(--text-dim)', fontFamily: 'var(--mono)' }
const th = { ...lbl, padding: '6px 8px 6px 0', textAlign: 'right', borderBottom: '1px solid var(--border-hi)' }
const td = { fontSize: '0.8125rem', fontFamily: 'var(--mono)', color: 'var(--text)', padding: '6px 8px 6px 0', textAlign: 'right', borderBottom: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' }
const tdL = { ...td, textAlign: 'left', fontFamily: 'var(--sans)' }
const wrap = { padding: `0 16px ${FOOTER_H}px`, fontFamily: 'var(--sans)' }

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

function Grid({ items, cols = 3, min }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: min ? `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` : `repeat(${cols}, 1fr)`, gap: 8 }}>
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

// ── A FIXED OR SETTLED TRADE ───────────────────────────────────────────────────
// A booked digital-asset trade whose fixing date has been reached comes back from the API with a state
// (FIXED: not yet settled; SETTLED), the fixing it settled on, the settlement amount, and nulls where a live
// quote has its pricing fields. The three tabs then state those facts as the API sent them. Nothing below is
// computed here: no forward, no payoff, no discounting.
const dot = (...parts) => parts.filter(p => p != null && p !== '').join(' · ')
const signed = (n, d = 2) => (n == null ? '—' : `${shown(n, d) > 0 ? '+' : ''}${fmt(n, d)}`)
const signedDelta = (x, base) => (x == null || base == null ? '—' : `${shown(x - base) > 0 ? '+' : ''}${fmt(x - base)}`)
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
        {f.state === 'SETTLED' ? 'This trade has settled' : 'This trade has fixed and is not yet settled'}: there is no forward left to shock.
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
        <div style={secHdr}>{sheet}</div>
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
        {settledBlock || (<>
        <div style={secHdr}>MARKET IT WAS PRICED ON</div>
        <Grid items={[
          ['SPOT', fmt(quote.spot, dp), quote.spot_source || ''],
          ['FORWARD TO SETTLEMENT', fmt(quote.forward, dp), quote.forward_mode === 'MARKET' && quote.market_points != null ? 'quoted points' : 'implied from yields'],
          ['VOL', quote.vol_pct == null ? '—' : `${fmt(quote.vol_pct, 3)}%`, dot(quote.vol_tier, quote.vol_source, quote.vol_marks) || 'no vol on this quote'],
          ...(quote.forward_delta != null ? [['FORWARD DELTA', `${fmt(quote.forward_delta * 100, 1)}%`, `d1 ${fmt(quote.d1, 4)} · d2 ${fmt(quote.d2, 4)}`]] : [['DELTA', `${fmt(quote.delta_base_units, 0)} ${quote.base_currency}`, 'by repricing, ±1% spot']]),
          [`${quote.quote_currency} CURVE`, quote.quote_curve || '—', `DF ${fmt(quote.df_quote, 6)} to settlement${quote.quote_curve_snapshot ? ' · ' + quote.quote_curve_snapshot : ''}`],
          // the engine's own method words; "on the forward to settlement" only when they do not already name a forward
          ['MODEL', modelWords(quote.method, crypto ? 'Black-76' : 'Garman–Kohlhagen'), quote.style && quote.style !== 'EUROPEAN' ? 'same lognormal dynamics; σ from the ATM/RR/BF surface at the strike, held flat for the barrier' : crypto ? 'the FX option engine with the carry rate as the base rate; σ from the ATM/RR/BF surface' : 'Black–Scholes with the base currency as the dividend-paying asset; σ from the ATM/RR/BF surface'],
        ]} />
        </>)}
        <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 10 }}>Terms are edited on the TRADE tab; this is the record the counterparty will sign.</div>
      </div>
    )
  }
  return (
    <div className="tbw-no-drag" style={wrap}>
      <div style={secHdr}>{sheet}</div>
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
      <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 10 }}>Terms are edited on the TRADE tab; this is the record the counterparty will sign.</div>
    </div>
  )
}

// ── CASHFLOWS ──────────────────────────────────────────────────────────────────
export function FxCashflowsPanel({ stale = false, active = true, ...rest }) {
  return <StaleFrame stale={stale && !!rest.quote} active={active}><CashflowsBody {...rest} /></StaleFrame>
}

function CashflowsBody({ quote, crypto }) {
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
        <div style={secHdr}>FLOWS · PREMIUM {quote.valuation_date} · SETTLEMENT {quote.settlement_date}</div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={{ ...th, textAlign: 'left' }}>FLOW</th><th style={th}>DATE</th><th style={th}>AMOUNT</th><th style={th}>DF</th><th style={th}>PV {quote.quote_currency}</th></tr></thead>
          <tbody>
            <tr><td style={tdL}>PREMIUM<div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{sign > 0 ? 'paid' : 'received'} on the trade date; not part of the value after it is paid</div></td>
              <td style={td}>{quote.valuation_date}</td><td style={{ ...td, color: tone(premium) }}>{fmt(premium)} {quote.quote_currency}</td><td style={td}>1.000000</td><td style={td}>{fmt(premium)}</td></tr>
            <tr><td style={tdL}>{payoutStyle ? 'PAYOUT' : 'PAYOFF AT EXPIRY'}<div style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{quote.style === 'TOUCH' ? `${fmt(quote.payout, 0)} ${quote.payout_currency === 'BASE' ? quote.base_currency : quote.quote_currency} ${quote.pay_at_hit ? 'when the barrier is hit' : 'at expiry if ' + ((quote.touch_type || '').includes('NO') ? 'never touched' : 'touched')}; at today's forward the barrier is not reached` : quote.style === 'DIGITAL' ? `${fmt(quote.payout, 0)} ${quote.payout_currency === 'BASE' ? quote.base_currency : quote.quote_currency} if the fixing is ${call ? 'above' : 'below'} ${fmt(quote.strike, dp)}; shown at today's forward` : `max(${call ? 'S − K' : 'K − S'}, 0) × N, at today's forward; the fixing on ${quote.expiry_date} decides${quote.style === 'BARRIER' || quote.style === 'DOUBLE_BARRIER' ? ' and the barrier must not have knocked it out' : ''}`}</div></td>
              <td style={td}>{quote.settlement_date}</td><td style={{ ...td, color: tone(intrinsic) }}>{fmt(intrinsic)} {quote.quote_currency}</td><td style={td}>{fmt(quote.df_quote, 6)}</td><td style={td}>{fmt(intrinsic * quote.df_quote)}</td></tr>
            <tr><td style={{ ...tdL, fontWeight: 700, borderBottom: 'none' }}>OPTION VALUE</td><td style={{ ...td, borderBottom: 'none' }} colSpan={3}>{quote.time_value != null ? `intrinsic ${fmt(intrinsic * quote.df_quote)} + time value ${fmt(sign * quote.time_value)}` : `${quote.method || ''}`}</td>
              <td style={{ ...td, fontWeight: 700, borderBottom: 'none', color: tone(quote.npv) }}>{fmt(quote.npv)}</td></tr>
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
              <td style={{ ...td, color: tone(r.amount, crypto && r.ccy !== 'USD' ? 4 : 0) }}>{fmt(r.amount, crypto && r.ccy !== 'USD' ? 4 : 0)} {r.ccy}</td>
              {!ndf && <td style={td}>{fmt(r.inQuote)}</td>}
              <td style={td}>{fmt(r.df, 6)}</td>
              <td style={{ ...td, color: tone((r.inQuote ?? r.amount) * r.df) }}>{fmt((r.inQuote ?? r.amount) * r.df)}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...tdL, fontWeight: 700, borderBottom: 'none' }}>NPV</td><td style={{ ...td, borderBottom: 'none' }} colSpan={ndf ? 3 : 4}></td>
            <td style={{ ...td, fontWeight: 700, borderBottom: 'none', color: tone(pv) }}>{fmt(pv)}</td>
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
// spot shock, the rate shocks and whatever was dragged. An approximation, so no round trip
// is needed and the chart, the tiles and the ladders move together: with no shock it agrees
// with the engine to cents (an option's Φ here is a polynomial), a spot shock scales the
// quoted points with spot, and on quoted points the pricer would not move the forward with
// the rate sliders. The banner and the caption under the sliders say so.
function Slider({ label, v, set, min, max, step, unit }) {
  const shown = Number(v.toFixed(2))            // a dragged curve leaves the spot shock between the slider's steps
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 90px', gap: 10, alignItems: 'center', marginBottom: 8 }}>
      <span style={lbl}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={e => set(Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} />
      {/* a shock's size is neutral: red and green are for a value's sign (a loss, a gain), not for up and down */}
      <span style={{ fontFamily: 'var(--mono)', fontSize: '0.875rem', color: v === 0 ? 'var(--text-dim)' : 'var(--text)', textAlign: 'right' }}>{v > 0 ? '+' : ''}{shown}{unit}</span>
    </div>
  )
}

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

function ScenarioBody({ quote, crypto, terms, active, stale }) {
  const [spot, setSpot] = useState(0)
  const [qbp, setQbp] = useState(0)
  const [bbp, setBbp] = useState(0)
  const [vpt, setVpt] = useState(0)
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
    const quoted = quote.forward_mode === 'MARKET' && quote.market_points != null && !!row?.forward_points && Object.keys(row.forward_points).length > 0
    // points are quoted from the spot date: the lag the quote itself implies, else the market's convention
    const lag = spotLagDays({ points: quoted ? row.forward_points : null, settleDays: settleX, marketPoints: quote.market_points, crypto, tSpot: quote.t_spot, tenorDays }) ?? (crypto ? 0 : FX_SPOT_LAG_DAYS)
    const days = Math.max(settleX - lag, 0)
    const nodes = curveNodes(quoted ? row.forward_points : carryPoints({ spot: quote.spot, forward: quote.forward, days, pip, tenorDays }), lag, tenorDays)
    if (!nodes) return null
    return { pip, settleX, quoted, days, nodes, tenorDays, label: quoted ? row.forward_curve?.label : null }
  }, [quote, done, crypto, market, pair, option])

  if (!quote) return <Empty what="Scenarios" />
  const rows = stored?.pair === pair ? stored.rows : []
  const sources = market?.pair === pair ? market.row?.fixing_sources : null
  const ready = stored?.pair === pair && marketFor === marketId               // both requests are back: the chart will not move again by itself
  if (done) return <SettledView quote={quote} terms={terms} crypto={crypto} rows={rows} sources={sources} ready={ready} />

  // the rate sliders exist for the closed form only; a digital asset's second slider is its forward basis, +1 bp a
  // year of which is −1 bp on the carry rate the form takes (CRYBASIS01 = −FUND01)
  const rq = european ? qbp : 0, rb = european ? (crypto ? -bbp : bbp) : 0
  const nodes = model?.nodes || []
  const pip = model?.pip
  const moved = nodes.map(n => moves[n.tenor] || 0)
  const dPoints = model ? interpPoints(Object.fromEntries(nodes.map((n, i) => [n.tenor, moved[i]])), model.days, model.tenorDays) : null
  const at = (o = {}) => (dPoints == null ? null : reprice(quote, { spotPct: spot, quoteBp: rq, baseBp: rb, volPts: vpt, dPoints, pip, ...o }))
  const base = model ? reprice(quote) : null
  const now = base ? at() : null
  const curve = model ? shockedCurve({ spot: quote.spot, pip, nodes, moves: moved, spotPct: spot, quoteBp: rq, baseBp: rb }) : null
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
  const tenorsMoved = moved.some(m => m !== 0)
  const anyMove = spot !== 0 || rq !== 0 || rb !== 0 || tenorsMoved
  const d = (x) => x - base.npv
  const reset = () => { setSpot(0); setQbp(0); setBbp(0); setVpt(0); setMoves({}); setFixingText(null) }

  // the chart reports a drag as a distance in price from where it began; the shocks are worked out here
  // (not while the ticket reprices: the curve on screen is the one before the last change of terms)
  const onDragStart = () => { origin.current = stale ? null : { moves: moved.slice(), spot } }
  const onDrag = ({ index, whole, dPrice }) => {
    const o = origin.current
    if (!o || stale) return
    const k = index - 1                                                      // the chart's first point is spot
    if (whole || k < 0) {
      const ref = k < 0 ? quote.spot : (quote.spot + (nodes[k].points + o.moves[k]) * pip) * carryFactor(rq, rb, nodes[k].days)
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
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={secHdr}>FORWARD CURVE · {pair}</div>
        <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
          {model.quoted ? `Spot plus the quoted points${model.label ? ` (${model.label})` : ''}` : 'The curve is the ticket\'s own carry from spot to the forward'}
        </div>
      </div>
      <FxScenarioChart today={quote.valuation_date} curve={curve} fixings={fixingSeries(rows, source)} tradeSource={source} strike={strike} levels={chartLevels(quote)}
        settle={{ x: settleX, date: quote.settlement_date }} expiry={option ? { x: daysBetween(quote.valuation_date, quote.expiry_date), date: quote.expiry_date } : null}
        fix={fixesEarly ? { x: daysBetween(quote.valuation_date, fixDate), date: fixDate } : null}
        forward={now.forward} dp={dp} moved={anyMove} ready={ready} onDragStart={onDragStart} onDrag={onDrag} onDragEnd={() => { origin.current = null }} />
    </div>
  )
  // an option's vol surface, under the forward curve: the pair's stored surface as the pairs answer carries it, or one
  // line saying none is stored. Nothing until that answer is back, and nothing for a forward. The VOL slider exists
  // for the closed form only, like the rate sliders.
  const pairRow = market?.pair === pair ? market.row : null
  const volSurface = option && pairRow && 'vol_surface' in pairRow        // an answer without the field says nothing about a surface
    ? <FxVolSurface quote={quote} surface={pairRow.vol_surface || null} pair={pair} vpt={european ? vpt : 0} dp={dp} ready={ready} headerStyle={secHdr} />
    : null
  const forwardTile = ['FORWARD', fmt(now.forward, dp), `base ${fmt(base.forward, dp)}`, 'fx-scenario-forward', now.forward]
  const resetButton = <button onClick={reset} className="btn" data-testid="fx-scenario-reset" style={{ marginTop: 4 }}>RESET</button>
  const banner = { background: 'rgba(233,151,90,0.06)', borderBottom: '1px solid rgba(233,151,90,0.15)', padding: '5px 12px', margin: '0 -16px', fontSize: '0.8125rem', color: 'var(--amber)' }
  const approximation = <><span aria-hidden="true">⚠ </span><span data-testid="fx-scenario-banner">Scenario: an approximation in the browser, to cents with no shock; nothing is saved.</span></>

  if (!european) {
    return (
      <div className="tbw-no-drag" style={wrap}>
        <div style={banner}>{approximation} <span>The ladder below is the engine's own, repriced on every cell ({quote.method || 'the style\'s own model'}).</span></div>
        {chart}
        {volSurface}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)', gap: 20, alignItems: 'start', marginTop: 12 }}>
          <div>
            <Grid cols={1} items={[forwardTile]} />
            {resetButton}
          </div>
          <div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
              The chart moves the forward to settlement in closed form. The ladder below is the API's: the engine reprices this {(quote.style || '').replace(/_/g, ' ').toLowerCase()} option on its own grid of spot and vol shocks, so it does not follow the dragged curve.
            </div>
            <FixingSource source={source} time={fixTime} date={cash ? fixDate : null} settles={cash ? quote.settlement_date : null} american={american} last={last} cash={cash} dp={dp} />
          </div>
        </div>
        <StyleLadder crypto={crypto} quote={quote} active={active} stale={stale} />
      </div>
    )
  }

  const spotLadder = [-10, -5, -2, -1, 0, 1, 2, 5, 10]
  const rateLadder = [-100, -50, -25, 0, 25, 50, 100]
  // the digital asset's second rate shock is on its forward basis (CRYBASIS01, long positive): +1 bp a year on the
  // basis is −1 bp on the carry rate the closed form takes, so the slider's sign is turned for the repricing
  const firstOrder = spot * (quote.spot01 ?? 0) + qbp * (quote.ir01_disc ?? 0) + bbp * (crypto ? (crybasis01(quote) ?? 0) : (quote.ir01_base ?? 0)) + vpt * (quote.vega ?? 0)
  const none = { forward: null, npv: null }                                  // a ladder cell that cannot be priced shows a dash
  return (
    <div className="tbw-no-drag" style={wrap}>
      <div style={banner}>{approximation}</div>
      {chart}
      {volSurface}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 360px) minmax(0, 1fr)', gap: 20 }}>
        <div>
          <div style={secHdr}>SHOCKS</div>
          <Slider label="SPOT" v={spot} set={setSpot} min={-SPOT_BOUND_PCT} max={SPOT_BOUND_PCT} step={0.5} unit="%" />
          <Slider label={`${quote.quote_currency} CURVE`} v={qbp} set={setQbp} min={-200} max={200} step={5} unit="bp" />
          <Slider label={crypto ? `BASIS (${quote.quote_currency} − ${quote.base_currency}) · 1 bp up = forward up` : `${quote.base_currency} CURVE`} v={bbp} set={setBbp} min={-200} max={200} step={5} unit="bp" />
          {quotedForward && <div data-testid="fx-scenario-quoted-note" style={{ fontSize: '0.7rem', color: 'var(--text-dim)', margin: '-2px 0 8px' }}>on quoted points the pricer holds the forward when a curve moves: the two curve sliders show the carry effect only, and a spot shock scales the points with spot</div>}
          {option && <Slider label="VOL" v={vpt} set={setVpt} min={-5} max={5} step={0.25} unit="pt" />}
          {resetButton}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: 20, alignContent: 'start' }}>
          <div>
            <div style={secHdr}>SHOCKED</div>
            <Grid cols={2} items={[
              forwardTile,
              [`NPV ${quote.quote_currency}`, fmt(now.npv), `base ${fmt(base.npv)}`],
              ['ΔNPV', signedChange(d(now.npv)), 'vs base'],
              ['FIRST ORDER', signedChange(firstOrder), `${DELTA_LABEL(crypto)}·Δspot + ${crypto ? 'IR01·Δbp + CRYBASIS01·Δbp' : 'IR01s·Δbp'}${option ? ' + VEGA·Δvol' : ''}${tenorsMoved ? ' · without the dragged tenors' : ''}`],
            ]} />
          </div>
          <div>
            <div style={secHdr}>{option ? (american ? 'FIXING AT EXERCISE OR EXPIRY' : 'FIXING AT EXPIRY') : 'FIXING'}</div>
            <div style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '8px 10px', background: 'var(--bg-deep)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ ...lbl, fontSize: '0.76rem' }}>SCENARIO FIXING</span>
                <input data-testid="fx-scenario-fixing" type="text" inputMode="decimal" aria-label="Scenario fixing" value={fixingShown} data-invalid={fixingBad ? 'true' : undefined}
                  onChange={e => setFixingText(e.target.value)} style={{ width: 130, fontFamily: 'var(--mono)', textAlign: 'right', ...(fixingBad ? { color: 'var(--amber)', borderColor: 'var(--amber)' } : {}) }} />
                {fixingText != null && <button className="btn" onClick={() => setFixingText(null)} title="Follow the shocked forward at settlement again">USE THE FORWARD</button>}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{ ...lbl, fontSize: '0.76rem' }}>SETTLEMENT AMOUNT</span>
                <span data-testid="fx-scenario-settlement" data-value={amount ?? ''} style={{ fontFamily: 'var(--mono)', fontSize: '0.9375rem', color: tone(amount, 2) }}>
                  {amount == null ? '—' : `${signed(amount)} ${quote.quote_currency}`}
                </span>
              </div>
              {fixingBad && <div data-testid="fx-scenario-fixing-invalid" style={{ fontSize: '0.7rem', color: 'var(--amber)', marginTop: 4 }}>the fixing is {NOT_A_NUMBER}</div>}
              <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: 4 }}>
                {formula}, with N {fmt(quote.base_notional, nDp)} {quote.base_currency} and K {fmt(strike, dp)}, in {quote.quote_currency}
              </div>
            </div>
            <FixingSource source={source} time={fixTime} date={cash ? fixDate : null} settles={cash ? quote.settlement_date : null} american={american} last={last} cash={cash} dp={dp} />
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: '0 20px' }}>
        <div>
          <div style={secHdr}>SPOT LADDER · {quote.quote_currency}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>SPOT</th><th style={th}>LEVEL</th><th style={th}>FORWARD</th><th style={th}>NPV</th><th style={th}>ΔNPV</th></tr></thead>
            <tbody>{spotLadder.map(s => { const r = at({ spotPct: s }) || none; return (
              <tr key={s} data-testid={s === 0 ? 'fx-scenario-base' : undefined} data-forward={s === 0 ? r.forward ?? '' : undefined} data-npv={s === 0 ? r.npv ?? '' : undefined}
                  style={{ background: s === 0 ? 'var(--accent-glow)' : 'transparent' }}>
                <td style={td}>{s > 0 ? '+' : ''}{s}%</td><td style={td}>{fmt(quote.spot * (1 + s / 100), dp)}</td><td style={td}>{fmt(r.forward, dp)}</td>
                <td style={{ ...td, color: tone(r.npv) }}>{fmt(r.npv)}</td>
                <td style={{ ...td, color: tone(d(r.npv)) }}>{signedDelta(r.npv, base.npv)}</td>
              </tr>) })}</tbody>
          </table>
          <div data-testid="fx-spot-ladder-note" style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 6 }}>at the stored spot, not the dragged one: each row is the closed form at that spot; the rate ladder keeps the dragged spot</div>
        </div>
        <div>
          <div style={secHdr}>{crypto ? `RATE LADDER · ${quote.quote_currency} CURVE AND ${quote.base_currency} BASIS, BOTH SHIFTED` : 'RATE LADDER · PARALLEL, BOTH CURVES'}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>SHIFT</th><th style={th}>FORWARD</th><th style={th}>NPV</th><th style={th}>ΔNPV</th><th style={th}>{quote.quote_currency} ONLY</th><th style={th} title={crypto ? `the basis (${quote.quote_currency} − ${quote.base_currency}): 1 bp up = forward up` : undefined}>{crypto ? 'BASIS' : quote.base_currency} ONLY</th></tr></thead>
            <tbody>{rateLadder.map(b => { const bb0 = crypto ? -b : b; const r = at({ quoteBp: b, baseBp: bb0 }) || none; const q = at({ quoteBp: b, baseBp: 0 }) || none; const bb = at({ quoteBp: 0, baseBp: bb0 }) || none; return (
              <tr key={b} style={{ background: b === 0 ? 'var(--accent-glow)' : 'transparent' }}>
                <td style={td}>{b > 0 ? '+' : ''}{b}bp</td><td style={td}>{fmt(r.forward, dp)}</td>
                <td style={{ ...td, color: tone(r.npv) }}>{fmt(r.npv)}</td>
                <td style={{ ...td, color: tone(d(r.npv)) }}>{signedDelta(r.npv, base.npv)}</td>
                <td style={td}>{signedDelta(q.npv, base.npv)}</td><td style={td}>{signedDelta(bb.npv, base.npv)}</td>
              </tr>) })}</tbody>
          </table>
        </div>
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 10 }}>{option ? `An option is convex in spot: ΔNPV runs ahead of ${DELTA_LABEL(crypto)} × the shock on the way up and behind it on the way down, which is the gamma; the vol slider moves the smile level, not its shape.` : `A forward is linear in spot, so ΔNPV equals ${DELTA_LABEL(crypto)} × the shock exactly; ${crypto ? `the rate ladder shows the ${quote.quote_currency} curve and the basis each moving the forward, the basis up with its shift` : 'the rate ladder shows the two curve legs offsetting at a fair strike'}.`}{tenorsMoved ? ' Both ladders are read off the dragged curve.' : ''}</div>
    </div>
  )
}

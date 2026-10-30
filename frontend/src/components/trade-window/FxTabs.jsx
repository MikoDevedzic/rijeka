// trade-window/FxTabs.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// DETAILS, CASHFLOWS and CURVE SCENARIO for an FX or crypto forward. A forward
// has one settlement and no schedule, so these are purpose-built views over
// the priced quote rather than the swap panels:
//   FxDetailsPanel   — the term sheet as it will be booked, and the market it was priced on
//   FxCashflowsPanel — the settlement flows (deliverable: two legs; NDF: one net cash amount)
//   FxScenarioPanel  — spot and rate shocks repriced with the same closed form the engine uses
// ────────────────────────────────────────────────────────────────────────────────────
import { useMemo, useState } from 'react'

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
      {items.map(([k, v, s]) => (
        <div key={k} style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '7px 9px', background: 'var(--bg-deep)' }}>
          <div style={{ ...lbl, fontSize: '0.76rem', marginBottom: 2 }}>{k}</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: '0.9375rem', color: 'var(--text-hi)' }}>{v ?? '—'}</div>
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
// The engine's closed form, repriced here: NPV = ±N·(S'·DF_b'/DF_q' − K)·DF_q', with
// DF' = DF·exp(−Δr·T) for a parallel shift on that curve. Exact for a forward, so
// no round trip is needed and the ladder is instant.
function reprice(q, spotPct, quoteBp, baseBp) {
  const sign = q.direction === 'BUY' ? 1 : -1
  const S = q.spot * (1 + spotPct / 100)
  const dfq = q.df_quote * Math.exp(-quoteBp / 10000 * q.t)
  const dfb = q.df_base * Math.exp(-baseBp / 10000 * q.t)
  const F = q.forward_mode === 'MARKET' && q.market_points != null ? q.forward * (S / q.spot) * (dfb / q.df_base) / (dfq / q.df_quote) : S * dfb / dfq
  return { forward: F, npv: sign * q.base_notional * (F - q.forward_rate) * dfq }
}

function Slider({ label, v, set, min, max, step, unit }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr 90px', gap: 10, alignItems: 'center', marginBottom: 8 }}>
      <span style={lbl}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={e => set(Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} />
      <span style={{ fontFamily: 'var(--mono)', fontSize: '0.875rem', color: v === 0 ? 'var(--text-dim)' : v > 0 ? 'var(--red)' : 'var(--blue)', textAlign: 'right' }}>{v > 0 ? '+' : ''}{v}{unit}</span>
    </div>
  )
}

export function FxScenarioPanel({ quote, crypto }) {
  const [spot, setSpot] = useState(0)
  const [qbp, setQbp] = useState(0)
  const [bbp, setBbp] = useState(0)
  const dp = rateDp(quote)
  const base = useMemo(() => quote ? reprice(quote, 0, 0, 0) : null, [quote])
  const now = useMemo(() => quote ? reprice(quote, spot, qbp, bbp) : null, [quote, spot, qbp, bbp])
  if (!quote) return <Empty what="Scenarios" />
  const spotLadder = [-10, -5, -2, -1, 0, 1, 2, 5, 10]
  const rateLadder = [-100, -50, -25, 0, 25, 50, 100]
  const d = (x) => x - base.npv
  return (
    <div className="tbw-no-drag" style={wrap}>
      <div style={{ background: 'rgba(240,160,32,0.06)', borderBottom: '1px solid rgba(240,160,32,0.15)', padding: '5px 12px', margin: '0 -16px', fontSize: '0.8125rem', color: 'var(--amber)' }}>
        ⚠ Scenario — repriced with the engine's closed form; for analysis only, nothing is saved.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 20 }}>
        <div>
          <div style={secHdr}>SHOCKS</div>
          <Slider label="SPOT" v={spot} set={setSpot} min={-20} max={20} step={0.5} unit="%" />
          <Slider label={`${quote.quote_currency} CURVE`} v={qbp} set={setQbp} min={-200} max={200} step={5} unit="bp" />
          <Slider label={crypto ? `${quote.base_currency} FUNDING` : `${quote.base_currency} CURVE`} v={bbp} set={setBbp} min={-200} max={200} step={5} unit="bp" />
          <button onClick={() => { setSpot(0); setQbp(0); setBbp(0) }} className="btn" style={{ marginTop: 4 }}>RESET</button>
          <div style={secHdr}>SHOCKED</div>
          <Grid cols={2} items={[
            ['FORWARD', fmt(now.forward, dp), `base ${fmt(base.forward, dp)}`],
            [`NPV ${quote.quote_currency}`, fmt(now.npv), `base ${fmt(base.npv)}`],
            ['ΔNPV', (d(now.npv) >= 0 ? '+' : '') + fmt(d(now.npv)), 'vs base'],
            ['FIRST ORDER', (spot * (quote.spot01 ?? 0) + qbp * (quote.ir01_disc ?? 0) + bbp * (quote.ir01_base ?? 0) >= 0 ? '+' : '') + fmt(spot * (quote.spot01 ?? 0) + qbp * (quote.ir01_disc ?? 0) + bbp * (quote.ir01_base ?? 0)), `${crypto ? quote.base_currency : 'FX'}01·Δspot + IR01s·Δbp`],
          ]} />
        </div>
        <div>
          <div style={secHdr}>SPOT LADDER · {quote.quote_currency}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>SPOT</th><th style={th}>LEVEL</th><th style={th}>FORWARD</th><th style={th}>NPV</th><th style={th}>ΔNPV</th></tr></thead>
            <tbody>{spotLadder.map(s => { const r = reprice(quote, s, qbp, bbp); return (
              <tr key={s} style={{ background: s === 0 ? 'var(--accent-glow)' : 'transparent' }}>
                <td style={td}>{s > 0 ? '+' : ''}{s}%</td><td style={td}>{fmt(quote.spot * (1 + s / 100), dp)}</td><td style={td}>{fmt(r.forward, dp)}</td>
                <td style={{ ...td, color: r.npv >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(r.npv)}</td>
                <td style={{ ...td, color: d(r.npv) >= 0 ? 'var(--green)' : 'var(--red)' }}>{d(r.npv) >= 0 ? '+' : ''}{fmt(d(r.npv))}</td>
              </tr>) })}</tbody>
          </table>
          <div style={secHdr}>RATE LADDER · PARALLEL, BOTH CURVES</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>SHIFT</th><th style={th}>FORWARD</th><th style={th}>NPV</th><th style={th}>ΔNPV</th><th style={th}>{quote.quote_currency} ONLY</th><th style={th}>{crypto ? 'FUNDING' : quote.base_currency} ONLY</th></tr></thead>
            <tbody>{rateLadder.map(b => { const r = reprice(quote, spot, b, b); const q = reprice(quote, spot, b, 0); const bb = reprice(quote, spot, 0, b); return (
              <tr key={b} style={{ background: b === 0 ? 'var(--accent-glow)' : 'transparent' }}>
                <td style={td}>{b > 0 ? '+' : ''}{b}bp</td><td style={td}>{fmt(r.forward, dp)}</td>
                <td style={{ ...td, color: r.npv >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt(r.npv)}</td>
                <td style={{ ...td, color: d(r.npv) >= 0 ? 'var(--green)' : 'var(--red)' }}>{d(r.npv) >= 0 ? '+' : ''}{fmt(d(r.npv))}</td>
                <td style={td}>{d(q.npv) >= 0 ? '+' : ''}{fmt(d(q.npv))}</td><td style={td}>{d(bb.npv) >= 0 ? '+' : ''}{fmt(d(bb.npv))}</td>
              </tr>) })}</tbody>
          </table>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-mute)', marginTop: 10 }}>A forward is linear in spot, so ΔNPV equals {crypto ? quote.base_currency : 'FX'}01 × the shock exactly; the rate ladder shows the two curve legs offsetting at a fair strike.</div>
        </div>
      </div>
    </div>
  )
}

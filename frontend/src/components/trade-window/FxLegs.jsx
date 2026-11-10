// trade-window/FxLegs.jsx — the DETAILS tab's table of legs for a currency or digital-asset forward (fx-legs.js).
// The first row is the ticket itself, set on the TRADE tab and shown here as it is priced; every further row is
// the same forward with its own side, size, date and strike, priced by the same route. A strip fills the rows a
// month apart. Under the table, the strikes against the fair forwards, with the size of each leg.
//
// Step 1 of the package work: forwards only. The other tabs (CASHFLOWS, XVA, CURVE SCENARIO, CONFIRM) and the
// footer still show the first leg; the header says so. BOOK books every leg as its own trade, tied by a tag in
// each trade's `strategy`.
import { Note } from '../common/Note'
import { RISK_FACTORS } from '../../lib/risk-factors'
import { formatRead } from './fx-ticket'
import { legProblem, nextLeg, packageTotals, stripLegs, structureOf } from './fx-legs'

const fmt = (n, d = 0) => (n == null || Number.isNaN(Number(n)) ? '—' : formatRead(Number(n), d))
const zero = (n, d = 0) => Math.abs(Number(n)) < 0.5 * 10 ** -d
const signed = (n, d = 0) => (n == null || Number.isNaN(Number(n)) ? '—' : zero(n, d) ? fmt(0, d) : `${n > 0 ? '+' : '−'}${fmt(Math.abs(n), d)}`)
const tone = (n, d = 0) => (n == null || Number.isNaN(Number(n)) || zero(n, d) ? 'var(--text-dim)' : n > 0 ? 'var(--up)' : 'var(--down)')
// a size, a strike: digits, grouped the en-US way or not at all; '' is none; anything else is not read
const typed = (text) => { const t = String(text).trim(); if (t === '') return ''; const m = /^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d*)?|\.\d+)$/.exec(t); return m ? Number(m[1].replace(/,/g, '')) : null }

const lbl = { fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', color: 'var(--text-mute)', fontFamily: 'var(--sans)' }
const th = { ...lbl, textAlign: 'right', padding: '7px 6px', background: 'var(--panel)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td = { fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right', padding: '4px 6px', borderBottom: '1px solid var(--border)', color: 'var(--text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
const box = { background: 'var(--bg)', color: 'var(--text-hi)', border: '1px solid var(--border)', borderRadius: 'var(--r-2)', padding: '5px 7px', fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right' }
const brass = { borderColor: 'var(--accent-dim)', boxShadow: 'inset 0 -2px 0 var(--accent)' }
const tool = { padding: '5px 10px', border: '1px solid var(--border-hi)', borderRadius: 'var(--r-2)', background: 'transparent', color: 'var(--text-dim)', fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', cursor: 'pointer' }
const sideBtn = (sell, off) => ({ width: 54, padding: '5px 0', borderRadius: 'var(--r-2)', fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', cursor: off ? 'default' : 'pointer',
  border: `1px solid ${sell ? 'var(--down)' : 'var(--border-glow)'}`, background: sell ? 'rgb(var(--down-rgb) / 0.14)' : 'var(--panel-3)', color: sell ? 'var(--down)' : 'var(--text-hi)' })

// `first`: the ticket's own leg ({direction, notional, settlement}) with `quote`; `legs`: the further ones;
// `quotes`: id → { quote, error, pending } for each; `booked`: once booked, { ref, refs: { first, [id] } }.
export default function FxLegs({ first, quote, legs, setLegs, quotes = {}, crypto, dp = 2, locked = false, booked = null, stale = false, onBookRest = null, busy = false }) {
  if (!first || !quote) return null
  const base = quote.base_currency, qc = quote.quote_currency
  const nDp = crypto ? 4 : 0
  const structure = structureOf(first, legs)
  const rows = [
    { id: 'first', n: 1, direction: first.direction, notional: first.notional, settlement: quote.settlement_date || first.settlement, strike: quote.forward_rate, quote, own: true },
    ...legs.map((l, i) => ({ ...l, n: i + 2, quote: quotes[l.id]?.quote || null, error: quotes[l.id]?.error || null, pending: !!quotes[l.id]?.pending, problem: legProblem(l) })),
  ]
  const tot = packageTotals(rows)
  const spotName = crypto ? 'CRY01' : 'FX01'
  const set = (id, patch) => setLegs(legs.map(l => (l.id === id ? { ...l, ...patch } : l)))
  const commit = (e, id, key, was, show) => {
    const v = typed(e.target.value)
    if (v === null || (key === 'notional' && !(v > 0))) { e.target.value = show(was); return }       // not a number: back to what it was
    const next = v === '' ? null : v
    if (next !== was) set(id, { [key]: next })
    e.target.value = show(next)
  }
  const onEnter = (e) => { if (e.key === 'Enter') e.target.blur() }
  const several = rows.length > 1

  // the strikes against the fair forwards, by date, with each leg's size
  const chart = several && (() => {
    const pts = rows.filter(r => r.quote && r.settlement).map(r => ({ ...r, t: Date.parse(r.settlement + 'T00:00:00Z'), k: Number(r.quote.forward_rate), f: Number(r.quote.forward) }))
    if (pts.length < 2) return null
    const W = 880, H = 190, L = 70, R = 24, TOP = 26, BOT = 62
    const t0 = Math.min(...pts.map(p => p.t)), t1 = Math.max(...pts.map(p => p.t))
    let lo = Math.min(...pts.map(p => Math.min(p.k, p.f))), hi = Math.max(...pts.map(p => Math.max(p.k, p.f)))
    const pad = Math.max((hi - lo) * 0.3, hi * 0.002); lo -= pad; hi += pad
    const X = (t) => (t1 === t0 ? (L + W - R) / 2 : L + 20 + (t - t0) / (t1 - t0) * (W - L - R - 40))
    const Y = (v) => H - BOT - (v - lo) / (hi - lo) * (H - TOP - BOT)
    const nmax = Math.max(...pts.map(p => p.notional))
    const byDate = [...pts].sort((a, b) => a.t - b.t)
    return (
      <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 2 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--text-hi)' }}>STRIKES AGAINST THE FAIR FORWARDS</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-mute)' }}>- - fair forward&nbsp;&nbsp;&nbsp;<span style={{ color: 'var(--accent-hi)' }}>○</span> strike&nbsp;&nbsp;&nbsp;▮ size</span>
        </div>
        <svg data-testid="fx-legs-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Each leg's strike against the fair forward for its date" style={{ display: 'block', width: '100%', height: H }}>
          {[0, 1, 2, 3].map(q => { const v = lo + (hi - lo) * q / 3; return <g key={q}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--border)" /><text x={L - 8} y={Y(v) + 4} textAnchor="end" fontFamily="var(--mono)" fontSize="11" fill="var(--text-mute)">{fmt(v, dp > 2 ? dp : 0)}</text></g> })}
          <path d={byDate.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.f).toFixed(1)}`).join(' ')} fill="none" stroke="var(--text-dim)" strokeWidth="1.5" strokeDasharray="5 5" />
          {pts.map(p => { const h = Math.max(4, p.notional / nmax * 30); const sell = p.direction === 'SELL'; return (
            <g key={p.id}>
              <rect x={X(p.t) - 9} y={H - 22 - h} width="18" height={h} rx="2" fill="var(--border-hi)" />
              <text x={X(p.t)} y={H - 26 - h} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill={sell ? 'var(--down)' : 'var(--up)'}>{sell ? '−' : '+'}{fmt(p.notional, p.notional % 1 ? 2 : 0)}</text>
              <circle cx={X(p.t)} cy={Y(p.k)} r="5.5" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />
              <text x={X(p.t)} y={Y(p.k) - 10} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--accent-hi)">{fmt(p.k, dp)}</text>
              <text x={X(p.t)} y={H - 6} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--text-mute)">{p.settlement.slice(2, 7)}</text>
            </g>) })}
        </svg>
      </div>
    )
  })()

  return (
    <div data-testid="fx-legs" data-structure={structure} style={{ fontFamily: 'var(--sans)', borderBottom: '1px solid var(--border)', opacity: stale ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--text-hi)' }}>LEGS · {rows.length}</span>
        <span data-testid="fx-legs-structure" style={{ ...lbl, border: '1px solid var(--border-hi)', borderRadius: 'var(--r-1)', padding: '1px 7px', color: several ? 'var(--text-hi)' : 'var(--text-mute)' }}>{structure}</span>
        <Note inline>The first leg is the ticket itself, set on the TRADE tab. Every further leg is the same forward with its own side, size, date and strike; a strike left empty is the fair forward for its date. BOOK books each leg as its own trade, tied together as one package.{several ? ' The other tabs and the footer show the first leg for now.' : ''}</Note>
        {booked && <span data-testid="fx-legs-package" style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent-hi)' }}>{booked.ref}</span>}
        {!locked && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={{ ...tool, color: 'var(--text-hi)', borderColor: 'var(--border-glow)' }} data-testid="fx-legs-add" onClick={() => setLegs([...legs, nextLeg(first, legs)])}>+ ADD LEG</button>
            {[3, 6, 12].map(n => <button key={n} type="button" style={tool} data-testid={`fx-legs-strip-${n}`} title={`A forward each month for ${n} months, starting with the ticket's own, each at its fair forward`} onClick={() => setLegs(stripLegs(first, n))}>STRIP × {n}</button>)}
            {several && <button type="button" style={tool} data-testid="fx-legs-clear" onClick={() => setLegs([])}>ONE LEG</button>}
          </span>
        )}
      </div>
      {booked?.failed && (
        <div data-testid="fx-legs-failed" role="alert" style={{ margin: '0 16px 10px', padding: '7px 10px', border: '1px solid rgba(233,151,90,0.4)', borderRadius: 'var(--r-2)', background: 'rgba(233,151,90,0.06)', color: 'var(--amber)', fontSize: 12.5, lineHeight: 1.5 }}>
          {Object.keys(booked.refs).length} of {booked.failed.of} legs are booked. Leg {booked.failed.leg} was not: {booked.failed.why}{/[.!?]$/.test(String(booked.failed.why)) ? '' : '.'} The booked legs stand as trades of {booked.ref}.
          {onBookRest && <button type="button" data-testid="fx-legs-book-rest" disabled={busy} onClick={onBookRest} style={{ ...tool, marginLeft: 10, color: 'var(--text-hi)', borderColor: 'var(--amber)' }}>{busy ? 'BOOKING…' : 'BOOK THE REMAINING LEGS'}</button>}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table data-testid="fx-legs-table" style={{ width: '100%', minWidth: 860, borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'left', paddingLeft: 16, width: 34 }}>#</th>
            <th style={{ ...th, textAlign: 'left' }}>SIDE</th>
            <th style={th}>NOTIONAL {base}</th><th style={th}>SETTLES</th><th style={th}>STRIKE K</th><th style={th}>FAIR FORWARD</th>
            <th style={th}>VALUE {qc}</th>
            <th style={th}><span className="rf-mark" style={{ background: `var(${RISK_FACTORS[crypto ? 'cry' : 'fx'].token})` }} />{spotName}</th>
            <th style={th}><span className="rf-mark" style={{ background: `var(${RISK_FACTORS.ir.token})` }} />IR01</th>
            <th style={{ ...th, paddingRight: 12, textAlign: booked ? 'left' : 'right' }}>{booked ? 'BOOKED AS' : ''}</th>
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const q = r.quote, sell = r.direction === 'SELL', fixed = r.own || locked
              const says = r.problem ? `needs ${r.problem}` : r.error ? r.error : r.pending && !q ? 'pricing…' : null
              return (
                <tr key={r.id} data-testid={r.own ? 'fx-leg-first' : 'fx-leg'} data-leg={r.id} data-pending={r.pending ? 'true' : 'false'}>
                  <td style={{ ...td, textAlign: 'left', paddingLeft: 16, color: 'var(--text-mute)' }}>{r.n}</td>
                  <td style={{ ...td, textAlign: 'left' }}>
                    {fixed ? <span style={{ ...sideBtn(sell, true), display: 'inline-block', textAlign: 'center' }}>{r.direction}</span>
                           : <button type="button" style={sideBtn(sell)} aria-label={`Side of leg ${r.n}`} onClick={() => set(r.id, { direction: sell ? 'BUY' : 'SELL' })}>{r.direction}</button>}
                  </td>
                  <td style={td}>{fixed ? fmt(r.notional, nDp)
                    : <input key={`n:${r.notional}`} type="text" inputMode="decimal" aria-label={`Notional of leg ${r.n}`} defaultValue={fmt(r.notional, r.notional % 1 ? 4 : 0)} style={{ ...box, width: 84 }}
                        onBlur={e => commit(e, r.id, 'notional', r.notional, v => fmt(v, v % 1 ? 4 : 0))} onKeyDown={onEnter} />}</td>
                  <td style={td}>{fixed ? r.settlement
                    : <input type="date" aria-label={`Settlement of leg ${r.n}`} value={r.settlement} onChange={e => e.target.value && set(r.id, { settlement: e.target.value })} style={{ ...box, width: 132, fontSize: 12 }} />}</td>
                  <td style={td}>{fixed ? fmt(r.own ? r.strike : (q?.forward_rate ?? r.strike), dp)
                    : <input key={`k:${r.strike}`} type="text" inputMode="decimal" aria-label={`Strike of leg ${r.n}`} placeholder={q ? fmt(q.forward_rate, dp) : 'fair'} defaultValue={r.strike == null ? '' : fmt(r.strike, dp)}
                        style={{ ...box, width: 104, ...(r.strike != null ? brass : null) }} onBlur={e => commit(e, r.id, 'strike', r.strike, v => (v == null ? '' : fmt(v, dp)))} onKeyDown={onEnter} />}</td>
                  {says
                    ? <td colSpan={4} data-testid="fx-leg-says" style={{ ...td, textAlign: 'left', fontFamily: 'var(--sans)', color: r.pending && !r.error && !r.problem ? 'var(--text-mute)' : 'var(--amber)', whiteSpace: 'normal' }}>{says}</td>
                    : (<>
                        <td style={{ ...td, color: 'var(--text-dim)' }}>{fmt(q?.forward, dp)}</td>
                        <td data-testid="fx-leg-npv" data-value={q?.npv ?? ''} style={{ ...td, color: tone(q?.npv), opacity: r.pending ? 0.5 : 1 }}>{signed(q?.npv)}</td>
                        <td style={{ ...td, color: tone(q?.spot01 ?? q?.delta_quote_per_pct), opacity: r.pending ? 0.5 : 1 }}>{signed(q?.spot01 ?? q?.delta_quote_per_pct)}</td>
                        <td style={{ ...td, color: tone(q?.ir01), opacity: r.pending ? 0.5 : 1 }}>{signed(q?.ir01)}</td>
                      </>)}
                  <td style={{ ...td, paddingRight: 12, textAlign: booked ? 'left' : 'right' }}>
                    {booked ? <span data-testid="fx-leg-ref" style={{ color: 'var(--text-hi)' }}>{booked.refs[r.id] || '—'}</span>
                      : r.own ? <span style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text-mute)' }}>on TRADE</span>
                      : !locked && <button type="button" aria-label={`Remove leg ${r.n}`} onClick={() => setLegs(legs.filter(l => l.id !== r.id))}
                          style={{ border: 'none', background: 'transparent', color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: 14, cursor: 'pointer', padding: '2px 6px' }}>×</button>}
                  </td>
                </tr>
              )
            })}
            {several && (
              <tr data-testid="fx-legs-total">
                <td colSpan={2} style={{ ...td, textAlign: 'left', paddingLeft: 16, borderTop: '2px solid var(--border-hi)', borderBottom: 'none', fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-hi)' }}>PACKAGE{tot.priced < tot.n ? ` · ${tot.priced} of ${tot.n} priced` : ''}</td>
                <td style={{ ...td, borderTop: '2px solid var(--border-hi)', borderBottom: 'none', fontWeight: 500, color: 'var(--text-hi)' }}>{tot.netNotional == null ? '—' : signed(tot.netNotional, nDp)}</td>
                <td colSpan={3} style={{ ...td, borderTop: '2px solid var(--border-hi)', borderBottom: 'none' }} />
                <td data-testid="fx-legs-npv" data-value={tot.npv ?? ''} style={{ ...td, borderTop: '2px solid var(--border-hi)', borderBottom: 'none', fontWeight: 600, color: tone(tot.npv) }}>{signed(tot.npv)}</td>
                <td style={{ ...td, borderTop: '2px solid var(--border-hi)', borderBottom: 'none', fontWeight: 500, color: tone(tot.spot01) }}>{signed(tot.spot01)}</td>
                <td style={{ ...td, borderTop: '2px solid var(--border-hi)', borderBottom: 'none', fontWeight: 500, color: tone(tot.ir01) }}>{signed(tot.ir01)}</td>
                <td style={{ ...td, borderTop: '2px solid var(--border-hi)', borderBottom: 'none' }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {chart}
    </div>
  )
}

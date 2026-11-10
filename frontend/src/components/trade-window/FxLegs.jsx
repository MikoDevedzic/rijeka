// trade-window/FxLegs.jsx — the DETAILS tab's table of legs for a currency or digital-asset trade (fx-legs.js).
// The first row is the ticket itself, set on the TRADE tab and shown here as it is priced. Every further row is a
// leg on the same pair: a forward, a call, a put or a touch, with its own side, size, date and strike, and, for an
// option, its style (European, American, digital, barrier, double barrier) with that style's terms in a row under
// it. Each is priced by the route that prices it as a ticket of its own. A strip fills the rows a month apart; on an
// option ticket a collar or a risk reversal, a straddle and a calendar add the second option. Under the table:
// legs on one date draw what the package pays at expiry; legs on several draw the strikes against the fair forwards.
//
// The other tabs (CASHFLOWS, XVA, CURVE SCENARIO, CONFIRM) and the footer still show the first leg; the header's
// note says so. BOOK books every leg as its own trade, tied by a tag in each trade's `strategy`.
import { Note } from '../common/Note'
import { RISK_FACTORS } from '../../lib/risk-factors'
import { formatRead } from './fx-ticket'
import { LEG_STYLES, isOption, legPayoff, legProblem, nextLeg, packageTotals, pairedLeg, seedStyle, stripLegs, structureOf, styleOf } from './fx-legs'

const fmt = (n, d = 0) => (n == null || Number.isNaN(Number(n)) ? '—' : formatRead(Number(n), d))
const zero = (n, d = 0) => Math.abs(Number(n)) < 0.5 * 10 ** -d
const signed = (n, d = 0) => (n == null || Number.isNaN(Number(n)) ? '—' : zero(n, d) ? fmt(0, d) : `${n > 0 ? '+' : '−'}${fmt(Math.abs(n), d)}`)
const tone = (n, d = 0) => (n == null || Number.isNaN(Number(n)) || zero(n, d) ? 'var(--text-dim)' : n > 0 ? 'var(--up)' : 'var(--down)')
// a size, a strike, a level: digits, grouped the en-US way or not at all; '' is none; anything else is not read
const typed = (text) => { const t = String(text).trim(); if (t === '') return ''; const m = /^(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d*)?|\.\d+)$/.exec(t); return m ? Number(m[1].replace(/,/g, '')) : null }
const words = (s) => String(s || '').replace(/_/g, ' ')
const KIND = { FWD: 'FORWARD', CALL: 'CALL', PUT: 'PUT', TOUCH: 'TOUCH' }

const lbl = { fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', color: 'var(--text-mute)', fontFamily: 'var(--sans)' }
const th = { ...lbl, textAlign: 'right', padding: '7px 5px', background: 'var(--panel)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }
const td = { fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right', padding: '4px 5px', borderBottom: '1px solid var(--border)', color: 'var(--text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }
const box = { background: 'var(--bg)', color: 'var(--text-hi)', border: '1px solid var(--border)', borderRadius: 'var(--r-2)', padding: '5px 7px', fontFamily: 'var(--mono)', fontSize: 12.5, textAlign: 'right' }
const pick = { ...box, fontFamily: 'var(--sans)', textAlign: 'left', padding: '5px 4px', cursor: 'pointer' }
const brass = { borderColor: 'var(--accent-dim)', boxShadow: 'inset 0 -2px 0 var(--accent)' }
const tool = { padding: '5px 10px', border: '1px solid var(--border-hi)', borderRadius: 'var(--r-2)', background: 'transparent', color: 'var(--text-dim)', fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 500, letterSpacing: '0.08em', cursor: 'pointer' }
const sideBtn = (sell, off) => ({ width: 50, padding: '5px 0', borderRadius: 'var(--r-2)', fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', cursor: off ? 'default' : 'pointer',
  border: `1px solid ${sell ? 'var(--down)' : 'var(--border-glow)'}`, background: sell ? 'rgb(var(--down-rgb) / 0.14)' : 'var(--panel-3)', color: sell ? 'var(--down)' : 'var(--text-hi)' })

// What a style's terms say, in a sentence (the row under the leg, and the ticket's own row).
function says(l, k, dp) {
  const st = styleOf(l)
  if (st === 'TOUCH') return `pays ${fmt(l.payout)} if ${fmt(l.barrier, dp)} is ${l.touchType === 'NO_TOUCH' ? 'never reached' : 'reached'} before ${l.date}`
  if (st === 'DIGITAL') return `pays ${fmt(l.payout)} if the fixing is ${l.kind === 'CALL' ? 'above' : 'below'} ${fmt(k, dp)}`
  if (st === 'BARRIER') return `${String(l.barrierType).endsWith('OUT') ? 'dies' : 'comes alive'} if spot ${String(l.barrierType).startsWith('UP') ? 'rises to' : 'falls to'} ${fmt(l.barrier, dp)}`
  if (st === 'DOUBLE_BARRIER') return `${l.barrierType === 'KNOCK_IN' ? 'comes alive' : 'dies'} if spot leaves ${fmt(l.lowerB, dp)} to ${fmt(l.upperB, dp)}`
  return null
}

// `first`: the ticket as a leg (FxCryptoPanel firstLeg) with `quote`; `legs`: the further ones; `quotes`: id →
// { quote, error, pending } for each; `booked`: once booked, { ref, refs: { first, [id] }, failed? }.
export default function FxLegs({ first, quote, legs, setLegs, quotes = {}, crypto, dp = 2, defaults = {}, locked = false, booked = null, stale = false, onBookRest = null, busy = false }) {
  if (!first || !quote) return null
  const base = quote.base_currency, qc = quote.quote_currency
  const nDp = crypto ? 4 : 0
  const kOf = (l, q) => (l.kind === 'TOUCH' ? null : q ? Number(isOption(l) ? q.strike : q.forward_rate) : l.strike)
  // named with the strike the ticket is priced at: a strike left empty on TRADE is the fair forward, and a straddle struck there is a straddle
  const structure = structureOf({ ...first, strike: first.strike ?? kOf(first, quote) }, legs)
  const rows = [
    { ...first, id: 'first', n: 1, date: (isOption(first) ? quote.expiry_date : quote.settlement_date) || first.date, quote, own: true },
    ...legs.map((l, i) => ({ ...l, n: i + 2, quote: quotes[l.id]?.quote || null, error: quotes[l.id]?.error || null, pending: !!quotes[l.id]?.pending, problem: legProblem(l) })),
  ]
  const tot = packageTotals(rows)
  const spotName = crypto ? 'CRY01' : 'FX01'
  const set = (id, patch) => setLegs(legs.map(l => (l.id === id ? { ...l, ...patch } : l)))
  // a change of type or style starts that style's levels around the forward (only what it lacks)
  const reshape = (l, patch) => { const next = { ...l, ...patch }; set(l.id, { ...patch, ...seedStyle(next, Number(quotes[l.id]?.quote?.forward ?? quote.forward), { dp, payout: defaults.payout }) }) }
  const commit = (e, id, key, was, show, { blank = false } = {}) => {
    const v = typed(e.target.value)
    if (v === null || (v === '' && !blank) || (v !== '' && !(v > 0))) { e.target.value = show(was); return }       // not a number above zero: back to what it was
    const next = v === '' ? null : v
    if (next !== was) set(id, { [key]: next })
    e.target.value = show(next)
  }
  const onEnter = (e) => { if (e.key === 'Enter') e.target.blur() }
  const several = rows.length > 1
  const numIn = (r, key, label, width, d, opts) => (
    <input key={`${key}:${r[key]}`} type="text" inputMode="decimal" aria-label={`${label} of leg ${r.n}`} defaultValue={r[key] == null ? '' : fmt(r[key], d)}
      style={{ ...box, width, ...(opts?.brass && r[key] != null ? brass : null) }} placeholder={opts?.placeholder}
      onBlur={e => commit(e, r.id, key, r[key], v => (v == null ? '' : fmt(v, d)), { blank: !!opts?.blank })} onKeyDown={onEnter} />
  )
  const sel = (r, key, label, options, width, onPick) => (
    <select aria-label={`${label} of leg ${r.n}`} value={r[key]} onChange={e => onPick(e.target.value)} style={{ ...pick, width }}>
      {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
    </select>
  )

  // ── the picture: one date → what the package pays at expiry; several → the strikes against the fair forwards ──
  const W = 880
  const pricedRows = rows.filter(r => r.quote && r.date && !r.problem)
  const oneDate = several && pricedRows.length === rows.length && new Set(rows.map(r => r.date)).size === 1 && rows.some(isOption)
  const chart = several && pricedRows.length >= 2 && (oneDate ? (() => {
    const H = 210, L = 76, R = 24, TOP = 26, BOT = 26, F = Number(quote.forward)
    // the premium of the options, as today's value: what was paid for the ones bought less what was taken for the ones sold
    const premium = rows.filter(isOption).reduce((a, r) => a + Number(r.quote.npv || 0), 0)
    const pay = (x) => rows.reduce((a, r) => a + (r.direction === 'SELL' ? -1 : 1) * legPayoff(r, x, kOf(r, r.quote), F), 0) - premium
    const xs = Array.from({ length: 241 }, (_, i) => F * (0.6 + 0.8 * i / 240)), ys = xs.map(pay)
    let lo = Math.min(...ys, 0), hi = Math.max(...ys, 0); const pad = (hi - lo || 1) * 0.12; lo -= pad; hi += pad
    const X = (x) => L + (x - xs[0]) / (xs[240] - xs[0]) * (W - L - R), Y = (v) => H - BOT - (v - lo) / (hi - lo) * (H - TOP - BOT)
    const strikes = [...new Set(rows.map(r => kOf(r, r.quote)).filter(k => k != null && k > xs[0] && k < xs[240]))]
    const levels = [...new Set(rows.flatMap(r => { const st = styleOf(r); return st === 'TOUCH' || st === 'BARRIER' ? [r.barrier] : st === 'DOUBLE_BARRIER' ? [r.lowerB, r.upperB] : [] }).filter(b => b > xs[0] && b < xs[240]))]
    return (
      <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px 4px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 2 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--text-hi)' }}>WHAT THE PACKAGE PAYS AT EXPIRY · {qc}, LESS THE PREMIUM · {rows[0].date}</span>
          <Note inline>The sum of what each leg pays with {base} at that level on {rows[0].date}, less the options' value today (the premium paid for those bought, less what is taken for those sold). {levels.length ? 'A barrier is read at the expiry alone here: a knock on the way that comes back is not drawn.' : ''}</Note>
        </div>
        <svg data-testid="fx-legs-payoff" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="What the package pays at expiry, by the level of the underlying" style={{ display: 'block', width: '100%', height: H }}>
          {[0, 1, 2, 3, 4].map(q => { const v = lo + (hi - lo) * q / 4; return <g key={q}><line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="var(--border)" /><text x={L - 8} y={Y(v) + 4} textAnchor="end" fontFamily="var(--mono)" fontSize="11" fill="var(--text-mute)">{fmt(v)}</text></g> })}
          {[0, 1, 2, 3, 4].map(q => { const x = xs[0] + (xs[240] - xs[0]) * q / 4; return <text key={q} x={X(x)} y={H - 6} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--text-mute)">{fmt(x, dp > 2 ? dp : 0)}</text> })}
          <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} stroke="var(--border-glow)" />
          <line x1={X(F)} x2={X(F)} y1={TOP - 6} y2={H - BOT} stroke="var(--text-dim)" strokeDasharray="4 5" />
          {levels.map(b => <g key={`b${b}`}><line x1={X(b)} x2={X(b)} y1={TOP + 6} y2={H - BOT} stroke="var(--amber)" strokeDasharray="2 4" /><text x={X(b)} y={TOP + 2} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--amber)">B {fmt(b, dp > 2 ? dp : 0)}</text></g>)}
          {strikes.map(k => <g key={`k${k}`}><line x1={X(k)} x2={X(k)} y1={H - BOT - 8} y2={H - BOT} stroke="var(--accent)" strokeWidth="2" /><text x={X(k)} y={TOP - 10} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--accent-hi)">K {fmt(k, dp > 2 ? dp : 0)}</text></g>)}
          <path d={xs.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join(' ')} fill="none" stroke="var(--text)" strokeWidth="2.2" />
        </svg>
      </div>
    )
  })() : (() => {
    const pts = pricedRows.filter(r => kOf(r, r.quote) != null).map(r => ({ ...r, t: Date.parse(r.date + 'T00:00:00Z'), k: kOf(r, r.quote), f: Number(r.quote.forward) }))
    if (pts.length < 2) return null
    const H = 190, L = 70, R = 24, TOP = 26, BOT = 62
    const t0 = Math.min(...pts.map(p => p.t)), t1 = Math.max(...pts.map(p => p.t))
    let lo = Math.min(...pts.map(p => Math.min(p.k, p.f))), hi = Math.max(...pts.map(p => Math.max(p.k, p.f)))
    const pad = Math.max((hi - lo) * 0.3, hi * 0.002); lo -= pad; hi += pad
    const X = (t) => (t1 === t0 ? (L + W - R) / 2 : L + 20 + (t - t0) / (t1 - t0) * (W - L - R - 40))
    const Y = (v) => H - BOT - (v - lo) / (hi - lo) * (H - TOP - BOT)
    const nmax = Math.max(...pts.map(p => p.notional || 0), 1)
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
          {pts.map(p => { const h = Math.max(4, (p.notional || 0) / nmax * 30); const sell = p.direction === 'SELL'; return (
            <g key={p.id}>
              <rect x={X(p.t) - 9} y={H - 22 - h} width="18" height={h} rx="2" fill="var(--border-hi)" />
              <text x={X(p.t)} y={H - 26 - h} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill={sell ? 'var(--down)' : 'var(--up)'}>{sell ? '−' : '+'}{fmt(p.notional, p.notional % 1 ? 2 : 0)}</text>
              <circle cx={X(p.t)} cy={Y(p.k)} r="5.5" fill="var(--bg)" stroke="var(--accent)" strokeWidth="2" />
              <text x={X(p.t)} y={Y(p.k) - 10} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--accent-hi)">{isOption(p) ? `${p.kind[0]} ` : ''}{fmt(p.k, dp)}</text>
              <text x={X(p.t)} y={H - 6} textAnchor="middle" fontFamily="var(--mono)" fontSize="11" fill="var(--text-mute)">{p.date.slice(2, 7)}</text>
            </g>) })}
        </svg>
      </div>
    )
  })())

  const vanilla = (first.kind === 'CALL' || first.kind === 'PUT') && (styleOf(first) === 'EUROPEAN' || styleOf(first) === 'AMERICAN')
  const pair = (what) => { const l = pairedLeg(first, what, { f: Number(quote.forward), k: Number(quote.strike), dp }); if (l) setLegs([l]) }
  const otherName = (first.kind === 'PUT') === (first.direction === 'BUY') ? 'COLLAR' : 'RISK REVERSAL'
  const cols = 13

  return (
    <div data-testid="fx-legs" data-structure={structure} style={{ fontFamily: 'var(--sans)', borderBottom: '1px solid var(--border)', opacity: stale ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 8px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: '0.1em', color: 'var(--text-hi)' }}>LEGS · {rows.length}</span>
        <span data-testid="fx-legs-structure" style={{ ...lbl, border: '1px solid var(--border-hi)', borderRadius: 'var(--r-1)', padding: '1px 7px', color: several ? 'var(--text-hi)' : 'var(--text-mute)' }}>{structure}</span>
        <Note inline>The first leg is the ticket itself, set on the TRADE tab. Every further leg is on the same pair: a forward, a call, a put or a touch, with its own side, size, date and strike, and an option's own style. A strike left empty is the fair forward for its date. BOOK books each leg as its own trade, tied together as one package.{several ? ' The other tabs and the footer show the first leg for now.' : ''}</Note>
        {booked && <span data-testid="fx-legs-package" style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent-hi)' }}>{booked.ref}</span>}
        {!locked && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={{ ...tool, color: 'var(--text-hi)', borderColor: 'var(--border-glow)' }} data-testid="fx-legs-add" onClick={() => setLegs([...legs, nextLeg(first, legs)])}>+ ADD LEG</button>
            {vanilla && <button type="button" style={tool} data-testid="fx-legs-other" title={`The other of call and put on the other side, the same date and size, its strike as far from the forward: a ${otherName.toLowerCase()}`} onClick={() => pair('OTHER')}>{otherName}</button>}
            {vanilla && <button type="button" style={tool} data-testid="fx-legs-straddle" title="The other of call and put on the same side, at the same strike and date" onClick={() => pair('STRADDLE')}>STRADDLE</button>}
            {vanilla && <button type="button" style={tool} data-testid="fx-legs-calendar" title="The same option a month later, on the other side" onClick={() => pair('CALENDAR')}>CALENDAR</button>}
            {[3, 6, 12].map(n => <button key={n} type="button" style={tool} data-testid={`fx-legs-strip-${n}`} title={`One leg each month for ${n} months, starting with the ticket's own, each at its fair forward`} onClick={() => setLegs(stripLegs(first, n))}>STRIP × {n}</button>)}
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
        <table data-testid="fx-legs-table" style={{ width: '100%', minWidth: 1080, borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...th, textAlign: 'left', paddingLeft: 16, width: 30 }}>#</th>
            <th style={{ ...th, textAlign: 'left' }}>TYPE</th><th style={{ ...th, textAlign: 'left' }}>STYLE</th><th style={{ ...th, textAlign: 'left' }}>SIDE</th>
            <th style={th}>NOTIONAL {base}</th><th style={th}>SETTLES / EXPIRES</th><th style={th}>STRIKE K</th><th style={th}>FAIR FORWARD</th><th style={th}>VOL %</th>
            <th style={th}>VALUE {qc}</th>
            <th style={th}><span className="rf-mark" style={{ background: `var(${RISK_FACTORS[crypto ? 'cry' : 'fx'].token})` }} />{spotName}</th>
            <th style={th}><span className="rf-mark" style={{ background: `var(${RISK_FACTORS.ir.token})` }} />IR01</th>
            <th style={{ ...th, paddingRight: 12, textAlign: booked ? 'left' : 'right' }}>{booked ? 'BOOKED AS' : ''}</th>
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const q = r.quote, sell = r.direction === 'SELL', fixed = r.own || locked, opt = isOption(r), st = styleOf(r)
              const payoutStyle = st === 'DIGITAL' || st === 'TOUCH'
              const why = r.problem ? `needs ${r.problem}` : r.error ? r.error : r.pending && !q ? 'pricing…' : null
              const k = kOf(r, q)
              const sentence = says(r, k, dp)
              const terms = opt && st !== 'EUROPEAN' && st !== 'AMERICAN'
              const noLine = terms ? { borderBottom: 'none' } : null
              return [
                <tr key={r.id} data-testid={r.own ? 'fx-leg-first' : 'fx-leg'} data-leg={r.id} data-kind={r.kind} data-style={st || ''} data-pending={r.pending ? 'true' : 'false'}>
                  <td style={{ ...td, ...noLine, textAlign: 'left', paddingLeft: 16, color: 'var(--text-mute)' }}>{r.n}</td>
                  <td style={{ ...td, ...noLine, textAlign: 'left', fontFamily: 'var(--sans)' }}>{fixed ? KIND[r.kind]
                    : sel(r, 'kind', 'Type', Object.entries(KIND), 96, v => reshape(r, { kind: v, ...(v === 'FWD' || v === 'TOUCH' ? { style: 'EUROPEAN' } : null), ...(v === 'TOUCH' ? { strike: null } : null) }))}</td>
                  <td style={{ ...td, ...noLine, textAlign: 'left', fontFamily: 'var(--sans)', color: opt ? 'var(--text)' : 'var(--text-mute)' }}>{!opt ? '—' : st === 'TOUCH' ? words(r.touchType) : fixed ? words(st)
                    : sel(r, 'style', 'Style', LEG_STYLES.map(s => [s, words(s)]), 124, v => reshape(r, { style: v }))}</td>
                  <td style={{ ...td, ...noLine, textAlign: 'left' }}>
                    {fixed ? <span style={{ ...sideBtn(sell, true), display: 'inline-block', textAlign: 'center' }}>{r.direction}</span>
                           : <button type="button" style={sideBtn(sell)} aria-label={`Side of leg ${r.n}`} onClick={() => set(r.id, { direction: sell ? 'BUY' : 'SELL' })}>{r.direction}</button>}
                  </td>
                  <td style={{ ...td, ...noLine }}>{payoutStyle ? <span style={{ color: 'var(--text-mute)' }}>—</span> : fixed ? fmt(r.notional, nDp) : numIn(r, 'notional', 'Notional', 78, r.notional % 1 ? 4 : 0)}</td>
                  <td style={{ ...td, ...noLine }}>{fixed ? r.date
                    : <input type="date" aria-label={`${opt ? 'Expiry' : 'Settlement'} of leg ${r.n}`} value={r.date} onChange={e => e.target.value && set(r.id, { date: e.target.value })} style={{ ...box, width: 128, fontSize: 12 }} />}</td>
                  <td style={{ ...td, ...noLine }}>{r.kind === 'TOUCH' ? <span style={{ color: 'var(--text-mute)' }}>—</span> : fixed ? fmt(k, dp)
                    : numIn(r, 'strike', 'Strike', 100, dp, { brass: true, blank: true, placeholder: q ? fmt(isOption(r) ? q.strike : q.forward_rate, dp) : 'fair' })}</td>
                  {why
                    ? <td colSpan={5} data-testid="fx-leg-says" style={{ ...td, ...noLine, textAlign: 'left', fontFamily: 'var(--sans)', color: r.pending && !r.error && !r.problem ? 'var(--text-mute)' : 'var(--amber)', whiteSpace: 'normal' }}>{why}</td>
                    : (<>
                        <td style={{ ...td, ...noLine, color: 'var(--text-dim)' }}>{fmt(q?.forward, dp)}</td>
                        <td style={{ ...td, ...noLine, color: 'var(--text-dim)' }}>{opt && q?.vol_pct != null ? fmt(q.vol_pct, 2) : '—'}</td>
                        <td data-testid="fx-leg-npv" data-value={q?.npv ?? ''} style={{ ...td, ...noLine, color: tone(q?.npv), opacity: r.pending ? 0.5 : 1 }}>{signed(q?.npv)}</td>
                        <td style={{ ...td, ...noLine, color: tone(q?.spot01 ?? q?.delta_quote_per_pct), opacity: r.pending ? 0.5 : 1 }}>{signed(q?.spot01 ?? q?.delta_quote_per_pct)}</td>
                        <td style={{ ...td, ...noLine, color: tone(q?.ir01), opacity: r.pending ? 0.5 : 1 }}>{signed(q?.ir01)}</td>
                      </>)}
                  <td style={{ ...td, ...noLine, paddingRight: 12, textAlign: booked ? 'left' : 'right' }}>
                    {booked ? <span data-testid="fx-leg-ref" style={{ color: 'var(--text-hi)' }}>{booked.refs[r.id] || '—'}</span>
                      : r.own ? <span style={{ fontFamily: 'var(--sans)', fontSize: 11, color: 'var(--text-mute)' }}>on TRADE</span>
                      : !locked && <button type="button" aria-label={`Remove leg ${r.n}`} onClick={() => setLegs(legs.filter(l => l.id !== r.id))}
                          style={{ border: 'none', background: 'transparent', color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: 14, cursor: 'pointer', padding: '2px 6px' }}>×</button>}
                  </td>
                </tr>,
                terms && (
                  <tr key={`${r.id}:terms`} data-testid="fx-leg-terms" data-leg={r.id}>
                    <td style={{ ...td, background: 'var(--bg-deep)' }} />
                    <td colSpan={cols - 1} style={{ ...td, background: 'var(--bg-deep)', textAlign: 'left', fontFamily: 'var(--sans)', padding: '5px 12px 7px 5px' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px' }}>
                        {!fixed && st === 'TOUCH' && <label style={{ ...lbl, display: 'inline-flex', alignItems: 'center', gap: 6 }}>KIND {sel(r, 'touchType', 'Touch kind', [['ONE_TOUCH', 'ONE-TOUCH'], ['NO_TOUCH', 'NO-TOUCH']], 112, v => set(r.id, { touchType: v }))}</label>}
                        {!fixed && st === 'BARRIER' && <label style={{ ...lbl, display: 'inline-flex', alignItems: 'center', gap: 6 }}>BARRIER {sel(r, 'barrierType', 'Barrier kind', [['UP_OUT', 'UP-AND-OUT'], ['UP_IN', 'UP-AND-IN'], ['DOWN_OUT', 'DOWN-AND-OUT'], ['DOWN_IN', 'DOWN-AND-IN']], 136, v => set(r.id, { barrierType: v }))}</label>}
                        {!fixed && st === 'DOUBLE_BARRIER' && <label style={{ ...lbl, display: 'inline-flex', alignItems: 'center', gap: 6 }}>BARRIERS {sel({ ...r, barrierType: r.barrierType === 'KNOCK_IN' ? 'KNOCK_IN' : 'KNOCK_OUT' }, 'barrierType', 'Barriers', [['KNOCK_OUT', 'KNOCK-OUT'], ['KNOCK_IN', 'KNOCK-IN']], 118, v => set(r.id, { barrierType: v }))}</label>}
                        {!fixed && (st === 'BARRIER' || st === 'TOUCH') && <label style={{ ...lbl, display: 'inline-flex', alignItems: 'center', gap: 6 }}>LEVEL {numIn(r, 'barrier', 'Barrier', 100, dp)}</label>}
                        {!fixed && st === 'DOUBLE_BARRIER' && <label style={{ ...lbl, display: 'inline-flex', alignItems: 'center', gap: 6 }}>LOWER {numIn(r, 'lowerB', 'Lower barrier', 100, dp)}</label>}
                        {!fixed && st === 'DOUBLE_BARRIER' && <label style={{ ...lbl, display: 'inline-flex', alignItems: 'center', gap: 6 }}>UPPER {numIn(r, 'upperB', 'Upper barrier', 100, dp)}</label>}
                        {!fixed && (st === 'DIGITAL' || st === 'TOUCH') && <label style={{ ...lbl, display: 'inline-flex', alignItems: 'center', gap: 6 }}>PAYOUT {qc} {numIn(r, 'payout', 'Payout', 110, 0)}</label>}
                        {sentence && <span data-testid="fx-leg-sentence" style={{ marginLeft: fixed ? 0 : 'auto', fontSize: 12, color: 'var(--text-dim)' }}>{sentence}</span>}
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}
            {several && (
              <tr data-testid="fx-legs-total">
                <td colSpan={4} style={{ ...td, textAlign: 'left', paddingLeft: 16, borderTop: '2px solid var(--border-hi)', borderBottom: 'none', fontFamily: 'var(--sans)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-hi)' }}>PACKAGE{tot.priced < tot.n ? ` · ${tot.priced} of ${tot.n} priced` : ''}</td>
                <td style={{ ...td, borderTop: '2px solid var(--border-hi)', borderBottom: 'none', fontWeight: 500, color: 'var(--text-hi)' }} title="The net size of the forwards; an option's size is not a position in the asset">{tot.netNotional == null ? '—' : signed(tot.netNotional, nDp)}</td>
                <td colSpan={4} style={{ ...td, borderTop: '2px solid var(--border-hi)', borderBottom: 'none' }} />
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

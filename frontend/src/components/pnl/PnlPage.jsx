// pnl/PnlPage.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// The desk's P&L for a market date: day / MTD / YTD split into market and trading,
// the attribution waterfall, the roll-up desk → book → trade with every trade's
// explain rows, and the sign-off (trader, then controller; FINAL goes to management).
// GET /api/pnl/report · POST /api/pnl/eod · POST /api/pnl/signoff · GET /api/pnl/firm
// Attribution is sequential full revaluation (backend/pnl/explain.py); the convention
// is printed at the foot of the page because an attribution without its order is a guess.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSessionMaybe } from '../../lib/session'
import { useAuthStore } from '../../store/useAuthStore'
import './PnlPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const BUCKET_LABEL = { CARRY: 'CARRY', CASH: 'CASH SETTLED', RATES: 'RATES', FX: 'FX · SPOT & POINTS', RESIDUAL: 'RESIDUAL', NEW: 'NEW TRADES', UNWIND: 'UNWINDS' }
const fmt = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })
const sgn = (n, d = 0) => n == null || isNaN(n) ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n), d)}`
const tone = (n) => n > 0.5 ? 'pos' : n < -0.5 ? 'neg' : ''
const fmtD = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const STATUS = { OPEN: ['OPEN', ''], TRADER_SIGNED: ['TRADER SIGNED', 'amber'], CONTROLLER_SIGNED: ['CONTROLLER SIGNED', 'amber'], FINAL: ['FINAL', 'ok'] }

async function api(path, opts = {}) {
  const session = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${session?.access_token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : j.detail ? JSON.stringify(j.detail) : `${path} ${r.status}`)
  return j
}

export default function PnlPage() {
  const navigate = useNavigate()
  const session = useAuthStore(s => s.session)
  const role = String(session?.user?.user_metadata?.role || 'viewer').toLowerCase()
  const [date, setDate] = useState(null)
  const [rep, setRep] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState('book')            // book | firm
  const [firm, setFirm] = useState(null)
  const [toast, setToast] = useState(null)

  const load = async (d) => {
    setBusy(true); setErr(null)
    try { const j = await api(`/api/pnl/report${d ? `?date=${d}` : ''}`); setRep(j); if (j.date) setDate(j.date) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { load(null) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'firm') api(`/api/pnl/firm${date ? `?date=${date}` : ''}`).then(setFirm).catch(e => setToast(e.message)) }, [view, date])

  const runEod = async () => {
    setBusy(true)
    try { const j = await api(`/api/pnl/eod${date ? `?date=${date}` : ''}`, { method: 'POST' }); setToast(j.persisted ? `End of day stored · ${j.rows} rows · ${j.date}` : `Not stored: ${j.reason}`); await load(date) }
    catch (e) { setToast(e.message) } finally { setBusy(false) }
  }
  const sign = async (roleName, comment) => {
    setBusy(true)
    try { await api('/api/pnl/signoff', { method: 'POST', body: JSON.stringify({ date, role: roleName, comment }) }); setToast(`${roleName === 'TRADER' ? 'Trader' : 'Controller'} sign-off recorded for ${fmtD(date)}`); await load(date) }
    catch (e) { setToast(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 6000); return () => clearTimeout(id) }, [toast])

  const t = rep?.totals || {}
  const [stLabel, stTone] = STATUS[rep?.status] || STATUS.OPEN
  const canControl = ['controller', 'cfo', 'admin', 'management', 'risk'].includes(role)

  return (
    <div className="pnl">
      <div className="pnl-bar">
        <div className="pnl-title">P&amp;L · ATTRIBUTION <span className="pnl-sub">{rep?.reporting_ccy || 'USD'} · {rep?.prev_date ? <>vs {fmtD(rep.prev_date)}</> : 'first mark'}</span></div>
        <div className="pnl-ctl">
          <label>MARKET DATE
            <select value={date || ''} onChange={e => load(e.target.value)} disabled={busy}>
              {(rep?.dates || []).slice().reverse().map(d => <option key={d} value={d}>{fmtD(d)}</option>)}
            </select>
          </label>
          <span className={`pnl-chip ${stTone}`}>{stLabel}</span>
          <button className="pnl-btn" onClick={runEod} disabled={busy || !rep?.date}>{busy ? 'WORKING…' : 'RUN END OF DAY'}</button>
          <button className={`pnl-btn ghost${view === 'book' ? ' on' : ''}`} onClick={() => setView('book')}>MY BOOK</button>
          <button className={`pnl-btn ghost${view === 'firm' ? ' on' : ''}`} onClick={() => setView('firm')} title="Every book in the firm, with sign-off state (controller, CFO, admin)">MANAGEMENT</button>
          <button className="pnl-btn ghost" onClick={() => navigate('/blotter')}>BLOTTER →</button>
        </div>
      </div>
      {toast && <div className="pnl-toast">{toast}</div>}
      {err && <div className="pnl-err">{err}</div>}
      {!rep && !err && <div className="pnl-empty">Reading the book…</div>}
      {rep && !rep.date && <div className="pnl-empty">{rep.note}</div>}

      {view === 'firm' ? <FirmView firm={firm} /> : rep?.date && (<>
        <div className="pnl-cards">
          <Card label={`DAY · ${fmtD(rep.date)}`} total={t.dod} market={t.market} trading={t.trading} />
          <Card label="MONTH TO DATE" total={t.mtd} market={t.mtd_market} trading={t.mtd_trading} note={`${t.history_days || 0} stored day${t.history_days === 1 ? '' : 's'} + today`} />
          <Card label="YEAR TO DATE" total={t.ytd} market={t.ytd_market} trading={t.ytd_trading} note={rep.tables ? (rep.persisted ? 'stored' : 'live · not yet stored') : 'live · history tables not applied'} />
          <div className="pnl-card meta">
            <span className="pnl-kl">TRADES</span><b>{rep.rows.length}</b>
            <span className="pnl-kl">VALUATIONS</span><b>{rep.meta?.valuations}</b>
            {rep.meta?.problems?.length > 0 && <><span className="pnl-kl warn">NOT EXPLAINED</span><b className="warn">{rep.meta.problems.length}</b></>}
          </div>
        </div>

        <div className="pnl-grid">
          <section className="pnl-panel">
            <header><span>WATERFALL · DAY</span><span className="pnl-sub">market, then trading, in {rep.reporting_ccy}</span></header>
            <Waterfall buckets={rep.buckets} total={t.dod} />
            <ul className="pnl-buckets">
              {rep.buckets.map(b => <BucketRow key={b.bucket} b={b} />)}
              {!rep.buckets.length && <li className="pnl-empty">Nothing to attribute: no trade is on the book at both dates and nothing was traded.</li>}
            </ul>
          </section>

          <section className="pnl-panel">
            <header><span>SIGN-OFF · {fmtD(rep.date)}</span><span className={`pnl-chip ${stTone}`}>{stLabel}</span></header>
            <SignOff rep={rep} role={role} canControl={canControl} onSign={sign} busy={busy} />
          </section>
        </div>

        <section className="pnl-panel">
          <header><span>HIERARCHY · DESK → BOOK → TRADE</span><span className="pnl-sub">click a trade for its explain</span></header>
          <Tree tree={rep.tree} rows={rep.rows} ccy={rep.reporting_ccy} />
          {rep.meta?.problems?.length > 0 && (
            <div className="pnl-problems">
              {rep.meta.problems.map(p => <div key={p.trade_id}><b>{p.trade_ref}</b> not explained: {p.reason}</div>)}
            </div>
          )}
        </section>

        <div className="pnl-foot">
          <b>Convention.</b> {rep.convention} Reporting currency {rep.reporting_ccy} at the close. Marks are the production pricers on the saved market of each date; nothing here is estimated from sensitivities.
          {!rep.tables && <> <em>History tables are not applied on this server (docs/migrations/2026-10-30_pnl.sql): the report is computed live and MTD / YTD equal the day.</em></>}
        </div>
      </>)}
    </div>
  )
}

function Card({ label, total, market, trading, note }) {
  const span = Math.max(Math.abs(market || 0), Math.abs(trading || 0), 1)
  return (
    <div className="pnl-card">
      <span className="pnl-kl">{label}</span>
      <b className={`pnl-big ${tone(total)}`}>{sgn(total)}</b>
      <div className="pnl-split">
        <div><span>MARKET</span><i><s style={{ width: `${Math.abs(market || 0) / span * 100}%` }} className={tone(market)} /></i><em className={tone(market)}>{sgn(market)}</em></div>
        <div><span>TRADING</span><i><s style={{ width: `${Math.abs(trading || 0) / span * 100}%` }} className={tone(trading)} /></i><em className={tone(trading)}>{sgn(trading)}</em></div>
      </div>
      {note && <span className="pnl-note">{note}</span>}
    </div>
  )
}

function Waterfall({ buckets, total }) {
  const ref = useRef(null)
  const [W, setW] = useState(0)
  useEffect(() => { if (!ref.current) return; const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(ref.current); return () => ro.disconnect() }, [])
  const steps = useMemo(() => {
    let run = 0; const out = []
    for (const b of buckets) { out.push({ label: BUCKET_LABEL[b.bucket] || b.bucket, from: run, to: run + b.usd, group: b.group }); run += b.usd }
    out.push({ label: 'TOTAL', from: 0, to: total || run, total: true })
    return out
  }, [buckets, total])
  if (!steps.length) return <div ref={ref} className="pnl-wf" />
  const H = 170, padL = 56, padB = 34, padT = 14
  const vals = steps.flatMap(s => [s.from, s.to]); let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals)
  if (hi === lo) hi = lo + 1
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad
  const Y = v => padT + (hi - v) / (hi - lo) * (H - padT - padB)
  const n = steps.length, slot = (W - padL - 8) / n, bw = Math.min(54, slot * 0.62)
  const ticks = [lo + pad, 0, hi - pad].filter((v, i, a) => a.indexOf(v) === i)
  return (
    <div ref={ref} className="pnl-wf">
      {W > 0 && <svg width={W} height={H}>
        {ticks.map(v => <g key={v}><line x1={padL} x2={W - 4} y1={Y(v)} y2={Y(v)} className="pnl-gl" /><text x={padL - 6} y={Y(v) + 3} className="pnl-ax" textAnchor="end">{fmt(v / 1000, 0)}k</text></g>)}
        {steps.map((s, i) => {
          const x = padL + i * slot + (slot - bw) / 2, y0 = Y(s.from), y1 = Y(s.to)
          const cls = s.total ? 'tot' : s.to - s.from >= 0 ? 'up' : 'dn'
          return (
            <g key={s.label}>
              {i > 0 && !s.total && <line x1={x - (slot - bw) / 2 - bw / 2 + bw / 2} x2={x} y1={Y(s.from)} y2={Y(s.from)} className="pnl-conn" />}
              <rect x={x} y={Math.min(y0, y1)} width={bw} height={Math.max(2, Math.abs(y1 - y0))} className={`pnl-bar ${cls}`} rx={2} />
              <text x={x + bw / 2} y={Math.min(y0, y1) - 4} className={`pnl-bv ${cls}`} textAnchor="middle">{sgn(s.to - s.from)}</text>
              <text x={x + bw / 2} y={H - padB + 14} className="pnl-ax" textAnchor="middle">{s.label.split(' · ')[0]}</text>
              {s.group && <text x={x + bw / 2} y={H - padB + 26} className="pnl-axg" textAnchor="middle">{s.group}</text>}
            </g>)
        })}
      </svg>}
    </div>
  )
}

function BucketRow({ b }) {
  const [open, setOpen] = useState(false)
  return (
    <li className={`pnl-brow${b.detail?.length ? ' has' : ''}`} onClick={() => b.detail?.length && setOpen(o => !o)}>
      <div className="pnl-brow-main">
        <span className={`pnl-grp ${b.group === 'TRADING' ? 'tr' : 'mk'}`}>{b.group}</span>
        <span className="pnl-bl">{BUCKET_LABEL[b.bucket] || b.bucket}{b.detail?.length ? <i className="pnl-caret">{open ? '▾' : '▸'}</i> : null}</span>
        <b className={tone(b.usd)}>{sgn(b.usd)}</b>
      </div>
      {open && <ul className="pnl-detail">{b.detail.map(d => <li key={d.label}><span>{d.label}</span><b className={tone(d.usd)}>{sgn(d.usd)}</b></li>)}</ul>}
    </li>
  )
}

function Tree({ tree, rows }) {
  const byId = useMemo(() => Object.fromEntries(rows.map(r => [r.trade_id, r])), [rows])
  const [open, setOpen] = useState({})
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }))
  const Row = ({ n, depth, k }) => {
    const isTrade = n.kind === 'TRADE', r = isTrade ? byId[n.trade_id] : null
    const isOpen = open[k] ?? depth < 3            // desks and books open, trades collapsed
    return (<>
      <div className={`pnl-tr d${depth}${isTrade ? ' trade' : ''}`} onClick={() => toggle(k)}>
        <span className="pnl-tn" style={{ paddingLeft: 8 + depth * 18 }}>
          <i className="pnl-caret">{isOpen ? '▾' : '▸'}</i>{n.name}
          {isTrade && <small>{(r?.instrument || '').replace('_', ' ')}{r?.kind !== 'EXPLAINED' ? ` · ${r?.kind}` : ''}{r?.fallback?.length ? ' · latest curve used' : ''}</small>}
          {!isTrade && <small>{n.count} trade{n.count === 1 ? '' : 's'}</small>}
        </span>
        <span className={`pnl-tv ${tone(n.market_usd)}`}>{sgn(n.market_usd)}</span>
        <span className={`pnl-tv ${tone(n.trading_usd)}`}>{sgn(n.trading_usd)}</span>
        <span className={`pnl-tv tot ${tone(n.usd)}`}>{sgn(n.usd)}</span>
        <span className="pnl-tv dim">{isTrade ? `${fmt(n.mark_prev)} → ${fmt(n.mark)} ${n.ccy}` : ''}</span>
      </div>
      {isOpen && isTrade && r && (
        <div className="pnl-explain">
          {r.rows.map((x, i) => (
            <div key={i} className="pnl-xr">
              <span className={`pnl-grp ${x.bucket === 'NEW' || x.bucket === 'UNWIND' ? 'tr' : 'mk'}`}>{x.bucket}</span>
              <span>{x.label}</span>
              <b className={tone(x.pnl)}>{sgn(x.pnl)} {x.ccy}</b>
              <em className={tone(x.usd)}>{x.usd != null ? sgn(x.usd) : '—'}</em>
            </div>
          ))}
          {r.greeks && <div className="pnl-xg">IR01 {fmt(r.greeks.ir01)} · IR01 DISC {fmt(r.greeks.ir01_disc)} · FX01/BTC01 {fmt(r.greeks.spot01)} · THETA {fmt(r.greeks.theta)} · at the close</div>}
        </div>
      )}
      {isOpen && !isTrade && n.children.map((c, i) => <Row key={`${k}/${c.name}/${i}`} n={c} depth={depth + 1} k={`${k}/${c.name}/${i}`} />)}
    </>)
  }
  return (
    <div className="pnl-tree">
      <div className="pnl-tr head"><span className="pnl-tn">NODE</span><span className="pnl-tv">MARKET</span><span className="pnl-tv">TRADING</span><span className="pnl-tv tot">DAY</span><span className="pnl-tv dim">MARK PREV → CLOSE</span></div>
      <Row n={tree} depth={0} k="root" />
    </div>
  )
}

function SignOff({ rep, role, canControl, onSign, busy }) {
  const [comment, setComment] = useState('')
  const signs = rep.signoffs || []
  const traderDone = signs.some(s => s.role === 'TRADER'), ctlDone = signs.some(s => s.role === 'CONTROLLER')
  return (
    <div className="pnl-sign">
      <ol className="pnl-steps">
        <li className={traderDone ? 'done' : ''}><i>{traderDone ? '✓' : '1'}</i><span>Trader reviews the attribution and signs</span></li>
        <li className={ctlDone ? 'done' : ''}><i>{ctlDone ? '✓' : '2'}</i><span>P&amp;L controller or desk CFO signs</span></li>
        <li className={rep.status === 'FINAL' ? 'done' : ''}><i>{rep.status === 'FINAL' ? '✓' : '3'}</i><span>FINAL: visible to management with the comments</span></li>
      </ol>
      {signs.length > 0 && <ul className="pnl-comments">
        {signs.map((s, i) => <li key={i}><span className="pnl-grp mk">{s.role}</span><b>{s.by}</b><em>{s.at ? new Date(s.at).toLocaleString() : ''}</em>{s.usd_signed != null && <small>signed {sgn(s.usd_signed)} USD</small>}{s.comment && <p>{s.comment}</p>}</li>)}
      </ul>}
      {!rep.tables ? <div className="pnl-note">Sign-off needs the history tables (migration not applied on this server).</div> : (
        <>
          <textarea className="pnl-ta" rows={2} placeholder="Comment for the record (what moved, anything the controller should know)" value={comment} onChange={e => setComment(e.target.value)} />
          <div className="pnl-sign-btns">
            <button className="pnl-btn" disabled={busy || traderDone} onClick={() => onSign('TRADER', comment)}>{traderDone ? 'TRADER SIGNED' : 'SIGN AS TRADER'}</button>
            <button className="pnl-btn" disabled={busy || ctlDone || !canControl} title={canControl ? '' : 'Needs the controller, CFO or admin role'} onClick={() => onSign('CONTROLLER', comment)}>{ctlDone ? 'CONTROLLER SIGNED' : 'SIGN AS CONTROLLER'}</button>
          </div>
          <div className="pnl-note">Your role: {role.toUpperCase()}{canControl ? ' · may sign as controller' : ''}. Signing stores the day first, so what is signed is what is kept.</div>
        </>
      )}
    </div>
  )
}

function FirmView({ firm }) {
  if (!firm) return <div className="pnl-empty">Loading the firm…</div>
  if (firm.error) return <div className="pnl-err">{firm.error}</div>
  return (
    <section className="pnl-panel">
      <header><span>MANAGEMENT · EVERY BOOK IN THE FIRM</span><span className="pnl-sub">{firm.reporting_ccy}</span></header>
      <div className="pnl-tree">
        <div className="pnl-tr head"><span className="pnl-tn">BOOK OWNER</span><span className="pnl-tv">DAY</span><span className="pnl-tv">MTD</span><span className="pnl-tv tot">YTD</span><span className="pnl-tv dim">STATUS</span></div>
        {firm.members.map(m => {
          const [l, tn] = STATUS[m.status] || STATUS.OPEN
          return (
            <div key={m.user_id} className="pnl-tr d1">
              <span className="pnl-tn" style={{ paddingLeft: 8 }}>{m.user_id.slice(0, 8)} <small>{m.role} · {m.trades} trades · {m.date ? fmtD(m.date) : 'no market date'}{m.desks?.length ? ` · ${m.desks.map(d => d.name).join(', ')}` : ''}</small></span>
              <span className={`pnl-tv ${tone(m.dod)}`}>{sgn(m.dod)}</span>
              <span className={`pnl-tv ${tone(m.mtd)}`}>{sgn(m.mtd)}</span>
              <span className={`pnl-tv tot ${tone(m.ytd)}`}>{sgn(m.ytd)}</span>
              <span className="pnl-tv dim"><span className={`pnl-chip ${tn}`}>{l}</span></span>
            </div>)
        })}
        {!firm.members.length && <div className="pnl-empty">No books with market dates in the firm yet.</div>}
      </div>
    </section>
  )
}

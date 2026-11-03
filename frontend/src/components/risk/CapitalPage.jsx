// risk/CapitalPage.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// CAPITAL: the book under collateral regimes. Every netting set is simulated once on
// the credit engine's paths and re-collateralised step by step from the CSA as booked
// to an on-chain CSA under today's rules, then to the forward-looking states. The
// difference each step makes is that channel's attribution; the steps add up to the
// columns exactly. GET /api/capital/portfolio (stored run) · POST /api/capital/portfolio
// (background) · engine backend/ccr/capital_report.py.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSessionMaybe } from '../../lib/session'
import RiskNav from './RiskNav'
import { COLUMNS, COLUMN_LABEL, COLUMN_DESC, METRICS, bars, errorMessage, fmt, fmtBp, fmtPct, fmtSigned, tableRows, totalsRow, waterfall } from './capital-page'
import '../pnl/PnlPage.css'
import './RiskPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const fmtD = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtT = (iso) => iso ? new Date(iso).toLocaleString() : ''
const COLOR = { BASELINE: 'var(--text-dim)', CURRENT: 'var(--accent)', FORWARD: 'var(--blue)' }

async function api(path, opts = {}) {
  const s = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(errorMessage(r.status, j))
  return j
}

export default function CapitalPage() {
  const navigate = useNavigate()
  const [rep, setRep] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState(null)
  const [metric, setMetric] = useState('rwa')
  const [sel, setSel] = useState(null)
  const [yieldBp, setYieldBp] = useState('')
  const [hurdle, setHurdle] = useState('12')
  const timer = useRef(null)

  const load = async () => {
    setBusy(true); setErr(null)
    try { const j = await api('/api/capital/portfolio'); setRep(j); setJob(j.job || null); if (!sel && j.counterparties?.length) setSel(j.counterparties.find(c => !c.empty)?.counterparty_id || null) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const run = async () => {
    try {
      const body = { hurdle: Number(hurdle) / 100, yield_bp: yieldBp === '' ? null : Number(yieldBp) }
      const j = await api('/api/capital/portfolio', { method: 'POST', body: JSON.stringify(body) })
      setJob(j.job || { running: true }); poll()
    } catch (e) { setErr(e.message) }
  }
  const poll = () => {
    clearInterval(timer.current)
    timer.current = setInterval(async () => {
      try { const s = await api('/api/capital/portfolio/status'); setJob(s.job); if (s.job && !s.job.running) { clearInterval(timer.current); load() } } catch { clearInterval(timer.current) }
    }, 3000)
  }
  useEffect(() => () => clearInterval(timer.current), [])

  const rows = tableRows(rep, metric)
  const tot = totalsRow(rep, metric)
  const cur = rep?.counterparties?.find(c => c.counterparty_id === sel && !c.empty) || rep?.counterparties?.find(c => !c.empty)
  const wf = cur ? waterfall(cur.steps, cur.columns, metric) : []
  const geo = bars(wf, 1000, 160)
  const mdef = METRICS.find(x => x[1] === metric) || METRICS[0]
  const grid = '1fr 6rem 9rem 9rem 9rem 7rem 7rem'

  return (
    <div className="pnl rk-page">
      <RiskNav />
      <div className="pnl-bar">
        <div className="pnl-title">CAPITAL UNDER REGIMES <span className="pnl-sub">USD · every netting set on the same paths · the CSA as booked → on-chain, channel by channel</span></div>
        <div className="pnl-ctl">
          {rep?.from_store && <span className="pnl-note">stored run · {fmtD(rep.date)} · {fmtT(rep.generated_at)}</span>}
          <label className="pnl-note" title="the cost of regulatory capital, on both legs">hurdle % <input value={hurdle} onChange={e => setHurdle(e.target.value)} style={{ width: 36, marginLeft: 4 }} /></label>
          <label className="pnl-note" title="the yield of the tokenised sovereign claim posted as IM in the forward column; blank = none">yield bp <input value={yieldBp} onChange={e => setYieldBp(e.target.value)} placeholder="—" style={{ width: 44, marginLeft: 4 }} /></label>
          <button className="pnl-btn" onClick={run} disabled={busy || job?.running}>{job?.running ? `RUNNING… ${job.done}/${job.total} ${job.current || ''}` : 'RUN NOW'}</button>
          <button className="pnl-btn ghost" onClick={() => navigate('/configurations/counterparties')}>COUNTERPARTIES →</button>
        </div>
      </div>
      {err && <div className="pnl-err">{err}</div>}
      {job?.error && <div className="pnl-err">Last run failed: {job.error}</div>}
      {!rep && !err && <div className="pnl-empty">Loading…</div>}
      {rep && !rep.date && <div className="pnl-empty">{rep.note}</div>}
      {rep?.date && (<>
        <div className="pnl-cards" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
          {COLUMNS.map(col => (
            <Card key={col} label={COLUMN_LABEL[col]} big={fmt(rep.totals?.[col]?.[metric])}
              sub={col === 'BASELINE' ? `${mdef[0]} · ${rep.counterparties?.length || 0} counterparties` : `${fmtPct(rep.totals?.[col]?.[metric], rep.totals?.BASELINE?.[metric])} vs booked · quote ${fmtBp(rep.quote?.[col]?.running_bp)} running`} title={COLUMN_DESC[col]} />
          ))}
          <Card label="MEASURE" big={rep.measure || 'RISK_NEUTRAL'} sub={`seed ${rep.seed} · hurdle ${Math.round(100 * (rep.hurdle ?? 0.12))} %${rep.yield_bp != null ? ` · yield ${rep.yield_bp} bp` : ''} · ${rep.unassigned_trades || 0} unassigned`} />
        </div>

        <div className="rk-chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0 10px' }}>
          {METRICS.map(([label, key, desc]) => (
            <button key={key} className={`pnl-chip${metric === key ? ' ok' : ''}`} style={{ cursor: 'pointer' }} title={desc} onClick={() => setMetric(key)}>{label}</button>
          ))}
        </div>

        <section className="pnl-panel">
          <header><span>BY COUNTERPARTY · {mdef[0]}</span><span className="pnl-sub">{mdef[2]} · click a row for its attribution</span></header>
          <div className="pnl-tree">
            <div className="pnl-tr head" style={{ gridTemplateColumns: grid }}>
              <span className="pnl-tn">COUNTERPARTY · CSA AS BOOKED</span><span className="pnl-tv">TRADES</span>
              {COLUMNS.map(col => <span key={col} className={`pnl-tv${col === 'BASELINE' ? ' tot' : ''}`} title={COLUMN_DESC[col]}>{COLUMN_LABEL[col]}</span>)}
              <span className="pnl-tv">Δ CURRENT</span><span className="pnl-tv">Δ FORWARD</span>
            </div>
            {rows.map(r => (
              <div key={r.id} className={`pnl-tr d1 trade${cur && cur.counterparty_id === r.id ? ' on' : ''}`} style={{ gridTemplateColumns: grid }} onClick={() => !r.empty && setSel(r.id)}>
                <span className="pnl-tn" style={{ paddingLeft: 8 }}>{r.name}<small>{r.record ? `${r.record.csa_type || 'NO_CSA'}${r.record.threshold_m ? ` · thr ${r.record.threshold_m}m` : ''}${r.record.mta_k ? ` · mta ${r.record.mta_k}k` : ''} · MPoR ${r.record.mpor_days}bd${r.record.mpor_disputed ? ' (disputed)' : ''} · ${(r.record.eligible_collateral || []).join('/')}${r.record.netting_enforceable ? '' : ' · unenforceable'}` : ''}{r.inputs ? ` · ${r.inputs.counterparty_type} ${r.inputs.rating_bucket} RW ${Math.round(100 * r.inputs.rw)} %` : ''}</small></span>
                <span className="pnl-tv">{r.empty ? r.trades : `${r.simulated}/${r.trades}`}</span>
                {r.empty ? <span className="pnl-tv dim" style={{ gridColumn: '3 / -1', textAlign: 'left' }}>{r.note}</span> : <>
                  <span className="pnl-tv tot">{fmt(r.values.BASELINE)}</span>
                  <span className="pnl-tv">{fmt(r.values.ON_CHAIN_CURRENT)}</span>
                  <span className="pnl-tv">{fmt(r.values.ON_CHAIN_FORWARD)}</span>
                  <span className={`pnl-tv ${r.change.ON_CHAIN_CURRENT < -0.5 ? 'pos' : r.change.ON_CHAIN_CURRENT > 0.5 ? 'neg' : ''}`}>{fmtSigned(r.change.ON_CHAIN_CURRENT)}</span>
                  <span className={`pnl-tv ${r.change.ON_CHAIN_FORWARD < -0.5 ? 'pos' : r.change.ON_CHAIN_FORWARD > 0.5 ? 'neg' : ''}`}>{fmtSigned(r.change.ON_CHAIN_FORWARD)}</span></>}
              </div>
            ))}
            {tot && (
              <div className="pnl-tr d0" style={{ gridTemplateColumns: grid, borderTop: '1px solid var(--border)' }}>
                <span className="pnl-tn"><b>BOOK</b><small>quote vs booked: {COLUMNS.slice(1).map(c => `${COLUMN_LABEL[c].split(' · ')[1]} ${fmtBp(rep.quote?.[c]?.running_bp)} running / ${fmtBp(rep.quote?.[c]?.upfront_bp)} upfront`).join(' · ')}</small></span>
                <span className="pnl-tv" />
                <span className="pnl-tv tot"><b>{fmt(tot.values.BASELINE)}</b></span>
                <span className="pnl-tv"><b>{fmt(tot.values.ON_CHAIN_CURRENT)}</b></span>
                <span className="pnl-tv"><b>{fmt(tot.values.ON_CHAIN_FORWARD)}</b></span>
                <span className="pnl-tv"><b>{fmtSigned(tot.change.ON_CHAIN_CURRENT)}</b></span>
                <span className="pnl-tv"><b>{fmtSigned(tot.change.ON_CHAIN_FORWARD)}</b></span>
              </div>
            )}
            {!rows.length && <div className="pnl-empty">No live trades with a counterparty.</div>}
          </div>
        </section>

        {cur && (
          <section className="pnl-panel">
            <header><span>{cur.counterparty} · ATTRIBUTION OF {mdef[0]}</span><span className="pnl-sub">sequential: each step changes one thing in the previous step's CSA · {cur.n_paths} paths · monthly to {cur.months}M · {cur.seconds}s</span></header>
            <svg width="100%" height={180} viewBox="0 0 1000 180" preserveAspectRatio="none" style={{ display: 'block', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 2 }}>
              {geo.length > 0 && <line x1={0} x2={1000} y1={geo[0].zero} y2={geo[0].zero} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
              {geo.map(b => (
                <g key={b.key}>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} fill={b.kind === 'level' ? COLOR[b.state] : (b.value <= 0 ? COLOR[b.state] : 'var(--red)')} opacity={b.kind === 'level' ? 0.85 : 0.55} />
                  <title>{`${b.label}: ${b.kind === 'level' ? fmt(b.value) : fmtSigned(b.value)}${b.source ? ` — ${b.source}` : ''}`}</title>
                </g>
              ))}
            </svg>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(wf.length, 1)}, 1fr)`, gap: 4, marginTop: 4 }}>
              {wf.map(b => <div key={b.key} style={{ fontSize: 10, fontFamily: 'var(--mono)', color: COLOR[b.state] || 'var(--text-dim)', textAlign: 'center', lineHeight: 1.3 }}>{b.label}<br /><b>{b.kind === 'level' ? fmt(b.value) : fmtSigned(b.value)}</b></div>)}
            </div>
            <div className="pnl-tree" style={{ marginTop: 10 }}>
              <div className="pnl-tr head" style={{ gridTemplateColumns: '14rem 6rem 9rem 1fr' }}><span className="pnl-tn">STEP</span><span className="pnl-tv">STATE</span><span className="pnl-tv">Δ {mdef[0]}</span><span className="pnl-tn">WHAT CHANGES, AND WHERE IT SAYS SO</span></div>
              {(cur.steps || []).filter(s => s.key !== 'BASELINE').map(s => (
                <div key={s.key} className="pnl-tr d1" style={{ gridTemplateColumns: '14rem 6rem 9rem 1fr' }}>
                  <span className="pnl-tn" style={{ paddingLeft: 8 }}>{s.label}</span>
                  <span className="pnl-tv" style={{ color: COLOR[s.state] }}>{s.state}</span>
                  <span className={`pnl-tv ${s.delta?.[metric] < -0.5 ? 'pos' : s.delta?.[metric] > 0.5 ? 'neg' : ''}`}>{fmtSigned(s.delta?.[metric])}</span>
                  <span className="pnl-tn" style={{ whiteSpace: 'normal', fontSize: 11, color: 'var(--text-dim)' }}>{s.source}{s.csa ? ` · after: ${s.csa.collateralised ? `VM, thr ${fmt(s.csa.threshold)}, MTA ${fmt(s.csa.mta)}, MPoR ${s.csa.mpor_days}bd` : 'no VM'}${s.csa.im_exchanged ? `, IM ${Math.round(100 * s.csa.im_eligible_fraction)} % eligible` : ''}, received ${Object.keys(s.csa.received).join('/')}, recognised ${Math.round(100 * s.csa.recognised_fraction)} %${s.csa.pickup_bp ? `, pickup ${s.csa.pickup_bp} bp` : ''}` : ''}</span>
                </div>
              ))}
            </div>
            <div className="pnl-note" style={{ marginTop: 8, lineHeight: 1.6 }}>
              {(rep.invariants || []).map((x, i) => <div key={i}>· {x}</div>)}
              {cur.notes?.length ? <div>· {cur.notes.join(' · ')}</div> : null}
            </div>
          </section>
        )}
      </>)}
    </div>
  )
}

function Card({ label, big, sub, title }) {
  return (
    <div className="pnl-card" title={title}>
      <div className="pnl-card-l">{label}</div>
      <div className="pnl-card-b">{big}</div>
      <div className="pnl-card-s">{sub}</div>
    </div>
  )
}

// risk/RiskPage.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// MARKET RISK for the caller's book on a market date: the ladder (key-rate IR01 by curve
// and tenor bucket, spot deltas), historical-simulation VaR on that ladder, named stress
// scenarios by full revaluation, and the firm's limits with utilisation.
// GET /api/risk/report · limits and settings live under Configurations › Market Risk.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSessionMaybe } from '../../lib/session'
import '../pnl/PnlPage.css'
import './RiskPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const fmt = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })
const sgn = (n, d = 0) => n == null || isNaN(n) ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n), d)}`
const tone = (n) => n > 0.5 ? 'pos' : n < -0.5 ? 'neg' : ''
const fmtD = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const pct = (x) => x == null ? '—' : `${(x * 100).toFixed(0)}%`

async function api(path, opts = {}) {
  const s = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `${path} ${r.status}`)
  return j
}

export default function RiskPage() {
  const navigate = useNavigate()
  const [rep, setRep] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [date, setDate] = useState(null)
  const load = async (d) => {
    setBusy(true); setErr(null)
    try { const j = await api(`/api/risk/report${d ? `?date=${d}` : ''}`); setRep(j); if (j.date) setDate(j.date) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { load(null) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const v = rep?.var || {}, lad = rep?.ladder || {}
  const worst = (rep?.stress || []).reduce((m, s) => s.pnl_usd < (m?.pnl_usd ?? 0) ? s : m, null)
  const breaches = rep?.breaches || 0, warnings = rep?.warnings || 0

  return (
    <div className="pnl rk-page">
      <div className="pnl-bar">
        <div className="pnl-title">MARKET RISK <span className="pnl-sub">{rep?.reporting_ccy || 'USD'} · ladder by bump-and-reprice · VaR by historical simulation · stress by full revaluation</span></div>
        <div className="pnl-ctl">
          <label>MARKET DATE
            <select value={date || ''} onChange={e => load(e.target.value)} disabled={busy}>{(rep?.dates || []).slice().reverse().map(d => <option key={d} value={d}>{fmtD(d)}</option>)}</select>
          </label>
          {rep && <span className={`pnl-chip ${breaches ? 'red' : warnings ? 'amber' : 'ok'}`}>{breaches ? `${breaches} BREACH${breaches > 1 ? 'ES' : ''}` : warnings ? `${warnings} WARNING${warnings > 1 ? 'S' : ''}` : 'WITHIN LIMITS'}</span>}
          <button className="pnl-btn ghost" onClick={() => navigate('/configurations/market-risk/limits')}>LIMITS →</button>
          <button className="pnl-btn ghost" onClick={() => navigate('/configurations/market-risk/var')}>VAR SETTINGS →</button>
          <button className="pnl-btn ghost" onClick={() => navigate('/pnl')}>P&amp;L →</button>
        </div>
      </div>
      {err && <div className="pnl-err">{err}</div>}
      {!rep && !err && <div className="pnl-empty">Bumping and repricing the book…</div>}
      {rep && !rep.date && <div className="pnl-empty">{rep.note}</div>}
      {rep?.date && (<>
        <div className="pnl-cards rk-cards">
          <Card label={`VAR ${pct(v.confidence)} · ${v.horizon_days}D`} big={fmt(v.var_h)} sub={`ES ${fmt(v.es_h)} · ${pct(v.secondary_confidence)} VaR ${fmt(v.var_1d_secondary)}`}
                note={v.enough ? `${v.observations} days · ${fmtD(v.window_from)} → ${fmtD(v.window_to)}` : `only ${v.observations} days of history · needs ${v.min_observations}`} warn={!v.enough} />
          <Card label="IR01 · ALL CURVES" big={sgn(lad.ir01_usd)} sub={`per bp · ${lad.bump_bp}bp bump`} note={`${(lad.ladder || []).length} curves`} />
          <Card label="FX01 · BTC01" big={Object.entries(lad.spot01 || {}).map(([a, x]) => `${a} ${sgn(x)}`).join(' · ') || '—'} sub="PV for +1% spot" note="by asset" />
          <Card label="WORST STRESS" big={worst ? sgn(worst.pnl_usd) : '—'} sub={worst?.name || ''} note={`${(rep.stress || []).length} scenarios`} warn={worst && worst.pnl_usd < 0} />
          <Card label="NPV" big={sgn(lad.npv_usd)} sub={`${(rep.ladder_rows || []).length} trades${lad.problems?.length ? ` · ${lad.problems.length} not priced` : ''}`} note={`${lad.valuations} valuations`} />
        </div>

        <div className="pnl-grid">
          <section className="pnl-panel">
            <header><span>LADDER · KEY-RATE IR01 BY CURVE AND BUCKET</span><span className="pnl-sub">{rep.reporting_ccy} per bp</span></header>
            <Ladder ladder={lad.ladder || []} buckets={lad.buckets || []} />
            {(lad.unconverted || []).length > 0 && <div className="pnl-note">Unconverted currencies (no spot saved): {lad.unconverted.join(', ')}</div>}
            <div className="rk-h">BY TRADE</div>
            <div className="rk-rows">
              {(rep.ladder_rows || []).map(r => (
                <div key={r.trade_id} className="rk-row">
                  <span className="rk-ref">{r.trade_ref}<small>{(r.instrument || '').replace('_', ' ')} · {r.desk} / {r.book}</small></span>
                  <span className={`pnl-tv ${tone(r.ir01)}`}>{sgn(r.ir01)} <small>IR01</small></span>
                  <span className="pnl-tv">{Object.entries(r.spot01).map(([a, x]) => `${a} ${sgn(x)}`).join(' ') || '—'} <small>SPOT01</small></span>
                  <span className={`pnl-tv ${tone(r.npv)}`}>{sgn(r.npv)} {r.ccy}</span>
                </div>
              ))}
              {(lad.problems || []).map(p => <div key={p.trade_ref} className="rk-row dim"><span className="rk-ref">{p.trade_ref}</span><span className="pnl-tv" style={{ gridColumn: '2 / -1', textAlign: 'left' }}>not priced: {p.reason}</span></div>)}
            </div>
          </section>

          <section className="pnl-panel">
            <header><span>VAR · HISTORICAL SIMULATION</span><span className="pnl-sub">{v.method}</span></header>
            <Hist hist={v.histogram || []} varv={v.var_1d} />
            <div className="rk-kv">
              <div><span>WINDOW</span><b>{v.window_days}d · {v.observations} obs</b></div>
              <div><span>VAR 1D</span><b>{fmt(v.var_1d)}</b></div>
              <div><span>ES 1D</span><b>{fmt(v.es_1d)}</b></div>
              <div><span>HORIZON</span><b>{v.horizon_days}d · √t</b></div>
            </div>
            {(v.worst_days || []).length > 0 && <>
              <div className="rk-h">WORST DAYS IN THE WINDOW</div>
              {v.worst_days.map(w => <div key={w.date} className="rk-wd"><span>{fmtD(w.date)}</span><b className={tone(w.pnl)}>{sgn(w.pnl)}</b></div>)}
            </>}
            {(v.missing_factors || []).length > 0 && <div className="pnl-foot"><em>No history for: {v.missing_factors.join(', ')}. Their risk is in the ladder, not in VaR.</em></div>}
            {!v.enough && <div className="pnl-foot"><em>Too little history for a meaningful VaR. The backfill fetches two years from public sources (Configurations › Market Risk › VaR settings).</em></div>}
          </section>
        </div>

        <div className="pnl-grid">
          <section className="pnl-panel">
            <header><span>STRESS · FULL REVALUATION</span><span className="pnl-sub">loss negative</span></header>
            <Stress rows={rep.stress || []} />
          </section>
          <section className="pnl-panel">
            <header><span>LIMITS</span><span className="pnl-sub">{rep.limits?.length ? `${rep.limits.length} set` : 'none set'}</span></header>
            <Limits rows={rep.limits || []} tables={rep.tables} canWrite={rep.can_write} onConfigure={() => navigate('/configurations/market-risk/limits')} />
          </section>
        </div>

        <div className="pnl-foot">
          <b>Method.</b> The ladder bumps each tenor bucket of each curve by {lad.bump_bp}bp and reprices every trade through the production pricers; spot deltas are the pricers' PV for +1% spot. VaR applies each historical day's observed changes (bp per bucket, log returns for spots, from public sources stored on the template account) to the ladder: linear in the factors, so convexity and vol are outside it and said so. Stress reprices the book in full on the shifted market. Limits are the firm's, set by the risk manager, and evaluated against these numbers.
        </div>
      </>)}
    </div>
  )
}

function Card({ label, big, sub, note, warn }) {
  return <div className="pnl-card"><span className="pnl-kl">{label}</span><b className={`pnl-big rk-big${warn ? ' warn' : ''}`}>{big}</b><span className="rk-sub">{sub}</span>{note && <span className="pnl-note">{note}</span>}</div>
}

function Ladder({ ladder, buckets }) {
  const cols = buckets.concat(ladder.some(r => r.buckets.FLAT != null) ? ['FLAT'] : [])
  const max = Math.max(1, ...ladder.flatMap(r => cols.map(b => Math.abs(r.buckets[b] || 0))))
  return (
    <div className="rk-ladder" style={{ gridTemplateColumns: `10rem repeat(${cols.length}, 1fr) 7rem` }}>
      <span className="rk-lh">CURVE</span>{cols.map(b => <span key={b} className="rk-lh r">{b}</span>)}<span className="rk-lh r">TOTAL</span>
      {ladder.map(r => (<div key={r.curve} className="rk-lrow" style={{ gridTemplateColumns: `10rem repeat(${cols.length}, 1fr) 7rem` }}>
        <span className="rk-lc">{r.curve}</span>
        {cols.map(b => { const x = r.buckets[b]; return <span key={b} className={`rk-cell ${tone(x)}`}><i style={{ width: `${Math.abs(x || 0) / max * 100}%` }} className={tone(x)} /><em>{x == null ? '' : sgn(x)}</em></span> })}
        <span className={`rk-cell tot ${tone(r.total)}`}><em>{sgn(r.total)}</em></span>
      </div>))}
      {!ladder.length && <span className="pnl-empty" style={{ gridColumn: '1 / -1' }}>No rates risk on the book.</span>}
    </div>
  )
}

function Hist({ hist, varv }) {
  const ref = useRef(null); const [W, setW] = useState(0)
  useEffect(() => { if (!ref.current) return; const ro = new ResizeObserver(([e]) => setW(e.contentRect.width)); ro.observe(ref.current); return () => ro.disconnect() }, [])
  if (!hist.length) return <div ref={ref} className="rk-hist"><div className="pnl-empty">No simulated distribution yet.</div></div>
  const H = 120, top = Math.max(...hist.map(h => h.n)), n = hist.length, bw = W / n
  const lo = hist[0].from, hi = hist[n - 1].to, X = x => (x - lo) / (hi - lo) * W
  return (
    <div ref={ref} className="rk-hist">{W > 0 && <svg width={W} height={H + 16}>
      {hist.map((h, i) => <rect key={i} x={i * bw + 1} y={H - h.n / top * (H - 6)} width={Math.max(1, bw - 2)} height={h.n / top * (H - 6)} className={`rk-bin ${h.to <= 0 ? 'neg' : 'pos'}`} />)}
      {varv != null && <g><line x1={X(-varv)} x2={X(-varv)} y1={0} y2={H} className="rk-varline" /><text x={X(-varv) + 4} y={10} className="pnl-ax">VaR</text></g>}
      <line x1={X(0)} x2={X(0)} y1={0} y2={H} className="rk-zero" />
      <text x={2} y={H + 12} className="pnl-ax">{fmt(lo / 1000)}k</text><text x={W - 2} y={H + 12} className="pnl-ax" textAnchor="end">{fmt(hi / 1000)}k</text>
    </svg>}</div>
  )
}

function Stress({ rows }) {
  const max = Math.max(1, ...rows.map(r => Math.abs(r.pnl_usd)))
  return (
    <div className="rk-stress">
      {rows.map(r => (
        <div key={r.id} className="rk-srow" title={r.worst_trades.map(w => `${w.trade_ref} ${sgn(w.pnl)}`).join(' · ')}>
          <span className="pnl-grp mk">{r.group}</span>
          <span className="rk-sname">{r.name}</span>
          <span className="rk-sbar"><i style={{ width: `${Math.abs(r.pnl_usd) / max * 100}%` }} className={tone(r.pnl_usd)} /></span>
          <b className={`pnl-tv ${tone(r.pnl_usd)}`}>{sgn(r.pnl_usd)}</b>
        </div>
      ))}
      {!rows.length && <div className="pnl-empty">No live trades to stress.</div>}
    </div>
  )
}

export function Limits({ rows, tables, canWrite, onConfigure }) {
  return (
    <div className="rk-limits">
      {rows.map(l => (
        <div key={l.id} className={`rk-lim ${String(l.status).toLowerCase()}`}>
          <span className="rk-lm">{l.metric}<small>{l.scope === 'ALL' ? 'book' : `${l.scope.toLowerCase()} ${l.scope_name}`}{l.note ? ` · ${l.note}` : ''}</small></span>
          <span className="rk-lbar"><i style={{ width: `${Math.min(100, l.utilisation_pct || 0)}%` }} /><s style={{ left: `${Math.min(100, l.warn_pct)}%` }} /></span>
          <span className="pnl-tv">{l.value == null ? '—' : fmt(l.value)} <small>/ {fmt(l.limit)}</small></span>
          <span className={`pnl-chip ${l.status === 'BREACH' ? 'red' : l.status === 'WARN' ? 'amber' : l.status === 'OK' ? 'ok' : ''}`} title={l.note_eval || ''}>{l.status === 'NA' ? 'N/A' : `${l.status} ${l.utilisation_pct != null ? `${l.utilisation_pct.toFixed(0)}%` : ''}`}</span>
        </div>
      ))}
      {!rows.length && <div className="pnl-empty">{tables ? 'No limits set for the firm yet.' : 'Limits need the market risk tables (migration not applied on this server).'}</div>}
      {canWrite && <div className="pnl-sign-btns"><button className="pnl-btn ghost" onClick={onConfigure}>SET LIMITS →</button></div>}
    </div>
  )
}

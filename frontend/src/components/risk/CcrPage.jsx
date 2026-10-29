// risk/CcrPage.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// COUNTERPARTY CREDIT: the book by counterparty. Each netting set is simulated on shared
// factor paths (one Hull-White factor per currency, one lognormal factor per spot,
// correlated from the public history), the counterparty's CSA is applied to the netted
// value, and the exposure measures are real-world: EE, EPE, PFE at 95 / 97.5 / 99, peak,
// by tenor bucket. CVA is the risk-neutral run through the XVA waterfall. Limits on any of
// them. GET /api/ccr/report (stored run) · POST /api/ccr/run (background) · engine backend/ccr.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSessionMaybe } from '../../lib/session'
import RateCurveCanvas from '../market-data/RateCurveCanvas'
import { Limits } from './RiskPage'
import '../pnl/PnlPage.css'
import './RiskPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const fmt = (n, d = 0) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d })
const sgn = (n) => n == null || isNaN(n) ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`
const tone = (n) => n > 0.5 ? 'pos' : n < -0.5 ? 'neg' : ''
const fmtD = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtT = (iso) => iso ? new Date(iso).toLocaleString() : ''

async function api(path, opts = {}) {
  const s = await getSessionMaybe()
  const r = await fetch(`${API}${path}`, { ...opts, headers: { Authorization: `Bearer ${s?.access_token}`, 'Content-Type': 'application/json' } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `${path} ${r.status}`)
  return j
}

export default function CcrPage() {
  const navigate = useNavigate()
  const [rep, setRep] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [sel, setSel] = useState(null)
  const [job, setJob] = useState(null)
  const timer = useRef(null)
  const load = async (live) => {
    setBusy(true); setErr(null)
    try { const j = await api(`/api/ccr/report${live ? '?live=1' : ''}`); setRep(j); setJob(j.job || null); if (!sel && j.counterparties?.length) setSel(j.counterparties[0].counterparty) }
    catch (e) { setErr(e.message) } finally { setBusy(false) }
  }
  useEffect(() => { load(false) }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  const run = async () => {
    try { const j = await api('/api/ccr/run', { method: 'POST' }); setJob(j.job || { running: true }); poll() } catch (e) { setErr(e.message) }
  }
  const poll = () => {
    clearInterval(timer.current)
    timer.current = setInterval(async () => {
      try { const s = await api('/api/ccr/status'); setJob(s.job); if (s.job && !s.job.running) { clearInterval(timer.current); load(false) } } catch { clearInterval(timer.current) }
    }, 3000)
  }
  useEffect(() => () => clearInterval(timer.current), [])
  const cps = rep?.counterparties || []
  const cur = cps.find(c => c.counterparty === sel) || cps[0]
  const t = rep?.totals || {}
  const breaches = rep?.breaches || 0

  return (
    <div className="pnl rk-page">
      <div className="pnl-bar">
        <div className="pnl-title">COUNTERPARTY CREDIT <span className="pnl-sub">USD · netting set on shared paths · exposure real-world · CVA risk-neutral</span></div>
        <div className="pnl-ctl">
          {rep && <span className={`pnl-chip ${breaches ? 'red' : 'ok'}`}>{breaches ? `${breaches} BREACH${breaches > 1 ? 'ES' : ''}` : 'WITHIN LIMITS'}</span>}
          {rep?.from_store && <span className="pnl-note">stored run · {fmtD(rep.date)} · {fmtT(rep.stored_at)}</span>}
          <button className="pnl-btn" onClick={run} disabled={busy || job?.running}>{job?.running ? `RUNNING… ${job.done}/${job.total} ${job.current || ''}` : 'RUN NOW'}</button>
          <button className="pnl-btn ghost" onClick={() => load(true)} disabled={busy}>COMPUTE LIVE</button>
          <button className="pnl-btn ghost" onClick={() => navigate('/risk')}>MARKET RISK →</button>
          <button className="pnl-btn ghost" onClick={() => navigate('/configurations/market-risk/limits')}>LIMITS →</button>
        </div>
      </div>
      {err && <div className="pnl-err">{err}</div>}
      {job?.error && <div className="pnl-err">Last run failed: {job.error}</div>}
      {!rep && !err && <div className="pnl-empty">Simulating the netting sets…</div>}
      {rep && !rep.date && <div className="pnl-empty">{rep.note}</div>}
      {rep?.date && (<>
        <div className="pnl-cards" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
          <Card label="PEAK PFE 95% · ALL" big={fmt(t.peak_pfe95_usd)} sub="sum over counterparties · real-world" />
          <Card label="EPE · FIRST YEAR" big={fmt(t.epe_1y_usd)} sub="expected positive exposure" />
          <Card label="CURRENT EXPOSURE" big={fmt(t.current_exposure_usd)} sub="after collateral held" />
          <Card label="CVA · ALL" big={sgn(t.cva_usd)} sub="risk-neutral, XVA waterfall" neg />
          <Card label="COUNTERPARTIES" big={String(t.counterparties)} sub={`${rep.quantiles?.join(' / ')}% quantiles`} />
        </div>

        <section className="pnl-panel">
          <header><span>BY COUNTERPARTY</span><span className="pnl-sub">click a row for the profile</span></header>
          <div className="pnl-tree">
            <div className="pnl-tr head" style={{ gridTemplateColumns: '1fr 7rem 8rem 8rem 8rem 8rem 8rem 9rem' }}>
              <span className="pnl-tn">COUNTERPARTY · CSA</span><span className="pnl-tv">TRADES</span><span className="pnl-tv">MTM</span><span className="pnl-tv">CURRENT EXP</span><span className="pnl-tv">EPE 1Y</span><span className="pnl-tv tot">PEAK PFE 95</span><span className="pnl-tv">CVA</span><span className="pnl-tv dim">PEAK AT</span>
            </div>
            {cps.map(c => (
              <div key={c.counterparty} className={`pnl-tr d1 trade${cur === c ? ' on' : ''}`} style={{ gridTemplateColumns: '1fr 7rem 8rem 8rem 8rem 8rem 8rem 9rem' }} onClick={() => setSel(c.counterparty)}>
                <span className="pnl-tn" style={{ paddingLeft: 8 }}>{c.counterparty}<small>{c.csa ? `${c.csa.type || 'NO_CSA'}${c.csa.threshold_m ? ` · thr ${c.csa.threshold_m}m` : ''}${c.csa.mta_k ? ` · mta ${c.csa.mta_k}k` : ''}` : 'no CSA record'}{c.skipped?.length ? ` · ${c.skipped.length} not simulated` : ''}</small></span>
                <span className="pnl-tv">{c.simulated ?? 0}/{c.trades}</span>
                {c.empty ? <span className="pnl-tv dim" style={{ gridColumn: '3 / -1', textAlign: 'left' }}>{c.error || (c.skipped || []).map(s => `${s.trade_ref}: ${s.reason}`).join(' · ') || 'nothing to simulate'}</span> : <>
                  <span className={`pnl-tv ${tone(c.exposure.v0_usd)}`}>{sgn(c.exposure.v0_usd)}</span>
                  <span className="pnl-tv">{fmt(c.exposure.current_exposure_usd)}</span>
                  <span className="pnl-tv">{fmt(c.exposure.epe_1y_usd)}</span>
                  <span className="pnl-tv tot">{fmt(c.exposure.peak_pfe95_usd)}</span>
                  <span className={`pnl-tv ${tone(c.cva.cva_usd)}`}>{sgn(c.cva.cva_usd)}</span>
                  <span className="pnl-tv dim">{c.exposure.peak_at_years.toFixed(1)}y</span></>}
              </div>
            ))}
            {!cps.length && <div className="pnl-empty">No live trades with a counterparty.</div>}
          </div>
        </section>

        {cur && !cur.empty && (
          <div className="pnl-grid">
            <section className="pnl-panel">
              <header><span>{cur.counterparty} · EXPOSURE PROFILE</span><span className="pnl-sub">real-world · {cur.n_paths} paths · monthly to {cur.months}M · {cur.seconds}s</span></header>
              <Profile c={cur} />
              <div className="rk-kv" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                {Object.entries(cur.exposure.pfe95_by_bucket).map(([b, v]) => <div key={b}><span>PFE95 {b}</span><b>{fmt(v)}</b></div>)}
              </div>
              <div className="rk-kv" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                <div><span>CSA</span><b>{cur.csa_model.preset}{cur.csa_model.collateralised ? ` · MPoR ${cur.csa_model.mpor_days}d` : ''}</b></div>
                <div><span>THRESHOLD · MTA</span><b>{fmt(cur.csa_model.threshold_usd)} · {fmt(cur.csa_model.mta_usd)}</b></div>
                <div><span>IM₀</span><b>{cur.csa_model.im_exchanged ? fmt(cur.exposure.im0_usd) : 'none'}</b></div>
                <div><span>COLLATERAL NOW</span><b>{fmt(cur.exposure.collateral_now_usd)}</b></div>
              </div>
              <div className="rk-h">TRADES IN THE NETTING SET</div>
              <div className="rk-rows">
                {cur.trades_today.map(x => <div key={x.trade_ref} className="rk-row" style={{ gridTemplateColumns: '1fr 7rem 9rem 8rem' }}><span className="rk-ref">{x.trade_ref}</span><span className="pnl-tv dim">{x.kind}</span><span className={`pnl-tv ${tone(x.mtm_usd)}`}>{sgn(x.mtm_usd)}</span><span className="pnl-tv dim">{fmtD(x.maturity)}</span></div>)}
                {(cur.skipped || []).map(s => <div key={s.trade_ref} className="rk-row dim" style={{ gridTemplateColumns: '1fr 3fr' }}><span className="rk-ref">{s.trade_ref}</span><span className="pnl-tv" style={{ textAlign: 'left' }}>not simulated: {s.reason}</span></div>)}
              </div>
            </section>
            <section className="pnl-panel">
              <header><span>CVA · RISK-NEUTRAL</span><span className="pnl-sub">XVA waterfall on the netted paths</span></header>
              <div className="rk-kv" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                {[['CVA', cur.cva.cva_usd], ['DVA', cur.cva.dva_usd], ['FVA', cur.cva.fva_usd], ['KVA', cur.cva.kva_usd], ['MVA', cur.cva.mva_usd], ['CP CDS', `${cur.cva.cp_cds_bp}bp · LGD ${(cur.cva.lgd * 100).toFixed(0)}%`]].map(([k, v]) => <div key={k}><span>{k}</span><b className={typeof v === 'number' ? tone(v) : ''}>{typeof v === 'number' ? sgn(v) : v}</b></div>)}
              </div>
              <div className="rk-h">CALIBRATION · REAL-WORLD (EXPOSURE)</div>
              <Calib c={cur.calibration.real_world} />
              <div className="rk-h">CALIBRATION · RISK-NEUTRAL (CVA)</div>
              <Calib c={cur.calibration.risk_neutral} />
            </section>
          </div>
        )}

        <section className="pnl-panel">
          <header><span>CREDIT LIMITS</span><span className="pnl-sub">PFE_PEAK:&lt;counterparty&gt; · PFE:&lt;counterparty&gt;:&lt;bucket&gt; · EPE · CVA · CE</span></header>
          <Limits rows={rep.limits || []} tables={rep.tables !== false} canWrite onConfigure={() => navigate('/configurations/market-risk/limits')} />
        </section>

        <div className="pnl-foot">
          <b>Method.</b> Every trade of a counterparty is valued on the same simulated paths, so netting is exact. Rates follow a Hull-White factor per currency and spots a lognormal factor, with Brownian motions correlated by the matrix estimated from two years of public history. For exposure the parameters are real-world: volatilities and mean reversion from that history, zero drift unless the firm chooses the historical drift. For CVA the parameters are risk-neutral: the swaption-calibrated model and the desk vols, forwards from the curve. The CSA on the record is applied to the netted value with the margin period of risk, as in the XVA engine. Caps and swaptions are not simulated yet and are listed as such.
        </div>
      </>)}
    </div>
  )
}

function Card({ label, big, sub, neg }) {
  return <div className="pnl-card"><span className="pnl-kl">{label}</span><b className={`pnl-big rk-big${neg ? ' neg' : ''}`}>{big}</b><span className="rk-sub">{sub}</span></div>
}

function Profile({ c }) {
  const t = c.t || []
  const mk = (arr, label, color, dash) => ({ label, color, dash, points: arr.map((v, i) => ({ t: t[i], v })) })
  const series = [mk(c.exposure.pfe['99'], 'PFE 99', '#e05040', [2, 3]), mk(c.exposure.pfe['97.5'], 'PFE 97.5', '#f0a020', [4, 3]), mk(c.exposure.pfe['95'], 'PFE 95', '#f0a020'),
                  mk(c.exposure.ee, 'EE', '#0dd4a8'), mk(c.ee_rn || [], 'EE (risk-neutral)', '#4a9ad4', [1, 3])]
  return <RateCurveCanvas series={series} unit="" decimals={0} height={240} />
}

function Calib({ c }) {
  const f = Object.entries(c.factors || {})
  return (
    <div className="rk-rows">
      {f.map(([k, x]) => <div key={k} className="rk-row" style={{ gridTemplateColumns: '9rem 5rem 6rem 6rem 1fr' }}>
        <span className="rk-ref">{k}</span><span className="pnl-tv">{x.kind === 'RATES' ? `a ${x.a.toFixed(3)}` : ''}</span><span className="pnl-tv">σ {(x.sigma * 100).toFixed(2)}%</span><span className="pnl-tv">μ {(x.drift * 100).toFixed(2)}%</span><span className="pnl-tv dim" style={{ textAlign: 'left' }}>{x.source}</span>
      </div>)}
      <div className="pnl-note">{c.measure} · drift {c.drift_mode}{c.window ? ` · window ${c.window[0]} → ${c.window[1]}` : ''}{c.notes?.length ? ` · ${c.notes.join('; ')}` : ''}{f.length > 1 && c.measure === 'REAL_WORLD' ? ` · correlations ${c.corr.map(r => r.map(v => v.toFixed(2)).join(' ')).join(' | ')}` : ''}</div>
    </div>
  )
}

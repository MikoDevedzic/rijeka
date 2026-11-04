// risk/CapitalPage.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// CAPITAL: the regulatory stock for the CSA as booked, by counterparty and in total: RWA,
// the CCR and CVA capital, SA-CCR EAD, SIMM IM, the leverage exposure, the liquidity value
// of the margin. Stock only, at today, in USD; the prices of that stock (KVA, MVA) and the
// book under other collateral regimes are under Risk → COLLATERAL and on the ticket's XVA
// tab. The numbers come from the same stored run (GET /api/capital/portfolio).
// ────────────────────────────────────────────────────────────────────────────────────
import { useNavigate } from 'react-router-dom'
import RiskNav from './RiskNav'
import { Card, RunControls } from './RegimesReport'
import { useCapitalPortfolio } from './regimes-report'
import { STOCK_METRICS, fmt, stockRows, stockTotals } from './capital-page'
import '../pnl/PnlPage.css'
import './RiskPage.css'

export default function CapitalPage() {
  const navigate = useNavigate()
  const { rep, err, busy, job, run } = useCapitalPortfolio()
  const rows = stockRows(rep)
  const tot = stockTotals(rep)
  const grid = `minmax(16rem,1fr) 5rem repeat(${STOCK_METRICS.length}, 7.5rem)`

  return (
    <div className="pnl rk-page">
      <RiskNav />
      <div className="pnl-bar">
        <div className="pnl-title">CAPITAL <span className="pnl-sub">regulatory stock for the CSA as booked · USD · today · the same run as the regimes report under COLLATERAL</span></div>
        <div className="pnl-ctl">
          <RunControls rep={rep} job={job} busy={busy} run={run} />
          <button className="pnl-btn ghost" onClick={() => navigate('/risk/collateral')}>REGIMES →</button>
        </div>
      </div>
      {err && <div className="pnl-err">{err}</div>}
      {job?.error && <div className="pnl-err">Last run failed: {job.error}</div>}
      {!rep && !err && <div className="pnl-empty">Loading…</div>}
      {rep && !rep.date && <div className="pnl-empty">{rep.note}</div>}
      {rep?.date && (<>
        <div className="pnl-cards" style={{ gridTemplateColumns: `repeat(${STOCK_METRICS.length}, 1fr)` }}>
          {STOCK_METRICS.map(([label, key, desc]) => <Card key={key} label={label} big={fmt(tot?.[key])} sub={desc} title={desc} />)}
        </div>
        <section className="pnl-panel">
          <header><span>BY COUNTERPARTY · THE CSA AS BOOKED</span><span className="pnl-sub">{rep.counterparties?.length || 0} counterparties · {rep.measure || 'RISK_NEUTRAL'} · seed {rep.seed}</span></header>
          <div className="pnl-tree">
            <div className="pnl-tr head" style={{ gridTemplateColumns: grid }}>
              <span className="pnl-tn">COUNTERPARTY · CSA AS BOOKED</span><span className="pnl-tv">TRADES</span>
              {STOCK_METRICS.map(([label, key, desc]) => <span key={key} className="pnl-tv" title={desc}>{label}</span>)}
            </div>
            {rows.map(r => (
              <div key={r.id} className="pnl-tr d1" style={{ gridTemplateColumns: grid, cursor: 'default' }}>
                <span className="pnl-tn" style={{ paddingLeft: 8 }}>{r.name}<small>{r.record ? `${r.record.csa_type || 'NO_CSA'}${r.record.threshold_m ? ` · thr ${r.record.threshold_m}m` : ''}${r.record.mta_k ? ` · mta ${r.record.mta_k}k` : ''} · MPoR ${r.record.mpor_days}bd · ${(r.record.eligible_collateral || []).join('/')}` : ''}{r.inputs ? ` · ${r.inputs.counterparty_type} ${r.inputs.rating_bucket} RW ${Math.round(100 * r.inputs.rw)} %` : ''}</small></span>
                <span className="pnl-tv">{r.empty ? r.trades : `${r.simulated}/${r.trades}`}</span>
                {r.empty ? <span className="pnl-tv dim" style={{ gridColumn: '3 / -1', textAlign: 'left' }}>{r.note}</span>
                  : STOCK_METRICS.map(([, key]) => <span key={key} className="pnl-tv">{fmt(r.values[key])}</span>)}
              </div>
            ))}
            {tot && (
              <div className="pnl-tr d0" style={{ gridTemplateColumns: grid, borderTop: '1px solid var(--border)' }}>
                <span className="pnl-tn"><b>BOOK</b></span><span className="pnl-tv" />
                {STOCK_METRICS.map(([, key]) => <span key={key} className="pnl-tv tot"><b>{fmt(tot[key])}</b></span>)}
              </div>
            )}
            {!rows.length && <div className="pnl-empty">No live trades with a counterparty.</div>}
          </div>
          <div className="pnl-note" style={{ marginTop: 8, lineHeight: 1.6 }}>
            · RWA = RW × EAD (CRE20, CRE52); K CCR = 8 % of RWA; K CVA the reduced basic approach (MAR50); leverage exposure per LEV30; HQLA of IM per LCR30.
            · The lifetime cost of this stock (KVA, MVA) and the same book under other collateral regimes are under <a href="/risk/collateral" onClick={e => { e.preventDefault(); navigate('/risk/collateral') }}>COLLATERAL</a>; the ticket's CAPITAL tab shows the incremental stock of one trade.
          </div>
        </section>
      </>)}
    </div>
  )
}

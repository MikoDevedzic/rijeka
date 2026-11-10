// risk/CollateralPage.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// COLLATERAL: the book's collateral. Per counterparty the schedule in force, today's
// variation-margin position and initial margin from the latest stored credit run, what
// each side is held in at its haircut, the carry over OIS it earns or costs over a year,
// the rail; totals by instrument and by class. Below it, the book under collateral regimes
// (the CSA as booked → on-chain, channel by channel). GET /api/collateral/book ·
// GET/POST /api/capital/portfolio.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RiskNav from './RiskNav'
import RegimesReport, { Card, RunControls } from './RegimesReport'
import { api, fmtD, fmtT, useCapitalPortfolio } from './regimes-report'
import { fmt, fmtSigned } from './capital-page'
import { summary } from '../onboarding/collateral-schedule'
import '../pnl/PnlPage.css'
import './RiskPage.css'

const bp = (v) => v == null || isNaN(v) ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))} bp`
const pct = (v) => v == null || isNaN(v) ? '—' : `${Math.round(100 * v)} %`
const legs = (ls) => ls?.length ? ls.map(l => `${l.instrument} ${Math.round(100 * l.weight)} % · ${fmt(l.value_usd)} after ${l.haircut_pct} % · ${bp(l.carry_bp)}`).join(' | ') : '—'

export default function CollateralPage() {
  const navigate = useNavigate()
  const [book, setBook] = useState(null)
  const [err, setErr] = useState(null)
  const cap = useCapitalPortfolio()
  useEffect(() => { (async () => { try { setBook(await api('/api/collateral/book')) } catch (e) { setErr(e.message) } })() }, [])
  const t = book?.totals || {}
  const rows = book?.counterparties || []
  const grid = 'minmax(15rem,1fr) 7.5rem 7.5rem 6.5rem minmax(14rem,1.4fr) minmax(14rem,1.4fr) 7.5rem 6rem'

  return (
    <div className="pnl rk-page">
      <RiskNav />
      <div className="pnl-bar">
        <div className="pnl-title">COLLATERAL <span className="pnl-sub">schedules · margin positions · what they are held in · carry over OIS · the book under regimes</span></div>
        <div className="pnl-ctl">
          {book?.date && <span className="pnl-note">positions from the credit run of {fmtD(book.date)}{book.stored_at ? ` · ${fmtT(book.stored_at)}` : ''}</span>}
          <button className="pnl-btn ghost" onClick={() => navigate('/configurations/counterparties')}>SCHEDULES →</button>
          <button className="pnl-btn ghost" onClick={() => navigate('/configurations/collateral/instruments')}>INSTRUMENTS →</button>
        </div>
      </div>
      {err && <div className="pnl-err">{err}</div>}
      {!book && !err && <div className="pnl-empty">Loading…</div>}
      {book && (<>
        <div className="pnl-cards" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
          <Card label="VM HELD" big={fmt(t.vm_held_usd)} sub="their variation margin we hold today" title="the collateral called against the netted value where it is in our favour, net of threshold and MTA" />
          <Card label="VM POSTED" big={fmt(t.vm_posted_usd)} sub="our variation margin they hold" />
          <Card label="INITIAL MARGIN" big={fmt(t.im_usd)} sub="posted and received alike, where the CSA exchanges it" />
          <Card label="CARRY PER YEAR" big={fmtSigned(t.carry_per_year_usd)} sub="what the margin earns over cash at OIS" title="face × carry over OIS of what each side is held in; cash is zero" />
          <Card label="ON CHAIN" big={pct(t.on_chain_share)} sub={`${t.with_schedule || 0} of ${t.counterparties || 0} with a schedule`} title="the share of today's margin requirement on an on-chain rail" />
        </div>

        <section className="pnl-panel">
          <header><span>BY COUNTERPARTY</span><span className="pnl-sub">the schedule, today's position, what each side is held in · click SCHEDULES to edit the annex</span></header>
          <div className="pnl-tree">
            <div className="pnl-tr head" style={{ gridTemplateColumns: grid }}>
              <span className="pnl-tn">COUNTERPARTY · CSA · SCHEDULE</span><span className="pnl-tv">VM HELD</span><span className="pnl-tv">VM POSTED</span><span className="pnl-tv">IM</span>
              <span className="pnl-tn">WE POST (VM + IM) · VALUE AFTER HAIRCUT · CARRY</span><span className="pnl-tn">WE HOLD (VM + IM) · VALUE AFTER HAIRCUT · CARRY</span><span className="pnl-tv">CARRY / YR</span><span className="pnl-tv">RAIL</span>
            </div>
            {rows.map(r => (
              <div key={r.counterparty_id} className="pnl-tr d1" style={{ gridTemplateColumns: grid, cursor: 'default' }}>
                <span className="pnl-tn" style={{ paddingLeft: 8 }}>{r.counterparty}<small>{r.csa_type}{r.csa_type !== 'NO_CSA' ? ` ${r.csa_currency}${r.threshold_m ? ` · thr ${r.threshold_m}m` : ''}${r.mta_k ? ` · mta ${r.mta_k}k` : ''}` : ''}{r.schedule ? ` · ${summary(r.schedule)}` : ' · no schedule: cash'}{r.note ? ` · ${r.note}` : ''}</small></span>
                <span className="pnl-tv">{r.has_run ? fmt(r.vm_held_usd) : '—'}</span>
                <span className="pnl-tv">{r.has_run ? fmt(r.vm_posted_usd) : '—'}</span>
                <span className="pnl-tv">{r.has_run ? fmt(r.im_usd) : '—'}</span>
                <span className="pnl-tn" style={{ whiteSpace: 'normal', fontSize: 11, color: 'var(--text-dim)' }}>{legs(r.posted)}</span>
                <span className="pnl-tn" style={{ whiteSpace: 'normal', fontSize: 11, color: 'var(--text-dim)' }}>{legs(r.held)}</span>
                <span className="pnl-tv" style={{ color: r.carry_per_year_usd > 0.5 ? 'var(--up)' : r.carry_per_year_usd < -0.5 ? 'var(--down)' : 'var(--text-dim)' }}>{fmtSigned(r.carry_per_year_usd)}</span>
                <span className="pnl-tv"><span className={`pnl-chip ${r.rail === 'on_chain' ? 'ok' : ''}`}>{r.rail === 'on_chain' ? 'ON CHAIN' : 'BILATERAL'}</span></span>
              </div>
            ))}
            {!rows.length && <div className="pnl-empty">No active counterparties.</div>}
          </div>
        </section>

        {book.by_instrument?.length > 0 && (
          <section className="pnl-panel">
            <header><span>BY INSTRUMENT</span><span className="pnl-sub">face posted and held, value after haircut, carry per year · {book.by_class?.map(c => `${c.key} ${fmt(c.posted_usd + c.held_usd)}`).join(' · ')}</span></header>
            <div className="pnl-tree">
              <div className="pnl-tr head" style={{ gridTemplateColumns: 'minmax(12rem,1fr) 10rem 8rem 8rem 8rem 8rem 7rem' }}>
                <span className="pnl-tn">INSTRUMENT</span><span className="pnl-tv">CLASS · RAIL</span><span className="pnl-tv">POSTED</span><span className="pnl-tv">HELD</span><span className="pnl-tv">AFTER HAIRCUT</span><span className="pnl-tv">CARRY / YR</span><span className="pnl-tv">CARRY</span>
              </div>
              {book.by_instrument.map(b => {
                const i = book.instruments?.[b.key] || {}
                return (
                  <div key={b.key} className="pnl-tr d1" style={{ gridTemplateColumns: 'minmax(12rem,1fr) 10rem 8rem 8rem 8rem 8rem 7rem', cursor: 'default' }}>
                    <span className="pnl-tn" style={{ paddingLeft: 8 }}>{b.key}<small>{i.name}</small></span>
                    <span className="pnl-tv dim" style={{ textAlign: 'right' }}>{i.cls} · {i.rail === 'on_chain' ? 'on chain' : 'bilateral'}</span>
                    <span className="pnl-tv">{fmt(b.posted_usd)}</span><span className="pnl-tv">{fmt(b.held_usd)}</span><span className="pnl-tv">{fmt(b.value_usd)}</span>
                    <span className="pnl-tv">{fmtSigned(b.carry_per_year_usd)}</span><span className="pnl-tv dim">{bp(i.carry_bp)}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )}
        <div className="pnl-note" style={{ lineHeight: 1.6 }}>{(book.notes || []).map((x, i) => <div key={i}>· {x}</div>)}</div>
      </>)}

      <div className="pnl-bar" style={{ marginTop: 18 }}>
        <div className="pnl-title">THE BOOK UNDER REGIMES <span className="pnl-sub">USD · every netting set on the same paths · the CSA as booked → on-chain, channel by channel</span></div>
        <div className="pnl-ctl"><RunControls rep={cap.rep} job={cap.job} busy={cap.busy} run={cap.run} /></div>
      </div>
      {cap.err && <div className="pnl-err">{cap.err}</div>}
      {cap.job?.error && <div className="pnl-err">Last run failed: {cap.job.error}</div>}
      {!cap.rep && !cap.err && <div className="pnl-empty">Loading…</div>}
      {cap.rep && !cap.rep.date && <div className="pnl-empty">{cap.rep.note}</div>}
      <RegimesReport rep={cap.rep} />
    </div>
  )
}

// pnl/XvaReservesPage.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// XVA RESERVES: the reserve book under P&L. Levels per counterparty and component from the
// credit engine's risk-neutral run, the day's change by component, the accounting adjustments
// the firm nets into the signed P&L (its policy) against the economic ones shown as memo.
// Reads the P&L report's xva section (GET /api/pnl/report); the sequential explain of the
// reserve change is the next step of this tab.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSessionMaybe } from '../../lib/session'
import PnlNav from './PnlNav'
import './PnlPage.css'
import '../risk/RiskPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const fmt = (n) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
const sgn = (n) => n == null || isNaN(n) ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`
const fmtD = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const LABEL = { CVA: 'CVA', DVA: 'DVA', FVA: 'FVA', FBA: 'FBA', KVA: 'KVA', MVA: 'MVA' }

export default function XvaReservesPage() {
  const navigate = useNavigate()
  const [rep, setRep] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    (async () => {
      try {
        const s = await getSessionMaybe()
        const r = await fetch(`${API}/api/pnl/report`, { headers: { Authorization: `Bearer ${s?.access_token}` } })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(typeof j.detail === 'string' ? j.detail : `report ${r.status}`)
        setRep(j)
      } catch (e) { setErr(e.message) }
    })()
  }, [])
  const x = rep?.xva
  const comps = x?.components || []
  const netted = new Set((x?.netted || []).map(k => String(k).toUpperCase()))
  const day = x?.day
  return (
    <div className="pnl rk-page">
      <PnlNav />
      <div className="pnl-bar">
        <div className="pnl-title">XVA RESERVES <span className="pnl-sub">the reserve book · levels from the credit engine's risk-neutral run · the firm's policy on what nets into the signed P&L</span></div>
        <div className="pnl-ctl">
          {x && <span className="pnl-note">levels {fmtD(x.levels_date)}{x.prev_date ? ` · vs ${fmtD(x.prev_date)}` : ''}</span>}
          <button className="pnl-btn ghost" onClick={() => navigate('/risk/ccr')}>COUNTERPARTY CREDIT →</button>
          <button className="pnl-btn ghost" onClick={() => navigate('/configurations/pnl/conventions')}>POLICY →</button>
        </div>
      </div>
      {err && <div className="pnl-err">{err}</div>}
      {!rep && !err && <div className="pnl-empty">Loading…</div>}
      {rep && !x && <div className="pnl-empty">No reserve levels yet: the counterparty-credit run stores them (Risk → Counterparty credit → RUN NOW).</div>}
      {x && (<>
        <div className="pnl-cards" style={{ gridTemplateColumns: `repeat(${comps.length + 1}, 1fr)` }}>
          {comps.map(k => (
            <div key={k} className="pnl-card" style={netted.has(k.toUpperCase()) ? undefined : { opacity: 0.75 }}>
              <div className="pnl-card-l">{LABEL[k] || k} {netted.has(k.toUpperCase()) ? <small className="pnl-note">· netted</small> : <small className="pnl-note">· memo</small>}</div>
              <div className="pnl-card-b">{sgn(x.levels?.[k])}</div>
              <div className="pnl-card-s">day {day ? sgn(day.by_component?.[k]) : '—'}</div>
            </div>
          ))}
          <div className="pnl-card" style={{ borderColor: 'var(--accent)' }}>
            <div className="pnl-card-l" style={{ color: 'var(--accent)' }}>DAY · NETTED INTO P&L</div>
            <div className="pnl-card-b" style={{ color: 'var(--accent)' }}>{day ? sgn(day.netted) : '—'}</div>
            <div className="pnl-card-s">all components {day ? sgn(day.all) : '—'} · MTD {x.mtd ? sgn(x.mtd.netted) : '—'} · YTD {x.ytd ? sgn(x.ytd.netted) : '—'}</div>
          </div>
        </div>
        <section className="pnl-panel">
          <header><span>BY COUNTERPARTY</span><span className="pnl-sub">levels today, the day's change by component · costs negative, benefits positive; a rising cost is a loss</span></header>
          <div className="pnl-tree">
            <div className="pnl-tr head" style={{ gridTemplateColumns: `1fr repeat(${comps.length}, 7rem) 8rem` }}>
              <span className="pnl-tn">COUNTERPARTY</span>{comps.map(k => <span key={k} className="pnl-tv">{LABEL[k] || k}</span>)}<span className="pnl-tv tot">DAY · NETTED</span>
            </div>
            {(x.by_counterparty || []).map(c => (
              <div key={c.counterparty} className="pnl-tr d1" style={{ gridTemplateColumns: `1fr repeat(${comps.length}, 7rem) 8rem` }}>
                <span className="pnl-tn" style={{ paddingLeft: 8 }}>{c.counterparty}<small>{c.change ? comps.map(k => `${LABEL[k] || k} ${sgn(c.change[k])}`).join(' · ') : 'first day: no change yet'}</small></span>
                {comps.map(k => <span key={k} className="pnl-tv">{sgn(c.today?.[k])}</span>)}
                <span className="pnl-tv tot">{c.change ? sgn(comps.filter(k => netted.has(k.toUpperCase())).reduce((a, k) => a + (c.change[k] || 0), 0)) : '—'}</span>
              </div>
            ))}
            {!(x.by_counterparty || []).length && <div className="pnl-empty">No counterparties with live trades.</div>}
          </div>
          <div className="pnl-note" style={{ padding: '8px 14px', lineHeight: 1.6 }}>{x.note}<br />· the sequential explain of the day's change (time, rates, spots and vols, spreads, funding, new and matured trades) is the next step of this tab; the levels and the netted change already enter the official P&L through IPV</div>
        </section>
      </>)}
    </div>
  )
}

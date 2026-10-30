// configurations/SystemPage.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// SYSTEM: is every scheduled batch current, and what is breaking in browsers.
// Reads GET /api/ops/health, the same body the cron's last step checks; nothing here
// is per account. The browser errors come from lib/errors.js reports and live in the
// API's memory (last 200, 24-hour summary).
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import '../pnl/PnlPage.css'
import '../risk/RiskPage.css'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const FEEDS = { news: 'the NEWS room', spots: 'FX and crypto spot', market_data: 'curves and vols', pnl: 'P&L', risk: 'market risk', ccr: 'counterparty credit' }
const fmtT = (iso) => iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtLast = (v) => !v ? 'never' : v.length > 10 ? fmtT(v) : new Date(v + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })

export default function SystemPage() {
  const [h, setH] = useState(null)
  const [err, setErr] = useState(null)
  const load = () => fetch(`${API}/api/ops/health`).then(r => r.ok ? r.json() : Promise.reject(new Error(`health ${r.status}`))).then(setH).catch(e => setErr(e.message))
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t) }, [])
  const checks = Object.entries(h?.checks || {})
  const ce = h?.client_errors
  const [u, setU] = useState(null)
  useEffect(() => {
    import('../../lib/session').then(({ getSessionMaybe }) => getSessionMaybe()).then(s => fetch(`${API}/api/ops/usage`, { headers: { Authorization: `Bearer ${s?.access_token}` } }))
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`usage ${r.status}`))).then(setU).catch(() => setU({ error: true }))
  }, [])
  const umax = Math.max(1, ...((u?.series || []).map(d => Math.max(d.visitors, d.signups, d.trades, d.confirms))))
  return (
    <div className="pnl">
      <div className="pnl-bar">
        <div className="pnl-title">SYSTEM <span className="pnl-sub">scheduled batches, usage and browser errors · what the operator sees</span></div>
        <div className="pnl-ctl">{h && <span className={`pnl-chip ${h.ok ? 'ok' : 'red'}`}>{h.ok ? 'EVERY BATCH CURRENT' : 'A BATCH IS STALE'}</span>}
          {h && <span className="pnl-note">checked {fmtT(h.checked_at)}</span>}</div>
      </div>
      {err && <div className="pnl-err">{err}</div>}
      {!h && !err && <div className="pnl-empty">Reading the health check…</div>}
      {h && (<>
        <section className="pnl-panel" style={{ maxWidth: 980 }}>
          <header><span>SCHEDULED BATCHES</span><span className="pnl-sub">the cron runs every 30 minutes; its last step fails the run, and mails the owner, when a row here is stale</span></header>
          <div className="rk-rows">
            <div className="rk-row dim" style={{ gridTemplateColumns: '11rem 1fr 7rem 12rem 14rem' }}><span>BATCH</span><span>FEEDS</span><span>STATE</span><span>LAST RUN</span><span>RULE</span></div>
            {checks.map(([name, c]) => (
              <div key={name} className="rk-row" style={{ gridTemplateColumns: '11rem 1fr 7rem 12rem 14rem' }}>
                <span className="rk-ref">{name.replace('_', ' ').toUpperCase()}</span>
                <span className="pnl-tv dim" style={{ textAlign: 'left' }}>{c.feeds || FEEDS[name] || ''}</span>
                <span><span className={`pnl-chip ${c.ok ? 'ok' : 'red'}`}>{c.ok ? 'CURRENT' : 'STALE'}</span></span>
                <span className="pnl-tv" style={{ textAlign: 'left' }}>{fmtLast(c.last)}</span>
                <span className="pnl-tv dim" style={{ textAlign: 'left' }}>{c.rule}</span>
              </div>
            ))}
          </div>
          <div className="pnl-foot">Freshness rules: news and spots within three hours; market data, P&amp;L, market risk and counterparty credit dated on or after the previous business day. The desk home shows a BATCH item in the inbox when a row is stale.</div>
        </section>

        <section className="pnl-panel" style={{ maxWidth: 980 }}>
          <header><span>USAGE · LAST {u?.days || 14} DAYS</span><span className="pnl-sub">{u && !u.error ? `${u.totals.visitors} visitors · ${u.totals.views} views · ${u.totals.signups} accounts · ${u.totals.trades} trades · ${u.totals.confirms} confirmations · ${u.totals.anchors} anchored` : u?.error ? 'not available' : 'loading…'}</span></header>
          {u && !u.error && (<>
            <div className="rk-rows">
              <div className="rk-row dim" style={{ gridTemplateColumns: '7rem repeat(7, 1fr)' }}><span>DAY</span><span>VISITORS</span><span>VIEWS</span><span>SIGN-UP STARTED</span><span>ACCOUNTS</span><span>TRADES</span><span>CONFIRMED</span><span>ANCHORED</span></div>
              {u.series.slice().reverse().map(d => (
                <div key={d.date} className="rk-row" style={{ gridTemplateColumns: '7rem repeat(7, 1fr)' }}>
                  <span className="rk-ref">{new Date(d.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' })}</span>
                  {['visitors', 'views', 'signup_started', 'signups', 'trades', 'confirms', 'anchors'].map(k => (
                    <span key={k} className={`pnl-tv${d[k] ? '' : ' dim'}`} style={{ textAlign: 'left' }}>{d[k] || '·'}{k !== 'views' && k !== 'signup_started' && d[k] ? <i style={{ display: 'inline-block', marginLeft: 6, height: 6, width: `${Math.round(d[k] / umax * 40)}px`, background: 'var(--accent)', opacity: 0.6, verticalAlign: 'middle' }} /> : null}</span>))}
                </div>
              ))}
            </div>
            <div className="pnl-foot">{u.note} Hits are kept in {u.hits_stored_in}.</div>
          </>)}
        </section>

        <section className="pnl-panel" style={{ maxWidth: 980 }}>
          <header><span>BROWSER ERRORS · LAST 24 HOURS</span><span className="pnl-sub">{ce ? `${ce.last_24h} reports · ${ce.distinct} distinct · ${ce.kept} kept in memory` : 'not reported by this API'}</span></header>
          {ce && ce.top.length === 0 && <div className="pnl-empty">No uncaught errors reported from any browser in the last 24 hours.</div>}
          {ce && ce.top.length > 0 && (
            <div className="rk-rows">
              <div className="rk-row dim" style={{ gridTemplateColumns: '1fr 10rem 6rem 9rem 7rem' }}><span>MESSAGE</span><span>ROUTE</span><span>COUNT</span><span>LAST</span><span>SOURCE</span></div>
              {ce.top.map((e, i) => (
                <div key={i} className="rk-row" style={{ gridTemplateColumns: '1fr 10rem 6rem 9rem 7rem' }}>
                  <span className="rk-ref" style={{ overflowWrap: 'anywhere' }}>{e.message}</span>
                  <span className="pnl-tv dim" style={{ textAlign: 'left' }}>{e.route}</span>
                  <span className="pnl-tv" style={{ textAlign: 'left' }}>{e.count}</span>
                  <span className="pnl-tv dim" style={{ textAlign: 'left' }}>{fmtT(e.last)}</span>
                  <span className="pnl-tv dim" style={{ textAlign: 'left' }}>{e.source}{e.release && e.release !== 'dev' ? ` · ${String(e.release).slice(0, 7)}` : ''}</span>
                </div>
              ))}
            </div>
          )}
          <div className="pnl-foot">Reported by the app itself (window errors, unhandled promises, React boundaries), with tokens stripped before they are kept. The log is in the API's memory: the last 200 reports, at most 60 a minute per address, and it empties on a restart. Enough to know a page is breaking for someone before they write in.</div>
        </section>
      </>)}
    </div>
  )
}

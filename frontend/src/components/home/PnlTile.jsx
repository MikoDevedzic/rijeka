// home/PnlTile.jsx — the desk's P&L at a glance: day, month and year to date, each split
// into market and trading. GET /api/pnl/summary; the P&L page has the attribution.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSessionMaybe } from '../../lib/session'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const fmt = (n) => n == null || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })
const sgn = (n) => n == null || isNaN(n) ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`
const tone = (n) => n > 0.5 ? 'pos' : n < -0.5 ? 'neg' : ''
const fmtD = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' }) : ''
const STATUS = { OPEN: ['OPEN', ''], TRADER_SIGNED: ['TRADER SIGNED', 'amber'], CONTROLLER_SIGNED: ['CONTROLLER SIGNED', 'amber'], FINAL: ['FINAL', 'ok'] }

export default function PnlTile() {
  const navigate = useNavigate()
  const [s, setS] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const session = await getSessionMaybe()
        const r = await fetch(`${API}/api/pnl/summary`, { headers: { Authorization: `Bearer ${session?.access_token}` } })
        if (!r.ok) throw new Error(`pnl ${r.status}`)
        const j = await r.json(); if (alive) setS(j)
      } catch (e) { if (alive) setErr(e.message) }
    })()
    return () => { alive = false }
  }, [])
  const [stLabel, stTone] = STATUS[s?.status] || STATUS.OPEN
  const cols = s ? [['DAY', s.dod, s.market, s.trading], ['MTD', s.mtd, s.mtd_market, s.mtd_trading], ['YTD', s.ytd, s.ytd_market, s.ytd_trading]] : []
  return (
    <div className="pt" onClick={() => navigate('/pnl')} role="button" title="Open the P&L page: attribution, hierarchy, sign-off">
      <div className="pt-h">
        <span>P&amp;L · {s?.reporting_ccy || 'USD'}{s?.date ? ` · ${fmtD(s.date)}${s.prev_date ? ` vs ${fmtD(s.prev_date)}` : ''}` : ''}</span>
        <span>{s && <i className={`lf-chip ${stTone}`}>{stLabel}</i>} <b className="dh-link">ATTRIBUTION →</b></span>
      </div>
      {err && <div className="pt-note">P&amp;L unavailable ({err})</div>}
      {!s && !err && <div className="pt-note">Marking the book…</div>}
      {s && (
        <div className="pt-cols">
          {cols.map(([l, tot, mk, tr]) => (
            <div key={l} className="pt-col">
              <span className="dh-kpi-l">{l}</span>
              <b className={`pt-big ${tone(tot)}`}>{sgn(tot)}</b>
              <small><span>MKT</span><em className={tone(mk)}>{sgn(mk)}</em></small>
              <small><span>TRD</span><em className={tone(tr)}>{sgn(tr)}</em></small>
            </div>
          ))}
        </div>
      )}
      {s?.problems > 0 && <div className="pt-note">{s.problems} trade{s.problems > 1 ? 's' : ''} not explained · see the P&amp;L page</div>}
    </div>
  )
}

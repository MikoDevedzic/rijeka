// home/WeekAhead.jsx
// ────────────────────────────────────────────────────────────────────────────────────
// THE WEEK AHEAD on the desk home: central bank decisions, the releases a rates desk waits
// for (CPI, payrolls, GDP, unemployment) and UST coupon auctions across USD, EUR, GBP, CHF,
// JPY, with the last print and, once out, the actual and the surprise against it. Dates and
// prints come from the agencies' own schedules and keyless APIs (backend/market_data/calendar.py);
// no consensus feed, and the tile says so.
// ────────────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'
const CCYS = ['ALL', 'USD', 'EUR', 'GBP', 'CHF', 'JPY']
const fmtV = (x, unit) => x == null ? '—' : unit === 'k' ? `${x > 0 ? '+' : ''}${Math.round(x)}k` : `${x.toFixed(1)}${unit.startsWith('%') ? '%' : ''}`
const fmtS = (x, unit) => x == null ? '' : unit === 'k' ? `${x > 0 ? '+' : ''}${Math.round(x)}k` : `${x > 0 ? '+' : ''}${x.toFixed(1)}${unit.startsWith('%') ? 'pp' : ''}`
// days and times in the reader's clock: a Tokyo 08:30 release is the previous evening in New York
const localDate = (whenIso) => { const d = new Date(whenIso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const todayLocal = () => localDate(new Date().toISOString())
const dayLabel = (iso, today) => {
  const d = new Date(iso + 'T00:00:00'), t = new Date(today + 'T00:00:00')
  const diff = Math.round((d - t) / 864e5)
  const name = d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()
  return diff === 0 ? `TODAY · ${name}` : diff === 1 ? `TOMORROW · ${name}` : diff === -1 ? `YESTERDAY · ${name}` : name
}
const localTime = (whenIso) => new Date(whenIso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
const periodLabel = (r) => {
  if (!r.period || r.kind !== 'DATA') return null
  if (r.period.includes('Q')) return r.name.includes(r.period.split('-')[1]) ? null : r.period.replace('-', ' ')
  return new Date(r.period + '-15').toLocaleDateString(undefined, { month: 'short' })
}

export default function WeekAhead() {
  const [cal, setCal] = useState(null)
  const [err, setErr] = useState(null)
  const [ccy, setCcy] = useState('ALL')
  useEffect(() => {
    let live = true
    const load = () => fetch(`${API}/api/public/calendar`).then(r => r.ok ? r.json() : Promise.reject(new Error(`calendar ${r.status}`))).then(j => live && setCal(j)).catch(e => live && setErr(e.message))
    load(); const t = setInterval(load, 15 * 60_000)
    return () => { live = false; clearInterval(t) }
  }, [])
  const today = todayLocal()
  const groups = useMemo(() => {
    const rows = (cal?.rows || []).filter(r => ccy === 'ALL' || r.ccy === ccy)
    const by = new Map()
    for (const r of rows) { const k = localDate(r.when); if (!by.has(k)) by.set(k, []); by.get(k).push(r) }
    return [...by.entries()]
  }, [cal, ccy])
  const released = (cal?.rows || []).filter(r => r.actual).length

  return (
    <section className="dh-card dh-week">
      <header>
        <span>THE WEEK AHEAD <em className="dh-h-sub">decisions and releases · last print, actual, surprise</em></span>
        <span className="dh-sub">{CCYS.map(c => <button key={c} className={`dh-chip${ccy === c ? ' on' : ''}`} onClick={() => setCcy(c)}>{c}</button>)}</span>
      </header>
      {err && <div className="dh-caption">Calendar unavailable: {err}</div>}
      {!cal && !err && <div className="dh-caption">Loading the calendar…</div>}
      {cal && (
        <div className="wk-list">
          {groups.map(([d, rows]) => (
            <div key={d} className={`wk-day${d === today ? ' today' : ''}${d < today ? ' past' : ''}`}>
              <div className="wk-dh">{dayLabel(d, today)}</div>
              {rows.map((r, i) => (
                <div key={i} className={`wk-row t${r.tier} ${r.kind.toLowerCase()}${r.actual ? ' out' : ''}`} title={`${r.source || ''}${r.note ? ` · ${r.note}` : ''}${r.estimated ? ' · date is the usual slot, not a published one' : ''}`}>
                  <span className="wk-time">{localTime(r.when)}</span>
                  <span className={`wk-ccy c-${r.ccy}`}>{r.ccy}</span>
                  <span className="wk-name">{r.name}{periodLabel(r) ? <em> · {periodLabel(r)}</em> : null}{r.estimated && <i className="wk-est" title="usual slot, the agency's calendar is not machine-readable">~</i>}{r.kind === 'AUCTION' && r.note ? <em> · {r.note}</em> : null}</span>
                  <span className="wk-last">{r.last ? <><small>LAST</small>{fmtV(r.last.value, r.unit)}</> : r.kind === 'DATA' && r.note?.startsWith('actual:') ? <small className="wk-na">no public API</small> : ''}</span>
                  <span className="wk-act">{r.actual ? <><small>ACTUAL</small><b>{fmtV(r.actual.value, r.unit)}</b>{r.surprise != null && <i className={r.surprise > 0 ? 'up' : r.surprise < 0 ? 'dn' : ''}>{fmtS(r.surprise, r.unit)}</i>}</> : ''}</span>
                </div>
              ))}
            </div>
          ))}
          {!groups.length && <div className="dh-caption">Nothing scheduled for {ccy} in the next two weeks.</div>}
        </div>
      )}
      {cal && <div className="dh-caption wk-foot">{cal.rows.length} items · {released} released · times in your clock · <b>~</b> usual slot where the agency publishes no machine-readable calendar (euro area, CH) · surprise is against the previous print, there is no consensus feed</div>}
    </section>
  )
}

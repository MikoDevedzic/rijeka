// home/BookBrief.jsx — Prometheus on the book: computed facts from the pricers,
// prose bound to fact ids and audited before display (backend/prometheus/book_brief.py).
import { useEffect, useState } from 'react'
import { getSessionMaybe } from '../../lib/session'

const API = import.meta.env?.VITE_API_URL || 'http://localhost:8000'

async function load(refresh) {
  const session = await getSessionMaybe()
  const r = await fetch(`${API}/api/prometheus/brief${refresh ? '?refresh=1' : ''}`, { headers: { Authorization: `Bearer ${session?.access_token}` } })
  if (!r.ok) throw new Error(`brief ${r.status}`)
  return r.json()
}

const fmtV = (f) => f.value == null ? '' : (Math.abs(f.value) >= 1000 ? Number(f.value).toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(f.value)) + (f.unit ? ` ${f.unit}` : '')

export default function BookBrief() {
  const [b, setB] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [facts, setFacts] = useState(false)
  const [hi, setHi] = useState(null)              // fact id to highlight
  const run = (refresh) => { setBusy(true); setErr(null); load(refresh).then(setB).catch(e => setErr(e.message)).finally(() => setBusy(false)) }
  useEffect(() => { let alive = true; load(false).then(x => alive && setB(x)).catch(e => alive && setErr(e.message)); return () => { alive = false } }, [])
  const byId = Object.fromEntries((b?.facts || []).map(f => [f.id, f]))
  return (
    <div className="bb">
      <div className="bb-head">
        <span>PROMETHEUS · BOOK BRIEF</span>
        <span className="bb-actions">
          <button className="dh-link" onClick={() => setFacts(v => !v)}>{facts ? 'HIDE THE FACTS' : 'SHOW THE FACTS'}</button>
          <button className="dh-link" onClick={() => run(true)} disabled={busy}>{busy ? 'WORKING…' : 'REFRESH'}</button>
        </span>
      </div>
      {err && <div className="bb-note">Brief unavailable: {err}</div>}
      {!b && !err && <div className="bb-note">Reading the book…</div>}
      {b && b.paragraphs.length === 0 && (
        <div className="bb-note">
          {!b.enabled ? 'Facts only: Prometheus is not configured on this server.'
            : b.narration_error ? `Facts computed; narration failed (${b.narration_error}).`
            : 'Facts computed; nothing the audit could back as prose.'}
        </div>
      )}
      {b && b.paragraphs.map((p, i) => (
        <p key={i} className="bb-p">
          {p.text}
          <span className="bb-cites">{p.facts.map(id => <button key={id} className={`bb-cite${hi === id ? ' on' : ''}`} title={byId[id]?.text} onClick={() => { setFacts(true); setHi(id) }}>{id}</button>)}</span>
        </p>
      ))}
      {b && (
        <div className="bb-foot">
          AI narration over computed facts · every number checked against the sheet
          {b.dropped?.length ? ` · ${b.dropped.length} sentence${b.dropped.length > 1 ? 's' : ''} removed by the audit` : ''}
          {b.priced < b.trades ? ` · ${b.trades - b.priced} trade${b.trades - b.priced > 1 ? 's' : ''} not priced` : ''}
          {' · '}changes nothing
        </div>
      )}
      {facts && b && (
        <table className="bb-facts">
          <tbody>
            {b.facts.map(f => (
              <tr key={f.id} className={hi === f.id ? 'on' : ''} onClick={() => setHi(f.id)}>
                <td className="bb-id">{f.id}</td>
                <td className="bb-txt">{f.kind === 'news' && f.extra?.url ? <a href={f.extra.url} target="_blank" rel="noopener noreferrer">{f.text} ↗</a> : f.text}</td>
                <td className="bb-val">{fmtV(f)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
